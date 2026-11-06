import assert from 'node:assert/strict'
import {mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync} from 'node:fs'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {createRequire} from 'node:module'
import {spawnSync} from 'node:child_process'
import test from 'node:test'
import {hostZones, validateZones, intersects} from '../claude-code/paean-convert-to-rednote/scripts/host-geometry.mjs'

const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..')
const scripts=path.join(repo,'claude-code/paean-convert-to-rednote/scripts')
let playwright=process.env.REDNOTE_TEST_PLAYWRIGHT
if(!playwright)try{playwright=path.dirname(createRequire(import.meta.url).resolve('playwright/package.json'))}catch{}

test('host geometry uses actual safe-area and direction, not a fixed 92px strip',()=>{
  const viewport={width:390,height:844}
  let zones=hostZones(viewport)
  assert(!zones.some(z=>intersects({x:48,y:10,w:32,h:32},z)), 'toggle next to back is clear')
  assert(!zones.some(z=>intersects({x:8,y:54,w:44,h:44},z)), 'below host row is clear')
  assert(zones.some(z=>intersects({x:2,y:10,w:32,h:32},z)), 'back collision must fail')
  zones=hostZones({...viewport,safe:[41,0,0,0]})
  assert(!zones.some(z=>intersects({x:48,y:51,w:32,h:32},z)))
  assert(zones.some(z=>intersects({x:8,y:54,w:44,h:44},z)))
  zones=hostZones({width:844,height:390,safe:[0,0,0,44]})
  assert(!zones.some(z=>intersects({x:92,y:10,w:32,h:32},z)))
  assert(!zones.some(z=>intersects({x:400,y:10,w:44,h:44},z)), 'landscape top is not reserved across screen')
  assert(zones.some(z=>intersects({x:48,y:10,w:32,h:32},z)))
  assert.throws(()=>hostZones({...viewport,safe:[0,0,0,400]}))
  assert.throws(()=>validateZones([]))
  assert.throws(()=>validateZones([{x:0,y:0,w:0,h:10}]))
  assert.equal(validateZones([{x:100,y:100,w:20,h:20}])[0].name,'host-1')
})

// Install Playwright normally, or set REDNOTE_TEST_PLAYWRIGHT to its package directory.
test('browser probes distinguish host collisions, delegated input, unknown gameplay and timeout', {skip:!playwright, timeout:60000},t=>{
  const root=mkdtempSync(path.join(tmpdir(),'rednote-probes-'))
  t.after(()=>rmSync(root,{recursive:true,force:true}))
  mkdirSync(path.join(root,'node_modules'))
  symlinkSync(playwright,path.join(root,'node_modules/playwright'),'dir')
  const fixture=(name,html)=>{const dir=path.join(root,name);mkdirSync(dir);writeFileSync(path.join(dir,'index.html'),html);return dir}
  const run=(script,dir,...args)=>{
    const r=spawnSync(process.execPath,[path.join(scripts,script),dir,'--settle-ms','30','--json',...args],{encoding:'utf8',timeout:35000})
    assert.ifError(r.error)
    let report
    try{report=JSON.parse(r.stdout)}catch{throw Error(r.stdout+'\n'+r.stderr)}
    return {code:r.status,report}
  }
  const safe=fixture('safe',`<style>button{position:fixed;width:32px;height:32px;left:48px;top:calc(var(--safe-area-inset-top,0px) + 10px)}</style><button>方向</button>`)
  let result=run('check-host-chrome.mjs',safe,'--safe-area','41,0,0,0')
  assert.equal(result.code,0,JSON.stringify(result.report))
  const unsafe=fixture('unsafe','<button style="position:fixed;left:4px;top:12px;width:36px;height:32px">返回</button>')
  result=run('check-host-chrome.mjs',unsafe)
  assert.equal(result.code,1)
  assert(result.report.hits.some(h=>h.zone==='host-back'))
  const menu=fixture('center-entry',`<style>#stick{display:none;position:fixed;left:70px;top:600px;width:100px;height:100px;border-radius:50%;background:orange;animation:pulse .1s infinite alternate} @keyframes pulse{to{opacity:.5}}</style><div id="stick"></div><script>document.addEventListener('click',e=>{if(e.clientX>100&&e.clientX<800)document.querySelector('#stick').style.display='block'});document.querySelector('#stick').addEventListener('touchstart',()=>{});document.addEventListener('mousedown',()=>{});</script>`)
  result=run('check-pointer-parity.mjs',menu,'--control','#stick')
  assert.equal(result.code,2,JSON.stringify(result.report))
  assert.equal(result.report.ok,true,'direct touch listener must not override possible delegation')
  assert.equal(result.report.checks.response.gameplayVerified,false)
  assert(result.report.checks.response.box,'default activation must use center, not x=0')
  assert(result.report.inconclusive,'animated pixels must not prove gameplay')
  result=run('check-host-chrome.mjs',safe,'--timeout-ms','10')
  assert.equal(result.code,2)
  assert.equal(result.report.reason,'probe timeout')
  result=run('check-pointer-parity.mjs',menu,'--timeout-ms','10')
  assert.equal(result.code,2)
  assert.equal(result.report.reason,'probe timeout')
})
