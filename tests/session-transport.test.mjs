import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createServer,request} from 'node:http';
import {putDirectR2} from '../codex/paean-sessions/scripts/sessions.mjs';

test('direct upload binds exact length, drains responses, does not redirect and obeys its deadline',async()=>{
  const bytes=Buffer.from('native 😀 data\n'.repeat(10000));let received=0;
  const server=createServer((req,res)=>{
    assert.equal(req.method,'PUT');assert.equal(Number(req.headers['content-length']),bytes.length);
    const parts=[];req.on('data',part=>parts.push(part));req.on('end',()=>{
      assert(Buffer.concat(parts).equals(bytes));received++;
      if(req.url==='/slow')return;
      if(req.url==='/redirect'){res.writeHead(307,{Location:'/unexpected'});res.end();return;}
      res.end('ok');
    });
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${server.address().port}`;
  try {
    const opts={headers:{'Content-Type':'application/x-ndjson'},body:bytes,signal:AbortSignal.timeout(2000)};
    assert.deepEqual(await putDirectR2(base+'/ok',opts,request),{status:200,ok:true});
    assert.deepEqual(await putDirectR2(base+'/redirect',opts,request),{status:307,ok:false});assert.equal(received,2);
    await assert.rejects(putDirectR2(base+'/slow',{...opts,signal:AbortSignal.timeout(30)},request),{name:'AbortError'});
  }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
