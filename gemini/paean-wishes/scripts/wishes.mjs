#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const WISH_CREDIT_COST = 10

function normalizeApiBase(raw) {
  return String(raw || '').trim().replace(/\/+$/, '')
}

function hostOf(base) {
  try {
    return new URL(base).hostname
  } catch {
    return String(base).split('/')[0] || ''
  }
}

export function resolveApiBase() {
  const paeanHost = /(^|\.)paean\.ai$/i
  for (const raw of [process.env.PAEAN_API_BASE, process.env.ZERO_API_BASE, process.env.ZERO_CLI_BASE_URL]) {
    if (!raw) continue
    if (raw === process.env.PAEAN_API_BASE || paeanHost.test(hostOf(raw))) {
      return normalizeApiBase(raw)
    }
  }
  return 'https://api.paean.ai'
}

function credentialFiles() {
  const files = []
  if (process.env.PAEAN_CREDENTIALS_FILE) files.push(process.env.PAEAN_CREDENTIALS_FILE)
  if (process.env.ZERO_CONFIG_DIR) files.push(path.join(process.env.ZERO_CONFIG_DIR, 'credentials.json'))
  files.push(path.join(homedir(), '.paean', 'credentials.json'))
  files.push(path.join(homedir(), '.zero', 'credentials.json'))
  return files
}

export function getPaeanToken() {
  if (process.env.PAEAN_AUTH_TOKEN || process.env.PAEAN_API_KEY) {
    return process.env.PAEAN_AUTH_TOKEN || process.env.PAEAN_API_KEY
  }
  for (const file of credentialFiles()) {
    if (!existsSync(file)) continue
    try {
      const parsed = JSON.parse(readFileSync(file, 'utf8'))
      if (parsed && (parsed.token || parsed.apiKey)) {
        return parsed.token || parsed.apiKey
      }
    } catch {
      // try next credential file
    }
  }
  return ''
}

export function parseWishRef(raw) {
  const trimmed = String(raw || '').trim()
  if (!trimmed) throw new Error('Wish hashKey or URL is required')
  if (/^https?:\/\//i.test(trimmed)) {
    const url = new URL(trimmed)
    const parts = url.pathname.split('/').filter(Boolean)
    const idx = parts.lastIndexOf('wishes')
    if (idx >= 0 && parts[idx + 1]) {
      return decodeURIComponent(parts[idx + 1])
    }
    throw new Error('Could not extract wish hashKey from URL: ' + trimmed)
  }
  if (trimmed.includes('/') || trimmed.includes('?')) {
    throw new Error('Invalid wish hashKey: ' + trimmed)
  }
  return trimmed
}

function usage() {
  return [
    'Usage:',
    '  wishes.mjs pull [--q <text>] [--category <cat>] [--status open|closed|all]',
    '                  [--unfulfilled | --fulfillment all|unfulfilled|fulfilled] [--open]',
    '                  [--sort newest|popular|unfulfilled] [--mine] [--fulfilled-by-me]',
    '                  [--page <n>] [--limit <n>] [--json]',
    '  wishes.mjs list|search [same filters as pull]',
    '  wishes.mjs get <hashKey|url> [--json]',
    '  wishes.mjs create --prompt <text> [--title <text>] [--category <cat>] [--tags <a,b>]',
    '                    [--image <https-url>]... [--client-request-id <id>] [--dry-run] [--json]',
    '  wishes.mjs prepare <hashKey|url> [--dir <project-dir>] [--note <text>] [--json]',
    '',
    'Notes:',
    '  - pull / list / search and get are public (no auth required unless --mine or --fulfilled-by-me is passed).',
    '  - pull/list defaults to --status open for community wish queries; pass --status all to include closed wishes.',
    '  - create consumes 10 Paean credits and does NOT start an automated agent build.',
    '  - prepare writes WISH.md and updates clide.json.wish so paean-publish links your work.',
  ].join('\n')
}

