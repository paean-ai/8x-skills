import { readFileSync, realpathSync, statSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
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
  const streams = new Map(), ids = new Set(), paths = new Set(), logs = new Set();
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
    if(f.streamId!==undefined&&!streams.has(f.streamId))throw Error('Unknown file stream');
    if(f.callId!==undefined&&(!id(f.callId)||!f.streamId))throw Error('File call requires a stream');
    if(f.kind==='session') {
      if(!f.streamId||logs.has(f.streamId)||!f.path.endsWith('.jsonl')||f.callId!==undefined)throw Error('One JSONL file is required per stream');
      logs.add(f.streamId);
    } else if(++scripts>500||f.bytes>5*1024*1024)throw Error('Script exceeds limits');
    ids.add(f.id);paths.add(f.path.toLowerCase());
  }
  if(logs.size!==streams.size)throw Error('Missing stream file');
  for(const p of paths) for(let at=p.indexOf('/');at>=0;at=p.indexOf('/',at+1)) if(paths.has(p.slice(0,at)))throw Error('File path conflicts with directory');
  return m;
}

export function buildFileBundle(input, manifestDirectory, projectDirectory, prepare, prepareText) {
  if(!input || !Array.isArray(input.streams)||!input.streams.length||input.streams.length>100||!Array.isArray(input.scripts)||input.scripts.length>500)throw Error('Expected streams and script snapshots');
  const root=realpathSync(projectDirectory), blobs=new Map(), files=[];
  const streams=input.streams.map(s=>({id:s.id,...(s.parentStreamId!==undefined?{parentStreamId:s.parentStreamId}:{}),...(s.parentCallId!==undefined?{parentCallId:s.parentCallId}:{})}));
  let size=0, events=0;
  const add=(meta,bytes)=>{
    size+=bytes.length;if(size>MAX)throw Error('Bundle exceeds 20 MB');
    files.push({...meta,bytes:bytes.length,digest:hash(bytes)});blobs.set(meta.id,bytes);
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
  // mkdir without recursive fails on an existing destination, protecting user files.
  mkdirSync(directory,{mode:0o700});
  try {
    for(const f of bundle.manifest.files) {
      const path=join(directory,f.path), bytes=bundle.blobs.get(f.id);
      if(!bytes||bytes.length!==f.bytes||hash(bytes)!==f.digest)throw Error('Bundle file checksum mismatch');
      mkdirSync(dirname(path),{recursive:true,mode:0o700});writeFileSync(path,bytes,{mode:0o600,flag:'wx'});
    }
    writeFileSync(join(directory,'manifest.json'),JSON.stringify(bundle.manifest,null,2)+'\n',{mode:0o600,flag:'wx'});
  } catch(e) {rmSync(directory,{recursive:true,force:true});throw e;}
}

export function readFileBundle(directory, prepare, prepareText) {
  const root=realpathSync(directory);
  const manifestPath=inside(root,'manifest.json').actual;
  if(statSync(manifestPath).size>512*1024)throw Error('Manifest exceeds size limit');
  const manifest=validateFileManifest(JSON.parse(read(manifestPath)));
  const blobs=new Map();let events=0;
  for(const f of manifest.files) {
    const bytes=read(inside(root,f.path).actual);
    if(bytes.length!==f.bytes||hash(bytes)!==f.digest)throw Error('Bundle file changed; rebuild and review the bundle');
    if(!(f.kind==='session'?prepare(bytes):prepareText(bytes)).equals(bytes))throw Error('Bundle is not prepared; rebuild and review');
    if(f.kind==='session') {
      const rows=bytes.toString().trim().split('\n').map(line=>JSON.parse(line));
      if(rows.some(r=>['paean_creation_bundle','creation_event','creation_script'].includes(r.type)))throw Error('Nested bundles are not session files');
      events+=rows.length;if(events>50000)throw Error('Bundle exceeds event limit');
    }
    blobs.set(f.id,bytes);
  }
  return {manifest,blobs};
}
