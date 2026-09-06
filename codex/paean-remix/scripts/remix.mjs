#!/usr/bin/env node
// remix-helper.mjs — download the source of one or more published Paean Apps
// Square sites by hash and scaffold a new project that remixes them.
//
// Every source: GET /square/apps/:hash (metadata, remixability).
//
// PRIMARY source (the first one): POST /square/apps/:hash/remix (server-side
// clone into a workspace owned by the caller — this credits the upstream
// creator once) → GET /v2/workspace/:ws/export/zip (full source, binaries
// included) → <target>/.remix-sources/<hash>/. The clone workspace's hashKey
// is saved to <target>/.clide/publish.json so paean-publish REUSES it: the
// backend recognises the workspace as already remixed from that parent and
// does not count or pay it a second time.
//
// SECONDARY sources: read through the 8x.gg MCP server (POST /8x/mcp,
// list_app_files + read_app_file). That records a source read but creates no
// workspace and pays nothing now — each is credited exactly once, at publish,
// when clide.json declares it in remixOfHashKeys. Text files only; binaries
// and >256KB files are listed in .remix-sources/<hash>/REMIX-FETCH.json
// instead of downloaded. --clone-all forces /remix for every source (full
// assets) at the cost of crediting each secondary twice: once for the
// throwaway clone, once at publish.
//
// Then write clide.json (remix graph), LICENSE, and .clideignore so the new
// game is ready to build + /publish.
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync, readdirSync, statSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import path from 'node:path'
import readline from 'node:readline'

const API_BASE = resolveApiBase()
const REMIX_SOURCES_DIR = '.remix-sources'
const MANIFEST_FILE = 'clide.json'
const LICENSE_FILE = 'LICENSE'
const SCHEMA_VERSION = 1
const HASH_RE = /^[A-Za-z0-9_-]{3,64}$/
const ROLE_RE = /^[A-Za-z][A-Za-z0-9 _-]{0,40}$/
const MCP_PATH = '/8x/mcp'
const MCP_MAX_READ_BYTES = 256 * 1024
const FETCH_NOTE_FILE = 'REMIX-FETCH.json'
// Mirrors paean-publish: it reuses `workspaceHashKey` from this file.
const CLIDE_STATE_DIR = '.clide'
const CLIDE_STATE_FILE = 'publish.json'
const BINARY_EXT_RE = /\.(png|jpe?g|gif|webp|avif|bmp|ico|icns|tiff?|psd|mp3|ogg|oga|wav|flac|m4a|aac|opus|mp4|m4v|webm|mov|avi|mkv|woff2?|ttf|otf|eot|wasm|zip|gz|tgz|bz2|7z|rar|pdf|bin|dat|glb|fbx|blend|ktx2?|basis|dds|pvr|swf|jar|class|exe|dll|so|dylib)$/i

const SAFETY_PATTERNS = [
  REMIX_SOURCES_DIR + '/',
  '.clide/',
  '.env',
  '.env.*',
  '*.pem',
  '*.key',
  '*.p12',
  '*.pfx',
  'id_rsa*',
  '.npmrc',
  'node_modules/',
  '.git/',
  '*.log',
  '.DS_Store',
  'Thumbs.db',
  '*.tmp',
]

function usage() {
  return [
    'Usage: remix-helper.mjs <source> [<source> ...] [--dir <target>]',
    '                        [--title <t>] [--summary <t>] [--category <c>] [--license <spdx>]',
    '                        [--role <aspect>] [--clone-all] [--dry-run] [--yes]',
    '',
    'Each <source> must resolve to a published Square app hashKey: a bare hashKey,',
    'https://8x.gg/<hashKey> (also 8x.gg/pub/<hashKey> and 8x.gg/apps/<hashKey>),',
    'or hashKey=role to tag the aspect you want from it',
    '(e.g. h1=gameplay h2=art h3=theme). A *.clide.app play URL contains the',
    'site handle, not necessarily the Square hashKey; use the hashKey reported by publish',
    '(or the 8x.gg MCP find_app tool, which resolves any URL or title).',
    '',
    'The FIRST source is the primary parent: it is cloned server-side (/remix, full',
    'source incl. binaries) and its workspace is saved to .clide/publish.json so',
    'paean-publish reuses it — the creator is credited once. Every other source is',
    'read through the 8x.gg MCP server (text files only, no workspace, credited once',
    'at publish via clide.json). --clone-all clones every source with /remix instead',
    '(full assets for all), which credits each secondary twice.',
    '',
    'Writes <target>/' + REMIX_SOURCES_DIR + '/<hash>/ per source plus a clide.json remix graph,',
    'LICENSE, .clideignore and .clide/publish.json. --dry-run resolves metadata only.',
  ].join('\n')
}

