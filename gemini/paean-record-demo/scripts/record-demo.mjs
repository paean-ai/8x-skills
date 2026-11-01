#!/usr/bin/env node
/*
 * record-demo.mjs — record a 20–30 s arcade attract demo from a finished work.
 *
 *   node record-demo.mjs [--config demo.config.json] [--seconds 25] [--probe]
 *
 * Serves the game over loopback, drives it into its demo state through the
 * seam the author exposed, draws a promo layer over the top, and records the
 * result. **The game's source is never edited** — the overlay is injected, the
 * entry is evaluated, and everything happens in a throwaway browser profile.
 *
 * Playwright is the only hard dependency, and only for the capture itself:
 * ffmpeg is detected, not required, and the WebM master is written either way.
 *
 * Cross-platform notes, since the obvious ways to write this are not:
 *   - Playwright resolves from the project, then upward, then the global npm
 *     root under both the POSIX (lib/node_modules) and Windows (node_modules
 *     beside node.exe) layouts. A global `npm i -g playwright` is not
 *     importable by specifier, so the path has to be found by hand.
 *   - The static server rejects anything that resolves outside the game
 *     directory using `path.sep`, so the check holds under both separators.
 *   - ffmpeg is spawned with an argument array and no shell, so a project path
 *     containing spaces needs no quoting and behaves the same on Windows.
 */
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { existsSync, mkdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { detectFfmpeg, encodeDeliverables, probeDuration } from './encode.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REF = path.join(HERE, '..', 'reference')

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.avif': 'image/avif', '.gif': 'image/gif', '.ico': 'image/x-icon',
  '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.m4a': 'audio/mp4',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.otf': 'font/otf',
  '.wasm': 'application/wasm', '.glb': 'model/gltf-binary',
}

// 25 s sits in the middle of the 20–30 s band the production standard asks for:
// long enough to establish a loop and land a second beat, short enough that a
// stranger watches to the end card.
export const DEFAULTS = {
  seconds: 25,
  viewport: { width: 430, height: 932 },
  titleSeconds: 2.4,
  endSeconds: 3.2,
  fadeMs: 420,
  fps: 30,
  crf: 20,
  beatPosition: 'bottom',
  theme: { background: '#0b1020', accent: '#6ee7ff', accentInk: '#04121b' },
}

/* ------------------------------------------------------------------ config */

/**
 * Merge a config with the defaults and validate the parts that produce a
 * silently wrong video rather than an error — the duration band above all.
 * Pure, so the rules are testable without a browser.
 */
export function normaliseConfig(raw = {}, overrides = {}) {
  const cfg = {
    ...DEFAULTS, ...raw, ...overrides,
    theme: { ...DEFAULTS.theme, ...(raw.theme || {}) },
    viewport: { ...DEFAULTS.viewport, ...(raw.viewport || {}), ...(overrides.viewport || {}) },
  }
  cfg.seconds = Number(cfg.seconds)
  if (!Number.isFinite(cfg.seconds) || cfg.seconds <= 0) throw new Error('seconds must be a positive number')

  const warnings = []
  /* The band is the point of the skill, so a value outside it is reported
     rather than quietly honoured — but it is still honoured, because a GIF-
     length teaser or a two-minute walkthrough are both legitimate asks. */
  if (cfg.seconds < 20 || cfg.seconds > 30) {
    warnings.push(`seconds=${cfg.seconds} is outside the 20–30 s band the production standard asks for`)
  }
  const chrome = cfg.titleSeconds + cfg.endSeconds
  if (chrome >= cfg.seconds * 0.5) {
    warnings.push(`title (${cfg.titleSeconds}s) + end card (${cfg.endSeconds}s) is ${chrome}s of a ${cfg.seconds}s clip — that is a trailer, not a gameplay demo`)
  }
  for (const axis of ['width', 'height']) {
    const v = cfg.viewport[axis]
    if (!Number.isInteger(v) || v < 160 || v > 3840) throw new Error(`viewport.${axis} must be an integer between 160 and 3840`)
  }

  // A bare string is shorthand for `{ at: 0, text }`; both spellings must
  // normalise to the same shape, since the overlay reads them positionally.
  cfg.beats = (cfg.beats || []).map((b, i) => {
    const beat = typeof b === 'string' ? { text: b } : b
    return { at: Number(beat.at) || 0, hold: beat.hold == null ? 3 : Number(beat.hold), text: beat.text, accent: beat.accent, _i: i }
  })
  // Play window = everything that is not the title card or the end card.
  const playFrom = cfg.titleSeconds
  const playTo = cfg.seconds - cfg.endSeconds
  for (const b of cfg.beats) {
    if (b.at < playFrom) warnings.push(`beat "${b.text}" at ${b.at}s is under the title card (visible from ${playFrom}s)`)
    if (b.at >= playTo) warnings.push(`beat "${b.text}" at ${b.at}s is under the end card (from ${playTo}s)`)
  }
  cfg.endAt = playTo
  return { cfg, warnings }
}

