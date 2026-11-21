import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import * as upstream from 'taffy-layout/wasm';
import * as compatible from './vendor/taffy-wechat/taffy_wasm.js';

await upstream.default({module_or_path:await fs.readFile(new URL('./node_modules/taffy-layout/pkg/taffy_wasm_bg.wasm',import.meta.url))});
await compatible.default({module_or_path:await fs.readFile(new URL('./vendor/taffy-wechat/taffy_wasm_bg.wasm',import.meta.url))});

function scene(T,index){
  const tree=new T.TaffyTree(),styles=[];
  tree.disableRounding();
  const style=()=>{const s=new T.Style();styles.push(s);return s;};
  const rootStyle=style();rootStyle.display=index%3===0?T.Display.Grid:T.Display.Flex;
  rootStyle.width=320+index*7.25;rootStyle.height=480+index*9.5;
  rootStyle.paddingLeft=12.5;rootStyle.paddingTop=9.25;
  rootStyle.flexDirection=index%2?T.FlexDirection.Row:T.FlexDirection.Column;
  rootStyle.flexWrap=T.FlexWrap.Wrap;rootStyle.columnGap=7.5;rootStyle.rowGap=5.25;
  if(index%3===0)rootStyle.gridTemplateColumns=[{min:0,max:'1fr'},{min:0,max:'2fr'}];
  const nodes=[];
  for(let i=0;i<9;i++){
    const s=style();s.width=i%3===0?'50%':35.5+i*8;s.height=21.25+i*6;
    s.flexGrow=i%3;s.flexShrink=1;s.minWidth=17.5;
    nodes.push(tree.newLeaf(s));
  }
  const root=tree.newWithChildren(rootStyle,nodes);
  assert.equal(typeof root,'bigint','preserve the original u64 node ID API');
  tree.computeLayout(root,{width:640,height:960});
  const result=[root,...nodes].map(node=>{
    const box=tree.getLayout(node),out={};
    for(const key of ['x','y','width','height','paddingLeft','paddingTop'])out[key]=box[key];
    box.free();return out;
  });
  tree.free();for(const s of styles)s.free();return result;
}

test('MVP-compiled Taffy retains upstream API and exact flex/grid results',()=>{
  assert.deepEqual(Object.keys(compatible).sort(),Object.keys(upstream).sort());
  for(let i=0;i<24;i++)assert.deepEqual(scene(compatible,i),scene(upstream,i),'scene '+i);
});
