import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, statSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { main, prepare } from '../codex/paean-sessions/scripts/sessions.mjs';

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'creation-bundle-'));
  mkdirSync(join(dir, 'project')); mkdirSync(join(dir, 'project/scripts'));
  writeFileSync(join(dir, 'project/scripts/build.mjs'), 'const password="private-script-secret";\nconsole.log("done");\n');
  writeFileSync(join(dir, 'main.jsonl'), JSON.stringify({ type:'response_item',payload:{type:'function_call',call_id:'c1',name:'exec',arguments:'{"cmd":"node scripts/build.mjs","api_key":"private-args-secret"}'}})+'\n');
  writeFileSync(join(dir, 'child.jsonl'), JSON.stringify({type:'tool_result',tool_use_id:'x1',content:'full output\nline2'})+'\n');
  const manifest = {streams:[{id:'main',file:'main.jsonl'},{id:'child',file:'child.jsonl',parentStreamId:'main',parentCallId:'c1'}],scripts:[{scriptId:'build-v1',file:'scripts/build.mjs',streamId:'main',callId:'c1'}]};
  const args = ['bundle-jsonl','--manifest',join(dir,'inputs.json'),'--project',join(dir,'project'),'--out',join(dir,'creation.jsonl')];
  return {dir,manifest,args,save:()=>writeFileSync(join(dir,'inputs.json'),JSON.stringify(manifest)),cleanup:()=>rmSync(dir,{recursive:true,force:true})};
}

test('explicit bundle includes full logs and redacted scripts with deterministic private output', async () => {
  const f = fixture(); const originalFetch = globalThis.fetch;
  globalThis.fetch = () => { throw Error('Bundle must stay local'); };
  try {
    f.save(); await main(f.args);
    const bytes = readFileSync(join(f.dir,'creation.jsonl'));
    assert(!bytes.toString().includes('private-script-secret')); assert(!bytes.toString().includes('private-args-secret'));
    assert(!bytes.toString().includes(f.dir)); assert(prepare(bytes).equals(bytes));
    const rows = bytes.toString().trim().split('\n').map(JSON.parse);
    assert.equal(rows[0].version,1); assert.equal(rows[0].streams[1].parentCallId,'c1');
    assert.equal(rows[2].event.content,'full output\nline2'); assert.equal(rows[3].path,'scripts/build.mjs');
    assert(readFileSync(join(f.dir,'project/scripts/build.mjs'),'utf8').includes('private-script-secret'));
    assert.equal(statSync(join(f.dir,'creation.jsonl')).mode & 0o777,0o600);
    await assert.rejects(main(f.args),/EEXIST/);
  } finally { globalThis.fetch = originalFetch; f.cleanup(); }
});

test('bundle rejects escaping symlinks, invalid UTF-8, oversized scripts and invalid stream graphs', async () => {
  for (const scenario of ['symlink','utf8','oversize','cycle','duplicate','missing']) {
    const f = fixture();
    try {
      if (scenario === 'symlink') { symlinkSync(join(f.dir,'main.jsonl'),join(f.dir,'project/leak')); f.manifest.scripts[0].file='leak'; }
      if (scenario === 'utf8') writeFileSync(join(f.dir,'project/scripts/build.mjs'),Buffer.from([0xff]));
      if (scenario === 'oversize') writeFileSync(join(f.dir,'project/scripts/build.mjs'),'a'.repeat(16*1024*1024));
      if (scenario === 'cycle') f.manifest.streams[0].parentStreamId='child';
      if (scenario === 'duplicate') f.manifest.streams[1].id='main';
      if (scenario === 'missing') f.manifest.scripts[0].streamId='unknown';
      f.save(); await assert.rejects(main(f.args));
    } finally { f.cleanup(); }
  }
});

test('bundle upload negotiates capability and creation query is paginated', async () => {
  const f = fixture(); const before = globalThis.fetch, env = process.env.PAEAN_AUTH_TOKEN;
  process.env.PAEAN_AUTH_TOKEN='fixture-token';
  try {
    f.save(); await main(f.args);
    let calls = [];
    globalThis.fetch = async (url, options) => {
      calls.push({url:String(url),options});
      return new Response(JSON.stringify({data:{enabled:true,maxBytes:20000000}}));
    };
    await assert.rejects(main(['upload','--file',join(f.dir,'creation.jsonl'),'--source','same-session','--reviewed']),/does not support/);
    assert.equal(calls.length,1); assert.equal(calls[0].options.method,'GET');
    await main(['creation','--id','11111111-1111-4111-8111-111111111111','--section','tools','--offset','2','--limit','1']);
    assert(calls[1].url.endsWith('/creation?section=tools&offset=2&limit=1'));
    await assert.rejects(main(['creation','--id','11111111-1111-4111-8111-111111111111','--limit','101']),/pagination/);
    calls = [];
    globalThis.fetch = async (url, options) => {
      const path = String(url); calls.push(path);
      if(path.endsWith('/config')) return new Response(JSON.stringify({data:{enabled:true,maxBytes:20000000,creationBundleVersions:[1]}}));
      if(path.endsWith('/uploads')) {
        assert.equal(JSON.parse(options.body).sourceKey,'same-session');
        return new Response(JSON.stringify({data:{asset:{id:'asset',state:'uploading'},uploadUrl:'https://test.r2.cloudflarestorage.com/bundle',headers:{'Content-Type':'application/x-ndjson'}}}));
      }
      if(options.method==='PUT') {
        assert(Buffer.from(options.body).equals(readFileSync(join(f.dir,'creation.jsonl'))));
        assert.equal(options.headers.Authorization,undefined);
        return new Response('');
      }
      assert(path.endsWith('/uploads/asset/complete'));
      return new Response(JSON.stringify({data:{id:'asset',state:'ready'}}));
    };
    assert.equal((await main(['upload','--file',join(f.dir,'creation.jsonl'),'--source','same-session','--reviewed'])).state,'ready');
    assert.equal(calls.length,4);
  } finally { globalThis.fetch=before; if(env===undefined)delete process.env.PAEAN_AUTH_TOKEN;else process.env.PAEAN_AUTH_TOKEN=env;f.cleanup(); }
});
