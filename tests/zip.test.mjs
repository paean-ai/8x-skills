/*
 * The skills pack and unpack archives in-process (scripts/zip.mjs) instead of
 * shelling out to `zip` / `unzip`, which do not exist on Windows. These tests
 * pin the parts that a hand-written ZIP writer gets wrong: header/central-
 * directory agreement, deflate-vs-store selection, path separators, round
 * trips, and the traversal guard that `unzip -o` never had.
 */
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { existsSync, writeFileSync, mkdirSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

const repoRoot = path.resolve(import.meta.dirname, '..')
// One canonical copy; sync-variants keeps the other skills byte-identical.
const zipMod = path.join(repoRoot, 'codex/paean-publish/scripts/zip.mjs')
const { createZip, createZipFromDir, extractZip, listZip, zipEntries, zipEntryName } = await import(zipMod)

async function tmpTree() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'paean-zip-test-'))
  mkdirSync(path.join(root, 'sub', 'deep'), { recursive: true })
  writeFileSync(path.join(root, 'index.html'), '<!doctype html><title>x</title>'.repeat(40))
  writeFileSync(path.join(root, 'sub', 'app.js'), 'console.log("hi")')
  writeFileSync(path.join(root, 'sub', 'deep', 'tiny.txt'), 'x')
  writeFileSync(path.join(root, 'bin.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]))
  return root
}

const TREE_FILES = ['index.html', 'sub/app.js', 'sub/deep/tiny.txt', 'bin.png']

test('archives round-trip byte-for-byte through extractZip', async () => {
  const src = await tmpTree()
  const dest = await mkdtemp(path.join(os.tmpdir(), 'paean-zip-out-'))
  try {
    const buf = createZipFromDir(src, TREE_FILES)
    assert.deepEqual(listZip(buf).sort(), [...TREE_FILES].sort())
    assert.equal(extractZip(buf, dest), TREE_FILES.length)
    for (const rel of TREE_FILES) {
      assert.deepEqual(await readFile(path.join(dest, rel)), await readFile(path.join(src, rel)),
        `content differs for ${rel}`)
    }
  } finally {
    await rm(src, { recursive: true, force: true })
    await rm(dest, { recursive: true, force: true })
  }
})

test('output is deterministic and uses forward-slash entry names', async () => {
  const src = await tmpTree()
  try {
    const a = createZipFromDir(src, TREE_FILES)
    const b = createZipFromDir(src, TREE_FILES)
    assert.deepEqual(a, b, 'two builds of the same tree must produce identical bytes')
    assert.ok(listZip(a).every(name => !name.includes('\\')), 'entry names must not contain backslashes')
    // Names are normalised even when handed OS-native separators.
    assert.equal(zipEntryName(path.join('sub', 'app.js')), 'sub/app.js')
    assert.equal(zipEntryName('./a/b.js'), 'a/b.js')
  } finally {
    await rm(src, { recursive: true, force: true })
  }
})

test('compressible data is deflated, incompressible data is stored', () => {
  const text = Buffer.from('a'.repeat(4096))
  const random = Buffer.from(Array.from({ length: 64 }, (_, i) => (i * 37 + 11) % 256))
  const entries = zipEntries(createZip([{ name: 'text.js', data: text }, { name: 'r.bin', data: random }]))
  const byName = Object.fromEntries(entries.map(e => [e.name, e]))
  assert.equal(byName['text.js'].size, text.length)
  assert.ok(byName['text.js'].compressedSize < text.length, 'repetitive text should deflate')
  assert.equal(byName['r.bin'].compressedSize, random.length, 'incompressible data should be stored, not grown')
})

test('empty files and an empty archive are still valid', () => {
  const buf = createZip([{ name: 'empty.txt', data: Buffer.alloc(0) }])
  assert.deepEqual(zipEntries(buf), [{ name: 'empty.txt', size: 0, compressedSize: 0 }])
  assert.deepEqual(listZip(createZip([])), [])
})

/*
 * createZip normalises names on the way in, so a hostile archive has to be
 * forged at the byte level — which is exactly what a hostile archive is. The
 * placeholder is the same length as the name it becomes, so every offset in the
 * local and central headers stays correct.
 */
function forgeName(placeholder, name, data = 'pwned') {
  assert.equal(placeholder.length, name.length, 'forged name must not change any offset')
  const buf = createZip([{ name: placeholder, data }])
  return Buffer.from(buf.toString('latin1').split(placeholder).join(name), 'latin1')
}

test('extraction refuses entries that escape the destination', async () => {
  const dest = await mkdtemp(path.join(os.tmpdir(), 'paean-zip-evil-'))
  const out = path.join(dest, 'out')
  try {
    const hostile = [
      ['relative traversal', createZip([{ name: '../escaped.txt', data: 'pwned' }])],
      ['traversal below a subdirectory', createZip([{ name: 'a/../../escaped.txt', data: 'pwned' }])],
      ['absolute path', forgeName('_etc/passwd', '/etc/passwd')],
      ['windows drive letter', forgeName('_:/Windows/x', 'C:/Windows/x')],
      ['backslash traversal', forgeName('xxxxxxescaped.txt', '..\\..\\escaped.txt')],
    ]
    for (const [label, buf] of hostile) {
      assert.throws(() => extractZip(buf, out), /escapes the target directory/, `${label} should be rejected`)
    }
    assert.ok(!existsSync(path.join(dest, 'escaped.txt')), 'nothing may land outside the destination')
    assert.ok(!existsSync(path.join(repoRoot, 'escaped.txt')))
  } finally {
    await rm(dest, { recursive: true, force: true })
  }
})

test('corrupt input is reported rather than half-extracted', async () => {
  const dest = await mkdtemp(path.join(os.tmpdir(), 'paean-zip-bad-'))
  try {
    assert.throws(() => listZip(Buffer.from('not a zip at all')), /Not a ZIP archive/)
    const name = 'a.txt'
    const buf = createZip([{ name, data: 'hello world hello world hello world' }])
    buf[30 + name.length + 4] ^= 0xff // a byte inside the deflated payload
    assert.throws(() => extractZip(buf, dest), /CRC mismatch|incorrect|invalid|unexpected/i)
  } finally {
    await rm(dest, { recursive: true, force: true })
  }
})

// The archives are consumed by other unzip implementations (the Clide upload
// endpoint, the RedNote container, Google Ads), so agreement with a reference
// implementation matters more than self-consistency. Skipped where unzip is
// absent — notably on Windows, which is the whole reason this module exists.
test('a system unzip accepts the archive', { skip: !hasUnzip() }, async () => {
  const src = await tmpTree()
  const dest = await mkdtemp(path.join(os.tmpdir(), 'paean-zip-sys-'))
  try {
    const zipPath = path.join(dest, 'site.zip')
    writeFileSync(zipPath, createZipFromDir(src, TREE_FILES))
    execFileSync('unzip', ['-t', zipPath], { stdio: 'pipe' })
    execFileSync('unzip', ['-q', '-o', zipPath, '-d', path.join(dest, 'out')], { stdio: 'pipe' })
    for (const rel of TREE_FILES) {
      assert.deepEqual(await readFile(path.join(dest, 'out', rel)), await readFile(path.join(src, rel)))
    }
  } finally {
    await rm(src, { recursive: true, force: true })
    await rm(dest, { recursive: true, force: true })
  }
})

function hasUnzip() {
  try { execFileSync('unzip', ['-v'], { stdio: 'ignore' }); return true } catch { return false }
}
