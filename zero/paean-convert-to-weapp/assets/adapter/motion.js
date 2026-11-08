import {split,length,resolveVariables} from './style.js';
export function functions(value){
  const out=[];let i=0;value=String(value||'');
  while(i<value.length){const match=/([\w-]+)\(/g;match.lastIndex=i;const m=match.exec(value);if(!m)break;let start=match.lastIndex,p=start,depth=1;for(;p<value.length&&depth;p++){if(value[p]==='(')depth++;if(value[p]===')')depth--;}if(depth)break;out.push([m[1],value.slice(start,p-1)]);i=p;}
  return out;
}
const time=value=>parseFloat(value)*(value.endsWith('ms')?1:1000);
const timingNames=new Set(['linear','ease','ease-in','ease-out','ease-in-out','step-start','step-end']);
export function easing(name,t){
  if(name==='linear')return t;if(name==='step-start')return 1;if(name==='step-end')return t===1?1:0;
  const defaults={'ease':[.25,.1,.25,1],'ease-in':[.42,0,1,1],'ease-out':[0,0,.58,1],'ease-in-out':[.42,0,.58,1]};
  const points=defaults[name]||name?.match(/^cubic-bezier\((.*)\)$/)?.[1].split(',').map(Number)||defaults.ease;
  const [x1,y1,x2,y2]=points,curve=(t,a,b)=>3*(1-t)**2*t*a+3*(1-t)*t*t*b+t*t*t;
  let lo=0,hi=1,u=t;for(let i=0;i<18;i++){u=(lo+hi)/2;if(curve(u,x1,x2)<t)lo=u;else hi=u;}
  return curve(u,y1,y2);
}
function interpolate(a,b,t){
  if(a===b)return a;
  const nums=/-?(?:\d*\.)?\d+(?:e[-+]?\d+)?/gi,aa=String(a).match(nums),bb=String(b).match(nums);
  if(aa&&bb&&aa.length===bb.length&&String(a).replace(nums,'@')===String(b).replace(nums,'@')){let i=0;return String(b).replace(nums,()=>String(+aa[i]+(+bb[i]-aa[i++])*t));}
  return t<.5?a:b;
}
const identityTransform=value=>String(value).replace(/(scale[XY]?)\(([^)]+)\)/g,(_,n,args)=>n+'('+split(args,',').map(()=>1).join(',')+')').replace(/(translate[XY]?|rotate[XYZ]?|skew[XY]?)\(([^)]+)\)/g,(_,n,args)=>n+'('+args.replace(/-?(?:\d*\.)?\d+/g,'0')+')');
export function interpolateProperty(prop,a,b,t){
  if(prop==='transform'){
    if(!a||a==='none')a=identityTransform(b);if(!b||b==='none')b=identityTransform(a);
  }
  if(prop==='opacity'){a=a??'1';b=b??'1';}
  return interpolate(a??b,b??a,t);
}
export class Motion{
  constructor(env,keyframes){this.env=env;this.keyframes=keyframes;this.states=new WeakMap();}
  style(entry,now){
    const base=entry.cs;let state=this.states.get(entry.el);if(!state)this.states.set(entry.el,state={animations:new Map(),transitions:new Map(),previous:null});
    const result={...base};const transition=base.transition;
    if(transition&&transition!=='none'&&state.previous){for(const spec of split(transition,',')){
      const tokens=split(spec),times=tokens.filter(v=>/^-?[\d.]+m?s$/.test(v)),prop=tokens.find(v=>!times.includes(v)&&!timingNames.has(v)&&!v.startsWith('cubic-bezier'))||'all',duration=times[0]?time(times[0]):0,delay=times[1]?time(times[1]):0,timing=tokens.find(v=>timingNames.has(v)||v.startsWith('cubic-bezier'))||'ease';
      const props=prop==='all'?['opacity','transform','width','height','color','background-color']: [prop];
      for(const p of props)if(base[p]!==state.previous[p]&&duration>0)state.transitions.set(p,{from:state.last?.[p]??state.previous[p],to:base[p],start:now+delay,duration,timing});
    }}
    for(const [p,t]of state.transitions){const progress=Math.max(0,Math.min(1,(now-t.start)/t.duration));result[p]=interpolateProperty(p,t.from,t.to,easing(t.timing,progress));if(progress===1)state.transitions.delete(p);}
    state.previous=base;
    const live=new Set();
    for(const spec of split(base.animation||'',',')){
      const tokens=split(spec),name=tokens.find(v=>this.keyframes[v]);if(!name)continue;live.add(name);
      const times=tokens.filter(v=>/^-?[\d.]+m?s$/.test(v)),duration=times[0]?time(times[0]):0,delay=times[1]?time(times[1]):0;if(!duration)continue;
      const iterations=tokens.includes('infinite')?Infinity:Number(tokens.find(v=>/^\d+(\.\d+)?$/.test(v))||1),direction=tokens.find(v=>['normal','reverse','alternate','alternate-reverse'].includes(v))||'normal',fill=tokens.find(v=>['both','forwards','backwards'].includes(v))||'none',timing=tokens.find(v=>timingNames.has(v)||v.startsWith('cubic-bezier'))||'ease';
      let a=state.animations.get(name);if(!a||a.spec!==spec){a={start:now,spec};state.animations.set(name,a);}
      const elapsed=now-a.start-delay;if(elapsed<0&&!['backwards','both'].includes(fill))continue;
      if(elapsed>=duration*iterations&&!['forwards','both'].includes(fill))continue;
      let cycle=Math.max(0,Math.min(iterations-1,Math.floor(elapsed/duration))),progress=elapsed>=duration*iterations?1:Math.max(0,(elapsed-cycle*duration)/duration);
      if(direction==='reverse'||direction==='alternate'&&cycle%2===1||direction==='alternate-reverse'&&cycle%2===0)progress=1-progress;
      const frames=this.keyframes[name],properties=new Set(frames.flatMap(f=>Object.keys(f.values)));
      for(const p of properties){const stops=frames.filter(f=>f.values[p]!==undefined).map(f=>({offset:f.offset,value:resolveVariables(f.values[p],base,this.env)}));if(stops[0].offset>0)stops.unshift({offset:0,value:base[p]});if(stops.at(-1).offset<1)stops.push({offset:1,value:base[p]});
        const next=stops.findIndex(s=>s.offset>=progress),hi=stops[Math.max(0,next)],lo=stops[Math.max(0,next-1)],t=hi.offset===lo.offset?1:(progress-lo.offset)/(hi.offset-lo.offset);result[p]=interpolateProperty(p,lo.value,hi.value,easing(timing,t));
      }
    }
    for(const name of state.animations.keys())if(!live.has(name))state.animations.delete(name);state.last=result;return result;
  }
}
