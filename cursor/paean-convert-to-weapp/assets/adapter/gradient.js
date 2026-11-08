import {split,length} from './style.js';
export function gradientStops(values,scale,env){
  const out=[];
  for(const value of values){const parts=split(value),color=parts.shift();const positions=parts.length?parts:[null];for(const p of positions)out.push({color,at:p==null?null:p.endsWith('deg')?parseFloat(p)/360:p.endsWith('turn')?parseFloat(p):p.endsWith('%')?parseFloat(p)/100:(length(p,scale,env)||0)/scale});}
  if(!out.length)return out;out[0].at??=0;out.at(-1).at??=1;
  let previous=0;for(let i=1;i<out.length;i++){if(out[i].at==null)continue;out[i].at=Math.max(out[previous].at,out[i].at);for(let j=previous+1;j<i;j++)out[j].at=out[previous].at+(out[i].at-out[previous].at)*(j-previous)/(i-previous);previous=i;}
  return out;
}
export function makeGradient(ctx,value,b,env){
  const type=value.includes('conic-gradient')?'conic':value.includes('radial-gradient')?'radial':'linear',repeat=value.startsWith('repeating-'),args=split(value.slice(value.indexOf('(')+1,-1),',');let spec='';
  if(/^(to\b|from\b|at\b|circle\b|ellipse\b|closest-|farthest-|[-.\d]+(?:deg|turn|rad))/.test(args[0]))spec=args.shift();
  let x=b.x+b.width/2,y=b.y+b.height/2;const at=spec.match(/\bat\s+(.+)$/);if(at){const p=split(at[1]);x=b.x+(length(p[0],b.width,env)??b.width/2);y=b.y+(length(p[1]||'50%',b.height,env)??b.height/2);}
  const angle=spec.includes('right')?Math.PI/2:spec.includes('left')?-Math.PI/2:spec.includes('top')?0:/deg/.test(spec)?parseFloat(spec.replace(/^from\s+/,''))*Math.PI/180:Math.PI;
  const dx=Math.sin(angle),dy=-Math.cos(angle),span=Math.abs(b.width*dx)+Math.abs(b.height*dy),radius=Math.max(Math.hypot(x-b.x,y-b.y),Math.hypot(b.x+b.width-x,b.y+b.height-y));
  const stops=gradientStops(args,type==='linear'?span:type==='radial'?radius:1,env);
  let gradient;
  if(type==='radial')gradient=ctx.createRadialGradient(x,y,0,x,y,radius);
  else if(type==='conic'){
    if(!ctx.createConicGradient)return {conic:true,x,y,angle:/from/.test(spec)?parseFloat(spec.replace(/^from\s+/,''))*Math.PI/180:0,stops,repeat};
    gradient=ctx.createConicGradient((/from/.test(spec)?parseFloat(spec.replace(/^from\s+/,''))*Math.PI/180:0)-Math.PI/2,x,y);
  }else gradient=ctx.createLinearGradient(x-dx*span/2,y-dy*span/2,x+dx*span/2,y+dy*span/2);
  const first=stops[0]?.at||0,period=(stops.at(-1)?.at||1)-first;
  const add=shift=>{for(const stop of stops){const p=stop.at+shift;if(p>=0&&p<=1)gradient.addColorStop(p,stop.color);}};
  if(repeat&&period>0)for(let n=Math.floor(-first/period);n*period+first<=1;n++)add(n*period);else add(0);
  return gradient;
}
export function paintConic(ctx,g,b){
  const radius=Math.hypot(b.width,b.height),start=g.stops[0]?.at||0,period=g.stops.at(-1).at-start||1;
  // Tessellate angular wedges; hard stops remain exact (ray effects).
  for(let a=0;a<1;a+=1/1440){const p=g.repeat?((a-start)%period+period)%period+start:a;let color=g.stops[0].color;for(const stop of g.stops){if(stop.at>p)break;color=stop.color;}if(color==='transparent')continue;ctx.fillStyle=color;ctx.beginPath();ctx.moveTo(g.x,g.y);ctx.arc(g.x,g.y,radius,g.angle-Math.PI/2+a*2*Math.PI,g.angle-Math.PI/2+(a+1/1440+.00002)*2*Math.PI);ctx.closePath();ctx.fill();}
}
