#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync, readdirSync, statSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import path from 'node:path'
import readline from 'node:readline'

const CLIDE_IGNORE_FILE = '.clideignore'
const CLIDE_STATE_DIR = '.clide'
const CLIDE_STATE_FILE = 'publish.json'
const MANIFEST_FILE = 'clide.json'
const LICENSE_FILE = 'LICENSE'
const API_BASE = resolveApiBase()
const DIRECT_ZIP_UPLOAD_MAX_BYTES = Number(process.env.PAEAN_WORKSPACE_DIRECT_UPLOAD_MAX_BYTES || 25 * 1024 * 1024)
const PUBLISH_DIR_CANDIDATES = ['dist', 'build', 'out', '.output/public', 'public']
const SAFETY_PATTERNS = [
  '.clide/',
  '.remix-sources/',
  'clide.json',
  '.env',
  '.env.*',
  '*.pem',
  '*.key',
  '*.p12',
  '*.pfx',
  'id_rsa*',
  '.npmrc',
  '.aws/',
  '.gcloud/',
  'service-account*.json',
  'secrets/',
  'private/',
  'node_modules/',
  '.git/',
  '.next/cache/',
  'dist/*.map',
  '.vscode/',
  '.idea/',
  'coverage/',
  '*.log',
  '.DS_Store',
  'Thumbs.db',
  '*.tmp',
]

// Only checks that a value was actually supplied. The subdomain's format, the
// minimum length, and the reserved-name list all live in zero-api
// (publish.service.ts `validateHandle`) and are enforced there for every
// publish surface. Re-implementing them here would silently drift and start
// rejecting handles the server would happily accept, so we send the string as
// typed and let the 400 come back — explainHandleFailure surfaces its reason.
function requireHandleValue(raw) {
  const handle = String(raw || '').trim()
  if (!handle) throw new Error('--handle needs a value, e.g. --handle neon-drift-racer')
  return handle
}

function usage() {
  return [
    'Usage: publish-helper.mjs [--dry-run] [--yes] [--hosting-only] [--allow-secrets]',
    '                          [--allow-static-only] [--dir <publish-dir>]',
    '                          [--title <title>] [--summary <text>] [--category <category>] [--tag <tag>]',
    '                          [--handle <subdomain>]',
    '       publish-helper.mjs --delete [--handle <owned-handle>]',
    '',
    'Publishes a static frontend directory with top-level index.html to *.clide.app.',
    'Default mode also creates a Paean workspace and public Apps Square listing.',
    '--hosting-only uploads directly to Clide hosting without creating a workspace or Square listing.',
    '--dry-run validates and prints the publish directory, archive summary, and safety scan without API calls or local state writes.',
    '--yes skips the interactive public-site confirmation.',
    '--allow-secrets bypasses the high-confidence secret scanner.',
    '--allow-static-only acknowledges that detected Worker/server bindings will not be deployed.',
    '--handle picks the *.clide.app subdomain; the server validates it (roughly 9-32 chars,',
    '  lowercase a-z 0-9 and dashes, some names reserved) and is the authority.',
    '  Claiming a subdomain requires a paid Paean subscription and costs more credits than an',
    '  auto-assigned one. Omit it to keep the app\'s current subdomain, or to get a random one',
    '  on first publish. Free accounts must omit it.',
    '--delete removes an owned deployment. For saved Square projects it first unlists the',
    '  Square app, then deletes the Clide site; for hosting-only projects it deletes only the site.',
  ].join('\n')
}

function parseArgs(argv) {
  const out = { delete: false, dryRun: false, hostingOnly: false, allowSecrets: false, allowStaticOnly: false, yes: false, help: false, dir: undefined, handle: undefined, title: undefined, summary: undefined, category: undefined, license: undefined, tags: [] }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--help' || arg === '-h') out.help = true
    else if (arg === '--dry-run') out.dryRun = true
    else if (arg === '--hosting-only' || arg === '--no-square') out.hostingOnly = true
    else if (arg === '--allow-secrets') out.allowSecrets = true
    else if (arg === '--allow-static-only') out.allowStaticOnly = true
    else if (arg === '--yes' || arg === '-y') out.yes = true
    else if (arg === '--delete' || arg === '--unpublish') out.delete = true
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
    else if (arg === '--tag') {
      const tag = argv[++i]
      if (tag) out.tags.push(tag)
    } else if (arg.startsWith('--tag=')) out.tags.push(arg.slice('--tag='.length))
    // `?? ''` (not undefined) so a bare trailing `--handle` is a hard error in
    // normalizeHandle rather than silently publishing under a random subdomain.
    else if (arg === '--handle') out.handle = argv[++i] ?? ''
    else if (arg.startsWith('--handle=')) out.handle = arg.slice('--handle='.length)
    else if (out.delete && !out.handle && !arg.startsWith('-')) out.handle = arg
    else throw new Error('Unknown /publish argument: ' + arg)
  }
  // On publish, --handle picks the *.clide.app subdomain (subscriber-only,
  // enforced server-side). On --delete it names the owned handle to remove, and
  // is passed through verbatim so older non-conforming handles stay deletable.
  if (!out.delete && out.handle !== undefined) out.handle = requireHandleValue(out.handle)
  if (out.delete && out.dir) throw new Error('--dir is only valid when publishing, not deleting.')
  if (out.delete && out.dryRun) throw new Error('--dry-run is only valid when publishing, not deleting.')
  if (out.delete && out.hostingOnly) throw new Error('--hosting-only is only valid when publishing, not deleting.')
  if (out.delete && out.allowSecrets) throw new Error('--allow-secrets is only valid when publishing, not deleting.')
  if (out.delete && out.allowStaticOnly) throw new Error('--allow-static-only is only valid when publishing, not deleting.')
  if (out.delete && out.yes) throw new Error('--yes is only valid when publishing, not deleting.')
  if (out.delete && (out.title || out.summary || out.category || out.license || out.tags.length > 0)) throw new Error('metadata options are only valid when publishing, not deleting.')
  return out
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

