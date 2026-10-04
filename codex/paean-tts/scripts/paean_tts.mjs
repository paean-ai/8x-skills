#!/usr/bin/env node
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const API = 'https://api.paean.ai';
const MAX_AUDIO = 32 * 1024 * 1024;
export class SafeError extends Error {
  constructor(code) { super(code); this.name = 'SafeError'; }
}
const fail = code => { throw new SafeError(code); };
export const sha256 = value => createHash('sha256').update(value).digest('hex');
export function safeErrorCode(error) {
  if (error instanceof SafeError) return error.message;
  if (['TimeoutError', 'AbortError'].includes(error?.name)) return 'NETWORK_TIMEOUT_OR_ABORT';
  const known = new Set(['UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_SOCKET', 'ENOTFOUND', 'ECONNRESET', 'ECONNREFUSED', 'CERT_HAS_EXPIRED', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE']);
  return known.has(error?.cause?.code) ? `NETWORK_${error.cause.code}` : 'REQUEST_OR_FILE_OPERATION_FAILED';
}
const safeRead = async file => {
  try { return await fs.readFile(file); }
  catch (error) { if (error.code === 'ENOENT') return null; fail('FILE_READ_FAILED'); }
};
const jsonRead = async file => {
  const bytes = await safeRead(file);
  if (!bytes) return null;
  try { return JSON.parse(bytes); } catch { fail('INVALID_JSON_FILE'); }
};

export function tokenState(value) {
  const token = typeof value === 'string' ? value.replace(/^Bearer\s+/i, '').trim() : '';
  let expired = null;
  try {
    const claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
    if (typeof claims.exp === 'number') expired = claims.exp * 1000 <= Date.now();
  } catch { /* An unrecognized shape is not evidence of server validity. */ }
  return { present: Boolean(token), expired };
}

export async function discover({ home = os.homedir(), env = process.env, credentialFile, field } = {}) {
  if (field && !credentialFile) fail('TOKEN_FIELD_REQUIRES_CREDENTIAL_FILE');
  const result = [];
  if (!credentialFile) {
    for (const key of ['PAEAN_AUTH_TOKEN', 'PAEAN_TOKEN']) {
      if (!Object.hasOwn(env, key)) continue;
      result.push({ source: 'environment', field: key, value: env[key] });
      return result; // Explicit identity never silently falls back.
    }
  }
  const sources = credentialFile
    ? [[path.resolve(credentialFile), field ? [field] : ['paean_token', 'token']]]
    : [[path.join(home, '.paean/credentials.json'), ['paean_token', 'token']],
       [path.join(home, '.zero/credentials.json'), ['token']]];
  for (const [source, fields] of sources) {
    const data = await jsonRead(source);
    for (const key of fields) result.push({ source, field: key, value: data?.[key] });
  }
  return result;
}

export function chooseCredential(candidates) {
  const selected = candidates.find(item => {
    const state = tokenState(item.value);
    return state.present && state.expired !== true;
  });
  if (!selected) fail('LOGIN_REQUIRED_OR_EXPIRED');
  const token = selected.value.replace(/^Bearer\s+/i, '').trim();
  if (/[\r\n]/.test(token)) fail('INVALID_CREDENTIAL_FORMAT');
  return token;
}

export function validateJobs(input) {
  if (!Array.isArray(input) || input.length === 0) fail('EMPTY_MANIFEST');
  const used = new Set();
  return input.map(job => {
    if (!job || typeof job !== 'object') fail('INVALID_JOB');
    if (typeof job.id !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(job.id) || used.has(job.id)) fail('INVALID_OR_DUPLICATE_ID');
    if (typeof job.voice !== 'string' || !/^[A-Za-z0-9_-]{1,120}$/.test(job.voice)) fail('VOICE_REQUIRED');
    if (typeof job.text !== 'string' || !job.text.trim()) fail('TEXT_REQUIRED');
    used.add(job.id);
    return { id: job.id, voice: job.voice, text: job.text.trim() };
  });
}

export async function boundedBody(response, limit) {
  if (!response.body) fail('EMPTY_RESPONSE');
  const reader = response.body.getReader();
  const parts = []; let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > limit) { await reader.cancel(); fail('RESPONSE_TOO_LARGE'); }
    parts.push(Buffer.from(value));
  }
  return Buffer.concat(parts);
}

