// Canonical implementation. sync-variants.mjs also bundles this in paean-publish.
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { request as httpsRequest } from 'node:https';
import { creationLimits } from './creation-index.mjs';
import { readFileBundle } from './multi-file.mjs';

const MAX = creationLimits.maxBytes;
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
  if (input.length > MAX) throw Error('Session exceeds 64 MiB');
  const bytes = input[0] === 0x1f && input[1] === 0x8b ? gunzipSync(input, { maxOutputLength: MAX }) : input;
  const lines = new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^﻿/, '').split(/\r?\n/).filter(l => l.trim());
  if (!lines.length || lines.length > 1000000) throw Error('Expected 1–1000000 JSON records');
  const records = lines.map((line, i) => {
    if (Buffer.byteLength(line) > creationLimits.maxRecordBytes) throw Error(`Record ${i + 1} exceeds 16 MiB`);
    const value = JSON.parse(line);
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error(`Record ${i + 1} must be an object`);
    const prepared = JSON.stringify(clean(value));
    if (Buffer.byteLength(prepared) > creationLimits.maxRecordBytes) throw Error(`Prepared record ${i + 1} exceeds 16 MiB`);
    return prepared;
  });
  const output = Buffer.from(records.join('\n') + '\n');
  if (output.length > MAX) throw Error('Prepared session exceeds 64 MiB');
  return output;
}

/** Explicit HTTPS deadline: native fetch has an additional response-header timeout on slow PUTs. */
export function putDirectR2(url, {headers,body,signal}, request = httpsRequest) {
  return new Promise((resolve,reject)=>{
    const req=request(url,{method:'PUT',headers:{...headers,'Content-Length':body.length},signal},res=>{
      res.on('error',reject);res.on('end',()=>resolve({status:res.statusCode,ok:res.statusCode>=200&&res.statusCode<300}));res.resume();
    });
    req.on('error',reject);req.end(body);
  });
}

/** `json(path, method, body)` is the caller's authenticated client for `/sessions/<path>`. */
export async function uploadFileBundle(directory, sourceKey, {json, put = putDirectR2}) {
  const bundle=readFileBundle(directory,prepare,prepareText);
  if(sourceKey.length>200||/[\x00-\x1f\x7f]/.test(sourceKey)||!sourceKey.trim())throw Error('Invalid stable source ID');
  const config=await json('config');
  if(!config.enabled||!config.creationBundleVersions?.includes(2))throw Error('Server does not support multi-file creation bundles yet');
  if(config.portableCreationManifest!==true)throw Error('Server does not support portable creation manifests yet');
  if(!Number.isSafeInteger(config.multiFileLimits?.maxBytes??config.maxBytes)||bundle.manifest.files.reduce((n,f)=>n+f.bytes,0)>(config.multiFileLimits?.maxBytes??config.maxBytes))throw Error('Bundle exceeds server upload limit');
  if(bundle.manifest.streams.some(s=>bundle.manifest.files.filter(f=>f.kind==='session'&&f.streamId===s.id).length>1)&&config.chunkedCreationStreams!==true)throw Error('Server does not support chunked creation streams yet');
  if(bundle.manifest.files.some(f=>f.bytes>(config.multiFileLimits?.maxFileBytes??config.maxBytes)))throw Error('File exceeds server limit; rebuild the bundle to create smaller parts');
  const recordLimit=config.creationLimits?.maxRecordBytes ?? 1024*1024;
  if(!Number.isSafeInteger(recordLimit)||recordLimit<1)throw Error('Invalid server record limit');
  for(const f of bundle.manifest.files.filter(f=>f.kind==='session')) {
    if(bundle.blobs.get(f.id).toString('utf8').split('\n').some(line=>Buffer.byteLength(line)>recordLimit))throw Error('Log record exceeds server limit; update the server before uploading');
  }
  const renew=()=>json('bundle-uploads','POST',{sourceKey,manifest:bundle.manifest});
  let intent=await renew();
  if(intent.asset.state==='ready')return intent.asset;
  if(!Array.isArray(intent.files)||intent.files.length!==bundle.manifest.files.length||new Set(intent.files.map(f=>f.id)).size!==intent.files.length)throw Error('Invalid server bundle file list');
  const selected=intent.files.map(f=>f.id);
  let next=0,failure,renewal;
  const fresh=async()=>{
    if(intent.expiresAt && Date.parse(intent.expiresAt)-Date.now()<60000) {
      renewal??=renew().then(value=>{intent=value;}).finally(()=>{renewal=undefined;});
      await renewal;
    }
  };
  const worker=async()=>{
    while(!failure) {
      const at=next++;if(at>=selected.length)return;
      try {
        await fresh();
        const f=intent.files.find(f=>f.id===selected[at]);if(!f)throw Error('Missing renewed file');
        if(f.state==='ready')continue;
        const bytes=bundle.blobs.get(f.id);if(!bytes)throw Error('Unknown server file ID');
        const url=new URL(f.uploadUrl);
        if(url.protocol!=='https:'||!url.hostname.endsWith('.r2.cloudflarestorage.com'))throw Error('Invalid private upload URL');
        let response;
        try {response=await put(url,{headers:f.headers,body:bytes,signal:AbortSignal.timeout(600000)});}
        catch(error){throw Error(`Direct R2 upload interrupted for ${f.id} (${error.name}); retry the identical upload-bundle command to retain verified parts`,{cause:error});}
        if(!response.ok)throw Error(`File upload failed (${response.status}); retry the identical upload-bundle command`);
        await fresh(); // A slow PUT may outlive the original completion window.
        await json(`bundle-uploads/${encodeURIComponent(intent.asset.id)}/files/${encodeURIComponent(f.id)}/complete`,'POST');
      }catch(error){failure??=error;}
    }
  };
  // Settle active parts before reporting a failure; completed parts remain resumable.
  await Promise.all(Array.from({length:Math.min(3,selected.length)},()=>worker()));
  if(failure)throw failure;
  let previous=-1;
  for(;;) {
    if(intent.expiresAt && Date.parse(intent.expiresAt)-Date.now()<60000)intent=await renew();
    const result=await json(`bundle-uploads/${encodeURIComponent(intent.asset.id)}/complete`,'POST');
    if(result.state==='ready')return result;
    const progress=result.finalization?.completedFiles;
    if(!Number.isSafeInteger(progress)||progress<=previous)throw Error('Finalization did not advance; retry the identical upload-bundle command');
    previous=progress;
  }
}
