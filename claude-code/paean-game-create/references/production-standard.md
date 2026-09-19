# Paean game production standard

Use this standard for original games and remixes. It defines the release bar, not a fixed genre or
visual style. A game can be small; it cannot feel unfinished.

## 1. Product coherence

- State the player fantasy and the one-sentence core loop. Every major mechanic, character,
  monster, ability, effect, reward, and UI element should reinforce them.
- Provide a complete session: clear entry, learnable action, escalating decisions, readable
  success/failure, satisfying resolution, and immediate restart or continuation.
- Replace debug controls, placeholder labels, stock primitives, temporary gradients, and silent or
  dead states before release. No visible element should imply a feature that does not work.
- Tune difficulty and pacing through repeated play, including weak starts, edge cases, and recovery
  from mistakes. Avoid wins or losses the player cannot understand.

## 2. Visual direction and animation

- Establish a compact art bible: shape language, palette, contrast hierarchy, typography, camera,
  materials/texture, lighting, effect language, and motion timing.
- Default to a bright, colorful, welcoming casual style suitable for a broad audience. Use a
  coherent palette, friendly shapes, clean surfaces, and restrained highlights, shading, or soft
  depth to make controls and rewards feel tactile. Reserve strong accents for key actions and
  feedback; keep supporting surfaces calm enough that the scene and text remain easy to read.
  A theme-specific direction or explicit user brief may call for dark, muted, realistic, or other
  treatments; record that reason in the art bible and preserve the same clarity and polish.
- Make the playfield readable in motion. Critical actors and threats need distinct silhouettes,
  depth separation, anticipation, contact feedback, and recovery—not only different colors.
- Do not treat large flat color blocks, generic rounded rectangles, or raw engine primitives as
  finished art. Simplicity is valid only when composition, proportion, detail, motion, and surface
  treatment make it intentional.
- Pixel work uses one logical pixel grid, nearest-neighbor scaling, a controlled palette, no mixed
  resolutions, and authored animation with strong silhouettes. Inspect at 1× and final scale.
- Before authoring vector characters, choose and record one coherent cartoon family appropriate to
  the theme—such as Japanese animation-inspired, American animation-inspired, chibi, or another
  deliberate direction. Define shape language and explicit head-to-body ratios for each archetype;
  do not accidentally mix incompatible facial construction, anatomy, or proportions.
- Vector linework must be fine, crisp, and palette-aware. Derive contour color from local forms,
  taper or vary weight intentionally, and keep interior detail readable at final scale. Do not use
  thick pure-black outer contours, crude sticker-like borders, or the same heavy stroke everywhere.
- Build skeletal characters from authored paths and purposeful overlapping layers with well-placed
  pivots, joint coverage, occlusion order, and deformation around shoulders, elbows, hips, and knees.
  Facial parts, hair, clothing, and accessories need controlled secondary motion where visible.
  Animation needs designed key poses, readable arcs, anticipation, impact, recovery, and follow-
  through rather than rigid limb rotation or hinged paper-doll motion.
- Inspect vector characters both enlarged and at final gameplay size across representative idle,
  locomotion, attack/ability, hit, and defeat poses. Silhouette, anatomy, line weight, facial appeal,
  and deformation must remain polished in motion. 3D work uses composed cameras, coherent materials,
  lighting, shadows/depth cues, animation, and mobile-safe post-processing.
- Image-led AVG/adventure scenes need consistent characters, perspective, palette, lighting, and
  crop across the sequence. Generate or author at source quality, then export only the displayed
  dimensions. Prefer WebP/AVIF for scene images where support and alpha needs allow it; preload the
  next likely scene, not the entire story.

## 3. UI and feedback

- Keep the active play HUD to information that changes decisions, giving most of the usable
  screen to gameplay. Place compact status groups and essential controls around the action without
  obscuring actors, targets, paths, or important feedback. Avoid oversized headers, stacked cards,
  repeated labels, and large decorative backplates during play.
- Give each screen or panel a clear primary action and a simple reading order. Use concise labels,
  consistent alignment, and modest spacing. Put settings, help, collection details, and other
  occasional actions behind a compact menu or contextual panel; keep immediate play controls
  visible and discoverable. Teach through brief contextual cues that dismiss after use.
