import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { installSkills, resolveTarget } from '../scripts/install-skills.mjs'

function fixture(t) {
  const root = mkdtempSync(path.join(tmpdir(), '8x-install-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const repoRoot = path.join(root, 'repo with spaces')
  const home = path.join(root, 'home')
  for (const variant of ['claude-code', 'codex', 'zero']) {
    const skill = path.join(repoRoot, variant, 'paean-example')
    mkdirSync(path.join(skill, 'scripts'), { recursive: true })
    writeFileSync(path.join(skill, 'SKILL.md'), `---\nname: paean-example\ndescription: Example\n---\n${variant}\n`)
    writeFileSync(path.join(skill, 'scripts/run.mjs'), 'console.log("example")\n')
  }
  return { repoRoot, home, env: {}, targets: ['gemini'] }
}

test('client destinations distinguish Gemini, Antigravity surfaces, Codex, and Harness overrides', () => {
  const home = path.resolve('fixture-home')
  const options = { home, env: {} }
  assert.equal(resolveTarget('gemini', options).destination, path.join(home, '.gemini/skills'))
  assert.equal(resolveTarget('antigravity', options).destination, path.join(home, '.gemini/config/skills'))
  assert.equal(resolveTarget('antigravity-cli', options).destination, path.join(home, '.gemini/antigravity-cli/skills'))
  assert.equal(resolveTarget('codex', options).destination, path.join(home, '.agents/skills'))
  assert.equal(resolveTarget('deepseek-harness', options).destination, path.join(home, '.dsh/skills'))
  const custom = path.join(home, 'custom-dsh')
  assert.equal(resolveTarget('deepseek-harness', { home, env: { DSH_HOME: custom } }).destination, path.join(custom, 'skills'))
  assert.equal(resolveTarget('deepseek-harness', { home, env: { DSH_HOME: '  ' } }).destination, path.join(home, '.dsh/skills'))
  assert.equal(resolveTarget('codex', { ...options, dest: path.join(home, '.codex/skills') }).destination, path.join(home, '.codex/skills'))
})

test('dry-run/check do not create roots; install copies the complete skill and is idempotent', t => {
  const opts = fixture(t)
  const [preview] = installSkills({ ...opts, dryRun: true })
  assert.equal(preview.changedFiles, 2)
  assert.equal(existsSync(opts.home), false)
  assert.equal(installSkills({ ...opts, check: true })[0].changedFiles, 2)
  assert.equal(existsSync(opts.home), false)
  const [result] = installSkills(opts)
  assert.equal(result.backup, null)
  assert.equal(readFileSync(path.join(result.destination, 'paean-example/scripts/run.mjs'), 'utf8'), 'console.log("example")\n')
  assert.equal(installSkills({ ...opts, check: true })[0].changedFiles, 0)
  assert.equal(installSkills(opts)[0].changedFiles, 0)
})

test('updates back up overwritten files and preserve custom metadata and unrelated skills', t => {
  const opts = fixture(t)
  const [initial] = installSkills(opts)
  const entry = path.join(initial.destination, 'paean-example/SKILL.md')
  writeFileSync(entry, 'local edit')
  const metadata = path.join(initial.destination, 'paean-example/agents/openai.yaml')
  mkdirSync(path.dirname(metadata), { recursive: true })
  writeFileSync(metadata, 'custom metadata')
  const other = path.join(initial.destination, 'my-custom/SKILL.md')
  mkdirSync(path.dirname(other))
  writeFileSync(other, 'unrelated skill')
  const [updated] = installSkills(opts)
  assert.equal(updated.changedFiles, 1)
  assert.equal(readFileSync(path.join(updated.backup, 'paean-example/SKILL.md'), 'utf8'), 'local edit')
  assert.equal(path.relative(initial.destination, updated.backup).startsWith('..'), true)
  assert.equal(readFileSync(metadata, 'utf8'), 'custom metadata')
  assert.equal(readFileSync(other, 'utf8'), 'unrelated skill')
  assert.equal(installSkills({ ...opts, check: true })[0].changedFiles, 0)
})

test('destination symlinks fail preflight before any selected target is updated', t => {
  const opts = fixture(t)
  const destination = resolveTarget('deepseek-harness', opts).destination
  mkdirSync(destination, { recursive: true })
  const source = path.join(opts.repoRoot, 'claude-code/paean-example')
  symlinkSync(source, path.join(destination, 'paean-example'), 'dir')
  assert.throws(() => installSkills({ ...opts, targets: ['gemini', 'deepseek-harness'] }), /destination symlink/)
  assert.equal(existsSync(resolveTarget('gemini', opts).destination), false)
  assert.equal(readFileSync(path.join(source, 'SKILL.md'), 'utf8').endsWith('claude-code\n'), true)
})

test('invalid targets, ambiguous destinations, and repository overlap fail without writing', t => {
  const opts = fixture(t)
  assert.throws(() => installSkills({ ...opts, targets: ['unknown'] }), /Unknown target/)
  assert.throws(() => installSkills({ ...opts, targets: ['gemini', 'gemini'] }), /distinct/)
  assert.throws(() => installSkills({ ...opts, targets: ['codex', 'zero'], dest: opts.home }), /exactly one/)
  assert.throws(() => installSkills({ ...opts, check: true, dryRun: true }), /Choose/)
  assert.throws(() => installSkills({ ...opts, dest: path.join(opts.repoRoot, 'codex') }), /overlaps/)
  assert.equal(existsSync(opts.home), false)
})
