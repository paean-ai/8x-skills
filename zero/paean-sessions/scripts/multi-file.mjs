import { readFileSync, realpathSync, statSync, mkdirSync, writeFileSync, rmSync, lstatSync } from 'node:fs';
import { resolve, relative, isAbsolute, sep, dirname, join } from 'node:path';
import { createHash } from 'node:crypto';

const MAX = 20 * 1024 * 1024;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const id = value => typeof value === 'string' && value!=='.' && value!=='..' && /^[A-Za-z0-9_.:-]{1,200}$/.test(value);
const safePath = value => typeof value === 'string' && value.length <= 500 && !/[\\:\x00-\x1f\x7f]/.test(value) && value.split('/').every(p=>p && p!=='.' && p!=='..');
const read = path => { const s=statSync(path); if(!s.isFile() || s.size>MAX)throw Error('Select regular files up to 20 MB');return readFileSync(path); };
function inside(root, file) {
  const actual = realpathSync(resolve(root,file)), path = relative(root,actual);
  if (!path || isAbsolute(path) || path==='..' || path.startsWith('..'+sep)) throw Error('File escapes selected directory (including symlinks)');
  return { actual, path:path.split(sep).join('/') };
}

export function validateFileManifest(m) {
  if(!m || m.format!=='paean-creation' || m.version!==2 || !Array.isArray(m.streams) || !m.streams.length || m.streams.length>100 ||
      !Array.isArray(m.files) || !m.files.length || m.files.length>600 || Buffer.byteLength(JSON.stringify(m))>512*1024) throw Error('Invalid multi-file manifest');
  const streams = new Map(), ids = new Set(), paths = new Set(), logs = new Set(), aliases = new Map();
  for(const s of m.streams) {
    if(!s || !id(s.id) || streams.has(s.id) || (s.parentStreamId!==undefined && !id(s.parentStreamId)) ||
        (s.parentCallId!==undefined && (!id(s.parentCallId) || !s.parentStreamId)))throw Error('Invalid stream identity or parent');
    streams.set(s.id,s);
  }
  for(const s of streams.values()) {
    const seen=new Set([s.id]);let p=s.parentStreamId;
    while(p!==undefined) { if(!streams.has(p)||seen.has(p))throw Error('Missing or cyclic parent stream');seen.add(p);p=streams.get(p).parentStreamId; }
  }
  let size=0, scripts=0;
  for(const f of m.files) {
    if(!f || !id(f.id)||ids.has(f.id)||!safePath(f.path)||paths.has(f.path.toLowerCase())||f.path.split('/')[0].toLowerCase()==='manifest.json'||!['session','script'].includes(f.kind))throw Error('Invalid or duplicate file ID/path');
    if(!Number.isSafeInteger(f.bytes)||f.bytes<(f.kind==='session'?1:0)||!Number.isSafeInteger(size+=f.bytes)||size>MAX||!/^[a-f0-9]{64}$/.test(f.digest))throw Error('Invalid bundle file size or digest');
    for(const path of [f.path,...(f.objectPath!==undefined?[f.objectPath]:[])]) {
      if(!safePath(path)||path.split('/')[0].toLowerCase()==='manifest.json')throw Error('Invalid relative object path');
      const normalized=path.normalize('NFC').toLowerCase();
      if(aliases.has(normalized)&&aliases.get(normalized)!==f.id)throw Error('File paths and object paths overlap');
      aliases.set(normalized,f.id);
    }
    if(f.streamId!==undefined&&!streams.has(f.streamId))throw Error('Unknown file stream');
    if(f.callId!==undefined&&(!id(f.callId)||!f.streamId))throw Error('File call requires a stream');
    if(f.kind==='session') {
      if(!f.streamId||logs.has(f.streamId)||!f.path.endsWith('.jsonl')||f.callId!==undefined)throw Error('One JSONL file is required per stream');
      logs.add(f.streamId);
    } else if(++scripts>500||f.bytes>5*1024*1024)throw Error('Script exceeds limits');
    ids.add(f.id);paths.add(f.path.toLowerCase());
  }
  if(logs.size!==streams.size)throw Error('Missing stream file');
  for(const p of aliases.keys()) for(let at=p.indexOf('/');at>=0;at=p.indexOf('/',at+1)) if(aliases.has(p.slice(0,at)))throw Error('File path conflicts with directory');
  return m;
}