- Use authored pixel-art or SVG/vector icon shapes rather than emoji. Icons must share the game's
  visual language and remain legible at their rendered size. Familiar actions can use icons alone;
  give ambiguous actions short labels and give icon-only buttons accessible names. Do not make
  essential instructions depend on hover or unexplained symbols.
- Touch targets should normally be at least 44 CSS pixels, separated enough for thumbs, and placed
  within comfortable reach without colliding with safe areas or host chrome. A compact visual icon
  can have a larger hit area, but neighboring hit areas must not overlap. Save space by reducing
  decoration and secondary content before shrinking readable text or tappable controls.
- Keep text and control states distinct from the actual scene behind them. Use calm local backing
  or subtle outlines when needed; avoid noisy textures, competing saturated panels, and heavy glow
  behind labels. Pair color-coded status with shape, icons, or text so color alone carries no
  essential meaning.
- Every action needs proportionate feedback: pressed/armed state, animation, sound where useful,
  impact, score/resource change, and clear unavailable/cooldown state.
- Menus, pause, result, restart, and settings use the same art direction as the game. Size panels
  to their content and available viewport; keep close/back and primary actions reachable on short
  screens. If secondary content needs scrolling, contain it inside the panel without causing the
  play surface or document to scroll. They are not browser-default overlays added at the end.

### Language and localization

- English is the primary release language and required fallback unless the user specifies another
  primary language. Set the initial document language accordingly (normally `<html lang="en">`) and
  keep the fallback English catalog complete even when additional locales ship.
- Put every player-visible string—including HUD labels, tutorials, results, settings, errors,
  accessibility names, attract cues, and canvas-rendered text—behind stable semantic keys in a
  central locale catalog and a small `t(key, params)`-style lookup. Do not concatenate translated
  fragments or bury display strings in gameplay rules.
- Keep `defaultLocale`, `supportedLocales`, catalog registration/loading, English fallback, and the
  selected persisted locale in one localization layer. Adding a locale should mean adding its
  catalog and registering it, not editing simulation, scene, or component logic.
- Use locale-aware interpolation and `Intl` formatting for plurals, numbers, dates, and relative
  values where applicable. Update the document `lang` and `dir` when locale changes; reserve a route
  for RTL even if the initial English-only release does not yet ship an RTL translation.
- Build responsive text containers rather than fixed-width labels baked around English. Verify
  wrapping, line height, clipping, button growth, and font coverage with a long-string pseudo-locale
  or representative expanded copy. Do not bake essential interface text into raster artwork.

## 4. Attract-mode creation method

Treat the preview as a separate state, not as a normal game with the HUD hidden by CSS.

```text
LOAD COMPLETE → ATTRACT (autonomous, UI-free gameplay highlight)
  └─ intentional tap/click → reset deterministic demo state
                              → unlock audio
                              → reveal essential HUD
                              → PLAYING
PLAYING → RESULT → restart → PLAYING
```

- Enter `ATTRACT` automatically as soon as essential assets are ready; never wait at a title screen
  or require input to start the demonstration. Showcase the core mechanic's strongest readable
  moment immediately, then continue or loop without falling into an idle or failure state.
- Compose it like an arcade cabinet demonstration: representative action and a strong camera, with
  no gameplay HUD, menus, settings, score panels, consent prompts, leaderboard, debug data, or
  normal touch controls.
- Give the highlight an uninterrupted UI-free beat. If play-entry discoverability still requires
  it, fade in only a small, calm `DEMO · TAP TO PLAY` cue afterward; never cover the action with a
  persistent panel or pulsing full-screen instruction.
- Use a deterministic scripted or seeded demonstration that cannot become stuck, fail into a menu,
  spend persistent currency, submit scores, or mutate the player's save.
- On first intentional input, stop every demo timer/listener, reset to a fair fresh state, reveal
  only essential play UI, and route that same input safely so it cannot cause an accidental move.
