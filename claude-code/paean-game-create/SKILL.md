---
name: paean-game-create
description: Create or substantially upgrade a production-quality, self-contained Paean web game. Use for new games, game prototypes that must be finished to release quality, or broad gameplay/visual/UI polish. Produces a directly runnable pure-JavaScript index.html project; not for SDK-only integration or publishing.
---

# Paean Game Create

Build a complete, commercially polished web game rather than a rough demo. The result must be
coherent in gameplay, art direction, characters, enemies, abilities, UI, audio, and presentation.
Do not call placeholder art, generic large color blocks, incomplete systems, or an unpolished
prototype finished.

## Start with a production brief

Before implementation, establish the game's fantasy, core loop, input model, session length,
progression, fail/win states, target orientation, art pipeline, and performance budget. Make
reasonable creative decisions when the user leaves these open. Prefer an original direction; when
references are supplied, extract principles and produce a more resolved result rather than a close
copy.

Read [references/production-standard.md](references/production-standard.md) before building. It is
the release bar and contains the attract-mode pattern, responsive layout rules, asset guidance, and
acceptance matrix.

## Choose the rendering approach deliberately

Use the smallest technology that can deliver the intended look at a high level: Canvas/WebGL or a
locally bundled Three.js runtime, authored SVG with skeletal animation, a suitable 2D physics
engine, or a real pixel-art pipeline. Technology is not a substitute for art direction.

- Pixel art needs a controlled palette, consistent pixel density, readable silhouettes, authored
  animation, and crisp integer scaling.
- Vector/skeletal 2D work must choose a coherent cartoon language suited to the theme—for example
  Japanese animation-inspired, American animation-inspired, or chibi—with an explicit head-to-body
  proportion system. Use refined layered rigs, clean deformation, and fine palette-aware linework;
  never fall back to coarse thick black contours or hinged paper-doll motion.
- 3D work needs strong composition, material/lighting discipline, depth, motion, and detail; flat
  undifferentiated shapes are not a finished visual system.
- Image-led adventure/AVG work should use high-quality generated or authored imagery where
  appropriate, then crop, resize, compress, and preload it for fast mobile startup. Use an
  image-generation or image-editing skill when available and the art direction benefits from it.

Keep characters, monsters, abilities, effects, environment, typography, and UI in the same visual
language. Avoid emoji as game art or interface icons; author or bundle real icons instead.

## Required project shape

Create each game in its own deployable directory. The directory must contain everything needed at
runtime and must not import code or assets from a parent, sibling, remix-source, CDN, or other
external location.

- Top-level `index.html` is the runtime entry and works from a static HTTP server without a build.
- Implementation is browser JavaScript, HTML, and CSS only: no TypeScript and no Vite/build-only
  source whose usable result exists only in `dist/`.
- Split gameplay, rendering, input, audio, data, level, character, monster, and ability definitions
  into focused files when that improves extension. Keep individual source files compact enough to
  review and iterate; do not replace useful boundaries with one monolithic file.
- Bundle required runtimes and assets inside the game directory. Prefer procedural/vector assets
  when they genuinely meet the visual bar, not merely to avoid making art.
- Put `<!-- Copyright (c) 2026 paean.ai and the game's creator(s). -->` immediately after the
  opening `<head>` tag.
- Ship top-level `favicon.svg`, an exactly 800×400 `banner.jpg`, and an exactly 512×512
  `icon.jpg` (the square tile used by the library, home-screen shortcuts and native grids);
  follow the production standard's banner-production workflow rather than treating any of them
  as a placeholder. The icon is a composed square crop of the same art direction, not the
  banner squashed.
- Use English as the primary and fallback language unless the user requests otherwise. Route all
  player-facing copy through a central locale catalog and translation function; do not scatter
  display strings through gameplay, UI, or canvas-rendering logic. Define locale configuration so a
  new language can be added as a resource without changing mechanics. Design text containers for
  expansion, wrapping, suitable fonts, and future RTL direction. Additional translations are not
  required unless requested. Minimize copy through clear, authored icons and spatial feedback.

