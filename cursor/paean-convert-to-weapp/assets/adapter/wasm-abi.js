import abi from './vendor/taffy-wechat/i64-abi.json' with {type:'json'};
const shift=BigInt(32);
export function splitI64(value){
  if(typeof value!=='bigint')throw new TypeError('WASM i64 argument must be a bigint');
  return [Number(BigInt.asIntN(32,value)),Number(BigInt.asIntN(32,value>>shift))];
}
export function joinI64(low,high){return BigInt.asIntN(64,BigInt(low>>>0)|(BigInt(high>>>0)<<shift));}
export function adaptI64Imports(imports){
  const mapped={...imports};
  for(const entry of abi.imports){
    const original=imports[entry.module][entry.name];
    if(mapped[entry.module]===imports[entry.module])mapped[entry.module]={...imports[entry.module]};
    mapped[entry.module][entry.name]=(...args)=>{
      let i=0;return original(...entry.params.map(type=>type==='i64'?joinI64(args[i++],args[i++]):args[i++]));
    };
  }
  return mapped;
}
export function adaptI64Exports(exports){
  const mapped={...exports};
  for(const entry of abi.exports){
    const original=exports[entry.name];
    mapped[entry.name]=(...args)=>original(...entry.params.flatMap((type,i)=>type==='i64'?splitI64(args[i]):[args[i]]));
  }
  return mapped;
}
