#!/usr/bin/env node
// Executes only the named case cores in a VM without browser globals or wx.
// Requires esbuild in the caller's working directory. This is not a device test.
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import assert from 'node:assert/strict'
import { auditSource } from './audit-source.mjs'

const args = process.argv.slice(2), options = {}
if (args.length === 1 && args[0] === '--help') {
  console.log('Usage: node probe-cases.mjs --snout SOURCE_DIR --quillionaire SOURCE_DIR\nRun from a directory with esbuild installed. Executes downloaded case logic; no API calls or writes.')
  process.exit(0)
}
try {
  for (let i = 0; i < args.length; i += 2) {
    if (!['--snout', '--quillionaire'].includes(args[i]) || !args[i + 1] || args[i] in options) throw new Error('Invalid arguments')
    options[args[i]] = path.resolve(args[i + 1])
  }
  if (!options['--snout'] || !options['--quillionaire']) throw new Error('Provide both case source directories')
  const require = createRequire(path.join(process.cwd(), 'package.json'))
  let esbuild
  try { esbuild = require('esbuild') } catch { throw new Error('Install esbuild in a separate project/tooling directory and run this command there') }
  async function run(source, root) {
    let output
    try { output = await esbuild.build({ stdin: { contents: source, resolveDir: root, sourcefile: 'case-probe.js' },
      bundle: true, platform: 'neutral', format: 'cjs', target: 'es2018', write: false, logLevel: 'silent' }) }
    catch (error) { error.probeStage = 'build'; throw error }
    const context = vm.createContext({ module: { exports: {} } })
    try { new vm.Script(output.outputFiles[0].text).runInContext(context, { timeout: 10000 }) }
    catch (error) { error.probeStage = 'evaluation'; throw error }
    return JSON.parse(JSON.stringify(context.module.exports))
  }
  const snout = await run(`import {MatchGame} from './js/engine.js'; import {levelConfig} from './js/levels.js';
    const results=[]; for (const level of [1,12,30,60]) {
      const config=levelConfig(level, 0x51a07), a=new MatchGame(config), b=new MatchGame(config);
      if (JSON.stringify(a.snapshot())!==JSON.stringify(b.snapshot())) throw Error('Non-deterministic seed');
      let accepted=0; for (let i=0;i<12&&!a.done;i++) { const move=a.bestMove(); if(!move) break;
        const before=a.moves, result=a.swap(...move); if(!result.valid||a.moves!==before-1) throw Error('Swap transition');
        if(!result.frames.length||!Number.isFinite(a.score)) throw Error('Invalid resolution'); accepted++;
      } results.push({level,accepted,score:a.score,moves:a.moves,done:a.done});
    } module.exports={browserGlobalsAvailable:typeof document!=='undefined'||typeof window!=='undefined',results};`, options['--snout'])
  assert.equal(snout.browserGlobalsAvailable, false)
  assert.ok(snout.results.every(r => r.accepted > 0))
  const quillionaire = await run(`import * as E from './js/game/eco.js'; import * as W from './js/world/gen.js';
    const e=E.freshEco(), before=E.owned(e), purchased=Math.min(2,E.capacity(e)-before); E.earn(e,1000); const cost=E.bulkCost(e,purchased);
    if(cost>e.money)throw Error('Cost');e.money-=cost;E.addHeads(e,purchased);
    const after=E.owned(e);for(let i=0;i<600;i++)E.births(e,1/30);
    if(E.owned(e)>E.capacity(e)||!Number.isFinite(e.money))throw Error('Economy invariant');
    W.setSeed(41873); const terrain=[[-20,30],[0,0],[350,-100]].map(([x,z])=>W.groundAt(x,z));
    W.setSeed(41873);const repeat=[[-20,30],[0,0],[350,-100]].map(([x,z])=>W.groundAt(x,z));
    if(JSON.stringify(terrain)!==JSON.stringify(repeat)||!terrain.every(Number.isFinite))throw Error('Terrain determinism');
    module.exports={browserGlobalsAvailable:typeof document!=='undefined'||typeof window!=='undefined',before,after,purchased,owned:E.owned(e),money:e.money,terrain};`, options['--quillionaire'])
  assert.equal(quillionaire.browserGlobalsAvailable, false)
  assert.equal(quillionaire.after, quillionaire.before + quillionaire.purchased)
  const renderer = readFileSync(path.join(options['--quillionaire'], 'vendor/three/three.module.js'), 'utf8')
  const post = readFileSync(path.join(options['--quillionaire'], 'js/render/post.js'), 'utf8')
  let threeModuleProbe
  try { threeModuleProbe = { status: 'evaluated', value: await run(`import {REVISION} from './vendor/three/three.module.js'; module.exports={revision:REVISION};`, options['--quillionaire']) } }
  catch (error) {
    const missingGlobal = error.probeStage === 'evaluation' && error.name === 'ReferenceError' && /^[A-Za-z_$][\w$]* is not defined$/.test(error.message)
    threeModuleProbe = { status: error.probeStage === 'build' ? 'build-error' : missingGlobal ? 'needs-platform-globals' : 'evaluation-error', error: error.message }
    if (!missingGlobal) process.exitCode = 1
  }
  console.log(JSON.stringify({ status: process.exitCode ? 'core-probes-passed-renderer-probe-failed' : 'pure-core-probes-passed', scope: 'Node VM, no DOM, no GPU, no wx simulator or real device',
    sourceDigests: { snout: auditSource(options['--snout']).sourceDigest, quillionaire: auditSource(options['--quillionaire']).sourceDigest },
    snout, quillionaire: { ...quillionaire, threeModuleProbe, three: auditSource(options['--quillionaire']).three, rendererDeclaresWebGL1Unsupported: renderer.includes('WebGL 1 is not supported'),
      postUsesHalfFloat: post.includes('HalfFloatType'), postUsesGLSL3: post.includes('GLSL3') } }, null, 2))
} catch (error) { console.error(error.message); process.exitCode = 1 }
