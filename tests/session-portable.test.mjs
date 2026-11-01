import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { main, digest } from '../codex/paean-sessions/scripts/sessions.mjs';
import { readPortableBundle, validateFileManifest } from '../codex/paean-sessions/scripts/multi-file.mjs';

function fixture() {
  const root=mkdtempSync(join(tmpdir(),'portable-session-')),dir=join(root,'r2-export');
  mkdirSync(join(dir,'files'),{recursive:true});
  const parent=Buffer.from(JSON.stringify({type:'tool_call',id:'spawn',name:'spawn_agent',input:{task:'build'}})+'\n'+JSON.stringify({type:'tool_result',tool_use_id:'spawn',content:'worker finished'})+'\n');
  const child=Buffer.from(JSON.stringify({type:'response_item',payload:{type:'function_call',call_id:'c1',name:'exec',arguments:'{"cmd":"node build.js"}'}})+'\n'+JSON.stringify({type:'response_item',payload:{type:'function_call_output',call_id:'c1',output:'full build output\nline 2'}})+'\n');
  const script=Buffer.from('throw new Error("this must never execute");\n');
  const blobs=[parent,child,script];
  const files=[{id:'main-log',kind:'session',path:'sessions/main.jsonl',streamId:'main'},
    {id:'worker-log',kind:'session',path:'sessions/worker.jsonl',streamId:'worker'},
    {id:'build',kind:'script',path:'scripts/build.js',streamId:'worker',callId:'c1'}].map((f,i)=>({...f,objectPath:`files/object-${i}`,bytes:blobs[i].length,digest:digest(blobs[i])}));
  const manifest={format:'paean-creation',version:2,streams:[{id:'main'},{id:'worker',parentStreamId:'main',parentCallId:'spawn'}],files};
  const raw=Buffer.from(JSON.stringify(manifest)+'\n');writeFileSync(join(dir,'manifest.json'),raw);
  files.forEach((f,i)=>writeFileSync(join(dir,f.objectPath),blobs[i]));
  return {root,dir,manifest,raw,blobs,cleanup:()=>rmSync(root,{recursive:true,force:true})};
}

test('raw R2 prefix restores and inspects offline with no credentials, network or database',async()=>{
  const f=fixture(),before=globalThis.fetch,base=process.env.PAEAN_API_BASE;
  globalThis.fetch=()=>{throw Error('Network must not be used');};process.env.PAEAN_API_BASE='invalid-url-to-prove-offline';
  try {
    const summary=await main(['verify-bundle','--dir',f.dir,'--layout','storage','--digest',digest(f.raw)]);
    assert.equal(summary.fileCount,3);assert.equal(summary.eventCount,4);assert.equal(summary.issueCount,0);
    const out=join(f.root,'restored');
    assert.equal((await main(['restore-bundle','--dir',f.dir,'--out',out,'--digest',digest(f.raw)])).restored,true);
    assert(readFileSync(join(out,'manifest.json')).equals(f.raw),'preserve manifest bytes/digest');
    f.manifest.files.forEach((file,i)=>assert(readFileSync(join(out,file.path)).equals(f.blobs[i])));
    rmSync(f.dir,{recursive:true}); // Original R2 export is gone: only restored directory remains.
    const tools=await main(['inspect-bundle','--dir',out,'--section','tools']);
    assert.equal(tools.total,2);assert(tools.items.every(t=>t.status==='paired'));
    assert.equal(tools.items[1].results[0].value,'full build output\nline 2');
    assert.deepEqual(tools.items[1].results[0].source,{fileId:'worker-log',path:'sessions/worker.jsonl',line:2});
    const scripts=await main(['inspect-bundle','--dir',out,'--section','scripts']);
    assert.equal(scripts.items[0].callId,'c1');assert.equal(scripts.items[0].content,f.blobs[2].toString());
    assert.equal((await main(['inspect-bundle','--dir',out])).streams[1].parentCallId,'spawn');
    await assert.rejects(main(['restore-bundle','--dir',out,'--out',out]),/EEXIST/);
  } finally {globalThis.fetch=before;if(base===undefined)delete process.env.PAEAN_API_BASE;else process.env.PAEAN_API_BASE=base;f.cleanup();}
});

test('portable references reject traversal, URL references, alias collisions and escaping symlinks',()=>{
  const f=fixture();
  try {
    for(const objectPath of ['../private','/absolute','https://host/file','a\\b','manifest.json/other','sessions/main.jsonl','sessions']) {
      const m=structuredClone(f.manifest);m.files[2].objectPath=objectPath;assert.throws(()=>validateFileManifest(m));
    }
    const target=join(f.root,'external.js');writeFileSync(target,f.blobs[2]);
    rmSync(join(f.dir,f.manifest.files[2].objectPath));symlinkSync(target,join(f.dir,f.manifest.files[2].objectPath));
    assert.throws(()=>readPortableBundle(f.dir),/escapes/);
  } finally {f.cleanup();}
});

test('offline verification detects corrupt files and manifest changes without mutating input',async()=>{
  const f=fixture();
  try {
    await assert.rejects(main(['verify-bundle','--dir',f.dir,'--digest','0'.repeat(64)]),/Manifest digest mismatch/);
    writeFileSync(join(f.dir,f.manifest.files[2].objectPath),'corrupt');
    await assert.rejects(main(['verify-bundle','--dir',f.dir]),/changed/);
    assert(readFileSync(join(f.dir,'manifest.json')).equals(f.raw));
  } finally {f.cleanup();}
});

test('legacy local directories remain readable but missing legacy storage references are explicit',async()=>{
  const f=fixture();
  try {
    f.manifest.files.forEach((file,i)=>{
      const target=join(f.dir,file.path);mkdirSync(join(target,'..'),{recursive:true});writeFileSync(target,f.blobs[i]);delete file.objectPath;
    });
    writeFileSync(join(f.dir,'manifest.json'),JSON.stringify(f.manifest));
    assert.equal((await main(['verify-bundle','--dir',f.dir])).fileCount,3);
    await assert.rejects(main(['verify-bundle','--dir',f.dir,'--layout','storage']),/legacy manifest has no storage paths/);
  } finally {f.cleanup();}
});
