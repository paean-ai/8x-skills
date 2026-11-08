# Executable preservation adapter

The `assets/adapter/` package is an experimental shared runtime developed against the two immutable case exports. It executes their original code; it does not ship a replacement game, a WebView, or copies of the upstream games. Acquire the source with the existing remix workflow and retain its lineage/license separately.

## Reproduce a build

Copy `assets/adapter/` into a tooling directory, change into that directory and run `npm ci` and `npm test`, then `node build-port.mjs --source /absolute/source --out /absolute/port --id SOURCE_HASH --origin https://original.clide.app --appid ACTUAL_TEST_OR_GAME_APPID --diagnostics`. The source root must contain `index.html`. `--tooling` can point at a different directory containing these exact npm dependencies. Omit diagnostics for minified output; debug and release have the same original game behavior. The tool does not publish or change networking settings.

The compiler retains the HTML and compiled CSS rules in `source-data.json`, bundles original scripts/modules as `original.js`, and injects the environment before original code executes. `import.meta.url` maps to the original origin and relative module path; same-origin asset requests resolve to packaged files. CanvasTexture/Three code remains in the original dependency graph. Remote executable dependencies and import maps require explicit local vendoring/alias work; the builder fails rather than silently excluding them. Static assets are retained, including files whose names resemble marketing images. Build/source metadata, dependency trees and private directories do not enter output. `THIRD_PARTY_NOTICES.txt` contains runtime dependency notices; retain original license files too.

The source digest checker is independent of the builder. Run it before and after conversion. Rebuilding only overwrites a prior output identified by the same source ID; symlink aliases into the immutable root are rejected. Do not use a source directory as output.

## Runtime layers and pins

| Component | Pin | Responsibility |
|---|---|---|
| Linkedom | 0.18.15 | Real parsed tree, selectors, dynamic HTML, DOM properties |
| css-tree | 3.2.1 | Build-time CSS rules, media and keyframes |
| taffy-layout | 4.0.0 | Flex/grid/block layout through bundled WASM |
| canvg | 4.0.3 | Original inline/generated SVG to native offscreen Canvas2D |
| core-js | 3.51.0 | URL and URLSearchParams |
| abort-controller | 3.0.0 | Scoped AbortController, including Three imports |
| fast-text-encoding | 1.0.6 | UTF-8 codecs |
| esbuild | 0.28.2 | Local module compilation/injection |

`environment.js` owns the first/display canvas, creates distinct original logical/offscreen canvases, unwraps image/canvas arguments, bridges native touch/keyboard/visibility/resize, and namespaces saves by source ID. `inject.js` supplies browser globals without rewriting source files. `style.js`, `layout.js`, `text.js`, `motion.js`, `paint.js`, `gradient.js`, `projection.js` and `hit.js` interpret the original UI. `events.js` prevents duplicate on-property dispatch. `svg.js` restores canonical SVG element names at the HTML-to-XML boundary, preserving gradient definitions created by innerHTML. `diagnostics.js` is opt-in, writes only to the test app's private local filesystem, and observes original state without injecting controls.

Taffy's WASM bootstrap is the only dependency-specific source transform: `WXWebAssembly.instantiate('taffy.wasm', imports)` must receive a package path without `./`, rather than browser fetch/ArrayBuffer loading. The compiler asserts each pinned replacement occurs exactly once. Free callback-owned WASM Style objects, and disable integer layout rounding so fractional intrinsic text widths do not wrap unexpectedly.

## Native observations

Checked in WeChat DevTools Stable 2.02.2608070, base library 3.18.0, macOS simulator, logged-in test account. These are local native `compileType: game` projects, not browser previews.

- Snout Riot: original demo, SVG-generated faces, Canvas2D board and WebGL background render. Native entry and valid neighbor drag execute the original core. An earlier native replay changed moves 17 → 16, turns 0 → 1, score 0 → 180, with no adapter errors. Pause, scrolling and English → Chinese switching work. The original level and language restore after compilation. The final build was reopened successfully. After automation mouse gestures stopped delivering further wx touches, the user manually verified matching and audible original sound in that final build on 2026-11-08 (reply: “能消除，也有音效”). This manual check passed; its exact move/score values were not independently reported, so the earlier telemetry stays separate. Native backgrounding suspended audio and stopped frame advancement; foregrounding restored running audio and frames with the same game state.
- Quillionaire: original Three r180/WebGL2 world, terrain, characters, shadows and postprocessing render. Native camera input changed yaw; holding THWACK produced the original swing state and released cleanly. The user manually verified continuous joystick movement and audible original synthesized sound (reply: “能移动，也有音效”). Original shop tabs scroll horizontally; wardrobe scrolls vertically and retains the original model preview. Third-person selection persisted after compilation.
- The case evidence JSON separates these observations from earlier pure-core/mock probes. No iOS/Android, production domain, cloud account, payment or ad-service parity is asserted by these results.

