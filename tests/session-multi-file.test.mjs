import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, statSync, symlinkSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { main as cliMain, prepare, prepareText, digest } from '../codex/paean-sessions/scripts/sessions.mjs';
const main=args=>cliMain(args,{put:(url,options)=>globalThis.fetch(url,{method:'PUT',...options})});
import { readFileBundle, validateFileManifest } from '../codex/paean-sessions/scripts/multi-file.mjs';

const assetId='11111111-1111-4111-8111-111111111111';
const response=data=>new Response(JSON.stringify({data}));
function fixture() {
  const dir=mkdtempSync(join(tmpdir(),'session-multifile-'));
  mkdirSync(join(dir,'project'));
  writeFileSync(join(dir,'session.jsonl'),JSON.stringify({type:'tool_call',id:'c1',name:'exec',input:'node build.js'})+'\n');
  writeFileSync(join(dir,'project/build.js'),'const password="script-secret";\nconsole.log("build");\n');
  const manifest={streams:[{id:'main',file:'session.jsonl'}],scripts:[{scriptId:'build',file:'build.js',streamId:'main',callId:'c1'}]};
  const dirOut=join(dir,'prepared');
  const args=['bundle','--manifest',join(dir,'input.json'),'--project',join(dir,'project'),'--out',dirOut];
  const save=()=>writeFileSync(join(dir,'input.json'),JSON.stringify(manifest));save();
  return {dir,manifest,dirOut,args,save,cleanup:()=>rmSync(dir,{recursive:true,force:true})};
}
async function withAPI(fn) {
  const before=globalThis.fetch,token=process.env.PAEAN_AUTH_TOKEN;
  process.env.PAEAN_AUTH_TOKEN='fixture';
  try {await fn();}finally{globalThis.fetch=before;if(token===undefined)delete process.env.PAEAN_AUTH_TOKEN;else process.env.PAEAN_AUTH_TOKEN=token;}
}

test('default bundle creates independent private files and manifest; larger scripts stay out of JSONL',async()=>{
  const f=fixture();
  try {
    writeFileSync(join(f.dir,'project/build.js'),'const api_key="large-secret";\n'+'// code\n'.repeat(170000));
    await main(f.args);
    const m=JSON.parse(readFileSync(join(f.dirOut,'manifest.json')));
    assert.equal(m.version,2);assert.equal(m.files.length,2);
    assert(!JSON.stringify(m).includes('console.log'));assert(!JSON.stringify(m).includes(f.dir));
    const script=readFileSync(join(f.dirOut,m.files[1].path));
    assert(script.length>1024*1024);assert(!script.toString().includes('large-secret'));
    assert.equal(digest(script),m.files[1].digest);assert(prepareText(script).equals(script));
    assert.equal(readFileBundle(f.dirOut,prepare,prepareText).blobs.size,2);
    assert.equal(statSync(f.dirOut).mode&0o777,0o700);assert.equal(statSync(join(f.dirOut,m.files[0].path)).mode&0o777,0o600);
    await assert.rejects(main(f.args),/EEXIST/);
    assert(readFileSync(join(f.dir,'project/build.js'),'utf8').includes('large-secret'));
  } finally {f.cleanup();}
});

test('directory manifests reject traversal, case/path collisions, tampering and escaping symlinks',async()=>{
  const f=fixture();
  try {
    await main(f.args);const original=JSON.parse(readFileSync(join(f.dirOut,'manifest.json')));
    for(const path of ['../outside','/absolute','manifest.json','manifest.json/child','SESSIONS/1/0.JSONL','sessions']) {
      const m=structuredClone(original);m.files[1].path=path;assert.throws(()=>validateFileManifest(m));
    }
    writeFileSync(join(f.dirOut,original.files[1].path),'changed');
    assert.throws(()=>readFileBundle(f.dirOut,prepare,prepareText),/changed/);
    symlinkSync(join(f.dir,'session.jsonl'),join(f.dir,'project/leak'));
    f.manifest.scripts[0].file='leak';f.save();
    await assert.rejects(main([...f.args.slice(0,-1),join(f.dir,'bad')]),/escapes/);
    assert(!existsSync(join(f.dir,'bad')));
  } finally {f.cleanup();}
});