- That same first intentional input is where the paid-app gate lives: call
  `PaeanSDK.access.require()` and enter `PLAYING` only on `unlocked: true`. A free app passes
  instantly; a paid one shows the host's purchase sheet at the listing's price. On
  `unlocked: false` return to `ATTRACT` with the entry cue still visible — never a dead end, never
  a prompt at boot or mid-demo.
- Returning from background preserves the current real run; it must not silently re-enter demo.

### Ad-conversion readiness

Finished works are reused as **playable ad creatives** (HTML5 media bundles for Google Ads and
comparable networks). A conversion must be possible without editing gameplay code, so build these
four affordances in from the start. They cost nothing and are good engineering regardless.

- **Expose one programmatic entry point** that starts a real, playable session directly — skipping
  title, story, hub, draft, shop, and tutorial gates. Any one of these is enough, in order of
  preference: a command on the event bus (`emit('cmd', { type: 'start-run', ... })`), an exported
  function or state object from the entry module, or a single namespaced global handle
  (`window.__game = { startRound, game, state, ... }`). Document which one it is in the README.
  Without a seam, a converter is reduced to clicking DOM buttons, which breaks whenever the UI moves.
- **Take showcase parameters as arguments**, not constants baked into the start path: seed,
  level/floor, character, weapon, difficulty. Export the tuned demo seed as a named constant
  (`export const DEMO_SEED = ...`) so a conversion reproduces the exact showcase you tuned.
- **Read the autopilot flag every frame**, not once at session creation
  (`if (run.autopilot && run.pilot) input = run.pilot.input(dt)`). This is what lets an ad play
  itself for a few seconds and then hand control to the viewer — the single highest-value pattern
  in playable advertising. A flag latched at creation makes that impossible.
- **Let an external caller pin the language.** Read the locale from one documented storage key (or
  accept an explicit override) before falling back to the device, so an ad build can force English
  without editing i18n code. Keep static markup — `<html lang>`, pre-i18n strings — on the default
  locale so the first painted frame never flashes another language.
- **Guard every host capability with `typeof`** and degrade to full local play, including when the
  SDK script is absent entirely. Ad containers have no host, no network, and often no working
  `localStorage`; wrap storage access in `try/catch`. A work that only runs inside the 8x shell
  cannot become an ad.

Front-load the core loop for the same reason a good attract mode does: a multi-page story, a hub
screen, or a draft step before the first real interaction is fine in the app and fatal in an ad,
where the whole value is letting someone play before they decide to install.


### Offline-container readiness (RedNote mini-tool and similar)

Finished works are also repackaged as **offline container builds** — a zip of static files with no
network at all, running on an **Android 8.1 / Chrome 61** WebView (RedNote mini-tools are the current
target). The conversion is mechanical *except* where the work makes it impossible. These affordances
cost nothing while building and are the difference between a two-hour port and a rewrite. They
overlap heavily with ad-conversion readiness above; where they differ, the container is stricter.

- **Keep one source of truth for the default language.** Works routinely hard-code it in two or three
  places — a module-level `let current = 'en'`, a `save.lang || 'en'` fallback, a new-save factory,
  and a `register('en', ..., { default: true })` that also sets the *current* locale. A converter must
  find all of them or the build silently ships English. Resolve the initial locale **once**, from a
  documented override, and let everything else read that.
- **Funnel every storage access through one wrapper that cannot throw.** Not just `setItem` quota:
  under some WebView policies *reading `window.localStorage` itself throws*. One unguarded read on a
  top-level boot path aborts the module, so no listener is ever attached and the page renders with
  every control dead — no error the player can see. Wrap reads and writes, and keep the game fully
  playable when storage is unavailable.
- **Clamp the frame delta at both ends**: `Math.max(0, Math.min(cap, (now - last) / 1000))`. The first
  rAF timestamp can precede the `performance.now()` captured at module load, and a negative delta runs
  in-game time backwards — which surfaces far from the cause, as negative array indices or corrupted
  animation state.
