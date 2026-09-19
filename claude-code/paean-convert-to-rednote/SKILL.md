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

## Measured facts, from converting 56 works

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
| **WebGL context creation fails** on a reviewer machine (no GPU / GPU blocklisted / hardware acceleration off) → uncaught throw on the top-level boot path → fully rendered page, zero listeners attached, no message | **21 of 56 artifacts** |

## The defect the market actually reports

The rejection reads **「小工具功能缺陷，可能是页面按钮无法点击，重点排查页面功能完整性」**.
It is a template: it does not tell you which button, which screen, or which device, and it is easy
to waste a day chasing input handling on the strength of the words "按钮无法点击".

Across five reported works, **input handling was never the fault**. Every one of them accepted a real
mouse click on a desktop viewport and advanced normally. Where a cause was reproduced at all, it was
always the same thing: **an uncaught exception on the top-level boot path**. These works share an
entry shape — one long top-level sequence that builds the renderer, compiles shaders, reads the save,
and only at the very end calls `addEventListener` to wire the UI. HTML and CSS have already painted
by then, so when step 3 throws, the player sees a complete, correct-looking screen where nothing
responds, with no error anywhere on it. That is precisely "页面按钮无法点击".

Be honest about coverage: of those five, a reproducible failure was found in **three**. For the other
two nothing failed under WebGL removal, storage denial, a blocked canvas readback, a missing
`AudioContext`, an iframe, or 6× CPU throttling. Treat "I could not reproduce it" as a real outcome —
ship the guard so an unforeseen boot failure becomes visible, and say which works you could not
explain rather than inventing a cause for them.

Confirmed triggers, in order of how often they fired:

1. **`new THREE.WebGLRenderer()` throws** because the device has no usable WebGL. Reviewers run
   desktop machines that may have no GPU, a blocklisted GPU, or hardware acceleration disabled.
   Measured: **21 of 56 artifacts** became dead pages with WebGL removed.
2. **A bare `localStorage` read throws** under a restrictive WebView storage policy. Same shape,
   same symptom. (2 shipped works — see *Wrap every storage access*.)
3. **An unguarded modern API** (`Object.fromEntries`, `roundRect`, `AbortController`…) on the boot
   path, on the Chrome 61 baseline. Same shape, same symptom.

Note what these have in common: the *cause* varies and you will not enumerate all of them. So do not
rely only on fixing causes one at a time.

### The pipeline installs a boot guard for you

`assets/boot-guard.js` is emitted and injected as the **second** script on the page, right after the
baseline shim and before any application code. It listens for `error` and `unhandledrejection`, and
when one fires inside the first 20 seconds it decides whether the work is really dead:

- The pipeline scans the bundle and the copied vendor files for WebGL markers (`WebGLRenderer`,
  `getContext('webgl')`, pixi, three, babylon) and burns the answer into the guard. If the work needs
  WebGL, the device has none, **and** an exception actually fired, that is conclusive — it paints an
  accurate "this device has no usable WebGL" message at once. The build log prints
  `boot-guard: 已标记本作需要 WebGL` when this is on.
- Otherwise it waits ~1.8 s and paints unless the work looks alive, where "alive" means the entry
  bundle ran to completion **and** `requestAnimationFrame` is still producing frames. The pipeline
  appends `window.__minitoolAppDone = true` to the end of the bundle, so a top-level throw — the
  exact failure mode here — leaves it `false` and is caught precisely rather than inferred.

Two things that cost real time to learn, both worth keeping:

**Animation is not liveness.** PixiJS keeps its ticker running after renderer construction fails, so
a completely dead page still produces frames. An rAF-only check calls it healthy.

**Never paint pre-emptively just because WebGL is missing.** An earlier version probed WebGL on
`DOMContentLoaded` and showed the message without waiting for an exception. It covered three works
that degrade to canvas2d perfectly well and would have shipped a false error screen. The exception is
the evidence that the work could not cope; without it, stay quiet.

