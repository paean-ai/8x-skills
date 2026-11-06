import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { buildSessionBundle, locateSessions, reviewBundle, reviewBytes } from '../codex/paean-sessions/scripts/session-tools.mjs'
import { loadSessionBundle, submitSessionBundle } from '../codex/paean-sessions/scripts/sessions.mjs'

const repoRoot = path.resolve(import.meta.dirname, '..')

function temp(t) {
  const dir = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'session-tools-')))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}

function write(file, content) {
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, content)
  return file
}

test('locate lists only this project and its parents, by metadata', t => {
  const home = temp(t), work = path.join(home, 'work'), project = path.join(work, 'game'), other = path.join(home, 'other')
  mkdirSync(project, { recursive: true })
  mkdirSync(other)
  const slug = p => p.replace(/[^A-Za-z0-9]/g, '-')
  const body = '{"text":"SECRET-BODY"}\n'
  write(path.join(home, '.claude/projects', slug(project), 'mine.jsonl'), body)
  write(path.join(home, '.claude/projects', slug(project), 'mine/subagents/agent-1.jsonl'), body)
  write(path.join(home, '.claude/projects', slug(work), 'parent.jsonl'), body)
  write(path.join(home, '.claude/projects', slug(other), 'unrelated.jsonl'), body)
  write(path.join(home, '.zero/projects', slug(project), 'zero.jsonl'), body)
  write(path.join(home, '.cursor/projects', slug(project).replace(/^-+/, ''), 'agent-transcripts/c1/c1.jsonl'), body)
  write(path.join(home, '.codex/sessions/2026/11/05/rollout-a.jsonl'), JSON.stringify({ payload: { cwd: project } }) + '\n')
  write(path.join(home, '.codex/sessions/2026/11/05/rollout-b.jsonl'), JSON.stringify({ payload: { cwd: other } }) + '\n')
  write(path.join(home, '.gemini/tmp/g1/.project_root'), project + '\n')
  write(path.join(home, '.gemini/tmp/g1/chats/chat.json'), '{}')
  write(path.join(home, '.gemini/tmp/g2/.project_root'), other + '\n')
  write(path.join(home, '.gemini/tmp/g2/chats/unrelated.json'), '{}')

  const { candidates } = locateSessions({ project, home, env: {} })
  const ids = candidates.map(c => c.sessionId).sort()
  assert.deepEqual(ids, ['c1', 'chat', 'mine', 'parent', 'rollout-a', 'zero'])
  assert.equal(candidates.find(c => c.sessionId === 'parent').match, 'ancestor')
  assert.equal(candidates.at(-1).match, 'ancestor', 'exact project matches sort first')
  assert.equal(candidates.find(c => c.sessionId === 'mine').childLogs, 1)
  assert.equal(candidates.find(c => c.sessionId === 'chat').needsConversion, true)
  assert.doesNotMatch(JSON.stringify(candidates), /SECRET-BODY/)

  assert.deepEqual(locateSessions({ project, home, env: {}, client: 'codex' }).candidates.map(c => c.client), ['codex'])
  assert.throws(() => locateSessions({ project, home, env: {}, client: 'other' }), /Unknown client/)
})

test('prepare-bundle handles what the single-file path rejects, with sub-agent logs', t => {
  const dir = temp(t)
  const large = JSON.stringify({ type: 'user', image: 'x'.repeat(2 * 1024 * 1024), password: 'private-value' }) + '\n'
  const main = write(path.join(dir, 'main.jsonl'), large.repeat(11))
  write(path.join(dir, 'main/subagents/agent-1.jsonl'), '{"type":"child"}\n')
  write(path.join(dir, 'main/subagents/empty.jsonl'), '')
  assert.ok(statSync(main).size > 20 * 1024 * 1024)

  const out = path.join(dir, 'bundle')
  const built = buildSessionBundle({ file: main, out })
  assert.equal(built.streams, 2)
  assert.equal(built.omittedChildLogs, 0)
  assert.equal(statSync(out).mode & 0o777, 0o700)
  const loaded = loadSessionBundle(out)
  assert.equal(loaded.streams, 2)
  assert.equal(loaded.scripts, 0)
  assert.doesNotMatch(JSON.stringify(reviewBundle(out, { project: dir })), /private-value/)

  assert.throws(() => buildSessionBundle({ file: main, out }), /EEXIST/, 'never overwrites an earlier snapshot')
  const solo = path.join(dir, 'solo')
  assert.equal(buildSessionBundle({ file: main, out: solo, children: false }).streams, 1)
})

