import {functions} from './motion.js';
import {split,length} from './style.js';
export const identity=()=>[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];
export function multiply(a,b){const out=Array(16).fill(0);for(let r=0;r<4;r++)for(let c=0;c<4;c++)for(let k=0;k<4;k++)out[r*4+c]+=a[r*4+k]*b[k*4+c];return out;}
const translation=(x,y,z=0)=>[1,0,0,x,0,1,0,y,0,0,1,z,0,0,0,1];
export function project(m,x,y,z=0){const w=m[12]*x+m[13]*y+m[14]*z+m[15];return{x:(m[0]*x+m[1]*y+m[2]*z+m[3])/w,y:(m[4]*x+m[5]*y+m[6]*z+m[7])/w};}
export function perspective(value,b,env){const d=length(value,b.width,env),cx=b.x+b.width/2,cy=b.y+b.height/2;if(!d)return identity();const m=identity();m[14]=-1/d;return multiply(multiply(translation(cx,cy),m),translation(-cx,-cy));}
export function transformMatrix(s,b,env){
  let m=identity();const origin=split(s['transform-origin']||'50% 50%'),ox=b.x+(length(origin[0],b.width,env)||0),oy=b.y+(length(origin[1]||'50%',b.height,env)||0);
  for(const[name,args]of functions(s.transform)){const a=split(args,',').flatMap(v=>v.startsWith('calc(')?[v]:split(v));let t=identity();const angle=parseFloat(a[0])*(a[0]?.endsWith('rad')?1:a[0]?.endsWith('turn')?Math.PI*2:Math.PI/180),c=Math.cos(angle),n=Math.sin(angle);
    if(name==='rotateY'){t[0]=c;t[2]=n;t[8]=-n;t[10]=c;}
    else if(name==='rotateX'){t[5]=c;t[6]=-n;t[9]=n;t[10]=c;}
    else if(name==='rotate'||name==='rotateZ'){t[0]=c;t[1]=-n;t[4]=n;t[5]=c;}
    else if(name.startsWith('translate')){const x=name==='translateY'||name==='translateZ'?0:length(a[0],b.width,env)||0,y=name==='translateY'?length(a[0],b.height,env)||0:name==='translateX'||name==='translateZ'?0:length(a[1]||'0',b.height,env)||0,z=name==='translateZ'?length(a[0],b.width,env)||0:name==='translate3d'?length(a[2],b.width,env)||0:0;t=translation(x,y,z);}
    else if(name.startsWith('scale')){t[0]=name==='scaleY'||name==='scaleZ'?1:+a[0];t[5]=name==='scaleX'||name==='scaleZ'?1:name==='scaleY'?+a[0]:+(a[1]??a[0]);t[10]=name==='scaleZ'?+a[0]:name==='scale3d'?+a[2]:1;}
    else if(name==='matrix'){const v=a.map(Number);t=[v[0],v[2],0,v[4],v[1],v[3],0,v[5],0,0,1,0,0,0,0,1];}
    else if(name==='matrix3d'){const v=a.map(Number);t=v.map((_,i)=>v[(i%4)*4+Math.floor(i/4)]);}
    else if(name==='skewX')t[1]=Math.tan(angle);else if(name==='skewY')t[4]=Math.tan(angle);
    else if(name==='perspective')t[14]=-1/(length(a[0],b.width,env)||1);
    m=multiply(m,t);
  }
  return multiply(multiply(translation(ox,oy),m),translation(-ox,-oy));
}
export function quad(m,b){return [[b.x,b.y],[b.x+b.width,b.y],[b.x+b.width,b.y+b.height],[b.x,b.y+b.height]].map(([x,y])=>project(m,x,y));}
export function frontFacing(q){return(q[1].x-q[0].x)*(q[2].y-q[0].y)-(q[1].y-q[0].y)*(q[2].x-q[0].x)>0;}
export function polygonContains(q,x,y){let sign=0;for(let i=0;i<q.length;i++){const a=q[i],b=q[(i+1)%q.length],n=(b.x-a.x)*(y-a.y)-(b.y-a.y)*(x-a.x);if(Math.abs(n)<1e-7)continue;if(sign&&Math.sign(n)!==sign)return false;sign=Math.sign(n);}return!!sign;}
export function clipPolygon(ctx,q){ctx.beginPath();ctx.moveTo(q[0].x,q[0].y);for(const p of q.slice(1))ctx.lineTo(p.x,p.y);ctx.closePath();ctx.clip();}
// Rasterize each CSS plane using a projective mesh. The original HTML/CSS
// supplies the planes, transforms, face visibility and animation values.
export function drawPlane(ctx,image,b,m){
  const grid=Math.abs(m[12])+Math.abs(m[13])>1e-8?12:1;
  function triangle(s,d){const [p,q,r]=s,[u,v,w]=d,det=(q.x-p.x)*(r.y-p.y)-(r.x-p.x)*(q.y-p.y);if(Math.abs(det)<1e-8)return;
    const a=((v.x-u.x)*(r.y-p.y)-(w.x-u.x)*(q.y-p.y))/det,c=((w.x-u.x)*(q.x-p.x)-(v.x-u.x)*(r.x-p.x))/det;
    const bb=((v.y-u.y)*(r.y-p.y)-(w.y-u.y)*(q.y-p.y))/det,dd=((w.y-u.y)*(q.x-p.x)-(v.y-u.y)*(r.x-p.x))/det;
    ctx.save();clipPolygon(ctx,d);ctx.transform(a,bb,c,dd,u.x-a*p.x-c*p.y,u.y-bb*p.x-dd*p.y);ctx.drawImage(image,b.x,b.y,b.width,b.height);ctx.restore();
  }
  for(let row=0;row<grid;row++)for(let col=0;col<grid;col++){const x=b.x+b.width*col/grid,y=b.y+b.height*row/grid,w=b.width/grid,h=b.height/grid,points=[{x,y},{x:x+w,y},{x:x+w,y:y+h},{x,y:y+h}],dest=points.map(p=>project(m,p.x,p.y));triangle([points[0],points[1],points[2]],[dest[0],dest[1],dest[2]]);triangle([points[0],points[2],points[3]],[dest[0],dest[2],dest[3]]);}
}
