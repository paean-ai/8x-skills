---
name: paean-remix
description: Remix one or more published Paean Apps Square games into a brand-new game. Downloads each source game's project files by hash and scaffolds a new project with a multi-parent remix graph. Use when the user asks to remix, fork, combine, or mash up published clide.app / Paean Apps Square games (e.g. "remix hash1 hash2", "用 hash1 的玩法 + hash2 的美术做个新游戏").
---

# Paean Remix

Download the source of one or more published `*.clide.app` games (by hash) and use them as
the basis for a new game, recording the full remix lineage so upstream creators are credited.

This skill bundles a self-contained Node script — `scripts/remix.mjs`. It needs Node 18+
(global `fetch`) and the `unzip` command on PATH.

## Credentials

Same as the publish skill: a Paean JWT from `PAEAN_AUTH_TOKEN`, or
`~/.paean/credentials.json` / `~/.zero/credentials.json` as `{"token":"<jwt>"}`. Set it via
the environment, or use the **paean-zero-setup** skill to install Zero and run `zero login`.
Never paste tokens into chat.

## Source references

Each source must resolve to a published Square app `hashKey`. Accepted forms: a bare
hashKey, `https://8x.gg/<hashKey>`, or `hashKey=role` to tag the aspect you want from it
(e.g. `h1=gameplay h2=art h3=theme`). A `*.clide.app` play URL contains the deployed site
handle, not necessarily the Square `hashKey`; if the user gives only a play URL, ask for the
Square hashKey from the publish result or Square app detail before running the script.

## Run

Let `$SKILL_DIR` be the directory containing this SKILL.md. Run from the directory where you
want the new project created.

1. **Inspect (no downloads, no writes):**
   ```bash
   node "$SKILL_DIR/scripts/remix.mjs" --dry-run <source> [<source> ...]
   ```
   This resolves each hash to its Square app and prints title/category/author plus the
   target directory and remix graph that would be created.

2. **Confirm with the user.** Remixing records lineage for each source — it credits each
   upstream creator and counts as a remix on their listing. Get explicit confirmation.

3. **Download + scaffold:**
   ```bash
   node "$SKILL_DIR/scripts/remix.mjs" --yes h1=gameplay h2=art h3=theme [--dir <target>] [--title "<Name>"]
   ```
   After it finishes, the target directory contains:
   - `.remix-sources/<hash>/` — the full downloaded source of each upstream game.
   - `clide.json` — the project manifest with the remix graph (`remix.parent` for the
     primary upstream + `remix.parents[]` for every contributing source, each with its
     `role` and a revenue `weight`).
   - `LICENSE` and `.clideignore` (which excludes `.remix-sources/` from publishing).

4. **Build the new game with the `paean-game-create` production standard.** Read its `SKILL.md`
   and `references/production-standard.md`, then inspect the relevant files under each
   `.remix-sources/<hash>/` and compose a genuinely new game at the target directory's top
   level, honoring the aspect the user assigned to each source (the classic recipe is
   "h1 gameplay + h2 art/visual style +
   h3 theme/subject"). Do NOT ship the upstream sources verbatim — synthesize a new
   `index.html` (and assets) that combines the chosen aspects. Keep the remix standalone:
   no runtime imports from `.remix-sources/`, parent folders, or remote assets unless their
   license explicitly allows it and attribution is recorded. Keep `.remix-sources/` for
   reference only; it is not published. Include top-level `favicon.svg` and `banner.jpg`;
   `banner.jpg` should be exactly 800x400.
   Reassess platform features for the new loop rather than copying a parent's integration blindly.
   Prefer the current `paean-sdk` when its documented storage, leaderboard, payment, advertising,
   multiplayer, or social capabilities suit the remix; never invent unavailable APIs, and preserve
   graceful local play for optional capabilities.

5. **Finalize `clide.json`.** Set a fitting `title`, `summary`, `category`, and `tags` for the
   new game, and set each `remix.parents[].role` to the aspect actually borrowed. Adjust
   `weight` if the user wants an uneven upstream split. If the remix keeps a parent gameplay
   loop, save keys, storage namespaces, and visible title/identity must be changed so it does
   not collide with or impersonate the parent.

6. **Validate** with `paean-game-create/scripts/validate-game.mjs`, including Playwright runtime
   checks and full-size visual review at its phone, tablet, and desktop viewports in both mobile
   orientations.

7. **Publish** with the **paean-publish** skill from the target directory. It reads
   `clide.json` for naming, metadata, and the remix lineage automatically.

## Remix graph (clide.json)

The manifest records lineage in two compatible shapes at once:

- `remix.parent` — a single upstream hashKey. This is sent as backend `remixOfHashKey`,
  populates the legacy source/root columns, and should be the parent with the strongest
  structural contribution (usually gameplay). Always the first parent.
- `remix.parents[]` — the full *graph* form: every direct upstream, each with the borrowed
  aspect (`role`) and a suggested revenue `weight`. This is the adjacency list of the remix
  DAG (this game → each parent). On publish these hashKeys are sent as backend
  `remixOfHashKeys`, which creates `SquareRemixEdge` rows for the full graph.

Keeping both in sync means tree-only consumers keep working while graph-aware consumers get
the complete multi-parent picture. Do not include transitive ancestors unless the new work
directly used them as sources.

## Copyright and attribution

- Keep or add the standard `index.html` copyright comment near `<head>`:
  `Copyright (c) 2026 paean.ai and the game's creator(s).`
- Keep a project `LICENSE`. Default to `MIT` only for original/local code. If upstream code or
  assets impose a stricter license, preserve that license and attribution.
- Ship top-level `favicon.svg` and an 800x400 `banner.jpg` for Square presentation.
- Add a short README or `clide.json.summary` provenance note when the remix materially keeps a
  parent loop, art direction, asset, or system.
- Never publish `.remix-sources/`; `.clideignore` excludes it.

## Flags

`--dir <dir>`, `--title <t>`, `--summary <t>`, `--category <c>`, `--license <spdx>`,
`--role <aspect>` (applies to the preceding source), `--dry-run`, `--yes`. Run with `--help`.

## Failure handling

- Missing credentials → use the **paean-zero-setup** skill, or tell the user to set
  `PAEAN_AUTH_TOKEN`.
- A source that is not found / not listed / not remixable → the script reports which hash
  failed before any download. Fix or drop that source and re-run.
- `unzip` not found → install it (ships with macOS and most Linux distros).
