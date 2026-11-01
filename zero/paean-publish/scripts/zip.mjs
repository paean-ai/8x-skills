/*
 * zip.mjs — a dependency-free ZIP writer/reader.
 *
 * The skills used to shell out to `zip` / `unzip`. Neither ships with Windows,
 * so every packaging step failed there; `Compress-Archive` is not a drop-in
 * replacement either (older PowerShell writes backslash separators, which the
 * upload endpoints and the RedNote container both reject). Node already has
 * everything needed — zlib for deflate, Buffer for the headers — so the archive
 * is built here and the output is byte-identical on macOS, Linux and Windows.
 *
 * Deliberate properties:
 *   - entry names are always forward-slash separated (ZIP spec, APPNOTE 4.4.17.1)
 *   - a fixed 1980-01-01 DOS timestamp, so two builds of the same tree match
 *   - no extra fields and no directory entries (what `zip -X` produced before)
 *   - extraction refuses absolute paths and `..` traversal (`unzip` did not)
 *
 * No Zip64: these bundles are capped well below 4 GiB, and a clear error beats
 * a silently truncated archive.
 */
import { deflateRawSync, inflateRawSync } from 'node:zlib'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const LOCAL_SIG = 0x04034b50
const CENTRAL_SIG = 0x02014b50
const EOCD_SIG = 0x06054b50
const DOS_EPOCH_TIME = 0 // 00:00:00
const DOS_EPOCH_DATE = 0x0021 // 1980-01-01
const MAX_U32 = 0xffffffff
const MAX_ENTRIES = 0xffff

const CRC_TABLE = (() => {
  const table = new Int32Array(256)
  for (let i = 0; i < 256; i++) {
    let c = i
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[i] = c
  }
  return table
})()

function crc32(buf) {
  let c = -1
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ -1) >>> 0
}

/** Normalise an entry name to the ZIP form: forward slashes, no leading `./` or `/`. */
export function zipEntryName(name) {
  return String(name).split(path.sep).join('/').replace(/^\.\//, '').replace(/^\/+/, '')
}

/**
 * Build a ZIP archive.
 * @param {Array<{name: string, data: Buffer|Uint8Array|string}>} entries
 * @returns {Buffer}
 */
export function createZip(entries) {
  if (entries.length > MAX_ENTRIES) {
    throw new Error(`Too many files for a non-Zip64 archive: ${entries.length} (limit ${MAX_ENTRIES})`)
  }
  const chunks = []
  const central = []
  let offset = 0

  for (const entry of entries) {
    const name = Buffer.from(zipEntryName(entry.name), 'utf8')
    const data = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data)
    const crc = crc32(data)
    // Store rather than deflate when compression does not pay — matches what
    // `zip` does and keeps already-compressed assets (png/woff2) from growing.
    const deflated = data.length ? deflateRawSync(data, { level: 9 }) : Buffer.alloc(0)
    const store = deflated.length >= data.length
    const body = store ? data : deflated
    const method = store ? 0 : 8

    if (offset > MAX_U32 || body.length > MAX_U32) {
      throw new Error('Archive exceeds the 4 GiB non-Zip64 limit')
    }

    const local = Buffer.alloc(30)
    local.writeUInt32LE(LOCAL_SIG, 0)
    local.writeUInt16LE(20, 4) // version needed
    local.writeUInt16LE(0x0800, 6) // UTF-8 names
    local.writeUInt16LE(method, 8)
    local.writeUInt16LE(DOS_EPOCH_TIME, 10)
    local.writeUInt16LE(DOS_EPOCH_DATE, 12)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(body.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(name.length, 26)
    local.writeUInt16LE(0, 28) // no extra field
    chunks.push(local, name, body)

    const dir = Buffer.alloc(46)
    dir.writeUInt32LE(CENTRAL_SIG, 0)
    dir.writeUInt16LE(20, 4) // version made by (MS-DOS, 2.0)
    dir.writeUInt16LE(20, 6)
    dir.writeUInt16LE(0x0800, 8)
    dir.writeUInt16LE(method, 10)
    dir.writeUInt16LE(DOS_EPOCH_TIME, 12)
    dir.writeUInt16LE(DOS_EPOCH_DATE, 14)
    dir.writeUInt32LE(crc, 16)
    dir.writeUInt32LE(body.length, 20)
    dir.writeUInt32LE(data.length, 24)
    dir.writeUInt16LE(name.length, 28)
    dir.writeUInt16LE(0, 30) // extra
    dir.writeUInt16LE(0, 32) // comment
    dir.writeUInt16LE(0, 34) // disk
    dir.writeUInt16LE(0, 36) // internal attrs
    dir.writeUInt32LE(0, 38) // external attrs
    dir.writeUInt32LE(offset, 42)
    central.push(dir, name)

    offset += local.length + name.length + body.length
  }

  const centralBuf = Buffer.concat(central)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(EOCD_SIG, 0)
  eocd.writeUInt16LE(0, 4)
  eocd.writeUInt16LE(0, 6)
  eocd.writeUInt16LE(entries.length, 8)
  eocd.writeUInt16LE(entries.length, 10)
  eocd.writeUInt32LE(centralBuf.length, 12)
  eocd.writeUInt32LE(offset, 16)
  eocd.writeUInt16LE(0, 20)
  return Buffer.concat([...chunks, centralBuf, eocd])
}

/**
 * Build a ZIP from files on disk.
 * @param {string} rootDir     directory the names are relative to
 * @param {string[]} relFiles  relative paths (either separator)
 */
export function createZipFromDir(rootDir, relFiles) {
  return createZip(relFiles.map(rel => ({
    name: zipEntryName(rel),
    data: readFileSync(path.join(rootDir, rel)),
  })))
}

function readEntries(buf) {
  // The EOCD sits at the end, after an optional comment (≤64 KiB).
  let eocd = -1
  for (let i = buf.length - 22; i >= 0 && i >= buf.length - 22 - 0xffff; i--) {
    if (buf.readUInt32LE(i) === EOCD_SIG) { eocd = i; break }
  }
  if (eocd < 0) throw new Error('Not a ZIP archive (no end-of-central-directory record)')
  const count = buf.readUInt16LE(eocd + 10)
  let p = buf.readUInt32LE(eocd + 16)
  if (p === MAX_U32) throw new Error('Zip64 archives are not supported')

  const entries = []
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== CENTRAL_SIG) throw new Error('Corrupt ZIP central directory')
    const method = buf.readUInt16LE(p + 10)
    const crc = buf.readUInt32LE(p + 16)
    const csize = buf.readUInt32LE(p + 20)
    const usize = buf.readUInt32LE(p + 24)
    const nameLen = buf.readUInt16LE(p + 28)
    const extraLen = buf.readUInt16LE(p + 30)
    const commentLen = buf.readUInt16LE(p + 32)
    const localOffset = buf.readUInt32LE(p + 42)
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen)
    entries.push({ name, method, crc, csize, usize, localOffset })
    p += 46 + nameLen + extraLen + commentLen
  }
  return entries
}

