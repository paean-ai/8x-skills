// Guards for the published skill text: no one's local paths, one script-path placeholder.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SKILL_ROOTS = ['claude-code', 'codex', 'zero', 'gemini', 'cursor', 'redskill']
const TEXT = new Set(['.md', '.mjs', '.js', '.css', '.py', '.json'])

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const file = path.join(dir, name)
    if (statSync(file).isDirectory()) walk(file, out)
    else if (TEXT.has(path.extname(name))) out.push(file)
  }
  return out
}

const published = [...SKILL_ROOTS.flatMap((r) => walk(path.join(root, r))), path.join(root, 'README.md')]
const read = (file) => readFileSync(file, 'utf8')
const rel = (file) => path.relative(root, file)

test('published files contain no personal machine paths', () => {
  const personal = /\/Users\/[\w.-]+\/|\/home\/[\w.-]+\/|~\/(?:Zero|a8e)\//
  assert.deepEqual(published.filter((f) => personal.test(read(f))).map(rel), [])
})

test('skill docs use $SKILL_DIR, not legacy placeholders', () => {
  const legacy = /<skill>|<skill-dir>|<skill-directory>/
  // The README is written for people, who fill in <skill-dir> themselves.
  const docs = published.filter((f) => f.endsWith('.md') && path.basename(f) !== 'README.md')
  assert.deepEqual(docs.filter((f) => legacy.test(read(f))).map(rel), [])
})

test('every SKILL.md that uses $SKILL_DIR defines it', () => {
  const defined = /(?:Let|把) `\$SKILL_DIR`|`\$SKILL_DIR` is/
  const undefinedUse = published
    .filter((f) => path.basename(f) === 'SKILL.md')
    .filter((f) => read(f).includes('$SKILL_DIR') && !defined.test(read(f)))
  assert.deepEqual(undefinedUse.map(rel), [])
})