- **A `catch` that substitutes a fallback is a place the product can quietly disappear.** Optional
  dependencies loaded through `import(someVariable)` cannot be bundled: a bundler lowers them to
  `__require(x)`, which throws, the surrounding `catch` swallows it, and the game runs on the
  placeholder implementations its author wrote for the module-not-landed-yet case — flat circles
  instead of sprites, a plain rectangle instead of terrain. Nothing errors, nothing blanks, and
  automated checks stay green. Keep dynamic-import specifiers **literal** (or resolve names through
  a static registry module), do not set a loader's `loaded` flag unless something actually loaded,
  and verify a build by comparing it against the original side by side — a draw-call count or a
  screenshot at the same screen — not only by looking for errors.
- **Never let the boot path be one long unguarded top-level sequence.** This is the single most
  expensive shape in practice. A typical entry module builds the renderer, compiles shaders, reads
  the save, and only at the end calls `addEventListener` to wire the UI. HTML and CSS have already
  painted, so any throw in the middle leaves a complete, correct-looking screen on which nothing
  responds — with no visible error. It reaches the market as *"页面按钮无法点击"*, which sends
  everyone hunting an input bug that does not exist. Wire the UI **before** the expensive work, or
  wrap the boot sequence in `try/catch` and render a readable failure state.
- **Treat WebGL as something that can simply be absent.** Reviewers and many desktop users run
  machines with no GPU, a blocklisted GPU, or hardware acceleration switched off; there
  `new THREE.WebGLRenderer()` throws. Across one 56-work batch, **21 works became dead pages** when
  WebGL was removed. Construct the renderer inside `try/catch` and show an explicit
  "this device has no usable WebGL" screen, so the failure is legible instead of looking like
  missing functionality. Offline containers add a boot guard, but **it cannot save you here**: if
  the entry is `async function boot()` and the renderer is built *outside* its own `try`, the throw
  becomes an unhandled rejection the work swallows, and in the measured case no `error` or
  `unhandledrejection` reached `window` at all. Having a `try/catch` is not enough — check which
  line the `try` actually starts on, and keep every expensive constructor inside it.
- **Keep the top corners clear — the host draws its own chrome there.** Every host floats
  controls over the page's top edge: a back affordance at the top left, a share/profile capsule
  at the top right, and the system status bar above both. A control the work places in those
  corners is covered and untappable, and the usual casualty is a modal's top-right close button —
  it shipped that way once and players could not close the panel. Reserve the band with
  `--paean-chrome-inset-top` (never a hard-coded `top: 12px`), keep roughly 56px clear on the
  left and 104px on the right within it, and prefer not to put anything in the top-right corner
  at all. **Read the variable with a usable fallback** — offline container builds strip the host
  script that injects it, so `var(--paean-chrome-inset-top, env(safe-area-inset-top))` silently
  degrades to clearing only the status bar.
- **Gate on-screen controls by layout, never by pointer type.** `@media (pointer: coarse)` and
  `navigator.maxTouchPoints` answer "is this a touch device", but the question you actually need
  answered is "is the phone layout in use". Those differ in the single most common review setup:
  a desktop browser narrowed to phone size. There the phone layout applies — the one that assumes a
  virtual stick and leaves no room for a keyboard legend — while the pointer is a mouse, so the
  stick stays `display: none`. The result is a screen with no controls at all: reviewers report it
  as *"按钮无法点击"* and it genuinely cannot be played on the web. Use the layout breakpoint
  instead, e.g. `@media (pointer: coarse), (max-width: 820px), (max-height: 620px)`, and keep one
  live `matchMedia` as the single source of truth so orientation changes track it.
- **Bind controls with Pointer Events, never `touch*` only.** `pointerdown`/`pointermove`/
  `pointerup` fire for mouse, touch and pen alike, so one binding serves every device and a virtual
  stick stays usable when it is dragged with a mouse. A control that is visible but bound only to
  `touchstart` is dead under a mouse — the same symptom, a different cause.
- **Keep genuinely pointer-dependent affordances on the pointer test.** A mouse crosshair or a hover
  tooltip should still follow `pointer: fine`. Splitting the two predicates — one for layout, one for
  the actual input device — is the whole fix; collapsing them back into one is how this bug returns.