export function parseWishCliArgs(argv) {
  const args = [...argv]
  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    return { help: true, subcommand: 'help' }
  }
  const subcommand = args.shift()
  const out = {
    help: false,
    subcommand,
    target: undefined,
    q: undefined,
    category: undefined,
    status: undefined,
    fulfillment: undefined,
    sort: undefined,
    mine: false,
    fulfilledByMe: false,
    page: undefined,
    limit: undefined,
    prompt: undefined,
    title: undefined,
    tags: [],
    images: [],
    clientRequestId: undefined,
    dryRun: false,
    dir: '.',
    note: undefined,
    json: false,
  }

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === '--help' || arg === '-h') out.help = true
    else if (arg === '--json') out.json = true
    else if (arg === '--dry-run') out.dryRun = true
    else if (arg === '--mine') out.mine = true
    else if (arg === '--fulfilled-by-me') out.fulfilledByMe = true
    else if (arg === '--unfulfilled') {
      out.fulfillment = 'unfulfilled'
      if (!out.status) out.status = 'open'
    } else if (arg === '--open') out.status = 'open'
    else if (arg === '--q') out.q = args[++i] ?? ''
    else if (arg.startsWith('--q=')) out.q = arg.slice(4)
    else if (arg === '--category') out.category = args[++i] ?? ''
    else if (arg.startsWith('--category=')) out.category = arg.slice(11)
    else if (arg === '--status') out.status = args[++i] ?? ''
    else if (arg.startsWith('--status=')) out.status = arg.slice(9)
    else if (arg === '--fulfillment') out.fulfillment = args[++i] ?? ''
    else if (arg.startsWith('--fulfillment=')) out.fulfillment = arg.slice(14)
    else if (arg === '--sort') out.sort = args[++i] ?? ''
    else if (arg.startsWith('--sort=')) out.sort = arg.slice(7)
    else if (arg === '--page') out.page = Number(args[++i])
    else if (arg.startsWith('--page=')) out.page = Number(arg.slice(7))
    else if (arg === '--limit') out.limit = Number(args[++i])
    else if (arg.startsWith('--limit=')) out.limit = Number(arg.slice(8))
    else if (arg === '--prompt') out.prompt = args[++i] ?? ''
    else if (arg.startsWith('--prompt=')) out.prompt = arg.slice(9)
    else if (arg === '--title') out.title = args[++i] ?? ''
    else if (arg.startsWith('--title=')) out.title = arg.slice(8)
    else if (arg === '--tag' || arg === '--tags') {
      const raw = args[++i] ?? ''
      for (const p of raw.split(',')) {
        const clean = p.trim().toLowerCase()
        if (clean && !out.tags.includes(clean)) out.tags.push(clean)
      }
    } else if (arg.startsWith('--tag=') || arg.startsWith('--tags=')) {
      const raw = arg.slice(arg.indexOf('=') + 1)
      for (const p of raw.split(',')) {
        const clean = p.trim().toLowerCase()
        if (clean && !out.tags.includes(clean)) out.tags.push(clean)
      }
    } else if (arg === '--image') {
      const u = args[++i] ?? ''
      if (u.trim()) out.images.push(u.trim())
    } else if (arg.startsWith('--image=')) {
      const u = arg.slice(8).trim()
      if (u) out.images.push(u)
    } else if (arg === '--client-request-id') out.clientRequestId = args[++i] ?? ''
    else if (arg.startsWith('--client-request-id=')) out.clientRequestId = arg.slice(20)
    else if (arg === '--dir') out.dir = args[++i] ?? '.'
    else if (arg.startsWith('--dir=')) out.dir = arg.slice(6)
    else if (arg === '--note') out.note = args[++i] ?? ''
    else if (arg.startsWith('--note=')) out.note = arg.slice(7)
    else if (!arg.startsWith('-') && !out.target) out.target = arg
    else throw new Error('Unknown wishes argument: ' + arg)
  }

  return out
}

function hasEnvProxy() {
  return Boolean(
    process.env.HTTPS_PROXY ||
    process.env.https_proxy ||
    process.env.HTTP_PROXY ||
    process.env.http_proxy ||
    process.env.ALL_PROXY ||
    process.env.all_proxy,
  )
}

