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
import fs from 'node:fs'
import { existsSync } from 'node:fs'

/** 递归列出 dist 下的文件（静态扫描用）。 */
function walkFiles(dir) {
  const out = []
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const f = path.join(dir, e.name)
    if (e.isDirectory()) out.push(...walkFiles(f))
    else out.push(f)
  }
  return out
}
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

  /* 找一个"可拖动控件"。注意很多作品的摇杆是**按下才浮现**的悬浮杆：静止时 hidden，
     按在画布上才出现在指针处。只找静止可见的控件，会在鼠标档找不到、而触摸档
     恰好抓到，报出一条假的"控件被指针类型挡掉了" —— roamforge 就是这样被误判的，
     它五档全可用。所以先按玩家的做法来：找不到就先按住画布再找一次。 */
  const findStick = () => page.evaluate((sel) => {
    const ok = (c) => {
      const cs = getComputedStyle(c), r = c.getBoundingClientRect()
      if (c.hidden || cs.display === 'none' || cs.visibility === 'hidden') return null
      if (r.width < 24 || r.height < 24) return null
      return { x: r.x, y: r.y, w: r.width, h: r.height }
    }
    if (sel) { const el = document.querySelector(sel); return el ? ok(el) : null }
    const re = /stick|joy|dpad|d-pad|thumb|pad\b|steer|wheel|move/i
    let best = null
    for (const c of document.querySelectorAll('*')) {
      const id = (c.id || '') + ' ' + (typeof c.className === 'string' ? c.className : '')
      if (!re.test(id)) continue
      const r = ok(c)
      if (r && (!best || r.w * r.h > best.w * best.h)) best = r
    }
    return best
  }, controlSel)

  const before = (await page.screenshot()).toString('base64')
  await page.waitForTimeout(700)
  const idle = (await page.screenshot()).toString('base64')

  let box = await findStick()
  let held = false
  if (!box) {
    /* 按住画布中下方召唤悬浮杆。按住不放，后面直接从这里拖，
       松开会让它重新隐藏，再去 move+down 就又找不到了。 */
    await page.mouse.move(cfg.viewport.width * 0.32, cfg.viewport.height * 0.62)
    await page.mouse.down()
    held = true
    await page.waitForTimeout(280)
    box = await findStick()
    if (!box) { await page.mouse.up(); await browser.close(); return { skipped: true } }
  }

  let cx, cy
  if (held) {
    cx = cfg.viewport.width * 0.32
    cy = cfg.viewport.height * 0.62
  } else {
    cx = box.x + box.w / 2
    cy = box.y + box.h / 2
    await page.mouse.move(cx, cy)
    await page.mouse.down()
  }
  for (let i = 1; i <= 8; i++) { await page.mouse.move(cx + i * 4, cy - i * 3); await page.waitForTimeout(40) }
  await page.waitForTimeout(500)
  const dragged = (await page.screenshot()).toString('base64')
  await page.mouse.up()
  await browser.close()
  /* 演示动画自己会变，所以只有"拖动后的画面"与"静置画面"不同才算有反应。 */
  return { skipped: false, animated: before !== idle, changed: dragged !== idle, box, summoned: held }
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

/* 0. STATIC — pointer-type gating in the shipped JS.
   This runs before anything that needs navigation, because the navigation is the
   weak link: the probe can only sample screens it can reach, and a work whose
   controls live three menus deep will sample a title screen, find no controls on
   either side, and satisfy every dynamic check vacuously. That is exactly how one
   work reached the market twice with `show('touch-controls', matchMedia('(pointer:
   coarse)').matches)` — on any desktop browser the whole steering/brake/nitro
   cluster simply never rendered, and the checker said ok.

   So: any matchMedia on `pointer:` / `hover:` in the bundle is reported. Most are
   fine (text hints, layout nudges), but each one has to be looked at, because the
   failure mode is a work that looks perfect and cannot be played. */