function normalizePattern(pattern) {
  let out = String(pattern || '').trim()
  while (out.endsWith('/')) out = out.slice(0, -1)
  return out
}

function parseIgnore(text) {
  const patterns = []
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const p = normalizePattern(line)
    if (p) patterns.push(p)
  }
  return patterns
}

function readClideIgnore(projectRoot) {
  const file = path.join(projectRoot, CLIDE_IGNORE_FILE)
  if (!existsSync(file)) return null
  return readFileSync(file, 'utf8')
}

function clideIgnoreTextWithSafety(existingText) {
  let text = existingText == null
    ? [
        '# .clideignore - files and folders excluded from Clide publish.',
        '# Gitignore-style: one pattern per line, # for comments.',
        '# The .clideignore file itself is never published.',
        '',
      ].join('\n')
    : existingText
  const current = new Set(parseIgnore(text).map(normalizePattern))
  const missing = SAFETY_PATTERNS.filter(p => !current.has(normalizePattern(p)))
  if (missing.length === 0) return { text, changed: false }
  if (text.length > 0 && !text.endsWith('\n')) text += '\n'
  if (!text.includes('# Added by Clide publish safety defaults')) {
    if (!text.endsWith('\n\n')) text += '\n'
    text += '# Added by Clide publish safety defaults\n'
  }
  for (const p of missing) text += p + '\n'
  return { text, changed: true }
}

function getClideIgnorePatterns(projectRoot, write) {
  const existingText = readClideIgnore(projectRoot)
  const result = clideIgnoreTextWithSafety(existingText)
  if (write && result.changed) {
    writeFileSync(path.join(projectRoot, CLIDE_IGNORE_FILE), result.text, 'utf8')
  }
  return parseIgnore(result.text)
}

function wildcardRegex(pattern) {
  let out = ''
  for (const ch of pattern) {
    if (ch === '*') out += '[^/]*'
    else if ('\\^$+?.()|{}[]'.includes(ch)) out += '\\' + ch
    else out += ch
  }
  return new RegExp('^' + out + '$')
}

function patternMatches(pattern, rel) {
  const p = normalizePattern(pattern).replace(/^\/+/, '')
  const r = rel.replace(/\\/g, '/').replace(/^\/+/, '')
  if (!p || !r) return false
  const re = wildcardRegex(p)
  if (p.includes('/')) {
    return re.test(r) || r.startsWith(p + '/') || wildcardRegex(p + '/*').test(r)
  }
  const parts = r.split('/')
  return parts.some(part => re.test(part)) || r === p || r.startsWith(p + '/')
}

function isIgnored(relProject, relPublish, patterns) {
  if (relPublish === CLIDE_IGNORE_FILE) return true
  if (relProject === CLIDE_IGNORE_FILE) return true
  if (relProject === CLIDE_STATE_DIR || relProject.startsWith(CLIDE_STATE_DIR + '/')) return true
  for (const pattern of patterns) {
    if (patternMatches(pattern, relProject) || patternMatches(pattern, relPublish)) return true
  }
  return false
}

function hasTopLevelIndex(dir) {
  return existsSync(path.join(dir, 'index.html')) && statSync(path.join(dir, 'index.html')).isFile()
}

function packageManager(projectRoot) {
  if (existsSync(path.join(projectRoot, 'bun.lockb')) || existsSync(path.join(projectRoot, 'bun.lock'))) return ['bun', ['run', 'build']]
  if (existsSync(path.join(projectRoot, 'pnpm-lock.yaml'))) return ['pnpm', ['run', 'build']]
  if (existsSync(path.join(projectRoot, 'yarn.lock'))) return ['yarn', ['build']]
  return ['npm', ['run', 'build']]
}

function readPackageJson(projectRoot) {
  const pkgFile = path.join(projectRoot, 'package.json')
  if (!existsSync(pkgFile)) return null
  try {
    return JSON.parse(readFileSync(pkgFile, 'utf8'))
  } catch {
    return null
  }
}

function hasBuildScript(projectRoot) {
  const pkg = readPackageJson(projectRoot)
  return !!(pkg && pkg.scripts && pkg.scripts.build)
}

async function run(command, args, opts = {}) {
  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: opts.cwd,
      stdio: opts.input == null ? 'inherit' : ['pipe', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    if (opts.input != null) {
      child.stdout.on('data', chunk => { stdout += chunk.toString() })
      child.stderr.on('data', chunk => { stderr += chunk.toString() })
      child.stdin.end(opts.input)
    }
    child.on('error', reject)
    child.on('close', code => {
      if (code === 0) resolve({ stdout, stderr })
      else reject(new Error(command + ' exited with code ' + code + (stderr ? ': ' + stderr.trim() : '')))
    })
  })
}

function detectPublishDir(projectRoot, explicitDir) {
  if (explicitDir) {
    const dir = path.resolve(projectRoot, explicitDir)
    if (!existsSync(dir) || !statSync(dir).isDirectory()) throw new Error('Publish directory does not exist: ' + explicitDir)
    if (!hasTopLevelIndex(dir)) throw new Error('Publish directory must contain a top-level index.html: ' + explicitDir)
    return dir
  }

  for (const candidate of PUBLISH_DIR_CANDIDATES) {
    const dir = path.join(projectRoot, candidate)
    if (existsSync(dir) && statSync(dir).isDirectory() && hasTopLevelIndex(dir)) return dir
  }
  if (hasTopLevelIndex(projectRoot)) return projectRoot
  return null
}