- **Do not put player-visible text in a hand-rolled bitmap font.** A 3×5 glyph table cannot draw CJK,
  and text drawn into a low-resolution buffer and scaled up is unreadable. Draw localisable canvas text
  with `fillText` on the output layer, with a font stack that includes CJK faces.
- **Do not assemble display strings ahead of render.** Logs, toasts and result lines built by
  concatenation keep whatever language was active when they were created. Store the parameters (or a
  closure) and resolve at render, so a language switch updates history too.
- **Namespace the localisation helper.** A bare `t` or `T` collides with local variables in real
  codebases; pick something unlikely (or export it under a distinct name) so a converter adding i18n
  does not shadow, or get shadowed by, gameplay code.
- **Stay inside the container's file types**: `html css js png jpg jpeg gif webp svg woff woff2 json`.
  `ttf`/`otf` fonts, `mp3` audio, `.glb` models and `.txt` licence files are all rejected. Prefer
  system font stacks and synthesised audio; if you ship a licence-bearing dependency, expect its notice
  to have to travel inside HTML rather than as a text file.
- **Import third-party libraries by name, not as a namespace.** `import * as THREE from 'three'`
  defeats tree-shaking, so loader code — and its `fetch` — lands in the bundle and fails an offline
  audit outright. Named imports keep it out.
- **Keep the modern-API surface small and guarded on the boot path.** Anything above the Chrome 61
  baseline (`Object.fromEntries`, `Array.flat/flatMap/at`, `String.replaceAll`, `structuredClone`,
  `AbortController`, `ResizeObserver`, `ctx.roundRect`) must be feature-detected if it runs during
  boot; unguarded use there yields a blank page rather than a degraded feature.
- **Compose for portrait at phone size and verify landscape by actually playing.** Container builds are
  opened in a phone-shaped WebView. A panel that covers the only tappable area, or a HUD that squeezes
  the playfield to nothing, produces no console error and no failed assertion — only a player who
  cannot proceed.

Also keep offline degradation honest: if a capability can never work without a host, the converted
build should be able to **remove** its entry rather than show a control that always fails.

## 5. Responsive composition

- Every original work and remix should adapt to both portrait and landscape so players can use
  their current screen orientation. Mobile/touch is the primary design surface; a preferred art
  composition must not become a required device orientation. Recompose the camera, playfield, HUD,
  and controls for the available width and height rather than merely shrinking or rotating.
  Do not use orientation locks or blocking "rotate device" screens to replace adaptation. Test
  narrow and short phones, not only one flagship phone.
- Make layout respond to both available width and height. Use fluid sizing with sensible bounds
  and content-driven breakpoints to regroup HUD items, relocate controls, and simplify secondary
  content. Keep text readable at native size; never solve a small viewport by uniformly shrinking
  the entire desktop interface. Cap panel widths on large displays so empty space does not inflate
  the UI or separate related controls.
- Use `100dvh` with a safe fallback, `viewport-fit=cover`, CSS safe-area/Paean chrome variables,
  pointer events, and resize/orientation handling. Prevent document scroll/overscroll, text
  selection, callouts, and unwanted gesture navigation on the play surface.
- Scale a logical game coordinate system into the available play rectangle. Preserve aspect where
  distortion would damage gameplay or pixel art; use intentional crop, letterbox art, or adaptive
  camera rather than stretching. Keep gameplay-critical content visible and touch targets usable
  in both orientations, including when the mechanic favors a fixed logical aspect ratio.
- Desktop needs a designed composition. Center portrait play inside an appropriate max-width frame
  and use the remaining area for restrained atmosphere, not duplicated controls or empty accidental
  whitespace. Ensure the primary scene and HUD remain visually centered relative to each other.
- Reflow attract mode, play, pause, and result screens on resize or orientation change without
  restarting the run or losing progress. Recalculate canvas dimensions and pointer coordinate
  mapping together; release interrupted gestures so controls do not stick after rotation.
- Verify phone and tablet sizes with actual play in both portrait and landscape, plus desktop.
  Rotate in both directions during attract mode, play, pause, and results; confirm state is
  preserved and the scene, text, and controls remain visible, legible, and reachable. A rotate
  prompt is not evidence of orientation support. No viewport may show a page scrollbar or drift
  under touch.
