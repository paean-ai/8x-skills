#!/usr/bin/env node
/*
 * build-ad.mjs — turn a Paean / clide.app work into an HTML5 playable-ad bundle.
 *
 *   node build-ad.mjs [--config ad.config.json] [--keep] [--out <dir>]
 *
 * Reads a config next to the project (default `ad.config.json`), copies the source,
 * strips host-only files, injects the ad layer, self-checks for network calls, and
 * zips a bundle that Google Ads accepts as a MEDIA_BUNDLE asset.
 *
 * The game's own source is never edited: everything happens through <head>/<body>
 * injection plus the standalone ad-*.js/css files shipped next to this script.
 */
import { cpSync, rmSync, existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createZip } from './zip.mjs'

// fileURLToPath, not `.pathname`: the raw pathname keeps percent-escapes and,
// on Windows, a leading slash before the drive letter.
const HERE = path.dirname(fileURLToPath(import.meta.url))
const REF = path.join(HERE, '..', 'reference')
const argv = process.argv.slice(2)
const flag = (n, d) => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] ? argv[i + 1] : d }
const KEEP = argv.includes('--keep')
const CONFIG = path.resolve(flag('--config', 'ad.config.json'))
if (!existsSync(CONFIG)) { console.error(`✗ config not found: ${CONFIG}\n  see the skill's SKILL.md for the shape`); process.exit(1) }
const CFG = JSON.parse(readFileSync(CONFIG, 'utf8'))
const ROOT = path.dirname(CONFIG)
const SRC = path.resolve(ROOT, CFG.source)
const OUT = path.resolve(ROOT, flag('--out', CFG.outDir || 'dist'))
const BUILD = path.resolve(ROOT, 'build')

const D = {
  width: 320, height: 480, playMs: 30000, ctaText: 'Play Free',
  endTitle: 'Keep playing', endSub: '', autoSkip: [], autoSkipMs: 12000,
  drop: [], stripScripts: [], director: null, excludeFromScan: ['lib/'],
}
const AD = Object.assign({}, D, CFG.ad || {})
const kb = (n) => `${Math.round(n / 1024)} KB`
const dirSize = (p) => readdirSync(p, { withFileTypes: true })
  .reduce((t, e) => t + (e.isDirectory() ? dirSize(path.join(p, e.name)) : statSync(path.join(p, e.name)).size), 0)

if (!existsSync(SRC)) { console.error(`✗ source not found: ${SRC}`); process.exit(1) }
rmSync(BUILD, { recursive: true, force: true })
mkdirSync(OUT, { recursive: true })
cpSync(SRC, BUILD, { recursive: true })
const before = dirSize(BUILD)

// 1) drop host-only / store-only files
let dropped = 0
for (const f of AD.drop) {
  const p = path.join(BUILD, f)
  if (existsSync(p)) { dropped += statSync(p).size; rmSync(p, { recursive: true, force: true }) }
}

// 2) copy the ad layer
const layer = ['ad-bridge.js', 'ad-overlay.js', 'ad-overlay.css']
for (const f of layer) cpSync(path.join(REF, f), path.join(BUILD, f))
if (AD.director && CFG.directorFile) {
  cpSync(path.resolve(ROOT, CFG.directorFile), path.join(BUILD, 'ad-director.js'))
}

// 3) rewrite index.html
const idx = path.join(BUILD, 'index.html')
let html = readFileSync(idx, 'utf8')
const before_html = html

