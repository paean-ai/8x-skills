import * as T from 'taffy-layout/wasm';
import init from 'taffy-layout/wasm';
import {Cascade,length,split} from './style.js';
export async function initializeLayout(path){await init({module_or_path:path});}
const pascal=s=>s.replace(/(^|-)(\w)/g,(_,a,b)=>b.toUpperCase());
export class Layout {
  constructor(env,rules,measure){this.env=env;this.cascade=new Cascade(rules,env);this.measure=measure;this.boxes=new WeakMap();this.entries=[];this.pseudos=new WeakMap();}
  compute(document,pass=0){
    const previous=this.boxes;this.cascade.reset();this.tree?.free();this.tree=new T.TaffyTree();this.tree.disableRounding();this.entries=[];this.boxes=new WeakMap();
    const E=this.env,tree=this.tree,styles=[],byId=new Map(),fixed=[];
    const dim=(v,s,axis='width')=>/^-?[\d.]+%$/.test(v)?v:length(v,s._basis?.[axis]??E[axis],E,parseFloat(s['font-size']));
    const build=(el,parent=null,forcedStyle=null)=>{
      if(el.nodeType===3){const text=el.textContent.replace(/\s+/g,' ');if(!text.trim())return null;const cs=Object.fromEntries(['color','font-size','font-family','font-weight','font-style','line-height','letter-spacing','text-align','text-transform','white-space','visibility','pointer-events','text-decoration','text-shadow'].map(k=>[k,parent.cs[k]])),st=new T.Style();styles.push(st);st.display=T.Display.Block;st.flexShrink=1;const e={el,cs,text,parent,children:[],kind:'text'};e.node=tree.newLeafWithContext(st,e);byId.set(e.node,e);this.entries.push(e);return e;}
      if(el.nodeType!==1||['HEAD','SCRIPT','STYLE','LINK','META','TITLE'].includes(el.tagName))return null;
      const cs=forcedStyle||this.cascade.style(el),st=new T.Style();styles.push(st);const basis=previous.get(parent?.el);cs._basis=basis?{width:basis.contentWidth,height:basis.contentHeight}:{width:E.width,height:E.height};
      st.display=cs.display==='none'?T.Display.None:cs.display.includes('flex')?T.Display.Flex:cs.display.includes('grid')?T.Display.Grid:T.Display.Block;
      st.boxSizing=cs['box-sizing']==='border-box'?T.BoxSizing.BorderBox:T.BoxSizing.ContentBox;
      if(cs['aspect-ratio']&&cs['aspect-ratio']!=='auto'){const ratio=cs['aspect-ratio'].split('/').map(Number);st.aspectRatio=ratio[0]/(ratio[1]||1);}
      st.position=['absolute','fixed'].includes(cs.position)?T.Position.Absolute:cs.position==='relative'?T.Position.Relative:T.Position.Static;
      for(const p of ['width','height','min-width','min-height','max-width','max-height','flex-basis']){const v=dim(cs[p],cs,p.includes('height')?'height':'width');if(v!==undefined)st[p.replace(/-([a-z])/g,(_,c)=>c.toUpperCase())]=v;}
      // A centered auto-width column item still uses the available inline
      // space when its max-content width is wider than that space.
      if(!cs.width&&!cs['max-width']&&parent?.cs['flex-direction']==='column'&&!['absolute','fixed'].includes(cs.position))st.maxWidth='100%';
      for(const p of ['top','right','bottom','left']){const v=dim(cs[p],cs,p==='top'||p==='bottom'?'height':'width');if(v!==undefined)st[p]=v;
        for(const kind of ['margin','padding']){const v=dim(cs[`${kind}-${p}`],cs);if(v!==undefined)st[kind+pascal(p)]=v;else if(cs[`${kind}-${p}`]==='auto')st[kind+pascal(p)]='auto';}
        st['border'+pascal(p)]=length(cs[`border-${p}-width`],E.width,E)||0;
      }
      for(const [css,js,enumName]of [['flex-direction','flexDirection','FlexDirection'],['flex-wrap','flexWrap','FlexWrap'],['align-items','alignItems','AlignItems'],['align-self','alignSelf','AlignSelf'],['align-content','alignContent','AlignContent'],['justify-content','justifyContent','JustifyContent'],['justify-items','justifyItems','AlignItems'],['justify-self','justifySelf','AlignSelf']]){
        const v=cs[css],key=v==='nowrap'?'NoWrap':pascal(v||'');if(T[enumName][key]!==undefined)st[js]=T[enumName][key];
      }
      for(const [p,k]of [['flex-grow','flexGrow'],['flex-shrink','flexShrink']])if(cs[p]!==undefined)st[k]=Number(cs[p]);
      st.rowGap=dim(cs['row-gap'],cs)||0;st.columnGap=dim(cs['column-gap'],cs)||0;
      const tracks=v=>split(v).flatMap(x=>{
        if(x.startsWith('repeat(')){const [n,...rest]=split(x.slice(7,-1),',');return[{count:/^\d+$/.test(n)?Number(n):n,tracks:tracks(rest.join(','))}];}
        if(x.startsWith('minmax(')){const [a,b]=split(x.slice(7,-1),',');return[{min:/content|auto|%/.test(a)?a:dim(a,cs)||0,max:/fr|content|auto|%/.test(b)?b:dim(b,cs)||0}];}
        const value=/fr|content|auto|%/.test(x)?x:dim(x,cs)||0;return[{min:x.endsWith('fr')?'auto':value,max:value}];
      });
      for(const a of ['rows','columns'])if(cs[`grid-template-${a}`]&&cs[`grid-template-${a}`]!=='none')st['gridTemplate'+pascal(a)]=tracks(cs[`grid-template-${a}`]);
      for(const a of ['row','column'])if(cs[`grid-${a}`]){const v=split(cs[`grid-${a}`],'/'),p=x=>!x||x==='auto'?'auto':x.startsWith('span')?{span:parseInt(x.slice(4))}:parseInt(x);st['grid'+pascal(a)]={start:p(v[0]),end:p(v[1])};}
      const e={el,cs,parent,children:[],kind:el.tagName.toLowerCase()};
      if(cs.display==='none'){e.node=tree.newLeaf(st);}
      else if(['canvas','svg','img'].includes(e.kind)){
        const viewBox=(el.getAttribute('viewBox')||'').split(/[ ,]+/).map(Number);
        e.intrinsic={width:e.kind==='canvas'?(el.width||300):Number(el.getAttribute('width'))||el.naturalWidth||300,height:e.kind==='canvas'?(el.height||150):Number(el.getAttribute('height'))||el.naturalHeight||150,ratio:viewBox[2]/viewBox[3]};
        if(e.kind==='canvas'){if(!cs.width)st.width=e.intrinsic.width;if(!cs.height)st.height=e.intrinsic.height;}
        e.node=tree.newLeafWithContext(st,e);
      }else{
        const pseudo=kind=>{if(forcedStyle)return null;const style=this.cascade.style(el,kind);if(!style.content||['none','normal'].includes(style.content))return null;let nodes=this.pseudos.get(el);if(!nodes)this.pseudos.set(el,nodes={});let node=nodes[kind];if(!node)node=nodes[kind]=document.createElement('adapter-pseudo');node.textContent=style.content.replace(/^['"]|['"]$/g,'');const child=build(node,e,style);child.pseudo=el;return child;};
        const children=[pseudo('before'),...[...el.childNodes].map(c=>build(c,e)),pseudo('after')].filter(Boolean);e.children=children;
        fixed.push(...children.filter(c=>c.cs.position==='fixed'));
        // CSS inline formatting is laid out as a wrapping row of text/replaced boxes.
        if(st.display===T.Display.Block&&e.children.length&&e.children.every(c=>c.kind==='text'||/inline/.test(c.cs.display))){st.display=T.Display.Flex;st.flexDirection=T.FlexDirection.Row;st.flexWrap=T.FlexWrap.Wrap;st.alignItems=el.tagName==='BUTTON'?T.AlignItems.Center:T.AlignItems.Baseline;if(cs['text-align']==='center')st.justifyContent=T.JustifyContent.Center;else if(cs['text-align']==='right')st.justifyContent=T.JustifyContent.FlexEnd;}
        e.node=tree.newWithChildren(st,e.children.filter(c=>c.cs.position!=='fixed').map(c=>c.node));
      }
      this.entries.push(e);byId.set(e.node,e);return e;
    };
    const body=build(document.documentElement);if(fixed.length)tree.setChildren(body.node,[...body.children.map(c=>c.node),...fixed.map(c=>c.node)]);
    const rootStyle=tree.getStyle(body.node);rootStyle.width=E.width;rootStyle.height=E.height;tree.setStyle(body.node,rootStyle);rootStyle.free();
    tree.computeLayoutWithMeasure(body.node,{width:E.width,height:E.height},(known,available,id,ctx,style)=>{
      style.free();
      const e=ctx||byId.get(id);if(e?.intrinsic){const natural=e.intrinsic,ratio=natural.ratio||natural.width/natural.height;return{width:known.width??(known.height!==undefined?known.height*ratio:natural.width),height:known.height??(known.width!==undefined?known.width/ratio:natural.height)};}
      if(!e?.text)return {width:known.width||0,height:known.height||0};
      return this.measure(e.text,e.cs,known,available);
    });
    const positioned=new Set();
    const place=(e,x=0,y=0)=>{
      if(positioned.has(e))return;positioned.add(e);
      const l=tree.getLayout(e.node),b={x:x+l.x,y:y+l.y,width:l.width,height:l.height,paddingLeft:l.paddingLeft,paddingTop:l.paddingTop,paddingRight:l.paddingRight,paddingBottom:l.paddingBottom,contentWidth:Math.max(0,l.width-l.paddingLeft-l.paddingRight-l.borderLeft-l.borderRight),contentHeight:Math.max(0,l.height-l.paddingTop-l.paddingBottom-l.borderTop-l.borderBottom)};l.free();
      if(e.cs.position==='fixed'){b.x-=x;b.y-=y;}
      if(e.cs.position==='sticky'){let ancestor=e.parent;while(ancestor&&!['auto','scroll','hidden'].includes(ancestor.cs['overflow-y']))ancestor=ancestor.parent;if(ancestor?.box){const top=length(e.cs.top,ancestor.box.height,E)||0;b.y=Math.max(b.y,ancestor.box.y+top);}}
      b.left=b.x;b.top=b.y;b.right=b.x+b.width;b.bottom=b.y+b.height;e.box=b;this.boxes.set(e.el,b);
      for(const c of e.children)place(c,b.x-(e.el.scrollLeft||0),b.y-(e.el.scrollTop||0));
    };
    place(body);for(const e of fixed)place(e);this.root=body;this.fixed=fixed;
    for(const s of styles)s.free();
    // Resolve calc/min/max percentages against this layout's containing blocks,
    // including ancestors that were display:none in the previous frame.
    if(pass<3&&this.entries.some(e=>Object.values(e.cs).some(v=>typeof v==='string'&&v.includes('%')&&/calc\(|min\(|max\(/.test(v))&&Math.abs((previous.get(e.el)?.width??-1)-e.box.width)>.1))return this.compute(document,pass+1);
    return body;
  }
}