- Include 320x568 and 568x320 CSS-pixel viewports as small-screen baselines alongside the validator's
  phone, tablet, and desktop profiles. Capture and operate the active HUD, menus, pause, and results,
  not only the UI-free preview. Resize through intermediate widths and heights and inspect both
  sides of layout breakpoints with long labels and large score values; fix clipped text, overlapping
  controls, unreachable actions, and panels that crowd out gameplay.

## 6. Code and asset architecture

- One game equals one self-contained deployable directory with top-level `index.html`. Runtime URLs
  stay within it; no `../`, absolute filesystem path, parent/sibling import, remote CDN, or
  `.remix-sources` dependency.
- The deployable source is plain HTML/CSS/JavaScript and runs directly from a static server. Do not
  ship TypeScript or require Vite/another build step to obtain the playable version.
- Separate stable responsibilities and content definitions: bootstrap/state, input, renderer,
  simulation, audio, UI, levels, monsters, characters, and abilities. Prefer small cohesive modules
  and data tables to a single giant file, while avoiding fragmentation into trivial wrappers.
- Bundle only used assets. Use texture atlases/spritesheets where helpful, compact vector geometry,
  subset fonts, and appropriately sized images. Remove source PSDs, unused generations, debug maps,
  and duplicate exports from the deployable directory.
- Put the Paean copyright comment immediately after `<head>`. Include top-level `favicon.svg` and
  exactly 800×400 `banner.jpg`; the banner is a deliberate store composition, not a stretched game
  screenshot with UI debris.

### Banner production

- Make the banner a high-quality, 2:1 marketing composition that faithfully represents the
  finished game's premise, core mechanic, characters, world, art direction, and interface language.
  It must not advertise actors, environments, polish, or features the playable game does not have.
- When an image-generation tool or skill is available, use the finished game brief plus actual
  screenshots, character/scene references, palette, and composition notes to generate the base art.
  Iterate until the result clearly belongs to this game, then add exact title/logo typography with
  deterministic design tools rather than relying on generated text.
- Without image generation, capture the UI-free attract demonstration or render a dedicated
  promotional camera shot from the game. Crop and color-grade it, then composite authored title,
  logo, and restrained supporting text as needed; do not reuse an ordinary HUD-covered screenshot.
- Inspect the final JPEG at 800×400 and at small Square-listing thumbnail size. Check focal point,
  silhouette, contrast, title legibility, edge safety, JPEG artifacts, and file weight.
- Produce `icon.jpg` at exactly 512×512 from the same art direction: a composed square crop with
  the game's key silhouette centered, no baked-in title text (hosts label tiles themselves),
  edge-safe for circular and rounded masks, and legible at 64×64. It is not the banner squashed.

## 7. Paean platform fit

- During the brief, inspect the current `paean-sdk` skill and documented host capabilities. Prefer
  Paean SDK implementations when cloud storage, shared ranking, payments, ads, multiplayer, or
  social interaction genuinely strengthens this game's loop or continuity.
- Use the SDK skill's IAP/IAA/Net/Rank/AI router to read only selected feature guides. Record the
  player benefit, interaction point, API/scope, persistent state, failure recovery, and test evidence.
  Resolve cross-feature rules such as ad revives or paid boosts on ranked runs and AI in multiplayer.
- Treat the current documentation as authoritative. Cloud save, leaderboards, shared data, paid
  apps / durable products (`access.*`), in-app purchases, tips, rewarded ads, rooms, AI and share
  are documented in SDK 1.10; use only what the installed SDK/host documentation exposes. Never
  invent a scope, API, entitlement, reward, or transaction flow. The paid-app gate on the first
  intentional tap is required in every game (free apps pass instantly); prove it with the mock host.
- Ask only for necessary consent at a natural moment, keep previews free of platform prompts, and
  preserve full local play when an optional capability is unavailable or declined. Monetization
  must be user-approved and must not become a surprise interruption or pay-to-remove defect.

## 8. Audio and performance