const POINTER_MQ = /matchMedia\s*\(\s*["'`][^"'`]*\((?:any-)?(?:pointer|hover)\s*:[^"'`]*["'`]\s*\)/g
/* 产物里按指针类型分支的地方，逐条列出来供人看 —— 不作判定。
   压缩之后没法可靠地判断某个分支是"控件显隐"还是"画质/文案"：
   真正出事的写法是 `function isTouch(){return matchMedia(...).matches}`，
   而 `show('touch-controls', isTouch())` 在几百行之外。试过静态污点追踪，
   要么漏掉真缺陷、要么把一堆只调 dpr 的作品判失败 —— 噪音大的检查等于没有检查。
   判定交给下面的 VERDICT：能走到玩法就用动态对比，走不到就明说"未验证"。 */
const gating = []
for (const f of walkFiles(DIST)) {
  if (!f.endsWith('.js')) continue
  const text = fs.readFileSync(f, 'utf8')
  POINTER_MQ.lastIndex = 0
  let m
  while ((m = POINTER_MQ.exec(text))) {
    const snip = text.slice(m.index, m.index + 170).replace(/\s+/g, ' ')
    gating.push(`${path.relative(DIST, f)}: …${snip}…`)
  }
}

const pointerMedia = [...new Set(gating)].slice(0, 6)
out.checks.pointerMedia = pointerMedia.length ? pointerMedia : 'ok'

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

/* 3b. VERDICT — 通过 / 失败 / 未验证，三态。
   上一轮正是栽在只有两态上：探针走不到玩法画面，parity 比较了两个空集合，
   工具打印 ✓，而那个作品在任何桌面浏览器上整组转向/刹车/氮气根本不渲染，
   两次被市场退回。"没测到"不是"通过"，必须单独说出来。 */
const reached = !r.skipped
if (!reached) out.inconclusive = true

/* 4. COVERAGE — 探针到底有没有看见过控件？
   一档都没看见，说明它连玩法画面都没进，上面的 parity / binding 是在比较两个
   空集合。这**不是"查出问题"，是"没测到"** —— 归入 inconclusive，和 3b 同一路，
   否则同一种情形会因为 CONTROL_RE 有没有误匹配到菜单按钮而一会儿报 1、一会儿报 2。 */
const sawControl = Object.values(samples).some((s2) => s2.items.some((i) => CONTROL_RE.test(i.key)))
if (!sawControl) {
  out.inconclusive = true
  out.checks.coverage = '探针在所有档位都没看到任何控件 —— 没走到玩法画面，parity / binding 无效'
} else {
  out.checks.coverage = `ok (saw controls in ${Object.entries(samples).filter(([, s2]) => s2.items.some((i) => CONTROL_RE.test(i.key))).length} viewport(s))`
}

const errs = Object.entries(samples).flatMap(([n, s]) => s.errors.map((e) => `${n}: ${e}`))
if (errs.length) out.checks.pageerror = [...new Set(errs)]

if (JSON_OUT) {
  console.log(JSON.stringify(out, null, 2))
} else {
  console.log(`${!out.ok ? '✗' : out.inconclusive ? '?' : '✓'} pointer/touch parity — ${path.basename(path.dirname(DIST))}`)
  if (out.ok && out.inconclusive) {
    console.log('   ? 未验证 —— 探针没走到玩法画面，上面的对比是在两个空集合之间做的，不能当作通过。')
    console.log('     用 --start x,y 把探针送进玩法后重跑；菜单层级深的作品必须手动逐档验证。')
    console.log('     控件显隐只能按**布局**（max-width / max-height）决定，或者干脆常显 ——')
    console.log('     控件本来就是 pointer 事件驱动的，鼠标能用，按 (pointer:coarse) 藏掉它没有任何收益。')
  }
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
  if (out.checks.coverage && !String(out.checks.coverage).startsWith('ok'))
    console.log(`   · 覆盖不足：${out.checks.coverage}`)
  if (Array.isArray(out.checks.pointerMedia)) {
    console.log('   · 产物里按指针类型分支的地方（确认没有一处在决定控件显隐）：')
    for (const g of out.checks.pointerMedia) console.log(`       ${g}`)
  }
  if (out.checks.pageerror) for (const e of out.checks.pageerror) console.log(`   ! ${e}`)
}
/* 0 = 通过，1 = 查出问题，2 = 没测到（必须人工跟进，不能当通过） */
process.exit(!out.ok ? 1 : out.inconclusive ? 2 : 0)