During the production brief, inspect the current `paean-sdk` skill's capability router and read
only the IAP, IAA, Net, Rank, or AI design guides that fit the game. Record player benefit, entry
point, API/scope, state/recovery, and verification for selected features. Prefer documented Paean
SDK capabilities over bespoke third-party services when they
fit the work: cloud save, shared leaderboards, shared app data, paid apps / durable products
(`access.*`), in-app purchases and tips, rewarded ads, online rooms, AI, and share are all
documented in the current SDK (1.10). Do not add platform features as checkboxes, invent APIs, or
let consent/monetization interrupt attract mode or core play. Keep graceful local fallback where
applicable, and obtain user approval before enabling monetization.

Every game ships the paid-app gate whether or not it is sold: the first intentional tap that
would start a real run calls `PaeanSDK.access.require()` (or the reference module's
`platform.requireAccess()`) and only starts the run when it resolves `unlocked: true`. Free
apps resolve instantly with no UI; a paid listing (declared later with `paean-publish
--price`) then works without touching the code. On `unlocked: false` the game stays in its
demo with the entry point visible and, when `status.shellUrl` is set and `hosted` is false,
offers "Open on 8x.gg" via `access.openShell()`. Never call the gate at boot or during the
attract loop. Prove it with the mock host (`paean-sdk/reference/mock-bridge.js`,
`{ access: { model: 'paid' } }` and `{ …, decline: true }`).

Use `paean-publish` only after the game passes this skill's release checks and the user
authorizes the public destination.

## Implement through complete playable slices

Build the smallest full loop first: launch/attract state, start, meaningful play, feedback,
success/failure, restart, and persistence where applicable. Then deepen content and presentation.
Every mechanic needs readable anticipation, action, impact, recovery, and feedback. Tune touch
targets, difficulty, camera, hit feedback, transitions, pause/resume, and audio as one system.

After essential assets finish loading, automatically enter a clean arcade-style attract mode with
no start input required. Immediately stage a deterministic highlight of the core mechanic with no
gameplay HUD, menus, controls, consent prompts, or platform UI. Let the scene read fully UI-free
before any optional restrained `DEMO · TAP TO PLAY` cue fades in. The first intentional touch/click
stops every demo process, reveals only essential play UI, and enters a deterministic fresh run.

## Mobile, desktop, and runtime behavior

Design mobile/touch first with portrait as the primary composition. Unless the core mechanic
intrinsically requires a fixed orientation, support both portrait and landscape by recomposing the
camera, playfield, HUD, and controls rather than merely shrinking or rotating them. When one
orientation is genuinely unsuitable, provide an intentional branded rotate treatment. Adapt across
narrow and short phones, tablets in both orientations, and desktop resolutions. Prevent document
scrolling, overscroll, accidental selection, and canvas drag. Respect safe areas and Paean host
chrome. On desktop, compose the playfield intentionally—usually a centered game frame with a
suitable `max-width`, while backgrounds can extend to the viewport. Never stretch portrait
gameplay into a loose full-width desktop layout.

Pause or safely throttle when hidden. Handle resize, orientation change, pointer cancellation,
audio unlock, and restart without corrupting game state. Keep startup and total transfer small;
prefer compact MIDI/WebAudio sequencing and a restrained reusable sound bank when audio adds value.

## Validate before claiming completion

Let `$SKILL_DIR` be the directory containing this `SKILL.md`. Run the bundled validator from the
game directory's parent:

```bash
node "$SKILL_DIR/scripts/validate-game.mjs" <game-directory> \
  --screenshots <temporary-screenshot-directory>
```

Install Playwright/Chromium in the working environment if the validator reports it missing. Do not
replace this with a static-only check for final acceptance. Inspect every screenshot at full size;
these initial-load captures must show the automatic attract highlight, not a loading screen, title
menu, or idle scene. Iterate on composition, hierarchy, legibility, touch affordance, visual
artifacts, and desktop framing. Also play several complete sessions on touch-sized and desktop
viewports.

Completion requires all of the following:

- validator exits successfully with no page errors, console errors, failed local assets, forbidden
  external/runtime paths, or viewport scrollbars;
- loading → automatic UI-free attract highlight → play → result → restart works, and core
  interactions are verified rather than merely loaded;
- portrait and landscape phone, portrait and landscape tablet, and desktop screenshots meet the
  production standard (including an intentional rotate treatment where justified), with no
  placeholder or half-finished state;
- the game remains playable after reload and after background/foreground transitions;
- final project size and largest assets are reviewed, with obvious waste removed.
