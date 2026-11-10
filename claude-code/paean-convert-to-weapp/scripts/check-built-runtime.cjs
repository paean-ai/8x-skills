#!/usr/bin/env node
// Regression checks against an actual built environment.js and taffy.wasm.
// Usage: node check-built-runtime.cjs PORT_DIRECTORY [--report JSON_PATH]
// Each scenario runs in a child process because the adapter mutates DOM prototypes.
// This tests bootstrap, native callback routing and scheduling with a wx mock.
// It does not prove native GPU, pixels, audio, or full-game/device compatibility.
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { spawnSync } = require('node:child_process');

const args = process.argv.slice(2);
if (!args[0] || args[0] === '--help') {
  console.log('Usage: node check-built-runtime.cjs PORT_DIRECTORY [--report JSON_PATH]');
  process.exit(args[0] === '--help' ? 0 : 2);
}
const root = path.resolve(args[0]);
const option = key => { const i = args.indexOf(key); return i < 0 ? null : args[i + 1]; };
const scenario = option('--scenario');

if (!scenario) {
  const results = ['no-browser-or-node-globals', 'empty-touch-cancel', 'resume-single-raf-chain'].map(name => {
    const child = spawnSync(process.execPath, [__filename, root, '--scenario', name], { encoding: 'utf8', timeout: 15000 });
    let result;
    try { result = JSON.parse(child.stdout); }
    catch { result = { scenario: name, status: 'failed', error: child.error?.message || child.stdout || child.stderr }; }
    return { ...result, exitCode: child.status, ...(child.stderr ? { stderr: child.stderr.trim() } : {}) };
  });
  const passed = results.every(result => result.status === 'passed' && result.exitCode === 0);
  const report = { status: passed ? 'passed' : 'failed', scope: 'Packaged adapter + real DOM/WASM; wx/Canvas2D mocks; no gameplay or native-device claim', output: root, results };
  const json = JSON.stringify(report, null, 2) + '\n';
  if (option('--report')) fs.writeFileSync(path.resolve(option('--report')), json);
  process.stdout.write(json);
  process.exit(passed ? 0 : 1);
}

function host() {
  const hooks = {}, frames = new Map(), storage = new Map();
  let nextFrame = 0, clock = 0, canvasCount = 0, paints = 0;
  function context(display) {
    const ctx = { globalAlpha: 1, measureText: value => ({ width: String(value).length * 8 }),
      getTransform: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }),
      clearRect() { if (display) paints++; } };
    for (const name of ['setTransform', 'save', 'restore', 'translate', 'rotate', 'scale', 'transform', 'beginPath', 'moveTo', 'lineTo', 'quadraticCurveTo', 'closePath', 'fill', 'stroke', 'clip', 'fillRect', 'fillText']) ctx[name] = () => {};
    return ctx;
  }
  const wx = {
    createCanvas() {
      const ctx = context(canvasCount++ === 0);
      return { width: 300, height: 150, getContext: type => type === '2d' ? ctx : null,
        requestAnimationFrame(fn) { frames.set(++nextFrame, fn); return nextFrame; },
        cancelAnimationFrame(id) { frames.delete(id); } };
    },
    getWindowInfo: () => ({ windowWidth: 390, windowHeight: 844, pixelRatio: 2, platform: 'node-mock', safeArea: { top: 0, bottom: 844 } }),
    getStorageInfoSync: () => ({ keys: [...storage.keys()] }),
    getStorageSync: key => storage.get(key) ?? '',
    setStorageSync: (key, value) => storage.set(key, value),
    removeStorageSync: key => storage.delete(key),
    getFileSystemManager: () => ({ readFileSync: (file, encoding) => fs.readFileSync(path.join(root, file), encoding) }),
    getPerformance: () => ({ now: () => clock })
  };
  for (const name of ['TouchStart', 'TouchMove', 'TouchEnd', 'TouchCancel', 'Hide', 'Show', 'WindowResize']) wx['on' + name] = fn => { hooks[name] = fn; };
  return { wx, hooks, frames, paints: () => paints,
    run(id) {
      const callback = frames.get(id);
      assert.equal(typeof callback, 'function', 'expected a queued native RAF callback');
      frames.delete(id); clock += 16; callback(clock);
    },
    onlyFrame() { assert.equal(frames.size, 1, 'exactly one native RAF must remain scheduled'); return frames.keys().next().value; }
  };
}