async function responseJson(response) {
  try { return JSON.parse((await boundedBody(response, 256 * 1024)).toString()); }
  catch (error) { if (error instanceof SafeError) throw error; fail('INVALID_API_RESPONSE'); }
}

export function mediaUrl(value) {
  let url;
  try { url = new URL(value); } catch { fail('INVALID_MEDIA_URL'); }
  const oss = url.hostname.endsWith('.aliyuncs.com');
  const gcs = url.hostname === 'storage.googleapis.com';
  if (oss && url.protocol === 'http:') url.protocol = 'https:';
  if (!(oss || gcs) || url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) fail('UNEXPECTED_MEDIA_HOST');
  return url;
}

export function wavInfo(bytes) {
  if (bytes.length < 44 || bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WAVE') fail('INVALID_WAV');
  const riffEnd = bytes.readUInt32LE(4) + 8;
  if (riffEnd > bytes.length || riffEnd < 44) fail('TRUNCATED_WAV');
  let format, dataBytes = 0;
  for (let offset = 12; offset + 8 <= riffEnd;) {
    const name = bytes.toString('ascii', offset, offset + 4);
    const size = bytes.readUInt32LE(offset + 4);
    const begin = offset + 8;
    if (begin + size > riffEnd) fail('TRUNCATED_WAV');
    if (name === 'fmt ' && size >= 16) {
      format = { codec: bytes.readUInt16LE(begin), channels: bytes.readUInt16LE(begin + 2),
        sampleRate: bytes.readUInt32LE(begin + 4), byteRate: bytes.readUInt32LE(begin + 8),
        blockAlign: bytes.readUInt16LE(begin + 12), bits: bytes.readUInt16LE(begin + 14) };
      if (format.codec === 0xfffe) {
        // FFmpeg writes 24-bit PCM as WAVE_FORMAT_EXTENSIBLE.
        if (size < 40 || bytes.subarray(begin + 28, begin + 40).toString('hex') !== '00001000800000aa00389b71') fail('UNSUPPORTED_WAV_SUBFORMAT');
        format.codec = bytes.readUInt32LE(begin + 24);
      }
    }
    if (name === 'data') dataBytes += size;
    offset = begin + size + (size % 2);
  }
  if (!format || ![1, 3].includes(format.codec) || !format.sampleRate || !format.channels || !dataBytes ||
      format.byteRate !== format.sampleRate * format.blockAlign ||
      format.blockAlign !== format.channels * format.bits / 8 || dataBytes % format.blockAlign) fail('UNSUPPORTED_OR_INVALID_WAV');
  return { seconds: dataBytes / format.byteRate, sampleRate: format.sampleRate,
    channels: format.channels, bits: format.bits };
}

export async function status({ fetchFn = fetch } = {}) {
  const response = await fetchFn(`${API}/dashscope/status`, { redirect: 'error', signal: AbortSignal.timeout(20000) });
  if (!response.ok) fail(`STATUS_HTTP_${response.status}`);
  const json = await responseJson(response);
  if (json.success !== true) fail('STATUS_RESPONSE_FAILED');
  return { configured: json.data?.configured === true,
    voices: (json.data?.services?.tts?.voices || []).filter(v => typeof v === 'string' && /^[A-Za-z0-9_-]{1,120}$/.test(v)),
    maxTokens: Number.isFinite(json.data?.services?.tts?.maxTokens) ? json.data.services.tts.maxTokens : null };
}

export async function requestAudio(job, token, { fetchFn = fetch } = {}) {
  const response = await fetchFn(`${API}/dashscope/tts`, {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(150000),
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ text: job.text, voice: job.voice }),
  });
  if (!response.ok) fail(`API_HTTP_${response.status}`);
  const json = await responseJson(response);
  if (json.success !== true || typeof json.data?.audioUrl !== 'string') fail('TTS_RESPONSE_FAILED');
  const url = mediaUrl(json.data.audioUrl);
  // Separate unauthenticated GET: never send the Paean JWT to storage.
  const media = await fetchFn(url, { redirect: 'error', signal: AbortSignal.timeout(60000) });
  if (!media.ok) fail(`MEDIA_HTTP_${media.status}`);
  const bytes = await boundedBody(media, MAX_AUDIO);
  wavInfo(bytes);
  return bytes;
}

