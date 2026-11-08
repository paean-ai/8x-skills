# Preservation and compatibility acceptance

## Baseline

Capture original behavior before adapter work: attract/demo, entering play, primary actions, pause/settings, progression/shop/map/results, locale and restart/save restoration. Use the same seed and save when comparing. Record browser size/DPR, source digest and engine version. If an original service requires a host session, record that baseline dependency rather than comparing a failed localhost host bridge with a fully working hosted game.

Record a feature ledger for every source behavior, including secondary menus, optional capabilities and existing quality tiers. A screenshot of core play does not cover the ledger.

## Isolated contracts

Use targeted tests for adapter semantics, including:

- Multiple logical canvas instances and the first native display canvas; offscreen art must not steal the screen or change another context type.
- Real DOM queries/mutations reflected in layout/paint and hit regions; focus, propagation and `innerHTML` listeners must behave as in the original. A library that accepts property assignments but never paints them fails this check.
- Two simultaneous touches, identifier 0, moving outside a target while captured, cancel on interruption/resize, and release without duplicate click/action.
- Window-to-layout-to-framebuffer mapping at DPR 1/2/3, safe-area/menu bounds and both source-supported orientations.
- Visibility/RAF/audio behavior over repeated hide/show; no giant resumed delta, held joystick or duplicate loop.
- Storage missing/null/empty/false/zero semantics, corrupted data, failed writes/removes and successful relaunch restoration. Mock tests cannot prove native persistence.
- SVG variants, texture alpha/dimensions, shader results and actual required audio node/automation behavior.

The repository's `tests/weapp.test.mjs` tests the native substrate, scanner, no-clobber scaffolder and source-integrity checker. The executable adapter's `npm test` additionally covers text, projective geometry, event dispatch and actual Linkedom/Taffy layouts. These contracts complement native observations; they do not certify full visual or device parity. See actual-runtime.md and case-evidence.json for the native scope.

## Original-versus-adapted replay

Replay the same actions in the browser original and target. Compare state transitions and results, visible controls and layout, asset identity, animation timing and sound. All changed pixels need an explanation consistent with the source's rendering and target device; masking the entire HUD or disabling effects is not a fidelity test. Check same-seed outcomes when the source supports determinism; do not inject different game logic just to obtain deterministic screenshots.

Snout Riot: drag valid/invalid swaps, specials, cascading clears, objectives, win/loss, map/daily/settings and exact board hit mapping.

Quillionaire: movement/camera plus simultaneous attack/action, collection/sale/buy/progression, exploration and secondary menus, scene/shader/CanvasTexture output, original quality tiers and procedural sound. Test framebuffer completeness and rendered pixels, not extension strings alone.

## Native environments

Import the final `compileType: game` project in current WeChat DevTools. Record tool and base-library versions, console/errors, compiled package size, first usable frame and controls. An empty diagnostic starter, HTML browser preview or mock `wx` does not satisfy this stage.

With the user's own game AppID and device access, validate iOS and Android, including a representative low-end device within the required GPU support range. Record device/OS/WeChat/base-library, startup, sustained frame time, peak memory, thermal behavior, interruptions, audio and relaunch saves. Check production domain configuration without relying on disabled checks in DevTools. Recheck current package/subpackage limits and feature availability in official docs/DevTools; historical 20/30 MB totals should not become a universal hard-coded rule.

Do not upload, submit for review or publish merely to test local conversion. Missing AppID/device access does not block source analysis or adapter unit tests; report the exact remaining validation stage.

## Sources checked

- [Official Mini Game API typings](https://github.com/wechat-miniprogram/minigame-api-typings), inspected commit `4cae82af7f3c4339d1f11aea8e672fb16051d24a`: createCanvas, window size, touch, lifecycle, storage and audio declarations.
- [Official Mini Game examples](https://github.com/wechat-miniprogram/minigame-demo): native project and API integration examples.
- [WeChat Layout](https://wechat-miniprogram.github.io/minigame-canvas-engine/): optional Canvas layout/paint component, not a browser DOM replacement by itself.
- [Three WebGLRenderer](https://threejs.org/docs/pages/WebGLRenderer.html): WebGL2 requirement and r163 WebGL1 boundary.

Checked 2026-11-07. Several historical developers.weixin.qq.com deep links returned 404 during research; the API declarations and official example repository were used as primary source fallbacks. Recheck live documentation when selecting the release baseline; do not label an unreachable page as verified.