function normalizeApiBase(raw) {
  let base = String(raw || '').replace(/\/+$/, '')
  if (base.endsWith('/zero')) base = base.slice(0, -'/zero'.length)
  return base || 'https://api.paean.ai'
}

// Resolve the Paean API base. PAEAN_API_BASE is an explicit override and is
// always honoured. ZERO_API_BASE / ZERO_CLI_BASE_URL are accepted only when
// they actually point at the Paean API: ZERO_CLI_BASE_URL is commonly set to
// the LLM gateway (e.g. an Anthropic-compatible provider URL), which is NOT
// the Paean API — blindly using it would route every request at the wrong host.
function resolveApiBase() {
  const paeanHost = /(^|\.)paean\.ai$/i
  for (const raw of [process.env.PAEAN_API_BASE, process.env.ZERO_API_BASE, process.env.ZERO_CLI_BASE_URL]) {
    if (!raw) continue
    if (raw === process.env.PAEAN_API_BASE || paeanHost.test(hostOf(raw))) return normalizeApiBase(raw)
  }
  return 'https://api.paean.ai'
}
function hostOf(base) {
  try { return new URL(base).hostname } catch { return String(base).split('/')[0] || '' }
}

function credentialFiles() {
  const files = []
  if (process.env.PAEAN_CREDENTIALS_FILE) files.push(process.env.PAEAN_CREDENTIALS_FILE)
  if (process.env.ZERO_CONFIG_DIR) files.push(path.join(process.env.ZERO_CONFIG_DIR, 'credentials.json'))
  files.push(path.join(homedir(), '.paean', 'credentials.json'))
  files.push(path.join(homedir(), '.zero', 'credentials.json'))
  return files
}

function loadStoredCredentials() {
  for (const file of credentialFiles()) {
    if (!existsSync(file)) continue
    try {
      return JSON.parse(readFileSync(file, 'utf8'))
    } catch {
      // try the next location
    }
  }
  return null
}

function getPaeanToken() {
  const stored = loadStoredCredentials()
  return (
    process.env.PAEAN_AUTH_TOKEN ||
    process.env.PAEAN_API_KEY ||
    (stored && (stored.token || stored.apiKey)) ||
    ''
  )
}

