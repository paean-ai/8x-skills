#!/usr/bin/env node
/*
 * check-pointer-parity.mjs — is the work playable with a mouse at phone size?
 *
 *   node check-pointer-parity.mjs <dist-dir> [--start x,y] [--control <selector>] [--json]
 *
 * The failure this catches is the one that keeps reaching the market as
 * 「小工具功能缺陷，可能是页面按钮无法点击」:
 *
 *   `@media (pointer: coarse)` / `navigator.maxTouchPoints` answer "is this a touch
 *   device". What the work needs to know is "is the phone layout in use". The two
 *   disagree in exactly the setup reviewers use — a desktop browser narrowed to phone
 *   size — where the phone layout applies (no keyboard legend, assumes a virtual stick)
 *   but the pointer is a mouse, so the stick stays display:none. Nothing is operable.
 *
 * Three independent checks, because they fail for different reasons:
 *
 *   1. PARITY    same viewport, mouse vs touch: which control-like elements vanish
 *                under the mouse. That is the gating bug.
 *   2. BINDING   controls that stay visible but registered only touch* listeners.
 *                Visible and dead under a mouse — same symptom, different cause.
 *   3. RESPONSE  actually drag the control with the mouse and require the screen to
 *                change. Visibility is not usability; this is the only check that
 *                proves a mouse can play.
 *
 * Exit code 0 when every check passes, 1 otherwise.
 */
import path from 'node:path'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

/* The skill lives outside the project, so a bare `import 'playwright'` resolves against
   the skill directory and misses the project's (or the global) install. Search upward
   from the artifact first, then from this script, then fall back to the global root —
   same approach the pipeline uses for esbuild. */
/* playwright ships CJS, so a dynamic import hands it back under `default`. */
const pick = (mod) => (mod && mod.chromium) || (mod && mod.default && mod.default.chromium)

async function loadChromium(fromDir) {
  const tried = []
  const roots = []
  for (let d = path.resolve(fromDir); ; d = path.dirname(d)) {
    roots.push(d)
    if (d === path.dirname(d)) break
  }
  roots.push(path.dirname(new URL(import.meta.url).pathname))
  for (const r of roots) {
    const p = path.join(r, 'node_modules', 'playwright', 'index.js')
    tried.push(p)
    if (existsSync(p)) return pick(await import(pathToFileURL(p).href))
  }
  try {
    const req = createRequire(import.meta.url)
    const { execSync } = await import('node:child_process')
    const g = execSync('npm root -g', { encoding: 'utf8' }).trim()
    const p = path.join(g, 'playwright', 'index.js')
    if (existsSync(p)) return pick(await import(pathToFileURL(p).href))
    void req
  } catch (e) { /* fall through to the error below */ }
  throw new Error(
    'playwright not found. Install it in the project (`npm i -D playwright && npx playwright install chromium`) ' +
    'or globally (`npm i -g playwright`).',
  )
}

const argv = process.argv.slice(2)
const flag = (n, d) => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] ? argv[i + 1] : d }
const DIST = path.resolve(argv[0] || 'dist')
const JSON_OUT = argv.includes('--json')
const CONTROL = flag('--control', '')
const [SX, SY] = flag('--start', '').split(',').map(Number)

if (!existsSync(path.join(DIST, 'index.html'))) {
  console.error(`✗ ${DIST}/index.html not found`)
  process.exit(1)
}

const chromium = await loadChromium(DIST)

/* Element names that plausibly denote an on-screen control. A whole-DOM diff is far too
   noisy: two runs routinely land on different screens and every panel shows as a
   difference. Restricting to control-ish names is what makes the signal usable. */
/* RESPONSE 只对"可拖动的"控件有意义（摇杆/方向盘一类）。它必须和下面那个前置条件
   用同一个正则：早先前置条件用的是宽口径的 CONTROL_RE，只要触摸档里有个菜单按钮就算
   "有控件"，而拖拽目标又只认窄口径，于是探针到不了战斗界面的作品一律被误判为失败。
   两边口径必须一致。 */
const DRAGGABLE_RE = /stick|joy|dpad|d-pad|thumb|pad\b|steer|wheel|move/i

const CONTROL_RE =
  /stick|joy|dpad|d-pad|thumb|pad\b|fire|shoot|btn|button|control|touch|steer|pedal|gas|brake|nitro|jump|action|move|aim|attack|dash/i

/* Record which event types every element registers, so a touch-only control is
   identifiable without guessing from source. */
const SPY = `(()=>{const m=new WeakMap();
  const orig=EventTarget.prototype.addEventListener;
  EventTarget.prototype.addEventListener=function(t,...a){
    try{ if(this instanceof Element){ if(!m.has(this)) m.set(this,new Set()); m.get(this).add(t);} }catch(e){}
    return orig.call(this,t,...a);};
  window.__evTypes=(el)=>{const s=m.get(el);return s?[...s]:[]};})()`

