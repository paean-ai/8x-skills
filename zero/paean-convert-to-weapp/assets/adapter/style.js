// CSS cascade and dimensional expressions shared by every converted source.
// Layout and painting are separate: unsupported paint features are reported.
export function split(value, delimiter=' ') {
  const out=[];let depth=0,quote='',part='';
  for(const c of String(value||'')){
    if(quote){part+=c;if(c===quote)quote='';continue;}
    if(c==='"'||c==="'"){quote=c;part+=c;continue;}
    if(c==='(')depth++;if(c===')')depth--;
    if(!depth && (delimiter===' '?/\s/.test(c):c===delimiter)){if(part.trim())out.push(part.trim());part='';}else part+=c;
  }
  if(part.trim())out.push(part.trim());return out;
}
const inherited=['color','font-family','font-size','font-style','font-weight','line-height','letter-spacing','text-align','text-transform','visibility','pointer-events','white-space'];
const defaults={display:'block',position:'static','font-family':'sans-serif','font-size':'16px','font-weight':'400','line-height':'normal',color:'#000','box-sizing':'content-box','pointer-events':'auto','white-space':'normal'};
const inlineTags=new Set(['SPAN','B','I','EM','STRONG','SMALL','LABEL','A','BR']);
export function mediaMatches(media,env){
  return split(media,',').some(branch=>{
    if(/\bprint\b/.test(branch))return false;
    const clauses=[...branch.matchAll(/\(([^()]+)\)/g)];
    return clauses.every(([,clause])=>{let[k,v]=clause.split(':').map(x=>x.trim());
      if(k==='orientation')return v===(env.width>env.height?'landscape':'portrait');
      if(k==='prefers-reduced-motion')return v==='no-preference';
      if(k==='hover'||k==='any-hover')return v==='none';
      if(k==='pointer'||k==='any-pointer')return v==='coarse';
      const m=k.match(/^(min-|max-)?(width|height|aspect-ratio)$/);if(!m)return false;
      let n=v.includes('/')?v.split('/').reduce((a,b)=>Number(a)/Number(b)):parseFloat(v);
      const actual=m[2]==='aspect-ratio'?env.width/env.height:env[m[2]];
      return m[1]==='min-'?actual>=n:m[1]==='max-'?actual<=n:actual===n;
    });
  });
}
function specificity(s){return (s.match(/#[\w-]+/g)||[]).length*10000+(s.match(/\.[\w-]+|\[[^\]]+\]|:(?!:)[\w-]+/g)||[]).length*100+(s.replace(/#[\w-]+|\.[\w-]+|\[[^\]]+\]|:{1,2}[\w-]+(?:\([^)]*\))?/g,'').match(/[a-z][\w-]*/gi)||[]).length;}
export function resolveVariables(v,s,env,depth=0){
  if(depth>20)return '';
  let value=String(v||'');
  value=value.replace(/env\(([^,()]+)(?:,([^()]+))?\)/g,(_,n,f)=>`${env.insets?.[n.trim()]??parseFloat(f)??0}px`);
  while(value.includes('var(')){
    let a=value.indexOf('var('),p=a+4,d=1;for(;p<value.length&&d;p++){if(value[p]==='(')d++;if(value[p]===')')d--;}
    if(d)return value;
    const [name,...fallback]=split(value.slice(a+4,p-1),',');
    // CSS substitutes token sequences, not concatenated characters. css-tree
    // may serialize `var(--color) 0` as `var(--color)0`; retain the boundary.
    value=value.slice(0,a)+' '+resolveVariables(s[name]??fallback.join(',')??'',s,env,depth+1)+' '+value.slice(p);
  }
  return value.trim();
}
// A restricted arithmetic parser (no eval/Function; compatible with mini games).
export function length(value,base,env,font=16){
  if(value===undefined||value==='auto'||value==='none'||value==='normal')return undefined;
  let src=String(value).trim().replace(/(-?(?:\d*\.)?\d+)(d?vh|d?vw|vmin|vmax|rem|em|px|%)/g,(_,n,u)=>String(+n*(u==='%'?base/100:u.endsWith('vh')?env.height/100:u.endsWith('vw')?env.width/100:u==='vmin'?Math.min(env.width,env.height)/100:u==='vmax'?Math.max(env.width,env.height)/100:u==='rem'?16:u==='em'?font:1)));
  const tokens=src.match(/(?:\d*\.)?\d+(?:e[-+]?\d+)?|[a-z-]+|[()+*/,\-]/gi)||[];let i=0;
  function atom(){let t=tokens[i++];if(t==='-')return-atom();if(t==='+')return atom();if(t==='('){let n=expr();i++;return n;}if(/^[a-z]/i.test(t||'')){i++;let args=[expr()];while(tokens[i]===','){i++;args.push(expr());}i++;if(t==='min')return Math.min(...args);if(t==='max')return Math.max(...args);if(t==='clamp')return Math.max(args[0],Math.min(args[2],args[1]));if(t==='calc')return args[0];return NaN;}return Number(t);}
  function mul(){let n=atom();while(tokens[i]==='*'||tokens[i]==='/'){let op=tokens[i++],b=atom();n=op==='*'?n*b:n/b;}return n;}
  function expr(){let n=mul();while(tokens[i]==='+'||tokens[i]==='-'){let op=tokens[i++],b=mul();n=op==='+'?n+b:n-b;}return n;}
  const n=expr();return Number.isFinite(n)?n:undefined;
}
function expand(s,p,v){
  s[p]=v;const a=split(v);
  if(['padding','margin','inset','border-width','border-radius'].includes(p)){
    const vals=[a[0],a[1]||a[0],a[2]||a[0],a[3]||a[1]||a[0]];
    ['top','right','bottom','left'].forEach((side,i)=>s[p==='inset'?side:p==='border-width'?`border-${side}-width`:p==='border-radius'?`border-${['top-left','top-right','bottom-right','bottom-left'][i]}-radius`:`${p}-${side}`]=vals[i]);
  }else if(p==='border'||/^border-(top|right|bottom|left)$/.test(p)){
    const width=a.find(t=>/^\d/.test(t))||'0',color=a.find(t=>!/^\d/.test(t)&&!['solid','dashed','dotted','none'].includes(t))||'currentColor';
    for(const side of p==='border'?['top','right','bottom','left']:[p.slice(7)]){s[`border-${side}-width`]=v==='none'?'0':width;s[`border-${side}-color`]=color;}
  }else if(p==='gap'){s['row-gap']=a[0];s['column-gap']=a[1]||a[0];}
  else if(p==='place-items'){s['align-items']=a[0];s['justify-items']=a[1]||a[0];}
  else if(p==='flex'){if(v==='none'){s['flex-grow']='0';s['flex-shrink']='0';s['flex-basis']='auto';}else{s['flex-grow']=a[0];s['flex-shrink']=a[1]||'1';s['flex-basis']=a[2]||'0%';}}
  else if(p==='overflow'){s['overflow-x']=a[0];s['overflow-y']=a[1]||a[0];}
}
export class Cascade {
  constructor(rules,env){this.rules=rules.map(r=>({...r,specificity:specificity(r.selector)}));this.env=env;this.cache=new WeakMap();this.index=new Map();for(const r of this.rules){const h=r.hints||{};const key=h.id?'#'+h.id:h.classes?.length?'.'+h.classes[0]:h.tag?h.tag.toUpperCase():'*';if(!this.index.has(key))this.index.set(key,[]);this.index.get(key).push(r);}}
  reset(){this.cache=new WeakMap();}
  style(el,pseudo=''){
    if(!pseudo&&this.cache.has(el))return this.cache.get(el);
    const parent=pseudo?this.style(el):el.parentElement?this.style(el.parentElement):defaults;
    const s={...defaults};for(const k of Object.keys(parent))if(k.startsWith('--')||inherited.includes(k))s[k]=parent[k];
    if(inlineTags.has(el.tagName))s.display='inline';
    if(el.tagName==='BUTTON')Object.assign(s,{'text-align':'center','padding':'2px 6px',display:'inline-block'});
    if(el.tagName==='SVG'||el.tagName==='IMG')s.display='inline-block';
    const declarations=[];
    const keys=['*',el.tagName,'#'+el.id,...[...el.classList].map(c=>'.'+c)];
    for(const r of keys.flatMap(key=>this.index.get(key)||[])){if(!r.media.every(m=>mediaMatches(m,this.env)))continue;
      const m=r.selector.match(/::?(before|after)$/),isPseudo=m?.[1]||'';if(isPseudo!==pseudo)continue;
      let selector=m?r.selector.slice(0,m.index):r.selector;
      selector=selector.replace(/:root/g,'html').replace(/:active/g,'[data-adapter-active]').replace(/:focus-visible/g,'[data-adapter-focus]');
      try{if(!el.matches(selector))continue;}catch{continue;}
      for(const [p,v,important]of r.declarations)declarations.push({p,v,rank:(important?1e9:0)+r.specificity*1000+r.order});
    }
    if(!pseudo)for(let i=0;i<el.style?.length;i++){const p=el.style[i];declarations.push({p,v:el.style.getPropertyValue(p),rank:1e8+i});}
    declarations.sort((a,b)=>a.rank-b.rank);
    for(const {p,v}of declarations)if(p.startsWith('--'))s[p]=v;
    for(const {p,v}of declarations)if(!p.startsWith('--')){const value=resolveVariables(v,s,this.env);expand(s,p,value==='inherit'?parent[p]:value);}
    if(el.hasAttribute('hidden'))s.display='none';
    const fs=length(s['font-size'],parseFloat(parent['font-size'])||16,this.env,parseFloat(parent['font-size'])||16);s['font-size']=`${fs||16}px`;
    if(!pseudo)this.cache.set(el,s);return s;
  }
}