function normalizeToken(token) {
  let t = String(token == null ? '' : token).trim()
  t = t.replace(/^[<"'\`]+/, '').replace(/[>"'\`]+$/, '').trim()
  if (!t) throw new Error('Empty remix source token')
  t = t.replace(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//, '')
  t = t.split(/\s/)[0].split('?')[0].split('#')[0]
  const slash = t.indexOf('/')
  const host = slash >= 0 ? t.slice(0, slash) : t
  const lowerHost = host.toLowerCase()
  const segments = (slash >= 0 ? t.slice(slash + 1) : '').split('/').filter(Boolean)
  let hash
  if (lowerHost.endsWith('.clide.app')) hash = host.slice(0, -'.clide.app'.length)
  else if (lowerHost === '8x.gg' || lowerHost === 'www.8x.gg' || lowerHost === 'x.8x.gg') {
    // Section-prefixed paths (8x.gg/pub/<hash>, 8x.gg/apps/<hash>) carry the
    // hashKey as their second segment; a bare 8x.gg/<hash> keeps the first.
    const first = (segments[0] || '').toLowerCase()
    const segs = (first === 'pub' || first === 'apps') ? segments.slice(1) : segments
    hash = segs[0] || ''
  } else if (lowerHost.endsWith('.8x.gg')) hash = host.slice(0, -'.8x.gg'.length)
  else if (!host.includes('.')) hash = host
  else hash = host.split('.')[0]
  if (!HASH_RE.test(hash)) throw new Error('Invalid remix source (could not resolve a hashKey): ' + token)
  return hash
}

function splitSourceToken(raw) {
  const eq = raw.indexOf('=')
  if (eq < 0) return { token: raw }
  const role = raw.slice(eq + 1).trim()
  if (ROLE_RE.test(role)) return { token: raw.slice(0, eq).trim(), role }
  return { token: raw }
}

function parseArgs(argv) {
  const out = { sources: [], dir: undefined, title: undefined, summary: undefined, category: undefined, license: undefined, cloneAll: false, dryRun: false, yes: false, help: false }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--help' || arg === '-h') out.help = true
    else if (arg === '--dry-run') out.dryRun = true
    else if (arg === '--clone-all') out.cloneAll = true
    else if (arg === '--yes' || arg === '-y') out.yes = true
    else if (arg === '--dir') out.dir = argv[++i]
    else if (arg.startsWith('--dir=')) out.dir = arg.slice('--dir='.length)
    else if (arg === '--title') out.title = argv[++i]
    else if (arg.startsWith('--title=')) out.title = arg.slice('--title='.length)
    else if (arg === '--summary') out.summary = argv[++i]
    else if (arg.startsWith('--summary=')) out.summary = arg.slice('--summary='.length)
    else if (arg === '--category') out.category = argv[++i]
    else if (arg.startsWith('--category=')) out.category = arg.slice('--category='.length)
    else if (arg === '--license') out.license = argv[++i]
    else if (arg.startsWith('--license=')) out.license = arg.slice('--license='.length)
    else if (arg === '--role') {
      const role = argv[++i]
      if (role && out.sources.length > 0) out.sources[out.sources.length - 1].role = role
    } else if (arg.startsWith('-')) throw new Error('Unknown /remix argument: ' + arg)
    else {
      const { token, role } = splitSourceToken(arg)
      out.sources.push({ raw: arg, hashKey: normalizeToken(token), role })
    }
  }
  return out
}

async function readJsonResponse(res, label) {
  const text = await res.text()
  let json
  try {
    json = JSON.parse(text)
  } catch {
    throw new Error(label + ' returned non-JSON ' + res.status + ': ' + text.slice(0, 300))
  }
  if (!res.ok || json.success === false) {
    throw new Error(label + ' ' + res.status + ': ' + (json.error || json.message || json.reason || text.slice(0, 300)))
  }
  return json
}

async function apiGet(pathname, token) {
  const res = await fetch(API_BASE + pathname, {
    headers: token ? { Authorization: 'Bearer ' + token } : {},
  })
  return await readJsonResponse(res, pathname)
}

async function apiPost(pathname, token, body) {
  const res = await fetch(API_BASE + pathname, {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + token,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body || {}),
  })
  return await readJsonResponse(res, pathname)
}

async function fetchAppDetail(token, hash) {
  const json = await apiGet('/square/apps/' + encodeURIComponent(hash), token)
  const data = json.data || json.app || json
  if (!data || !data.hashKey) throw new Error('App not found or not listed: ' + hash)
  return data
}

async function remixApp(token, hash) {
  const json = await apiPost('/square/apps/' + encodeURIComponent(hash) + '/remix', token, {})
  const data = json.data || json
  if (!data || !data.workspaceHashKey) throw new Error('Remix response missing workspaceHashKey for ' + hash)
  return data
}

async function downloadWorkspaceZip(token, workspaceHashKey) {
  const res = await fetch(API_BASE + '/v2/workspace/' + encodeURIComponent(workspaceHashKey) + '/export/zip', {
    headers: { Authorization: 'Bearer ' + token },
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error('Workspace export ' + res.status + ': ' + text.slice(0, 300))
  }
  const buf = Buffer.from(await res.arrayBuffer())
  if (buf.length === 0) throw new Error('Workspace export returned an empty archive for ' + workspaceHashKey)
  return buf
}

// ── 8x.gg MCP (secondary sources) ───────────────────────────────────────────
// The MCP server is stateless Streamable HTTP: one POST per JSON-RPC call, the
// reply is either a JSON body or a one-event SSE stream. Same Bearer token as
// the REST API. Only list_app_files / read_app_file are used here — they read
// a listed app's source without creating a workspace or paying anything.

let mcpRequestId = 0

function parseMcpBody(text, contentType) {
  if (/text\/event-stream/i.test(contentType || '')) {
    // Streamable HTTP wraps the JSON-RPC response as `event: message` +
    // `data: {...}`; take the last data payload that carries a result/error.
    let last
    for (const line of text.split(/\r?\n/)) {
      if (!line.startsWith('data:')) continue
      try {
        const msg = JSON.parse(line.slice(5).trim())
        if (msg && (msg.result !== undefined || msg.error !== undefined)) last = msg
      } catch { /* keep scanning */ }
    }
    if (!last) throw new Error('MCP stream carried no JSON-RPC response')
    return last
  }
  try {
    return JSON.parse(text)
  } catch {
    throw new Error('MCP returned non-JSON: ' + text.slice(0, 300))
  }
}

async function mcpCall(token, name, args) {
  const id = ++mcpRequestId
  const res = await fetch(API_BASE + MCP_PATH, {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + token,
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
    },
    body: JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args || {} } }),
  })
  const text = await res.text()
  if (!res.ok) throw new Error('MCP ' + name + ' HTTP ' + res.status + ': ' + text.slice(0, 300))
  const msg = parseMcpBody(text, res.headers.get('content-type'))
  if (msg.error) throw new Error('MCP ' + name + ': ' + (msg.error.message || JSON.stringify(msg.error)))
  const result = msg.result || {}
  const first = Array.isArray(result.content) ? result.content.find(c => c && c.type === 'text') : undefined
  let payload = {}
  if (first && typeof first.text === 'string') {
    try { payload = JSON.parse(first.text) } catch { payload = { raw: first.text } }
  }
  if (result.isError) throw new Error('MCP ' + name + ': ' + (payload.error || first?.text || 'tool error'))
  return payload
}

