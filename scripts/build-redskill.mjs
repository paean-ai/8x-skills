#!/usr/bin/env node
// Build a self-contained Red Skill from the dedicated entry and canonical workflows.
import { createHash } from 'node:crypto'
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createZip } from '../claude-code/paean-publish/scripts/zip.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const FORMAT = '8x-redskill-bundle-v1'
const FILE_LIMIT = 10_000_000
const TOTAL_LIMIT = 30_000_000
const EXTENSIONS = new Set(['.md', '.mjs', '.js', '.css', '.py', '.json'])
const SKIP = new Set(['.DS_Store', '__pycache__', 'node_modules'])
const sha256 = (data) => createHash('sha256').update(data).digest('hex')
const unix = (p) => p.split(path.sep).join('/')
const within = (root, target) => {
  const rel = path.relative(root, target)
  return rel === '' || (!rel.startsWith(`..${path.sep}`) && rel !== '..' && !path.isAbsolute(rel))
}

function filesIn(root, { source = false } = {}) {
  const files = []
  function walk(dir) {
    for (const item of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) {
      if (source && SKIP.has(item.name)) continue
      const file = path.join(dir, item.name)
      if (item.isSymbolicLink()) throw new Error(`Symlinks are not packaged: ${file}`)
      if (item.isDirectory()) walk(file)
      else if (item.isFile()) files.push(file)
      else throw new Error(`Not a regular file: ${file}`)
    }
  }
  walk(root)
  return files
}

export function assembleBundle(repoRoot = ROOT) {
  const spec = JSON.parse(readFileSync(path.join(repoRoot, 'redskill/release.json'), 'utf8'))
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(spec.name) || spec.name.length > 64) throw new Error('Invalid skill name')
  if (!/^\d+\.\d+\.\d+$/.test(spec.version)) throw new Error('Invalid release version')
  if (!Array.isArray(spec.workflows) || !spec.workflows.length || new Set(spec.workflows).size !== spec.workflows.length) throw new Error('Invalid workflow list')
  const entries = new Map()
  const provenance = []
  function add(file, name) {
    if (lstatSync(file).isSymbolicLink()) throw new Error(`Symlinks are not packaged: ${file}`)
    if (entries.has(name)) throw new Error(`Duplicate bundle path: ${name}`)
    const data = readFileSync(file)
    if (data.length > FILE_LIMIT) throw new Error(`File exceeds 10 MB: ${name}`)
    entries.set(name, data)
    provenance.push({ path: name, source: unix(path.relative(repoRoot, file)), bytes: data.length, sha256: sha256(data) })
  }
  function tree(from, prefix = '') {
    if (lstatSync(from).isSymbolicLink()) throw new Error(`Symlinks are not packaged: ${from}`)
    for (const file of filesIn(from, { source: true })) {
      const relative = unix(path.relative(from, file))
      if (relative.split('/').some((p) => p.startsWith('.')) || !EXTENSIONS.has(path.extname(file))) throw new Error(`Unexpected source file: ${file}`)
      add(file, prefix + relative)
    }
  }
  tree(path.join(repoRoot, 'redskill', spec.name))
  const frontmatter = entries.get('SKILL.md')?.toString('utf8')
  if (!frontmatter?.startsWith('---\n') || !frontmatter.includes(`\nname: ${spec.name}\n`)) throw new Error('Root SKILL.md name must match release.json')
  for (const workflow of spec.workflows) {
    if (!/^paean-[a-z0-9-]+$/.test(workflow)) throw new Error(`Invalid workflow: ${workflow}`)
    const from = path.join(repoRoot, 'claude-code', workflow)
    if (lstatSync(from).isSymbolicLink()) throw new Error(`Symlinks are not packaged: ${from}`)
    add(path.join(from, 'SKILL.md'), `workflows/${workflow}/SKILL.md`)
    for (const sub of ['scripts', 'reference', 'references']) {
      if (existsSync(path.join(from, sub))) tree(path.join(from, sub), `workflows/${workflow}/${sub}/`)
    }
  }
  add(path.join(repoRoot, 'LICENSE'), 'LICENSE')
  // Catch missing companion references before publishing a seemingly valid single-file skill.
  for (const [name, bytes] of entries) {
    if (!name.endsWith('.md')) continue
    for (const match of bytes.toString('utf8').matchAll(/\[[^\]\n]*\]\(([^)\s]+)\)/g)) {
      const href = match[1]
      if (/^(?:https?:|mailto:|#)/.test(href)) continue
      const target = path.posix.normalize(path.posix.join(path.posix.dirname(name), decodeURIComponent(href.split('#')[0])))
      if (href.startsWith('/') || !entries.has(target)) throw new Error(`Unbundled reference: ${name} -> ${href}`)
    }
  }
  const manifest = { format: FORMAT, name: spec.name, version: spec.version, workflows: spec.workflows, files: provenance.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0) }
  entries.set('bundle-manifest.json', Buffer.from(JSON.stringify(manifest, null, 2) + '\n'))
  const totalBytes = [...entries.values()].reduce((n, b) => n + b.length, 0)
  if (totalBytes > TOTAL_LIMIT) throw new Error('Bundle exceeds 30 MB uncompressed')
  const sorted = [...entries].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
  const archive = createZip(sorted.map(([name, data]) => ({ name, data })))
  if (archive.length > TOTAL_LIMIT) throw new Error('ZIP exceeds 30 MB')
  return { spec, entries: new Map(sorted), archive, totalBytes }
}

