/*
 * The recorder's browser half needs Playwright and 25 real seconds, so these
 * cover the parts that decide whether the resulting video is right: the
 * duration band, the beat timeline, the viewport-equals-video rule that keeps
 * Playwright from padding the frame with grey, the ffmpeg argument shapes, and
 * the global-module lookup that makes a global Playwright install usable.
 */
import assert from 'node:assert/strict'
import path from 'node:path'
import test from 'node:test'

const repoRoot = path.resolve(import.meta.dirname, '..')
// One canonical copy; sync-variants keeps the other variants byte-identical.
const skill = path.join(repoRoot, 'codex/paean-record-demo/scripts')
const { normaliseConfig, recordingSize, usesTouch, globalModuleRoots, DEFAULTS } = await import(path.join(skill, 'record-demo.mjs'))
const { mp4Args, gifArgs, posterArgs } = await import(path.join(skill, 'encode.mjs'))

const base = { title: { text: 'T' }, end: { text: 'T' }, enter: 'true' }

test('the default clip sits in the 20-30s band with no warnings', () => {
  const { cfg, warnings } = normaliseConfig(base)
  assert.equal(cfg.seconds, 25)
  assert.ok(cfg.seconds >= 20 && cfg.seconds <= 30)
  assert.deepEqual(warnings, [], warnings.join('; '))
})

test('a clip outside the band is warned about but still honoured', () => {
  for (const seconds of [6, 90]) {
    const { cfg, warnings } = normaliseConfig({ ...base, seconds })
    assert.equal(cfg.seconds, seconds, 'the value is honoured, not clamped')
    assert.ok(warnings.some(w => w.includes('20–30')), `expected a band warning for ${seconds}s`)
  }
})

test('chrome that crowds out the gameplay is reported', () => {
  const { warnings } = normaliseConfig({ ...base, seconds: 20, titleSeconds: 6, endSeconds: 6 })
  assert.ok(warnings.some(w => w.includes('trailer, not a gameplay demo')), warnings.join('; '))
})

test('beats hidden under the title or end card are reported', () => {
  const { cfg, warnings } = normaliseConfig({
    ...base,
    seconds: 25, titleSeconds: 2.4, endSeconds: 3.2,
    beats: [{ at: 1, text: 'too early' }, { at: 12, text: 'fine' }, { at: 23, text: 'too late' }],
  })
  assert.equal(cfg.endAt, 21.8)
  assert.ok(warnings.some(w => w.includes('too early') && w.includes('title card')))
  assert.ok(warnings.some(w => w.includes('too late') && w.includes('end card')))
  assert.ok(!warnings.some(w => w.includes('"fine"')), 'a beat inside the play window must not warn')
})

test('a bare string beat is accepted and defaulted', () => {
  const { cfg } = normaliseConfig({ ...base, titleSeconds: 0, beats: ['just text'] })
  assert.deepEqual(cfg.beats[0], { at: 0, hold: 3, text: 'just text', accent: undefined, _i: 0 })
})

test('invalid durations and viewports are rejected outright', () => {
  assert.throws(() => normaliseConfig({ ...base, seconds: 0 }), /positive number/)
  assert.throws(() => normaliseConfig({ ...base, seconds: 'soon' }), /positive number/)
  assert.throws(() => normaliseConfig({ ...base, viewport: { width: 12 } }), /viewport\.width/)
  assert.throws(() => normaliseConfig({ ...base, viewport: { height: 9001 } }), /viewport\.height/)
})

/*
 * The one that actually ruins a video: Playwright does not scale the page up to
 * `recordVideo.size`, it pads. A 390x844 viewport recorded at 1170x2532 puts
 * the page in the top-left and fills ~85% of every frame with flat grey, so the
 * size is always derived from the viewport and never read from config.
 */
test('the recorded size is always exactly the viewport', () => {
  for (const viewport of [{ width: 430, height: 932 }, { width: 1280, height: 720 }]) {
    assert.deepEqual(recordingSize(viewport), viewport)
  }
  const { cfg } = normaliseConfig({ ...base, viewport: { width: 390, height: 844 }, size: { width: 1170, height: 2532 } })
  assert.deepEqual(recordingSize(cfg.viewport), { width: 390, height: 844 })
})

test('command-line overrides beat the config file', () => {
  const { cfg } = normaliseConfig(
    { ...base, seconds: 25, viewport: { width: 430, height: 932 } },
    { seconds: 28, viewport: { width: 540 } })
  assert.equal(cfg.seconds, 28)
  assert.equal(cfg.viewport.width, 540)
  assert.equal(cfg.viewport.height, 932, 'an unspecified axis keeps the config value')
})