// read_app_file decodes every file as UTF-8, so binaries come back mangled.
// Skip by extension and report them; the primary source (zip export) is the
// path that carries assets intact.
function isBinaryPath(p) {
  return BINARY_EXT_RE.test(p)
}

// Fetch a listed app's text sources through the MCP server into destDir.
// Returns what was written and what was deliberately left out.
async function fetchSourceViaMcp(token, hash, destDir) {
  const listing = await mcpCall(token, 'list_app_files', { hashKey: hash })
  const files = Array.isArray(listing.files) ? listing.files : []
  mkdirSync(destDir, { recursive: true })
  const fetched = []
  const skipped = []
  for (const f of files) {
    const rel = String(f.path || '')
    if (!rel || rel.startsWith('/') || rel.split('/').includes('..')) continue
    const size = Number(f.size || 0)
    if (isBinaryPath(rel)) { skipped.push({ path: rel, size, reason: 'binary' }); continue }
    if (size > MCP_MAX_READ_BYTES) { skipped.push({ path: rel, size, reason: 'over-256kb' }); continue }
    const file = await mcpCall(token, 'read_app_file', { hashKey: hash, path: rel, maxBytes: MCP_MAX_READ_BYTES })
    if (file.truncated) { skipped.push({ path: rel, size, reason: 'truncated' }); continue }
    const out = path.join(destDir, rel)
    mkdirSync(path.dirname(out), { recursive: true })
    writeFileSync(out, String(file.content ?? ''), 'utf8')
    fetched.push(rel)
  }
  const note = {
    hashKey: hash,
    fetchedVia: 'mcp',
    fetchedAt: new Date().toISOString(),
    fileCount: fetched.length,
    skipped,
    note: skipped.length
      ? 'Text sources only. The files listed in `skipped` were not downloaded (binary or too large). ' +
        'If the remix needs them as-is, re-run with --clone-all (credits this source twice) or recreate them.'
      : 'Text sources only; nothing was skipped.',
  }
  writeFileSync(path.join(destDir, FETCH_NOTE_FILE), JSON.stringify(note, null, 2) + '\n', 'utf8')
  return { fetched, skipped, entrypoint: listing.entrypoint || null }
}

