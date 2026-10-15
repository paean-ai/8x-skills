import assert from 'node:assert/strict'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import test from 'node:test'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

test('sync generates all client variants, preserves resources, and detects drift without writing', t => {
  const root = mkdtempSync(path.join(tmpdir(), '8x-sync with spaces-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  mkdirSync(path.join(root, 'scripts'))
  const script = path.join(root, 'scripts/sync-variants.mjs')
  copyFileSync(path.join(repoRoot, 'scripts/sync-variants.mjs'), script)
  const source = path.join(root, 'claude-code/paean-example')
  const resources = {
    'scripts/run.mjs': Buffer.from('console.log("example")\n'),
    'reference/data.bin': Buffer.from([0, 255, 13, 10]),
    'references/guide.md': Buffer.from('# Guide\n'),
  }
  mkdirSync(source, { recursive: true })
  const entry = '---\nname: paean-example\ndescription: A portable example\n---\n\n# Example — workflow\n\nDo the work.\n\n## Steps\n\nUse [the guide](references/guide.md).\n'
  writeFileSync(path.join(source, 'SKILL.md'), entry)
  for (const [name, bytes] of Object.entries(resources)) {
    mkdirSync(path.dirname(path.join(source, name)), { recursive: true })
    writeFileSync(path.join(source, name), bytes)
  }
  const run = (...args) => spawnSync(process.execPath, [script, ...args], { cwd: tmpdir(), encoding: 'utf8' })
  const variants = { codex: 'Codex', zero: 'Zero CLI', gemini: 'Gemini CLI', cursor: 'Cursor' }
  assert.equal(run('--check').status, 1)
  for (const variant of Object.keys(variants)) assert.equal(existsSync(path.join(root, variant)), false)
  assert.equal(run().status, 0)
  const entries = new Map()
  for (const [variant, label] of Object.entries(variants)) {
    const target = path.join(root, variant, 'paean-example')
    const content = readFileSync(path.join(target, 'SKILL.md'), 'utf8')
    assert.ok(content.startsWith('---\nname: paean-example\n'))
    assert.ok(content.includes(`# Example (${label}) — workflow`))
    assert.ok(content.endsWith('## Steps\n\nUse [the guide](references/guide.md).\n'))
    entries.set(target, content)
    for (const [name, bytes] of Object.entries(resources)) assert.deepEqual(readFileSync(path.join(target, name)), bytes)
  }
  assert.equal(run().status, 0)
  for (const [target, content] of entries) assert.equal(readFileSync(path.join(target, 'SKILL.md'), 'utf8'), content)
  assert.equal(run('--check').status, 0)
  assert.equal(readFileSync(path.join(source, 'SKILL.md'), 'utf8'), entry)
  const changed = path.join(root, 'cursor/paean-example/references/guide.md')
  writeFileSync(changed, 'local drift\n')
  assert.equal(run('--check').status, 1)
  assert.equal(readFileSync(changed, 'utf8'), 'local drift\n')
  assert.equal(run().status, 0)
  assert.deepEqual(readFileSync(changed), resources['references/guide.md'])
  assert.equal(run('--check').status, 0)
})
