import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { API, SafeError, tokenState, discover, chooseCredential, validateJobs, boundedBody,
  mediaUrl, wavInfo, status, requestAudio, synthesizeJob, parseArgs, safeErrorCode } from './paean_tts.mjs';

function wave(seconds = .5) {
  const sr = 24000;
  const samples = Math.round(seconds * sr);
  const b = Buffer.alloc(44 + samples * 2);
  b.write('RIFF'); b.writeUInt32LE(b.length - 8, 4); b.write('WAVEfmt ', 8);
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(sr, 24); b.writeUInt32LE(sr * 2, 28); b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++) b.writeInt16LE(Math.round(2000 * Math.sin(i * 2 * Math.PI * 440 / sr)), 44 + 2 * i);
  return b;
}
const fixtureToken = 'fixture-only-not-a-real-login';
const job = { id: 'en-01', voice: 'Chelsie', text: 'Turn an idea into something playable.' };
const payload = () => Response.json({ success: true, data: { audioUrl: 'https://test.oss-cn-beijing.aliyuncs.com/audio.wav?signature=fixture' } });
async function temporary(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'paean-tts-test-'));
  t.after(() => fs.rm(directory, { recursive: true })); // Exact directory created by this test.
  return directory;
}

test('validate IDs, distinct IDs, and required voices', () => {
  assert.deepEqual(validateJobs([job]), [job]);
  for (const jobs of [[], [job, job], [{ ...job, id: '../escape' }], [{ ...job, id: undefined }], [{ ...job, id: 123 }], [{ ...job, voice: '' }], [{ ...job, text: ' ' }]]) {
    assert.throws(() => validateJobs(jobs), SafeError);
  }
  assert.throws(() => parseArgs(['synthesize', '--token', fixtureToken]), /INVALID_ARGUMENT/);
  assert.throws(() => parseArgs(['synthesize', '--api-url', 'https://wrong.example']), /INVALID_ARGUMENT/);
});

test('known credential fields only; explicit environment has no silent fallback', async t => {
  const home = await temporary(t);
  await fs.mkdir(path.join(home, '.paean'));
  await fs.writeFile(path.join(home, '.paean/credentials.json'), JSON.stringify({ paean_token: fixtureToken, privateName: 'not-for-output' }));
  const candidates = await discover({ home, env: {} });
  assert.equal(chooseCredential(candidates), fixtureToken);
  const summary = candidates.map(({ source, field, value }) => ({ source, field, ...tokenState(value) }));
  assert.equal(summary.length, 3);
  assert(!JSON.stringify(summary).includes(fixtureToken));
  assert(!JSON.stringify(summary).includes('not-for-output'));
  const explicit = await discover({ home, env: { PAEAN_TOKEN: '' } });
  assert.equal(explicit.length, 1);
  assert.throws(() => chooseCredential(explicit), /LOGIN_REQUIRED_OR_EXPIRED/);
  const custom = await discover({ home, env: { PAEAN_TOKEN: 'ignored' }, credentialFile: path.join(home, '.paean/credentials.json'), field: 'paean_token' });
  assert.equal(chooseCredential(custom), fixtureToken);
  const shared = await discover({ home, env: { PAEAN_AUTH_TOKEN: fixtureToken, PAEAN_TOKEN: 'legacy' } });
  assert.equal(shared[0].field, 'PAEAN_AUTH_TOKEN');
  assert.equal(chooseCredential(shared), fixtureToken);
  const emptyShared = await discover({ home, env: { PAEAN_AUTH_TOKEN: '', PAEAN_TOKEN: fixtureToken } });
  assert.throws(() => chooseCredential(emptyShared), /LOGIN_REQUIRED_OR_EXPIRED/);
  const explicitFile = await discover({ home, env: { PAEAN_AUTH_TOKEN: 'ignored' }, credentialFile: path.join(home, '.paean/credentials.json') });
  assert.equal(chooseCredential(explicitFile), fixtureToken);
});

test('JWT expiry inspection returns no claims', () => {
  const fake = ['fixture', Buffer.from(JSON.stringify({ exp: 1, email: 'fixture@example.test' })).toString('base64url'), 'signature'].join('.');
  assert.deepEqual(tokenState(fake), { present: true, expired: true });
  assert.throws(() => chooseCredential([{ value: fake }]), /LOGIN_REQUIRED_OR_EXPIRED/);
});

test('status does not send authorization', async () => {
  const result = await status({ fetchFn: async (url, options) => {
    assert.equal(url, `${API}/dashscope/status`);
    assert.equal(options.headers, undefined);
    assert.equal(options.redirect, 'error');
    return Response.json({ success: true, data: { configured: true, services: { tts: { voices: ['Cherry', 'Chelsie'], maxTokens: 512 } } } });
  } });
  assert.deepEqual(result, { configured: true, voices: ['Cherry', 'Chelsie'], maxTokens: 512 });
});

test('POST uses fixed origin, exact supported body; storage gets no credentials', async () => {
  let calls = 0;
  const bytes = await requestAudio(job, fixtureToken, { fetchFn: async (url, options) => {
    calls++;
    assert.equal(options.redirect, 'error');
    if (calls === 1) {
      assert.equal(url, `${API}/dashscope/tts`);
      assert.equal(options.headers.authorization, `Bearer ${fixtureToken}`);
      assert.deepEqual(JSON.parse(options.body), { text: job.text, voice: job.voice });
      return payload();
    }
    assert.equal(options.headers, undefined);
    assert.equal(new URL(url).protocol, 'https:');
    return new Response(wave());
  } });
  assert.equal(calls, 2);
  assert.equal(wavInfo(bytes).seconds, .5);
});

