import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import {fileURLToPath} from 'node:url';
const adapterDir=path.dirname(fileURLToPath(import.meta.url));
export async function buildPort(options){
  const source=await fs.realpath(options.source),out=path.resolve(options.out),id=options.id,origin=options.origin,title=options.title||id;
  if(!id||!/^https?:\/\//.test(origin||''))throw new Error('Provide the source id and original http(s) origin.');
  let ancestor=out;while(!await fs.stat(ancestor).then(()=>true).catch(()=>false))ancestor=path.dirname(ancestor);
  const canonicalOut=path.join(await fs.realpath(ancestor),path.relative(ancestor,out));
  if(canonicalOut===source||canonicalOut.startsWith(source+path.sep)||source.startsWith(canonicalOut+path.sep))throw new Error('Output must be separate from the immutable source, including symlink aliases.');
  const entries=await fs.readdir(out).catch(()=>[]);
  if(entries.length){const prior=await fs.readFile(path.join(out,'source-data.json'),'utf8').then(JSON.parse).catch(()=>null);if(prior?.id!==id)throw new Error('Refusing to overwrite an unrelated nonempty output directory.');}
  async function writeChanged(file,text){if(await fs.readFile(file,'utf8').catch(()=>null)!==text)await fs.writeFile(file,text);}
  const tooling=path.resolve(options.tooling||adapterDir),require=createRequire(path.join(tooling,'package.json'));
  const esbuild=require('esbuild'),{parseHTML}=require('linkedom'),csstree=require('css-tree');
  await fs.mkdir(out,{recursive:true});
  const html = await fs.readFile(path.join(source,'index.html'),'utf8');
  const {document} = parseHTML(html);
  const rules=[],keyframes={};
  let order=0;
  function collect(ast,media=[]){
    ast.children?.forEach(n=>{
      if(n.type==='Atrule' && n.name==='media') collect(n.block,[...media,csstree.generate(n.prelude)]);
      else if(n.type==='Atrule' && n.name.endsWith('keyframes')) {const frames=[];n.block.children.forEach(frame=>{const values={};frame.block.children.forEach(d=>{if(d.type==='Declaration')values[d.property]=csstree.generate(d.value);});for(const stop of csstree.generate(frame.prelude).split(','))frames.push({offset:stop==='from'?0:stop==='to'?1:parseFloat(stop)/100,values});});keyframes[csstree.generate(n.prelude)]=frames.sort((a,b)=>a.offset-b.offset);}
      else if(n.type==='Rule') {
        const declarations=[];
        n.block.children.forEach(d=>{if(d.type==='Declaration')declarations.push([d.property,csstree.generate(d.value),!!d.important]);});
        n.prelude.children.forEach(s=>{let right=[];s.children.forEach(n=>{if(n.type==='Combinator')right=[];else right.push(n);});const hints={id:right.find(n=>n.type==='IdSelector')?.name,tag:right.find(n=>n.type==='TypeSelector'&&n.name!=='*')?.name,classes:right.filter(n=>n.type==='ClassSelector').map(n=>n.name)};rules.push({selector:csstree.generate(s),hints,media,declarations,order:order++});});
      }
    });
  }
  for(const style of document.querySelectorAll('link[rel=stylesheet],style')){const href=style.getAttribute('href');if(href&&/^(https?:)?\/\//.test(href))throw new Error('Vendor stylesheet locally before building: '+href);collect(csstree.parse(href?await fs.readFile(path.join(source,href),'utf8'):style.textContent));}
  const scripts=[...document.querySelectorAll('script')].flatMap(s=>{const type=s.getAttribute('type');if(type==='importmap')throw new Error('Resolve the original import map into bundler aliases first.');if(type&&!['module','text/javascript','application/javascript'].includes(type))return[];const src=s.getAttribute('src');if(src&&/^(https?:)?\/\//.test(src))throw new Error('Vendor executable dependency locally before building: '+src);return[src?`require(${JSON.stringify(path.join(source,src))});`:s.textContent];});
  const config={id,html,rules,keyframes,origin};
  await fs.writeFile(path.join(out,'source-data.json'),JSON.stringify(config));
  const exclude=new Set(['clide.json','paean.json','paean-app.json','package.json','package-lock.json','project.config.json','project.private.config.json','node_modules']);
  async function copyAssets(dir,relative=''){
    for(const entry of await fs.readdir(dir,{withFileTypes:true})){
      if(entry.name.startsWith('.')||exclude.has(entry.name))continue;
      const rel=path.join(relative,entry.name),src=path.join(dir,entry.name);
      if(entry.isSymbolicLink())throw new Error('Review source symlink before packaging: '+rel);
      if(entry.isDirectory()){await copyAssets(src,rel);continue;}
      if(/\.(?:m?js|cjs|css|html?|map)$/i.test(entry.name))continue;
      // Retain every static asset; source code may refer to any filename.
      await fs.mkdir(path.dirname(path.join(out,rel)),{recursive:true});await fs.copyFile(src,path.join(out,rel));
    }
  }
  await copyAssets(source);
  await fs.copyFile(path.join(tooling,'node_modules/taffy-layout/pkg/taffy_wasm_bg.wasm'),path.join(out,'taffy.wasm'));
  const inject = path.join(adapterDir,'inject.js');
  await esbuild.build({stdin:{contents:scripts.join('\n'),resolveDir:source},outfile:path.join(out,'original.js'),bundle:true,format:'cjs',platform:'browser',target:'es2020',inject:[inject],minify:!options.diagnostics,legalComments:'eof',nodePaths:[path.join(tooling,'node_modules')],external:['./environment.js'],define:{'process.env.NODE_ENV':'"production"','innerWidth':'window.innerWidth','innerHeight':'window.innerHeight','devicePixelRatio':'window.devicePixelRatio','PaeanSDK':'window.PaeanSDK'},plugins:[{name:'module-url',setup(b){b.onLoad({filter:/\.js$/},async({path:p})=>{if(!p.startsWith(source+'/'))return;const contents=await fs.readFile(p,'utf8');if(!contents.includes('import.meta'))return;return {contents:(await esbuild.transform(contents,{loader:'js',define:{'import.meta.url':JSON.stringify(config.origin+'/'+path.relative(source,p))}})).code,loader:'js'};});}}]});
  await esbuild.build({entryPoints:[path.join(adapterDir,'environment.js')],outfile:path.join(out,'environment.js'),bundle:true,format:'cjs',platform:'browser',target:'es2020',minify:!options.diagnostics,legalComments:'eof',nodePaths:[path.join(tooling,'node_modules')],external:['./source-data.json'],define:{'process.env.NODE_ENV':'"production"'},plugins:[{name:'wx-wasm',setup(build){build.onLoad({filter:/taffy_wasm\.js$/},async({path:p})=>{let contents=await fs.readFile(p,'utf8');for(const [from,to]of [['module_or_path = fetch(module_or_path);','module_or_path = typeof WXWebAssembly !== "undefined" ? module_or_path : fetch(module_or_path);'],['const { instance, module } = await __wbg_load(await module_or_path, imports);','const { instance, module } = typeof WXWebAssembly !== "undefined" ? await WXWebAssembly.instantiate(module_or_path, imports) : await __wbg_load(await module_or_path, imports);']]){if(contents.split(from).length!==2)throw new Error('Pinned Taffy WASM binding changed; review the WXWebAssembly transform.');contents=contents.replace(from,to);}return{contents,loader:'js'};});}}]});
  if(options.diagnostics)await esbuild.build({entryPoints:[path.join(adapterDir,'diagnostics.js')],outfile:path.join(out,'diagnostics.js'),format:'cjs',target:'es2020'});
  await fs.writeFile(path.join(out,'game.js'),`const env=require('./environment.js');\nconst config=JSON.parse(wx.getFileSystemManager().readFileSync('source-data.json','utf8'));\nenv.initialize(wx,config).then(()=>{require('./original.js');env.start();${options.diagnostics?"require('./diagnostics.js').startDiagnostics(wx,env.default);":''}}).catch(e=>{console.error('[adapter bootstrap]',e);throw e;});\n`);
  await writeChanged(path.join(out,'game.json'),JSON.stringify({deviceOrientation:'portrait'},null,2));
  const projectPath=path.join(out,'project.config.json');
  const existing=await fs.readFile(projectPath,'utf8').then(JSON.parse).catch(()=>({appid:'touristappid'}));
  await writeChanged(projectPath,JSON.stringify({...existing,appid:options.appid||existing.appid,projectname:title,compileType:'game',miniprogramRoot:'./',setting:{...existing.setting,urlCheck:true,es6:false,minified:false},packOptions:{ignore:[{type:'file',value:'source-data.json.map'}]}},null,2));
  const notices=[];
  const packages=new Map();
  async function licensePackage(name){if(packages.has(name))return;packages.set(name,true);const dir=path.join(tooling,'node_modules',name);let pkg;try{pkg=JSON.parse(await fs.readFile(path.join(dir,'package.json'),'utf8'));}catch{return;}const files=(await fs.readdir(dir)).filter(f=>/^(license|copying|notice)(\.|$)/i.test(f));let body='';for(const f of files)if((await fs.stat(path.join(dir,f))).isFile())body+='\n'+await fs.readFile(path.join(dir,f),'utf8');notices.push(name+' '+pkg.version+' ('+(pkg.license||'See upstream')+')\n'+body);for(const name of Object.keys(pkg.dependencies||{}))await licensePackage(name);}
  for(const name of ['abort-controller','canvg','core-js','fast-text-encoding','linkedom','taffy-layout'])await licensePackage(name);
  await fs.writeFile(path.join(out,'THIRD_PARTY_NOTICES.txt'),notices.join('\n\n====================\n\n'));
  console.log('Built',id,out);return {source,out,id};
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const options={};for(let i=2;i<process.argv.length;i++){const key=process.argv[i].replace(/^--/,'');if(key==='diagnostics')options[key]=true;else options[key]=process.argv[++i];}
  if(!options.source||!options.out)throw new Error('Usage: node build-port.mjs --source SOURCE --out PORT --id HASH --origin https://ORIGINAL.clide.app [--tooling DIR] [--appid wx...] [--diagnostics]');
  await buildPort(options);
}
