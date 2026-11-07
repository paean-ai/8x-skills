---
name: paean-convert-to-rednote
description: Convert a published Paean / clide.app work into a RedNote (Xiaohongshu) mini-tool — a fully offline zip that runs in the app's WebView container on a Chrome 61 baseline. Use when porting a Square work to RedNote, or when a mini-tool zip is rejected by the container audit, renders but has dead buttons or intermittent joystick input in phone previews, or shows blank/garbled screens on old Android WebViews.
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
| Size & file count | zip ≤ 10 MiB (aim ≤ 2 MiB), **total files in zip ≤ 200** (merge/inline assets or spritesheets if upstream has >200 files); a text file over 2 MiB warns and needs review |
| Engine | Chrome 61 baseline — see below |

The two audit scripts here check the artifact for all of this. They are a gate, not a suggestion.

### TTS during creation and for demo videos

Speech synthesis is available to the creator through [paean-tts](../paean-tts/SKILL.md) and the local offline neural runner `~/.local/bin/free-tts` (which defaults to **Apple Silicon MLX `Qwen3-TTS-12Hz-1.7B-CustomVoice-bf16`** via `--engine qwen3` / `~/.local/bin/qwen3-tts` with 9 studio speakers `serena`, `vivian`, `uncle_fu`, `ryan`, `aiden`, `ono_anna`, `sohee`, `eric`, `dylan` + `--instruct` emotion control, and falls back to **Kokoro-82M v1.1-zh** via `--engine kokoro` / `~/.local/bin/kokoro-tts`).
Use it when making narration for a separate demo/promo video or speech assets for an accompanying 8x
version. This does not permit runtime REST/SDK TTS in the offline mini-tool, and the current file
whitelist excludes both WAV and MP3. Preserve visible text and remove unavailable speech controls
from the offline version; do not disguise audio by changing its extension to pass the audit.

## Official mini-tool skill, Xiaohongshu platform APIs, and note rewards

