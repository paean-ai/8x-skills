import test from 'node:test';
import assert from 'node:assert/strict';
import {splitI64,joinI64,adaptI64Imports,adaptI64Exports} from './wasm-abi.js';
import abi from './vendor/taffy-wechat/i64-abi.json' with {type:'json'};
test('i64 bridge preserves signed/unsigned 64-bit patterns without floating-point loss',()=>{
  for(const hex of ['0','1','ffffffff','100000001','1fffffffffffff','20000000000001','7fffffffffffffff','8000000000000000','ffffffffffffffff']){
    const value=BigInt('0x'+hex),parts=splitI64(value);
    assert.equal(joinI64(...parts),BigInt.asIntN(64,value));
    for(const part of parts)assert.equal(part,part|0);
  }
  assert.throws(()=>splitI64(Number.MAX_SAFE_INTEGER+2),/bigint/);
});
test('all legal ABI boundaries send numeric words while the existing bindings keep bigint IDs',()=>{
  const value=BigInt('0xfedcba9876543210'),imports={},exports={};
  for(const e of abi.imports)(imports[e.module]??={})[e.name]=(...args)=>{assert.equal(args[0],BigInt.asIntN(64,value));return 42;};
  for(const e of abi.exports)exports[e.name]=(...args)=>{assert.ok(args.every(v=>typeof v==='number'));return args;};
  const mappedImports=adaptI64Imports(imports),mappedExports=adaptI64Exports(exports);
  for(const e of abi.imports)assert.equal(mappedImports[e.module][e.name](...splitI64(value)),42);
  for(const e of abi.exports){const args=e.params.map(t=>t==='i64'?value:7);assert.deepEqual(mappedExports[e.name](...args),e.params.flatMap(t=>t==='i64'?splitI64(value):[7]));}
});