## Bugs worth retaining as regression cases

1. **Do not equate dead simulator input with broken game controls.** Native `wx` touch callbacks were absent while the simulator's DOM still received mouse events. The Sensors Touch override fixed native callbacks. Reapply after a new session when needed; do not add a fake click-to-game shortcut.
2. **Linkedom on-property handlers already register listeners.** Calling `onclick` again after its registered listener toggles settings twice and can duplicate purchases. Dispatch it once; a plain adapter window object's handler still needs invocation when unregistered.
3. **Text nodes inherit text style, not the parent's transform/opacity/animation.** Otherwise labels transform or fade twice. Measure and paint with the same line-breaking, letter spacing and text-transform rules.
4. **SVG scaling belongs to the viewport.** Set explicit raster dimensions and let the original viewBox scale once. Combining that with Canvg `scaleWidth` doubled the scale and clipped icons.
5. **A hidden modal can have a zero-width previous containing block.** Recompute percentage/calc constraints against its current parent when it opens. Remove hidden subtrees from layout for performance, then rebuild when shown.
6. **Hit testing follows transformed geometry and scroll clipping.** Invisible children must not intercept touches; cancel a pointer when a scroll gesture takes ownership. Preserve identifier 0 and every changed touch.
7. **Mini Game base64 helpers are not guaranteed.** The browser adapter's Latin-1 codec retains all 256 byte values used by the original exploration save. Do not assume Mini Program API declarations apply to games.
8. **Native synthesized audio is required.** Use `wx.createWebAudioContext`, verify required oscillator/filter/convolver/compressor methods and actual audible output. An empty `AudioContext` object is not compatibility.
9. **The IDE command shortcut is focus-dependent.** `Cmd+Shift+P` in the outer IDE starts Preview/upload. Open debugger commands only with confirmed debugger focus. A preview upload was accidentally initiated during development and canceled; it is not part of this workflow.
10. **Cancellation and RAF generations matter.** Empty native TouchCancel payloads must cancel all active pointers. A pending callback from before Hide must become inert after Show; a generation guard prevents duplicate loops even when native RAF is not canceled.
11. **Installation can depend on npm invocation.** Node 26.8.2/npm 11.19.1 failed an isolated absolute `npm ci --prefix` invocation with a spurious missing local package, while `cd adapter && npm ci` succeeded. Use the verified cwd form; retain the lockfile.
12. **Project registration matters.** CLI-created temporary projects were misclassified and requested app.json. GUI import with compileType game/test ID worked. If an already registered project disappears from the list, import its path and choose “直接打开”; do not replace it with a new app.

## Scope still requiring acceptance

The runtime is deliberately small relative to a browser. Its inline formatting is a wrapping text/element layout, not a full browser inline formatting context. CSS 3D planes use a projective mesh. The original gold-card component was invoked as a UI regression fixture: its patterned back, timed flip and gold front rendered without changing currency or source code; this does not prove a naturally earned card or every rarity variation. Multiple/inset/spread shadows, all filter/blend/mask combinations, animated layout properties, font matching and some background sizing/position combinations need further fidelity comparison. Do not describe these as removed source features: the original instructions remain present, and any observable mismatch must be fixed in the shared runtime.

Do not call a whole-game parity pass from a boot screen or a single play sequence. Continue the feature ledger for results, every secondary system, interrupted gestures, multi-touch, orientation/size changes and native saves. Test release/minified output separately. Same-seed browser/device comparison and physical iOS/Android performance remain separate acceptance stages. Host-bound Paean services need a real authorized host/backend bridge; standalone local fallbacks do not prove hosted service equivalence, and fabricated service success is prohibited.

## Built-runtime regression

Run `node "$SKILL_DIR/scripts/check-built-runtime.cjs" ./weapp-port --report runtime-contract.json` against both debug and minified output. It loads the actual bundled environment and WASM with a wx/Canvas mock. It covers simultaneous pointer IDs 0/9, empty cancellation, capture cleanup and both callback orders over three hide/show cycles. It deliberately does not execute gameplay or claim native visual/audio verification. The checks were also run against the earlier broken package and failed there, so they guard the demonstrated regressions.

Use `npm test` from the adapter directory for intrinsic SVG sizing in centered flex columns, wrapping labels, and canonical linearGradient serialization. These cover the actual missing-card-art and black-gradient failures discovered in the original card component.
