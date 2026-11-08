---
name: paean-convert-to-weapp
description: Port a Paean or clide.app web game to a native WeChat Mini Game (微信小游戏) through compatibility layers while preserving its original gameplay, renderer, HTML/CSS UI and assets. Use for weapp conversion, Three.js middleware selection, or diagnosing browser API gaps; not for remaking the game or wrapping a website in a Mini Program WebView.
---

# Paean Convert to Weapp (Cursor)

Keep the original game implementation and make its environment compatible with WeChat Mini Games. Produce a reproducible adapter-based port, or a concrete adapter-gap report when the requested fidelity is not yet attainable. The bundled experimental runtime executes both case games in WeChat DevTools. It covers their native graphics, DOM/CSS UI and input boundaries, but is not a universal browser implementation or a proof of complete device/service parity.

> **Using this skill in Cursor.** Install this directory under `~/.cursor/skills/`
> or the project's `.cursor/skills/`. Cursor also discovers `.agents/skills/` and
> compatible Claude/Codex roots; avoid duplicate installations of the same skill.
> Find it in Customize → Skills, or type `/paean-convert-to-weapp` in Agent chat.
> Keep scripts and references beside this file and resolve their paths from this directory.
> Run commands in the project directory when the workflow requires project files.
> Local global skills are not automatically available to Cloud Agents; use project skills
> or the user's chosen Cursor sync setup for remote work.

## Preserve the implementation

The default contract is **移植，不重制**: retain game rules, state machines, physics, renderer/engine version, shaders, original DOM UI code, layout/style inputs, art generators and audio logic. A port must still execute the original game, including its menus and secondary systems.

- Keep extracted sources immutable. Put platform adapters, bundler configuration, generated asset caches and test harnesses outside them. Check the source digest before and after work.
- Bundle ESM to local executable modules, inject environment objects, remap resource URLs and implement API backends through adapters. Record transforms and prove equivalent behavior; do not use broad regex deletion to make compilation pass.
- Do not replace Three.js with a different engine or downgrade r180 to an adapter's r108/r133. Do not replace HTML menus with newly authored Canvas screens, substitute a simplified game loop, silently mute audio, remove postprocessing or fake successful cloud/pay/ads calls.
- A placeholder `document`, no-op style object or empty `innerHTML` implementation does not preserve UI. Missing rendering or interaction is an adapter gap even if exceptions disappear.
- If a device lacks an essential GPU capability, state that compatibility boundary. Improve the adapter or use an already-existing equivalent source path; do not fabricate support by bypassing the capability check.

## 1. Acquire and fingerprint the exact work

Use [paean-remix](../paean-remix/SKILL.md) for source retrieval and lineage. Honor the user's existing authorization. For two independent conversion cases, make two single-source remixes so each gets full binary assets; do not accidentally combine the games or use a text-only secondary as a complete export. Preserve each `.clide/publish.json` and `clide.json` outside release output. Downloading does not authorize publishing.

Run the read-only inventory against the actual extracted root, not the scaffold's parent:

```bash
node "$SKILL_DIR/scripts/audit-source.mjs" "$SOURCE" > source-audit.json
```

The report includes file hashes, package-source bytes, module entry hints, Three revision and browser API findings. It skips hidden metadata, credentials.json, dependency directories and symlinks, and reports those omissions. Its regex findings include unreachable code and can miss aliases: inspect actual entry dependencies. Source-byte size is not compiled upload size.

For the two studied works, read [case-studies.md](references/case-studies.md). It records exact source snapshots, preserved module seams, observed middleware failures, and what was actually tested.

## 2. Select middleware before writing an adapter

Read [middleware.md](references/middleware.md) for Three.js or browser-engine games. Check the current upstream code, npm metadata, license, platform entry and exact engine version. Distinguish a Mini Program Canvas adapter from a **Mini Game** adapter.

Prefer extending a suitable existing layer over recreating its Web API coverage. Keep browser-only dependencies scoped through bundler injection/aliases where possible. Do not install an adapter's bundled old Three alongside the source's newer Three. Commercial middleware is an optional dependency for licensed users, not code to redistribute in this open skill.

Test more than a rotating cube: initialize the source renderer version, preserve its render targets/shaders, render its CanvasTexture, dispatch all changed touches, cancel them, and mount/interact with its actual DOM UI. Pin the version/commit that passes. Middleware claims and successful bundling alone are insufficient evidence.

## 3. Build the compatibility boundary

Use [adapter-contract.md](references/adapter-contract.md) to implement the required surfaces:

| Layer | Original implementation retained | Adapter responsibility |
|---|---|---|
| Bootstrap/modules | Original HTML script order and module dependency graph | Compile local modules; install environment before evaluating source |
| Graphics | Canvas2D commands, Three version, materials and shaders | Screen/offscreen canvas identity, GPU interface, compositing, resize |
| DOM/CSS | HTML, stylesheets, dynamic innerHTML and existing UI handlers | DOM tree, selector/style/layout/paint semantics, focus and event propagation |
| Input/lifecycle | Original pointer/key/game handlers | wx touch identifiers → DOM events; capture/cancel; visibility/RAF/audio |
| Assets/audio | Original image/SVG generators and sound graph | Equivalent decoding/cache and wx audio backend |
| Storage/services | Original save and service interfaces | Namespaced persistence, authorized transport, explicit unavailable capabilities |

