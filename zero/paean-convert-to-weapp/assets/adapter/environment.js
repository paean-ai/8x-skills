import 'fast-text-encoding';
import 'core-js/web/url';
import 'core-js/web/url-search-params';
import {AbortController} from 'abort-controller/dist/abort-controller.mjs';
import {parseHTML,DOMParser,HTMLElement,HTMLCanvasElement,HTMLImageElement,EventTarget} from 'linkedom';
import {Canvg} from 'canvg';
import {initializeLayout,Layout} from './layout.js';
import {Painter} from './paint.js';
import {Motion} from './motion.js';
import {measureText} from './text.js';
import {mediaMatches} from './style.js';
import {btoa,atob,decodeBase64} from './base64.js';
import {invokeListeners} from './events.js';
import {normalizeSVGMarkup} from './svg.js';
const env={stats:{layoutMs:0,paintMs:0,gameMs:0}};export default env;
let wxapi,display,layout,painter,dirty=true,active=false,frameId=0,rafId=0,frameGeneration=0;
const frames=new Map(),listeners=new WeakMap(),captures=new Map(),contacts=new Map(),nativeCanvases=new WeakMap(),contexts=new WeakMap(),svgCache=new Map();
const errors=[];
const scrollPositions=new WeakMap(),scrollXPositions=new WeakMap();
function report(kind,error){const entry={kind,message:String(error?.stack||error),time:Date.now()};errors.push(entry);console.error('[weapp adapter]',kind,error);}
function add(type,fn,options={}){if(!fn)return;let list=listeners.get(this);if(!list)listeners.set(this,list=new Map());if(!list.has(type))list.set(type,[]);const capture=typeof options==='boolean'?options:!!options.capture;if(!list.get(type).some(l=>l.fn===fn&&l.capture===capture))list.get(type).push({fn,capture,once:!!options.once});}
function remove(type,fn,options={}){const capture=typeof options==='boolean'?options:!!options.capture;const list=listeners.get(this)?.get(type);if(list)listeners.get(this).set(type,list.filter(l=>l.fn!==fn||l.capture!==capture));}
function event(type,values={}){return {type,bubbles:true,cancelable:true,defaultPrevented:false,cancelBubble:false,timeStamp:env.performance.now(),...values,preventDefault(){if(this.cancelable)this.defaultPrevented=true;},stopPropagation(){this.cancelBubble=true;},stopImmediatePropagation(){this.cancelBubble=true;this.immediate=true;}};}
function dispatch(e){
  const path=[this];let p=this.parentNode;while(p){path.push(p);p=p.parentNode;}if(path.includes(env.document)&&this!==env.window)path.push(env.window);
  e.target=this;e.composedPath=()=>path.slice();
  const invoke=(el,capture,phase)=>{e.currentTarget=el;e.eventPhase=phase;e.immediate=false;invokeListeners(el,e,capture,listeners.get(el)?.get(e.type)||[],l=>remove.call(el,e.type,l.fn,{capture}),err=>report('event:'+e.type,err));};
  for(let i=path.length-1;i>0&&!e.cancelBubble;i--)invoke(path[i],true,1);
  if(!e.cancelBubble){invoke(this,true,2);if(!e.immediate)invoke(this,false,2);}
  if(e.bubbles)for(let i=1;i<path.length&&!e.cancelBubble;i++)invoke(path[i],false,3);
  e.currentTarget=null;e.eventPhase=0;dirty=true;return !e.defaultPrevented;
}
const eventMethods={addEventListener:add,removeEventListener:remove,dispatchEvent:dispatch};
function storage(namespace){return {get length(){return this.keys().length;},keys(){return wxapi.getStorageInfoSync().keys.filter(k=>k.startsWith(namespace)).map(k=>k.slice(namespace.length));},key(i){return this.keys()[i]??null;},getItem(k){const key=namespace+k;const value=wxapi.getStorageSync(key);return value===''&&!wxapi.getStorageInfoSync().keys.includes(key)?null:String(value);},setItem(k,v){wxapi.setStorageSync(namespace+k,String(v));},removeItem(k){wxapi.removeStorageSync(namespace+k);},clear(){for(const k of this.keys())this.removeItem(k);}};}
function memoryStorage(){const m=new Map();return{getItem:k=>m.has(String(k))?m.get(String(k)):null,setItem:(k,v)=>m.set(String(k),String(v)),removeItem:k=>m.delete(String(k)),clear:()=>m.clear(),key:i=>[...m.keys()][i]??null,get length(){return m.size;}};}
function canvasNative(el){let c=nativeCanvases.get(el);if(!c){c=wxapi.createCanvas();c.width=Number(el.getAttribute('width'))||300;c.height=Number(el.getAttribute('height'))||150;nativeCanvases.set(el,c);}return c;}
function unwrap(source){return nativeCanvases.get(source)||source?._native||source;}
function context(el,type,options){const c=canvasNative(el);let map=contexts.get(el);if(!map)contexts.set(el,map=new Map());if(map.has(type))return map.get(type);const raw=c.getContext(type,options);if(!raw)return null;
  const proxy=new Proxy(raw,{get(target,p){if(p==='canvas')return el;const v=target[p];if(typeof v!=='function')return v;
    if(['drawImage','createPattern','texImage2D','texSubImage2D','texImage3D'].includes(p))return(...args)=>v.apply(target,args.map(unwrap));
    return v.bind(target);},set:(t,p,v)=>(t[p]=v,true)});map.set(type,proxy);return proxy;
}
async function read(path,encoding){return wxapi.getFileSystemManager().readFileSync(path,encoding);}
async function fetchResource(input,options={}){
  let url=String(input?.url||input);if(env.location&&url.startsWith(env.location.origin+'/'))url=url.slice(env.location.origin.length+1);let data,status=200,headers={};
  if(!/^https?:/.test(url)&&!url.startsWith('data:'))data=await read(url.replace(/^\.\//,''));
  else if(url.startsWith('data:')){const comma=url.indexOf(',');data=/;base64$/.test(url.slice(0,comma))?decodeBase64(url.slice(comma+1)):new TextEncoder().encode(decodeURIComponent(url.slice(comma+1))).buffer;}
  else{const r=await new Promise((resolve,reject)=>{const task=wxapi.request({url,method:options.method||'GET',header:options.headers||{},data:options.body,responseType:'arraybuffer',success:resolve,fail:reject});options.signal?.addEventListener('abort',()=>{task.abort();reject(new Error('AbortError'));},{once:true});});data=r.data;status=r.statusCode;headers=r.header;}
  const bytes=typeof data==='string'?new TextEncoder().encode(data):new Uint8Array(data);
  return {ok:status>=200&&status<300,status,headers:{get:k=>headers[k]||headers[k.toLowerCase()]||null},arrayBuffer:async()=>bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),text:async()=>new TextDecoder().decode(bytes),json:async()=>JSON.parse(new TextDecoder().decode(bytes)),clone(){return this;}};
}
async function rasterSVG(text,width,height){
  text=normalizeSVGMarkup(text);
  const key=`${width||0}:${height||0}:${text}`;if(svgCache.has(key))return svgCache.get(key);
  const pending=(async()=>{const svg=new DOMParser().parseFromString(text,'image/svg+xml').documentElement,c=wxapi.createCanvas();const vb=(svg.getAttribute('viewBox')||'0 0 128 128').split(/[ ,]+/).map(Number);c.width=Math.ceil(width||parseFloat(svg.getAttribute('width'))||vb[2]||128);c.height=Math.ceil(height||parseFloat(svg.getAttribute('height'))||vb[3]||128);
    // Explicit viewport dimensions let SVG's viewBox perform the single scale.
    // Canvg scaleWidth adds another transform for dimensionless inline SVGs.
    svg.setAttribute('width',String(c.width));svg.setAttribute('height',String(c.height));
    const instance=Canvg.fromString(c.getContext('2d'),svg.outerHTML,{DOMParser,fetch:fetchResource,ignoreAnimation:true,ignoreMouse:true,createCanvas:(w,h)=>{const x=wxapi.createCanvas();x.width=w;x.height=h;return x;},createImage:src=>new Promise((resolve,reject)=>{const i=wxapi.createImage();i.onload=()=>resolve(i);i.onerror=reject;i.src=src;})});await instance.render();return c;})();
  svgCache.set(key,pending);return pending;
}
function installImages(){
  Object.defineProperties(HTMLImageElement.prototype,{src:{configurable:true,get(){return this.getAttribute('src')||'';},set(value){this.setAttribute('src',String(value));const src=String(value);let promise;if(src.startsWith('data:image/svg+xml'))promise=fetchResource(src).then(r=>r.text()).then(s=>rasterSVG(s));else if(/\.svg(?:[?#].*)?$/.test(src))promise=fetchResource(src).then(r=>r.text()).then(s=>rasterSVG(s));else promise=new Promise((resolve,reject)=>{const i=wxapi.createImage();i.onload=()=>resolve(i);i.onerror=reject;i.src=src;});promise.then(i=>{this._native=i;this.complete=true;this.naturalWidth=i.width;this.naturalHeight=i.height;if(!this.width)this.width=i.width;if(!this.height)this.height=i.height;this.dispatchEvent(event('load',{bubbles:false}));dirty=true;}).catch(err=>{report('image '+src.slice(0,80),err);this.dispatchEvent(event('error',{bubbles:false,error:err}));});}},decode:{configurable:true,value(){if(this.complete)return Promise.resolve();return new Promise((resolve,reject)=>{this.addEventListener('load',resolve,{once:true});this.addEventListener('error',reject,{once:true});});}}});
  env.Image=function Image(w,h){const image=env.document.createElement('img');if(w)image.width=w;if(h)image.height=h;return image;};
}
function ensureLayout(){if(dirty){const before=Date.now();layout.compute(env.document);env.stats.layoutMs=Date.now()-before;dirty=false;}}
export async function initialize(wx,config){
  wxapi=wx;env.sourceId=config.id;env.audioContexts=[];display=wx.createCanvas();if(typeof GameGlobal!=='undefined')GameGlobal.canvas=display;const info=(wx.getWindowInfo||wx.getSystemInfoSync).call(wx);const dpr=Math.min(info.pixelRatio||1,2);
  env.width=info.windowWidth;env.height=info.windowHeight;env.dpr=dpr;env.insets={'safe-area-inset-top':info.safeArea?.top||0,'safe-area-inset-bottom':Math.max(0,info.windowHeight-(info.safeArea?.bottom||info.windowHeight))};display.width=Math.round(env.width*dpr);display.height=Math.round(env.height*dpr);
  const dom=parseHTML(config.html);env.document=dom.document;
  env.window={...eventMethods,innerWidth:env.width,innerHeight:env.height,devicePixelRatio:dpr,ontouchstart:null,PointerEvent:function PointerEvent(type,init){return event(type,init);}};env.window.window=env.window;env.window.self=env.window;env.window.parent=env.window;env.window.top=env.window;
  env.screen={width:env.width,height:env.height,availWidth:env.width,availHeight:env.height};env.navigator={clipboard:{writeText:text=>new Promise((resolve,reject)=>wx.setClipboardData({data:String(text),success:()=>resolve(),fail:reject}))},language:'en',languages:['en'],maxTouchPoints:10,userAgent:'WeChat MiniGame',platform:info.platform||'wechat'};
  const url=new globalThis.URL(config.origin+'/');env.location=url;
  env.performance=typeof wx.getPerformance==='function'?wx.getPerformance():{now:()=>Date.now()};
  env.AbortController=AbortController;env.URL=globalThis.URL;env.URLSearchParams=globalThis.URLSearchParams;env.fetch=fetchResource;
  env.btoa=btoa;env.atob=atob;
  env.localStorage=storage(`paean.port.${config.id}.`);env.sessionStorage=memoryStorage();
  env.AudioContext=function AudioContext(){const a=wx.createWebAudioContext();env.audioContexts.push(a);const missing=['createConvolver','createDynamicsCompressor','createOscillator','createBiquadFilter'].filter(n=>typeof a[n]!=='function');if(missing.length)report('audio-capability',new Error('Missing native audio methods: '+missing.join(',')));return a;};
  env.HTMLCanvasElement=HTMLCanvasElement;env.HTMLImageElement=HTMLImageElement;
  Object.assign(EventTarget.prototype,eventMethods);Object.assign(env.document,eventMethods);
  Object.defineProperties(HTMLCanvasElement.prototype,{width:{configurable:true,get(){return canvasNative(this).width;},set(n){this.setAttribute('width',String(n));canvasNative(this).width=n;}},height:{configurable:true,get(){return canvasNative(this).height;},set(n){this.setAttribute('height',String(n));canvasNative(this).height=n;}},getContext:{value:function(t,o){return context(this,t,o);}},toDataURL:{value:function(...a){return canvasNative(this).toDataURL(...a);}}});
  Object.assign(HTMLElement.prototype,{getBoundingClientRect(){ensureLayout();return layout.boxes.get(this)||{x:0,y:0,left:0,top:0,right:0,bottom:0,width:0,height:0};},setPointerCapture(id){captures.set(id,this);},releasePointerCapture(id){if(captures.get(id)===this)captures.delete(id);},hasPointerCapture(id){return captures.get(id)===this;},focus(){const old=env.document.activeElement;if(old&&old!==this)old.dispatchEvent(event('blur',{bubbles:false}));env.document.activeElement=this;this.dispatchEvent(event('focus',{bubbles:false}));},blur(){if(env.document.activeElement===this)env.document.activeElement=env.document.body;},click(){this.dispatchEvent(event('click'));},scrollTo(a,b){this.scrollLeft=typeof a==='object'?a.left||0:a||0;this.scrollTop=typeof a==='object'?a.top||0:b||0;dirty=true;},scrollIntoView(){let p=this.parentElement;while(p&&p!==env.document.body){if(p.scrollHeight>p.clientHeight){p.scrollTop=this.getBoundingClientRect().top-p.getBoundingClientRect().top;dirty=true;break;}p=p.parentElement;}}});
  for(const [k,dim]of [['offsetWidth','width'],['offsetHeight','height'],['clientWidth','width'],['clientHeight','height']])Object.defineProperty(HTMLElement.prototype,k,{configurable:true,get(){return this.getBoundingClientRect()[dim];}});
  Object.defineProperties(HTMLElement.prototype,{
    scrollWidth:{configurable:true,get(){ensureLayout();const entry=layout.entries.find(e=>e.el===this);if(!entry)return 0;return Math.max(entry.box.right,...entry.children.map(c=>c.box.right+this.scrollLeft))-entry.box.left;}},
    scrollLeft:{configurable:true,get(){return scrollXPositions.get(this)||0;},set(v){const next=Math.max(0,Number(v)||0);if(next!==(scrollXPositions.get(this)||0)){scrollXPositions.set(this,next);dirty=true;}}},
    scrollHeight:{configurable:true,get(){ensureLayout();const entry=layout.entries.find(e=>e.el===this);if(!entry)return 0;const bottom=Math.max(entry.box.bottom,...entry.children.map(c=>c.box.bottom+this.scrollTop));return bottom-entry.box.top;}},
    scrollTop:{configurable:true,get(){return scrollPositions.get(this)||0;},set(v){const next=Math.max(0,Number(v)||0);if(next!==(scrollPositions.get(this)||0)){scrollPositions.set(this,next);dirty=true;}}}
  });
  installImages();
  env.requestAnimationFrame=fn=>{const id=++rafId;frames.set(id,fn);return id;};env.cancelAnimationFrame=id=>frames.delete(id);
  env.window.matchMedia=query=>({media:query,get matches(){return mediaMatches(query,env);},...eventMethods,addListener(fn){env.window.addEventListener('resize',fn);},removeListener(fn){env.window.removeEventListener('resize',fn);}});
  env.getComputedStyle=el=>{const s=layout.cascade.style(el);return new Proxy(s,{get:(s,p)=>p==='getPropertyValue'?(k=>s[k]||''):s[String(p).replace(/[A-Z]/g,c=>'-'+c.toLowerCase())]||''});};
  Object.assign(env.window,env,{setTimeout,clearTimeout,setInterval,clearInterval});
  const measureCanvas=wx.createCanvas(),measure=measureCanvas.getContext('2d');
  await initializeLayout('taffy.wasm');
  env.motion=new Motion(env,config.keyframes||{});
  layout=new Layout(env,config.rules,(text,s,known,available)=>measureText(measure,text,s,known,available));
  painter=new Painter(env,display,layout,{unwrap,rasterSVG,fetch:fetchResource,createCanvas:()=>wx.createCanvas()});
  const observer=new dom.MutationObserver(()=>{dirty=true;layout.cascade.reset();});observer.observe(env.document,{subtree:true,childList:true,attributes:true,characterData:true});
  function touch(type,native){ensureLayout();for(const t of native.changedTouches||[]){const id=t.identifier,x=t.clientX??t.x,y=t.clientY??t.y;const target=captures.get(id)||painter.hit(x,y)||env.document.body;const e=event(type,{pointerId:id,pointerType:'touch',isPrimary:contacts.size===0||contacts.keys().next().value===id,clientX:x,clientY:y,pageX:x,pageY:y,button:0,buttons:type==='pointerup'||type==='pointercancel'?0:1});
    if(type==='pointerdown'){const scrolls=[];let scroll=target;while(scroll&&scroll!==env.document.body){const style=layout.cascade.style(scroll);for(const axis of ['x','y']){const vertical=axis==='y';if(['auto','scroll'].includes(style['overflow-'+axis])&&scroll[vertical?'scrollHeight':'scrollWidth']>scroll[vertical?'clientHeight':'clientWidth']+1)scrolls.push({element:scroll,axis,start:scroll[vertical?'scrollTop':'scrollLeft']});}scroll=scroll.parentElement;}contacts.set(id,{target,x,y,scrolls,scrolling:false});target.setAttribute?.('data-adapter-active','');}
    const gesture=contacts.get(id);
    if(type==='pointermove'&&gesture){const dx=x-gesture.x,dy=y-gesture.y,axis=Math.abs(dx)>Math.abs(dy)?'x':'y',scroll=gesture.selectedScroll||gesture.scrolls.find(s=>s.axis===axis);if(scroll&&(gesture.scrolling||Math.hypot(dx,dy)>6)){
      if(!gesture.scrolling){gesture.scrolling=true;gesture.selectedScroll=scroll;gesture.target.dispatchEvent(event('pointercancel',{pointerId:id,clientX:x,clientY:y,pointerType:'touch'}));}
      const vertical=scroll.axis==='y',prop=vertical?'scrollTop':'scrollLeft',delta=vertical?dy:dx,max=scroll.element[vertical?'scrollHeight':'scrollWidth']-scroll.element[vertical?'clientHeight':'clientWidth'];scroll.element[prop]=Math.min(max,Math.max(0,scroll.start-delta));scroll.element.dispatchEvent(event('scroll',{bubbles:false}));continue;
    }}
    env.lastTouch={type,id,x,y,target:target.id||target.tagName};target.dispatchEvent(e);
    if(type==='pointerup'||type==='pointercancel'){const start=contacts.get(id);start?.target.removeAttribute?.('data-adapter-active');contacts.delete(id);captures.delete(id);if(type==='pointerup'&&start&&!start.scrolling&&Math.hypot(x-start.x,y-start.y)<12&&start.target===target&&!target.disabled)target.dispatchEvent(event('click',{clientX:x,clientY:y,pointerId:id,detail:1}));}
  }}
  wx.onTouchStart(e=>touch('pointerdown',e));wx.onTouchMove(e=>touch('pointermove',e));wx.onTouchEnd(e=>touch('pointerup',e));wx.onTouchCancel(e=>e.changedTouches?.length?touch('pointercancel',e):cancelTouches());
  for(const [api,type]of [['onMouseDown','pointerdown'],['onMouseMove','pointermove'],['onMouseUp','pointerup']])wx[api]?.(e=>touch(type,{changedTouches:[{...e,identifier:-1,clientX:e.clientX??e.x,clientY:e.clientY??e.y}]}));
  const pressedKeys=new Set();
  for(const [api,type] of [['onKeyDown','keydown'],['onKeyUp','keyup']])wx[api]?.(e=>{const repeat=type==='keydown'&&pressedKeys.has(e.code);if(type==='keydown')pressedKeys.add(e.code);else pressedKeys.delete(e.code);(env.document.activeElement||env.document.body).dispatchEvent(event(type,{...e,repeat}));});
  wx.onWheel?.(e=>{const target=painter.hit(e.x,e.y)||env.document.body;target.dispatchEvent(event('wheel',{...e,clientX:e.x,clientY:e.y,deltaMode:0}));});
  function cancelTouches(){pressedKeys.clear();for(const[id,t]of contacts){t.target.removeAttribute?.('data-adapter-active');(captures.get(id)||t.target).dispatchEvent(event('pointercancel',{pointerId:id,clientX:t.x,clientY:t.y,pointerType:'touch'}));}contacts.clear();captures.clear();}
  wx.onHide(()=>{cancelTouches();active=false;frameGeneration++;env.document.hidden=true;env.document.visibilityState='hidden';env.document.dispatchEvent(event('visibilitychange',{bubbles:false}));env.window.dispatchEvent(event('blur',{bubbles:false}));env.window.dispatchEvent(event('pagehide'));});
  wx.onShow(()=>{env.document.hidden=false;env.document.visibilityState='visible';env.document.dispatchEvent(event('visibilitychange',{bubbles:false}));if(!active)start();});
  wx.onWindowResize?.(r=>{cancelTouches();env.width=r.windowWidth||r.size?.windowWidth;env.height=r.windowHeight||r.size?.windowHeight;env.window.innerWidth=env.width;env.window.innerHeight=env.height;display.width=env.width*dpr;display.height=env.height*dpr;dirty=true;env.window.dispatchEvent(event('resize'));});
  env.document.hidden=false;env.document.visibilityState='visible';env.document.readyState='complete';env.document.activeElement=env.document.body;
  env.inspect=()=>({errors,viewport:{width:env.width,height:env.height},frames:frameId,dom:env.document.body.innerHTML,boxes:layout.entries.filter(e=>e.el.id).map(e=>({id:e.el.id,...e.box,display:e.cs.display})),game:env.window.__game?{ready:typeof env.window.__game.ready==='function'?env.window.__game.ready():env.window.__game.ready,state:env.window.__game.G?.state}:null});
  env.dispatchPointer=(type,points)=>touch(type,{changedTouches:points});env.hitTest=(x,y)=>painter.hit(x,y)?.id;env.inspectText=selector=>layout.entries.filter(e=>e.kind==='text'&&e.parent.el.matches(selector)).map(e=>({text:e.text,box:e.box,font:e.cs['font-size']}));
  if(typeof GameGlobal!=='undefined')GameGlobal.__port=env;
  ensureLayout();setTimeout(()=>console.log('[port state]',JSON.stringify({...env.inspect(),dom:undefined})),2000);return env;
}
export function start(){if(active)return;active=true;const generation=++frameGeneration,nativeRAF=display.requestAnimationFrame?.bind(display)||globalThis.requestAnimationFrame;const tick=()=>{if(!active||generation!==frameGeneration)return;frameId++;const callbacks=[...frames];frames.clear();const now=env.performance.now();const gameBefore=Date.now();for(const[,fn]of callbacks){try{fn(now);}catch(e){report('animation-frame',e);}}env.stats.gameMs=Date.now()-gameBefore;try{ensureLayout();const paintBefore=Date.now();painter.paint();env.stats.paintMs=Date.now()-paintBefore;}catch(e){report('compositor',e);active=false;throw e;}nativeRAF(tick);};nativeRAF(tick);}
