# Preserving the original implementation through adapters

## Architecture and accounting

```text
unchanged original HTML / CSS / JS / Three / art and audio generators
                         |
             deterministic build / module injection
                         |
   browser contract: DOM + CSS + events + images + sound + services
                         |
     wx canvas / WebGL2 / touch / lifecycle / storage / audio / network
```

The original UI code must keep creating and updating its elements. A Canvas-based **backend for DOM rendering** is allowed: it implements the original APIs/layout/styles and consumes the original document. Writing a new Canvas HUD in place of that UI is a different implementation and is not an adapter.

Keep `upstream/`, `adapter/`, `build/`, `dist/` and `evidence/` separate. Record engine and source hashes, package locks, per-API support, build transforms and comparison results. A source digest alone does not prove preservation if a bundler silently substitutes a different game; inspect the entry dependency graph and transform log too.

Low conversion cost comes from amortizing the browser compatibility layer across games. These two cases do not justify claiming an existing complete HTML/CSS runtime. The first source requiring a missing CSS or event feature has real adapter-development cost; subsequent sources should reuse it.

## Bootstrap

- Parse original HTML and load its styles/document before the scripts that query elements. Preserve classic-script order and module dependencies. For these cases, `paean-sdk.js` then `paean-platform.js` precede `js/app.js` or `js/main.js`.
- In a CommonJS bootstrap, install the adapter before requiring the bundled original entry. Static ESM imports can evaluate before a preceding-looking setup statement: control execution order explicitly.
- Bundle local modules without eval, `new Function`, remote executable downloads or runtime script injection. AST transforms may qualify globals or module paths; do not remove source behaviors to eliminate errors.
- For vendor globals such as `AbortController`, `URL`, `TextDecoder`, `Image`, `document`, `window` and `navigator`, implement the subset actually needed with correct semantics. No-op cancellation is not a complete AbortController when loaders use its signal.

## DOM, styles and compositing

Audit and test APIs from both initial HTML and dynamically generated UI, including overlays reached after play. Preserve selectors, id/class updates, `innerHTML`, text nodes, attributes/hidden state, `classList`, parent/child relationships, `closest`, focus, scrolling, bounding rectangles and event listeners.