const SNAP = `(()=>{const out=[];
  const walk=(el)=>{ for(const c of el.children){
    const cs=getComputedStyle(c), r=c.getBoundingClientRect();
    /* 不要把 pointer-events:none 算作"不可见"：摇杆外壳普遍是 pointer-events:none，
       真正收事件的是里面的小球。带上这条会把摇杆从两边样本里一起滤掉，
       parity 便永远看不出差异 —— 这是一次真实的漏报。 */
    const vis = cs.display!=='none' && cs.visibility!=='hidden' && +cs.opacity>0.05
             && r.width>8 && r.height>8;
    const cls = (typeof c.className==='string' && c.className.trim())
      ? c.className.trim().split(/\\s+/)[0] : '';
    if (vis && (c.id||cls)) out.push({
      key: c.tagName.toLowerCase()+'#'+(c.id||'')+'.'+cls,
      rect:[Math.round(r.x),Math.round(r.y),Math.round(r.width),Math.round(r.height)],
      types: window.__evTypes(c),
      pe: cs.pointerEvents,
    });
    walk(c);} };
  walk(document.body); return out;})()`

const VIEWPORTS = {
  /* the review setup: phone-size layout driven by a mouse */
  'phone-mouse':   { viewport:{width:393,height:852}, hasTouch:false, isMobile:false },
  'phone-touch':   { viewport:{width:393,height:852}, deviceScaleFactor:2, hasTouch:true, isMobile:true },
  /* the reverse pair: a touchscreen laptop is wide AND touch-capable */
  'desktop-mouse': { viewport:{width:1280,height:800}, hasTouch:false, isMobile:false },
  'hybrid-touch':  { viewport:{width:1280,height:800}, hasTouch:true, isMobile:false },
  /* landscape phone, where a stick often collides with the HUD */
  'land-touch':    { viewport:{width:852,height:393}, deviceScaleFactor:2, hasTouch:true, isMobile:true },
  'land-mouse':    { viewport:{width:852,height:393}, hasTouch:false, isMobile:false },
}

async function open(cfg) {
  const browser = await chromium.launch({
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  })
  const page = await (await browser.newContext(cfg)).newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message.split('\n')[0].slice(0, 90)))
  await page.addInitScript(SPY)
  await page.goto('file://' + path.join(DIST, 'index.html'))
  await page.waitForTimeout(4500)
  return { browser, page, errors }
}

/* Most works open on an attract screen and need one activation before the HUD exists. */
async function activate(page, cfg) {
  const { width, height } = cfg.viewport
  const x = Number.isFinite(SX) ? SX : width / 2
  const y = Number.isFinite(SY) ? SY : height * 0.55
  if (cfg.hasTouch) await page.touchscreen.tap(x, y)
  else await page.mouse.click(x, y)
  await page.waitForTimeout(2500)
}

async function sample(name) {
  const cfg = VIEWPORTS[name]
  const { browser, page, errors } = await open(cfg)
  await activate(page, cfg)
  const items = await page.evaluate(SNAP)
  await browser.close()
  return { items, errors }
}

/* RESPONSE: drag the largest control with the mouse and require the screen to change.
   Screenshots are the only device-agnostic evidence — these works draw on canvas, so a
   DOM diff proves nothing. */
async function responds(controlSel) {
  const cfg = VIEWPORTS['phone-mouse']
  const { browser, page } = await open(cfg)
  await activate(page, cfg)
  const box = await page.evaluate((sel) => {
    let el = sel ? document.querySelector(sel) : null
    if (!el) {
      const re = /stick|joy|dpad|d-pad|thumb|pad\b|steer|wheel|move/i
      let best = null
      for (const c of document.querySelectorAll('*')) {
        const id = (c.id || '') + ' ' + (typeof c.className === 'string' ? c.className : '')
        if (!re.test(id)) continue
        const cs = getComputedStyle(c), r = c.getBoundingClientRect()
        if (cs.display === 'none' || cs.visibility === 'hidden' || r.width < 24 || r.height < 24) continue
        if (!best || r.width * r.height > best.w * best.h)
          best = { x: r.x, y: r.y, w: r.width, h: r.height }
      }
      return best
    }
    const r = el.getBoundingClientRect()
    const cs = getComputedStyle(el)
    if (cs.display === 'none' || r.width < 8) return null
    return { x: r.x, y: r.y, w: r.width, h: r.height }
  }, CONTROL)

  if (!box) { await browser.close(); return { skipped: true } }

  const before = (await page.screenshot()).toString('base64')
  await page.waitForTimeout(700)
  const idle = (await page.screenshot()).toString('base64')
  const cx = box.x + box.w / 2, cy = box.y + box.h / 2
  await page.mouse.move(cx, cy)
  await page.mouse.down()
  for (let i = 1; i <= 8; i++) { await page.mouse.move(cx + i * 4, cy - i * 3); await page.waitForTimeout(40) }
  await page.waitForTimeout(500)
  const dragged = (await page.screenshot()).toString('base64')
  await page.mouse.up()
  await browser.close()
  /* An animated attract loop changes on its own, so "changed" only counts when the drag
     produced something the idle interval did not. */
  return { skipped: false, animated: before !== idle, changed: dragged !== idle, box }
}

