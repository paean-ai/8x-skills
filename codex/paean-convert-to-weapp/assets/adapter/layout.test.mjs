import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {parseHTML} from 'linkedom';
import {Layout,initializeLayout} from './layout.js';
import {measureText} from './text.js';
import {invokeListeners} from './events.js';
import {normalizeSVGMarkup} from './svg.js';
await initializeLayout(await fs.readFile(new URL('./node_modules/taffy-layout/pkg/taffy_wasm_bg.wasm',import.meta.url)));
const env={width:360,height:640};const measure={measureText:s=>({width:s.length*8})};
const rule=(selector,values,order)=>({selector,media:[],declarations:Object.entries(values).map(([p,v])=>[p,v,false]),order});
test('SVG gradients created via HTML innerHTML retain canonical XML element names',()=>{
  const {document}=parseHTML('<html><body></body></html>');document.body.innerHTML='<svg><defs><linearGradient id="g"><stop offset="0" stop-color="#ffd84f"/></linearGradient></defs><path fill="url(#g)"/></svg>';
  const xml=normalizeSVGMarkup(document.querySelector('svg').outerHTML);assert.match(xml,/<linearGradient id="g">/);assert.match(xml,/<\/linearGradient>/);assert.match(xml,/stop-color="#ffd84f"/);assert.match(xml,/fill="url\(#g\)"/);
});
test('actual DOM on-property and listener integration dispatches once',()=>{
  const {document}=parseHTML('<html><body><button>Toggle</button></body></html>');const b=document.querySelector('button'),list=[];let calls=0;
  b.addEventListener=(type,fn,capture)=>list.push({fn,capture:!!capture});b.onclick=()=>calls++;
  assert.equal(list.length,1);invokeListeners(b,{type:'click'},false,list,()=>{},assert.fail);assert.equal(calls,1);
});
test('actual WASM layout centers native button text and does not inherit its transform twice',()=>{
  const {document}=parseHTML('<html><body><button id="toggle">On</button></body></html>');
  const layout=new Layout(env,[rule('#toggle',{width:'80px',height:'40px',transform:'translateY(10px)'},0)],(t,s,k,a)=>measureText(measure,t,s,k,a));
  layout.compute(document);const button=layout.entries.find(e=>e.el.id==='toggle'),text=layout.entries.find(e=>e.kind==='text');
  assert.equal(text.cs.transform,undefined);assert.ok(Math.abs((text.box.x+text.box.width/2)-(button.box.x+button.box.width/2))<.01);assert.ok(Math.abs((text.box.y+text.box.height/2)-(button.box.y+button.box.height/2))<.01);
});
test('hidden subtrees stay out of layout and reappear with their content after reopening',()=>{
  const {document}=parseHTML('<html><body><div id="modal" hidden><button>Close</button></div></body></html>');const layout=new Layout(env,[],(t,s,k,a)=>measureText(measure,t,s,k,a));layout.compute(document);assert.equal(layout.entries.some(e=>e.text==='Close'),false);document.querySelector('#modal').hidden=false;layout.compute(document);assert.equal(layout.entries.some(e=>e.text==='Close'),true);
});
test('percentage SVG contributes intrinsic width inside a centered flex column',()=>{
  const {document}=parseHTML('<html><body><div class="card"><div class="art"><svg viewBox="0 0 60 220"></svg></div><div class="caption">A long original caption must wrap inside the card instead of extending beyond it.</div></div></body></html>');
  const rules=[rule('.card',{width:'260px',height:'430px',display:'flex','flex-direction':'column','align-items':'center'},0),rule('.art',{flex:'1',display:'flex','min-height':'0'},1),rule('svg',{width:'100%',height:'100%'},2)];
  const layout=new Layout(env,rules,(t,s,k,a)=>measureText(measure,t,s,k,a));layout.compute(document);const box=s=>layout.boxes.get(document.querySelector(s));assert.ok(box('svg').width>0);assert.ok(box('svg').height>0);assert.ok(box('.caption').width<=260);assert.ok(box('.caption').height>20);
});
