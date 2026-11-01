import test from 'node:test';
import assert from 'node:assert/strict';
import {client,credentials,operation,REGIONS,parse} from '../claude-code/paean-cloud-computer/scripts/cloud-computer.mjs';
const ws='ws-'+ 'a'.repeat(32), cr='cr-'+ 'b'.repeat(32);
test('personal lifecycle is regional, validated, and deletion must be authorized',()=>{
 assert.equal(operation('personal','list',{region:'hongkong'}).origin,REGIONS.hongkong);
 assert.equal(operation('personal','pause',{id:ws,region:'singapore'}).path,`/v1/workspaces/${ws}/pause`);
 assert.throws(()=>operation('personal','delete',{id:ws}),/confirm/);
 assert.equal(operation('personal','delete',{id:ws,confirm:true}).method,'DELETE');
 assert.throws(()=>operation('personal','get',{id:'../admin'}),/Invalid/);
 assert.throws(()=>operation('personal','create',{backup:'../file'}),/Invalid/);
 assert.throws(()=>operation('personal','list',{region:'https://attacker.test'}),/Region/);
 assert.throws(()=>parse(['tasks','submit','--request-key']),/incomplete/);
});
test('cloud task idempotency and region cannot drift silently',()=>{
 const input={prompt:'Make a project',requestKey:'stable-task',timeout:60};
 assert.deepEqual(operation('tasks','submit',input),operation('tasks','submit',input));
 assert.equal(operation('tasks','submit',input).body.request_key,'stable-task');
 assert.throws(()=>operation('tasks','submit',{prompt:'Make a project'}),/request-key/);
 assert.throws(()=>operation('tasks','submit',{...input,region:'hongkong'}),/Beijing/);
 assert.throws(()=>operation('tasks','get',{id:ws}),/Invalid/);
 assert.equal(operation('tasks','cancel',{id:cr}).method,'POST');
});
test('credentials never fall back from an explicit empty identity',()=>{
 assert.throws(()=>credentials({PAEAN_AUTH_TOKEN:''},'/does-not-exist'),/refusing/);
 assert.equal(credentials({PAEAN_AUTH_TOKEN:'private-user-token'},'/does-not-exist'),'private-user-token');
});
test('client sends auth only to fixed endpoints, blocks redirects, and never replays uncertain mutation',async()=>{
 const calls=[];const api=client({token:'private-user-token',fetchImpl:async(url,options)=>{calls.push({url,options});throw new Error('network interrupted');}});
 await assert.rejects(()=>api.call({origin:'https://attacker.test',path:'/v1/workspaces',method:'GET'}),/unsupported/);
 assert.equal(calls.length,0);
 await assert.rejects(()=>api.call(operation('tasks','submit',{prompt:'Create',requestKey:'once'})),/interrupted/);
 assert.equal(calls.length,1);assert.equal(calls[0].options.redirect,'error');
 assert.equal(calls[0].options.headers.Authorization,'Bearer private-user-token');
});
test('private results are returned intact and upstream errors do not disclose secrets',async()=>{
 const result={download_url:'https://private.example.test/file?signature=private',sha256:'a'.repeat(64)};
 const api=client({token:'secret',fetchImpl:async()=>new Response(JSON.stringify(result),{status:200})});
 assert.deepEqual(await api.call(operation('tasks','artifacts',{id:cr})),result);
 const failed=client({token:'secret',fetchImpl:async()=>new Response('upstream debug secret',{status:503})});
 await assert.rejects(()=>failed.call(operation('tasks','list')),e=>!e.message.includes('secret')&&e.message.includes('503'));
});
test('near-expiry JWT refresh stays in memory, and uses the same operation',async()=>{
 const old='header.'+Buffer.from(JSON.stringify({exp:Math.floor(Date.now()/1000)+60})).toString('base64url')+'.signature';
 const calls=[];const api=client({token:old,fetchImpl:async(url,options)=>{calls.push({url,options});return new Response(JSON.stringify(url.endsWith('/auth/refresh')?{token:'refreshed-token'}:{workspaces:[]}),{status:200});}});
 assert.deepEqual(await api.call(operation('personal','list')),{workspaces:[]});
 assert.equal(calls.length,2);assert.equal(calls[0].url,REGIONS.beijing+'/auth/refresh');assert.equal(calls[1].options.headers.Authorization,'Bearer refreshed-token');
});