- Audio should share the game's identity. Prefer a small reusable WebAudio sound palette and compact
  MIDI/sequenced BGM when it provides the right result; do not add generic sounds merely to check a
  box.
- Unlock audio on user interaction, expose a coherent mute setting, avoid clipping, and stop or
  reduce playback when hidden. Layer important events without turning every action into noise.
- Keep first interaction fast on mobile. Load the minimum launch set, decode large media off the
  critical path, preload likely next content, reuse pools, and cap particles/lights/physics work.
- Check transferred bytes and the largest files. Optimize based on measured cost while preserving
  visible quality; tiny size is not an excuse for crude art.

## 9. Release acceptance matrix

Before completion, record evidence for each row:

| Area | Required evidence |
| --- | --- |
| Core loop | Multiple complete sessions including win/fail/restart and unusual input timing |
| Preview | Load enters an automatic UI-free core highlight; demo is deterministic, non-persistent, and converts on first tap |
| Mobile portrait | Full-size screenshot plus touch play; safe areas and all targets verified |
| Mobile landscape | Full-size screenshot plus touch play; safe areas and all targets verified, with no forced rotation |
| Tablet | Portrait and landscape screenshots/play with intentional composition and reachable controls |
| Orientation changes | Rotate both ways in attract/play/pause/results; state and progress preserved, UI reflows, touch mapping stays accurate, no rotation gate |
| Desktop | Full-size screenshot showing deliberate max-width/centering and no loose scene drift |
| Compact UI | Active-play capture shows concise status, clear primary controls, and unobscured action; secondary panels open and close with reachable actions |
| Small screens and resize | 320x568 and 568x320 touch play plus HUD/menu/pause/result captures; readable text, usable targets, and no clipping or overlap through intermediate sizes |
| Color and surfaces | Bright, approachable casual treatment or recorded theme-specific direction; coherent materials, legible text and states, and restrained accents over the actual scene |
| Platform fit | SDK capability plan recorded; chosen integrations verified with graceful fallback |
| Localization | English default/fallback complete; centralized keys, locale configuration, and expanded-text layout verified |
| Runtime | Playwright reports no page errors, console errors, failed assets, or scrollbars |
| Lifecycle | Resize, rotate, pointer cancel, hide/show, reload, pause, and audio unlock verified |
| Architecture | Static `index.html`, pure JS, focused files, no external/out-of-directory runtime refs |
| Assets | Original/licensed, coherent, optimized; `favicon.svg`, 800×400 `banner.jpg`, 512×512 `icon.jpg` present |
| Paid gate | `access.require()` on the first intentional tap only; mock-host cases (free, paid, declined, preview) pass |
| Ad-conversion | Programmatic session entry documented; showcase params are arguments; autopilot flag read per frame; locale pinnable from one storage key; runs with the SDK script absent |
| Offline-container | Single source of truth for the default locale; all storage access wrapped so it cannot throw; frame delta clamped at both ends; no bitmap-font player text; container-legal file types only; named (not namespace) third-party imports; boot path free of unguarded post-Chrome-61 APIs; no unbundled dynamic `import()` (specifiers literal), and the build compared against the original so a silent downgrade to fallback rendering is caught; UI wired before expensive init (or the boot sequence wrapped so a throw renders a readable failure state); WebGL construction guarded and the no-WebGL case shown explicitly; on-screen controls gated by layout breakpoint (not pointer type) and bound with Pointer Events, so a desktop browser narrowed to phone size stays playable ; nothing interactive inside the host chrome band (`--paean-chrome-inset-top`, plus ~56px left / ~104px right) |
| Vector/rig (if used) | Cartoon family and head ratios recorded; fine linework, joint deformation, key poses, and final-scale motion inspected |
| Banner | Faithful high-quality composition, source method recorded, exact 800×400 JPEG and thumbnail inspected |
| Finish | No placeholder art/copy, debug UI, broken affordance, dead control, or half-built state |

Automated checks prove structural and runtime facts only. A human-quality visual pass must inspect
screenshots and motion at full size; if composition, art, animation, or UI still looks provisional,
the game is not done even when every automated check passes.