test('mp4 args seek before -i, force even dimensions and drop audio by default', () => {
  const args = mp4Args({ input: 'in.webm', output: 'out.mp4', start: 0.9, duration: 25 })
  const i = args.indexOf('-i')
  assert.ok(args.indexOf('-ss') < i, '-ss must precede -i so the seek applies to the input')
  assert.deepEqual(args.slice(args.indexOf('-ss'), i), ['-ss', '0.900'])
  assert.ok(args.includes('-an'), 'no audio unless a track was supplied')
  const vf = args[args.indexOf('-vf') + 1]
  assert.match(vf, /trunc\(iw\/2\)\*2:trunc\(ih\/2\)\*2/, 'h264 yuv420p needs even dimensions')
  assert.match(vf, /fps=30/)
  assert.deepEqual(args.slice(args.indexOf('-t'), args.indexOf('-t') + 2), ['-t', '25.000'])
  assert.equal(args.at(-1), 'out.mp4')
  assert.ok(args.includes('+faststart'))
})

test('supplied music is encoded, length-matched and faded out', () => {
  const args = mp4Args({ input: 'in.webm', output: 'out.mp4', start: 0, duration: 25, audio: 'track.mp3' })
  assert.ok(!args.includes('-an'))
  assert.ok(args.includes('track.mp3'))
  assert.ok(args.includes('-shortest'), 'music longer than the clip must not extend it')
  assert.match(args[args.indexOf('-af') + 1], /afade=t=out:st=24\.000:d=1/)
})

test('a scale is applied before the even-dimension guard', () => {
  const vf = mp4Args({ input: 'i', output: 'o', duration: 25, scale: '1080:-2' })[
    mp4Args({ input: 'i', output: 'o', duration: 25, scale: '1080:-2' }).indexOf('-vf') + 1]
  assert.ok(vf.indexOf('scale=1080:-2') < vf.indexOf('trunc(iw/2)'), 'the guard must see the scaled size')
})

test('gif args use a two-pass palette rather than the default web palette', () => {
  const vf = gifArgs({ input: 'i.webm', output: 'o.gif', duration: 6 })[
    gifArgs({ input: 'i.webm', output: 'o.gif', duration: 6 }).indexOf('-vf') + 1]
  assert.match(vf, /palettegen/)
  assert.match(vf, /paletteuse/)
  assert.match(vf, /flags=lanczos/)
})

test('poster args grab exactly one frame', () => {
  const args = posterArgs({ input: 'i.webm', output: 'p.jpg', at: 8.5 })
  assert.deepEqual(args.slice(args.indexOf('-ss'), args.indexOf('-ss') + 2), ['-ss', '8.500'])
  assert.deepEqual(args.slice(args.indexOf('-frames:v'), args.indexOf('-frames:v') + 2), ['-frames:v', '1'])
})

/*
 * A global `npm i -g playwright` is not reachable by bare specifier, and the
 * global root sits in a different place on Windows (beside node.exe) than on
 * POSIX (<prefix>/lib/node_modules), so both layouts have to be probed.
 */
test('global module lookup covers the POSIX and Windows layouts', () => {
  const posix = globalModuleRoots('/usr/local/bin/node')
  assert.ok(posix.some(p => p.endsWith(path.join('local', 'lib', 'node_modules'))), posix.join(', '))
  const windows = globalModuleRoots(path.join(path.sep, 'nodejs', 'node.exe'))
  assert.ok(windows.some(p => p === path.resolve(path.sep, 'nodejs', 'node_modules')), windows.join(', '))
  assert.equal(new Set(posix).size, posix.length, 'candidates must be distinct')
})

/*
 * `page.mouse.click` fires pointerdown and click but never touchstart, even in
 * a hasTouch context (measured). A phone game bound to touchstart alone would
 * therefore record as untouched, so the viewport decides the event family.
 */
test('touch input is chosen for phone-shaped viewports and overridable', () => {
  const touchFor = (raw) => usesTouch(normaliseConfig({ ...base, ...raw }).cfg)
  assert.equal(touchFor({ viewport: { width: 430, height: 932 } }), true)
  assert.equal(touchFor({ viewport: { width: 1280, height: 720 } }), false)
  assert.equal(touchFor({ viewport: { width: 430, height: 932 }, touch: false }), false, 'an explicit false wins')
  assert.equal(touchFor({ viewport: { width: 1280, height: 720 }, touch: true }), true, 'an explicit true wins')
})

test('the defaults are the documented ones', () => {
  assert.equal(DEFAULTS.seconds, 25)
  assert.equal(DEFAULTS.viewport.width, 430)
  assert.equal(DEFAULTS.viewport.height, 932)
})