### Phone layout + mouse pointer: the combination that breaks works

`@media (pointer: coarse)` and `navigator.maxTouchPoints` answer *"is this a touch device"*. What a
work actually needs to know is *"is the phone layout in use"*. Those two agree on a real phone and on
a wide desktop, and disagree in exactly the setup reviewers use: **a desktop browser narrowed to phone
size.** There the phone layout applies — the one that assumes a virtual stick and leaves no room for a
keyboard legend — while the pointer is a mouse, so the stick stays `display: none`. The screen ends up
with no usable controls at all, and it is reported as "按钮无法点击".

The fix is to split one predicate into two:

```css
/* 控件按布局显示 —— 不是按指针类型 */
@media (pointer: coarse), (max-width: 820px), (max-height: 620px) { .stick { display: block } }
```

```js
this.coarse   = matchMedia('(pointer:coarse)').matches;          // 真实指针：准星、hover 提示
this.touchQuery = matchMedia('(pointer:coarse),(max-width:820px),(max-height:620px)');
get touchUI() { return this.touchQuery.matches }                 // 布局：摇杆、触摸按钮、操作提示
```

Keep `touchUI` live (a getter over the `MediaQueryList`, not a boolean captured at construction) so
rotating the device tracks it. Keep genuinely pointer-dependent affordances — a mouse crosshair, a
hover tooltip — on `coarse`. Collapsing the two back into one predicate is how this bug returns.

And bind the controls with **Pointer Events**. `pointerdown`/`pointermove`/`pointerup` fire for mouse,
touch and pen alike, so a virtual stick drags correctly with a mouse and one binding serves every
device. A stick bound only to `touchstart` is visible and dead under a mouse — same symptom, different
cause.

### The host draws its own chrome over your top edge

RedNote floats its own controls on top of the page: a back arrow at the top left, a
person + share capsule at the top right, and the system status bar above both. Anything the
work puts in those corners is **covered and untappable**. It reached the market once as
"背包关闭按钮点不到" — the panel's close button sat exactly under the share capsule, so the
player could not close the bag.

Measured on a 393 CSS px device where `env(safe-area-inset-top)` is 41px:

| Host element | Vertical band | Horizontal reach |
|---|---|---|
| Status bar | `0 – env` | full width |
| Floating control row | `env+10 – env+42` | left ≈ 47px, right ≈ 93px |

The trap is that **`--paean-chrome-inset-top` does not exist in the container.** Works read it
as `var(--paean-chrome-inset-top, env(safe-area-inset-top))`, and it is injected by the host's
`paean-platform.js` — the very script the container build strips. So it silently falls back to
`env()`, which clears the status bar and nothing else. In one 61-work batch, **60 works read
that variable and not one set it.**

The pipeline now defines the whole family at the top of `assets/style.css`, so every work that
already reads them gets correct values with no source change:

```css
:root{
  --paean-chrome-inset-top: max(calc(env(safe-area-inset-top,0px) + 52px), 92px);
  --paean-chrome-inset-right: calc(env(safe-area-inset-right,0px) + 104px);
  --paean-chrome-inset-left:  calc(env(safe-area-inset-left,0px) + 56px);
  /* …plus --paean-safe-top / -bottom / -left / -right */
}
```

`env + 52` scales with the status bar (the capsule is positioned relative to it) and leaves
10px under the control row; the 92px floor covers devices where `env()` reports 0.

**What you still have to check by hand:** a work that hard-codes `top: 12px` instead of reading
the variable is not fixed by this. Run the chrome check below, and when something lands in the
zone, change it to read `var(--paean-chrome-inset-top)` rather than nudging the constant.

Do not put a control in the top-right corner at all if you can avoid it — that is where the
share capsule lives on every host, and the whole corner is a permanent hazard.

### The guard cannot see an async boot failure

