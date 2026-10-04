#!/usr/bin/env node
// Install only repository-owned skill files; preserve unrelated local skills and metadata.
import { copyFileSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
export const TARGETS = {
  'claude-code': { source: 'claude-code', directory: '.claude/skills' },
  codex: { source: 'codex', directory: '.agents/skills' },
  zero: { source: 'zero', directory: '.zero/skills' },
  gemini: { source: 'claude-code', directory: '.gemini/skills' },
  antigravity: { source: 'claude-code', directory: '.gemini/config/skills' },
  'antigravity-cli': { source: 'claude-code', directory: '.gemini/antigravity-cli/skills' },
  'deepseek-harness': { source: 'claude-code', directory: '.dsh/skills' },
}

export function resolveTarget(target, { home = homedir(), env = process.env, dest } = {}) {
  const config = TARGETS[target]
  if (!config) throw new Error(`Unknown target: ${target}`)
  const dshHome = env.DSH_HOME?.trim() ? env.DSH_HOME : path.join(home, '.dsh')
  const directory = dest || (target === 'deepseek-harness'
    ? path.join(dshHome, 'skills') : path.join(home, config.directory))
  return { target, source: config.source, destination: path.resolve(directory) }
}

function stat(file) { return lstatSync(file, { throwIfNoEntry: false }) }
function physical(file) {
  const tail = []
  let current = path.resolve(file)
  while (!stat(current)) { tail.unshift(path.basename(current)); current = path.dirname(current) }
  return path.join(realpathSync(current), ...tail)
}
function within(parent, child) {
  const relative = path.relative(parent, child)
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
}
function sourceFiles(directory) {
  const files = []
  function walk(dir) {
    for (const item of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (['.DS_Store', '__pycache__'].includes(item.name)) continue
      const file = path.join(dir, item.name)
      if (item.isSymbolicLink()) throw new Error(`Source symlink is not installable: ${file}`)
      if (item.name.startsWith('.') || ['node_modules', 'credentials.json'].includes(item.name)) {
        throw new Error(`Unexpected source entry: ${file}`)
      }
      if (item.isDirectory()) walk(file)
      else if (item.isFile()) files.push(file)
      else throw new Error(`Not a regular source file: ${file}`)
    }
  }
  walk(directory)
  return files
}
function inspectDestination(root, relative) {
  let current = root
  const parts = relative.split(path.sep)
  for (let i = -1; i < parts.length; i++) {
    if (i >= 0) current = path.join(current, parts[i])
    const entry = stat(current)
    if (!entry) continue
    if (entry.isSymbolicLink()) throw new Error(`Refusing destination symlink: ${current}`)
    const directory = i < parts.length - 1
    if (directory ? !entry.isDirectory() : !entry.isFile()) throw new Error(`Destination type conflict: ${current}`)
  }
}

export function installSkills({ targets, repoRoot = ROOT, home = homedir(), env = process.env, dest, dryRun = false, check = false } = {}) {
  if (!Array.isArray(targets) || !targets.length || new Set(targets).size !== targets.length) throw new Error('Choose distinct --target names')
  if (dest && targets.length !== 1) throw new Error('--dest requires exactly one target')
  if (check && dryRun) throw new Error('Choose --check or --dry-run')
  const repo = physical(repoRoot)
  // Preflight every selected target before writing any file.
  const plans = targets.map(target => {
    const plan = resolveTarget(target, { home, env, dest })
    plan.destination = physical(plan.destination)
    if (within(plan.destination, repo) || ['claude-code', 'codex', 'zero', 'scripts', 'tests', 'redskill'].some(dir => within(path.join(repo, dir), plan.destination))) {
      throw new Error('Installation destination overlaps repository sources')
    }
    const sourceRoot = path.join(repo, plan.source)
    const skills = readdirSync(sourceRoot, { withFileTypes: true })
      .filter(item => item.isDirectory() && /^paean-[a-z0-9-]+$/.test(item.name)).map(item => item.name).sort()
    if (!skills.length) throw new Error(`No skills in ${sourceRoot}`)
    const files = skills.flatMap(skill => {
      const skillDir = path.join(sourceRoot, skill)
      if (!stat(path.join(skillDir, 'SKILL.md'))?.isFile()) throw new Error(`Missing SKILL.md: ${skillDir}`)
      return sourceFiles(skillDir)
    })
    plan.skills = skills.length
    plan.files = files.length
    plan.changes = []
    for (const source of files) {
      const relative = path.relative(sourceRoot, source)
      inspectDestination(plan.destination, relative)
      const destination = path.join(plan.destination, relative)
      const exists = Boolean(stat(destination))
      if (!exists || !readFileSync(source).equals(readFileSync(destination))) plan.changes.push({ source, destination, relative, exists })
    }
    return plan
  })
  return plans.map(plan => {
    let backup = null
    if (!dryRun && !check) {
      const prior = plan.changes.filter(file => file.exists)
      if (prior.length) {
        const backupRoot = path.join(path.dirname(plan.destination), '.8x-skills-backups')
        if (stat(backupRoot)?.isSymbolicLink()) throw new Error(`Refusing backup symlink: ${backupRoot}`)
        mkdirSync(backupRoot, { recursive: true, mode: 0o700 })
        backup = mkdtempSync(path.join(backupRoot, `${plan.target}-`))
        for (const file of prior) {
          const saved = path.join(backup, file.relative)
          mkdirSync(path.dirname(saved), { recursive: true, mode: 0o700 })
          copyFileSync(file.destination, saved)
        }
      }
      for (const file of plan.changes) {
        mkdirSync(path.dirname(file.destination), { recursive: true })
        copyFileSync(file.source, file.destination)
      }
    }
    return { target: plan.target, source: plan.source, destination: plan.destination, skills: plan.skills,
      files: plan.files, changedFiles: plan.changes.length, backup, mode: check ? 'check' : dryRun ? 'dry-run' : 'install' }
  })
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2)
    if (!args.length || (args.length === 1 && args[0] === '--help')) {
      console.log(`Usage: node scripts/install-skills.mjs --target NAME[,NAME...] [--dest DIRECTORY] [--dry-run | --check]\nTargets: ${Object.keys(TARGETS).join(', ')}\nRun from any directory. --dest overrides one target; --check writes nothing and exits 1 for drift.\nChanged existing files are backed up outside the skills root. Extra local files are preserved.`)
    } else {
      const options = {}
      const seen = new Set()
      for (let i = 0; i < args.length; i++) {
        const key = args[i]
        if (seen.has(key)) throw new Error(`Duplicate option: ${key}`)
        seen.add(key)
        if (key === '--dry-run') options.dryRun = true
        else if (key === '--check') options.check = true
        else if (['--target', '--dest'].includes(key) && args[i + 1] && !args[i + 1].startsWith('--')) {
          const value = args[++i]
          if (key === '--target') options.targets = value.split(',')
          else options.dest = value
        } else throw new Error(`Unknown or incomplete option: ${key}`)
      }
      const results = installSkills(options)
      console.log(JSON.stringify(results, null, 2))
      if (options.check && results.some(result => result.changedFiles)) process.exitCode = 1
    }
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
