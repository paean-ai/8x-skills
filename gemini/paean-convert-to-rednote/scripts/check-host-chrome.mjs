#!/usr/bin/env node
/*
 * Heuristic DOM overlap check against configurable physical host rectangles.
 * node check-host-chrome.mjs <dist> [--start x,y] [--viewport 390,844]
 *   [--safe-area top,right,bottom,left] [--host-edge auto|top|left]
 *   [--zones measured-host.json] [--settle-ms 4500] [--timeout-ms 90000] [--json]
 * Default geometry is a local mock, not an official host contract. Exit 0 means no
 * overlap/runtime error in reached DOM screens; 1 is a finding; 2 is unverified.
 * Actual control/state assertions and platform/device checks are still required.
 */
import path from 'node:path'
import { existsSync, readFileSync } from 'node:fs'
import { hostZones, validateZones, intersects } from './host-geometry.mjs'
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
const START = flag('--start', '')
const [SX, SY] = START ? START.split(',').map(Number) : [NaN, NaN]
if (START && (!Number.isFinite(SX) || !Number.isFinite(SY) || START.split(',').length !== 2)) throw Error('start requires x,y')
const [width, height] = flag('--viewport', '393,852').split(',').map(Number)
const VP = { width, height }
const SAFE = flag('--safe-area', '0,0,0,0').split(',').map(Number)
const EDGE = flag('--host-edge', 'auto')
const defaultZones = hostZones({...VP, safe: SAFE, edge: EDGE})
const zonesFile = flag('--zones', '')
const ZONES = zonesFile ? validateZones(JSON.parse(readFileSync(path.resolve(zonesFile), 'utf8'))) : defaultZones
const SETTLE = Number(flag('--settle-ms', '4500'))
const TIMEOUT = Number(flag('--timeout-ms', '90000'))
if (!Number.isFinite(SETTLE) || SETTLE < 0 || !Number.isFinite(TIMEOUT) || TIMEOUT <= 0) throw Error('Invalid time budget')

if (!existsSync(path.join(DIST, 'index.html'))) {
  console.error(`✗ ${DIST}/index.html not found`)
  process.exit(1)
}

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
      x:r.x, y:r.y, w:r.width, h:r.height,
      label:(el.getAttribute('aria-label')||el.textContent||'').trim().slice(0,14),
    });
  }
  return out;})()`

const chromium = await loadChromium(DIST)
const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
})
let timedOut=false
const watchdog = setTimeout(async () => {
  timedOut=true
  console.log(JSON.stringify({dist:DIST, ok:false, inconclusive:true, reason:'probe timeout', timeoutMs:TIMEOUT}))
  const force = setTimeout(() => process.exit(2), 2000)
  await browser.close().catch(() => {})
  clearTimeout(force); process.exit(2)
}, TIMEOUT)
let exitCode = 2
try {
  const page = await (await browser.newContext({viewport: VP, hasTouch: true, isMobile: false})).newPage()
  const errors = []
  page.on('pageerror', e => errors.push(e.message.split('\n')[0].slice(0, 150)))
  await page.addInitScript(safe => {
    function apply() {
      const root = document.documentElement
      if (!root) return
      ;['top','right','bottom','left'].forEach((edge,i) => root.style.setProperty('--safe-area-inset-'+edge, safe[i]+'px'))
    }
    apply(); document.addEventListener('DOMContentLoaded', apply, {once:true})
  }, SAFE)
  await page.goto(pathToFileURL(path.join(DIST, 'index.html')).href)
  await page.waitForTimeout(SETTLE)
  const hits = new Map(), visited = []
  let seen = 0
  async function scan(where) {
    visited.push(where)
    for (const el of await page.evaluate(SCAN)) {
      if (!intersects(el, {x:0,y:0,w:VP.width,h:VP.height})) continue
      seen++
      const zone = ZONES.find(z => intersects(el,z))
      if (!zone) continue
      const key = `${el.key}@${el.x},${el.y}`
      if (!hits.has(key)) hits.set(key,{...el,zone:zone.name,screen:where})
    }
  }
  await scan('attract')
  await page.touchscreen.tap(Number.isFinite(SX)?SX:VP.width/2, Number.isFinite(SY)?SY:VP.height*.55)
  await page.waitForTimeout(Math.min(2600,SETTLE))
  await scan('after-start')
  for (let i=0;i<5;i++) {
    const btn = await page.evaluate(({zones,vp}) => {
      let best = null
      for (const el of document.querySelectorAll('button,[role="button"],.btn,.ibtn')) {
        const cs=getComputedStyle(el),r=el.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2
        if(cs.display==='none'||cs.visibility==='hidden'||+cs.opacity<.05||r.width<34||r.height<22)continue
        if(x<0||y<0||x>vp.width||y>vp.height)continue
        if(zones.some(z=>r.x<z.x+z.w&&r.right>z.x&&r.y<z.y+z.h&&r.bottom>z.y))continue
        const target=document.elementFromPoint(x,y)
        if(!target||!el.contains(target))continue
        const area=r.width*r.height
        if(!best||area>best.area)best={x,y,area}
      }
      return best
    },{zones:ZONES,vp:VP})
    if(!btn)break
    await page.touchscreen.tap(btn.x,btn.y)
    await page.waitForTimeout(Math.min(1400,SETTLE))
    await scan(`panel-${i+1}`)
  }
  const list=[...hits.values()],inconclusive=seen===0
  const ok=!list.length&&!errors.length&&!inconclusive
  const result={dist:DIST,viewport:VP,safeArea:SAFE,hostEdge:EDGE,zones:ZONES,screens:visited,hits:list,pageerrors:[...new Set(errors)],inconclusive,ok}
  if(JSON_OUT)console.log(JSON.stringify(result,null,2))
  else {
    console.log(`${ok?'✓':inconclusive?'?':'✗'} host overlap — ${path.basename(path.dirname(DIST))} (${visited.length} screens)`)
    for(const h of list)console.log(`   ✗ ${h.zone}: ${h.key} "${h.label}" @(${h.x},${h.y}) ${h.w}×${h.h} [${h.screen}]`)
    for(const error of new Set(errors))console.log('   ! '+error)
    if(inconclusive)console.log('   ? No interactive DOM controls reached; use project-specific geometry/state tests.')
    console.log('   Local physical host mock only; verify measured host rectangles and actual clicks.')
  }
  exitCode=list.length||errors.length?1:inconclusive?2:0
} catch (error) {
  if (timedOut) exitCode=2
  else throw error
} finally {
  clearTimeout(watchdog)
  await browser.close()
}
process.exitCode=exitCode