test('multi-file upload retries skip completed files and do not share or upload manifest bodies',async()=>{
  const f=fixture();
  try {
    await main(f.args);const b=readFileBundle(f.dirOut,prepare,prepareText),ready=new Set(),puts=[];let fail=true,completed=false;
    await withAPI(async()=>{
      globalThis.fetch=async(url,options)=>{
        const u=new URL(url);
        if(u.pathname==='/sessions/config')return response({enabled:true,maxBytes:20*1024*1024,creationBundleVersions:[1,2],portableCreationManifest:true});
        if(u.pathname==='/sessions/bundle-uploads') {
          const body=JSON.parse(options.body);assert.equal(body.sourceKey,'stable');assert.deepEqual(body.manifest,b.manifest);
          return response({asset:{id:assetId,state:completed?'ready':'uploading'},files:b.manifest.files.map(f=>({id:f.id,state:ready.has(f.id)?'ready':'uploading',uploadUrl:ready.has(f.id)?null:`https://test.r2.cloudflarestorage.com/${f.id}`,headers:{'Content-Type':f.kind==='session'?'application/x-ndjson':'text/plain; charset=utf-8'}}))});
        }
        if(options.method==='PUT') {
          const id=u.pathname.slice(1);puts.push(id);assert(Buffer.from(options.body).equals(b.blobs.get(id)));assert.equal(options.headers.Authorization,undefined);
          if(id==='build'&&fail){fail=false;return new Response('',{status:503});}return new Response('');
        }
        const file=u.pathname.match(/\/files\/([^/]+)\/complete$/);
        if(file){ready.add(file[1]);return response({state:'ready'});}
        assert.equal(u.pathname,`/sessions/bundle-uploads/${assetId}/complete`);assert.equal(ready.size,2);completed=true;return response({id:assetId,state:'ready'});
      };
      const args=['upload-bundle','--dir',f.dirOut,'--source','stable','--reviewed'];
      await assert.rejects(main(args),/retry the identical/);
      assert.equal((await main(args)).state,'ready');assert.equal((await main(args)).state,'ready');
      assert.deepEqual(puts,['log-1','build','build']);
    });
  } finally {f.cleanup();}
});

test('unsupported servers and unreviewed/modified files prevent multi-file mutations',async()=>{
  const f=fixture();
  try {
    await main(f.args);
    await withAPI(async()=>{
      let calls=0;globalThis.fetch=async(_url,options)=>{calls++;assert.equal(options.method,'GET');return response({enabled:true,maxBytes:20000000,creationBundleVersions:[1]});};
      await assert.rejects(main(['upload-bundle','--dir',f.dirOut,'--source','stable']),/reviewed/);assert.equal(calls,0);
      await assert.rejects(main(['upload-bundle','--dir',f.dirOut,'--source','stable','--reviewed']),/does not support/);assert.equal(calls,1);
      const m=JSON.parse(readFileSync(join(f.dirOut,'manifest.json')));writeFileSync(join(f.dirOut,m.files[0].path),'changed');
      await assert.rejects(main(['upload-bundle','--dir',f.dirOut,'--source','stable','--reviewed']),/changed/);assert.equal(calls,1);
    });
  } finally {f.cleanup();}
});

test('download restores independent files and validates the manifest and every file digest',async()=>{
  const f=fixture();
  try {
    await main(f.args);const bundle=readFileBundle(f.dirOut,prepare,prepareText),raw=Buffer.from(JSON.stringify(bundle.manifest)+'\n');
    await withAPI(async()=>{
      let corrupt=false;
      globalThis.fetch=async url=>{
        const path=new URL(url).pathname;
        if(path.endsWith('/download')&&!path.includes('/files/'))return new Response(raw);
        if(path.includes('/files/'))return new Response(corrupt?Buffer.from('corrupt'):bundle.blobs.get(decodeURIComponent(path.split('/').at(-2))));
        return response({format:'creation-bundle-v2',digest:digest(raw)});
      };
      const out=join(f.dir,'download');await main(['download-bundle','--id',assetId,'--out',out]);
      assert.deepEqual(readFileBundle(out,prepare,prepareText).manifest,bundle.manifest);
      corrupt=true;await assert.rejects(main(['download-bundle','--id',assetId,'--out',join(f.dir,'bad-download')]),/digest mismatch/);
      assert(!existsSync(join(f.dir,'bad-download')));
    });
  } finally {f.cleanup();}
});

