import {polygonContains} from './projection.js';
export function contains(region,x,y,dpr=1){
  if(region.quad)return polygonContains(region.quad,x*dpr,y*dpr);
  const b=region.box,m=region.matrix;
  if(m){const a=m.a/dpr,c=m.c/dpr,bb=m.b/dpr,d=m.d/dpr,tx=m.e/dpr,ty=m.f/dpr,det=a*d-bb*c;
    if(!det)return false;const px=(d*(x-tx)-c*(y-ty))/det;y=(-bb*(x-tx)+a*(y-ty))/det;x=px;
  }
  if(x<b.x||y<b.y||x>b.right||y>b.bottom)return false;
  const r=Math.min(region.radius||0,b.width/2,b.height/2);
  const cx=Math.max(b.x+r,Math.min(b.right-r,x)),cy=Math.max(b.y+r,Math.min(b.bottom-r,y));
  return !r||(x-cx)**2+(y-cy)**2<=r*r;
}
