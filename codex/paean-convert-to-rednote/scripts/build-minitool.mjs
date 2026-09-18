#!/usr/bin/env node
/*
 * build-minitool.mjs — build a RedNote mini-tool zip from an adapted source tree.
 *
 *   node build-minitool.mjs [--config rednote.config.json] [--src <dir>] [--out <dir>]
 *
 * Reads a config next to the project, rewrites index.html per the config's anchors,
 * then hands off to minitool-pipeline.mjs (bundling, Chrome 61 lowering, baseline
 * shim, licence inlining, self-check, zip).
 *
 * Unlike the ad converter, this one DOES expect an adapted `src/`: localisation,
 * default language and SDK removal are source-level concerns the pipeline cannot
 * infer. Everything that CAN be mechanical is mechanical and lives in the pipeline.
 */
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { buildMinitool } from './minitool-pipeline.mjs'

const argv = process.argv.slice(2)
const flag = (n, d) => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] ? argv[i + 1] : d }
const CONFIG = path.resolve(flag('--config', 'rednote.config.json'))
if (!existsSync(CONFIG)) {
  console.error(`✗ config not found: ${CONFIG}\n  see the skill's SKILL.md for the shape`)
  process.exit(1)
}
const CFG = JSON.parse(readFileSync(CONFIG, 'utf8'))
const ROOT = path.dirname(CONFIG)
const SRC = path.resolve(ROOT, flag('--src', CFG.src || 'src'))

if (!CFG.name) { console.error('✗ config needs a "name" (used for the zip filename and the config global)'); process.exit(1) }
if (!CFG.entry && !CFG.scripts) { console.error('✗ config needs either "entry" (ES module) or "scripts" (classic script list)'); process.exit(1) }
if (!existsSync(SRC)) { console.error(`✗ source not found: ${SRC}`); process.exit(1) }

const indexPath = path.join(SRC, 'index.html')
if (!existsSync(indexPath)) { console.error(`✗ ${indexPath} not found`); process.exit(1) }
let html = readFileSync(indexPath, 'utf8')

/* Anchored replacements. Each must match exactly once, so an upstream edit that moves
   the anchor fails the build instead of silently shipping the original tags. */
const applyAnchor = (from, to, label) => {
  const n = html.split(from).length - 1
  if (n === 0) throw new Error(`index.html anchor not found (${label}): ${from.slice(0, 80)}`)
  if (n > 1) throw new Error(`index.html anchor is ambiguous, matched ${n}× (${label}): ${from.slice(0, 80)}`)
  html = html.replace(from, to)
}

const assetTags = [
  CFG.css && CFG.css.length ? '<link rel="stylesheet" href="./assets/style.css">' : '',
  '<script src="./assets/config.js"></script>',
  '<script src="./assets/app.js"></script>',
].filter(Boolean)

for (const [from, to] of Object.entries(CFG.htmlReplace || {})) applyAnchor(from, to, 'htmlReplace')
// `dropTags` removes host-only <script>/<link> tags whose files are not shipped;
// leaving a tag behind after dropping the file is a guaranteed 404 in the container.
for (const t of CFG.dropTags || []) {
  if (!html.includes(t)) throw new Error(`dropTags entry not found in index.html: ${t.slice(0, 80)}`)
  html = html.split(t).join('')
}
// A work with a dozen classic <script> tags is better served by one pattern than a dozen literals.
for (const src of CFG.dropTagPatterns || []) {
  const re = new RegExp(src, 'g')
  if (!re.test(html)) throw new Error(`dropTagPatterns entry matched nothing: ${src}`)
  html = html.replace(new RegExp(src, 'g'), '')
}
if (CFG.stylesheetAnchor) applyAnchor(CFG.stylesheetAnchor, assetTags.filter((t) => t.startsWith('<link')).join('\n'), 'stylesheetAnchor')
if (CFG.scriptAnchor) applyAnchor(CFG.scriptAnchor, assetTags.filter((t) => t.startsWith('<script')).join('\n'), 'scriptAnchor')

await buildMinitool({
  root: ROOT,
  srcDir: SRC,
  name: CFG.name,
  entry: CFG.entry,
  scripts: CFG.scripts,
  css: CFG.css || [],
  copy: CFG.copy || [],
  alias: CFG.alias,
  minifyIdentifiers: !!CFG.minifyIdentifiers,
  config: {
    global: CFG.configGlobal || `${CFG.name.toUpperCase().replace(/[^A-Z0-9]/g, '')}_CONFIG`,
    values: Object.assign({ platform: 'minitool', defaultLang: 'zh' }, CFG.configValues || {}),
  },
  html,
})
