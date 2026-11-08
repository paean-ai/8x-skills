import test from 'node:test';
import assert from 'node:assert/strict';
import {btoa,atob} from './base64.js';
import {textMetrics,measureText} from './text.js';
import {contains} from './hit.js';
import {length,resolveVariables} from './style.js';
import {invokeListeners} from './events.js';
import {gradientStops} from './gradient.js';
import {multiply,perspective,transformMatrix,quad,frontFacing,polygonContains} from './projection.js';
test('gradient parsing retains double-position hard stops and omitted positions',()=>{
  const env={width:360,height:640};assert.deepEqual(gradientStops(['#fff 0 10px','#000 10px 20px'],100,env).map(s=>s.at),[0,.1,.1,.2]);
  assert.deepEqual(gradientStops(['#fff','#ccc','#000'],100,env).map(s=>s.at),[0,.5,1]);
  assert.deepEqual(gradientStops([resolveVariables('var(--rc)0 6deg',{'--rc':'#ffc93c'},env)],1,env).map(s=>s.color),['#ffc93c','#ffc93c']);
});
test('CSS perspective preserves card face visibility and projective hit coordinates',()=>{
  const env={width:360,height:640},b={x:80,y:80,width:200,height:300};
  const camera=perspective('1100px',b,env),back=transformMatrix({transform:'rotateY(180deg)'},b,env);
  assert.equal(frontFacing(quad(camera,b)),true);assert.equal(frontFacing(quad(multiply(camera,back),b)),false);
  assert.equal(frontFacing(quad(multiply(multiply(camera,back),back),b)),true);
  const q=quad(multiply(camera,transformMatrix({transform:'rotateY(50deg)'},b,env)),b);assert.equal(polygonContains(q,180,230),true);assert.equal(polygonContains(q,60,230),false);assert.notEqual(q[0].y,q[1].y);
});
test('a DOM onclick registered by Linkedom runs once, while plain window handlers still run',()=>{
  let calls=0;const fn=()=>calls++,target={onclick:fn},event={type:'click'};
  invokeListeners(target,event,false,[{fn,capture:false}],()=>{},assert.fail);assert.equal(calls,1);
  invokeListeners(target,event,false,[],()=>{},assert.fail);assert.equal(calls,2);
  invokeListeners(target,event,true,[],()=>{},assert.fail);assert.equal(calls,2);
});
const ctx={measureText:s=>({width:s.length*8.18})};
const style={'font-size':'16px','font-family':'sans-serif','line-height':'1.3'};
test('Latin-1 base64 preserves the original exploration-save bytes',()=>{
  const bytes=Array.from({length:256},(_,i)=>String.fromCharCode(i)).join('');
  assert.equal(btoa(bytes),Buffer.from(bytes,'latin1').toString('base64'));assert.equal(atob(btoa(bytes)),bytes);
  for(const value of ['','f','fo','foo','foob','fooba','foobar'])assert.equal(atob(btoa(value)),value);
  assert.throws(()=>btoa('中文'));assert.throws(()=>atob('a'));
});
test('fractional intrinsic width does not unexpectedly wrap the final word',()=>{
  const text='Look around',m=measureText(ctx,text,style,{}, {width:'max-content'});
  assert.equal(textMetrics(ctx,text,style,m.width).lines.length,1);
  assert.equal(m.height,20.8);
});
test('height uses actual word breaks, uppercase and letter spacing',()=>{
  const s={...style,'text-transform':'uppercase','letter-spacing':'0.1em'};
  const m=measureText(ctx,'Step 1 of 8',s,{}, {width:70});
  const lines=textMetrics(ctx,'Step 1 of 8',s,m.width);
  assert.equal(m.height,lines.lines.length*20.8);assert.equal(lines.text,'STEP 1 OF 8');assert.equal(lines.letter,1.6);
  assert.ok(lines.lines.length>1);
});
test('hit testing respects DPR, transformed coordinates and rounded clips',()=>{
  const box={x:10,y:20,right:110,bottom:70,width:100,height:50};
  const region={box,matrix:{a:2,b:0,c:0,d:2,e:40,f:60},radius:10};
  assert.equal(contains(region,70,70,2),true);
  assert.equal(contains(region,30,50,2),false);
  assert.equal(contains(region,130,100,2),false);
});
test('CSS expressions resolve percentages in their containing block',()=>{
  const env={width:390,height:844};assert.equal(length('min(480px, 90%)',212,env),190.8);
  assert.equal(length('calc(100% - 24px)',390,env),366);
});

import {functions,Motion,easing} from './motion.js';
test('transform parser preserves nested CSS arithmetic',()=>{
  assert.deepEqual(functions('translate(-50%, calc(-50% + 3px)) rotate(-7deg)'),[['translate','-50%, calc(-50% + 3px)'],['rotate','-7deg']]);
});
test('CSS keyframes retain original timing, alternation and variable values',()=>{
  const env={width:390,height:844},motion=new Motion(env,{pulse:[{offset:0,values:{opacity:'.4'}},{offset:1,values:{opacity:'1'}}]}),el={};
  const e={el,cs:{animation:'pulse 1s linear infinite alternate',opacity:'1'}};
  assert.equal(motion.style(e,0).opacity,'.4');assert.equal(+motion.style(e,500).opacity,.7);assert.equal(+motion.style(e,1500).opacity,.7);
  assert.ok(easing('ease-out',.5)>.5);
});
test('opacity transitions retain their prior value then reach the new value',()=>{
  const motion=new Motion({},{}),el={},first={el,cs:{transition:'opacity .5s linear',opacity:'0'}};
  motion.style(first,0);const next={el,cs:{...first.cs,opacity:'1'}};
  assert.equal(motion.style(next,100).opacity,'0');assert.equal(motion.style(next,350).opacity,'0.5');assert.equal(motion.style(next,600).opacity,'1');
});
