# Middleware selection — checked 2026-11-07

Scope: preserve the source engine and game implementation. Recheck releases before reuse; version ranges are not proof of compatibility with every revision.

## Candidates and costs

| Candidate | Verified platform/version facts | Decision for these cases |
|---|---|---|
| [wechat-miniprogram/threejs-miniprogram](https://github.com/wechat-miniprogram/threejs-miniprogram) | README describes a Mini Program Canvas-node scoped Three, based on **0.108.0**; npm latest queried separately when selecting | Not a drop-in for Quillionaire r180. Replacing its engine would break the preservation contract. |
| [three-platformize](https://github.com/deepkolos/three-platformize) | README points future maintenance to platformize; npm `1.133.3`, MIT | Historical reference; do not swap its old Three into the original game. |
| [platformize](https://github.com/deepkolos/platformize) | `platformize@1.0.3`, MIT, generic build-time global injection and a WechatGamePlatform; checked repository commit `124af6a9ab8bfd89c173344d1ae04f0e9f0350bd` | Best open starting point **to evaluate/extend**, not a ready port. Preserve source r180, update the adapter contract and injection rules. |
| [platformize-three](https://github.com/deepkolos/platformize/blob/main/packages/platformize-three/package.json) | `0.133.1` directly depends on `three: 0.133.1` | Its unmodified dependency/plugin recipe is not evidence for r180. Avoid introducing a second engine or applying version-specific shader patches blindly. |
| [@minisheep/three-platform-adapter](https://three.minisheep.cn/guide/essentials/in-minigame.html) | Explicit `/wechat-game` entry; registry metadata returned adapter `2.0.4`, polyfill core `1.1.5`, Three peer `>=0.151.0` | Candidate for users with an appropriate license. Metadata says **Commercial License (Non-transferable, for use by authorized users only)**. Do not vendor it into 8x-skills or imply a free option. r180 game/device parity remains unverified. |
| [Boen36/threejs-miniprogram-adapter](https://github.com/Boen36/threejs-miniprogram-adapter) | Modern Mini Program WebGL2 adapter. Its README labels it experimental, lists Node version-matrix tests and says DevTools/iOS/Android validation is pending | Useful modern Web API reference; not established Mini Game support or device proof. |

The Minisheep [public Mini Game template](https://github.com/minisheeep/threejs-miniprogram-template/tree/wechat-game-ts) at `df8fb2af099d9ef7ada868043602dbd5470a57f1` declares Three `^0.172.0`, not this source's r180. Its [support table](https://three.minisheep.cn/guide/compatibility.html) distinguishes supported WebGLRenderer/CanvasTexture from unsupported CSS2DRenderer, CSS3DRenderer and SVGRenderer. That is not a claim to implement arbitrary HTML/CSS UI.

The template also contains a renderer `setRenderTarget` depth-clear workaround. Do not copy that into every game: clearing depth indiscriminately can alter multipass rendering. Reproduce the actual device issue with the source's passes and constrain any workaround to the affected operation.

## Measured platformize gaps

`probe-platformize.mjs` bundled the upstream TypeScript with esbuild and instantiated its Mini Game adapter in an isolated wx mock. At the commit above it observed:

| Contract | Result |
|---|---|
| `document.getElementById` | undefined |
| `document.createElement('div')` | returns undefined |
| Repeated `document.createElement('canvas')` | returns the same supplied display canvas |
| `AbortController` | absent from its polyfill |
| `new window.AudioContext().createOscillator` | undefined; constructor is a stub |
| Registers `wx.onTouchCancel` | no |
| Two changed touches → pointerdown identifiers | only first identifier forwarded |

These are observed gaps for these games, not a statement that the library cannot be extended. For example, Snout Riot has multiple visible canvases; Quillionaire generates offscreen plant textures and needs simultaneous joystick/action input. Returning one canvas for every request or forwarding only the first changed touch is not behavior-preserving.

## Recommended evaluation sequence

1. Record the original engine revision and vendor hashes. First try a generic platform adapter/injection layer with those exact files; never infer that matching the word “Three” makes two versions interchangeable.
2. Install environment bridges before source module evaluation. A bare import of the r180 vendor module in the case probe fails at `AbortController`; this happens before proving any GPU behavior.
3. Verify APIs used by the actual game: SVG/data-image decoding, procedural CanvasTexture, pointer capture/cancel, CSS geometry and AudioContext graph nodes. Test actual contracts, not whether names merely exist.
4. Run unchanged renderer/shaders/materials through the target context. Modern Three WebGLRenderer requires WebGL2; [upstream documentation](https://threejs.org/docs/pages/WebGLRenderer.html) says WebGL1 support ended in r163. Adapter JavaScript cannot manufacture unsupported GPU features.
5. Preserve original HTML, CSS and DOM mutations via a real layout/painting/event backend. If middleware only provides canvas/image shims, scope and implement the missing DOM layer separately. Do not treat it as permission to rewrite the UI.
6. Compare both full games, then pin a reproducible toolchain and measure bundle size, startup, memory and frame time. Until those pass, describe the choice as an evaluated candidate.

## Recheck metadata without changing machine settings

```bash
npm view platformize version license --json
npm view platformize-three version dependencies --json
npm view @minisheep/three-platform-adapter version license peerDependencies \
  --registry=https://npm.minisheep.cn --json
```

The last command is a public metadata lookup, not a license or authorization to download/use commercial code. Use a project-local scoped registry only if that dependency is actually selected and authorized. Do not change global npm registry, system proxy or VPN to perform this evaluation.