// Resolve existing ancestors too, so a symlinked output cannot point into source directories.
function physicalPath(target) {
  const missing = []
  let cursor = path.resolve(target)
  while (!existsSync(cursor)) {
    missing.unshift(path.basename(cursor))
    const parent = path.dirname(cursor)
    if (cursor === parent) throw new Error(`Cannot resolve output: ${target}`)
    cursor = parent
  }
  return path.join(realpathSync(cursor), ...missing)
}

export function buildBundle({ repoRoot = ROOT, outDir = path.join(repoRoot, 'dist/redskill'), check = false } = {}) {
  const bundle = assembleBundle(repoRoot)
  const root = realpathSync(repoRoot)
  const out = physicalPath(outDir)
  if (within(root, out) && !within(path.join(root, 'dist'), out)) throw new Error('Repository output must be inside dist/')
  const directory = path.join(out, bundle.spec.name)
  const archive = path.join(out, `${bundle.spec.name}-${bundle.spec.version}.zip`)
  for (const file of [directory, archive]) {
    if (existsSync(file) && lstatSync(file).isSymbolicLink()) throw new Error(`Refusing symlink output: ${file}`)
  }
  if (check) {
    if (!existsSync(directory) || !existsSync(archive)) throw new Error('Build is missing; run node scripts/build-redskill.mjs')
    const actualNames = filesIn(directory).map((file) => unix(path.relative(directory, file))).sort()
    if (JSON.stringify(actualNames) !== JSON.stringify([...bundle.entries.keys()])) throw new Error('Bundle file list is stale')
    for (const [name, bytes] of bundle.entries) {
      if (!readFileSync(path.join(directory, name)).equals(bytes)) throw new Error(`Bundle file is stale: ${name}`)
    }
    if (!readFileSync(archive).equals(bundle.archive)) throw new Error('ZIP is stale')
  } else {
    if (existsSync(directory)) {
      const marker = path.join(directory, 'bundle-manifest.json')
      let prior
      try { prior = JSON.parse(readFileSync(marker, 'utf8')) } catch { /* unowned directory */ }
      if (prior?.format !== FORMAT || prior?.name !== bundle.spec.name) throw new Error(`Refusing to replace an unowned directory: ${directory}`)
      rmSync(directory, { recursive: true })
    }
    for (const [name, bytes] of bundle.entries) {
      const file = path.join(directory, name)
      mkdirSync(path.dirname(file), { recursive: true })
      writeFileSync(file, bytes)
    }
    writeFileSync(archive, bundle.archive)
  }
  return { mode: check ? 'checked' : 'built', name: bundle.spec.name, version: bundle.spec.version, directory, archive, files: bundle.entries.size, uncompressedBytes: bundle.totalBytes, zipBytes: bundle.archive.length, sha256: sha256(bundle.archive), platformUploadVerified: false }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2)
    const options = {}
    for (let i = 0; i < args.length; i++) {
      if (args[i] === '--check') options.check = true
      else if (args[i] === '--out' && args[i + 1] && !args[i + 1].startsWith('--')) options.outDir = path.resolve(args[++i])
      else if (args[i] === '--help') {
        console.log('Usage: node scripts/build-redskill.mjs [--out directory] [--check]')
        process.exit(0)
      } else throw new Error(`Unknown or incomplete option: ${args[i]}`)
    }
    console.log(JSON.stringify(buildBundle(options), null, 2))
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
