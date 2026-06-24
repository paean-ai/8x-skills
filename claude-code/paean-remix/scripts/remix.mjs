#!/usr/bin/env node
// remix-helper.mjs — download the source of one or more published Paean Apps
// Square sites by hash and scaffold a new project that remixes them.
//
// Flow per source: GET /square/apps/:hash (metadata) → POST /square/apps/:hash/remix
// (server-side clone into the caller's workspace, credits the upstream creator)
// → GET /v2/workspace/:ws/export/zip (download source) → extract into
// <target>/.remix-sources/<hash>/. Then write clide.json (remix graph),
// LICENSE, and .clideignore so the new game is ready to build + /publish.
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync, readdirSync, statSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import path from 'node:path'
import readline from 'node:readline'

const API_BASE = normalizeApiBase(process.env.PAEAN_API_BASE || process.env.ZERO_API_BASE || process.env.ZERO_CLI_BASE_URL || 'https://api.paean.ai')
const REMIX_SOURCES_DIR = '.remix-sources'
const MANIFEST_FILE = 'clide.json'
const LICENSE_FILE = 'LICENSE'
const SCHEMA_VERSION = 1
const HASH_RE = /^[A-Za-z0-9_-]{3,64}$/
const ROLE_RE = /^[A-Za-z][A-Za-z0-9 _-]{0,40}$/

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
    '                        [--role <aspect>] [--dry-run] [--yes]',
    '',
    'Each <source> is a published Square app reference: a bare hashKey, hash.8x.gg,',
    'hash.clide.app, https://hash.clide.app/, https://8x.gg/hash, or hash=role to tag',
    "the aspect you want from it (e.g. h1=gameplay h2=art h3=theme).",
    '',
    'Downloads each source\'s project files into <target>/' + REMIX_SOURCES_DIR + '/<hash>/ and writes',
    'a clide.json remix graph, LICENSE, and .clideignore. --dry-run resolves metadata only.',
  ].join('\n')
}

function normalizeApiBase(raw) {
  let base = String(raw || '').replace(/\/+$/, '')
  if (base.endsWith('/zero')) base = base.slice(0, -'/zero'.length)
  return base || 'https://api.paean.ai'
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
    const segs = (segments[0] || '').toLowerCase() === 'pub' ? segments.slice(1) : segments
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
  const out = { sources: [], dir: undefined, title: undefined, summary: undefined, category: undefined, license: undefined, dryRun: false, yes: false, help: false }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--help' || arg === '-h') out.help = true
    else if (arg === '--dry-run') out.dryRun = true
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

function buildManifest(args, parents, license) {
  const remixedAt = new Date().toISOString()
  return {
    schemaVersion: SCHEMA_VERSION,
    title: deriveTitle(args, parents),
    summary: (args.summary || '').trim() || undefined,
    category: (args.category || '').trim() || undefined,
    tags: [],
    license,
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

function confirmRemix(args, parents, targetDir) {
  if (args.yes) return Promise.resolve()
  if (!process.stdin.isTTY) {
    return Promise.reject(new Error('Remix downloads upstream sources and records remix lineage (crediting each upstream creator). Re-run with --yes to confirm.'))
  }
  console.log('')
  console.log('Remix confirmation')
  console.log('Sources (' + parents.length + '):')
  for (const p of parents) console.log('  - ' + p.hashKey + (p.role ? ' [' + p.role + ']' : '') + (p.title ? ' — ' + p.title : ''))
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
      throw new Error('Source ' + s.hashKey + ' is not remixable' + (app.remixDisabledReason ? ': ' + app.remixDisabledReason : '.'))
    }
    parents.push({
      hashKey: app.hashKey,
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
      sources: parents.map(p => ({ hashKey: p.hashKey, role: p.role, title: p.title, category: p.category, playUrl: p.playUrl, author: p.author })),
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
  for (const p of parents) {
    console.log('Remixing ' + p.hashKey + (p.role ? ' [' + p.role + ']' : '') + '...')
    const remix = await remixApp(token, p.hashKey)
    console.log('  cloned to workspace ' + remix.workspaceHashKey + ' (' + (remix.fileCount || '?') + ' files); downloading source...')
    const zip = await downloadWorkspaceZip(token, remix.workspaceHashKey)
    const dest = path.join(sourcesDir, p.hashKey)
    await extractZip(zip, dest)
    const fileCount = countFiles(dest)
    downloaded.push({ hashKey: p.hashKey, role: p.role, workspaceHashKey: remix.workspaceHashKey, dir: path.relative(targetDir, dest), fileCount })
    console.log('  extracted ' + fileCount + ' files into ' + path.relative(projectRoot, dest))
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
    remixGraph: manifest.remix,
    nextSteps: 'Build the new game in ' + (path.relative(projectRoot, targetDir) || '.') + ' using the downloaded sources under ' + REMIX_SOURCES_DIR + '/, then run /publish from that directory.',
  }, null, 2))
}

main().catch(err => {
  console.error(err instanceof Error ? err.message : String(err))
  process.exitCode = 1
})
