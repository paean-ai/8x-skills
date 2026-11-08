# Two source-preserving conversion cases

Inspected 2026-11-07. These are source-acquisition and feasibility cases, not released WeChat ports. All game source files stayed unchanged. Machine-readable evidence is in [case-evidence.json](case-evidence.json).

## Snapshot and acquisition

| | Snout Riot | Quillionaire |
|---|---|---|
| Canonical source | [BQDP7Zi1kLshfwCv](https://www.8x.gg/apps/BQDP7Zi1kLshfwCv) | [vgsP3t5lP448vjxa](https://www.8x.gg/apps/vgsP3t5lP448vjxa) |
| Creator | Tika | Esi |
| Full exported files | 30 | 55 |
| Sum of exported bytes | 497,002 | 1,595,514 |
| Entry | `js/app.js` | `js/main.js` |
| Graphics | Canvas2D board/effects + SVG-generated sprites + DOM/CSS UI | Vendored Three.js r180 + procedural world/creatures + DOM/CSS UI |
| External engine files | none | `three.core.min.js` 381,124 B + `three.module.js` 338,908 B |

Each case was acquired through its own single-source `remix.mjs --yes HASH --dir CASE_DIRECTORY` after dry-run. The user's explicit request authorized both downloads. Each clone generated a distinct workspace and preserved the creator/parent graph. There was no combined game, text-only secondary, `--clone-all`, or publishing step.

Case layout:

```text
cases/HASH/
  .remix-sources/HASH/    original export, immutable
  .clide/publish.json     private clone workspace state
  clide.json             parent/creator lineage
  LICENSE                scaffold notice; inspect original notices separately
evidence/                audits, hashes, probes (outside source and release)
```

Snapshot digests from `audit-source.mjs` (sorted relative path + SHA256 per file):

- Snout Riot: `b76a31e52231f2f063f34e1826f9842fd736a70933ace09d0993b338f1600cff`
- Quillionaire: `d54b0fd81cdcbab6d9383042d44b264c0555667c31b33640b0541e0bf2b7bc27`

The source sizes fit within a conservative 4 MiB planning budget, but adapter code, generated rasters, compiled code and package rules still need measurement. Source size alone does not justify a deployment claim or introducing a CDN.

## Snout Riot — preserve the 2D implementation

The original game exposes a clear pure-data boundary: `MatchGame` in `js/engine.js` and seeded level definitions in `js/levels.js`. `js/render.js` retains board animation, squash/stretch, reactions, obstacles and particles. `js/app.js` coordinates the DOM HUD, overlays, map, daily game, rankings and input. These are all part of the game; replacing the last file with a minimal board driver would be a remake of its application layer.

Observed adapter requirements:

- Original HTML has `worldFluid`, `worldLight` and `board` canvases. `WorldFX`, liquid effects and DOM backgrounds require separate logical layers and correct composition.
- `Renderer.resize()` uses `window.devicePixelRatio`; hit mapping uses the board's `getBoundingClientRect()` and a 560-unit board. The adapter's layout and touch mapping must agree.
- `app.js` reads computed CSS/custom properties, media queries, classes and DOM geometry, and generates menus with `innerHTML`. The original CSS files total 27,430 B. A no-op DOM shim cannot preserve those menus.
- `art.js` generates SVG and loads `data:image/svg+xml` through `new Image()`. `loadArt()` requests 30 pet poses (six kinds × idle/silly/pop/blink/reaction) and three obstacle images. Preserve those functions; cache/render behind the Image interface.
- `locale.js`, `save.js`, `audio.js` and platform files require storage, document locale updates, WebAudio and optional host services. Keep their API behavior through adapters.

Evidence: the original engine and levels were bundled without source edits and executed in a VM without `window` or `document`. Seeded levels 1, 12, 30 and 60 produced deterministic initial states; best-move swaps consumed one move each, resolved frames and produced finite scores. The probe exercised 34 valid swaps across those levels. This proves a reusable pure core, **not that the original UI/render/audio already works in WeChat**.

Lowest-cost preservation route: generic browser-contract adapter with an existing Canvas/image/event backend, then the shared DOM/style/compositor and SVG decoder/cache needed by this case. Preserve the renderer and app modules. The largest uncertainty is DOM/CSS behavior, not match-three math.

## Quillionaire — preserve r180 and the original scene

The original `js/main.js` imports local Three r180, constructs the world and uses existing quality tiers. Core economy in `js/game/eco.js` and deterministic terrain in `js/world/gen.js` are separate from rendering. The farm, herd, wildlife, creatures, exploration, controls, UI and shaders are interconnected parts of this game; a single pig model or a reduced collection loop is not a conversion.

Observed adapter requirements:

- `main.js` explicitly rejects a context without `renderer.capabilities.isWebGL2`; the vendored renderer also states WebGL1 is unsupported since r163.
- `js/render/post.js` uses GLSL3, half-float render targets and multiple down/up passes. Tier 0 still uses half-float buffers and three levels; existing high tiers request multisampling. A “low quality” switch does not convert it to WebGL1.
- `js/world/plants.js` creates procedural 2D CanvasTextures. Reusing the visible WebGL canvas for these requests breaks the original implementation.
- `js/ui/ui.js`, `collect.js`, `rares.js`, `explore.js` and initial HTML rely on dynamic DOM UI. Original CSS is 32,855 B. Its visual layer is independent of whether Three successfully boots.
- `js/ui/input.js` uses pointer semantics and several simultaneous controls. A correct adapter must preserve multiple pointer identifiers/capture/cancel and the original DOM hit targets.
- `audio.js` synthesizes music/creature sounds using oscillators, filters and reverb. Audio stubs are not compatible execution.
- The original browser SDK wrapper uses Paean host context; service compatibility is a separate transport task.

Evidence: unmodified ecology/world modules ran without DOM/window; buy/capacity accounting and births stayed within the pen capacity, and repeated seeded terrain samples matched. A separate attempt to evaluate the original Three vendor module in a bare VM failed with **`AbortController is not defined`**. That is an actual environment requirement, not a reason to edit out the loader or change engine revision.

Lowest-cost preservation route: retain the exact vendored r180 files, evaluate existing generic/global-injection middleware, and extend its missing APIs. Preserve postprocessing and original selected quality behavior. Reuse the DOM/CSS compositor developed for the 2D case instead of designing a new HUD. Verify GPU features on actual supported devices; unsupported hardware is an explicit coverage limit.

## Shared work and acceptance status

Reusable across both: original-document bootstrap, DOM mutation/selector/style/layout semantics, image/data URL handling, pointer capture/cancel, window sizing, lifecycle, namespaced storage and service interfaces. Engine-specific adapter work belongs behind those shared interfaces, not in game files.

| Evidence level | Result in this case study |
|---|---|
| Full source acquisition and lineage | Completed for both |
| File inventory / immutable-source digest | Completed for both |
| Pure game-core execution without DOM/window | Passed for both |
| Platformize mock contract probe | Completed; missing APIs documented in middleware reference |
| Native runtime substrate unit tests | Passed; not a browser compatibility layer |
| Full original game executing under shared adapter | Both boot and enter gameplay in native DevTools; runtime bundled |
| DevTools gameplay/UI/audio fidelity | Listed controls, menus, sound and lifecycle verified; full feature replay remains open |
| iOS and Android real-device parity/performance | Pending |
| WeChat review/publication | Not performed; one unintended preview upload was canceled, see runtime notes |

The skill now ships the actual shared adapter and reproducible native projects can be built from both immutable exports. Read [actual-runtime.md](actual-runtime.md) for commands, native evidence, regression fixes and remaining browser/device/service boundaries. This is a tested simulator port candidate, not a complete browser implementation or an all-features/device parity certificate. Close remaining gaps in the shared adapter; do not substitute remade games to turn pending rows into passes.