CSS compatibility requires more than retaining a stylesheet string. The adapter must calculate and paint the used selectors, cascade, inherited values, custom properties, media queries, lengths, flex/grid, positioning, transforms, clipping, borders, gradients, text metrics and animations. Record the supported subset and stop on a required unsupported behavior. Libraries such as [WeChat Layout](https://github.com/wechat-miniprogram/minigame-canvas-engine) are potential layout/paint components; they do not promise a drop-in browser DOM/CSS engine. A translation backend must preserve the original inputs and be validated, not manually redesign the interface.

WeChat's [Canvas API typings](https://github.com/wechat-miniprogram/minigame-api-typings/blob/master/types/wx/lib.wx.api.d.ts) document that the first `wx.createCanvas()` is the screen and subsequent ones are offscreen. Reserve the display surface before middleware creates texture canvases. Model separate logical canvases accurately; do not return the display canvas from every `createElement('canvas')`.

For a multi-canvas 2D game, composite the original canvas layers and DOM paint in correct z-order. For a 3D game with DOM HUD, a possible backend is a HUD canvas uploaded as a texture and composited after the **unchanged** game's render/postprocessing. That is a proposed adapter architecture, not a tested solution in this skill. It must preserve depth/viewport/blend state, input hit testing, resolution, color behavior and screenshot parity. Merely appending an offscreen canvas cannot display a HUD.

## Coordinates and input

Keep three coordinate systems explicit: window coordinates, original CSS/layout coordinates, and framebuffer pixels. Apply backing-store DPR once. `getBoundingClientRect()` must describe the same rectangle used by layout and compositing; map touches through that rectangle, not through a fake full-screen rect.

Forward every `changedTouches` item using its stable `identifier`, including `0`. Implement pointerdown/move/up/cancel, primary-pointer state, pointer capture, capture/bubble phases, currentTarget/target, preventDefault and propagation behavior required by the original listeners. Suppress duplicate pointer+touch-generated actions. If the source uses browser-generated click after pointerup, reproduce click semantics instead of firing both handlers indiscriminately.

Test two concurrent contacts in Quillionaire: joystick movement must survive a second finger attacking and either finger being cancelled. Snout Riot needs drag/swap accuracy under scaled board geometry. On hide/resize, cancel active contacts so source state never retains a held drag or attack.

Use actual `getWindowInfo()` when available (official typings mark it as base library 2.25.3), with `getSystemInfoSync()` fallback when targeting older libraries. Expose the same resized dimensions to the original window, screen and layout logic. Safe-area/menu bounds must be reflected consistently in both display and hit testing; do not double-apply inset offsets.

The bundled `wx-runtime.js` demonstrates native touch tracking, resize notification, a single frame loop, persistence and hide/show cleanup. It does **not** implement DOM dispatch, CSS, WebGL adaptation or audio. It must not be sold as a universal compatibility layer.

## Lifecycle, storage and services

Translate wx hide/show to the original visibility/page lifecycle. Pause/resume frame delivery and sound, preserve intended game pause state, clear touches and reset frame timestamps. A resumed simulation must not consume the entire background interval as one frame. Dispose listeners/resources on teardown; repeated restart must not multiply input registrations or loops.

Implement `localStorage` string/null semantics over wx storage; validate original save schemas. A storage namespace mapping belongs in the adapter so unrelated ports cannot collide without modifying game state code. On quota/corruption errors preserve useful session state and report persistence failure. Do not pretend an in-memory fallback was durably saved. The diagnostic helper's JSON storage API is an internal substrate, not a drop-in localStorage object.

Paean's browser host bridge may depend on iframe/postMessage/session context. Retain the original SDK-facing interface and document required authorized transport. There is no assumed WeChat implementation of Paean login, cloud save, leaderboard, purchase, rewarded-ad or social APIs. Use existing documented backend contracts only; never embed creator JWTs or AppSecret, fabricate purchase/ad success, or remove an access check. An unavailable optional service may follow an already-existing source offline path, but full service parity remains pending.

## Images, SVG and audio

Keep original procedural art functions. Where native Image cannot decode an original SVG data URL, the **Image adapter** may decode through a compatible renderer or resolve it to an offline cache keyed by exact generated SVG bytes. A build-time raster cache must cover the actual dynamic input domain, sizes and colors; unexpected variants must be handled or reported. An atlas for six default poses cannot claim support for arbitrary generated art. Preserve image `onload`/`onerror`, dimensions and async ordering.

For finite static poses, baking PNGs from the original SVG is a semantics-preserving resource conversion when dimensions, appearance and alpha match. Compare originals and rasters; do not redraw characters. Retain originals as build inputs and their licenses. Snout's observed loader has 6 × 5 pet poses plus 3 obstacle images, a useful finite cache test.

Adapt the original audio graph to `wx.createWebAudioContext()` only after checking actual nodes and parameter scheduling. The current official typings include oscillator and biquad-filter methods; that does not establish support for every browser WebAudio node. Quillionaire uses a convolver/reverb path, so inspect it explicitly. If equivalence cannot be provided, record an audio gap. Replacing procedural sound with a few generic effects or making the constructor a silent stub is not a faithful port.

## GPU contract

Quillionaire's r180 renderer, GLSL3 shaders and half-float multipass effects require real capability tests. Check context creation, shader compile/link, relevant extensions, framebuffer completeness, render-target filtering and multisample paths, then actual output and memory on both iOS and Android.

An extension name alone is insufficient. Preserve source-selected quality tiers and their visual semantics; even its tier 0 uses half-float targets. Do not remove bloom, substitute a WebGL1 renderer or force a lower tier to claim fidelity. Where platform bugs need workarounds, keep them in an adapter patch with a minimal reproducer, an affected-device condition and visual equivalence evidence.