test('prepare-bundle reports omitted child logs, rejects gzip, and never quotes bad input', t => {
  const dir = temp(t)
  const main = write(path.join(dir, 'main.jsonl'), '{"type":"user"}\n')
  for (let i = 0; i < 100; i++) write(path.join(dir, `main/subagents/agent-${i}.jsonl`), '{"type":"child"}\n')
  const built = buildSessionBundle({ file: main, out: path.join(dir, 'bundle') })
  assert.equal(built.streams, 100)
  assert.equal(built.omittedChildLogs, 1)

  assert.throws(() => buildSessionBundle({ file: path.join(dir, 'x.jsonl.gz'), out: path.join(dir, 'gz') }), /Decompress/)
  const bad = write(path.join(dir, 'bad.jsonl'), 'SECRET-BODY is not json\n')
  const failed = path.join(dir, 'failed')
  assert.throws(() => buildSessionBundle({ file: bad, out: failed }), error => {
    assert.match(error.message, /invalid JSON/)
    assert.doesNotMatch(error.message, /SECRET-BODY/)
    return true
  })
  assert.equal(existsSync(failed), false)
})

test('review reports locations and masks, never the values it found', t => {
  const project = temp(t)
  const token = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijklmnop'
  const lines = [
    { type: 'user', cwd: project, timestamp: '2026-11-05T01:00:00Z', text: `token ${token}` },
    { type: 'user', cwd: '/somewhere/else', timestamp: '2026-11-05T02:00:00Z', text: 'key os_ak_abcdefghijkl db postgres://me:hunter2@db.internal/app' },
    { type: 'tool', text: 'alice@corp.io bob@corp.io carol@corp.io dave@corp.io git@github.com noreply@example.com react@18.3.1' },
    { type: 'tool', text: 'cat ~/.ssh/config', image: 'AIza' + 'A'.repeat(2000) },
  ].map(line => JSON.stringify(line)).join('\n') + '\n'
  const report = reviewBytes(Buffer.from(lines), { project, home: '/nowhere' })
  assert.equal(report.records, 4)
  assert.equal(report.firstTimestamp, '2026-11-05T01:00:00Z')
  assert.equal(report.lastTimestamp, '2026-11-05T02:00:00Z')
  assert.deepEqual(report.possibleSecrets.kinds, { jwt: 1, paeanApiKey: 1, connectionString: 1 })
  assert.equal(report.largeBinaryBlobs, 1, 'base64 media is counted, not scanned for secrets')
  assert.equal(report.emails.distinct, 4)
  assert.equal(report.sensitivePathMentions, 1)
  assert.deepEqual(report.needsAttention, ['possible-secrets', 'other-project-directories', 'many-email-addresses'])
  assert.deepEqual(report.locations[0], { file: 'creation-session.jsonl', line: 1, kind: 'jwt' })
  const printed = JSON.stringify(report)
  for (const value of [token, 'os_ak_abcdefghijkl', 'hunter2', 'alice@corp.io']) assert.ok(!printed.includes(value), value)

  const clean = reviewBytes(Buffer.from(JSON.stringify({ type: 'user', cwd: project, text: 'hello' }) + '\n'), { project })
  assert.deepEqual(clean.needsAttention, [])
  assert.equal(clean.workingDirectories[0].relation, 'project')
})

function mockServer(t, config) {
  const calls = []
  const realFetch = globalThis.fetch
  globalThis.fetch = async (url, options = {}) => {
    const { pathname } = new URL(url)
    const body = options.body ? JSON.parse(options.body) : undefined
    calls.push({ pathname, body, authorization: options.headers?.Authorization })
    const data = value => new Response(JSON.stringify({ data: value }), { status: 200 })
    if (pathname === '/sessions/config') return data(config)
    if (pathname === '/sessions/bundle-uploads') {
      return data({ asset: { id: 'asset-1', state: 'uploading' }, files: body.manifest.files.map(f => ({ id: f.id, state: 'pending', uploadUrl: `https://bucket.r2.cloudflarestorage.com/${f.id}?sig=SIGNED`, headers: {} })) })
    }
    if (pathname === '/sessions/bundle-uploads/asset-1/complete') return data({ id: 'asset-1', state: 'ready' })
    if (pathname.startsWith('/sessions/bundle-uploads/asset-1/files/')) return data({ state: 'ready' })
    if (pathname === '/sessions/assets/asset-1/app-evidence') return data({ assurance: 'linked', release_id: 'release-1' })
    if (pathname === '/session-evidence/app-1') return data({ assurance: 'linked', releaseId: 'release-1', label: 'Creation session linked' })
    throw new Error('unexpected request ' + pathname)
  }
  t.after(() => { globalThis.fetch = realFetch })
  return calls
}

