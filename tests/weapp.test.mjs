import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import vm from 'node:vm'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { auditSource } from '../claude-code/paean-convert-to-weapp/scripts/audit-source.mjs'
import { initWeapp } from '../claude-code/paean-convert-to-weapp/scripts/init-weapp.mjs'
const require = createRequire(import.meta.url)
const createRuntime = require('../claude-code/paean-convert-to-weapp/scripts/templates/wx-runtime.js')
function temp(t) { const dir = mkdtempSync(path.join(tmpdir(), 'weapp port with spaces-')); t.after(() => rmSync(dir, { recursive: true, force: true })); return dir }
function host() {
  const hooks = {}, storage = new Map(), frames = new Map()
  let next = 0, canvasCount = 0
  const info = { windowWidth: 390, windowHeight: 844, pixelRatio: 3, safeArea: { left: 0, top: 47, right: 390, bottom: 810 } }
  const canvas = { getContext: () => ({ setTransform() {}, fillRect() {}, fillText() {}, beginPath() {}, arc() {}, fill() {} }) }
  const wx = { createCanvas: () => { canvasCount++; return canvas }, getWindowInfo: () => info,
    getMenuButtonBoundingClientRect: () => ({ left: 290, top: 52, right: 375, bottom: 84 }),
    getStorageSync: key => storage.get(key) || '', setStorageSync: (key, value) => storage.set(key, value), removeStorageSync: key => storage.delete(key) }
  for (const name of ['TouchStart', 'TouchMove', 'TouchEnd', 'TouchCancel', 'Hide', 'Show', 'WindowResize']) {
    wx['on' + name] = cb => { hooks[name] = cb }; wx['off' + name] = cb => { if (hooks[name] === cb) delete hooks[name] }
  }
  const scheduling = { requestFrame: cb => { frames.set(++next, cb); return next }, cancelFrame: id => frames.delete(id) }
  return { wx, info, hooks, frames, storage, canvas, scheduling, canvasCount: () => canvasCount,
    advance(time) { const entry = frames.entries().next().value; assert.ok(entry); frames.delete(entry[0]); entry[1](time) } }
}
test('touch identifiers survive simultaneous touches; cancellation, resize and DPR mapping are correct', () => {
  const h = host(), app = createRuntime(h.wx, { namespace: 'port.test', ...h.scheduling }), events = []
  app.onTouch(e => events.push(e))
  assert.equal(h.canvasCount(), 1); assert.equal(h.canvas.width, 780)
  h.hooks.TouchStart({ changedTouches: [{ identifier: 0, clientX: 100, clientY: 200 }, { identifier: 8, clientX: 300, clientY: 300 }] })
  h.hooks.TouchEnd({ changedTouches: [{ identifier: 8, clientX: 300, clientY: 300 }] })
  h.hooks.TouchMove({ changedTouches: [{ identifier: 0, clientX: 120, clientY: 220 }] })
  assert.deepEqual(app.toLogical(events.at(-1), { x: 20, y: 120, width: 200, height: 200 }, 560, 560), { x: 280, y: 280 })
  h.hooks.WindowResize({}); assert.equal(events.at(-1).type, 'cancel'); assert.equal(events.at(-1).id, 0)
  const count = events.length
  h.hooks.TouchMove({ changedTouches: [{ identifier: 0, clientX: 99, clientY: 99 }] }); assert.equal(events.length, count)
  h.hooks.TouchStart({ changedTouches: [{ identifier: 42, pageX: 1, pageY: 2 }] })
  h.hooks.TouchCancel({ changedTouches: [] }); assert.equal(events.at(-1).id, 42); assert.equal(events.at(-1).type, 'cancel')
  app.dispose(); assert.equal(Object.keys(h.hooks).length, 0)
})
test('hide stops the loop, cancels touches, and show restarts with zero elapsed time; stop remains stopped', () => {
  const h = host(), app = createRuntime(h.wx, { namespace: 'port.test', ...h.scheduling }), dt = [], touch = []
  app.onTouch(e => touch.push(e)); app.start(d => dt.push(d)); app.start(d => dt.push(d))
  assert.equal(h.frames.size, 1); h.advance(100); h.advance(116); assert.deepEqual(dt, [0, 0.016])
  h.hooks.TouchStart({ changedTouches: [{ identifier: 1, clientX: 3, clientY: 4 }] })
  h.hooks.Hide(); assert.equal(h.frames.size, 0); assert.equal(touch.at(-1).type, 'cancel')
  h.hooks.Show(); h.advance(90000); assert.equal(dt.at(-1), 0)
  h.advance(91000); assert.equal(dt.at(-1), 0.05)
  app.stop(); h.hooks.Hide(); h.hooks.Show(); assert.equal(h.frames.size, 0); app.dispose()
})
test('storage preserves falsey values and session writes when persistent storage fails', () => {
  const h = host(), errors = [], app = createRuntime(h.wx, { namespace: 'new.game', ...h.scheduling, onStorageError: e => errors.push(e) })
  assert.equal(app.storage.get('missing', 9), 9)
  for (const value of [false, 0, '', null]) { app.storage.set('key', value); assert.equal(app.storage.get('key', 9), value) }
  h.storage.set('new.game:bad', '{broken'); assert.equal(app.storage.get('bad', 7), 7)
  h.storage.set('new.game:stale', '123')
  h.wx.setStorageSync = () => { throw Error('quota') }; h.wx.removeStorageSync = () => { throw Error('quota') }
  assert.equal(app.storage.set('stale', 456), false); assert.equal(app.storage.get('stale', 0), 456)
  assert.equal(app.storage.remove('stale'), false); assert.equal(app.storage.get('stale', 0), 0)
  assert.ok(errors.length >= 3); app.dispose()
})
test('legacy system info fallback and failed frame callbacks do not leave a runaway loop', () => {
  const h = host(); h.wx.getSystemInfoSync = h.wx.getWindowInfo; delete h.wx.getWindowInfo
  const app = createRuntime(h.wx, { namespace: 'port.test', ...h.scheduling })
  app.start(() => { throw Error('render failure') }); assert.throws(() => h.advance(0), /render failure/)
  assert.equal(h.frames.size, 0); h.hooks.Show(); assert.equal(h.frames.size, 0); app.dispose()
})
test('audit identifies conversion seams without following symlinks, reading credentials or writing files', t => {
  const root = temp(t); writeFileSync(path.join(root, 'index.html'), '<script type="module" src="app.js"></script>')
  writeFileSync(path.join(root, 'app.js'), 'document.getElementById("hud").innerHTML="x"; new AudioContext(); const x="data:image/svg+xml"; canvas.getContext("webgl2");')
  writeFileSync(path.join(root, 'credentials.json'), 'must not read')
  mkdirSync(path.join(root, '.clide')); writeFileSync(path.join(root, '.clide', 'private.json'), '{}')
  symlinkSync(path.join(root, 'app.js'), path.join(root, 'link.js'))
  const report = auditSource(root)
  assert.equal(report.fileCount, 2); assert.equal(report.route, 'preserve-engine-with-platform-and-dom-adapters')
  assert.equal(report.assessment, 'static-review-only'); assert.equal(report.sourceDigest.length, 64)
  assert.ok(report.findings.some(f => f.code === 'dom-layout')); assert.ok(report.findings.some(f => f.code === 'svg-data-image'))
  assert.equal(report.skipped.length, 3); assert.equal(report.entries[0].src, 'app.js')
  assert.deepEqual(report, auditSource(root))
})
test('initializer creates a runnable diagnostic and refuses to overwrite or accept invalid configuration', t => {
  const root = temp(t), directory = path.join(root, 'probe')
  assert.throws(() => initWeapp({ directory, namespace: 'a', orientation: 'sideways' }), /Orientation/); assert.equal(existsSync(directory), false)
  const report = initWeapp({ directory, namespace: 'new.game', title: 'test' })
  assert.equal(report.status, 'diagnostic-starter-not-a-converted-game')
  assert.equal(JSON.parse(readFileSync(path.join(directory, 'project.config.json'))).compileType, 'game')
  assert.throws(() => initWeapp({ directory, namespace: 'b' }), /already exists/)
  const h = host(), context = vm.createContext({ wx: h.wx, require: name => { assert.equal(name, './wx-runtime.js'); return (wx, options) => createRuntime(wx, { ...options, ...h.scheduling }) } })
  new vm.Script(readFileSync(path.join(directory, 'game.js'), 'utf8')).runInContext(context)
  h.advance(100); assert.equal(h.canvasCount(), 1); assert.equal(h.frames.size, 1)
})
test('immutable source check detects edits, deletion and added files', t => {
  const root = temp(t), source = path.join(root, 'source'), baseline = path.join(root, 'baseline.json')
  mkdirSync(source); writeFileSync(path.join(source, 'app.js'), 'original'); writeFileSync(path.join(source, 'style.css'), 'body{}')
  writeFileSync(baseline, JSON.stringify(auditSource(source)))
  const script = fileURLToPath(new URL('../claude-code/paean-convert-to-weapp/scripts/assert-source.mjs', import.meta.url))
  const run = () => spawnSync(process.execPath, [script, source, baseline], { encoding: 'utf8' })
  assert.equal(run().status, 0)
  writeFileSync(path.join(source, 'app.js'), 'changed'); rmSync(path.join(source, 'style.css')); writeFileSync(path.join(source, 'new.js'), 'added')
  const result = run(), report = JSON.parse(result.stdout)
  assert.equal(result.status, 1); assert.deepEqual(report.changed, ['app.js']); assert.deepEqual(report.missing, ['style.css']); assert.deepEqual(report.added, ['new.js'])
})
