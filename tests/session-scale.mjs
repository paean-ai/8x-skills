import {mkdtempSync,writeFileSync,openSync,closeSync,rmSync,readFileSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {main} from '../codex/paean-sessions/scripts/sessions.mjs';
const dir=mkdtempSync('/tmp/paean-scale-session-');
// Manual scale regression; never uploads this generated fixture.
const gib=Number(process.argv[2]??3);
if(!Number.isInteger(gib)||gib<1||gib>30)throw Error('Choose 1–30 GiB');
const started=Date.now();
try {
 mkdirSync(dir+'/project');const fd=openSync(dir+'/native.jsonl','wx'),hash=createHash('sha256');let bytes=0;
 const append=line=>{writeFileSync(fd,line);hash.update(line);bytes+=Buffer.byteLength(line);};
 append(JSON.stringify({id:'across-parts',input:'hello',name:'Bash',type:'tool_call'})+'\n');
 const line=JSON.stringify({data:'A'.repeat(64*1024),type:'opaque'})+'\n';
 for(let i=0;i<gib*16384;i++)append(line);
 append(JSON.stringify({content:'complete',tool_use_id:'across-parts',type:'tool_result'})+'\n');closeSync(fd);
 const expected=hash.digest('hex');console.log(JSON.stringify({stage:'generated-local-test-fixture',bytes}));
 writeFileSync(dir+'/input.json',JSON.stringify({streams:[{id:'main',file:'native.jsonl'}],scripts:[]}));
 const built=await main(['bundle','--manifest',dir+'/input.json','--project',dir+'/project','--out',dir+'/bundle']);console.log(JSON.stringify({stage:'built',...built}));
 const verified=await main(['verify-bundle','--dir',dir+'/bundle']);
 const restored=await main(['restore-stream','--dir',dir+'/bundle','--stream','main','--out',dir+'/restored.jsonl']);
 if(restored.digest!==expected||restored.bytes!==bytes||verified.toolCallCount!==1||verified.toolResultCount!==1||verified.issueCount!==0)throw Error('Scale round-trip mismatch');
 const result={bytes,files:built.files,events:verified.eventCount,fullStreamDigest:restored.digest,exactRoundTrip:true,heapLimitMiB:512,maxRSSKiB:process.resourceUsage().maxRSS,elapsedSeconds:(Date.now()-started)/1000,uploaded:false};
 console.log(JSON.stringify(result));
}finally{rmSync(dir,{recursive:true,force:true});}
