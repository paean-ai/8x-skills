---
name: paean-convert-to-rednote
description: Convert a published Paean / clide.app work into a RedNote (Xiaohongshu) mini-tool — a fully offline zip that runs in the app's WebView container on a Chrome 61 baseline. Use when porting a Square work to RedNote, or when a mini-tool zip is rejected by the container audit, renders but has dead buttons, or shows blank/garbled screens on old Android WebViews.
---

# Paean Convert to RedNote

Turn a finished work into a **RedNote mini-tool**: a `.zip` of plain static files that the
RedNote container loads with **no network at all**. Everything the work needs must be inside
the zip, and it has to survive an **Android 8.1 / Chrome 61** WebView.

This is a heavier conversion than the playable ad. An ad only has to open, show 30 seconds and
exit, so it never edits the source. A mini-tool is the whole product, in Chinese, on an eight-year-old
engine — so it does touch the source. The rule this skill follows: **anything that can be mechanical
lives in the pipeline; only genuine product decisions are left to you.**

## What the container actually enforces

| Rule | Detail |
|---|---|
| Entry | `index.html` at the **zip root** |
| File types | `html css js png jpg jpeg gif webp svg woff woff2 json` — **`ttf`/`otf`/`mp3`/`txt`/`glb` are rejected** |
| Scripts | no `type="module"`, no import maps, no inline `<script>`, no inline event attributes (`onclick=`), no `eval` / `new Function` / WebAssembly / Worker |
| Network & device | no `fetch` / `XHR` / `WebSocket` / clipboard / geolocation / **motion & orientation sensors** / fullscreen / `window.open` / `<iframe>` / any absolute external URL |
| Size | zip ≤ 10 MiB (aim ≤ 2 MiB); a text file over 2 MiB warns and needs review |
| Engine | Chrome 61 baseline — see below |

The two audit scripts here check the artifact for all of this. They are a gate, not a suggestion.

## Measured facts, from converting 29 works

These are the failure modes that actually happened, not a docs summary.

| Finding | Frequency |
|---|---|
| Default language hard-coded in **two or three** independent places; fixing one has no effect | ~every work with i18n |
| Unguarded modern API on the boot path → **blank page**, no console error visible to the player | 15 of 54 artifacts before a shim was added |
| Reading `window.localStorage` **throws** under some WebView policies; one unguarded read aborts the whole boot sequence, leaving a rendered page with dead buttons | 2 shipped works |
| Canvas-drawn text (including hand-rolled bitmap fonts) is invisible to every DOM-based check | ~1 in 3 works |
| Landscape genuinely unplayable (panel covers the board / HUD squeezes the field to nothing) while automated probes report zero errors | ~1 in 4 works |
| `min()/max()/clamp()` inside a shorthand (`padding: 36px clamp(...)`) — Chrome 61 drops **the whole declaration**, silently | 20+ works |
| Upstream bug only reachable offline or only after a real death/defeat | ~1 in 3 works |

## Decide first: does it even fit?

Some works cannot become a mini-tool without a rewrite. Check before investing:

- **WebGL2 as a hard dependency.** GLSL ES 3.00 shaders, `texStorage2D`, `drawArraysInstanced`.
  Chrome 61 has WebGL2, but low-end GPUs get blacklisted. Falling back to WebGL1 means rewriting the
  renderer. If you ship anyway, replace the hard throw with a readable message rather than a white screen.
- **Multiplayer as the core loop.** Rooms need a host; the container has none. Fine if solo play is
  complete (most `.io`-styled works are already local AI — read the code, the name lies). Not fine if
  the product *is* the lobby.
- **Licensed or unclear-provenance media.** Backing tracks of unknown origin are a bigger risk than a
  missing feature. One work shipped with 21 mp3s plus two base64 blobs that looked like covers; they
  were dropped and the built-in synthesiser used instead.

## Run it

```bash
npm i -D esbuild        # the pipeline's one dependency
node <skill>/scripts/build-minitool.mjs [--config rednote.config.json]
node <skill>/scripts/audit-minitool.mjs dist
node <skill>/scripts/audit-minitool.mjs <name>-minitool.zip
```

The Node auditor reads the zip's own directory, so it needs nothing but Node and works the
same on Windows. `scripts/audit-minitool.py` is the equivalent for a Python toolchain and
reports identical findings — run either one, not both.

`rednote.config.json`, next to the project:

```json
{
  "src": "src",
  "name": "mygame",
  "entry": "js/main.js",
  "css": ["css/base.css", "css/hud.css"],
  "copy": [["favicon.svg", "favicon.svg"]],
  "configGlobal": "MYGAME_CONFIG",
  "configValues": { "defaultLang": "zh" },
  "stylesheetAnchor": "<link rel=\"stylesheet\" href=\"css/base.css\">",
  "htmlReplace": { "</body>": "<script src=\"./assets/config.js\"></script>\n<script src=\"./assets/app.js\"></script>\n</body>" },
  "dropTags": ["<script src=\"paean-sdk.js\"></script>\n"],
  "dropTagPatterns": ["<script src=\"js/[^\"]+\"></script>\\n?"]
}
```