function curlQuote(value) {
  const str = String(value).replace(/[\r\n]/g, '')
  return '"' + str.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"'
}

function curlRequest(url, { method, headers, body }) {
  const cfgLines = [
    `url = ${curlQuote(url)}`,
    `request = ${curlQuote(method)}`,
  ]
  for (const [k, v] of Object.entries(headers || {})) {
    cfgLines.push(`header = ${curlQuote(`${k}: ${v}`)}`)
  }
  let bodyTempDir = null
  try {
    if (body !== undefined) {
      bodyTempDir = mkdtempSync(path.join(tmpdir(), 'paean-wish-curl-'))
      const bodyFile = path.join(bodyTempDir, 'body.json')
      writeFileSync(bodyFile, JSON.stringify(body), { encoding: 'utf8', mode: 0o600 })
      cfgLines.push(`data-binary = ${curlQuote('@' + bodyFile)}`)
    }
    const res = spawnSync('curl', ['-sS', '-w', '\n%{http_code}', '--config', '-'], {
      input: cfgLines.join('\n') + '\n',
      encoding: 'utf8',
      timeout: 20000,
    })
    if (res.error) throw res.error
    if (res.status !== 0) {
      throw new Error((res.stderr || '').trim() || `curl exited with status ${res.status}`)
    }
    const rawOut = res.stdout || ''
    const sep = rawOut.lastIndexOf('\n')
    const status = sep >= 0 ? Number(rawOut.slice(sep + 1).trim()) : 0
    const text = sep >= 0 ? rawOut.slice(0, sep) : rawOut
    if (!Number.isFinite(status) || status <= 0) {
      throw new Error(`curl returned invalid HTTP status: ${rawOut.slice(-80)}`)
    }
    return { ok: status >= 200 && status < 300, status, text }
  } finally {
    if (bodyTempDir) rmSync(bodyTempDir, { recursive: true, force: true })
  }
}

async function apiRequest(pathname, { method = 'GET', token, body, apiBase = resolveApiBase() } = {}) {
  const headers = { Accept: 'application/json' }
  if (token) headers.Authorization = 'Bearer ' + token
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  const url = apiBase + pathname
  let status = 0
  let ok = false
  let text = ''
  try {
    const res = await fetch(url, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
    status = res.status
    ok = res.ok
    text = await res.text()
  } catch (err) {
    if (/^https:/i.test(apiBase) && hasEnvProxy()) {
      const viaCurl = curlRequest(url, { method, headers, body })
      status = viaCurl.status
      ok = viaCurl.ok
      text = viaCurl.text
    } else {
      throw err
    }
  }
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error(`${method} ${pathname} returned non-JSON ${status}: ${text.slice(0, 300)}`)
  }
  if (!ok || parsed.success === false) {
    throw new Error(
      `${method} ${pathname} failed (${status}): ${parsed.error || parsed.message || text.slice(0, 300)}`,
    )
  }
  return parsed
}

export async function listWishesCmd(opts, apiBase = resolveApiBase()) {
  const params = new URLSearchParams()
  const effectiveStatus = opts.status || (!opts.mine && !opts.fulfilledByMe ? 'open' : undefined)
  if (opts.q) params.set('q', opts.q)
  if (opts.category) params.set('category', opts.category)
  if (effectiveStatus) params.set('status', effectiveStatus)
  if (opts.fulfillment) params.set('fulfillment', opts.fulfillment)
  if (opts.sort) params.set('sort', opts.sort)
  if (opts.mine) params.set('mine', '1')
  if (opts.fulfilledByMe) params.set('fulfilledByMe', '1')
  if (Number.isFinite(opts.page) && opts.page > 0) params.set('page', String(opts.page))
  if (Number.isFinite(opts.limit) && opts.limit > 0) params.set('limit', String(opts.limit))

  const token = getPaeanToken()
  if ((opts.mine || opts.fulfilledByMe) && !token) {
    throw new Error('Authentication required for --mine or --fulfilled-by-me. Sign in with Zero CLI or set PAEAN_AUTH_TOKEN.')
  }
  const qs = params.toString()
  return apiRequest(`/square/wishes${qs ? '?' + qs : ''}`, { token, apiBase })
}