const supported = { enabled: true, maxBytes: 64 << 20, creationBundleVersions: [1, 2], portableCreationManifest: true, chunkedCreationStreams: true, creationLimits: { maxRecordBytes: 16 << 20 }, multiFileLimits: { maxBytes: 100 * 1024 ** 3, maxFileBytes: 32 << 20 } }

function preparedBundle(t) {
  const dir = temp(t)
  const out = path.join(dir, 'bundle')
  buildSessionBundle({ file: write(path.join(dir, 'main.jsonl'), '{"type":"user"}\n'), out })
  return loadSessionBundle(out)
}

test('bundle submission uploads with a content key, binds the release, and sends no JWT to storage', async t => {
  const bundle = preparedBundle(t)
  const calls = mockServer(t, supported)
  const puts = []
  const result = await submitSessionBundle({
    apiBase: 'https://api.test', token: 'jwt', directory: bundle.directory, digest: bundle.digest, appHash: 'app-1',
    put: async (url, options) => { puts.push({ url: String(url), headers: options.headers }); return { ok: true, status: 200 } },
  })
  assert.equal(result.status, 'linked')
  assert.equal(result.assetId, 'asset-1')
  assert.equal(result.releaseId, 'release-1')
  assert.equal(calls.find(c => c.pathname === '/sessions/bundle-uploads').body.sourceKey, 'creation:' + bundle.digest)
  assert.equal(puts.length, 1)
  assert.doesNotMatch(JSON.stringify(puts[0].headers), /jwt/)
  assert.ok(calls.filter(c => c.pathname.startsWith('/sessions/')).every(c => c.authorization === 'Bearer jwt'))
})

test('bundle submission reports pending instead of throwing, and never leaks signed URLs', async t => {
  const bundle = preparedBundle(t)
  const options = { apiBase: 'https://api.test', token: 'jwt', directory: bundle.directory, digest: bundle.digest, appHash: 'app-1' }

  const unsupported = mockServer(t, { enabled: true, maxBytes: 1, creationBundleVersions: [1] })
  const old = await submitSessionBundle(options)
  assert.equal(old.status, 'pending')
  assert.match(old.detail, /does not support multi-file/)
  assert.equal(unsupported.some(c => c.pathname === '/sessions/bundle-uploads'), false)

  mockServer(t, supported)
  const failed = await submitSessionBundle({ ...options, put: async () => { throw new Error('socket closed') } })
  assert.equal(failed.status, 'pending')
  assert.equal(failed.stage, 'upload')
  assert.doesNotMatch(JSON.stringify(failed), /SIGNED|socket closed/)

  const noLogin = await submitSessionBundle({ ...options, token: undefined })
  assert.equal(noLogin.status, 'pending')
  assert.equal(noLogin.reason, 'paean_login_required')
})

test('paean-publish session helpers work when the skill is installed alone', t => {
  const dir = temp(t)
  cpSync(path.join(repoRoot, 'codex/paean-publish'), path.join(dir, 'paean-publish'), { recursive: true })
  const helper = path.join(dir, 'paean-publish/scripts/sessions.mjs')
  const project = path.join(dir, 'project')
  const log = write(path.join(dir, 'log.jsonl'), JSON.stringify({ type: 'user', cwd: project }) + '\n')
  mkdirSync(project)
  const run = (...args) => spawnSync(process.execPath, [helper, ...args], { cwd: project, encoding: 'utf8', env: { ...process.env, PAEAN_AUTH_TOKEN: '' } })

  const built = run('prepare-bundle', '--file', log, '--out', path.join(project, 'bundle'))
  assert.equal(built.status, 0, built.stderr)
  const reviewed = run('review', '--dir', path.join(project, 'bundle'))
  assert.equal(reviewed.status, 0, reviewed.stderr)
  assert.deepEqual(JSON.parse(reviewed.stdout).needsAttention, [])
  assert.equal(run('locate').status, 0)
  assert.equal(run('review').status, 1, 'needs exactly one of --file or --dir')
  const publish = spawnSync(process.execPath, [path.join(dir, 'paean-publish/scripts/publish.mjs'), '--help'], { encoding: 'utf8' })
  assert.equal(publish.status, 0, publish.stderr)
})
