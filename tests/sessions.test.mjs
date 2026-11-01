import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { prepare, digest, main } from '../codex/paean-sessions/scripts/sessions.mjs';

test('session preparation is local, bounded, repeatable and preserves originals', async () => {
  const original = Buffer.from('{"password":"secret-value","message":"Bearer test-token"}\n');
  const result = prepare(original);
  assert(!result.toString().includes('secret-value'));
  assert(!result.toString().includes('test-token'));
  assert(original.toString().includes('secret-value'));
  assert.equal(digest(prepare(result)),digest(result));
  assert.equal(digest(prepare(gzipSync(original))),digest(result));
  for (const bad of ['', '[]', 'null', '{bad}']) assert.throws(()=>prepare(Buffer.from(bad)));
  assert.throws(()=>prepare(Buffer.from([0xff])));
  assert.throws(()=>prepare(Buffer.alloc(21*1024*1024)));
  const directory = mkdtempSync(join(tmpdir(),'session-cli-'));
  try {
    const input=join(directory,'original.jsonl'),output=join(directory,'prepared.jsonl');
    writeFileSync(input,original);
    await main(['prepare','--file',input,'--out',output]);
    assert(readFileSync(input).equals(original));assert(readFileSync(output).equals(result));
    await assert.rejects(main(['prepare','--file',input,'--out',output]),/EEXIST/);
  } finally {rmSync(directory,{recursive:true,force:true});}
});

test('upload and sharing require explicit operation flags before network calls', async () => {
  const prior=process.env.PAEAN_AUTH_TOKEN;process.env.PAEAN_AUTH_TOKEN='local-test-token';
  const fetchBefore=globalThis.fetch;globalThis.fetch=()=>{throw Error('unexpected network');};
  try {
    await assert.rejects(main(['upload','--file','unread.jsonl','--source','one']),/reviewed/);
    await assert.rejects(main(['share','--id','11111111-1111-4111-8111-111111111111','--offer','unread.json']),/explicit consent/);
    await assert.rejects(main(['delete','--id','11111111-1111-4111-8111-111111111111']),/confirm-delete/);
  } finally {globalThis.fetch=fetchBefore;if(prior===undefined)delete process.env.PAEAN_AUTH_TOKEN;else process.env.PAEAN_AUTH_TOKEN=prior;}
});

test('bundle CLI preserves credential-file overrides, asset aliases and verified release linking', async () => {
  const directory=mkdtempSync(join(tmpdir(),'session-compat-'));
  const keys=['PAEAN_AUTH_TOKEN','PAEAN_CREDENTIALS_FILE','PAEAN_API_BASE'];
  const previous=Object.fromEntries(keys.map(key=>[key,process.env[key]]));
  const fetchBefore=globalThis.fetch,requests=[];
  const asset='11111111-1111-4111-8111-111111111111';
  writeFileSync(join(directory,'credentials.json'),JSON.stringify({token:'override-token'}));
  delete process.env.PAEAN_AUTH_TOKEN;
  process.env.PAEAN_CREDENTIALS_FILE=join(directory,'credentials.json');
  process.env.PAEAN_API_BASE='https://api.paean.ai';
  globalThis.fetch=async(url,options)=>{
    const endpoint=new URL(url).pathname;requests.push(endpoint);
    const isPublic=endpoint.startsWith('/session-evidence/');
    assert.equal(options.headers.Authorization,isPublic?undefined:'Bearer override-token');
    const data=isPublic?{assurance:'linked',releaseId:'release-1',label:'Creation session linked'}
      :endpoint.endsWith('/app-evidence')?{assurance:'linked',release_id:'release-1',receipt:'private-receipt'}
      :{id:asset,state:'ready'};
    return new Response(JSON.stringify({data}),{status:200});
  };
  try {
    for(const alias of ['--id','--asset']) {
      assert.equal((await main(['status',alias,asset])).state,'ready');
      const linked=await main(['bind',alias,asset,'--app','app-1']);
      assert.equal(linked.publicVerified,true);assert.equal(linked.status,'linked');
      assert.equal(linked.receipt,undefined);
    }
    assert.equal((await main(['evidence','--app','app-1'])).releaseId,'release-1');
    assert.equal(requests.length,7);
  } finally {
    globalThis.fetch=fetchBefore;
    for(const key of keys){if(previous[key]===undefined)delete process.env[key];else process.env[key]=previous[key];}
    rmSync(directory,{recursive:true,force:true});
  }
});