/**
 * The recorded frame is exactly the viewport. Playwright's `recordVideo.size`
 * does **not** scale the page up to fill it: a 390x844 viewport recorded at
 * 1170x2532 puts the page in the top-left corner and fills the remaining ~85%
 * of every frame with flat grey. So the size is always derived here, never
 * taken from config, and resolution is chosen by choosing a viewport.
 */
export function recordingSize(viewport) {
  return { width: viewport.width, height: viewport.height }
}

/**
 * Whether to emulate touch — which decides both the layout the game chooses and
 * the event family the input track dispatches. Phone-shaped captures default to
 * touch; `touch: true|false` overrides when the heuristic guesses wrong.
 */
export function usesTouch(cfg) {
  return cfg.touch == null ? cfg.viewport.width < 900 : !!cfg.touch
}

/* ------------------------------------------------- dependency resolution */

/** Candidate global npm roots, covering both the POSIX and Windows layouts. */
export function globalModuleRoots(execPath = process.execPath) {
  const bin = path.dirname(execPath)
  return [
    path.join(bin, '..', 'lib', 'node_modules'), // POSIX: <prefix>/bin/node
    path.join(bin, 'node_modules'),              // Windows: <prefix>\node.exe
    path.join(bin, '..', 'node_modules'),
  ].map(p => path.resolve(p))
}

async function loadPlaywright(projectRoot) {
  const tried = []
  // Walk up from the project: a local devDependency wins over a global one.
  for (let dir = path.resolve(projectRoot); ;) {
    const candidate = path.join(dir, 'node_modules', 'playwright')
    if (existsSync(candidate)) {
      tried.push(candidate)
      try { return createRequire(path.join(dir, 'package.json'))('playwright') } catch { /* keep looking */ }
    }
    const up = path.dirname(dir)
    if (up === dir) break
    dir = up
  }
  for (const root of globalModuleRoots()) {
    const candidate = path.join(root, 'playwright')
    if (!existsSync(candidate)) continue
    tried.push(candidate)
    try { return createRequire(path.join(root, 'anchor.js'))('playwright') } catch { /* keep looking */ }
  }
  try { return (await import('playwright')).default ?? await import('playwright') } catch { /* fall through */ }
  throw new Error(
    'Playwright is required to record a demo but was not found.\n' +
    '  install it next to the game:  npm i -D playwright && npx playwright install chromium\n' +
    '  or globally:                  npm i -g playwright && npx playwright install chromium' +
    (tried.length ? '\n  (found but could not load: ' + tried.join(', ') + ')' : ''))
}

/* ------------------------------------------------------------- static host */

async function startServer(root) {
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? '/', 'http://127.0.0.1')
      let pathname = decodeURIComponent(url.pathname)
      if (pathname.endsWith('/')) pathname += 'index.html'
      const file = path.resolve(root, '.' + pathname)
      // `path.sep`, so the containment check holds on Windows too.
      if (file !== root && !file.startsWith(root + path.sep)) throw new Error('outside root')
      const body = await readFile(file)
      response.writeHead(200, {
        'content-type': MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream',
        'cache-control': 'no-store',
      })
      response.end(body)
    } catch {
      response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
      response.end('Not found')
    }
  })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  return server
}

/* ------------------------------------------------------------------ probe */

/*
 * What a demo needs is a way to start real play on command. Rather than make
 * the author guess which of the documented seams their work exposes, look.
 */
const PROBE = `(() => {
  const seen = Object.keys(window).filter(k => /^__/.test(k) && k !== '__PAEAN_DEMO__' && k !== '__PAEAN_DEMO_READY__')
  const shape = (v) => {
    if (v == null) return String(v)
    if (typeof v === 'function') return 'function'
    if (typeof v !== 'object') return typeof v
    return '{ ' + Object.keys(v).slice(0, 24).join(', ') + ' }'
  }
  return {
    handles: seen.map(k => ({ name: 'window.' + k, shape: shape(window[k]) })),
    likelyStart: seen.flatMap(k => {
      const v = window[k]
      if (!v || typeof v !== 'object') return []
      return Object.keys(v).filter(n => /^(start|begin|enter|play|new|restart|launch)/i.test(n))
        .map(n => 'window.' + k + '.' + n + '()')
    }),
    canvases: [...document.querySelectorAll('canvas')].map(c => c.width + 'x' + c.height),
    clickable: [...document.querySelectorAll('[data-act],button,[role="button"]')]
      .slice(0, 12).map(e => (e.tagName.toLowerCase() + (e.dataset.act ? '[data-act=' + e.dataset.act + ']' : '') + ' "' + (e.textContent || '').trim().slice(0, 24) + '"')),
    title: document.title,
  }
})()`