export async function getWishCmd(target, apiBase = resolveApiBase()) {
  const hashKey = parseWishRef(target)
  const token = getPaeanToken()
  const res = await apiRequest(`/square/wishes/${encodeURIComponent(hashKey)}`, { token, apiBase })
  return res.data
}

export function buildWishCreatePayload(opts) {
  const prompt = String(opts.prompt || '').trim()
  if (prompt.length < 10) {
    throw new Error('--prompt is required and must be at least 10 characters.')
  }
  const payload = {
    prompt,
    category: (opts.category || 'game').trim().toLowerCase(),
    tags: Array.isArray(opts.tags) ? opts.tags : [],
    referenceImages: Array.isArray(opts.images) ? opts.images : [],
    clientRequestId: opts.clientRequestId || randomUUID(),
  }
  if (opts.title && opts.title.trim()) payload.title = opts.title.trim()
  return payload
}

export async function createWishCmd(opts, apiBase = resolveApiBase()) {
  const payload = buildWishCreatePayload(opts)
  if (opts.dryRun) {
    return {
      success: true,
      action: 'dry-run',
      creditsCost: WISH_CREDIT_COST,
      note: 'Posting a wish consumes 10 Paean credits and does NOT start an Agent build.',
      payload,
    }
  }
  const token = getPaeanToken()
  if (!token) {
    throw new Error('Paean credentials not found. Run Zero login or set PAEAN_AUTH_TOKEN before creating a wish.')
  }
  return apiRequest('/square/wishes', { method: 'POST', token, body: payload, apiBase })
}

