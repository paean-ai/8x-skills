#!/usr/bin/env node
import { readFileSync, writeFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { buildBundle } from './bundle.mjs';
import { buildFileBundle, readFileBundle, writeFileBundle, validateFileManifest } from './multi-file.mjs';

const MAX = 20 * 1024 * 1024;
export const digest = data => createHash('sha256').update(data).digest('hex');
function clean(v, depth = 0) {
  if (depth > 40) throw Error('JSON nesting exceeds 40 levels');
  if (typeof v === 'string') {
    if (/^\s*[\[{]/.test(v)) {
      let decoded;
      try { decoded = JSON.parse(v); } catch {}
      if (decoded && typeof decoded === 'object') return JSON.stringify(clean(decoded, depth + 1));
    }
    return v
    .replace(/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/g, '[REDACTED PRIVATE KEY]')
    .replace(/\b(?:sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|AKIA[A-Z0-9]{16})\b/g, '[REDACTED]')
    .replace(/\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi, 'Bearer [REDACTED]')
    .replace(/((?:api[_-]?key|access[_-]?token|refresh[_-]?token|password|secret)["']?\s*[=:]\s*["']?)[^\s"',;}]+/gi, '$1[REDACTED]');
  }
  if (Array.isArray(v)) return v.map(x => clean(x, depth + 1));
  if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map(k => [k, /^(authorization|cookie|set-cookie|api[_-]?key|access[_-]?token|refresh[_-]?token|password|secret|credentials|private[_-]?key)$/i.test(k) ? '[REDACTED]' : clean(v[k], depth + 1)]));
  return v;
}

export function prepareText(input) {
  if (input.length > 5 * 1024 * 1024) throw Error("Script exceeds 5 MB");
  const text = new TextDecoder("utf-8", { fatal: true }).decode(input);
  if (text.includes("\0")) throw Error("Scripts must be UTF-8 text");
  const bytes = Buffer.from(clean(text));
  if (bytes.length > 5 * 1024 * 1024) throw Error("Prepared script exceeds 5 MB");
  return bytes;
}

export function prepare(input) {
  if (input.length > MAX) throw Error('Session exceeds 20 MB');
  const bytes = input[0] === 0x1f && input[1] === 0x8b ? gunzipSync(input, { maxOutputLength: MAX }) : input;
  const lines = new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^\uFEFF/, '').split(/\r?\n/).filter(l => l.trim());
  if (!lines.length || lines.length > 50000) throw Error('Expected 1–50000 JSON records');
  const records = lines.map((line, i) => {
    if (Buffer.byteLength(line) > 1024 * 1024) throw Error(`Record ${i + 1} exceeds 1 MB`);
    const value = JSON.parse(line);
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error(`Record ${i + 1} must be an object`);
    return JSON.stringify(clean(value));
  });
  const output = Buffer.from(records.join('\n') + '\n');
  if (output.length > MAX) throw Error('Prepared session exceeds 20 MB');
  return output;
}

function credentials() {
  if (process.env.PAEAN_AUTH_TOKEN) return process.env.PAEAN_AUTH_TOKEN;
  for (const name of ['.paean', '.zero']) {
    try {
      const value = JSON.parse(readFileSync(join(homedir(), name, 'credentials.json'), 'utf8'));
      const token = value.token || value.apiKey || value.authToken || value.accessToken;
      if (typeof token === 'string' && token) return token;
    } catch {}
  }
  throw Error('Sign in using Zero CLI or set PAEAN_AUTH_TOKEN locally. Never paste credentials into a conversation.');
}

export async function main(args = process.argv.slice(2)) {
  const [command, ...values] = args;
  const arg = name => { const at = values.indexOf(name); return at < 0 ? undefined : values[at + 1]; };
  const required = name => { const value = arg(name); if (!value || value.startsWith('--')) throw Error(`Missing ${name}`); return value; };
  const file = name => { const path = required(name); if (statSync(path).size > MAX) throw Error('File exceeds 20 MB'); return readFileSync(path); };
  if (!command || command === 'help' || command === '--help') {
    console.log(`Paean session JSONL (Node 20+)
prepare --file original.jsonl[.gz] --out prepared.jsonl
bundle --manifest inputs.json --project project-directory --out new-creation-directory
bundle-jsonl --manifest inputs.json --project project-directory --out legacy-creation.jsonl
config
upload --file prepared.jsonl --source stable-session-id --reviewed
upload-bundle --dir creation-directory --source stable-session-id --reviewed
list [--offset 0]
status --id asset-id
creation --id asset-id [--section summary|tools|scripts|events|issues] [--offset 0] [--limit 50]
download --id asset-id --out review.jsonl
download-bundle --id asset-id --out new-review-directory
download-file --id asset-id --file-id file-id --out new-file
offer --id asset-id --out offer.json
share --id asset-id --offer offer.json --accept-sharing
withdraw --contribution contribution-id
delete --id asset-id --confirm-delete
bind --id asset-id --app app-hash
Use PAEAN_AUTH_TOKEN or existing local Paean/Zero credentials. Uploads are private; sharing is separate.`);
    return;
  }
  if (command === 'prepare') {
    const data = prepare(file('--file'));
    writeFileSync(required('--out'), data, { mode: 0o600, flag: 'wx' });
    return { bytes: data.length, digest: digest(data), warning: 'Review the entire prepared file. Automated redaction can miss sensitive information.' };
  }
  if (command === 'bundle') {
    const bundle = buildFileBundle(JSON.parse(file('--manifest')), dirname(resolve(required('--manifest'))), required('--project'), prepare, prepareText);
    writeFileBundle(required('--out'),bundle);
    return { format:'creation-bundle-v2', files:bundle.manifest.files.length, bytes:bundle.manifest.files.reduce((n,f)=>n+f.bytes,0), warning:'Review manifest.json and every prepared file before private upload.' };
  }
  if (command === 'bundle-jsonl') {
    const data = buildBundle(JSON.parse(file('--manifest')), dirname(resolve(required('--manifest'))), required('--project'), prepare);
    writeFileSync(required('--out'), data, { mode: 0o600, flag: 'wx' });
    return { bytes: data.length, digest: digest(data), warning: 'Review all events and script snapshots before private upload. Only explicitly selected files are included; missing source data cannot be reconstructed.' };
  }
  const base = new URL(process.env.PAEAN_API_BASE || 'https://api.paean.ai');
  if (base.protocol !== 'https:' && !['127.0.0.1', 'localhost'].includes(base.hostname)) throw Error('API must use HTTPS');
  const token = credentials();
  async function api(path, method = 'GET', body) {
    const response = await fetch(new URL('/sessions/' + path, base), { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined, redirect: 'error', signal: AbortSignal.timeout(120000) });
    if (!response.ok) { const error = await response.json().catch(() => ({})); throw Error(error.error || `Session API returned ${response.status}`); }
    return response;
  }
  const json = async (path, method, body) => (await (await api(path, method, body)).json()).data;
  const id = () => { const value = required('--id'); if (!/^[a-f0-9-]{36}$/.test(value)) throw Error('Invalid asset ID'); return value; };
  if (command === 'config') return json('config');
  if (command === 'upload-bundle') {
    if(!values.includes('--reviewed'))throw Error('Review every prepared file, then supply --reviewed for private upload.');
    const bundle=readFileBundle(required('--dir'),prepare,prepareText);
    const sourceKey=required('--source');
    if(sourceKey.length>200||/[\x00-\x1f\x7f]/.test(sourceKey)||!sourceKey.trim())throw Error('Invalid stable source ID');
    const config=await json('config');
    if(!config.enabled||!config.creationBundleVersions?.includes(2))throw Error('Server does not support multi-file creation bundles yet');
    if(!Number.isSafeInteger(config.maxBytes)||bundle.manifest.files.reduce((n,f)=>n+f.bytes,0)>config.maxBytes)throw Error('Bundle exceeds server upload limit');
    const intent=await json('bundle-uploads','POST',{sourceKey,manifest:bundle.manifest});
    if(intent.asset.state==='ready')return intent.asset;
    if(!Array.isArray(intent.files)||intent.files.length!==bundle.manifest.files.length||new Set(intent.files.map(f=>f.id)).size!==intent.files.length)throw Error('Invalid server bundle file list');
    for(const f of intent.files) {
      const bytes=bundle.blobs.get(f.id);if(!bytes)throw Error('Unknown server file ID');
      if(f.state==='ready')continue;
      const url=new URL(f.uploadUrl);
      if(url.protocol!=='https:'||!url.hostname.endsWith('.r2.cloudflarestorage.com'))throw Error('Invalid private upload URL');
      const response=await fetch(url,{method:'PUT',headers:f.headers,body:bytes,redirect:'error',signal:AbortSignal.timeout(120000)});
      if(!response.ok)throw Error(`File upload failed (${response.status}); retry the identical upload-bundle command`);
      await json(`bundle-uploads/${encodeURIComponent(intent.asset.id)}/files/${encodeURIComponent(f.id)}/complete`,'POST');
    }
    return json(`bundle-uploads/${encodeURIComponent(intent.asset.id)}/complete`,'POST');
  }
  if (command === 'upload') {
    if (!values.includes('--reviewed')) throw Error('Review the prepared file, then supply --reviewed to authorize private upload.');
    const data = file('--file');
    const canonical = prepare(data);
    if (!canonical.equals(data)) throw Error('Run prepare first and review its output; upload accepts prepared files only.');
    if (JSON.parse(data.toString('utf8').split('\n')[0]).type === 'paean_creation_bundle') {
      const config = await json('config');
      if (!config.enabled || !config.creationBundleVersions?.includes(1)) throw Error('Server does not support creation bundles yet');
      if (!Number.isSafeInteger(config.maxBytes) || data.length > config.maxBytes) throw Error('Creation bundle exceeds server upload limit');
    }
    const { asset, uploadUrl, headers } = await json('uploads', 'POST', { sourceKey: required('--source'), filename: 'session.jsonl', bytes: data.length, digest: digest(data) });
    if (asset.state === 'ready') return asset;
    const url = new URL(uploadUrl);
    if (url.protocol !== 'https:' || !url.hostname.endsWith('.r2.cloudflarestorage.com')) throw Error('Invalid private upload URL');
    const result = await fetch(url, { method: 'PUT', headers, body: data, redirect: 'error', signal: AbortSignal.timeout(120000) });
    if (!result.ok) throw Error(`Private upload failed (${result.status}); retry the same command`);
    return json(`uploads/${asset.id}/complete`, 'POST');
  }
  if (command === 'list') return json('assets?offset=' + encodeURIComponent(arg('--offset') || '0'));
  if (command === 'status') return json(`assets/${id()}`);
  if (command === 'creation') {
    const section = arg('--section') ?? 'summary', offset = Number(arg('--offset') ?? 0), limit = Number(arg('--limit') ?? 50);
    if (!['summary', 'tools', 'scripts', 'events', 'issues'].includes(section) || !Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw Error('Invalid creation section or pagination');
    return json(`assets/${id()}/creation?` + new URLSearchParams({ section, offset: String(offset), limit: String(limit) }));
  }
  if (command === 'download') {
    const data = Buffer.from(await (await api(`assets/${id()}/download`)).arrayBuffer());
    writeFileSync(required('--out'), data, { mode: 0o600, flag: 'wx' });
    return { bytes: data.length, digest: digest(data) };
  }
  if(command==='download-file') {
    const data=Buffer.from(await(await api(`assets/${id()}/files/${encodeURIComponent(required('--file-id'))}/download`)).arrayBuffer());
    if(data.length>MAX)throw Error('Downloaded file exceeds limit');
    writeFileSync(required('--out'),data,{mode:0o600,flag:'wx'});
    return {bytes:data.length,digest:digest(data)};
  }
  if(command==='download-bundle') {
    const assetID=id(), asset=await json(`assets/${assetID}`);
    if(asset.format!=='creation-bundle-v2')throw Error('Use download for a legacy JSONL asset');
    const raw=Buffer.from(await(await api(`assets/${assetID}/download`)).arrayBuffer());
    if(raw.length>512*1024||digest(raw)!==asset.digest)throw Error('Stored manifest digest mismatch');
    const manifest=validateFileManifest(JSON.parse(raw)),blobs=new Map();
    for(const f of manifest.files) {
      const bytes=Buffer.from(await(await api(`assets/${assetID}/files/${encodeURIComponent(f.id)}/download`)).arrayBuffer());
      if(bytes.length!==f.bytes||digest(bytes)!==f.digest)throw Error('Downloaded file digest mismatch');
      blobs.set(f.id,bytes);
    }
    writeFileBundle(required('--out'),{manifest,blobs});
    return {files:manifest.files.length,digest:asset.digest,warning:'Review the manifest and all downloaded files before platform sharing.'};
  }
  if (command === 'offer') {
    const offer = await json(`assets/${id()}/share-offer`);
    writeFileSync(required('--out'), JSON.stringify(offer, null, 2), { mode: 0o600, flag: 'wx' });
    return { credits: offer.credits, rewardReason: offer.rewardReason, digest: offer.digest, consentText: offer.consentText, consentVersion: offer.consentVersion };
  }
  if (command === 'share') {
    if (!values.includes('--accept-sharing')) throw Error('Sharing requires explicit consent to the displayed offer.');
    const offer = JSON.parse(file('--offer'));
    return json(`assets/${id()}/contributions`, 'POST', { offerToken: offer.token, accepted: true });
  }
  if (command === 'withdraw') {
    const value = required('--contribution');
    if (!/^[a-f0-9-]{36}$/.test(value)) throw Error('Invalid contribution ID');
    return json(`contributions/${value}`, 'DELETE');
  }
  if (command === 'delete') {
    if (!values.includes('--confirm-delete')) throw Error('Deletion requires --confirm-delete');
    return json(`assets/${id()}`, 'DELETE');
  }
  if (command === 'bind') return json(`assets/${id()}/app-evidence`, 'POST', { appHash: required('--app') });
  throw Error('Unknown command; run help');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().then(result => { if (result !== undefined) console.log(JSON.stringify(result, null, 2)); }).catch(error => { console.error(error.message); process.exitCode = 1; });
}