If the entry is `async function boot()` and the renderer is constructed **outside** its own
`try`, the throw becomes an *unhandled rejection that the work itself swallows* — the page never
fires `error`, and in the one measured case never fired `unhandledrejection` on `window` either. No
generic guard can catch that. The fix belongs in the work:

```js
async function boot() {
  try {
    const renderer = new Renderer(canvas);   // ← inside the try, not before it
    ...
  } catch (e) {
    const probe = document.createElement('canvas');
    const noGL = !(probe.getContext('webgl2') || probe.getContext('webgl'));
    ui.innerHTML = `<div role="alert">${t(noGL ? 'noWebGL' : 'loadError')}</div>`;
  }
}
```

So: **check that every expensive constructor on the boot path is inside the work's own `try`.** A
work that already has a `try/catch` around loading is not automatically safe — look at where the
`try` actually starts.

The guard turns a silent dead page into a message a reviewer can act on. It is **not** a substitute
for fixing the cause — a work that needs WebGL still cannot run without it — but it converts an
unexplained "功能缺陷" rejection into an honest, visible device-capability notice.

**Do not defeat it:** if the work shows its own `[role="alert"]` message the guard stays quiet, so a
work with a better-targeted message keeps it.

### `import()` the bundler cannot read: the work degrades **silently**

This one shipped. A player reported a converted work had "become the weakened version — the
lavish combat effects are now placeholder dots". The page had no error, no blank screen, no
failed boot, and it passed the boot guard, the Chrome 61 baseline audit, the pointer-parity
check and the host-chrome check. Every check was green and the work was visibly gutted.

The upstream source loaded its real render modules through an *optional-dependency* helper:

```js
async function tryImport(path) { try { return await import(path); } catch (e) { return null; } }
...
const [vfx, bullets, tmap] = await Promise.all([
  tryImport('../gfx/vfx.js'), tryImport('./bullets.js'), tryImport('../gfx/tilemap.js'),
]);
```

`path` is a **parameter, not a literal**, so esbuild cannot resolve it at build time. It emits a
warning that is easy to miss in build output and compiles the call to:

```js
async function tryImport(path){ try{ return await Promise.resolve().then(()=>__toESM(__require(path))) }catch(e){ return null } }
```

`__require(path)` throws in the browser. The work's own `catch` swallows it. Every module comes
back `null`, and the work falls through to the built-in fallbacks its author wrote for exactly
this case — flat coloured circles instead of sprites, a solid rectangle instead of terrain. It
runs, it is playable, and it is a completely different product.

Two things made it invisible:

- **The fallbacks are deliberate.** Upstream authors write them so a module can land later. They
  are not error states, so nothing reports them.
- **The "we are on fallbacks" warning was unreachable.** The loader set `deps.loaded = true`
  unconditionally at the end, and the warning was gated on `if (loaded) return`. Check this: a
  loader that marks itself successful regardless of what it loaded will never tell you.

**The pipeline now fails the build on this.** `selfCheck()` rejects any `__require(` in the
output — it is the only evidence left in the artifact. Do not wave it through.

**Fixes, in order of preference:**

1. Make the specifier a literal. Lazy semantics are preserved and esbuild inlines the module:
   ```js
   const safeImport = (p) => p.then((m) => m, () => null);
   await Promise.all([safeImport(import('../gfx/vfx.js')), safeImport(import('./bullets.js'))]);
   ```
2. If the call site genuinely needs a name computed at runtime, build a **static registry**: one
   module statically imports every candidate and registers them, and the lookup becomes a table
   read. (`ui/modreg.js` in one converted work does this.)

Never "fix" it by deleting the `try/catch` — that turns a silent downgrade into a dead page.

**Generalise the lesson:** any upstream `catch` that substitutes a fallback is a place the
conversion can quietly lose the product. Grep for `catch` around loading/feature-detection paths
and ask what the work looks like when that branch is taken. Then **compare the converted build
against the upstream original on the same screen** — that comparison is the only check that
catches a work which degrades instead of breaking.

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
- **Take WebGL away and boot again** — stub `HTMLCanvasElement.prototype.getContext` to return
  `null` for `webgl` / `webgl2` / `experimental-webgl`. The work must not end up as a silent dead
  page: either it degrades on its own, or the boot guard's message is on screen. This single check
  found 21 broken artifacts out of 56.
