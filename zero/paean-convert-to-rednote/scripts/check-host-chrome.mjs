#!/usr/bin/env node
/*
 * check-host-chrome.mjs — 作品有没有把控件放进宿主自己的悬浮 chrome 区？
 *
 *   node check-host-chrome.mjs <dist-dir> [--start x,y] [--json]
 *
 * 宿主（小红书小工具容器）会把自己的控件叠在页面顶部：
 *   左上角返回键、右上角「人物 + 分享」胶囊，再往上是系统状态栏。
 * 作品放在这两个角落的按钮会被压住、点不到。线上吃过一次：
 * 某作品面板的关闭按钮正好在右上角，玩家关不掉背包。
 *
 * 实测（393 CSS px 宽、env(safe-area-inset-top) = 41px 的机器）：
 *   状态栏      0 – 41        整宽
 *   悬浮控件条  51 – 83       左侧到 x≈47，右侧从 x≈300
 * 所以判定区取 top < 92 且横向落在左 56px / 右 104px 内。
 *
 * 这个检查**不能只看首屏**：最典型的受害者是模态框右上角的关闭按钮，
 * 而模态框要点开才存在。脚本会自动逐层点开面板再查，也可以用 --start 指定开局点。
 *
 * 退出码 0 = 没有控件落在遮挡区。
 */
import path from 'node:path'
import { existsSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { execSync } from 'node:child_process'

/* playwright 是 CJS，动态 import 会放在 default 上。 */
const pick = (m) => (m && m.chromium) || (m && m.default && m.default.chromium)
async function loadChromium(fromDir) {
  const roots = []
  for (let d = path.resolve(fromDir); ; d = path.dirname(d)) { roots.push(d); if (d === path.dirname(d)) break }
  roots.push(path.dirname(new URL(import.meta.url).pathname))
  for (const r of roots) {
    const p = path.join(r, 'node_modules', 'playwright', 'index.js')
    if (existsSync(p)) return pick(await import(pathToFileURL(p).href))
  }
  try {
    const g = execSync('npm root -g', { encoding: 'utf8' }).trim()
    const p = path.join(g, 'playwright', 'index.js')
    if (existsSync(p)) return pick(await import(pathToFileURL(p).href))
  } catch (e) { /* 落到下面报错 */ }
  throw new Error('playwright not found. `npm i -D playwright && npx playwright install chromium`, or install it globally.')
}

const argv = process.argv.slice(2)
const flag = (n, d) => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] ? argv[i + 1] : d }
const DIST = path.resolve(argv[0] || 'dist')
const JSON_OUT = argv.includes('--json')
const [SX, SY] = flag('--start', '').split(',').map(Number)

if (!existsSync(path.join(DIST, 'index.html'))) {
  console.error(`✗ ${DIST}/index.html not found`)
  process.exit(1)
}

const VP = { width: 393, height: 852 }
/* 遮挡区。数值来自上面注释里的实测，按 393px 宽标定。 */
const ZONE = { top: 92, left: 56, right: 104 }

const SCAN = `(()=>{
  const out=[];
  const sel='button,[role="button"],a[href],input,select,[onclick],.btn,.ibtn,[class*="close"],[class*="btn"]';
  for(const el of document.querySelectorAll(sel)){
    const cs=getComputedStyle(el), r=el.getBoundingClientRect();
    if(cs.display==='none'||cs.visibility==='hidden'||+cs.opacity<0.05) continue;
    if(cs.pointerEvents==='none') continue;
    if(r.width<6||r.height<6) continue;
    const cls=(typeof el.className==='string'&&el.className.trim())?el.className.trim().split(/\\s+/)[0]:'';
    out.push({
      key: el.tagName.toLowerCase()+'#'+(el.id||'')+'.'+cls,
      x:Math.round(r.x), y:Math.round(r.y), w:Math.round(r.width), h:Math.round(r.height),
      label:(el.getAttribute('aria-label')||el.textContent||'').trim().slice(0,14),
    });
  }
  return out;})()`

const chromium = await loadChromium(DIST)
const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
})
const page = await (await browser.newContext({
  viewport: VP, deviceScaleFactor: 2, hasTouch: true, isMobile: true,
})).newPage()

const errors = []
page.on('pageerror', (e) => errors.push(e.message.split('\n')[0].slice(0, 90)))
await page.goto('file://' + path.join(DIST, 'index.html'))
await page.waitForTimeout(4500)

const hits = new Map()
const visited = []
async function scan(where) {
  visited.push(where)
  for (const el of await page.evaluate(SCAN)) {
    if (el.y >= ZONE.top) continue
    const inRight = el.x + el.w > VP.width - ZONE.right
    const inLeft = el.x < ZONE.left
    if (!inRight && !inLeft) continue
    const k = `${el.key}@${el.x},${el.y}`
    if (!hits.has(k)) hits.set(k, { ...el, corner: inRight ? 'top-right' : 'top-left', screen: where })
  }
}

await scan('attract')
await page.touchscreen.tap(Number.isFinite(SX) ? SX : VP.width / 2, Number.isFinite(SY) ? SY : VP.height * 0.55)
await page.waitForTimeout(2600)
await scan('after-start')

/* 逐层点开面板：每次点当前屏上最大的、在 chrome 区以外的按钮，
   模态框的关闭按钮正是这样才露出来的。 */
for (let i = 0; i < 5; i += 1) {
  const btn = await page.evaluate((zoneTop) => {
    let best = null
    for (const c of document.querySelectorAll('button,[role="button"],.btn,.ibtn')) {
      const cs = getComputedStyle(c), r = c.getBoundingClientRect()
      if (cs.display === 'none' || cs.visibility === 'hidden') continue
      if (r.width < 34 || r.height < 22 || r.y < zoneTop) continue
      const a = r.width * r.height
      if (!best || a > best.a) best = { x: r.x + r.width / 2, y: r.y + r.height / 2, a }
    }
    return best
  }, ZONE.top)
  if (!btn) break
  await page.touchscreen.tap(btn.x, btn.y)
  await page.waitForTimeout(1400)
  await scan(`panel-${i + 1}`)
}

await browser.close()

const list = [...hits.values()]
const ok = list.length === 0
if (JSON_OUT) {
  console.log(JSON.stringify({ dist: DIST, zone: ZONE, screens: visited, hits: list, pageerrors: [...new Set(errors)], ok }, null, 2))
} else {
  console.log(`${ok ? '✓' : '✗'} host chrome — ${path.basename(path.dirname(DIST))}  （查过 ${visited.length} 个界面）`)
  for (const h of list) {
    console.log(`   ✗ ${h.corner} ${h.key} "${h.label}" @(${h.x},${h.y}) ${h.w}×${h.h}  [${h.screen}]`)
  }
  if (!ok) {
    console.log('\n   修法：让它读 var(--paean-chrome-inset-top) 让出顶部，而不是把常量往下挪几像素。')
    console.log('   右上角本来就是分享胶囊的位置，能不放控件就别放。')
  }
  if (errors.length) for (const e of [...new Set(errors)]) console.log(`   ! ${e}`)
}
process.exit(ok ? 0 : 1)