/* ----------------------------------------------------------- input track */

/*
 * Touch, when the context emulates it — and it is not optional.
 *
 * `page.mouse.click` in a `hasTouch` context fires pointerdown and click but
 * **not touchstart** (measured: pointerdown 2, touchstart 0 after two clicks).
 * A phone game that binds only `touchstart` therefore receives nothing at all
 * from a mouse-driven track, and the recording is 25 s of an untouched demo
 * that still looks plausible. So taps and swipes go through the touch
 * protocol, and the mouse is the desktop-viewport fallback.
 *
 * Swipes need CDP directly: Playwright's touchscreen exposes `tap` only, and a
 * flick is the one gesture a game is most likely to read by velocity.
 */
async function touchSequence(cdp, type, points) {
  await cdp.send('Input.dispatchTouchEvent', {
    type,
    touchPoints: points.map(([x, y], id) => ({ x, y, id })),
  })
}

async function playInput(page, track, startedAt, touch) {
  const cdp = touch ? await page.context().newCDPSession(page) : null
  try {
    for (const step of track) {
      const due = startedAt + (Number(step.at) || 0) * 1000
      const wait = due - Date.now()
      if (wait > 0) await page.waitForTimeout(wait)
      try {
        if (step.tap) {
          const [x, y] = step.tap
          if (touch) {
            await touchSequence(cdp, 'touchStart', [[x, y]])
            await page.waitForTimeout(step.holdMs || 60)
            await touchSequence(cdp, 'touchEnd', [])
          } else {
            await page.mouse.click(x, y, { delay: step.holdMs || 40 })
          }
        } else if (step.key) {
          await page.keyboard.press(step.key)
        } else if (step.swipe) {
          const [x1, y1, x2, y2] = step.swipe
          // Interpolated: a single move reads as a teleport to any game that
          // tracks pointer velocity for a flick or a drag.
          const steps = step.steps || 12
          const dt = (step.ms || 240) / steps
          const at = i => [x1 + (x2 - x1) * (i / steps), y1 + (y2 - y1) * (i / steps)]
          if (touch) {
            await touchSequence(cdp, 'touchStart', [[x1, y1]])
            for (let i = 1; i <= steps; i++) {
              await touchSequence(cdp, 'touchMove', [at(i)])
              await page.waitForTimeout(dt)
            }
            await touchSequence(cdp, 'touchEnd', [])
          } else {
            await page.mouse.move(x1, y1)
            await page.mouse.down()
            for (let i = 1; i <= steps; i++) {
              await page.mouse.move(...at(i))
              await page.waitForTimeout(dt)
            }
            await page.mouse.up()
          }
        } else if (step.eval) {
          await page.evaluate(step.eval)
        }
      } catch (err) {
        // One bad step must not abandon a recording that is already 15 s in.
        console.warn(`  ! input step at ${step.at}s failed: ${err.message.split('\n')[0]}`)
      }
    }
  } finally {
    if (cdp) await cdp.detach().catch(() => {})
  }
}

/* ------------------------------------------------------------------- main */

function parseArgs(argv) {
  const flag = (n, d) => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] ? argv[i + 1] : d }
  return {
    config: flag('--config', 'demo.config.json'),
    dir: flag('--dir', null),
    out: flag('--out', null),
    seconds: argv.includes('--seconds') ? Number(flag('--seconds')) : null,
    width: argv.includes('--width') ? Number(flag('--width')) : null,
    height: argv.includes('--height') ? Number(flag('--height')) : null,
    probe: argv.includes('--probe'),
    headed: argv.includes('--headed'),
    keepRaw: argv.includes('--keep-raw'),
    noEncode: argv.includes('--no-encode'),
    help: argv.includes('--help') || argv.includes('-h'),
  }
}

const USAGE = `Usage: node record-demo.mjs [options]

  --config <file>   config to read (default: demo.config.json)
  --dir <dir>       game directory, overriding the config's "source"
  --out <dir>       output directory (default: the config's "outDir" or "demo")
  --seconds <n>     clip length; the production standard asks for 20–30
  --width/--height  capture viewport; the video is exactly this size
  --probe           report the seams the game exposes, then exit
  --headed          show the browser (for debugging a demo that will not start)
  --keep-raw        keep the untrimmed WebM master next to the deliverables
  --no-encode       skip ffmpeg entirely; write only the raw WebM`