for (const s of AD.stripScripts) {
  html = html.replace(new RegExp(`\\s*<script[^>]*src="${s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"[^>]*></script>`, 'g'), '')
}
if (!/name="ad\.size"/.test(html)) {
  html = html.replace(/<meta charset=["']?utf-8["']?\s*\/?>/i,
    (m) => `${m}\n<meta name="ad.size" content="width=${AD.width},height=${AD.height}">`)
}
const boot = `<link rel="stylesheet" href="ad-overlay.css">\n`
  + `<script>window.AD_STORE_URL=${JSON.stringify(AD.storeUrl)};`
  + `window.AD_CONFIG=${JSON.stringify({ playMs: AD.playMs, ctaText: AD.ctaText, endTitle: AD.endTitle, endSub: AD.endSub, autoSkip: AD.autoSkip, autoSkipMs: AD.autoSkipMs })};`
  + (AD.director ? `window.AD_DIRECTOR=${JSON.stringify(AD.director)};` : '')
  + `</script>\n<script src="ad-bridge.js"></script>\n`
html = html.replace(/<\/head>/i, `${boot}</head>`)

// the director + overlay must load after the game entry
const entry = CFG.entryScriptTag
if (!entry || !html.includes(entry)) { console.error(`✗ entryScriptTag not found in index.html:\n  ${entry}`); process.exit(1) }
html = html.replace(entry, entry
  + (AD.director ? `\n<script ${CFG.directorIsModule ? 'type="module" ' : ''}src="ad-director.js"></script>` : '')
  + `\n<script src="ad-overlay.js"></script>`)

if (html === before_html) { console.error('✗ index.html rewrite produced no change'); process.exit(1) }
writeFileSync(idx, html)

// 4) self-check: an ad bundle may not talk to the network
const offenders = []
;(function scan(p) {
  for (const e of readdirSync(p, { withFileTypes: true })) {
    const f = path.join(p, e.name)
    if (e.isDirectory()) { scan(f); continue }
    if (!/\.(js|html|css)$/i.test(e.name)) continue
    const rel = path.relative(BUILD, f).split(path.sep).join('/')
    if (AD.excludeFromScan.some((x) => rel.startsWith(x))) continue
    const s = readFileSync(f, 'utf8')
    for (const [re, what] of [
      [/\bfetch\s*\(/, 'fetch()'], [/XMLHttpRequest/, 'XMLHttpRequest'],
      [/new\s+WebSocket/, 'WebSocket'], [/sendBeacon/, 'sendBeacon'],
      [/https?:\/\/(?!play\.google\.com|schema\.org|www\.w3\.org)[a-z0-9.-]+/i, 'external URL'],
    ]) if (re.test(s)) offenders.push(`${rel} → ${what}`)
  }
})(BUILD)

// 5) zip
const zipName = CFG.bundleName || `${path.basename(ROOT)}-${AD.width}x${AD.height}.zip`
const zipPath = path.join(OUT, zipName)
rmSync(zipPath, { force: true })
// Packed in-process (see scripts/zip.mjs): Windows has no `zip`, and the
// bundle Google Ads accepts must have forward-slash entry names regardless.
const bundleFiles = (function collect(dir, prefix = '') {
  const out = []
  for (const e of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (e.name === '.DS_Store' || e.name === 'Thumbs.db') continue
    const rel = prefix ? `${prefix}/${e.name}` : e.name
    if (e.isDirectory()) out.push(...collect(path.join(dir, e.name), rel))
    else if (e.isFile()) out.push(rel)
  }
  return out
})(BUILD)
writeFileSync(zipPath, createZip(bundleFiles.map((rel) => ({ name: rel, data: readFileSync(path.join(BUILD, rel)) }))))
const zipSize = statSync(zipPath).size
if (!KEEP) rmSync(BUILD, { recursive: true, force: true })

console.log(`\nplayable ad bundle built`)
console.log(`  source     ${path.relative(ROOT, SRC)}`)
console.log(`  size       ${AD.width}x${AD.height}`)
console.log(`  store      ${AD.storeUrl}`)
if (AD.director) console.log(`  director   ${JSON.stringify(AD.director)}`)
if (AD.autoSkip.length) console.log(`  auto-skip  ${AD.autoSkip.join(', ')}`)
console.log(`  unpacked   ${kb(before)} → ${kb(before - dropped)}`)
console.log(`  bundle     ${path.relative(ROOT, zipPath)}  (${kb(zipSize)})`)
console.log(offenders.length
  ? `\n  ⚠ ${offenders.length} network/external reference(s) — an ad bundle must be fully offline:\n` + offenders.map((o) => '     ' + o).join('\n')
  : `\n  ✓ self-check passed: no fetch / XHR / WebSocket / external URL`)
if (KEEP) console.log(`\n  build/ kept — preview with:  npx --yes serve build`)
