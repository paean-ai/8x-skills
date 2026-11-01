import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import http from 'node:http'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { gzipSync } from 'node:zlib'
import test from 'node:test'
import { MAX_BYTES, prepareJSONL, submitSession } from '../claude-code/paean-sessions/scripts/sessions.mjs'

const script = path.resolve(import.meta.dirname, '../claude-code/paean-sessions/scripts/sessions.mjs')
const record = Buffer.from('{"message":"real creation event","api_key":"private-value"}\n')

async function mock(t, handler) {
  const requests = []
  const server = http.createServer(async (req, res) => {
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    const r = { url: req.url, method: req.method, headers: req.headers, body: Buffer.concat(chunks) }
    requests.push(r)
    res.setHeader('Content-Type', 'application/json')
    await handler(r, res)
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise(resolve => server.close(resolve)))
  return { requests, apiBase: `http://127.0.0.1:${server.address().port}` }
}
const data = (res, value) => res.end(JSON.stringify({ data: value }))

test('JSONL preparation validates, normalizes and redacts without changing original bytes', () => {
  const before = Buffer.from(record)
  const prepared = prepareJSONL(record)
  assert.equal(prepared.records, 1)
  assert.ok(prepared.transformed)
  assert.deepEqual(record, before)
  assert.equal(JSON.parse(prepared.bytes).api_key, '[REDACTED]')
  assert.deepEqual(prepareJSONL(gzipSync(record)).bytes, prepared.bytes)
  assert.equal(prepareJSONL(prepared.bytes).digest, prepared.digest)
  const strings = prepareJSONL(Buffer.from(JSON.stringify({ text: 'Bearer abc.def secret=abc sk-1234567890abcdefghi', credentials: { nested: 'sensitive' } })))
  assert.doesNotMatch(strings.bytes.toString(), /abc|1234567890|sensitive/)
})

test('malformed, oversized, deeply nested and non-object records fail locally', () => {
  for (const input of ['', 'null', '[]', '1', '{oops}', '{"x":1}\n[]', Buffer.from([0xff])]) {
    assert.throws(() => prepareJSONL(Buffer.from(input)))
  }
  assert.throws(() => prepareJSONL(Buffer.from('{"text":"' + 'a'.repeat(1024 * 1024) + '"}')), /exceeds_1mb/)
  assert.throws(() => prepareJSONL(Buffer.from('{}\n'.repeat(50001))), /50000/)
  assert.throws(() => prepareJSONL(gzipSync(Buffer.alloc(MAX_BYTES + 1, 32))), /oversized_gzip/)
  assert.throws(() => prepareJSONL(Buffer.from('{"x":'.repeat(42) + '0' + '}'.repeat(42))), /nesting/)
})

test('prepare preserves originals, uses private permissions and refuses overwrite; dry-run is offline', t => {
  const dir = mkdtempSync(path.join(tmpdir(), 'paean-session-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const file = path.join(dir, 'source.jsonl'), out = path.join(dir, 'prepared.jsonl')
  writeFileSync(file, record)
  const run = (...args) => spawnSync(process.execPath, [script, ...args], {
    encoding: 'utf8', env: { ...process.env, PAEAN_API_BASE: 'http://127.0.0.1:1', PAEAN_AUTH_TOKEN: '' },
  })
  assert.equal(run('prepare', '--file', file, '--out', out).status, 0)
  assert.deepEqual(readFileSync(file), record)
  if (process.platform !== 'win32') assert.equal(statSync(out).mode & 0o777, 0o600)
  assert.equal(run('prepare', '--file', file, '--out', out).status, 1)
  const dry = run('submit', '--file', out, '--app', 'app-1', '--dry-run')
  assert.equal(dry.status, 0, dry.stderr)
  assert.equal(JSON.parse(dry.stdout).private, true)
  assert.doesNotMatch(dry.stdout, /real creation event|private-value/)
})

test('private upload sends digest/bytes, no JWT to staging, then binds and verifies the current release', async t => {
  const prepared = prepareJSONL(record)
  const api = await mock(t, (r, res) => {
    if (r.url === '/sessions/config') return data(res, { enabled: true, maxBytes: MAX_BYTES })
    if (r.url === '/sessions/uploads') {
      const input = JSON.parse(r.body)
      assert.equal(input.digest, prepared.digest)
      assert.equal(input.bytes, prepared.bytes.length)
      assert.equal(input.sourceKey, 'creation:' + prepared.digest)
      return data(res, { asset: { id: 'asset-1', state: 'uploading' }, uploadUrl: api.apiBase + '/staging' })
    }
    if (r.url === '/staging') {
      assert.equal(r.method, 'PUT')
      assert.equal(r.headers.authorization, undefined)
      assert.equal(r.headers['content-type'], 'application/x-ndjson')
      assert.equal(Number(r.headers['content-length']), prepared.bytes.length)
      assert.deepEqual(r.body, prepared.bytes)
      return res.end()
    }
    if (r.url === '/sessions/uploads/asset-1/complete') return data(res, { id: 'asset-1', state: 'ready' })
    if (r.url === '/sessions/assets/asset-1/app-evidence') {
      assert.deepEqual(JSON.parse(r.body), { appHash: 'app-1' })
      return data(res, { assurance: 'linked', release_id: 'release-2', receipt: 'private-receipt' })
    }
    assert.equal(r.url, '/session-evidence/app-1')
    assert.equal(r.headers.authorization, undefined)
    data(res, { assurance: 'linked', releaseId: 'release-2', label: 'Creation session linked' })
  })
  const result = await submitSession({ ...api, token: 'test-token', prepared, appHash: 'app-1' })
  assert.equal(result.status, 'linked')
  assert.equal(result.publicVerified, true)
  assert.equal(result.releaseId, 'release-2')
  assert.doesNotMatch(JSON.stringify(result), /receipt|private-value/)
  assert.equal(api.requests.length, 6)
  for (const r of api.requests.filter(r => r.url.startsWith('/sessions/'))) assert.equal(r.headers.authorization, 'Bearer test-token')
})

test('ready-asset retry skips staging and completion, and never grants sharing consent', async t => {
  const api = await mock(t, (r, res) => {
    if (r.url === '/sessions/config') return data(res, { enabled: true, maxBytes: MAX_BYTES })
    assert.equal(r.url, '/sessions/uploads')
    data(res, { asset: { id: 'asset-1', state: 'ready' }, uploadUrl: null })
  })
  const options = { ...api, token: 'test-token', prepared: prepareJSONL(record) }
  for (let i = 0; i < 2; i++) assert.equal((await submitSession(options)).status, 'backed-up')
  assert.deepEqual(api.requests[1].body, api.requests[3].body)
})

test('disabled service and lower server limits stop before creating an upload', async t => {
  let config = { enabled: false, maxBytes: MAX_BYTES }
  const api = await mock(t, (r, res) => { assert.equal(r.url, '/sessions/config'); data(res, config) })
  const options = { ...api, token: 'test-token', prepared: prepareJSONL(record) }
  assert.equal((await submitSession(options)).reason, 'session_uploads_disabled')
  config = { enabled: true, maxBytes: 1 }
  assert.equal((await submitSession(options)).reason, 'server_session_size_limit')
})

test('binding failure or stale public evidence preserves the ready asset for recovery', async t => {
  let rejectBind = true
  const api = await mock(t, (r, res) => {
    if (r.url === '/sessions/config') return data(res, { enabled: true, maxBytes: MAX_BYTES })
    if (r.url === '/sessions/uploads') return data(res, { asset: { id: 'asset-1', state: 'ready' } })
    if (r.url.endsWith('/app-evidence')) {
      if (rejectBind) { res.writeHead(409); return res.end('{"error":"private details"}') }
      return data(res, { assurance: 'linked', release_id: 'new-release' })
    }
    data(res, { assurance: 'linked', releaseId: 'old-release' })
  })
  const options = { ...api, token: 'test-token', prepared: prepareJSONL(record), appHash: 'app-1' }
  const failed = await submitSession(options)
  assert.equal(failed.assetId, 'asset-1')
  assert.equal(failed.status, 'pending')
  assert.equal(failed.reason, 'session_api_http_409')
  rejectBind = false
  assert.equal((await submitSession(options)).reason, 'public_evidence_not_current')
})

test('untrusted upload destination and API redirects are rejected without disclosing bytes or JWT', async t => {
  let redirect = false
  const api = await mock(t, (r, res) => {
    if (redirect) { res.writeHead(302, { location: api.apiBase + '/redirected' }); return res.end() }
    if (r.url === '/sessions/config') return data(res, { enabled: true, maxBytes: MAX_BYTES })
    data(res, { asset: { id: 'asset-1', state: 'uploading' }, uploadUrl: 'https://example.com/steal' })
  })
  const options = { ...api, token: 'test-token', prepared: prepareJSONL(record) }
  assert.equal((await submitSession(options)).reason, 'unsafe_session_upload_url')
  redirect = true
  assert.equal((await submitSession(options)).reason, 'session_api_network_error')
  assert.equal(api.requests.length, 3)
})