Track every unsupported surface with the triggering file/line, observable impact, proposed adapter implementation and a regression fixture. Reuse fixes across both cases. Do not scatter game-specific branches such as `if (title === 'Snout Riot')` through the shared runtime.

The runnable case adapter is bundled in [assets/adapter](assets/adapter/). Copy it to a project tooling directory before installing dependencies:

```bash
cp -R "$SKILL_DIR/assets/adapter" ./weapp-adapter
(cd ./weapp-adapter && npm ci && npm test)
node ./weapp-adapter/build-port.mjs \
  --source "$SOURCE" --out ./weapp-port \
  --id "$HASH" --origin "https://ORIGINAL.clide.app" \
  --appid "$WECHAT_GAME_APPID" --diagnostics
```

Omit `--diagnostics` for a minified release build without the local verification writer. Keep release output separate from source and unrelated projects; the builder refuses overlapping roots and unrelated nonempty output. Supply the actual original origin, not its Square listing URL. Read [actual-runtime.md](references/actual-runtime.md) for pinned dependencies, API mappings, confirmed native evidence and remaining compatibility boundaries. Test the exact final output again after any adapter change. Run `node "$SKILL_DIR/scripts/check-built-runtime.cjs" ./weapp-port` for built DOM/WASM touch-cancel and lifecycle regressions; its wx mock is separate from native acceptance.

DevTools test accounts can run these local simulator cases: obtain a test AppID through the logged-in **小游戏 → 导入 → 测试号** UI. The literal `touristappid` was rejected by the tested DevTools build. A test ID is not proof of production services or phone compatibility. Never embed the example user's test AppID in reusable skill files.

If real simulator taps do nothing, check whether `wx.onTouchStart` fires before changing game code. In the tested DevTools, **Debugger → Sensors → Touch → Force enabled** restored native callbacks; after compilation, toggling Device-based then Force enabled sometimes reapplied it. A synthetic `__port.dispatchPointer` pass cannot substitute for this test. To open Sensors, first confirm that the debugger has focus; the outer IDE's `Cmd+Shift+P` is **Preview/upload**, not the debugger command menu.

An optional native substrate probe is available:

```bash
node "$SKILL_DIR/scripts/init-weapp.mjs" \
  --dir ./runtime-probe --namespace example.weapp.probe \
  --orientation portrait
```

It creates `game.js`, `game.json`, `project.config.json` and `wx-runtime.js`. This is a diagnostic surface for touch, resize, save and lifecycle behavior, **not either converted game and not a DOM adapter**. It uses `touristappid` unless `--appid wx...` is supplied; this placeholder may be rejected. Use an obtained test AppID for simulator work and a valid game AppID for device/service validation. Reuse its mechanisms inside the selected adapter, not by rewriting game calls to its API. When integrating another middleware, one component must own the display canvas, touch registration and frame clock; do not instantiate competing runtimes.

## 4. Package without changing behavior

- Keep one copy of the original engine and its notices. Bundle runtime code locally; preserve shader sources and generated assets. Do not load executable code from a CDN.
- Retain original HTML/CSS as adapter inputs or compiled equivalent DOM/style data. They are not a WebView page. Build-only caches and originals can stay outside the upload root.
- Use `game.js`, `game.json` and a DevTools `compileType: "game"` project. Preserve the game's existing orientation behavior where supported; route window-size changes into the original layout logic.
- Keep source archives, `.clide/`, credentials, tooling dependencies and reports out of the release package. Plan conservatively around a 4 MiB main package, then verify current official limits and the actual DevTools result; use subpackages when required, not unneeded remote downloads.
- Keep source attribution and upstream licenses. A generated scaffold's MIT label is not a license grant for missing upstream notices. Do not change access terms or publish as part of conversion unless requested.

## 5. Verify fidelity, not only boot

Follow [validation.md](references/validation.md). Compare the original browser game and adapted game using the same seed/save/input sequence: rules and results, UI screenshots and hit targets, sound, resize, multi-touch, interrupted gestures, background/foreground, persistence, and service outcomes. Retain original optional/offline behavior; report unavailable service parity rather than returning fabricated success.

```bash
node "$SKILL_DIR/scripts/assert-source.mjs" "$SOURCE" source-audit.json
```

With `esbuild` installed in an isolated tooling directory, the bundled case probes can be rerun there:

```bash
node "$SKILL_DIR/scripts/probe-cases.mjs" --snout "$SNOUT_SOURCE" --quillionaire "$QUILLIONAIRE_SOURCE"
node "$SKILL_DIR/scripts/probe-platformize.mjs" "$PLATFORMIZE_CHECKOUT"
```

These execute reviewed source/dependency code locally. The first verifies unchanged pure cores and reports Three import gaps in a VM; the second exposes middleware API gaps in a wx mock. Neither is a full-game, GPU, DevTools or real-device pass.

Report source links and local paths, source digests, pinned middleware and engine versions, added adapter files/transforms, tested environments, known gaps and next required acceptance step. Clearly distinguish source acquisition, static analysis, mock/core tests, full-game DevTools parity and iOS/Android device parity. Never label a blank screen, replacement demo or pending adapter as a completed conversion.