// Hand the /remix clone workspace to paean-publish so it publishes INTO that
// workspace instead of creating a fresh one. The backend already recorded
// this workspace as a remix of the primary, so the publish-time declaration
// dedupes against it instead of counting the parent again.
function savePublishState(targetDir, workspaceHashKey, primaryHashKey) {
  const dir = path.join(targetDir, CLIDE_STATE_DIR)
  const file = path.join(dir, CLIDE_STATE_FILE)
  let existing = {}
  if (existsSync(file)) {
    try { existing = JSON.parse(readFileSync(file, 'utf8')) } catch { existing = {} }
  }
  if (typeof existing.workspaceHashKey === 'string' && existing.workspaceHashKey) {
    // A project that was already published (or already remixed) keeps its
    // workspace — silently swapping it would orphan a listing.
    return { file: path.join(CLIDE_STATE_DIR, CLIDE_STATE_FILE), workspaceHashKey: existing.workspaceHashKey, reused: true }
  }
  mkdirSync(dir, { recursive: true })
  const state = {
    ...existing,
    workspaceHashKey,
    workspaceOrigin: 'remix',
    remixOfHashKey: primaryHashKey,
    remixedAt: new Date().toISOString(),
  }
  writeFileSync(file, JSON.stringify(state, null, 2) + '\n', 'utf8')
  return { file: path.join(CLIDE_STATE_DIR, CLIDE_STATE_FILE), workspaceHashKey, reused: false }
}

async function run(command, args, opts = {}) {
  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: opts.cwd, stdio: 'pipe' })
    let stderr = ''
    child.stderr.on('data', c => { stderr += c.toString() })
    child.on('error', reject)
    child.on('close', code => {
      if (code === 0) resolve()
      else reject(new Error(command + ' exited with code ' + code + (stderr ? ': ' + stderr.trim() : '')))
    })
  })
}

