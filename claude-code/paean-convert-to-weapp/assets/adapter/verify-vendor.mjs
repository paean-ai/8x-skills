import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
export async function verifyTaffy(directory){
  const manifest=JSON.parse(await fs.readFile(path.join(directory,'provenance.json'),'utf8'));
  if(manifest.commit!=='69d768736c2deacc1de41b029931997549c46ba5'||manifest.legalizeJSInterface!==true)throw new Error('Review the pinned Taffy build provenance');
  for(const name of ['taffy_wasm.js','taffy_wasm_bg.wasm','i64-abi.json','LICENSE']){
    const actual=createHash('sha256').update(await fs.readFile(path.join(directory,name))).digest('hex');
    if(actual!==manifest.artifacts[name])throw new Error('Taffy artifact mismatch: '+name+'; keep the WASM, binding and ABI metadata together');
  }
}