- **Run `scripts/check-pointer-parity.mjs <dist>`** — this one is mechanical, so do not hand-roll it:

  ```
  node <skill>/scripts/check-pointer-parity.mjs dist
  ```

  It exits non-zero on failure and runs three independent checks, because they fail for different
  reasons: **parity** (same viewport, mouse vs touch — which control-like elements vanish under the
  mouse), **binding** (controls visible but registered only `touch*` listeners), and **response**
  (actually drag the control with the mouse and require the screen to change). Visibility is not
  usability; only the third check proves a mouse can play.

  Two traps it was built to avoid, both of which produced false passes in practice:

  - A joystick's outer ring is usually `pointer-events: none` — the inner knob takes the input. If
    the probe treats that as "not visible", the stick drops out of *both* samples and parity sees no
    difference. Do not fold `pointer-events` into the visibility test.
  - "No control found" is **not** a pass. If the touch run has controls and the mouse run finds none
    to drag, that *is* the bug.

  Failures at desktop width are reported for information only: there a mouse user still has the
  keyboard legend, so hiding the stick is correct. Only the phone-sized layouts are graded.
- **Drive it on a desktop viewport with a real mouse** (1280×800) as well: click the actual start
  control and assert the screen advances.
- **Run `scripts/check-host-chrome.mjs <dist>`** — nothing interactive may sit under the host's
  floating controls:

  ```
  node <skill>/scripts/check-host-chrome.mjs dist
  ```

  It walks the attract screen, gameplay and every panel it can open, and fails when an
  interactive element has `rect.top < 92` while reaching into the left 56px or right 104px.
  A modal's close button is the usual casualty, because "top-right X" is the default place to
  put one — and that is exactly where the share capsule sits. Pass `--start x,y` when the work
  needs a specific tap to begin.

Probe gotchas: `page.click()` never settles on a button with an infinite CSS animation — use
`touchscreen.tap()`. `elementFromPoint` hitting the button is **not** proof it is clickable; assert a
state change. And `deviceScaleFactor:2` + `isMobile:true` can return self-contradictory
`getBoundingClientRect` values — prefer `hasTouch` alone.

### Compare the build against the upstream original, side by side

Every other check asks "is it broken?". This one asks "is it still the same product?" — the only
question that catches a work which **degrades instead of failing** (see the `import()` section
above). Serve the upstream sources on a local port, drive both to the same screen with the same
inputs, and compare.

Two signals, both cheap:

- **A screenshot of each at the same point.** Look at it yourself. A placeholder-dot regression is
  obvious to an eye and invisible to a DOM scan.
- **A draw-call count.** Hook `CanvasRenderingContext2D.prototype.drawImage` from an init script,
  reset the counter once in-game, and sample a fixed window. The measured regression read
  **0 vs 27,004 calls in 2.5 s**; after the fix, 26,224 vs 27,441 — noise. Orders of magnitude are
  what you are looking for, not exact parity.

Do this once per conversion, on a screen that exercises the work's richest rendering. Console
errors are not enough: the regression that shipped produced none.

## Compliance

Rewrite every online/leaderboard/cloud-save/ads string as a **technical dependency**, with no
platform promotion, no domain, no imperative ("open it in X"):

> 云端排行依赖 Paean.AI SDK 的排行榜能力，本版本未接入；此处显示本机最佳成绩。

Add one muted, non-interactive attribution line in settings or about. Keep `clide.json`'s `title` as
the **upstream** name — it is the remix lineage record, not the listing name; the Chinese name lives
in `<title>` and the listing copy.

Also drop, don't disable, entries that can never work offline: a permanently failing "connect" button
teaches the player the product is broken.
