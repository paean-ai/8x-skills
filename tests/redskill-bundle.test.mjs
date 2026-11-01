import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import { assembleBundle, buildBundle } from '../scripts/build-redskill.mjs'
import { extractZip, listZip } from '../claude-code/paean-publish/scripts/zip.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const sha256 = (data) => createHash('sha256').update(data).digest('hex')
function temporary(t) {
  const dir = mkdtempSync(path.join(tmpdir(), '8x-redskill-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}

test('the install ZIP has a root entry, complete references and byte-identical canonical resources', (t) => {
  const outDir = temporary(t)
  const result = buildBundle({ outDir })
  const archive = readFileSync(result.archive)
  const names = listZip(archive)
  assert.ok(names.includes('SKILL.md'))
  assert.ok(names.includes('LICENSE'))
  assert.ok(names.includes('workflows/paean-sdk/reference/design-iap.md'))
  assert.ok(names.every((name) => !name.startsWith(`${result.name}/`) && !name.includes('node_modules/')))
  const detached = path.join(outDir, 'fresh install with spaces')
  extractZip(archive, detached)
  const manifest = JSON.parse(readFileSync(path.join(detached, 'bundle-manifest.json')))
  for (const file of manifest.files) {
    const data = readFileSync(path.join(detached, file.path))
    assert.deepEqual(data, readFileSync(path.join(root, file.source)), file.path)
    assert.equal(sha256(data), file.sha256)
    assert.equal(data.length, file.bytes)
  }
  const validator = spawnSync(process.execPath, [path.join(detached, 'workflows/paean-game-create/scripts/validate-game.mjs'), '--help'], { cwd: outDir, encoding: 'utf8' })
  assert.equal(validator.status, 0, validator.stderr)
  for (const name of names.filter((name) => name.endsWith('.mjs'))) {
    const check = spawnSync(process.execPath, ['--check', path.join(detached, name)], { cwd: outDir, encoding: 'utf8' })
    assert.equal(check.status, 0, `${name}: ${check.stderr}`)
  }
})

test('a detached bundle can inspect real offline output and detect a network capability', async (t) => {
  const outDir = temporary(t)
  const built = buildBundle({ outDir })
  const detached = path.join(outDir, 'installed')
  extractZip(readFileSync(built.archive), detached)
  const work = path.join(outDir, 'work')
  mkdirSync(work)
  writeFileSync(path.join(work, 'index.html'), '<!doctype html><html><head><title>试用</title></head><body><script src="app.js"></script></body></html>')
  writeFileSync(path.join(work, 'app.js'), 'document.body.dataset.ready = "true";')
  const { selfCheck } = await import(pathToFileURL(path.join(detached, 'workflows/paean-convert-to-rednote/scripts/minitool-pipeline.mjs')).href)
  assert.deepEqual(selfCheck(work), [])
  writeFileSync(path.join(work, 'app.js'), 'fetch("https://example.com/api");')
  assert.ok(selfCheck(work).some((problem) => problem.includes('fetch')))
  const audit = spawnSync(process.execPath, [path.join(detached, 'workflows/paean-convert-to-rednote/scripts/audit-minitool.mjs'), work], { encoding: 'utf8', cwd: outDir })
  assert.equal(audit.status, 0, audit.stderr) // size audit is intentionally separate from capability checking
})

test('identical source produces identical ZIP bytes; check detects drift without rewriting it', (t) => {
  const outDir = temporary(t)
  const first = buildBundle({ outDir })
  const before = readFileSync(first.archive)
  assert.equal(buildBundle({ outDir }).sha256, first.sha256)
  assert.deepEqual(readFileSync(first.archive), before)
  assert.equal(buildBundle({ outDir, check: true }).mode, 'checked')
  const skill = path.join(first.directory, 'SKILL.md')
  writeFileSync(skill, 'changed locally')
  assert.throws(() => buildBundle({ outDir, check: true }), /stale/)
  assert.equal(readFileSync(skill, 'utf8'), 'changed locally')
  assert.deepEqual(readFileSync(first.archive), before)
})

test('output cannot replace repository sources or an unrelated directory', (t) => {
  const outDir = temporary(t)
  assert.throws(() => buildBundle({ outDir: path.join(root, 'redskill') }), /inside dist/)
  const target = path.join(outDir, 'paean-rednote-create')
  mkdirSync(target)
  writeFileSync(path.join(target, 'keep.txt'), 'user file')
  assert.throws(() => buildBundle({ outDir }), /unowned directory/)
  assert.equal(readFileSync(path.join(target, 'keep.txt'), 'utf8'), 'user file')
  const missing = path.join(outDir, 'missing')
  assert.throws(() => buildBundle({ outDir: missing, check: true }), /Build is missing/)
  assert.equal(existsSync(missing), false)
})

test('a broken reference or symlink fails before a release can be emitted', (t) => {
  const fixture = temporary(t)
  cpSync(path.join(root, 'redskill'), path.join(fixture, 'redskill'), { recursive: true })
  cpSync(path.join(root, 'claude-code'), path.join(fixture, 'claude-code'), { recursive: true })
  cpSync(path.join(root, 'LICENSE'), path.join(fixture, 'LICENSE'))
  const skill = path.join(fixture, 'redskill/paean-rednote-create/SKILL.md')
  const source = readFileSync(skill, 'utf8')
  writeFileSync(skill, source + '\n[Missing companion](references/absent.md)\n')
  assert.throws(() => assembleBundle(fixture), /Unbundled reference/)
  writeFileSync(skill, source)
  const file = path.join(fixture, 'redskill/paean-rednote-create/references/external.md')
  symlinkSync(path.join(root, 'README.md'), file)
  assert.throws(() => assembleBundle(fixture), /Symlinks/)
})
