#!/usr/bin/env node
import { readFileSync, writeFileSync, statSync, openSync, closeSync, unlinkSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { buildBundle } from './bundle.mjs';
import { buildFileBundle, readPortableBundle, writeFileBundle, validateFileManifest, writeDownloadedBundle, streamFiles } from './multi-file.mjs';
import { inspectPortableBundle } from './offline.mjs';
import { submissionMain, sessionApiBase, sessionToken, bindSession } from './submission.mjs';
import { digest, prepare, prepareText, putDirectR2, uploadFileBundle } from './creation-upload.mjs';
export { MAX_BYTES, prepareJSONL, readSession, sessionSummary, sessionApiBase, sessionToken, publicEvidence, bindSession, submitSession, submitSessionBundle, loadSessionBundle } from './submission.mjs';
export { digest, prepare, prepareText, putDirectR2 };

import { creationLimits, multiFileLimits } from './creation-index.mjs';
const MAX = creationLimits.maxBytes;

export async function main(args = process.argv.slice(2), {put = putDirectR2} = {}) {
  const [command, ...values] = args;
  if (['submit', 'evidence', 'locate', 'prepare-bundle', 'review', 'submit-bundle'].includes(command) || (['status', 'bind'].includes(command) && values.includes('--asset'))) return submissionMain(args);
  const arg = name => { const at = values.indexOf(name); return at < 0 ? undefined : values[at + 1]; };
  const required = name => { const value = arg(name); if (!value || value.startsWith('--')) throw Error(`Missing ${name}`); return value; };
  const file = name => { const path = required(name); if (statSync(path).size > MAX) throw Error('File exceeds 64 MiB'); return readFileSync(path); };
  if (!command || command === 'help' || command === '--help') {
    console.log(`Paean session JSONL (Node 20+)
locate [--project directory] [--client claude-code|codex|cursor|gemini|zero]
prepare --file original.jsonl[.gz] --out prepared.jsonl
prepare-bundle --file original.jsonl --out new-creation-directory [--no-children]
review --file prepared.jsonl | --dir creation-directory [--project directory]
bundle --manifest inputs.json --project project-directory --out new-creation-directory
bundle-jsonl --manifest inputs.json --project project-directory --out legacy-creation.jsonl
config
upload --file prepared.jsonl --source stable-session-id --reviewed
upload-bundle --dir creation-directory --source stable-session-id --reviewed
list [--offset 0]
submit --file prepared.jsonl [--app app-hash] [--source-key stable-id] [--dry-run]
submit-bundle --dir creation-directory [--app app-hash]
evidence --app app-hash
status --id asset-id (also accepts --asset)
creation --id asset-id [--section summary|tools|scripts|events|issues] [--offset 0] [--limit 50]
download --id asset-id --out review.jsonl
download-bundle --id asset-id --out new-review-directory
download-file --id asset-id --file-id file-id --out new-file
verify-bundle --dir local-directory [--layout auto|local|storage] [--digest expected-manifest-sha256]
restore-stream --dir local-directory --stream stream-id --out original.jsonl
restore-bundle --dir copied-r2-or-local-directory --out new-directory [--layout auto|local|storage] [--digest expected-manifest-sha256]
inspect-bundle --dir local-directory [--section summary|tools|scripts|events|issues] [--offset 0] [--limit 50] [--layout auto|local|storage] [--digest expected-manifest-sha256]
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
    const bundle = buildFileBundle(JSON.parse(file('--manifest')), dirname(resolve(required('--manifest'))), required('--project'), prepare, prepareText, required('--out'));
    return { format:'creation-bundle-v2', files:bundle.manifest.files.length, bytes:bundle.manifest.files.reduce((n,f)=>n+f.bytes,0), warning:'Review manifest.json and every prepared file before private upload.' };
  }
  if (command === 'bundle-jsonl') {
    const data = buildBundle(JSON.parse(file('--manifest')), dirname(resolve(required('--manifest'))), required('--project'), prepare);
    writeFileSync(required('--out'), data, { mode: 0o600, flag: 'wx' });
    return { bytes: data.length, digest: digest(data), warning: 'Review all events and script snapshots before private upload. Only explicitly selected files are included; missing source data cannot be reconstructed.' };
  }
  if(command==='restore-stream') {
    const bundle=readPortableBundle(required('--dir'),{layout:arg('--layout')??'auto',expectedDigest:arg('--digest')});
    const files=streamFiles(bundle.manifest,required('--stream'));
    if(!files.length)throw Error('Unknown stream ID');
    const out=required('--out'),fd=openSync(out,'wx',0o600),hash=createHash('sha256');let bytes=0,failed=true;
    try {
      for(const file of files){const data=bundle.blobs.get(file.id);writeFileSync(fd,data);hash.update(data);bytes+=data.length;}
      failed=false;return {streamId:required('--stream'),parts:files.length,bytes,digest:hash.digest('hex')};
    }finally{closeSync(fd);if(failed)unlinkSync(out);}
  }
  if(['verify-bundle','restore-bundle','inspect-bundle'].includes(command)) {
    const bundle=readPortableBundle(required('--dir'),{layout:arg('--layout')??'auto',expectedDigest:values.includes('--digest')?required('--digest'):undefined});
    if(command==='inspect-bundle')return inspectPortableBundle(bundle,arg('--section')??'summary',Number(arg('--offset')??0),Number(arg('--limit')??50));
    const summary=inspectPortableBundle(bundle);
    if(command==='restore-bundle')writeFileBundle(required('--out'),bundle);
    return {...summary,restored:command==='restore-bundle'};
  }
  const base = new URL(sessionApiBase());
  if (base.username || base.password || base.search || base.hash || (base.protocol !== 'https:' && !(base.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname)))) throw Error('API must use HTTPS');
  const token = sessionToken();
  async function api(path, method = 'GET', body) {
    const response = await fetch(new URL('/sessions/' + path, base), { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined, redirect: 'error', signal: AbortSignal.timeout(path.endsWith('/download') ? 600000 : 120000) });
    if (!response.ok) { const error = await response.json().catch(() => ({})); throw Error(error.error || `Session API returned ${response.status}`); }
    return response;
  }
  const json = async (path, method, body) => (await (await api(path, method, body)).json()).data;
  const id = () => { const value = required('--id'); if (!/^[a-f0-9-]{36}$/.test(value)) throw Error('Invalid asset ID'); return value; };
  if (command === 'config') return json('config');
  if (command === 'upload-bundle') {
    if(!values.includes('--reviewed'))throw Error('Review every prepared file, then supply --reviewed for private upload.');
    return uploadFileBundle(required('--dir'),required('--source'),{json,put});
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
    const result = await put(url, { headers, body: data, signal: AbortSignal.timeout(600000) });
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
    if(raw.length>multiFileLimits.maxManifestBytes||digest(raw)!==asset.digest)throw Error('Stored manifest digest mismatch');
    const manifest=validateFileManifest(JSON.parse(raw));
    await writeDownloadedBundle(required('--out'),manifest,raw,async f=>Buffer.from(await(await api(`assets/${assetID}/files/${encodeURIComponent(f.id)}/download`)).arrayBuffer()));
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
  if (command === 'bind') return bindSession({apiBase: base.href.replace(/\/$/, ''), token}, id(), required('--app'));
  throw Error('Unknown command; run help');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().then(result => { if (result !== undefined) console.log(JSON.stringify(result, null, 2)); if (result?.status === 'pending') process.exitCode = 1; }).catch(error => { console.error(error.message); process.exitCode = 1; });
}