async function main() {
  const argv = process.argv.slice(2)
  const args = parseArgs(argv)
  if (args.help) { console.log(USAGE); return 0 }

  const configPath = path.resolve(args.config)
  let raw = {}
  if (existsSync(configPath)) raw = JSON.parse(readFileSync(configPath, 'utf8'))
  else if (!args.dir) {
    console.error(`✗ config not found: ${configPath}\n  pass --dir <game directory> to record without one, or see the skill's SKILL.md`)
    return 1
  }

  const projectRoot = existsSync(configPath) ? path.dirname(configPath) : process.cwd()
  const source = path.resolve(projectRoot, args.dir || raw.source || '.')
  if (!existsSync(path.join(source, 'index.html'))) {
    console.error(`✗ no index.html in ${source}`)
    return 1
  }

  const overrides = {}
  if (args.seconds != null) overrides.seconds = args.seconds
  if (args.width || args.height) {
    overrides.viewport = {}
    if (args.width) overrides.viewport.width = args.width
    if (args.height) overrides.viewport.height = args.height
  }
  const { cfg, warnings } = normaliseConfig(raw, overrides)
  for (const w of warnings) console.warn(`  ⚠ ${w}`)

  const outDir = path.resolve(projectRoot, args.out || raw.outDir || 'demo')
  const name = raw.name || path.basename(source) || 'demo'
  const size = recordingSize(cfg.viewport)

  const playwright = await loadPlaywright(source)
  const server = await startServer(source)
  const origin = `http://127.0.0.1:${server.address().port}`
  const rawDir = path.join(outDir, '.raw')
  rmSync(rawDir, { recursive: true, force: true })
  mkdirSync(rawDir, { recursive: true })

  let browser
  let result = 0
  try {
    browser = await playwright.chromium.launch({ headless: !args.headed })
    // The recorder needs the game's own layout decisions, so it presents as a
    // touch device when the capture is phone-shaped — and the input track has
    // to dispatch the matching event family, not merely a mouse click.
    const touchEmulated = usesTouch(cfg)
    const context = await browser.newContext({
      viewport: cfg.viewport,
      hasTouch: touchEmulated,
      isMobile: touchEmulated,
      deviceScaleFactor: 1,
      reducedMotion: 'no-preference',
      locale: cfg.locale || 'en-US',
      recordVideo: args.probe ? undefined : { dir: rawDir, size },
    })
    // Recording begins with the context, so this is the clip's true zero.
    const tContext = Date.now()
    const page = await context.newPage()

    const errors = []
    page.on('pageerror', e => errors.push(e.message.split('\n')[0]))
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text().slice(0, 160)) })

    if (!args.probe) {
      const overlayCss = readFileSync(path.join(REF, 'demo-overlay.css'), 'utf8')
      const overlayJs = readFileSync(path.join(REF, 'demo-overlay.js'), 'utf8')
      await page.addInitScript({
        content: `window.__PAEAN_DEMO__ = ${JSON.stringify({
          css: overlayCss,
          theme: cfg.theme,
          fadeMs: cfg.fadeMs,
          titleSeconds: cfg.titleSeconds,
          beatPosition: cfg.beatPosition,
          title: cfg.title || null,
          end: cfg.end || null,
          mark: cfg.mark || null,
          beats: cfg.beats,
          endAt: cfg.endAt,
        })};\n${overlayJs}`,
      })
    }

    await page.goto(origin + '/', { waitUntil: 'load' })

    if (args.probe) {
      await page.waitForTimeout(Number(cfg.readyMs) || 1500)
      const found = await page.evaluate(PROBE)
      console.log(JSON.stringify({ title: found.title, ...found }, null, 2))
      return 0
    }

    // Wait for the game to be ready before lifting the cover. A fixed delay
    // would open the clip on a loading screen on any machine slower than the
    // one the config was tuned on.
    if (cfg.waitFor) {
      if (typeof cfg.waitFor === 'string' && /^[.#\[a-zA-Z]/.test(cfg.waitFor) && !cfg.waitFor.includes('(')) {
        await page.waitForSelector(cfg.waitFor, { timeout: 30000 })
      } else {
        await page.waitForFunction(cfg.waitFor, { timeout: 30000 })
      }
    } else {
      await page.waitForTimeout(Number(cfg.readyMs) || 1500)
    }

    if (cfg.enter) {
      const started = await page.evaluate(cfg.enter)
      if (started === false) throw new Error('the "enter" expression returned false — the demo did not start')
    }

    const tReveal = Date.now()
    await page.evaluate(({ beats, endAt }) => window.__paeanDemoStart({ beats, endAt }), { beats: cfg.beats, endAt: cfg.endAt })

    /* Everything before this point — navigation, boot, the entry call — is in
       the clip but not in the demo, so the trim starts here. The cover means
       that head is a flat theme-coloured card rather than a loading screen,
       which is why an approximate offset is good enough. */
    const leadIn = (tReveal - tContext) / 1000

    const inputTrack = cfg.input || []
    const inputDone = inputTrack.length ? playInput(page, inputTrack, tReveal, touchEmulated) : Promise.resolve()

    /* A recorder that cannot tell gameplay from a stuck title screen is worse
       than no recorder: it produces a plausible-looking file of nothing. Three
       screenshots across the play window, compared as bytes. */
    const motion = []
    const sampleAt = [cfg.titleSeconds + 0.6, cfg.seconds * 0.5, cfg.endAt - 0.8]
      .filter(t => t > 0 && t < cfg.seconds)
    for (const at of sampleAt) {
      const wait = tReveal + at * 1000 - Date.now()
      if (wait > 0) await page.waitForTimeout(wait)
      motion.push(await page.screenshot({ type: 'jpeg', quality: 40 }))
    }

    const remaining = tReveal + cfg.seconds * 1000 - Date.now()
    if (remaining > 0) await page.waitForTimeout(remaining)
    await inputDone
    await page.evaluate(() => window.__paeanDemoStop && window.__paeanDemoStop())

    const still = motion.length > 1 && motion.every(b => b.equals(motion[0]))

    const video = page.video()
    await page.close()
    await context.close()
    const master = path.join(outDir, `${name}-demo.webm`)
    mkdirSync(outDir, { recursive: true })
    await video.saveAs(master)

    const tools = args.noEncode ? null : await detectFfmpeg()
    const total = tools ? await probeDuration(master, tools.ffprobe) : null

    console.log(`\nrecorded ${name}`)
    console.log(`  source     ${path.relative(projectRoot, source) || '.'}`)
    console.log(`  viewport   ${size.width}x${size.height}  (the video is exactly this)`)
    console.log(`  demo       ${cfg.seconds}s — ${cfg.titleSeconds}s title, ${(cfg.endAt - cfg.titleSeconds).toFixed(1)}s play, ${cfg.endSeconds}s end card`)
    console.log(`  lead-in    ${leadIn.toFixed(2)}s of boot trimmed${total ? ` from a ${total.toFixed(2)}s master` : ''}`)
    console.log(`  master     ${path.relative(projectRoot, master)}  (${(statSync(master).size / 1048576).toFixed(2)} MiB)`)

    if (tools) {
      const written = await encodeDeliverables({
        tools, source: master, outBase: path.join(outDir, `${name}-demo`),
        start: leadIn, duration: cfg.seconds,
        fps: cfg.fps, crf: cfg.crf, scale: cfg.scale || null,
        audio: cfg.music ? path.resolve(projectRoot, cfg.music) : null,
        gif: cfg.gif || false,
      })
      for (const w of written) {
        console.log(`  ${w.kind.padEnd(10)} ${path.relative(projectRoot, w.file)}  (${(statSync(w.file).size / 1048576).toFixed(2)} MiB)`)
      }
      if (!args.keepRaw) rmSync(master, { force: true })
    } else if (!args.noEncode) {
      console.log(`\n  ⓘ ffmpeg not on PATH — wrote the WebM master only.`)
      console.log(`    Install it for a trimmed MP4, a poster frame and an optional GIF:`)
      console.log(`      macOS  brew install ffmpeg`)
      console.log(`      Windows  winget install Gyan.FFmpeg`)
      console.log(`    The master's first ${leadIn.toFixed(2)}s are the boot cover; trim from there.`)
    }

    if (still) {
      console.log(`\n  ✗ every sampled frame is identical — the clip is a static screen, not gameplay.`)
      console.log(`    Check "enter" actually starts a session (run with --probe, then --headed).`)
      result = 1
    }
    if (errors.length) {
      console.log(`\n  ⚠ ${errors.length} console/page error(s) during the demo:`)
      for (const e of [...new Set(errors)].slice(0, 6)) console.log(`     ${e}`)
    }
  } finally {
    if (browser) await browser.close().catch(() => {})
    server.close()
    rmSync(rawDir, { recursive: true, force: true })
  }
  return result
}

if (path.resolve(process.argv[1] || '') === fileURLToPath(import.meta.url)) {
  process.exitCode = await main()
}