function detectServerRuntime(projectRoot) {
  const configNames = ['wrangler.jsonc', 'wrangler.json', 'wrangler.toml']
  const featurePatterns = [
    ['Worker entrypoint', /(?:\"main\"\s*:|^\s*main\s*=)/m],
    ['D1 binding', /(?:\"d1_databases\"\s*:|^\s*\[\[d1_databases\]\])/m],
    ['R2 binding', /(?:\"r2_buckets\"\s*:|^\s*\[\[r2_buckets\]\])/m],
    ['KV binding', /(?:\"kv_namespaces\"\s*:|^\s*\[\[kv_namespaces\]\])/m],
    ['Durable Object binding', /(?:\"durable_objects\"\s*:|^\s*\[durable_objects\])/m],
    ['Service binding', /(?:\"services\"\s*:|^\s*\[\[services\]\])/m],
  ]
  for (const name of configNames) {
    const file = path.join(projectRoot, name)
    if (!existsSync(file)) continue
    let source = ''
    try { source = readFileSync(file, 'utf8') } catch {}
    const features = featurePatterns.filter(([, pattern]) => pattern.test(source)).map(([label]) => label)
    if (features.length > 0) return { configFile: name, features }
  }
  return null
}

function runtimeCompatibility(runtime, allowStaticOnly) {
  if (!runtime) return { status: 'static-compatible', detected: null }
  return {
    status: allowStaticOnly ? 'static-only-acknowledged' : 'blocked',
    detected: runtime,
    reason: 'Clide static hosting uploads browser assets only; it does not deploy Worker code or provision D1/R2/KV/Durable Object/service bindings.',
    requiredFlag: allowStaticOnly ? null : '--allow-static-only',
  }
}

async function resolvePublishDir(projectRoot, explicitDir) {
  let dir = detectPublishDir(projectRoot, explicitDir)
  if (dir) return dir
  if (!explicitDir && hasBuildScript(projectRoot)) {
    const [cmd, args] = packageManager(projectRoot)
    console.log('No publishable output found. Running ' + cmd + ' ' + args.join(' ') + '...')
    await run(cmd, args, { cwd: projectRoot })
    dir = detectPublishDir(projectRoot, undefined)
    if (dir) return dir
  }
  throw new Error('No publishable static directory found. Expected top-level index.html in dist, build, out, .output/public, public, or project root. For built apps, publish the built output directory, not source.')
}

function relativeUnix(from, to) {
  return path.relative(from, to).split(path.sep).join('/')
}

function collectFiles(projectRoot, publishDir, patterns) {
  const files = []
  function walk(dir) {
    for (const entry of readdirSync(dir)) {
      const full = path.join(dir, entry)
      const st = statSync(full)
      const relPublish = relativeUnix(publishDir, full)
      const relProject = relativeUnix(projectRoot, full)
      if (relPublish.includes('\n')) throw new Error('Cannot publish files with newline in path: ' + relPublish)
      if (isIgnored(relProject, relPublish, patterns)) continue
      if (st.isDirectory()) walk(full)
      else if (st.isFile()) files.push(relPublish)
    }
  }
  walk(publishDir)
  files.sort()
  return files
}

const SECRET_PATTERNS = [
  ['private key', /-----BEGIN (?:RSA |DSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/],
  ['AWS access key', /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/],
  ['AWS secret access key assignment', /\bAWS_SECRET_ACCESS_KEY\s*=\s*['"]?[A-Za-z0-9/+=]{32,}/],
  ['GitHub token', /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]{36,}\b/],
  ['npm token', /\bnpm_[A-Za-z0-9]{30,}\b/],
  ['Slack token', /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/],
  ['OpenAI-style API key', /\bsk-(?:proj-|svcacct-|admin-)?[A-Za-z0-9_-]{32,}\b/],
]

const TEXT_FILE_RE = /\.(html?|css|js|mjs|cjs|json|xml|txt|md|svg|map|webmanifest|wasm\.map)$/i
const MAX_SECRET_SCAN_BYTES = 1024 * 1024

function scanSecrets(publishDir, files) {
  const findings = []
  for (const rel of files) {
    const full = path.join(publishDir, rel)
    const st = statSync(full)
    if (st.size > MAX_SECRET_SCAN_BYTES) continue
    if (!TEXT_FILE_RE.test(rel) && !['index.html', 'robots.txt'].includes(rel)) continue
    let text
    try {
      text = readFileSync(full, 'utf8')
    } catch {
      continue
    }
    for (const [name, pattern] of SECRET_PATTERNS) {
      if (pattern.test(text)) {
        findings.push({ file: rel, kind: name })
        break
      }
    }
  }
  return findings
}

function readJpegDimensions(file) {
  let buf
  try {
    buf = readFileSync(file)
  } catch {
    return null
  }
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null
  let offset = 2
  while (offset + 9 < buf.length) {
    if (buf[offset] !== 0xff) {
      offset += 1
      continue
    }
    const marker = buf[offset + 1]
    offset += 2
    if (marker === 0xd8 || marker === 0xd9) continue
    if (offset + 2 > buf.length) return null
    const length = buf.readUInt16BE(offset)
    if (length < 2 || offset + length > buf.length) return null
    if (
      (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf)
    ) {
      if (length < 7) return null
      return {
        width: buf.readUInt16BE(offset + 5),
        height: buf.readUInt16BE(offset + 3),
      }
    }
    offset += length
  }
  return null
}

function assetWarnings(publishDir, files, squareListing = true) {
  const warnings = []
  if (!files.includes('favicon.svg')) {
    warnings.push('Missing top-level favicon.svg. Publishing is allowed, but generate one before listing if possible.')
  }
  if (!squareListing) return warnings
  if (!files.includes('banner.jpg')) {
    warnings.push('Missing top-level banner.jpg. Publishing is allowed, but Paean game templates expect an 800x400 banner.jpg.')
  } else {
    const dims = readJpegDimensions(path.join(publishDir, 'banner.jpg'))
    if (!dims) {
      warnings.push('Could not verify banner.jpg dimensions. Expected 800x400.')
    } else if (dims.width !== 800 || dims.height !== 400) {
      warnings.push('banner.jpg is ' + dims.width + 'x' + dims.height + '; expected 800x400.')
    }
  }
  return warnings
}

function archiveSummary(publishDir, files) {
  let totalBytes = 0
  const largest = []
  const extensions = new Map()
  for (const rel of files) {
    const st = statSync(path.join(publishDir, rel))
    totalBytes += st.size
    largest.push({ file: rel, bytes: st.size })
    const ext = path.extname(rel).toLowerCase() || '(none)'
    extensions.set(ext, (extensions.get(ext) || 0) + 1)
  }
  largest.sort((a, b) => b.bytes - a.bytes)
  return {
    fileCount: files.length,
    totalBytes,
    largestFiles: largest.slice(0, 10),
    extensions: Object.fromEntries([...extensions.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))),
    sampleFiles: files.slice(0, 30),
  }
}

async function zipFiles(publishDir, files) {
  const tmp = mkdtempSync(path.join(tmpdir(), 'clide-publish-'))
  const zipPath = path.join(tmp, 'site.zip')
  try {
    await run('zip', ['-q', '-X', '-9', zipPath, '-@'], {
      cwd: publishDir,
      input: files.join('\n') + '\n',
    })
    const data = readFileSync(zipPath)
    return { data, cleanup: () => rmSync(tmp, { recursive: true, force: true }) }
  } catch (err) {
    rmSync(tmp, { recursive: true, force: true })
    throw err
  }
}

function loadState(projectRoot) {
  const file = path.join(projectRoot, CLIDE_STATE_DIR, CLIDE_STATE_FILE)
  if (!existsSync(file)) return {}
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return {}
  }
}

function saveState(projectRoot, input) {
  const dir = path.join(projectRoot, CLIDE_STATE_DIR)
  mkdirSync(dir, { recursive: true })
  const state = {
    mode: input.mode,
    handle: input.handle,
    workspaceHashKey: input.workspaceHashKey,
    squareAppHashKey: input.squareAppHashKey,
    url: input.url,
    playUrl: input.url,
    archiveUrl: input.archiveUrl,
    publishedAt: new Date().toISOString(),
    publishDir: relativeUnix(projectRoot, input.publishDir) || '.',
    fileCount: input.fileCount,
    totalBytes: input.totalBytes,
    title: input.title,
    category: input.category,
    remix: input.remix,
  }
  writeFileSync(path.join(dir, CLIDE_STATE_FILE), JSON.stringify(state, null, 2) + '\n', 'utf8')
}

function markStateUnpublished(projectRoot, { handle, squareAppHashKey, siteDeleted }) {
  const file = path.join(projectRoot, CLIDE_STATE_DIR, CLIDE_STATE_FILE)
  if (!existsSync(file)) return
  const state = loadState(projectRoot)
  if (!state || typeof state !== 'object') return
  const now = new Date().toISOString()
  if (squareAppHashKey && state.squareAppHashKey === squareAppHashKey) {
    state.status = 'unlisted'
    state.squareUnlistedAt = now
  }
  if (siteDeleted && handle && (state.handle === handle || state.lastDeletedHandle === handle)) {
    state.deletedAt = now
    state.siteDeletedAt = now
    state.lastDeletedHandle = handle
    if (typeof state.url === 'string' && state.url) state.lastDeletedUrl = state.url
    delete state.handle
    delete state.url
    delete state.playUrl
    delete state.archiveUrl
  }
  writeFileSync(file, JSON.stringify(state, null, 2) + '\n', 'utf8')
}

function readManifest(projectRoot) {
  const file = path.join(projectRoot, MANIFEST_FILE)
  if (!existsSync(file)) return null
  try {
    const data = JSON.parse(readFileSync(file, 'utf8'))
    return data && typeof data === 'object' ? data : null
  } catch {
    return null
  }
}

const BOILERPLATE_TITLE_RE = /^(document|untitled|index|home|page|app|vite\s*\+?\s*\w*|react\s*app|my\s*app)$/i

function extractHtmlTitle(html) {
  const m = String(html || '').match(/<title[^>]*>([\s\S]*?)<\/title>/i)
  if (!m) return ''
  const title = m[1].replace(/\s+/g, ' ').trim()
  if (!title || BOILERPLATE_TITLE_RE.test(title)) return ''
  return title
}

function titleFromIndexHtml(publishDir) {
  try {
    return extractHtmlTitle(readFileSync(path.join(publishDir, 'index.html'), 'utf8'))
  } catch {
    return ''
  }
}

// Prefer a meaningful, human-chosen name over the directory name. The model is
// also told (in the skill prompt) to pass --title derived from theme/gameplay;
// "directory-name" as the source is a signal the title should be improved.
function resolveTitle(projectRoot, publishDir, args) {
  if (args.title && args.title.trim()) return { title: args.title.trim(), source: 'flag' }
  const manifest = readManifest(projectRoot)
  if (manifest && typeof manifest.title === 'string' && manifest.title.trim()) return { title: manifest.title.trim(), source: MANIFEST_FILE }
  const pkg = readPackageJson(projectRoot)
  if (pkg && typeof pkg.name === 'string' && pkg.name.trim()) return { title: pkg.name.trim().replace(/^@[^/]+\//, ''), source: 'package.json' }
  const htmlTitle = titleFromIndexHtml(publishDir)
  if (htmlTitle) return { title: htmlTitle, source: 'index.html' }
  return { title: path.basename(projectRoot), source: 'directory-name' }
}

function resolveSummary(projectRoot, args) {
  if (args.summary !== undefined) return String(args.summary)
  const manifest = readManifest(projectRoot)
  if (manifest && typeof manifest.summary === 'string') return manifest.summary
  const pkg = readPackageJson(projectRoot)
  return typeof (pkg && pkg.description) === 'string' ? pkg.description : ''
}

function resolveCategory(projectRoot, args) {
  if (args.category && args.category.trim()) return args.category.trim()
  const manifest = readManifest(projectRoot)
  if (manifest && typeof manifest.category === 'string' && manifest.category.trim()) return manifest.category.trim()
  return 'custom'
}

function resolveTags(projectRoot, args) {
  const fromArgs = normalizedTags(args.tags)
  if (fromArgs.length) return fromArgs
  const manifest = readManifest(projectRoot)
  if (manifest && Array.isArray(manifest.tags)) return normalizedTags(manifest.tags)
  return []
}

function resolveLicense(projectRoot, args) {
  if (args.license && args.license.trim()) return args.license.trim()
  const manifest = readManifest(projectRoot)
  if (manifest && typeof manifest.license === 'string' && manifest.license.trim()) return manifest.license.trim()
  return 'MIT'
}

// Resolve the remix lineage recorded by /remix into the shape the API consumes
// (remixOfHashKey = primary parent) plus the full graph for forward-compat.
function resolveRemix(projectRoot) {
  const manifest = readManifest(projectRoot)
  if (!manifest || !manifest.remix || typeof manifest.remix !== 'object') return null
  const r = manifest.remix
  const parents = Array.isArray(r.parents)
    ? r.parents.filter(p => p && typeof p.hashKey === 'string' && p.hashKey)
    : []
  const parent = (typeof r.parent === 'string' && r.parent) || (parents[0] && parents[0].hashKey) || undefined
  if (!parent && parents.length === 0) return null
  return { parent, parents, info: r }
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

// Ensure clide.json + LICENSE exist so every published project carries complete
// metadata. .clideignore is ensured separately via getClideIgnorePatterns.
function ensureProjectFiles(projectRoot, metadata, license, remix) {
  const written = []
  const manifestPath = path.join(projectRoot, MANIFEST_FILE)
  const existing = readManifest(projectRoot) || {}
  const merged = {
    schemaVersion: typeof existing.schemaVersion === 'number' ? existing.schemaVersion : 1,
    title: existing.title || metadata.title,
    summary: existing.summary !== undefined ? existing.summary : (metadata.summary || undefined),
    category: existing.category || metadata.category,
    tags: Array.isArray(existing.tags) && existing.tags.length ? existing.tags : metadata.tags,
    license: existing.license || license,
  }
  if (existing.remix) merged.remix = existing.remix
  else if (remix && remix.info) merged.remix = remix.info
  const nextText = JSON.stringify(merged, null, 2) + '\n'
  let prevText = ''
  try { prevText = readFileSync(manifestPath, 'utf8') } catch {}
  if (prevText !== nextText) {
    writeFileSync(manifestPath, nextText, 'utf8')
    written.push(MANIFEST_FILE)
  }
  const licensePath = path.join(projectRoot, LICENSE_FILE)
  if (!existsSync(licensePath)) {
    writeFileSync(licensePath, licenseBody(license, new Date().getFullYear(), process.env.PAEAN_AUTHOR || ''), 'utf8')
    written.push(LICENSE_FILE)
  }
  return written
}

function normalizedTags(tags) {
  const out = []
  for (const raw of tags) {
    for (const part of String(raw).split(',')) {
      const t = part.trim().toLowerCase()
      if (t && !out.includes(t)) out.push(t)
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

async function apiJson(pathname, token, body) {
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

async function createWorkspace(token, metadata) {
  const json = await apiJson('/v2/workspace', token, {
    title: metadata.title,
    description: metadata.summary,
    goal: 'Published via the Paean publish skill.',
    tags: metadata.tags,
  })
  if (!json.workspace || !json.workspace.hashKey) throw new Error('Workspace API response missing workspace.hashKey')
  return json.workspace.hashKey
}

async function importZipDirect(token, workspaceHashKey, zipData) {
  const form = new FormData()
  form.append('archive', new Blob([zipData], { type: 'application/zip' }), 'project.zip')
  const res = await fetch(API_BASE + '/v2/workspace/' + encodeURIComponent(workspaceHashKey) + '/files/zip', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token },
    body: form,
  })
  return await readJsonResponse(res, '/v2/workspace/:hashKey/files/zip')
}

async function importZipViaPresign(token, workspaceHashKey, zipData) {
  const pre = await apiJson('/v2/workspace/' + encodeURIComponent(workspaceHashKey) + '/files/zip/presign', token, {})
  if (!pre.uploadUrl || !pre.stagingKey) throw new Error('Presign response missing uploadUrl or stagingKey')
  const put = await fetch(pre.uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/zip' },
    body: zipData,
  })
  if (!put.ok) {
    const text = await put.text().catch(() => '')
    throw new Error('Signed zip upload ' + put.status + ': ' + text.slice(0, 300))
  }
  return await apiJson('/v2/workspace/' + encodeURIComponent(workspaceHashKey) + '/files/zip/commit', token, {
    stagingKey: pre.stagingKey,
  })
}

async function importZip(token, workspaceHashKey, zipData) {
  if (zipData.length > DIRECT_ZIP_UPLOAD_MAX_BYTES) {
    return await importZipViaPresign(token, workspaceHashKey, zipData)
  }
  return await importZipDirect(token, workspaceHashKey, zipData)
}

async function publishSquare(token, workspaceHashKey, metadata, remix, handle) {
  const body = {
    workspaceHashKey,
    title: metadata.title,
    summary: metadata.summary,
    category: metadata.category,
    tags: metadata.tags,
    pathPrefix: '',
    indexFile: 'index.html',
    visibility: 'public',
  }
  // Omitted entirely when not requested, so the server keeps the app's current
  // subdomain (or assigns a random one on first publish).
  if (handle) body.handle = handle
  if (remix && remix.parent) {
    // Primary upstream for legacy columns/provenance.
    body.remixOfHashKey = remix.parent
    // Full declared parent set. The backend dedupes this with remixOfHashKey
    // and records SquareRemixEdge rows for the multi-parent DAG.
    body.remixOfHashKeys = remix.parents.map(p => p.hashKey).filter(Boolean)
  }
  let json
  try {
    json = await apiJson('/square/publish', token, body)
  } catch (err) {
    throw handle ? explainHandleFailure(err, handle) : err
  }
  if (!json.data || !json.data.playUrl || !json.data.hashKey) throw new Error('Square publish response missing data.playUrl or data.hashKey')
  return json.data
}

async function publishHostingOnly(token, zipData, handle) {
  const form = new FormData()
  form.append('archive', new Blob([zipData], { type: 'application/zip' }), 'site.zip')
  if (handle) form.append('handle', handle)
  let json
  try {
    const res = await fetch(API_BASE + '/publish/clide', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token },
      body: form,
    })
    json = await readJsonResponse(res, '/publish/clide')
  } catch (err) {
    throw handle ? explainHandleFailure(err, handle) : err
  }
  const data = json.data || json
  if (!data.handle || !data.url) throw new Error('Clide hosting response missing data.handle or data.url')
  return data
}

// The subdomain rejections are the ones a caller can actually act on, so turn
// the raw status line into a concrete next step. Anything else passes through.
function explainHandleFailure(err, handle) {
  const message = err instanceof Error ? err.message : String(err)
  if (/\b402\b/.test(message)) {
    return new Error(
      'Choosing the subdomain "' + handle + '" requires an active Paean subscription (free accounts get an auto-assigned one).\n' +
      'Either upgrade at https://one.paean.ai, or re-run without --handle to publish under an assigned subdomain.\n' +
      'Server said: ' + message,
    )
  }
  if (/\b409\b/.test(message)) {
    return new Error(
      'The subdomain "' + handle + '" is already taken by another account. Pick a different --handle.\n' +
      'Server said: ' + message,
    )
  }
  if (/\b400\b/.test(message)) {
    // The server states the actual reason (too short, bad characters, reserved
    // name); quote it rather than guessing which rule was hit.
    return new Error(
      'The subdomain "' + handle + '" was rejected. Pick a different --handle.\n' +
      'Server said: ' + message,
    )
  }
  return err
}

async function unlistSquareApp(hashKey, token) {
  const res = await fetch(API_BASE + '/square/apps/' + encodeURIComponent(hashKey), {
    method: 'DELETE',
    headers: { Authorization: 'Bearer ' + token },
  })
  return await readJsonResponse(res, '/square/apps/:hashKey')
}

async function findSquareAppByHandle(handle, token) {
  const res = await fetch(API_BASE + '/square/apps/by-handle/' + encodeURIComponent(handle), {
    method: 'GET',
    headers: { Authorization: 'Bearer ' + token },
  })
  if (res.status === 404) {
    await res.text()
    return null
  }
  const json = await readJsonResponse(res, '/square/apps/by-handle/:handle')
  const app = json.data || json.app || json
  if (!app || typeof app.hashKey !== 'string' || !app.hashKey) {
    throw new Error('/square/apps/by-handle/:handle response missing data.hashKey')
  }
  return app
}

async function unpublishHandle(handle, token, allowMissing = false) {
  const res = await fetch(API_BASE + '/publish/' + encodeURIComponent(handle), {
    method: 'DELETE',
    headers: { Authorization: 'Bearer ' + token },
  })
  if (allowMissing && res.status === 404) {
    await res.text()
    return { handle, deletedObjects: 0, alreadyDeleted: true }
  }
  return await readJsonResponse(res, '/publish/:handle')
}

async function confirmPublicPublish(args, summary, publishDir, projectRoot, metadata, effectiveHandle) {
  if (args.yes) return
  if (!process.stdin.isTTY) {
    throw new Error('Public hosting requires confirmation. Re-run with --yes after confirming the public *.clide.app site' + (args.hostingOnly ? ' (no Square listing).' : ' and Apps Square listing.'))
  }
  console.log('')
  console.log(args.hostingOnly ? 'Public Clide hosting confirmation (no Square listing)' : 'Public Apps Square publish confirmation')
  console.log('This will upload ' + summary.fileCount + ' files (' + summary.totalBytes + ' bytes) from ' + (relativeUnix(projectRoot, publishDir) || '.') + '.')
  if (effectiveHandle) {
    console.log('The site will be reachable at https://' + effectiveHandle + '.clide.app/' + (args.hostingOnly ? ' and will not be listed in Apps Square.' : ' and listed publicly in Paean Apps Square.'))
    if (args.handle) console.log('Claiming that subdomain needs an active paid Paean subscription and costs 30 credits (vs 5 for an assigned one).')
    else if (args.hostingOnly) console.log('Reusing the hosting handle saved in .clide/publish.json.')
    if (!args.hostingOnly) console.log('If the app is already live on a different subdomain, that old URL stops working.')
  } else if (args.hostingOnly) {
    console.log('The site will receive an assigned *.clide.app URL and will not be listed in Apps Square.')
  } else {
    console.log('The app will be listed publicly in Paean Apps Square and reachable at a *.clide.app URL.')
  }
  console.log('Title: ' + metadata.title)
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  const answer = await new Promise(resolve => rl.question('Type "publish" to continue: ', resolve))
  rl.close()
  if (String(answer).trim().toLowerCase() !== 'publish') throw new Error('Publish cancelled.')
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    console.log(usage())
    return
  }
  const projectRoot = process.cwd()

  if (args.delete) {
    const token = getPaeanToken()
    if (!token) throw new Error('Paean credentials not found. Set the PAEAN_AUTH_TOKEN environment variable to your Paean JWT (or place it in ~/.paean/credentials.json as {"token":"..."}). See the skill README for how to obtain one.')
    const state = loadState(projectRoot)
    const savedHandle = (typeof state.handle === 'string' && state.handle) ||
      (typeof state.lastDeletedHandle === 'string' && state.lastDeletedHandle) || undefined
    const handle = args.handle || savedHandle

    if (state.mode === 'square' && args.handle && savedHandle && args.handle !== savedHandle) {
      throw new Error('--handle ' + args.handle + ' does not match the Square project\'s saved handle ' + savedHandle + '. Refusing to unlist one app while deleting another site.')
    }
    const savedSquareAppHashKey = typeof state.squareAppHashKey === 'string' && state.squareAppHashKey
      ? state.squareAppHashKey
      : undefined
    let linkedApp
    if (handle) {
      console.log('Checking whether ' + handle + '.clide.app belongs to a Square listing...')
      linkedApp = await findSquareAppByHandle(handle, token)
    }
    if (savedSquareAppHashKey && linkedApp && linkedApp.hashKey !== savedSquareAppHashKey) {
      throw new Error('Saved squareAppHashKey ' + savedSquareAppHashKey + ' does not match the app currently linked to ' + handle + '.clide.app (' + linkedApp.hashKey + '). Refusing to delete either target.')
    }
    const squareAppHashKey = savedSquareAppHashKey || (linkedApp && linkedApp.hashKey) || undefined
    if (state.mode === 'square' && !squareAppHashKey) {
      throw new Error('Saved publish state says mode "square" but has no squareAppHashKey. Refusing to delete the hosted site because that could leave a listed Square app pointing to a missing page. Unlist the app through DELETE /square/apps/:hashKey after resolving its hashKey.')
    }
    if (squareAppHashKey) {
      console.log('Unlisting Square app ' + squareAppHashKey + ' before deleting its hosted site...')
      await unlistSquareApp(squareAppHashKey, token)
      markStateUnpublished(projectRoot, { handle, squareAppHashKey, siteDeleted: false })

      let hosted = { handle, deletedObjects: 0, alreadyDeleted: false }
      if (handle) {
        console.log('Deleting Clide hosting for ' + handle + '.clide.app...')
        try {
          // A 404 is success here: older publish.mjs versions could already
          // delete the site while leaving the Square row listed.
          hosted = await unpublishHandle(handle, token, true)
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err)
          throw new Error('Square app ' + squareAppHashKey + ' was unlisted safely, but deleting ' + handle + '.clide.app failed. The gallery no longer points at a broken site; retry --delete to finish hosting cleanup. Server said: ' + message)
        }
        markStateUnpublished(projectRoot, { handle, squareAppHashKey, siteDeleted: true })
      }
      console.log(JSON.stringify({
        success: true,
        action: 'delete',
        mode: 'square',
        squareAppHashKey,
        unlistedFromSquare: true,
        handle: hosted.handle || handle || null,
        siteDeleted: !!handle,
        siteAlreadyDeleted: !!hosted.alreadyDeleted,
        deletedObjects: hosted.deletedObjects || 0,
        stateFile: path.join(CLIDE_STATE_DIR, CLIDE_STATE_FILE),
      }, null, 2))
      return
    }

    if (!handle) throw new Error('No direct-hosting handle specified and no saved .clide/publish.json handle found.')
    console.log('Deleting direct Clide hosting for ' + handle + '.clide.app...')
    const result = await unpublishHandle(handle, token)
    markStateUnpublished(projectRoot, { handle, siteDeleted: true })
    console.log(JSON.stringify({
      success: true,
      action: 'delete',
      mode: 'hosting-only',
      unlistedFromSquare: false,
      handle: result.handle || handle,
      siteDeleted: true,
      siteAlreadyDeleted: false,
      deletedObjects: result.deletedObjects,
      stateFile: path.join(CLIDE_STATE_DIR, CLIDE_STATE_FILE),
    }, null, 2))
    return
  }

  const publishDir = await resolvePublishDir(projectRoot, args.dir)
  const previousState = loadState(projectRoot)
  const previousHostingHandle = previousState.mode === 'hosting-only' && typeof previousState.handle === 'string'
    ? previousState.handle
    : undefined
  if (args.hostingOnly && previousHostingHandle && args.handle && args.handle !== previousHostingHandle) {
    throw new Error('This project is already hosted at ' + previousHostingHandle + '.clide.app. Refusing to create a second site implicitly; rename or delete the existing deployment explicitly first.')
  }
  const effectiveHandle = args.hostingOnly ? (args.handle || previousHostingHandle) : args.handle
  const serverRuntime = detectServerRuntime(projectRoot)
  const compatibility = runtimeCompatibility(serverRuntime, args.allowStaticOnly)
  const patterns = getClideIgnorePatterns(projectRoot, !args.dryRun)
  const files = collectFiles(projectRoot, publishDir, patterns)
  if (!files.includes('index.html')) throw new Error('Publish archive must include top-level index.html after .clideignore filtering.')
  if (files.length === 0) throw new Error('Publish archive would contain no files.')

  const resolvedTitle = resolveTitle(projectRoot, publishDir, args)
  const metadata = {
    title: resolvedTitle.title,
    summary: resolveSummary(projectRoot, args),
    category: resolveCategory(projectRoot, args),
    tags: resolveTags(projectRoot, args),
  }
  const license = resolveLicense(projectRoot, args)
  const remix = resolveRemix(projectRoot)
  const titleWarning = resolvedTitle.source === 'directory-name'
    ? 'Title fell back to the directory name. Pass --title with a name that reflects the game theme/gameplay.'
    : undefined
  const summary = archiveSummary(publishDir, files)
  const secretFindings = scanSecrets(publishDir, files)
  const mediaWarnings = assetWarnings(publishDir, files, !args.hostingOnly)
  if (secretFindings.length > 0 && !args.allowSecrets) {
    throw new Error('Publish blocked: possible secrets found in included files:\n' + secretFindings.slice(0, 10).map(f => '  - ' + f.file + ' (' + f.kind + ')').join('\n') + (secretFindings.length > 10 ? '\n  ...and ' + (secretFindings.length - 10) + ' more' : '') + '\nAdd patterns to .clideignore or rerun with --allow-secrets if this is intentional.')
  }

  if (args.dryRun) {
    console.log(JSON.stringify({
      success: true,
      action: 'dry-run',
      publishDir: relativeUnix(projectRoot, publishDir) || '.',
      mode: args.hostingOnly ? 'hosting-only' : 'square',
      destination: args.hostingOnly ? 'Clide hosting only (*.clide.app; no Apps Square listing)' : 'Paean Apps Square public listing + *.clide.app',
      ignoredBy: CLIDE_IGNORE_FILE,
      writesLocalState: false,
      // null = let the server keep the current subdomain or assign a random
      // one. A value here is a subscriber-only claim, verified on publish.
      requestedHandle: args.handle || null,
      effectiveHandle: effectiveHandle || null,
      effectiveHandleSource: args.handle ? 'flag' : previousHostingHandle ? 'saved-state' : 'server-assigned',
      requestedUrl: effectiveHandle ? 'https://' + effectiveHandle + '.clide.app/' : null,
      runtimeCompatibility: compatibility,
      metadata,
      license,
      titleSource: resolvedTitle.source,
      titleWarning,
      assetWarnings: mediaWarnings,
      remix: remix ? { parent: remix.parent, parents: remix.parents } : null,
      secretScan: {
        status: secretFindings.length > 0 ? 'allowed-by-flag' : 'passed',
        findings: secretFindings,
      },
      ...summary,
    }, null, 2))
    return
  }

  if (compatibility.status === 'blocked') {
    throw new Error('Publish blocked: ' + compatibility.reason + ' Detected ' + compatibility.detected.configFile + ' (' + compatibility.detected.features.join(', ') + '). Use the project\'s Worker deployment workflow, or pass --allow-static-only only after the user accepts that backend/API features will not work.')
  }

  await confirmPublicPublish(args, summary, publishDir, projectRoot, metadata, effectiveHandle)
  if (mediaWarnings.length > 0) {
    console.warn('Asset warnings:')
    for (const warning of mediaWarnings) console.warn('  - ' + warning)
  }
  const token = getPaeanToken()
  if (!token) throw new Error('Paean credentials not found. Set the PAEAN_AUTH_TOKEN environment variable to your Paean JWT (or place it in ~/.paean/credentials.json as {"token":"..."}). See the skill README for how to obtain one.')
  const ensuredFiles = args.hostingOnly ? [] : ensureProjectFiles(projectRoot, metadata, license, remix)
  if (ensuredFiles.length > 0) console.log('Wrote project metadata: ' + ensuredFiles.join(', '))
  const zip = await zipFiles(publishDir, files)
  try {
    if (args.hostingOnly) {
      console.log('Uploading ' + files.length + ' files from ' + (relativeUnix(projectRoot, publishDir) || '.') + ' to Clide hosting only...')
      const hosted = await publishHostingOnly(token, zip.data, effectiveHandle)
      saveState(projectRoot, {
        mode: 'hosting-only',
        handle: hosted.handle,
        url: hosted.url,
        archiveUrl: hosted.archiveUrl,
        publishDir,
        fileCount: hosted.fileCount || summary.fileCount,
        totalBytes: hosted.totalBytes || summary.totalBytes,
        title: metadata.title,
        category: metadata.category,
      })
      console.log(JSON.stringify({
        success: true,
        action: 'publish',
        mode: 'hosting-only',
        listedInSquare: false,
        handle: hosted.handle,
        requestedHandle: args.handle || null,
        url: hosted.url,
        archiveUrl: hosted.archiveUrl || null,
        status: 'hosted',
        title: metadata.title,
        titleSource: resolvedTitle.source,
        titleWarning,
        assetWarnings: mediaWarnings,
        license,
        wroteProjectFiles: ensuredFiles,
        fileCount: hosted.fileCount || summary.fileCount,
        totalBytes: hosted.totalBytes || summary.totalBytes,
        stateFile: path.join(CLIDE_STATE_DIR, CLIDE_STATE_FILE),
      }, null, 2))
      return
    }
    const state = loadState(projectRoot)
    let workspaceHashKey = typeof state.workspaceHashKey === 'string' && state.workspaceHashKey ? state.workspaceHashKey : undefined
    if (!workspaceHashKey) {
      console.log('Creating Paean workspace...')
      workspaceHashKey = await createWorkspace(token, metadata)
    } else {
      console.log('Reusing Paean workspace ' + workspaceHashKey + '...')
    }
    console.log('Uploading ' + files.length + ' files from ' + (relativeUnix(projectRoot, publishDir) || '.') + ' to workspace...')
    const imported = await importZip(token, workspaceHashKey, zip.data)
    console.log('Publishing public Square listing...')
    const app = await publishSquare(token, workspaceHashKey, metadata, remix, args.handle)
    saveState(projectRoot, {
      mode: 'square',
      handle: app.publishedSiteHandle,
      workspaceHashKey,
      squareAppHashKey: app.hashKey,
      url: app.playUrl,
      publishDir,
      fileCount: imported.fileCount || summary.fileCount,
      totalBytes: imported.totalBytes || summary.totalBytes,
      title: metadata.title,
      category: metadata.category,
      remix: remix ? { parent: remix.parent, parents: remix.parents } : undefined,
    })
    console.log(JSON.stringify({
      success: true,
      action: 'publish',
      workspaceHashKey,
      squareAppHashKey: app.hashKey,
      url: app.playUrl,
      handle: app.publishedSiteHandle || null,
      requestedHandle: args.handle || null,
      status: app.status || 'listed',
      title: metadata.title,
      titleSource: resolvedTitle.source,
      titleWarning,
      assetWarnings: mediaWarnings,
      license,
      remix: remix ? {
        parent: remix.parent,
        parents: remix.parents,
        api: {
          remixOfHashKey: remix.parent,
          remixOfHashKeys: remix.parents.map(p => p.hashKey).filter(Boolean),
        },
      } : null,
      wroteProjectFiles: ensuredFiles,
      fileCount: imported.fileCount || summary.fileCount,
      totalBytes: imported.totalBytes || summary.totalBytes,
      stateFile: path.join(CLIDE_STATE_DIR, CLIDE_STATE_FILE),
    }, null, 2))
  } finally {
    zip.cleanup()
  }
}

main().catch(err => {
  console.error(err instanceof Error ? err.message : String(err))
  process.exitCode = 1
})