test('large native image records survive build, offline restore, upload and download without configuration',async()=>{
  const f=fixture();
  try {
    const row=JSON.stringify({type:'user',message:{content:[{type:'image',source:{data:'A'.repeat(2*1024*1024)}}]}})+'\n';
    writeFileSync(join(f.dir,'session.jsonl'),row.repeat(19));
    await main(f.args);
    const b=readFileBundle(f.dirOut,prepare,prepareText);
    assert(b.blobs.get('log-1').length>20*1024*1024);
    assert.equal(b.manifest.files.filter(f=>f.kind==='session').length,2);
    const joined=join(f.dir,'joined.jsonl');await main(['restore-stream','--dir',f.dirOut,'--stream','main','--out',joined]);assert(readFileSync(joined).equals(prepare(Buffer.from(row.repeat(19)))));
    const invalid=structuredClone(b.manifest);invalid.files[1].part=0;assert.throws(()=>validateFileManifest(invalid),/part/);
    const restored=join(f.dir,'restored');
    await main(['restore-bundle','--dir',f.dirOut,'--out',restored]);
    assert(readFileBundle(restored,prepare,prepareText).blobs.get('log-1').equals(b.blobs.get('log-1')));
    await withAPI(async()=>{
      let limit=1024*1024, uploaded=false,intents=0,finishes=0,active=0,maxActive=0;
      const raw=Buffer.from(JSON.stringify(b.manifest)+'\n');
      globalThis.fetch=async(url,options)=>{
        const path=new URL(url).pathname;
        if(path==='/sessions/config')return response({enabled:true,maxBytes:64*1024*1024,multiFileLimits:{maxBytes:100*1024**3,maxFileBytes:32*1024*1024},chunkedCreationStreams:true,creationLimits:{maxRecordBytes:limit},creationBundleVersions:[2],portableCreationManifest:true});
        if(path==='/sessions/bundle-uploads')return response({expiresAt:new Date(++intents===1?0:Date.now()+600000).toISOString(),asset:{id:assetId,state:'uploading'},files:b.manifest.files.map(f=>({id:f.id,state:'uploading',uploadUrl:`https://test.r2.cloudflarestorage.com/${f.id}`}))});
        if(options.method==='PUT'){active++;maxActive=Math.max(maxActive,active);assert(Buffer.from(options.body).equals(b.blobs.get(path.slice(1))));uploaded=true;await new Promise(resolve=>setTimeout(resolve,5));active--;return new Response('');}
        if(path===`/sessions/bundle-uploads/${assetId}/complete` && ++finishes===1)return response({id:assetId,state:'uploading',finalization:{completedFiles:1,totalFiles:2}});
        if(options.method==='POST')return response({id:assetId,state:'ready'});
        if(path.includes('/files/'))return new Response(b.blobs.get(decodeURIComponent(path.split('/').at(-2))));
        if(path.endsWith('/download'))return new Response(raw);
        return response({format:'creation-bundle-v2',digest:digest(raw)});
      };
      const args=['upload-bundle','--dir',f.dirOut,'--source','large','--reviewed'];
      await assert.rejects(main(args),/record exceeds server limit/);assert.equal(uploaded,false);
      limit=8*1024*1024;
      assert.equal((await main(args)).state,'ready');assert(uploaded);assert.equal(intents,2);assert.equal(finishes,2);assert.equal(maxActive,3);
      const out=join(f.dir,'download');
      await main(['download-bundle','--id',assetId,'--out',out]);
      assert(readFileBundle(out,prepare,prepareText).blobs.get('log-1').equals(b.blobs.get('log-1')));
    });
  } finally {f.cleanup();}
});