async function extractZip(zipBuffer, destDir) {
  mkdirSync(destDir, { recursive: true })
  const tmp = mkdtempSync(path.join(tmpdir(), 'remix-src-'))
  const zipPath = path.join(tmp, 'source.zip')
  try {
    writeFileSync(zipPath, zipBuffer)
    try {
      await run('unzip', ['-o', '-q', zipPath, '-d', destDir])
    } catch (err) {
      throw new Error('Failed to extract source archive (need the "unzip" command on PATH): ' + (err && err.message ? err.message : String(err)))
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
}

function countFiles(dir) {
  let n = 0
  function walk(d) {
    for (const entry of readdirSync(d)) {
      const full = path.join(d, entry)
      const st = statSync(full)
      if (st.isDirectory()) walk(full)
      else if (st.isFile()) n++
    }
  }
  if (existsSync(dir)) walk(dir)
  return n
}

function slugify(text) {
  return String(text || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48)
}

function deriveTitle(args, parents) {
  if (args.title && args.title.trim()) return args.title.trim()
  const names = parents.map(p => p.title).filter(Boolean)
  if (names.length > 0) return names.join(' x ').slice(0, 80)
  return 'Remix of ' + parents.map(p => p.hashKey).join(', ')
}

function deriveTargetDir(projectRoot, args, title, parents) {
  if (args.dir) return path.resolve(projectRoot, args.dir)
  const slug = slugify(title) || ('remix-' + parents.map(p => p.hashKey.slice(0, 6)).join('-'))
  return path.resolve(projectRoot, slug || 'remixed-game')
}

function licenseBody(spdx, year, holder) {
  const id = String(spdx || 'MIT').trim()
  const who = String(holder || '').trim() || 'the author'
  if (id === 'MIT') {
    return 'MIT License\n\nCopyright (c) ' + year + ' ' + who + '\n\n' +
      'Permission is hereby granted, free of charge, to any person obtaining a copy\n' +
      'of this software and associated documentation files (the "Software"), to deal\n' +
      'in the Software without restriction, including without limitation the rights\n' +
      'to use, copy, modify, merge, publish, distribute, sublicense, and/or sell\n' +
      'copies of the Software, and to permit persons to whom the Software is\n' +
      'furnished to do so, subject to the following conditions:\n\n' +
      'The above copyright notice and this permission notice shall be included in all\n' +
      'copies or substantial portions of the Software.\n\n' +
      'THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR\n' +
      'IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,\n' +
      'FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE\n' +
      'AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER\n' +
      'LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,\n' +
      'OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE\n' +
      'SOFTWARE.\n'
  }
  if (id === 'CC0-1.0') {
    return 'This work is dedicated to the public domain under CC0 1.0 Universal.\n\nCopyright (c) ' + year + ' ' + who + '\n\nSee https://creativecommons.org/publicdomain/zero/1.0/ for the full text.\n'
  }
  if (id === 'UNLICENSED') {
    return 'Copyright (c) ' + year + ' ' + who + '\n\nAll rights reserved. Proprietary; do not copy, modify, or distribute without permission.\n'
  }
  return id + ' License\n\nCopyright (c) ' + year + ' ' + who + '\n\nThis work is licensed under the ' + id + ' license.\nFull text: https://spdx.org/licenses/' + encodeURIComponent(id) + '.html\n'
}

function clideIgnoreText() {
  return [
    '# .clideignore - files and folders excluded from Clide publish.',
    '# Gitignore-style: one pattern per line, # for comments.',
    '# Raw upstream sources are kept locally for remixing but never published.',
    '',
    ...SAFETY_PATTERNS,
    '',
  ].join('\n')
}

// A remix of a PAID parent is paid too (the server enforces it: publishing a
// free remix of a paid app is rejected, and an undeclared one inherits the
// parent's price). Write the inherited declaration into clide.json so the
// publisher sees it and can raise the price deliberately; a lower one is also
// theirs to choose, within the platform's spend limits.
function inheritedAccess(parents) {
  const paid = parents.find(p => p.access && p.access.model === 'paid' && p.access.price && p.access.price.amount > 0)
  if (!paid) return undefined
  return {
    model: 'paid',
    price: { amount: paid.access.price.amount, currency: 'credits' },
    standalone: paid.access.standalone === 'shell' ? 'shell' : 'demo',
    inheritedFrom: paid.hashKey,
  }
}

function buildManifest(args, parents, license) {
  const remixedAt = new Date().toISOString()
  const access = inheritedAccess(parents)
  return {
    schemaVersion: SCHEMA_VERSION,
    title: deriveTitle(args, parents),
    summary: (args.summary || '').trim() || undefined,
    category: (args.category || '').trim() || undefined,
    tags: [],
    license,
    ...(access ? { access } : {}),
    remix: {
      // Tree-compatible primary upstream (mirrors backend remixOfHashKey).
      parent: parents[0] ? parents[0].hashKey : undefined,
      // Graph form: every direct upstream + the aspect it contributes + a
      // suggested revenue weight. Adjacency list of the remix DAG.
      parents: parents.map(p => ({
        hashKey: p.hashKey,
        role: p.role || '',
        weight: 1,
        title: p.title || undefined,
        playUrl: p.playUrl || undefined,
        category: p.category || undefined,
        author: p.author || undefined,
      })),
      remixedAt,
    },
  }
}

// How each source will be fetched, and when its creator gets credited.
function planSources(args, parents) {
  return parents.map((p, i) => {
    const clone = i === 0 || args.cloneAll
    return {
      hashKey: p.hashKey,
      role: p.role,
      title: p.title,
      category: p.category,
      playUrl: p.playUrl,
      author: p.author,
      fetch: clone ? 'remix-clone' : 'mcp-read',
      credit: i === 0
        ? 'now (/remix); publish reuses the clone workspace, no second count'
        : clone
          ? 'now (/remix) AND again at publish — --clone-all double-credits this source'
          : 'once, at publish (clide.json remixOfHashKeys); text files only',
    }
  })
}

function confirmRemix(args, parents, targetDir) {
  if (args.yes) return Promise.resolve()
  if (!process.stdin.isTTY) {
    return Promise.reject(new Error('Remix clones the primary source into your workspace (crediting its creator) and records remix lineage for every source. Re-run with --yes to confirm.'))
  }
  console.log('')
  console.log('Remix confirmation')
  console.log('Sources (' + parents.length + '):')
  for (const p of planSources(args, parents)) console.log('  - ' + p.hashKey + (p.role ? ' [' + p.role + ']' : '') + (p.title ? ' — ' + p.title : '') + '  (' + p.fetch + '; credited ' + p.credit + ')')
  console.log('Target: ' + targetDir)
  console.log('This records remix lineage for each source (credits the upstream creators).')
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  return new Promise((resolve, reject) => {
    rl.question('Type "remix" to continue: ', answer => {
      rl.close()
      if (String(answer).trim().toLowerCase() === 'remix') resolve()
      else reject(new Error('Remix cancelled.'))
    })
  })
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help || args.sources.length === 0) {
    console.log(usage())
    if (args.sources.length === 0 && !args.help) process.exitCode = 1
    return
  }
  // Dedupe sources by hashKey while keeping the first role seen.
  const seen = new Map()
  for (const s of args.sources) {
    if (!seen.has(s.hashKey)) seen.set(s.hashKey, s)
    else if (!seen.get(s.hashKey).role && s.role) seen.get(s.hashKey).role = s.role
  }
  const sources = [...seen.values()]

  const projectRoot = process.cwd()
  const token = getPaeanToken()
  if (!token) throw new Error('Paean credentials not found. Set the PAEAN_AUTH_TOKEN environment variable to your Paean JWT (or place it in ~/.paean/credentials.json as {"token":"..."}). See the skill README for how to obtain one.')

  // Resolve metadata for every source up front (also validates remixability).
  const parents = []
  for (const s of sources) {
    const app = await fetchAppDetail(token, s.hashKey)
    if (app.remixable === false) {
      // A paid app the caller has not bought: remix is part of the purchase.
      // Say where to buy it instead of the bare reason code.
      if (app.remixDisabledReason === 'not_owned') {
        const price = app.access && app.access.price ? app.access.price.amount + ' credits' : 'its listed price'
        const shell = app.publishedSiteHandle ? 'https://' + app.publishedSiteHandle + '.8x.gg/' : 'https://8x.gg/apps/' + app.hashKey
        throw new Error('Source ' + s.hashKey + ' is a PAID app (' + price + '). Buy it first at ' + shell + ' — the purchase unlocks both the full app and remixing it. Remixes of a paid app are published as paid apps too.')
      }
      throw new Error('Source ' + s.hashKey + ' is not remixable' + (app.remixDisabledReason ? ': ' + (app.remixDisabledMessage || app.remixDisabledReason) : '.'))
    }
    parents.push({
      hashKey: app.hashKey,
      // The parent's access model, so a paid parent's price is inherited into
      // the child's clide.json (see inheritedAccess).
      access: app.access && typeof app.access === 'object' ? app.access : undefined,
      role: s.role || '',
      title: app.title || '',
      summary: app.summary || '',
      category: app.category || '',
      tags: Array.isArray(app.tags) ? app.tags : [],
      playUrl: app.playUrl || '',
      author: app.authorName || '',
    })
  }

  const title = deriveTitle(args, parents)
  const targetDir = deriveTargetDir(projectRoot, args, title, parents)
  const license = (args.license || 'MIT').trim()

  if (args.dryRun) {
    console.log(JSON.stringify({
      success: true,
      action: 'dry-run',
      targetDir: path.relative(projectRoot, targetDir) || '.',
      title,
      license,
      sources: planSources(args, parents),
      writesLocalFiles: false,
    }, null, 2))
    return
  }

  // Guard: don't clobber a non-empty target unless it's the cwd the user chose.
  if (existsSync(targetDir) && statSync(targetDir).isDirectory()) {
    const entries = readdirSync(targetDir).filter(e => e !== REMIX_SOURCES_DIR && e !== MANIFEST_FILE && e !== '.git')
    if (entries.length > 0 && targetDir !== projectRoot && !args.dir) {
      throw new Error('Target directory already exists and is not empty: ' + targetDir + '. Pass --dir <dir> to choose another.')
    }
  }

  await confirmRemix(args, parents, targetDir)

  const sourcesDir = path.join(targetDir, REMIX_SOURCES_DIR)
  mkdirSync(sourcesDir, { recursive: true })

  const downloaded = []
  let publishState
  for (let i = 0; i < parents.length; i++) {
    const p = parents[i]
    const dest = path.join(sourcesDir, p.hashKey)
    const label = p.hashKey + (p.role ? ' [' + p.role + ']' : '')
    if (i === 0 || args.cloneAll) {
      console.log((i === 0 ? 'Remixing primary ' : 'Cloning ') + label + '...')
      const remix = await remixApp(token, p.hashKey)
      console.log('  cloned to workspace ' + remix.workspaceHashKey + ' (' + (remix.fileCount || '?') + ' files); downloading source...')
      const zip = await downloadWorkspaceZip(token, remix.workspaceHashKey)
      await extractZip(zip, dest)
      const fileCount = countFiles(dest)
      downloaded.push({ hashKey: p.hashKey, role: p.role, fetchedVia: 'remix-clone', workspaceHashKey: remix.workspaceHashKey, dir: path.relative(targetDir, dest), fileCount })
      console.log('  extracted ' + fileCount + ' files into ' + path.relative(projectRoot, dest))
      if (i === 0) {
        publishState = savePublishState(targetDir, remix.workspaceHashKey, p.hashKey)
        console.log(publishState.reused
          ? '  kept existing publish workspace ' + publishState.workspaceHashKey + ' in ' + publishState.file
          : '  saved workspace to ' + publishState.file + ' so paean-publish reuses it')
      } else {
        console.log('  note: --clone-all left workspace ' + remix.workspaceHashKey + ' in your account; this source is credited again at publish')
      }
    } else {
      console.log('Reading ' + label + ' via 8x.gg MCP (text sources, credited at publish)...')
      const got = await fetchSourceViaMcp(token, p.hashKey, dest)
      downloaded.push({ hashKey: p.hashKey, role: p.role, fetchedVia: 'mcp-read', dir: path.relative(targetDir, dest), fileCount: got.fetched.length, skipped: got.skipped })
      console.log('  wrote ' + got.fetched.length + ' text files into ' + path.relative(projectRoot, dest) +
        (got.skipped.length ? '; skipped ' + got.skipped.length + ' (see ' + FETCH_NOTE_FILE + ')' : ''))
    }
  }

  // Scaffold project metadata. clide.json is authoritative for /publish.
  const manifest = buildManifest(args, parents, license)
  const manifestPath = path.join(targetDir, MANIFEST_FILE)
  if (!existsSync(manifestPath)) {
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8')
  }
  const licensePath = path.join(targetDir, LICENSE_FILE)
  if (!existsSync(licensePath)) {
    writeFileSync(licensePath, licenseBody(license, new Date().getFullYear(), process.env.PAEAN_AUTHOR || ''), 'utf8')
  }
  const ignorePath = path.join(targetDir, '.clideignore')
  if (!existsSync(ignorePath)) {
    writeFileSync(ignorePath, clideIgnoreText(), 'utf8')
  }

  console.log(JSON.stringify({
    success: true,
    action: 'remix',
    targetDir: path.relative(projectRoot, targetDir) || '.',
    title,
    license,
    manifest: MANIFEST_FILE,
    sourcesDir: path.relative(targetDir, sourcesDir),
    sources: downloaded,
    publishWorkspace: publishState ? { workspaceHashKey: publishState.workspaceHashKey, stateFile: publishState.file, reusedExisting: publishState.reused } : undefined,
    remixGraph: manifest.remix,
    nextSteps: 'Build the new game in ' + (path.relative(projectRoot, targetDir) || '.') + ' using the sources under ' + REMIX_SOURCES_DIR + '/ (secondary sources are text-only; see each ' + FETCH_NOTE_FILE + '), then publish with paean-publish from that directory — it reuses the saved workspace and declares every parent in clide.json.',
  }, null, 2))
}

main().catch(err => {
  console.error(err instanceof Error ? err.message : String(err))
  process.exitCode = 1
})