export function buildFileBundle(input, manifestDirectory, projectDirectory, prepare, prepareText) {
  if(!input || !Array.isArray(input.streams)||!input.streams.length||input.streams.length>100||!Array.isArray(input.scripts)||input.scripts.length>500)throw Error('Expected streams and script snapshots');
  const root=realpathSync(projectDirectory), blobs=new Map(), files=[];
  const streams=input.streams.map(s=>({id:s.id,...(s.parentStreamId!==undefined?{parentStreamId:s.parentStreamId}:{}),...(s.parentCallId!==undefined?{parentCallId:s.parentCallId}:{})}));
  let size=0, events=0;
  const add=(meta,bytes)=>{
    size+=bytes.length;if(size>MAX)throw Error('Bundle exceeds 20 MB');
    files.push({...meta,bytes:bytes.length,digest:hash(bytes),objectPath:meta.path});blobs.set(meta.id,bytes);
  };
  input.streams.forEach((s,index)=>{
    if(typeof s.file!=='string')throw Error('Missing selected log file');
    const bytes=prepare(read(resolve(manifestDirectory,s.file)));
    const rows=bytes.toString().trim().split('\n').map(line=>JSON.parse(line));
    if(rows.some(r=>['paean_creation_bundle','creation_event','creation_script'].includes(r.type)))throw Error('Select original logs, not nested bundles');
    events+=rows.length;if(events>50000)throw Error('Bundle exceeds 50000 events');
    add({id:`log-${index+1}`,kind:'session',path:`sessions/${index+1}.jsonl`,streamId:s.id},bytes);
  });
  input.scripts.forEach((s,index)=>{
    if(typeof s.file!=='string')throw Error('Missing selected script file');
    const file=inside(root,s.file);
    add({id:s.scriptId,kind:'script',path:`scripts/${index+1}/${file.path}`,...(s.streamId!==undefined?{streamId:s.streamId}:{}),...(s.callId!==undefined?{callId:s.callId}:{})},prepareText(read(file.actual)));
  });
  const manifest=validateFileManifest({format:'paean-creation',version:2,streams,files});
  return {manifest,blobs};
}

export function writeFileBundle(directory, bundle) {
  validateFileManifest(bundle.manifest);
  const raw = bundle.manifestBytes ?? Buffer.from(JSON.stringify(bundle.manifest,null,2)+'\n');
  if(raw.length>512*1024 || JSON.stringify(JSON.parse(raw))!==JSON.stringify(bundle.manifest))throw Error('Manifest bytes do not match bundle metadata');
  // mkdir without recursive fails on an existing destination, protecting user files.
  mkdirSync(directory,{mode:0o700});
  try {
    for(const f of bundle.manifest.files) {
      const path=join(directory,f.path), bytes=bundle.blobs.get(f.id);
      if(!bytes||bytes.length!==f.bytes||hash(bytes)!==f.digest)throw Error('Bundle file checksum mismatch');
      mkdirSync(dirname(path),{recursive:true,mode:0o700});writeFileSync(path,bytes,{mode:0o600,flag:'wx'});
    }
    // Keep the exact stored bytes so a trusted package/offer digest remains verifiable offline.
    writeFileSync(join(directory,'manifest.json'),raw,{mode:0o600,flag:'wx'});
  } catch(e) {rmSync(directory,{recursive:true,force:true});throw e;}
}

export function readPortableBundle(directory, { layout='auto', expectedDigest } = {}) {
  if(!['auto','local','storage'].includes(layout))throw Error('Layout must be auto, local or storage');
  if(expectedDigest!==undefined&&!/^[a-f0-9]{64}$/.test(expectedDigest))throw Error('Expected a SHA-256 manifest digest');
  const root=realpathSync(directory);
  const manifestPath=inside(root,'manifest.json').actual;
  if(statSync(manifestPath).size>512*1024)throw Error('Manifest exceeds size limit');
  const raw=read(manifestPath),manifestDigest=hash(raw);
  if(expectedDigest!==undefined&&manifestDigest!==expectedDigest)throw Error('Manifest digest mismatch');
  const manifest=validateFileManifest(JSON.parse(raw));
  const blobs=new Map();let events=0;
  for(const f of manifest.files) {
    let selected=f.path;
    if(layout==='storage') {
      if(f.objectPath===undefined)throw Error('This legacy manifest has no storage paths; first download it through the authenticated API');
      selected=f.objectPath;
    } else if(layout==='auto') {
      // Fall back only on absence, never on invalid data, permissions or an escaping symlink.
      let present=true;
      try{lstatSync(resolve(root,f.path));}catch(e){if(e.code==='ENOENT')present=false;else throw e;}
      if(!present&&f.objectPath!==undefined)selected=f.objectPath;
    }
    const bytes=read(inside(root,selected).actual);
    if(bytes.length!==f.bytes||hash(bytes)!==f.digest)throw Error('Bundle file changed; rebuild and review the bundle');
    const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);
    if(f.kind==='session') {
      const lines=text.split(/\r?\n/).filter(line=>line.trim());
      if(!lines.length||lines.some(line=>Buffer.byteLength(line)>1024*1024))throw Error('Invalid log record size');
      const rows=lines.map(line=>JSON.parse(line));
      if(rows.some(r=>!r||typeof r!=='object'||Array.isArray(r)))throw Error('Log records must be objects');
      if(rows.some(r=>['paean_creation_bundle','creation_event','creation_script'].includes(r.type)))throw Error('Nested bundles are not session files');
      events+=rows.length;if(events>50000)throw Error('Bundle exceeds event limit');
    } else if(text.includes('\0'))throw Error('Scripts must be UTF-8 text');
    blobs.set(f.id,bytes);
  }
  return {manifest,blobs,manifestBytes:raw,manifestDigest};
}

export function readFileBundle(directory, prepare, prepareText) {
  const bundle=readPortableBundle(directory,{layout:'local'});
  for(const f of bundle.manifest.files) {
    const bytes=bundle.blobs.get(f.id);
    if(!(f.kind==='session'?prepare(bytes):prepareText(bytes)).equals(bytes))throw Error('Bundle is not prepared; rebuild and review');
  }
  return bundle;
}