async function check() {
  const h = host();
  if (scenario === 'no-browser-or-node-globals') {
    // Do not use Node's global object: it provides Buffer, atob, text codecs,
    // URL and process and previously concealed the physical-device failure.
    const context = vm.createContext({console, setTimeout, clearTimeout, setInterval, clearInterval,
      wx: h.wx, module: {exports: {}}});
    // Keep WASM memory in the same realm as its JS binding and text codecs.
    const realmWasm = vm.runInContext('WebAssembly', context);
    context.WXWebAssembly = {instantiate: (file, imports) => realmWasm.instantiate(fs.readFileSync(path.join(root, file)), imports)};
    vm.runInContext('globalThis.GameGlobal = globalThis', context);
    const absent = ['Buffer', 'atob', 'btoa', 'TextEncoder', 'TextDecoder', 'window', 'global', 'process', 'URL'];
    for (const name of absent) assert.equal(vm.runInContext('typeof ' + name, context), 'undefined', name + ' must be absent before boot');
    const file = path.join(root, 'environment.js');
    // WeChat require() evaluates each CommonJS module in its own scope.
    const wrapped = '(function(module, exports) {\n' + fs.readFileSync(file, 'utf8') + '\n})(module, module.exports);';
    new vm.Script(wrapped, {filename: file}).runInContext(context, {timeout: 5000});
    const runtime = context.module.exports;
    const env = await runtime.initialize(h.wx, {id: 'host-api-regression', origin: 'https://example.invalid',
      html: '<html><body><div id="entities">&amp; &copy; &#x1F43E; 中文</div></body></html>', rules: [], keyframes: {}});
    const text = env.document.getElementById('entities').textContent;
    assert.equal(text, '& © 🐾 中文', 'entity table must decode without Node Buffer');
    const encoder = new env.TextEncoder(), decoder = new env.TextDecoder('utf-8', {fatal: true, ignoreBOM: true});
    assert.equal(decoder.decode(encoder.encode(text)), text);
    assert.equal(decoder.decode(), '');
    assert.throws(() => decoder.decode(vm.runInContext('new Uint8Array([255])', context)), /error|invalid/i);
    const bytes = encoder.encode('🐾'), stream = new env.TextDecoder('utf-8', {fatal: true});
    assert.equal(stream.decode(bytes.subarray(0, 2), {stream: true}), '');
    assert.equal(stream.decode(bytes.subarray(2)), '🐾');
    assert.equal(await (await env.fetch('data:text/plain;charset=utf-8;base64,' + Buffer.from(text).toString('base64'))).text(), text);
    assert.equal(env.atob(env.btoa('\x00\x80\xff')), '\x00\x80\xff');
    runtime.start(); h.run(h.onlyFrame()); h.hooks.Hide(); h.run(h.onlyFrame());
    assert.equal(h.frames.size, 0);
    assert.equal(env.inspect().errors.length, 0);
    for (const name of absent.filter(name => name !== 'URL')) assert.equal(vm.runInContext('typeof ' + name, context), 'undefined', name + ' must remain scoped');
    return {initiallyAbsent: absent, entities: text, strictUTF8: true, streamedUTF8: true, dataURL: true, wasmLayout: true, paints: h.paints(), nodeGlobalsAdded: false};
  }
  global.GameGlobal = {};
  global.wx = h.wx;
  global.WXWebAssembly = { instantiate: (file, imports) => WebAssembly.instantiate(fs.readFileSync(path.join(root, file)), imports) };
  const runtime = require(path.join(root, 'environment.js'));
  // A small real DOM fixture isolates these contracts from graphics/game behavior.
  const env = await runtime.initialize(h.wx, { id: 'adapter-contract-regression', origin: 'https://example.invalid',
    html: '<html><body><div id="capture-a"></div><div id="capture-b"></div></body></html>', rules: [], keyframes: {} });
  if (scenario === 'empty-touch-cancel') {
    const body = env.document.body, a = env.document.getElementById('capture-a'), b = env.document.getElementById('capture-b');
    const down = [], cancelled = [];
    body.addEventListener('pointerdown', event => { down.push(event.pointerId); (event.pointerId === 0 ? a : b).setPointerCapture(event.pointerId); });
    body.addEventListener('pointercancel', event => cancelled.push(event.pointerId));
    h.hooks.TouchStart({ changedTouches: [{ identifier: 0, clientX: 20, clientY: 30 }, { identifier: 9, clientX: 80, clientY: 90 }] });
    assert.deepEqual(down, [0, 9]);
    assert.equal(a.hasPointerCapture(0), true); assert.equal(b.hasPointerCapture(9), true);
    h.hooks.TouchCancel({ changedTouches: [] });
    assert.deepEqual(cancelled, [0, 9], 'empty changedTouches must cancel both active pointers immediately');
    assert.equal(a.hasPointerCapture(0), false); assert.equal(b.hasPointerCapture(9), false);
    assert.equal(body.hasAttribute('data-adapter-active'), false, 'active styling must be cleared');
    h.hooks.TouchCancel({ changedTouches: [] }); h.hooks.Hide();
    assert.deepEqual(cancelled, [0, 9], 'subsequent cancel/hide must not redispatch cleared pointers');
    return { down, immediatelyCancelled: cancelled, capturesReleased: true, duplicateCancellations: 0 };
  }
  assert.equal(scenario, 'resume-single-raf-chain', 'unknown scenario');
  let gameCallbacks = 0;
  const gameLoop = () => { gameCallbacks++; env.requestAnimationFrame(gameLoop); };
  env.requestAnimationFrame(gameLoop);
  const readCounts = () => ({ game: gameCallbacks, paints: h.paints(), runtime: env.inspect().frames });
  const resume = () => {
    const stale = h.onlyFrame();
    h.hooks.Hide(); h.hooks.Show();
    const resumed = [...h.frames.keys()].find(id => id !== stale);
    assert.equal(typeof resumed, 'number');
    return { stale, resumed, transientPending: h.frames.size };
  };
  runtime.start(); runtime.start(); h.onlyFrame();
  const rounds = [];
  // Exercise both native callback delivery orders and repeated hide/show cycles.
  for (const ordering of ['stale-first', 'resumed-first', 'stale-first']) {
    const round = resume(), before = readCounts();
    if (ordering === 'stale-first') {
      h.run(round.stale);
      assert.deepEqual(readCounts(), before, 'stale RAF must neither execute the game nor paint');
      assert.equal(h.frames.size, 1, 'stale RAF must not schedule a successor');
      h.run(round.resumed);
    } else {
      h.run(round.resumed);
      const afterResumed = readCounts(), pendingAfterResumed = h.frames.size;
      h.run(round.stale);
      assert.deepEqual(readCounts(), afterResumed, 'late stale RAF must do no work');
      assert.equal(h.frames.size, pendingAfterResumed - 1, 'late stale RAF must not schedule a successor');
    }
    assert.deepEqual(readCounts(), { game: before.game + 1, paints: before.paints + 1, runtime: before.runtime + 1 });
    h.onlyFrame();
    for (let i = 0; i < 4; i++) { h.run(h.onlyFrame()); h.onlyFrame(); }
    assert.deepEqual(readCounts(), { game: before.game + 5, paints: before.paints + 5, runtime: before.runtime + 5 });
    rounds.push({ ordering, transientPending: round.transientPending, afterDrainingOldAndNew: 1, continuingFrames: 5 });
  }
  const beforeFinalHide = readCounts(), last = h.onlyFrame(); h.hooks.Hide(); h.run(last);
  assert.deepEqual(readCounts(), beforeFinalHide, 'hidden callback must not run the game or paint');
  assert.equal(h.frames.size, 0, 'hidden callback must stop scheduling');
  assert.deepEqual(env.inspect().errors, []);
  return { rounds, gameCallbacks, paints: h.paints(), runtimeFrames: env.inspect().frames, finalPending: h.frames.size };
}

check().then(evidence => {
  process.stdout.write(JSON.stringify({ scenario, status: 'passed', evidence }));
  process.exit(0); // The adapter's delayed diagnostic log is outside this contract.
}).catch(error => {
  process.stdout.write(JSON.stringify({ scenario, status: 'failed', error: error.message || String(error), stack: error.stack?.split('\n').filter(line => line.length < 600).join('\n'), details: Object.getOwnPropertyNames(Object(error)) }));
  process.exit(1);
});
