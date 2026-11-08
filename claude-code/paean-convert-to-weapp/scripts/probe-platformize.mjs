#!/usr/bin/env node
// Evaluate a checked-out upstream adapter against an isolated wx mock.
// This reports gaps; it neither patches the adapter nor certifies device support.
import { createRequire } from 'node:module'
import path from 'node:path'
import vm from 'node:vm'
try {
  if (process.argv.length !== 3) throw new Error('Usage: node probe-platformize.mjs PLATFORMIZE_CHECKOUT (requires esbuild in cwd)')
  const root = path.resolve(process.argv[2]), require = createRequire(path.join(process.cwd(), 'package.json'))
  const esbuild = require('esbuild')
  const result = await esbuild.build({ stdin: { contents: `import { WechatGamePlatform } from './packages/platformize/src/wechat-game/index.ts'; module.exports = WechatGamePlatform;`, resolveDir: root },
    bundle: true, platform: 'neutral', format: 'cjs', target: 'es2018', write: false, logLevel: 'silent' })
  const hooks = {}, canvas = { width: 390, height: 844 }
  const wx = { getSystemInfoSync: () => ({ platform: 'android', windowWidth: 390, windowHeight: 844, pixelRatio: 2 }),
    createImage: () => ({}), onTouchStart: fn => { hooks.start = fn }, onTouchMove: fn => { hooks.move = fn }, onTouchEnd: fn => { hooks.end = fn },
    onTouchCancel: fn => { hooks.cancel = fn } }
  const ctx = vm.createContext({ wx, module: { exports: {} }, requestAnimationFrame() {}, cancelAnimationFrame() {} })
  new vm.Script(result.outputFiles[0].text).runInContext(ctx, { timeout: 10000 })
  const Adapter = ctx.module.exports, adapter = new Adapter(canvas, 390, 844), p = adapter.polyfill
  const events = []; canvas.addEventListener('pointerdown', e => events.push(e.pointerId))
  hooks.start({ type: 'touchstart', timeStamp: 0, touches: [{ identifier: 0, x: 20, y: 30 }, { identifier: 9, x: 80, y: 90 }],
    changedTouches: [{ identifier: 0, x: 20, y: 30 }, { identifier: 9, x: 80, y: 90 }] })
  console.log(JSON.stringify({ scope: 'mock API contract, not rendering or device validation',
    getElementById: typeof p.document.getElementById,
    createsDiv: !!p.document.createElement('div'),
    distinctAuxiliaryCanvas: p.document.createElement('canvas') !== canvas,
    AbortController: typeof p.AbortController,
    audioCreateOscillator: typeof (new p.window.AudioContext()).createOscillator,
    registersTouchCancel: !!hooks.cancel, pointerIdsFromTwoChangedTouches: events,
    conclusion: 'Use as a reusable adapter base; observed missing surfaces must be implemented before either full game is compatible.' }, null, 2))
} catch (error) { console.error(error.message); process.exitCode = 1 }
