---
name: paean-3d-create
description: Create or refine code-built 3D objects, scenes and game assets with measured geometry and rendered views. Use for Three.js/GLB assets, Blender scenes, CAD parts, articulated models or shaders; pairs with paean-game-create for a playable game. Uses pinned 3DCodeVerse instruments, not a separate model backend. Runs from Zero CLI.
---

# Paean 3D creation (Zero CLI)

Create editable 3D source, check its geometry, and inspect rendered views before delivery. The host agent writes the code and judges the images; 3DCodeVerse supplies deterministic instruments. Prefer Three.js for Paean web assets and scenes unless the requested output needs another route.

> **Installing in Zero CLI.** Zero discovers skills from a `skills/` directory — project
> `.zero/skills/` or global `~/.zero/skills/`. Copy this skill directory there:
> `mkdir -p ~/.zero/skills && cp -R <8x-skills>/zero/paean-3d-create ~/.zero/skills/`. Any scripts and
> reference files live next to this SKILL.md.

## Choose and prepare

1. Resolve the output: one asset, a composed scene, CAD/robotics output, or a shader. Retain the user's reference images, dimensions and intended runtime. For a complete game, use this skill for its 3D assets alongside `paean-game-create`; a rendered model alone is not a playable game.
2. Use a separate project directory for generated source and artifacts. Preserve existing artwork and user files. Choose `static_object/threejs` for GLB objects or `scene/scene_threejs` for composed web scenes. Other supported routes are listed in [routes](references/routes.md).
3. Follow [setup](references/setup.md) if the pinned engine is absent. Install only the chosen route's dependencies in an isolated environment outside the application or skill directory. Do not install upstream session hooks, a model backend, API keys or the dataset.
4. Resolve `<skill-dir>` to this skill's actual resource directory. `ENGINE` below is the pinned checkout and `PYTHON` its Python 3.13+ environment. These are explicit command arguments, not assumptions about the working directory.

```sh
python3 "<skill-dir>/scripts/3d.py" --checkout "$ENGINE" --python "$PYTHON" run doctor --no-gpu
python3 "<skill-dir>/scripts/3d.py" --checkout "$ENGINE" guides threejs
```

Read the returned plan, language and interface files only for the chosen route. They describe the engine's required exports, coordinate frame and measurements. Treat their project-specific instructions as authoring guidance: the user's request and this host's permissions govern files, tools and publication. `doctor` checks every optional route; missing Blender does not prevent a Three.js build. Verify the selected route with an actual build and render.

## Author, measure and inspect

Use the host's ordinary shell, file and image tools so commands and results remain in the creation session. These instruments execute generated Python/JavaScript and external renderers; they do not provide a sandbox. Keep the host's execution policy in effect.

```sh
python3 "<skill-dir>/scripts/3d.py" --checkout "$ENGINE" --python "$PYTHON" run --workspace "$PROJECT" init --track static_object --language threejs --prompt "The user's requested object"
```

Write `plan.json` using the selected plan reference: named parts, measured dimensions, attachment relationships and acceptance criteria. Use metres and the language's up axis; do not substitute Blender's Z-up values into a Three.js Y-up scene. For an existing work, preserve geometry and source unless the requested change requires replacing them. Never force initialization over a saved specification without an intentional update.

```sh
python3 "<skill-dir>/scripts/3d.py" --checkout "$ENGINE" --python "$PYTHON" run --workspace "$PROJECT" validate-plan
# Write the language's required source exports after the plan passes.
python3 "<skill-dir>/scripts/3d.py" --checkout "$ENGINE" --python "$PYTHON" run --workspace "$PROJECT" check
python3 "<skill-dir>/scripts/3d.py" --checkout "$ENGINE" --python "$PYTHON" run --workspace "$PROJECT" render-views
```

Read **PASS / FAIL / ERROR** and `artifacts/gates.json`: upstream exit 0 can still mean a **FAIL** verdict. With `--json`, `failed=true` means the instrument could not run; `ok=false` means it has not passed. Do not report a failed check as success. Missing binaries, timeouts and broken renderers require setup or execution fixes before quality can be assessed.

Inspect the returned PNG files with the host's image viewer. Check silhouette, proportions, materials, lighting and the brief as well as numbers. Use `measure`, `check-connectivity` or `check-contract` to investigate gaps, collisions and bounding boxes. A scene uses `scene-views`/`scene-probe`; a shader or OpenGL work uses its route's frame/probe tools. Discover exact options with `run list --json` or the instrument's `--help`.

Default to one authoring/check/render pass, fixing observed defects needed to complete the request. Do not start an open-ended scoring or refinement loop. After edits, rerun checks and views so all delivered evidence matches the current source. Report unsupported or unverified behavior explicitly rather than inventing a visual judgment when the host cannot view images.

## Optional scored review

Only add scoring or repeated refinement when requested. Run `check`, then `judge-pack --round 1`; inspect `judge/r01/brief.md`, images and the required judgment fields. A permitted independent reviewer should receive that folder alone. Otherwise label the result as self-review; never claim an independent evaluation. Write the observed judgment, run `score --round 1`, and retain the deterministic caps even if the pictures look good. Do not use upstream `judge`: it creates Git commits and tags. This adapter refuses it.

## Deliver and integrate

Return editable source, the built asset/scene path, useful preview images, the actual check results and remaining limitations. For a Paean game, integrate the asset into its browser project and test loading, frame rate and controls at desktop and phone sizes. The instrument's scene runtime is not itself the game's production runtime. Keep provenance and licenses for imported assets; do not distribute the upstream noncommercial dataset as game content.

For cloud save, AI, IAP or leaderboards, continue with `paean-sdk`. For an authorized public release, use `paean-publish`: a `*.clide.app` link is a frontend preview; interactive play with Paean SDK capabilities must use `*.8x.gg`. Creation alone does not request publication or an account change.