Use `entry` for an ES-module work, or `scripts: [...]` (in `index.html` order) for classic scripts.
Every anchor must match **exactly once** — an upstream edit that moves it fails the build instead of
silently shipping the original tags. `dropTags` removes host-only tags whose files are not shipped;
dropping the file without its tag leaves a 404.

### What the pipeline does for you

You do not need to hand-write any of this:

- ES modules → one classic ES2017 IIFE; or classic scripts concatenated in order.
- **CSS lowered to Chrome 61**: flex `gap` fallback layer generated **per breakpoint** (a `gap`
  overridden inside a media query gets its own fallback, and a selector that stops being flex there
  gets an explicit reset), `min()/max()/clamp()` including inside shorthands, logical properties
  (`margin-inline`…), `env()`, `color-mix()`, `dvh/svh/lvh`, `gap`→`grid-gap` alias.
- **A Chrome 61 API shim** emitted as `assets/baseline.js` and injected as the page's **first**
  script — a vendor `<script src>` you copy in executes before `app.js`, so prepending the shim
  to the bundle is not early enough (a real case: PixiJS uses `globalThis` in 95 places):
  `Object.fromEntries`, `Object.hasOwn`, `Array.flat/flatMap/at`, `String.at/replaceAll`,
  `Promise.finally`, `queueMicrotask`, `structuredClone`, `globalThis`, `AbortController`
  (three.js news one at module top level — without this the whole bundle fails to evaluate),
  `ctx.roundRect`, and a `ResizeObserver` degradation. All written
  "only if missing", so modern engines are unaffected.
- **Third-party licence text inlined** into an `index.html` comment, because `.txt` cannot ship and
  MIT requires the notice to travel with the copy.
- A static self-check for every forbidden capability, then the zip.

### What it warns about but cannot fix

Printed as `CSS 基线提醒` at build time. Each is silent on Chrome 61 — no error, just missing layout:

| Pattern | Why it cannot be auto-fixed | Do this |
|---|---|---|
| `--x: max(...)` — math in a **custom property** | A custom property accepts any token stream, so the failure only surfaces when `var(--x)` is substituted into a consumer, which then drops **its whole declaration** | Static baseline value + `@supports` upgrade |
| `aspect-ratio` | No general fallback without knowing the intended box | Give an explicit height |
| `flex-wrap:wrap` + `gap` | The margin technique cannot reproduce wrap gaps exactly | Grid, or container negative-margin |
| `overflow-wrap:anywhere` | — | `word-wrap: break-word`. **Not** `word-break: break-all`, which splits English words mid-word (`boards` → `boar/ds`) |
| `:focus-visible` | The **whole rule** is discarded on old engines, not just the declaration | Separate `:focus` fallback |

Fix it with `@supports` and the warning stops — the checks exempt anything inside a `@supports` block.

**When writing an `@supports` probe, never put `env()` or `var()` in the condition.** The pipeline
rewrites `env()` in declarations to `var(--safe-area-inset-*, env(...))`, and Chrome 61 understands
`var()`, so such a probe is always true. Use a self-evident condition: `@supports (top: max(1px, 2px))`.

## Source-level work the pipeline cannot do

### Default language is hard-coded in more places than you think

Found in the same work, all three overriding each other:

```js
let current = 'en'                                  // module top
function applyLocale(){ setLocale(save.lang || 'en') }   // fallback
function fresh(){ return { lang: 'en', ... } }           // new-save factory
register('en', {...}, { default: true })                 // ← also sets the *current* locale
```

Route them all through the injected `window.<NAME>_CONFIG.defaultLang`, then **run it** — this is
not verifiable by reading.

### Wrap every storage access

Under some WebView policies **reading `window.localStorage` itself throws**. On a top-level boot path
that aborts the module, so no listener is ever attached: the page renders, every button is dead, and
there is no message. Watch for the one read that sits *outside* an existing `try` block.

```js
function lsGet(k){ try { return window.localStorage.getItem(k) } catch (e) { return null } }
function lsSet(k, v){ try { window.localStorage.setItem(k, v); return true } catch (e) { return false } }
```

### Clamp the main loop's `dt` at both ends

```js
const dt = Math.min(0.05, (now - last) / 1000)            // ← only an upper bound
```

The first rAF `now` can be *earlier* than the `performance.now()` taken at module load, so `dt` goes
negative, in-game time runs backwards, and `arr[(time * 8) | 0 % 4]` indexes negative — dozens of
`drawImage` errors in one burst. 16 of 39 works had this. Use `Math.max(0, Math.min(0.05, ...))`.

### Host access: stub only if unguarded