async function saveReceipt(destination, receipt) {
  const temporary = `${destination}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporary, JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    await fs.rename(temporary, destination);
  } finally {
    await fs.unlink(temporary).catch(() => {}); // Only our own temporary file.
  }
}

export async function synthesizeJob(job, { token, out, speed = 1, fetchFn = fetch, renderFn = renderTempo } = {}) {
  [job] = validateJobs([job]);
  if (!Number.isFinite(speed) || speed < .5 || speed > 2) fail('SPEED_MUST_BE_0_5_TO_2');
  const directory = path.resolve(out);
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const receiptFile = path.join(directory, `${job.id}.receipt.json`);
  const rawFile = path.join(directory, `${job.id}.raw.wav`);
  const requestHash = sha256(JSON.stringify({ endpoint: `${API}/dashscope/tts`, text: job.text, voice: job.voice }));
  let receipt = await jsonRead(receiptFile);
  let raw = await safeRead(rawFile);
  let reused = false;
  if (receipt || raw) {
    if (!receipt || !raw || receipt.version !== 1 || receipt.requestHash !== requestHash || receipt.rawSha256 !== sha256(raw)) fail('OUTPUT_CONFLICT_OR_HASH_MISMATCH');
    wavInfo(raw); reused = true;
  } else {
    raw = await requestAudio(job, token, { fetchFn });
    await fs.writeFile(rawFile, raw, { flag: 'wx', mode: 0o600 });
    receipt = { version: 1, id: job.id, endpoint: `${API}/dashscope/tts`, requestHash,
      voice: job.voice, characters: [...job.text].length, createdAt: new Date().toISOString(),
      rawFile: path.basename(rawFile), rawSha256: sha256(raw), rawAudio: wavInfo(raw), renditions: {} };
    await saveReceipt(receiptFile, receipt);
  }
  let outputFile = rawFile;
  let info = receipt.rawAudio;
  if (speed !== 1) {
    const key = String(speed);
    outputFile = path.join(directory, `${job.id}.speed-${key}.wav`);
    const recorded = receipt.renditions?.[key];
    const existing = await safeRead(outputFile);
    if (recorded || existing) {
      if (!recorded || !existing || recorded.sha256 !== sha256(existing)) fail('RENDITION_CONFLICT_OR_HASH_MISMATCH');
      info = wavInfo(existing);
    } else {
      const processed = await renderFn(rawFile, speed);
      info = wavInfo(processed);
      await fs.writeFile(outputFile, processed, { flag: 'wx', mode: 0o600 });
      receipt.renditions[key] = { file: path.basename(outputFile), sha256: sha256(processed), audio: info };
      await saveReceipt(receiptFile, receipt);
    }
  }
  return { id: job.id, voice: job.voice, reusedRaw: reused, speed, ...info, file: outputFile };
}

function checkFfmpeg() {
  const result = spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' });
  if (result.status !== 0) fail('FFMPEG_REQUIRED_FOR_SPEED');
}

export async function renderTempo(rawFile, speed) {
  // A temporary seekable WAV avoids unknown data sizes in a WAV pipe header.
  const temporary = path.join(path.dirname(rawFile), `.tempo-${randomUUID()}.wav`);
  try {
    const result = spawnSync('ffmpeg', ['-nostdin', '-v', 'error', '-n', '-i', rawFile,
      '-af', `atempo=${speed}`, '-ar', '48000', '-c:a', 'pcm_s24le', temporary],
    { stdio: ['ignore', 'ignore', 'pipe'], timeout: 120000, maxBuffer: 1024 * 1024 });
    if (result.status !== 0) fail('FFMPEG_TEMPO_FAILED');
    return await fs.readFile(temporary);
  } finally { await fs.unlink(temporary).catch(() => {}); }
}

export function parseArgs(argv) {
  const [command = 'help', ...rest] = argv;
  if (!['help', 'credentials', 'status', 'synthesize'].includes(command)) fail('UNKNOWN_COMMAND');
  const options = {};
  for (let i = 0; i < rest.length; i++) {
    const key = rest[i];
    if (key === '--dry-run') { options.dryRun = true; continue; }
    const names = { '--credentials': 'credentialFile', '--token-field': 'field', '--text-file': 'textFile',
      '--voice': 'voice', '--out': 'out', '--manifest': 'manifest', '--speed': 'speed' };
    if (!names[key] || !rest[i + 1] || rest[i + 1].startsWith('--')) fail('INVALID_ARGUMENT');
    if (Object.hasOwn(options, names[key])) fail('DUPLICATE_ARGUMENT');
    options[names[key]] = rest[++i];
  }
  return { command, options };
}

export async function main(argv = process.argv.slice(2)) {
  const { command, options } = parseArgs(argv);
  if (command === 'help') {
    console.log('Paean TTS (Node 20+)\n  credentials [--credentials FILE --token-field FIELD]\n  status\n  synthesize --text-file FILE --voice VOICE --out DIR [--speed 1.18] [--dry-run]\n  synthesize --manifest FILE --out DIR [--speed 1.18] [--dry-run]\nNo token values, arbitrary API origins, or automatic POST retries are accepted.');
    return;
  }
  if (command === 'credentials') {
    const candidates = await discover(options);
    console.log(JSON.stringify(candidates.map(({ source, field, value }) => ({ source, field, ...tokenState(value) })), null, 2));
    return;
  }
  if (command === 'status') { console.log(JSON.stringify(await status())); return; }
  if (!options.out || Boolean(options.textFile) === Boolean(options.manifest)) fail('CHOOSE_TEXT_FILE_OR_MANIFEST_AND_OUTPUT');
  const speed = options.speed === undefined ? 1 : Number(options.speed);
  if (!Number.isFinite(speed) || speed < .5 || speed > 2) fail('SPEED_MUST_BE_0_5_TO_2');
  if (options.manifest && options.voice) fail('MANIFEST_REQUIRES_PER_SEGMENT_VOICE');
  let jobs;
  if (options.manifest) jobs = (await jsonRead(options.manifest))?.segments;
  else {
    const bytes = await safeRead(options.textFile);
    if (!bytes) fail('TEXT_FILE_NOT_FOUND');
    jobs = [{ id: 'speech', voice: options.voice, text: bytes.toString('utf8') }];
  }
  jobs = validateJobs(jobs);
  if (options.dryRun) {
    console.log(JSON.stringify({ dryRun: true, endpoint: `${API}/dashscope/tts`, speed,
      jobs: jobs.map(({ id, voice, text }) => ({ id, voice, characters: [...text].length })) }, null, 2));
    return; // No credentials read and no network or output mutation.
  }
  if (speed !== 1) checkFfmpeg(); // Check before any billable request.
  const token = chooseCredential(await discover(options));
  // Serialize all commands sharing this output directory to prevent duplicate POSTs.
  const directory = path.resolve(options.out);
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const lock = path.join(directory, '.paean-tts.lock');
  let handle;
  try { handle = await fs.open(lock, 'wx', 0o600); }
  catch { fail('OUTPUT_LOCKED_CHECK_RUNNING_PROCESS'); }
  try {
    for (const job of jobs) console.log(JSON.stringify(await synthesizeJob(job, { token, out: directory, speed })));
  } finally { await handle.close(); await fs.unlink(lock); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    // Never print error.stack, response bodies, headers, signed URLs, or fetch causes.
    console.error(safeErrorCode(error));
    process.exitCode = 1;
  });
}