Use the upload page’s current official skills: [minitool-zip-builder 1.9.0-beta.20261023.1](https://fe-static.xhscdn.com/minitool/test/20261023/dist/minitool-zip-builder-1.9.0-beta.20261023.1.skill) and [redapp-cli](https://fe-video-qc.xhscdn.com/fe-platform-file/104101b8326rqruuj5006b6titltg00000000038l066g4) (standard zip archives unpacked safely to the current Agent's user skill directory), paired with the live online contract at [`https://miniapp-sandbox.xiaohongshu.com/minitool/doc`](https://miniapp-sandbox.xiaohongshu.com/minitool/doc). Read the bundled API and manifest baseline (`mini_tool.json` at zip root with a single boolean key `{"is_high_consumption_scene": false}` unless Worker/OffscreenCanvas/WASM/Unity/Cocos is actually executed), retrieve the current online contract, and report newly documented public capabilities or changed requirements before implementation. Preserve project-specific input and layout fixes separately when updating the official package.

When integrating Xiaohongshu-specific platform features — **Follow Creator (`followAuthor`, `getFollowStatus`, 9.51+)**, **Dedicated Leaderboards (`submitScore` requiring `"USER_PROFILE"` upload authorization & `-1,000,000 ~ 1,000,000` range, `getRankList` top 100, `getMyRank` 4-state `EXACT` 1–500 / `OVER_LIMIT` 500+ / `NO_SCORE` / `NOT_PARTICIPATING`, 9.51+)**, **Dedicated Cloud Storage (`addCloudStorage`, `updateCloudStorage`, `queryCloudStorage`, `removeCloudStorage`, max 100 items/batch & 64KB/item, 9.51+)**, **Local Storage (`setStorage`, `getStorage`, 9.46+)**, **Card/Image Share (`share` supporting `type: "card" | "image"`, 9.53+)**, or **Note Publishing / Album Save (`postNote` supporting `video_publish` / `slides_edit` / `photo_publish`, `writeTempFile` supporting `png/jpeg/webp/gif/mp4`, `saveImageToPhotosAlbum`)** — read [Xiaohongshu platform APIs and preview fallback guide](reference/xhs-platform-apis.md). In non-app audit preview environments, when `window.xhs.miniTool` exists in the review container but hangs without firing callbacks, or on a fresh 0-score save, **never leave platform-capability buttons (`提交成绩`, `关注创作者`, `云端备份`, `发布笔记`) disabled or waiting on async callbacks**: always apply **`t = 0ms` synchronous optimistic UI & local state updates** first and bound `callXhs()` timeouts to `<= 450ms` for state queries so every button responds instantaneously even under a hanging `window.xhs.miniTool` / `window.xhs.AI` bridge. For **video note publishing (`pageType: "video_publish"`)**, give `writeTempFile` a `5000ms` disk-I/O timeout after `t = 0ms` optimistic UI reward, pass only a valid `writeTempFile` `filePath` (never a raw `data:image/...` URI) to `video_resources.cover_url`, **never fall back from `postNote({ pageType: "video_publish" })` to `photo_publish` in a timeout `catch`** (because `postNote` only settles after user interaction in the native sheet and a short timeout would overwrite the video editor with an image note!), and include a pure-JS H.264 Constrained Baseline (`avc1.42C01E` `I_PCM` + `faststart` ISO-BMFF MP4) fallback alongside `MediaRecorder("video/mp4")` (`safetyTimer >= durationMs + 2500ms`) so Android WebViews (where `MediaRecorder` only outputs `video/webm`) also produce valid `.mp4` clips. When uploading, generating a phone preview QR code, or submitting for review via `redapp` CLI, always run `--dry-run` before `--confirm <planHash>`, and **never execute `redapp submit --confirm` until the user has scanned the `redapp preview` QR code and explicitly confirmed `"预览通过"`**.

When converting IAP/IAA reward designs into optional note sharing, read [note publishing and bounded rewards](reference/note-rewards.md). Preserve existing free play and ownership, use only documented `postNote` outcomes, **never call `navigator.clipboard` or `execCommand('copy')` in a share fallback** (forbidden by the container audit), and distinguish technical support from platform approval of incentives. Do not apply this option to every conversion automatically.

## RedNote release presentation

For a new game listing, read [the release presentation standard](reference/rednote-release-standard.md) **before editing the UI or recording media**. It covers verified copyright/source credits during automatic gameplay and in the entry UI, optional virtual landscape with working input mapping, 14-character listing copy, a game-specific icon and a 30-second HD demo captured from the final ZIP. Apply game-specific items only where they fit the work and the user's request.

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

An early five-work investigation reproduced boot failures in three works; two remained
unexplained. That sample did **not** establish that input handling was never at fault. Later
phone-layout cases reproduced hidden sticks, incomplete Mouse/Touch forwarding, compatibility
cooldowns swallowing a new press, lost release/capture, duplicate bridges and incorrect rotated
coordinates. A desktop-width click and a running demo do not exclude these failures.

Start by locating the failing layer: boot → entry/overlay → input state → gameplay state →
simulation/performance. Read [input reliability and regression guidance](reference/input-reliability.md)
when adapting controls or investigating a rejected/unresponsive work. Inspect the **complete ZIP**,
including delegated listeners and compatibility bridges; an isolated input class is not the whole
product. Report unreproduced cases as such, with the actual test conditions.

**Required functional acceptance for every conversion and repair:** run the final ZIP once with a fresh save and the normal production URL (no QA/record shortcuts), including first-use tutorials/dialogue and their exits. Check short-screen action visibility without locator auto-scroll, native mouse/touch results, repeated gestures, cancellation without submission, key feature return paths and save/reload. Follow the dated acceptance checklist in [input reliability](reference/input-reliability.md); component probes and a playable attract demo do not replace this flow.

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

Prefer Pointer Events for the shared input path, but provide independent Mouse/Touch fallbacks
where the preview host needs them. It may forward only MouseEvent, only TouchEvent, or
`pointerdown → mousemove/mouseup`. **Never use a `recentTouch()` (`performance.now() - _lastTouchTime < 800`) time window to ignore `PointerEvent` (`pointerdown`/`pointermove`/`pointerup`)!** On real mobile WebViews, `pointerdown (pointerType: 'touch')` fires ~0.5 ms *before* `touchstart`: on Touch #1 (after >800 ms idle), `pointerdown` claims `this.stick`, then `touchstart` sets `recentTouch() = true` and falls into `else if (!this.look)` (causing left-side joystick drag to rotate the camera while `pointermove`/`pointerup` are blocked by `recentTouch()`, leaving `this.stick` permanently wedged!), and on Touch #2 (>800 ms later) `pointerdown` claims `this.look` and wedges it too, permanently locking both movement and camera rotation! Instead, pair `{ touchId, pointerId }` onto the same active slot (`this.stick` or `this.look`) within 350 ms & 72 px regardless of whether `pointerdown` or `touchstart` arrives first, bind `touchend`/`touchcancel`/`pointerup`/`pointercancel` on `window` in the **capture phase** (`{ capture: true, passive: true }`), keep active touch slots alive on `pointercancel` (only clearing `slot.pointerId = null` when `slot.touchId` is still active), and reconcile against `e.touches` (`if (e.touches.length === 0)` clear all non-mouse slots). Keep `#stick` visibly anchored (`opacity: 0.78`) at its resting position in portrait & landscape, set `pointer-events: none` on `#topbar` and `#pads` containers (with `pointer-events: auto` only on `<button>` / `.pad`), and in `resize()` / `renderFrame()` always read `window.XHSOrientation.size()` and `window.XHSOrientation.client(x, y)` so `body.xhs-virtual-landscape` never squashes the 3D `camera.aspect` or leaves touch coordinates unrotated. See [the failure table and test matrix](reference/input-reliability.md) before changing handlers.

### Ordinary buttons, scrolling and compatibility tails

Audit menus, level maps, leaderboard/share/cloud modals, and startup save-recovery controls as well as the demo/stick. Click-only activation can fail when a preview/WebView omits its compatibility `click` (`mouse-only`, `touch-only`, `pointer-only`, `pointer-touch`, or `touch-pointer`). Register one capture-phase release-confirmation state machine with `click`/keyboard fallback, not several business-action listeners:
- **No artificial global cooldowns:** absorb only the compatibility tail (`mouseup`/`touchend`/`click` within 450 ms on the same button), and never block the next fresh `down` with a 280 ms+ cooldown that swallows rapid consecutive clicks (e.g., switching tabs, chapters, or abilities).
- **Hit-target stability:** add `button > * { pointer-events: none; }` and avoid `button:active { transform: translateY(...) }` shifting targets between press and release.
- **Board tap-to-select vs compatibility mouse tail:** on tile/board games that support both drag-to-swap and tap-A-then-tap-B, record a 450 ms `boardTail` after `pointerup`/`touchend` so compatibility `mousedown`/`mouseup` does not fire `handlePick` a second time and immediately deselect the tile.
- **Full-screen attract tap-to-start & no disabled button traps:** when the attract screen says "轻触开玩 / Tap to play", tapping anywhere on `#app` outside secondary buttons must enter the game. On fresh saves, do not leave 19/20 level-map nodes or chapter `<`/`>` arrows `disabled` (wrap chapter pagination and allow clicking any level node to preview/play), and never leave `#rankSubmitBtn` (`提交成绩`) `disabled` in audit preview.
- **Short-screen (`320×568`) and landscape modal visibility:** keep 100% of modal action buttons above the fold without scrolling (use side-by-side share previews, bounded `max-height` scrollable rank lists, and 2/3-column CSS Grid `.menu-links` instead of `flex-wrap: wrap` + `gap`). When computing board size in JS, read resolved pixels (`parseFloat(getComputedStyle(app).paddingTop)`), never `parseFloat(appStyle.getPropertyValue('--top'))` (which returns `NaN` on `calc(...)`). Configure `orientationStage: 'wrap'` so `#overlay` and `#toast` rotate with `#app`, and use `@media (orientation: landscape)` rather than `@media (min-aspect-ratio: ...)`.

Cancel, scroll and release outside must not submit; the next fresh press must remain usable. Entry and menu delegates must coordinate mouseup/click tails across a screen change. Keep gameplay out of panel scroll gestures, and keep stick and camera contacts distinct even when a desktop preview translates mouse into touch. Test action counts, view direction and scroll position; see [ordinary-menu regression guidance](reference/input-reliability.md).

### Host controls occupy physical screen space

The host draws a back control, a capsule and system UI over the page. A close button underneath
can be visible but untappable. Measure their actual rectangles; do not infer them from a universal
`y < 92` rule. The historical 92px measurement included one phone's status bar and is not a
zero-safe-area or landscape requirement.

The host does not provide Paean's `--paean-chrome-*` aliases. Inspect the emitted stylesheet and
supply them in the adaptation; removing the upstream platform script can remove their original
definitions. Do not assume the bundled builder creates them or solves virtual rotation. Distinguish
system safe area, host strip and game margin, count each once, and map physical to logical edges
when rotating the stage. The [input reliability reference](reference/input-reliability.md) documents
the current project's adjustable 48px strip / 32px toggle example and physical landscape mapping.

**Critical software-landscape (`body.xhs-virtual-landscape`) inset direction & CSS custom property inheritance rule:**
- In portrait mode, Xiaohongshu's statusbar + `<` back button + `#xhs-orientation-toggle` (`top: calc(var(--xhs-physical-safe-top, 40px) + 10px); left: calc(var(--xhs-physical-safe-left, 0px) + 48px); width: 32px; height: 32px`) occupy the physical top edge (`--top: 86px, --left: 0px`), so top UI shifts **down** (`往下避让`).
- When rotated 90° clockwise into software landscape (`body.xhs-virtual-landscape`), Xiaohongshu's physical top system buttons stay fixed on the physical top edge — which is now the **left-hand side (`左手边`, `x_logical = 0..86px`)** of the landscape screen! `orientation.js` (`syncInsets('clockwise')`) sets inline variables on `[data-xhs-orientation-root]` (`#app`): `--paean-chrome-inset-top: 0px` and `--paean-chrome-inset-left: 86px`.
- **Never declare `--top` / `--left` aliases only on `:root`!** If `style.css` writes `:root { --top: var(--paean-chrome-inset-top, ...); --left: var(--paean-chrome-inset-left, ...); }`, CSS resolves `var(...)` on `:root` (using portrait values `86px` / `0px`) and `#app` inherits `--top: 86px, --left: 0px`, ignoring `#app`'s inline `--paean-chrome-inset-*` overrides — causing the landscape top UI (including right-side buttons) to wrongly shift **down** by `86px` (`往下避让`) instead of shifting the left-side UI **right** by `86px` (`往右避让`).
- Always declare inset aliases on `:root, #app, [data-xhs-orientation-root]` (and `minitool-pipeline.mjs` / `tools/minitool.mjs` now also runs `cssStageInsetAliases()` to auto-emit `[data-xhs-orientation-root]` overrides). In landscape, place top-right social pills (`#xhs-top-dock`) beside `#side` on the top row (`top: calc(12px + var(--top)); right: calc(106px + ...)`) rather than stacked `58px` down, and assert in Playwright that in `body.xhs-virtual-landscape`, `--top` is `0px`, top UI has `offsetTop <= 16`, and left UI has `offsetLeft >= 86`.

Use the configurable host probe for likely overlaps, then put simulated host masks over the final
artifact and actually operate the close/pause/orientation controls. Host geometry and device tests
remain separate from the generic probe's heuristic DOM coverage.

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
- **Verify one gesture, one action across full UI routes.** Include ordinary menus, nested
  confirmations, startup save retry, keyboard activation and any reward cancel/return path. Test
  compatibility tails and a fresh next gesture, native no-click touch where relevant, and actual
  panel scrolling under virtual rotation. Movement-only input must leave camera heading unchanged.
  A static hit test or a moving joystick alone does not prove these outcomes.
- **Test realistic human hold durations (`80–250ms`), touch bleed-through on layer switches, and panel opening geometry (`t = 0ms`).**
  Synthetic tests that dispatch `down -> up` in `0ms` miss two fatal bugs that break real review devices:
  (1) a short gesture-reset timeout (e.g. `> 65ms`) in button handlers that treats the trailing compatibility `mousedown -> mouseup -> click` after a `120ms` human press or slow handler (`> 80ms`) as a second tap and double-fires toggle/modal buttons;
  (2) touch tap bleed-through where opening a modal on `pointerup` hides the trigger bar before `touchend`/`click` fires, so the trailing `click` lands on the newly revealed `.modal-wrap` backdrop and immediately closes the modal (or closes a modal on `pointerup` and starts the underlying `canvas` game on trailing `click`).
  Always call `e.preventDefault()` on button `touchend` (`{ passive: false }`), install a window-level capture-phase touch-tail guard (`450ms`), remove `transform: scale(...)` entry animations (`animation: pop`) from `.panel` so buttons are at their final bounding boxes at `t = 0ms`, and defer heavy 3D scene construction until after `window.load` so software WebGL does not stall `page.goto` or starve input. See [input-reliability.md](reference/input-reliability.md).
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
- **Triage with `scripts/check-pointer-parity.mjs <dist>`**, using `--start x,y` and
  `--control <selector>` when needed. It compares phone mouse/touch visibility, reports direct
  touch-only bindings, and samples a drag. Delegated listeners and old compatibility bridges can
  explain binding warnings; automatic animation can explain changing screenshots. The probe
  cannot prove gameplay response. Exit 2 means inconclusive/timeout, not a game failure or a pass.
  Its default total budget is 90 seconds; do not impose a 45-second wrapper on its roughly
  50 seconds of normal fixed waits.
- **Verify project-specific gameplay state from the final ZIP** using the
  [input regression matrix](reference/input-reliability.md). Cover real mouse without touch
  capability, CDP touch, CSS-scaled phone iframe, both orientations, repeated alternating presses,
  fallback/mixed event chains, multiple fingers and interrupted releases. Assert input-dependent
  world movement and release-to-zero, plus entry/menu/action state changes. A moving knob,
  `elementFromPoint`, zero console errors or changed screenshots alone cannot establish this.
- **Drive it on a desktop viewport with a real mouse** (1280×800) as well: click the actual start
  control and assert the screen advances.
- **Check physical host overlap with `scripts/check-host-chrome.mjs <dist>`**. Example:

  ```sh
  node <skill>/scripts/check-host-chrome.mjs dist --viewport 390,844 --safe-area 41,0,0,0
  node <skill>/scripts/check-host-chrome.mjs dist --viewport 844,390 --safe-area 0,0,0,44 --host-edge left
  ```

  `--safe-area` is top,right,bottom,left in CSS pixels. Defaults are a configurable local mock,
  not official dimensions; use `--zones measured-host.json` for measured physical rectangles.
  Check gameplay and open panels, not just the demo. Unreached screens, runtime errors and probe
  timeouts must be reported, and a clean DOM scan still requires actual control/state checks.

Probe gotchas: `page.click()` never settles on a button with an infinite CSS animation — use
coordinate-based `page.mouse.click()` for the mouse case and `touchscreen.tap()` for touch.
Substituting a touch tap does not validate the mouse path. `elementFromPoint` hitting the button is **not** proof it is clickable; assert a
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
platform promotion, external link, or imperative ("open it in X"). The only domain-shaped UI text
is a non-interactive copyright notice when the original rights statement actually supports it;
follow [the release presentation standard](reference/rednote-release-standard.md):

> 云端排行依赖 Paean.AI SDK 的排行榜能力，本版本未接入；此处显示本机最佳成绩。

Add one muted, non-interactive attribution line in settings or about. Keep `clide.json`'s `title` as
the **upstream** name — it is the remix lineage record, not the listing name; the Chinese name lives
in `<title>` and the listing copy.

Also drop, don't disable, entries that can never work offline: a permanently failing "connect" button
teaches the player the product is broken.

### Content Audit & Code/Visual/Copy Sanitization (`内容未通过平台综合审核`)

Xiaohongshu's automated review agent inspects **both** the shipped bundle (`dist/index.html`, `dist/assets/*.js`, `dist/assets/*.css`) and runtime visuals/copy. Even non-horror cartoon/RPG/roguelike games can be rejected when `minifyIdentifiers: false` or module header comments expose sensitive filenames and identifiers. When converting liminal, dreamcore, Poolrooms, stealth, RPG, or combat works — or when a submission is rejected with `内容未通过平台综合审核` — follow [content-audit-sanitization.md](reference/content-audit-sanitization.md):

1. **Sanitize JS filenames, identifiers, class names, DOM IDs, and substring matches**: Strip `/* ---- js/... ---- */` module header comments in `tools/minitool.mjs`. Rename `ghost.js` → `faded.js`, `evo-abyss.js` → `evo-vortex.js`, `sticky-mines.js` → `sticky-notes.js`, `ScareDirector` → `RippleDirector`, `scare` → `ripple`/`ambience`, `kills`/`kill` → `erased`/`erase`, `Skill Issue` → `Timing Issue` (avoids `kill` substring), `dead`/`onDeath` → `gone`/`onGone`, `skull` → `badge`, `mummy`/`wraith` → `tapewrap`/`whitedrift`, `hpGhost`/`tGhost` → `hpTrail`/`tTrail` (avoids `ghost` substring), Three.js `ghostwhite` → `mistwhite`, `prisoner`/`dungeon`/`jailbreak` → `wanderer`/`cellar`/`breakout`, `wizard`/`wand` → `starpainter`/`brush`, `sHit` → `fHit`, `demoGod` → `demoInvincible`, `#btn-scares` → `#btn-ambience`, `.ghost-btn`/`.btn.ghost` → `.subtle-btn`/`.btn.subtle`. Keep `paean.ai` / `clide.app` / `8x.gg` out of `dist/` (use creator attribution in-app and put `版权归属 paean.ai & 8x.gg & creator` on the promo video ending card).
2. **Sanitize GLSL shaders, CSS overlays, and 2D Canvas/SVG icons**: Rename `uScare` → `uRipple`, `abyssCol`/`abyssMaterial` → `deepCol`/`deepVaultMaterial`. Replace blood-red damage/low-HP borders and flashes (`rgba(120, 10, 10, 0.55)`, `scene.drawDanger`) with soft aqua/ink-blue mist (`rgba(160, 235, 248, 0.28)` / `rgba(91, 149, 209, 0.42)`). Replace skull/crossbones/X-eye icons (`I.skull`, `P.kill`, pirate hat skulls) with gold star badges (`I.badge`), erasers (`P.erased`), or compass stars.
3. **Replace Jump-Scare 3D entities & harsh audio**: Replace close-up lunge faces/skulls (`buildLifeguard`, `buildBust`, `buildPoolFace`) and sawtooth shriek synthesis with serene environmental cues (skylight breathing, water ripples, pentatonic crystal chimes).
4. **Sanitize BOTH `zh` and `en` i18n dictionaries + listing title/slogan**: Bundled English and Chinese strings for supernatural (`幽灵`, `幽魂`, `木乃伊`, `深渊`, `巫师`, `魔杖`, `神庙`), violence/crime (`死`, `血`, `击杀`, `地雷`, `炸弹`, `地牢`, `囚犯`, `越狱`, `偷`, `海盗`), and monetization (`内购`, `广告`, `看广告`) are scanned even if unused or phrased as disclaimers (`本版本不含内购与广告奖励` → `本版本全部内容免费开放，无需额外解锁`). Use gentle titles/slogans (`用纸把涂鸦精灵画进图鉴当伙伴` instead of `用纸把涂鸦怪物画进图鉴当伙伴`) and verify `dist/` with the sensitive-keyword grep gate before packaging.
5. **Migrate legacy `localStorage` save keys without literal strings**: When renaming persisted save fields (`kills` → `erased`, `ghost` → `faded`), construct legacy keys via `String.fromCharCode(...)` inside `save.js` migration logic so existing player progress is preserved with zero sensitive string literals in `dist/`.
