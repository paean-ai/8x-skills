#!/usr/bin/env node
// Read-only inventory. Findings are review leads, not a compatibility certificate.
import { lstatSync, readdirSync, readFileSync, realpathSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'

const RULES = [
  ['dom-layout', /\bdocument\s*\.|\b(?:innerHTML|outerHTML|getComputedStyle|getBoundingClientRect|ResizeObserver)\b/g, 'Preserve original UI code; require DOM, CSS layout, painting and events in the adapter. Fake nodes are not sufficient.'],
  ['browser-global', /\b(?:window|navigator|location|screen)\s*\./g, 'Inject only the platform values actually used.'],
  ['pointer-input', /\b(?:pointerdown|pointermove|pointerup|pointercancel|setPointerCapture|requestPointerLock|keydown)\b/g, 'Use wx touch identifiers, cancellation and explicit hit regions.'],
  ['svg-data-image', /data:image\/svg\+xml|\bcreateObjectURL\s*\(/g, 'Keep original generators; adapt Image decoding or cache equivalent generated rasters behind the same API.'],
  ['web-audio', /\b(?:AudioContext|webkitAudioContext|createOscillator|createBiquadFilter|createConvolver)\b/g, 'Preserve the audio graph through an equivalent backend; unsupported nodes are explicit adapter gaps.'],
  ['browser-storage', /\blocalStorage\b|\bindexedDB\b/g, 'Map storage to wx APIs with a new namespace and schema checks.'],
  ['runtime-network', /\b(?:fetch|XMLHttpRequest|WebSocket)\s*\(|\bimport\s*\(/g, 'Audit reachable requests/imports; bundle code, configure domains for required data.'],
  ['host-sdk', /\b(?:PaeanSDK|createPaeanPlatform)\b/g, 'Preserve the service interface through an authorized transport; missing services remain pending, never fake success.'],
  ['dynamic-code', /\beval\s*\(|\bnew\s+Function\s*\(/g, 'Remove dynamic code execution from the release dependency graph.'],
  ['webgl2', /["']webgl2["']|\bisWebGL2\b|WebGL 1 is not supported/g, 'Test real WebGL2 and render-target support before choosing the 3D route.'],
  ['canvas-texture', /\bCanvasTexture\b/g, 'Create an offscreen 2D canvas and upload it as a texture; test on devices.'],
]
const TEXT = new Set(['.js', '.mjs', '.cjs', '.html', '.css', '.json', '.svg', '.ts', '.tsx', '.jsx'])
const SKIP = new Set(['node_modules', '__pycache__', 'credentials.json'])

export function auditSource(directory) {
  const root = realpathSync(directory)
  if (!lstatSync(root).isDirectory()) throw new Error('Source must be a directory')
  const files = [], skipped = [], findings = [], extensions = {}, origins = new Set(), entries = [], three = []
  const tree = createHash('sha256')
  function walk(dir) {
    for (const name of readdirSync(dir).sort()) {
      const full = path.join(dir, name), rel = path.relative(root, full).split(path.sep).join('/')
      if (name.startsWith('.') || SKIP.has(name)) { skipped.push({ path: rel, reason: 'local metadata/dependencies' }); continue }
      const stat = lstatSync(full)
      if (stat.isSymbolicLink()) { skipped.push({ path: rel, reason: 'symlink not followed' }); continue }
      if (stat.isDirectory()) { walk(full); continue }
      if (!stat.isFile()) continue
      const bytes = readFileSync(full), sha256 = createHash('sha256').update(bytes).digest('hex'), ext = path.extname(name).toLowerCase()
      files.push({ path: rel, bytes: bytes.length, sha256 })
      tree.update(rel + '\0' + sha256 + '\n')
      extensions[ext || '(none)'] = (extensions[ext || '(none)'] || 0) + bytes.length
      if (!TEXT.has(ext)) continue
      const text = bytes.toString('utf8')
      for (const [code, regex, action] of RULES) {
        regex.lastIndex = 0
        const matches = [...text.matchAll(regex)]
        if (matches.length) findings.push({ code, file: rel, occurrences: matches.length,
          lines: [...new Set(matches.slice(0, 12).map(m => text.slice(0, m.index).split('\n').length))], action })
      }
      for (const m of text.matchAll(/https?:\/\/[^\s"'<>`\\)]+/g)) {
        try { origins.add(new URL(m[0]).origin) } catch { /* malformed/comment example */ }
      }
      if (ext === '.html') for (const m of text.matchAll(/<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi)) entries.push({ html: rel, src: m[1].split('?')[0] })
      if (/three.*\.(?:m?js)$/i.test(name)) {
        const rev = text.match(/\bREVISION\s*=\s*['"](\d+)['"]/) || text.match(/\bconst\s+\w+\s*=\s*['"](\d{3})['"]/)
        if (rev) three.push({ file: rel, revision: Number(rev[1]) })
      }
    }
  }
  walk(root)
  const has = code => findings.some(f => f.code === code)
  const needs3D = three.length > 0 || has('webgl2')
  return { schema: 1, assessment: 'static-review-only', sourceDigest: tree.digest('hex'), fileCount: files.length,
    totalBytes: files.reduce((n, f) => n + f.bytes, 0), extensions, entries, three,
    route: needs3D ? 'preserve-engine-with-platform-and-dom-adapters' : 'preserve-canvas-and-dom-with-compatibility-layer',
    mainPackageBudgetBytes: 4 * 1024 * 1024,
    budgetNote: 'Conservative planning budget only; source bytes are not the DevTools compiled/upload size. Recheck current platform limits.',
    origins: [...origins].sort(), findings, files, skipped,
    limitations: ['Regex scans include comments and unreachable vendor code; review findings against the entry graph.',
      'Aliases, computed accesses and generated code can escape detection; no findings does not mean compatible.',
      'No scripts executed, dependencies installed, credentials read, or network requests made.'] }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 3 || process.argv[2] === '--help') {
      console.log('Usage: node audit-source.mjs SOURCE_DIRECTORY\nPrints a JSON inventory to stdout. No writes or source execution.')
      if (process.argv[2] !== '--help') process.exitCode = 2
    } else console.log(JSON.stringify(auditSource(process.argv[2]), null, 2))
  } catch (error) { console.error(error.message); process.exitCode = 1 }
}