const out = { dist: DIST, checks: {}, ok: true }
const fail = (k, detail) => { out.ok = false; out.checks[k] = detail }

/* Only the phone-sized layouts are a failure when a control vanishes under the mouse:
   that layout has no keyboard legend, so the mouse user is left with nothing. At desktop
   width a mouse user still has the keyboard legend and crosshair, so hiding the stick
   there is correct — that pair is reported for information only. */
const pairs = [['phone-mouse', 'phone-touch'], ['land-mouse', 'land-touch']]
const infoPairs = [['desktop-mouse', 'hybrid-touch']]
const samples = {}
for (const name of Object.keys(VIEWPORTS)) samples[name] = await sample(name)

/* 1. PARITY */
const parity = []
for (const [mouseName, touchName] of pairs) {
  const mKeys = new Set(samples[mouseName].items.map((i) => i.key))
  const lost = samples[touchName].items
    .filter((i) => !mKeys.has(i.key) && CONTROL_RE.test(i.key))
    .map((i) => i.key)
  if (lost.length) parity.push({ pair: `${mouseName} vs ${touchName}`, lost })
}
if (parity.length) fail('parity', parity)
else out.checks.parity = 'ok'

const info = []
for (const [mouseName, touchName] of infoPairs) {
  const mKeys = new Set(samples[mouseName].items.map((i) => i.key))
  const lost = samples[touchName].items
    .filter((i) => !mKeys.has(i.key) && CONTROL_RE.test(i.key))
    .map((i) => i.key)
  if (lost.length) info.push({ pair: `${mouseName} vs ${touchName}`, lost })
}
if (info.length) out.checks.desktopInfo = info

/* 2. BINDING */
const touchOnly = []
for (const name of Object.keys(VIEWPORTS)) {
  for (const i of samples[name].items) {
    if (!CONTROL_RE.test(i.key)) continue
    const t = i.types || []
    if (t.some((v) => /^touch/.test(v)) && !t.some((v) => /^(pointer|mouse|click)/.test(v)))
      touchOnly.push(`${name}: ${i.key} [${t.join(',')}]`)
  }
}
if (touchOnly.length) fail('binding', [...new Set(touchOnly)])
else out.checks.binding = 'ok'

/* 3. RESPONSE */
const r = await responds(CONTROL)
const touchHadControls = samples['phone-touch'].items.some((i) => DRAGGABLE_RE.test(i.key))
if (r.skipped && touchHadControls)
  fail('response', '手机尺寸下鼠标档找不到任何可拖动控件，而触摸档有 —— 控件被指针类型挡掉了')
else if (r.skipped)
  out.checks.response =
    'skipped (no draggable control on the screen the probe reached — if this work has a stick ' +
    'behind a menu, pass --start x,y so the probe reaches gameplay)'
else if (!r.changed) fail('response', 'dragging the control with the mouse changed nothing on screen')
else out.checks.response = `ok (control at ${r.box.w.toFixed(0)}x${r.box.h.toFixed(0)})`

const errs = Object.entries(samples).flatMap(([n, s]) => s.errors.map((e) => `${n}: ${e}`))
if (errs.length) out.checks.pageerror = [...new Set(errs)]

if (JSON_OUT) {
  console.log(JSON.stringify(out, null, 2))
} else {
  console.log(`${out.ok ? '✓' : '✗'} pointer/touch parity — ${path.basename(path.dirname(DIST))}`)
  if (out.checks.parity !== 'ok')
    for (const p of out.checks.parity) console.log(`   ✗ 门控：${p.pair} 下消失的控件 → ${p.lost.join(' ')}`)
  if (out.checks.binding !== 'ok')
    for (const b of out.checks.binding) console.log(`   ✗ 只绑 touch：${b}`)
  if (typeof out.checks.response === 'string' && out.checks.response.startsWith('ok'))
    console.log(`   ✓ 鼠标拖动控件有反应 ${out.checks.response.slice(3)}`)
  else if (out.checks.response && !String(out.checks.response).startsWith('skipped'))
    console.log(`   ✗ 反应：${out.checks.response}`)
  else if (out.checks.response) console.log(`   · ${out.checks.response}`)
  if (out.checks.desktopInfo)
    for (const p of out.checks.desktopInfo)
      console.log(`   · 参考：${p.pair} 下 ${p.lost.join(' ')} 不显示（桌面宽度有键盘位，通常是对的）`)
  if (out.checks.pageerror) for (const e of out.checks.pageerror) console.log(`   ! ${e}`)
}
process.exit(out.ok ? 0 : 1)