test('401 and 500 are redacted and not automatically retried', async () => {
  for (const code of [401, 500]) {
    let calls = 0;
    await assert.rejects(() => requestAudio(job, fixtureToken, { fetchFn: async () => {
      calls++; return new Response(`Do not echo ${fixtureToken}`, { status: code });
    } }), error => error.message === `API_HTTP_${code}` && !error.message.includes(fixtureToken));
    assert.equal(calls, 1);
  }
});

test('network diagnostics never echo raw exception messages or unknown causes', () => {
  assert.equal(safeErrorCode(new Error(fixtureToken)), 'REQUEST_OR_FILE_OPERATION_FAILED');
  assert.equal(safeErrorCode({ name: 'TimeoutError', message: fixtureToken }), 'NETWORK_TIMEOUT_OR_ABORT');
  assert.equal(safeErrorCode({ cause: { code: 'ECONNRESET', message: fixtureToken } }), 'NETWORK_ECONNRESET');
  assert.equal(safeErrorCode({ cause: { code: fixtureToken } }), 'REQUEST_OR_FILE_OPERATION_FAILED');
});

test('untrusted storage, userinfo, and nonstandard ports are rejected', () => {
  for (const url of ['https://evil.example/audio.wav', 'https://aliyuncs.com.evil.example/a',
    'https://test.aliyuncs.com@evil.example/a', 'https://user:pass@test.aliyuncs.com/a',
    'https://test.aliyuncs.com:8443/a', 'file:///tmp/a', 'http://storage.googleapis.com/a']) {
    assert.throws(() => mediaUrl(url), SafeError);
  }
  assert.equal(mediaUrl('http://test.aliyuncs.com/a').protocol, 'https:');
});

test('bounded downloads and WAV truncation detection', async () => {
  await assert.rejects(() => boundedBody(new Response(Buffer.alloc(20)), 10), /RESPONSE_TOO_LARGE/);
  assert.throws(() => wavInfo(Buffer.from('<html>error</html>')), /INVALID_WAV/);
  assert.throws(() => wavInfo(wave().subarray(0, 100)), /TRUNCATED_WAV/);
});

test('resume is hash checked and never repeats completed synthesis', async t => {
  const out = await temporary(t); let calls = 0;
  const fetchFn = async () => (++calls % 2 ? payload() : new Response(wave()));
  const first = await synthesizeJob(job, { token: fixtureToken, out, fetchFn });
  const second = await synthesizeJob(job, { token: fixtureToken, out, fetchFn });
  assert.equal(first.reusedRaw, false); assert.equal(second.reusedRaw, true); assert.equal(calls, 2);
  const receipt = await fs.readFile(path.join(out, 'en-01.receipt.json'), 'utf8');
  assert(!receipt.includes(fixtureToken)); assert(!receipt.includes('signature=')); assert(!receipt.includes(job.text));
  await assert.rejects(() => synthesizeJob({ ...job, voice: 'Cherry' }, { token: fixtureToken, out, fetchFn }), /OUTPUT_CONFLICT/);
  assert.equal(calls, 2);
  await fs.appendFile(first.file, Buffer.from('tampered'));
  await assert.rejects(() => synthesizeJob(job, { token: fixtureToken, out, fetchFn }), /HASH_MISMATCH/);
  assert.equal(calls, 2);
});

test('unknown existing raw file is preserved instead of overwritten', async t => {
  const out = await temporary(t);
  const file = path.join(out, 'en-01.raw.wav');
  await fs.writeFile(file, wave());
  await assert.rejects(() => synthesizeJob(job, { token: fixtureToken, out, fetchFn: () => { throw Error('must not request'); } }), /OUTPUT_CONFLICT/);
  assert.deepEqual(await fs.readFile(file), wave());
});

test('dry run does not require credentials or create an output directory', async t => {
  const dir = await temporary(t);
  const text = path.join(dir, 'input.txt');
  const out = path.join(dir, 'not-created');
  await fs.writeFile(text, job.text);
  const script = fileURLToPath(new URL('./paean_tts.mjs', import.meta.url));
  const result = execFileSync(process.execPath, [script, 'synthesize', '--text-file', text, '--voice', 'Cherry',
    '--out', out, '--credentials', path.join(dir, 'missing.json'), '--dry-run'], { encoding: 'utf8', env: {} });
  assert.equal(JSON.parse(result).dryRun, true);
  await assert.rejects(() => fs.access(out));
});

test('new speed reuses raw audio and actually changes duration without changing tone frequency', async t => {
  if (spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status !== 0) { t.skip('FFmpeg unavailable'); return; }
  const out = await temporary(t); let calls = 0;
  const fetchFn = async () => (++calls % 2 ? payload() : new Response(wave(2)));
  await synthesizeJob(job, { token: fixtureToken, out, fetchFn });
  const faster = await synthesizeJob(job, { token: fixtureToken, out, fetchFn, speed: 1.2 });
  assert.equal(calls, 2); assert(faster.reusedRaw);
  assert(Math.abs(faster.seconds - 2 / 1.2) < .05);
  const pcm = execFileSync('ffmpeg', ['-v', 'error', '-i', faster.file, '-f', 'f32le', '-ac', '1', '-ar', '24000', '-']);
  let crossings = 0;
  for (let offset = 4; offset < pcm.length; offset += 4) if (pcm.readFloatLE(offset - 4) < 0 && pcm.readFloatLE(offset) >= 0) crossings++;
  const frequency = crossings / (pcm.length / 4 / 24000);
  assert(Math.abs(frequency - 440) < 5, `frequency=${frequency}`);
  const again = await synthesizeJob(job, { token: fixtureToken, out, fetchFn, speed: 1.2 });
  assert.equal(again.file, faster.file); assert.equal(calls, 2);
});