export async function prepareWishCmd(opts, apiBase = resolveApiBase()) {
  const hashKey = parseWishRef(opts.target)
  const wish = await getWishCmd(hashKey, apiBase)
  const projectDir = path.resolve(opts.dir || '.')
  mkdirSync(projectDir, { recursive: true })

  const wishMdLines = [
    `# Wish: ${wish.title}`,
    '',
    `- **HashKey**: \`${wish.hashKey}\``,
    `- **Status**: ${wish.status}`,
    `- **Category**: ${wish.category}`,
    `- **Tags**: ${Array.isArray(wish.tags) && wish.tags.length ? wish.tags.join(', ') : '(none)'}`,
    `- **Wisher**: ${wish.authorName || 'Anonymous'}`,
    `- **Existing fulfillments**: ${wish.fulfillmentCount ?? 0}`,
    `- **Web URL**: https://www.8x.gg/wishes/${wish.hashKey}`,
    '',
    '## Prompt',
    '',
    wish.prompt,
    '',
  ]
  if (Array.isArray(wish.referenceImages) && wish.referenceImages.length > 0) {
    wishMdLines.push('## Reference Images', '')
    for (const imgUrl of wish.referenceImages) {
      wishMdLines.push(`- ${imgUrl}`)
    }
    wishMdLines.push('')
  }
  wishMdLines.push(
    '## Publish Link',
    '',
    '`clide.json` has been updated with this wish reference. When you publish with `paean-publish`, it will automatically link your Square work to this wish.',
    '',
  )

  const wishMdPath = path.join(projectDir, 'WISH.md')
  writeFileSync(wishMdPath, wishMdLines.join('\n'), 'utf8')

  const clideJsonPath = path.join(projectDir, 'clide.json')
  let manifest = {}
  if (existsSync(clideJsonPath)) {
    try {
      manifest = JSON.parse(readFileSync(clideJsonPath, 'utf8')) || {}
    } catch {
      manifest = {}
    }
  }
  manifest.schemaVersion = typeof manifest.schemaVersion === 'number' ? manifest.schemaVersion : 1
  if (!manifest.category) manifest.category = wish.category || 'game'
  manifest.wish = {
    hashKey: wish.hashKey,
    title: wish.title,
    ...(opts.note && opts.note.trim() ? { note: opts.note.trim() } : {}),
  }
  writeFileSync(clideJsonPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8')

  return {
    success: true,
    action: 'prepare',
    wishHashKey: wish.hashKey,
    wishTitle: wish.title,
    wishMdPath,
    clideJsonPath,
    wishManifest: manifest.wish,
  }
}

function formatWishSummary(w) {
  const imgs = Array.isArray(w.referenceImages) && w.referenceImages.length ? ` | imgs:${w.referenceImages.length}` : ''
  const tags = Array.isArray(w.tags) && w.tags.length ? ' | ' + w.tags.slice(0, 4).map(t => `#${t}`).join(' ') : ''
  const date = w.createdAt ? ` | ${String(w.createdAt).slice(0, 10)}` : ''
  return `[${w.hashKey}] ${w.title} (${w.category} | ${w.status} | works:${w.fulfillmentCount ?? 0}${imgs}${date}${tags})\n  Prompt: ${String(w.prompt || '').replace(/\s+/g, ' ').slice(0, 140)}`
}

export async function runWishCli(argv = process.argv.slice(2)) {
  const opts = parseWishCliArgs(argv)
  if (opts.help || opts.subcommand === 'help') {
    console.log(usage())
    return
  }

  if (opts.subcommand === 'list' || opts.subcommand === 'pull' || opts.subcommand === 'search') {
    const res = await listWishesCmd(opts)
    if (opts.json) {
      console.log(JSON.stringify(res, null, 2))
      return
    }
    const items = Array.isArray(res.items) ? res.items : []
    console.log(`Found ${res.total ?? items.length} wishes (page ${res.page ?? 1}):`)
    if (items.length === 0) {
      console.log('  (No matching wishes right now.)')
    } else {
      for (const item of items) {
        console.log(formatWishSummary(item))
      }
      console.log('')
      console.log('Tip: inspect a wish with `wishes.mjs get <hashKey>` or claim/scaffold locally with `wishes.mjs prepare <hashKey> --dir <project-dir>`.')
    }
    return
  }

  if (opts.subcommand === 'get') {
    if (!opts.target) throw new Error('Usage: wishes.mjs get <hashKey|url> [--json]')
    const wish = await getWishCmd(opts.target)
    if (opts.json) {
      console.log(JSON.stringify({ success: true, data: wish }, null, 2))
      return
    }
    console.log(`Title: ${wish.title}`)
    console.log(`HashKey: ${wish.hashKey}`)
    console.log(`Status: ${wish.status} | Category: ${wish.category} | Works: ${wish.fulfillmentCount ?? 0}`)
    console.log(`Author: ${wish.authorName} | Created: ${wish.createdAt}`)
    console.log(`\nPrompt:\n${wish.prompt}`)
    if (Array.isArray(wish.referenceImages) && wish.referenceImages.length > 0) {
      console.log('\nReference Images:')
      for (const u of wish.referenceImages) console.log('  - ' + u)
    }
    if (Array.isArray(wish.fulfillments) && wish.fulfillments.length > 0) {
      console.log('\nFulfilled Works:')
      for (const f of wish.fulfillments) {
        console.log(`  - [${f.app?.hashKey}] ${f.app?.title} -> ${f.app?.playUrl}${f.note ? ` (${f.note})` : ''}`)
      }
    }
    return
  }

  if (opts.subcommand === 'create') {
    const res = await createWishCmd(opts)
    console.log(JSON.stringify(res, null, 2))
    return
  }

  if (opts.subcommand === 'prepare') {
    if (!opts.target) throw new Error('Usage: wishes.mjs prepare <hashKey|url> [--dir <dir>] [--note <text>] [--json]')
    const res = await prepareWishCmd(opts)
    console.log(JSON.stringify(res, null, 2))
    return
  }

  throw new Error('Unknown subcommand: ' + opts.subcommand + '\n\n' + usage())
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  runWishCli().catch((err) => {
    console.error(err instanceof Error ? err.message : String(err))
    process.exitCode = 1
  })
}