`typeof PaeanSDK !== 'undefined'` / `typeof createPaeanPlatform === 'function'` → **no stub**, just
drop the SDK tags. An unconditional `createPaeanPlatform({...})` or a bare `PaeanSDK.x` read → copy
`reference/platform-local.js` and import it **first** from the entry module.

Do **not** export `watchAd` / `iap` / room-join from the stub. Works feature-detect these
(`typeof platform.watchAd === 'function'`) to decide whether to render an ad slot or a lobby entry;
an empty function makes the control render and do nothing. Leaving them undefined is the correct
degradation.

### three.js drags `fetch` into the bundle

`import * as THREE from 'three'` defeats tree-shaking, so `FileLoader`'s `fetch` ships and the audit
rejects the zip. Re-export only what is used and point the imports at that file — **call sites stay
unchanged**:

```js
// vendor/three-subset.js
export { BoxGeometry, Mesh, Vector3, /* ... */ } from './three.module.min.js'
```

Add a build-time guard that scans `THREE.Xxx` in the source against the subset, or you find out at
runtime with `X is not a constructor`. (A UMD three.js cannot be tree-shaken at all — if the work
loads no external assets, replace the loader's network calls with `Promise.reject`.)

Note `.at(` is not always `Array.prototype.at` — three.js has `Ray.prototype.at(t, target)`.

### Before introducing `t()` / `T()`, grep for the symbol

Three separate works already had a local `const t` / `const T` that shadowed the new i18n helper.
One only surfaced when the player **died** (`case 'respawn': const t = sim.getTank(...)` shadowing
`t('redeployed')` in the same block) — every earlier probe reported zero errors.

## Localisation: build a guard, not just a dictionary

Simplified Chinese. Three starting points:

- **Ships `en` + simplified `zh`** — only the default-language work remains.
- **Ships `zh-Hant`** — convert the table wholesale, then apply mainland vocabulary
  (设定→设置, 连线→连接, 搜寻→搜索, 讯息→信息, 逾时→超时). **Verify with OpenCC, not by eye** —
  one work shipped with 36 traditional characters that a manual pass missed. OpenCC over-converts
  `乾` (乾坤) and `吒` (哪吒); check those in context.
- **English only** — build a catalogue keyed on the **English source string**, so a miss falls back
  to readable English rather than a bare key.

**A probe cannot prove you translated everything.** It only sees the current screen: locked levels,
failure branches, late-game content and procedurally assembled names are unreachable. Add a
**build-time guard** that scans every display literal (including `name:`/`desc:` in data tables and
strings inside template interpolations) against the catalogue and fails the build on a miss. Works in
this batch each caught 20–30 missing entries that way.

Two traps: strings **assembled at log time** keep the language they were built in (store a closure,
resolve at render), and canvas text needs a CJK font stack — a 3×5 bitmap font cannot draw Chinese at
all, so route CJK through `fillText` on the output layer.

## Verify

```
393×852 portrait · 852×393 landscape · 393×852 with html.no-flex-gap forced
```

Use the **ANGLE** backend (`--use-gl=angle --use-angle=swiftshader`); plain SwiftShader loses the
WebGL context and reports fake shader-compile failures.

Require **0 console errors, 0 pageerror, 0 failed requests** and no leftover English — and actually
**play**: start a run, open the main panels, finish a round. Then:

- **Look at the screenshots yourself.** Canvas text is invisible to the DOM scan, and landscape
  layout bugs (a panel covering the only tappable area) report as zero errors.
- **Strip the modern globals and boot again** — delete `AbortController`, `ResizeObserver`,
  `structuredClone`, `Object.fromEntries`, `roundRect`, `Array.at/flat/flatMap`, `String.replaceAll`
  and load the artifact. This is how unguarded usage is found; grep cannot distinguish a guarded call
  from a bare one. (Do **not** also delete `Array.includes`, `IntersectionObserver` or `ImageBitmap` —
  those are inside the Chrome 61 baseline and deleting them manufactures false failures.)
- **Make `localStorage` throw** and confirm the work still boots and plays.

Probe gotchas: `page.click()` never settles on a button with an infinite CSS animation — use
`touchscreen.tap()`. `elementFromPoint` hitting the button is **not** proof it is clickable; assert a
state change. And `deviceScaleFactor:2` + `isMobile:true` can return self-contradictory
`getBoundingClientRect` values — prefer `hasTouch` alone.

## Compliance

Rewrite every online/leaderboard/cloud-save/ads string as a **technical dependency**, with no
platform promotion, no domain, no imperative ("open it in X"):

> 云端排行依赖 Paean.AI SDK 的排行榜能力，本版本未接入；此处显示本机最佳成绩。

Add one muted, non-interactive attribution line in settings or about. Keep `clide.json`'s `title` as
the **upstream** name — it is the remix lineage record, not the listing name; the Chinese name lives
in `<title>` and the listing copy.

Also drop, don't disable, entries that can never work offline: a permanently failing "connect" button
teaches the player the product is broken.
