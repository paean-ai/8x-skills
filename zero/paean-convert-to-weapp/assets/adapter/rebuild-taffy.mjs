// Recompile the same pinned layout implementation for the WASM MVP profile.
// Requires an existing clean upstream checkout and explicit tool paths.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {legalizeI64,bridgeBinding} from './legalize-wasm.mjs';
const args={};for(let i=2;i<process.argv.length;i+=2)args[process.argv[i].replace(/^--/,'')]=process.argv[i+1];
if(!args.source||!args.out||!args.bindgen||!args.opt||!args.validate||!args.binaryen)throw new Error('Usage: node rebuild-taffy.mjs --source CLEAN_V4_CHECKOUT --out EMPTY_OUTPUT --bindgen WASM_BINDGEN_0.2.106 --opt WASM_OPT_132 --binaryen BINARYEN_132_INDEX_JS --validate WASM_VALIDATE_1.0.39');
const source=await fs.realpath(args.source),out=path.resolve(args.out);
const commit='69d768736c2deacc1de41b029931997549c46ba5';
const flags='-C target-cpu=mvp -C target-feature=-reference-types,-multivalue,-bulk-memory,-nontrapping-fptoint,-sign-ext';
function run(command,argv,options={}){
  const r=spawnSync(command,argv,{cwd:source,encoding:'utf8',...options});
  if(r.status!==0)throw new Error(command+' failed: '+(r.error?.message||r.stderr||r.stdout||r.status));
  return r.stdout?.trim()||'';
}
if(run('git',['rev-parse','HEAD'])!==commit||run('git',['status','--porcelain']))throw new Error('Use the clean, pinned taffy-layout v4.0.0 checkout.');
if((await fs.readdir(out).catch(()=>[])).length)throw new Error('Use an empty output directory; review generated artifacts before replacing vendor files.');
const bindgen=path.resolve(args.bindgen),opt=path.resolve(args.opt),validate=path.resolve(args.validate);
if(!run(bindgen,['--version']).includes('0.2.106'))throw new Error('wasm-bindgen must be 0.2.106');
if(!/\b132\b/.test(run(opt,['--version'])))throw new Error('wasm-opt must be version 132');
if(run(validate,['--version'])!=='1.0.39')throw new Error('wasm-validate must be 1.0.39');
// An explicit RUSTC avoids Homebrew rustc overriding rustup's selected compiler.
const rustc=run('rustup',['which','--toolchain','1.92.0','rustc']);
const scratch=await fs.mkdtemp(path.join(os.tmpdir(),'taffy-mvp-'));
try{
  const target=path.join(scratch,'target'),pkg=path.join(scratch,'pkg');
  run('rustup',['run','1.92.0','cargo','build','--release','--locked','--target','wasm32-unknown-unknown','-Z','build-std=std,panic_abort'],{stdio:'inherit',env:{...process.env,RUSTC:rustc,RUSTC_BOOTSTRAP:'1',RUSTFLAGS:flags,CARGO_TARGET_DIR:target}});
  run(bindgen,['--target','web','--out-dir',pkg,'--out-name','taffy_wasm',path.join(target,'wasm32-unknown-unknown/release/taffy_wasm.wasm')]);
  await fs.mkdir(out,{recursive:true});
  const wasm=path.join(out,'taffy_wasm_bg.wasm');
  run(opt,[path.join(pkg,'taffy_wasm_bg.wasm'),'-O2','--mvp-features','--strip-debug','--strip-producers','-o',wasm]);
  const {default:binaryen}=await import(pathToFileURL(path.resolve(args.binaryen)).href);
  const legalized=legalizeI64(binaryen,await fs.readFile(wasm));
  await fs.writeFile(wasm,legalized.wasm);
  await fs.writeFile(path.join(out,'i64-abi.json'),JSON.stringify(legalized.abi,null,2)+'\n');
  run(validate,['--disable-reference-types','--disable-multi-value','--disable-bulk-memory','--disable-saturating-float-to-int','--disable-sign-extension','--disable-simd','--disable-mutable-globals',wasm]);
  await fs.writeFile(path.join(out,'taffy_wasm.js'),bridgeBinding(await fs.readFile(path.join(pkg,'taffy_wasm.js'),'utf8')));
  await fs.copyFile(path.join(source,'LICENSE'),path.join(out,'LICENSE'));
  const sha=async file=>createHash('sha256').update(await fs.readFile(file)).digest('hex');
  const artifacts={};for(const name of ['taffy_wasm.js','taffy_wasm_bg.wasm','i64-abi.json','LICENSE'])artifacts[name]=await sha(path.join(out,name));
  await fs.writeFile(path.join(out,'provenance.json'),JSON.stringify({repository:'https://github.com/ByteLandTechnology/taffy-layout',tag:'v4.0.0',commit,taffy:'0.15.1',rust:'1.92.0',wasmBindgen:'0.2.106',binaryen:'132.0.0',wabt:'1.0.39',rustFlags:flags,rebuildStd:true,legalizeJSInterface:true,cargoLock:await sha(path.join(source,'Cargo.lock')),artifacts},null,2)+'\n');
  console.log('Verified MVP artifacts:',out);
}finally{await fs.rm(scratch,{recursive:true,force:true});}
