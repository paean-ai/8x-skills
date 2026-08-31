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

- Keep the active play HUD to information that changes decisions. Use hierarchy and spatial
  grouping; do not cover the scene with panels or tutorial prose.
- Use authored pixel-art or SVG/vector icon shapes rather than emoji. Icons must share the game's
  visual language, remain legible at their rendered size, and communicate without relying on text.
- Touch targets should normally be at least 44 CSS pixels, separated enough for thumbs, and placed
  within comfortable reach without colliding with safe areas or host chrome.
- Every action needs proportionate feedback: pressed/armed state, animation, sound where useful,
  impact, score/resource change, and clear unavailable/cooldown state.
- Menus, pause, result, restart, settings, and orientation warnings use the same art direction as
  the game. They are not browser-default overlays added at the end.

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
- Returning from background preserves the current real run; it must not silently re-enter demo.

## 5. Responsive composition

- Mobile/touch is the primary design surface and portrait is the default composition. Unless
  horizontal space is intrinsic to the mechanic, make both orientations genuinely playable by
  recomposing the camera, playfield, HUD, and controls rather than merely shrinking or rotating.
  Test narrow and short phones, not only one flagship phone.
- Use `100dvh` with a safe fallback, `viewport-fit=cover`, CSS safe-area/Paean chrome variables,
  pointer events, and resize/orientation handling. Prevent document scroll/overscroll, text
  selection, callouts, and unwanted gesture navigation on the play surface.
- Scale a logical game coordinate system into the available play rectangle. Preserve aspect where
  distortion would damage gameplay or pixel art; use intentional crop, letterbox art, or adaptive
  camera rather than stretching.
- Desktop needs a designed composition. Center portrait play inside an appropriate max-width frame
  and use the remaining area for restrained atmosphere, not duplicated controls or empty accidental
  whitespace. Ensure the primary scene and HUD remain visually centered relative to each other.
- Verify phone and tablet sizes in both portrait and landscape, plus desktop. If one orientation is
  genuinely incompatible with the mechanic, show a deliberate branded rotate treatment rather than
  a broken or stretched game. No viewport may show a page scrollbar or drift under touch.

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

## 7. Paean platform fit

- During the brief, inspect the current `paean-sdk` skill and documented host capabilities. Prefer
  Paean SDK implementations when cloud storage, shared ranking, payments, ads, multiplayer, or
  social interaction genuinely strengthens this game's loop or continuity.
- Treat the current documentation as authoritative. Storage and leaderboards are currently
  documented; add payments, ads, multiplayer, or social features only when the installed SDK/host
  documentation exposes them. Never invent a scope, API, entitlement, reward, or transaction flow.
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
| Mobile landscape | Full-size screenshot plus touch play, or a justified branded rotate treatment |
| Tablet | Portrait and landscape screenshots/play with intentional composition and reachable controls |
| Desktop | Full-size screenshot showing deliberate max-width/centering and no loose scene drift |
| Platform fit | SDK capability plan recorded; chosen integrations verified with graceful fallback |
| Runtime | Playwright reports no page errors, console errors, failed assets, or scrollbars |
| Lifecycle | Resize, rotate, pointer cancel, hide/show, reload, pause, and audio unlock verified |
| Architecture | Static `index.html`, pure JS, focused files, no external/out-of-directory runtime refs |
| Assets | Original/licensed, coherent, optimized, and favicon present |
| Vector/rig (if used) | Cartoon family and head ratios recorded; fine linework, joint deformation, key poses, and final-scale motion inspected |
| Banner | Faithful high-quality composition, source method recorded, exact 800×400 JPEG and thumbnail inspected |
| Finish | No placeholder art/copy, debug UI, broken affordance, dead control, or half-built state |

Automated checks prove structural and runtime facts only. A human-quality visual pass must inspect
screenshots and motion at full size; if composition, art, animation, or UI still looks provisional,
the game is not done even when every automated check passes.
