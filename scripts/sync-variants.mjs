#!/usr/bin/env node
/*
 * sync-variants.mjs — regenerate the `codex/` and `zero/` skill mirrors from
 * the canonical `claude-code/` tree.
 *
 * Scripts and reference files are copied byte-for-byte (the three mirrors
 * must never diverge there — tests run against `codex/`). Each SKILL.md is
 * derived from the claude-code one with the variant's packaging:
 *
 *   codex:  H1 gains " (Codex)"; a "Using this skill in Codex" blockquote is
 *           inserted after the first paragraph (kept from the existing codex
 *           file when present, so per-skill wording survives).
 *   zero:   description gains " Runs from Zero CLI."; H1 gains " (Zero CLI)";
 *           an "Installing in Zero CLI" blockquote is inserted the same way.
 *
 * Run from the repo root:  node scripts/sync-variants.mjs [--check]
 * `--check` exits 1 when a mirror would change (for CI / paean-skills-update).
 */
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')
const SRC = path.join(root, 'claude-code')
const check = process.argv.includes('--check')
const VARIANTS = {
  codex: {
    h1: ' (Codex)',
    marker: /^> \*\*Using this skill in Codex\.\*\*/,
    fallback: (skill) => [
      '> **Using this skill in Codex.** Codex has no frontmatter skill loader, so',
      '> reference this file explicitly: add a line to your project `AGENTS.md` such as',
      `> *"For this task, follow \`8x-skills/codex/${skill}/SKILL.md\`."*, or point Codex at`,
      '> this file in your prompt. Any scripts and reference files live next to this SKILL.md.',
    ].join('\n'),
    description: (d) => d,
  },
  zero: {
    h1: ' (Zero CLI)',
    marker: /^> \*\*Installing in Zero CLI\.\*\*/,
    fallback: (skill) => [
      '> **Installing in Zero CLI.** Zero discovers skills from a `skills/` directory — project',
      '> `.zero/skills/` or global `~/.zero/skills/`. Copy this skill directory there:',
      `> \`mkdir -p ~/.zero/skills && cp -R <8x-skills>/zero/${skill} ~/.zero/skills/\`. Any scripts and`,
      '> reference files live next to this SKILL.md.',
    ].join('\n'),
    description: (d) => (d.endsWith(' Runs from Zero CLI.') ? d : d + ' Runs from Zero CLI.'),
  },
}

function existingBlockquote(file, marker) {
  if (!existsSync(file)) return null
  const lines = readFileSync(file, 'utf8').split('\n')
  const start = lines.findIndex((l) => marker.test(l))
  if (start < 0) return null
  let end = start
  while (end + 1 < lines.length && lines[end + 1].startsWith('>')) end++
  return lines.slice(start, end + 1).join('\n')
}

function transformSkill(md, variant, skill, prior) {
  const v = VARIANTS[variant]
  const lines = md.split('\n')
  // frontmatter description
  if (lines[0] === '---') {
    const close = lines.indexOf('---', 1)
    for (let i = 1; i < close; i++) {
      if (lines[i].startsWith('description: ')) lines[i] = 'description: ' + v.description(lines[i].slice('description: '.length))
    }
  }
  const h1 = lines.findIndex((l) => l.startsWith('# '))
  if (h1 < 0) throw new Error(`${skill}: SKILL.md has no H1`)
  if (!lines[h1].endsWith(v.h1)) {
    // "# Title — subtitle" → "# Title (Variant) — subtitle"
    const dash = lines[h1].indexOf(' — ')
    lines[h1] = dash > 0 ? lines[h1].slice(0, dash) + v.h1 + lines[h1].slice(dash) : lines[h1] + v.h1
  }
  // first paragraph after the H1 → insert blockquote after it
  let i = h1 + 1
  while (i < lines.length && lines[i].trim() === '') i++
  while (i < lines.length && lines[i].trim() !== '') i++
  const quote = existingBlockquote(prior, v.marker) || v.fallback(skill)
  lines.splice(i, 0, '', quote)
  return lines.join('\n')
}

let changed = 0
for (const skill of readdirSync(SRC).filter((d) => statSync(path.join(SRC, d)).isDirectory())) {
  for (const variant of Object.keys(VARIANTS)) {
    const dst = path.join(root, variant, skill)
    mkdirSync(dst, { recursive: true })
    for (const sub of ['scripts', 'reference', 'references']) {
      const from = path.join(SRC, skill, sub)
      if (!existsSync(from)) continue
      const to = path.join(dst, sub)
      const before = snapshot(to)
      if (!check) { rmSync(to, { recursive: true, force: true }); cpSync(from, to, { recursive: true }) }
      if (before !== snapshot(from)) { changed++; if (check) console.log(`would update ${variant}/${skill}/${sub}`) }
    }
    const target = path.join(dst, 'SKILL.md')
    const next = transformSkill(readFileSync(path.join(SRC, skill, 'SKILL.md'), 'utf8'), variant, skill, target)
    const prev = existsSync(target) ? readFileSync(target, 'utf8') : ''
    if (prev !== next) {
      changed++
      if (check) console.log(`would update ${variant}/${skill}/SKILL.md`)
      else writeFileSync(target, next)
    }
  }
}

function snapshot(dir) {
  if (!existsSync(dir)) return ''
  const out = []
  const walk = (d) => {
    for (const name of readdirSync(d).sort()) {
      const p = path.join(d, name)
      if (statSync(p).isDirectory()) walk(p)
      else out.push(path.relative(dir, p) + ':' + readFileSync(p).toString('base64'))
    }
  }
  walk(dir)
  return out.join('\n')
}

if (check) {
  if (changed) { console.error(`${changed} mirror file(s) out of date — run node scripts/sync-variants.mjs`); process.exit(1) }
  console.log('mirrors in sync')
} else {
  console.log(`synced ${changed} file(s)/dir(s)`)
}