function entryData(buf, entry) {
  if (buf.readUInt32LE(entry.localOffset) !== LOCAL_SIG) throw new Error('Corrupt ZIP local header for ' + entry.name)
  const nameLen = buf.readUInt16LE(entry.localOffset + 26)
  const extraLen = buf.readUInt16LE(entry.localOffset + 28)
  const start = entry.localOffset + 30 + nameLen + extraLen
  const raw = buf.subarray(start, start + entry.csize)
  let data
  if (entry.method === 0) data = Buffer.from(raw)
  else if (entry.method === 8) data = inflateRawSync(raw)
  else throw new Error(`Unsupported ZIP compression method ${entry.method} for ${entry.name}`)
  if (crc32(data) !== entry.crc) throw new Error('CRC mismatch extracting ' + entry.name)
  return data
}

/**
 * Extract an archive to `destDir`. Entries that escape the destination
 * (absolute paths, `..`, drive letters) are rejected rather than skipped —
 * a source archive that tries it is not one to trust the rest of.
 * @returns {number} files written
 */
export function extractZip(buffer, destDir) {
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer)
  const root = path.resolve(destDir)
  mkdirSync(root, { recursive: true })
  let written = 0
  for (const entry of readEntries(buf)) {
    if (entry.name.endsWith('/')) continue // directory marker
    const name = entry.name.replace(/\\/g, '/')
    if (name.startsWith('/') || /^[a-zA-Z]:/.test(name) || name.split('/').includes('..')) {
      throw new Error('Refusing to extract an entry that escapes the target directory: ' + entry.name)
    }
    const target = path.resolve(root, name)
    if (target !== root && !target.startsWith(root + path.sep)) {
      throw new Error('Refusing to extract an entry that escapes the target directory: ' + entry.name)
    }
    mkdirSync(path.dirname(target), { recursive: true })
    writeFileSync(target, entryData(buf, entry))
    written++
  }
  return written
}

/** Names of the files in an archive, without extracting. */
export function listZip(buffer) {
  return zipEntries(buffer).map(e => e.name)
}

/** `{ name, size, compressedSize }` per file, without inflating anything. */
export function zipEntries(buffer) {
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer)
  return readEntries(buf)
    .filter(e => !e.name.endsWith('/'))
    .map(e => ({ name: e.name, size: e.usize, compressedSize: e.csize }))
}
