import {length,split} from './style.js';
import {textMetrics} from './text.js';
import {contains} from './hit.js';
import {functions} from './motion.js';
import {makeGradient,paintConic} from './gradient.js';
import {identity,multiply,perspective,transformMatrix,quad,frontFacing,clipPolygon,drawPlane} from './projection.js';
function rounded(ctx,x,y,w,h,r){r=Math.min(Math.max(r||0,0),w/2,h/2);ctx.beginPath();ctx.moveTo(x+r,y);ctx.lineTo(x+w-r,y);ctx.quadraticCurveTo(x+w,y,x+w,y+r);ctx.lineTo(x+w,y+h-r);ctx.quadraticCurveTo(x+w,y+h,x+w-r,y+h);ctx.lineTo(x+r,y+h);ctx.quadraticCurveTo(x,y+h,x,y+h-r);ctx.lineTo(x,y+r);ctx.quadraticCurveTo(x,y,x+r,y);ctx.closePath();}
const colorToken=/(#[\da-f]{3,8}\b|rgba?\([^)]*\)|hsla?\([^)]*\)|transparent|[a-z]+)\s*$/i;
export class Painter {
  constructor(env,canvas,layout,resources){this.env=env;this.canvas=canvas;this.ctx=canvas.getContext('2d');this.layout=layout;this.resources=resources;this.cache=new Map();this.hitRegions=[];this.warnings=new Set();this.planes=new WeakMap();this.backgrounds=new Map();}
  cached(key,load){const record=this.cache.get(key);if(record)return record.value;const r={};this.cache.set(key,r);load().then(v=>r.value=v).catch(e=>{r.error=e;console.error('[adapter asset]',key.slice(0,80),e);});return null;}
  transform(ctx,s,b){
    const value=s.transform;if(!value||value==='none')return;
    const origin=split(s['transform-origin']||'50% 50%'),ox=length(origin[0],b.width,this.env)||0,oy=length(origin[1]||'50%',b.height,this.env)||0;ctx.translate(b.x+ox,b.y+oy);
    for(const[n,args]of functions(value)){const a=split(args,',').flatMap(v=>v.startsWith('calc(')?[v]:split(v));
      if(n==='translate')ctx.translate(length(a[0],b.width,this.env)||0,length(a[1]||'0',b.height,this.env)||0);
      else if(n==='translateX')ctx.translate(length(a[0],b.width,this.env)||0,0);
      else if(n==='translateY')ctx.translate(0,length(a[0],b.height,this.env)||0);
      else if(n==='scale')ctx.scale(+a[0],+(a[1]||a[0]));else if(n==='scaleX')ctx.scale(+a[0],1);else if(n==='scaleY')ctx.scale(1,+a[0]);
      else if(n==='rotate')ctx.rotate(parseFloat(a[0])*(a[0].endsWith('rad')?1:Math.PI/180));else if(n==='matrix')ctx.transform(...a.map(Number));
      else if(n==='skewX')ctx.transform(1,0,Math.tan(parseFloat(a[0])*Math.PI/180),1,0,0);else if(n==='skewY')ctx.transform(1,Math.tan(parseFloat(a[0])*Math.PI/180),0,1,0,0);
    }
    ctx.translate(-b.x-ox,-b.y-oy);
  }
  gradient(value,b){
    return makeGradient(this.ctx,value,b,this.env);
  }
  background(e){const {cs:s,box:b}=e,ctx=this.ctx;const radius=length(s['border-top-left-radius']||s['border-radius'],Math.min(b.width,b.height),this.env)||0;
    const bg=s.background||s['background-color']||'';

    const layers=bg==='none'?[]:split(bg,',');
    for(const layer of layers.reverse()){
      const url=layer.match(/url\(["']?([^"')]+)["']?\)/);
      if(url){const image=this.cached(url[1],async()=>{if(/\.svg$/.test(url[1]))return this.resources.rasterSVG(await(await this.resources.fetch(url[1])).text());const img=new this.env.Image();img.src=url[1];await img.decode();return img;});if(image){ctx.save();rounded(ctx,b.x,b.y,b.width,b.height,radius);ctx.clip();const native=this.resources.unwrap(image),cover=layer.includes('cover')||s['background-size']==='cover',ratio=cover?Math.max(b.width/native.width,b.height/native.height):1;ctx.drawImage(native,b.x+(b.width-native.width*ratio)/2,b.y+(b.height-native.height*ratio)/2,native.width*ratio,native.height*ratio);ctx.restore();}continue;}
      const gradient=layer.match(/(?:repeating-)?(?:linear|radial|conic)-gradient\(.*\)/);
      const color=gradient?this.gradient(gradient[0],b):layer.match(colorToken)?.[1];if(!color)continue;
      ctx.save();
      if(s['box-shadow']&&s['box-shadow']!=='none'){const shadow=split(s['box-shadow'],',').find(v=>!v.includes('inset'));if(shadow){const a=split(shadow),numbers=a.filter(v=>/^-?[\d.]/.test(v));ctx.shadowOffsetX=parseFloat(numbers[0])||0;ctx.shadowOffsetY=parseFloat(numbers[1])||0;ctx.shadowBlur=parseFloat(numbers[2])||0;ctx.shadowColor=shadow.match(colorToken)?.[1]||'rgba(0,0,0,.2)';}}
      if(color.conic||gradient&&(s.mask||s['-webkit-mask'])){
        const key=JSON.stringify([layer,b.width,b.height,s.mask||s['-webkit-mask']]);let image=this.backgrounds.get(key);
        if(!image){image=this.resources.createCanvas();image.width=Math.ceil(b.width);image.height=Math.ceil(b.height);const c=image.getContext('2d'),box={x:0,y:0,width:b.width,height:b.height},g=makeGradient(c,gradient[0],box,this.env);if(g.conic)paintConic(c,g,box);else{c.fillStyle=g;c.fillRect(0,0,b.width,b.height);}const mask=(s.mask||s['-webkit-mask']||'').match(/(?:radial|linear)-gradient\(.*\)/);if(mask){c.globalCompositeOperation='destination-in';c.fillStyle=makeGradient(c,mask[0],box,this.env);c.fillRect(0,0,b.width,b.height);}this.backgrounds.set(key,image);}
        rounded(ctx,b.x,b.y,b.width,b.height,radius);ctx.clip();ctx.drawImage(image,b.x,b.y,b.width,b.height);
      }else{ctx.fillStyle=color==='currentColor'?s.color:color;rounded(ctx,b.x,b.y,b.width,b.height,radius);ctx.fill();}ctx.restore();
    }
    const bw=length(s['border-top-width'],b.width,this.env)||0;if(bw){ctx.strokeStyle=s['border-top-color']==='currentColor'?s.color:s['border-top-color']||s.color;ctx.lineWidth=bw;rounded(ctx,b.x+bw/2,b.y+bw/2,b.width-bw,b.height-bw,Math.max(0,radius-bw/2));ctx.stroke();}
  }
  text(e){
    const c=this.ctx,s=e.cs,b=e.box,m=textMetrics(c,e.text,s,b.width);c.fillStyle=s.color;c.textBaseline='top';
    m.lines.forEach((text,i)=>{let x=s['text-align']==='center'?b.x+(b.width-m.measure(text))/2:s['text-align']==='right'?b.right-m.measure(text):b.x;const y=b.y+i*m.lineHeight+(m.lineHeight-m.size)/2;
      if(m.letter){for(const char of text){c.fillText(char,x,y);x+=c.measureText(char).width+m.letter;}}else c.fillText(text,x,y);
      if(s['text-decoration']?.includes('underline')){c.fillRect(b.x,y+m.size,m.measure(text),Math.max(1,m.size/16));}
    });
  }
  content(e){const ctx=this.ctx,b=e.box,s=e.cs;if(e.kind==='text'){this.text(e);return;}if(b.width<=0||b.height<=0)return;this.background(e);
    if(e.kind==='canvas'){const c=this.resources.unwrap(e.el);if(c!==e.el)ctx.drawImage(c,b.x,b.y,b.width,b.height);}
    else if(e.kind==='svg'){const xml=e.el.outerHTML.replace(/currentColor/g,s.color);const image=this.cached(`svg:${b.width}:${b.height}:${xml}`,()=>this.resources.rasterSVG(xml,b.width*this.env.dpr,b.height*this.env.dpr));if(image)ctx.drawImage(image,b.x,b.y,b.width,b.height);}
    else if(e.kind==='img'){if(!e.el._native&&e.el.src&&!e.el._requested){e.el._requested=true;e.el.src=e.el.src;}if(e.el._native)ctx.drawImage(e.el._native,b.x,b.y,b.width,b.height);}
  }
  projected(e,parent,clips=[]){
    if(!e.box||e.cs.display==='none'||e.cs.visibility==='hidden')return;const ctx=this.ctx,b=e.box,s=this.env.motion?.style(e,this.env.performance.now())||e.cs;e={...e,cs:s};const matrix=multiply(parent,transformMatrix(s,b,this.env)),q=quad(matrix,b);
    if((s['backface-visibility']||s['-webkit-backface-visibility'])==='hidden'&&!frontFacing(q))return;
    ctx.save();ctx.globalAlpha*=s.opacity===undefined?1:Number(s.opacity);
    if(b.width>0&&b.height>0){let plane=this.planes.get(e.el);if(!plane){plane=this.resources.createCanvas();this.planes.set(e.el,plane);}const pad=64,rect={x:b.x-pad,y:b.y-pad,width:b.width+pad*2,height:b.height+pad*2},d=this.env.dpr;const w=Math.ceil(rect.width*d),h=Math.ceil(rect.height*d);if(plane.width!==w)plane.width=w;if(plane.height!==h)plane.height=h;const pc=plane.getContext('2d');pc.setTransform(d,0,0,d,-rect.x*d,-rect.y*d);pc.clearRect(rect.x,rect.y,rect.width,rect.height);this.ctx=pc;try{this.content(e);}finally{this.ctx=ctx;}drawPlane(ctx,plane,rect,matrix);}
    const outer=ctx.getTransform(),screen=q.map(p=>({x:outer.a*p.x+outer.c*p.y+outer.e,y:outer.b*p.x+outer.d*p.y+outer.f}));const region={element:e.pseudo||e.el,quad:screen,clips};if(e.kind!=='text'&&s['pointer-events']!=='none')this.hitRegions.push(region);
    if(['x','y'].some(a=>['hidden','auto','scroll'].includes(s['overflow-'+a]))){clipPolygon(ctx,q);clips=[...clips,region];}
    const next=s.perspective?multiply(matrix,perspective(s.perspective,b,this.env)):matrix;
    for(const child of [...e.children].sort((a,b)=>(parseInt(a.cs['z-index'])||0)-(parseInt(b.cs['z-index'])||0)))this.projected(child,next,clips);ctx.restore();
  }
  paint(){
    const ctx=this.ctx,E=this.env;ctx.setTransform(E.dpr,0,0,E.dpr,0,0);ctx.clearRect(0,0,E.width,E.height);this.hitRegions=[];
    const draw=(e,clips=[])=>{
      if(!e.box||e.cs.display==='none'||e.cs.visibility==='hidden')return;
      if(e.cs.perspective||/rotate[XY]|matrix3d|translateZ|perspective\(/.test(e.cs.transform||'')){this.projected(e,identity(),clips);return;}
      const b=e.box,s=this.env.motion?.style(e,this.env.performance.now())||e.cs;e={...e,cs:s};ctx.save();this.transform(ctx,s,b);ctx.globalAlpha*=s.opacity===undefined?1:Number(s.opacity);
      const polygon=s['clip-path']?.match(/^polygon\((.*)\)$/);if(polygon){const q=split(polygon[1],',').map(p=>{const a=split(p);return{x:b.x+(length(a[0],b.width,E)||0),y:b.y+(length(a[1],b.height,E)||0)};});clipPolygon(ctx,q);const m=ctx.getTransform();clips=[...clips,{quad:q.map(p=>({x:m.a*p.x+m.c*p.y+m.e,y:m.b*p.x+m.d*p.y+m.f}))}];}
      if(s.filter&&s.filter!=='none'&&'filter'in ctx)ctx.filter=s.filter;
      if(e.kind==='text')this.text(e);else{
        this.background(e);
        if(e.kind==='canvas'){const c=this.resources.unwrap(e.el);if(c!==e.el)ctx.drawImage(c,b.x,b.y,b.width,b.height);}
        else if(e.kind==='svg'){const xml=e.el.outerHTML.replace(/currentColor/g,s.color);const image=this.cached(`svg:${b.width}:${b.height}:${xml}`,()=>this.resources.rasterSVG(xml,b.width*E.dpr,b.height*E.dpr));if(image)ctx.drawImage(image,b.x,b.y,b.width,b.height);}
        else if(e.kind==='img'){if(!e.el._native&&e.el.src&&!e.el._requested){e.el._requested=true;e.el.src=e.el.src;}if(e.el._native)ctx.drawImage(e.el._native,b.x,b.y,b.width,b.height);}
        const region={element:e.pseudo||e.el,box:b,matrix:ctx.getTransform?.(),radius:length(s['border-radius'],Math.min(b.width,b.height),E)||0};
        if(s['pointer-events']!=='none')this.hitRegions.push({...region,clips});
        if(['x','y'].some(axis=>['hidden','auto','scroll'].includes(s['overflow-'+axis]))){rounded(ctx,b.x,b.y,b.width,b.height,length(s['border-radius'],b.width,E)||0);ctx.clip();clips=[...clips,region];}
        const children=[...e.children];children.sort((a,b)=>(parseInt(a.cs['z-index'])||0)-(parseInt(b.cs['z-index'])||0));for(const child of children)draw(child,clips);
      }
      ctx.restore();
    };draw(this.layout.root);
  }
  hit(x,y){for(let i=this.hitRegions.length-1;i>=0;i--){const r=this.hitRegions[i];if(contains(r,x,y,this.env.dpr)&&r.clips.every(c=>contains(c,x,y,this.env.dpr)))return r.element;}return null;}
}
