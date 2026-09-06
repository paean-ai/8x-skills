---
name: paean-remix
description: Remix one or more published Paean Apps Square games into a brand-new game. Downloads each source game's project files by hash and scaffolds a new project with a multi-parent remix graph. Use when the user asks to remix, fork, combine, or mash up published clide.app / Paean Apps Square games (e.g. "remix hash1 hash2", "用 hash1 的玩法 + hash2 的美术做个新游戏"). Pairs with the 8x.gg MCP server (find_app / read_app_file) for finding and studying apps before cloning anything.
---

# Paean Remix (Codex)

Download the source of one or more published `*.clide.app` games (by hash) and use them as the
basis for a new game, recording the full remix lineage so upstream creators are credited.

> **Using this skill in Codex.** Reference this file explicitly — add a pointer in your project
> `AGENTS.md` ("To remix Paean Apps Square games, follow
> `8x-skills/codex/paean-remix/SKILL.md`.") or name the skill in your prompt. It is a
> self-contained Node script — `scripts/remix.mjs` — needing Node 18+ and `unzip` on PATH.

## Credentials

A Paean JWT from `PAEAN_AUTH_TOKEN`, or `~/.paean/credentials.json` / `~/.zero/credentials.json`
as `{"token":"<jwt>"}`. Prefer the `paean-zero-setup` skill to install Zero and run
`zero login`; never paste tokens into the conversation.

## Two tools, one flow: the 8x.gg MCP server and this script

The `8xgg` MCP server (`https://api.paean.ai/8x/mcp`, registered by `paean-zero-setup` via
`codex mcp add`) and `scripts/remix.mjs` are complementary. Use both, in this order:

| Step | Use | Creator credit |
|---|---|---|
| Find the app from a URL, title or description | MCP `find_app` / `search_apps` | none |
| Decide whether it is worth remixing (metrics, lineage, existing remixes) | MCP `get_app` / `get_remix_lineage` / `get_app_growth` | none |
| Study the source, choose what to borrow | MCP `list_app_files` / `read_app_file` | none now; the read is recorded so a later publish is attributed |
| Primary parent: full source incl. binary assets + local scaffold | `remix.mjs` (first source → `/remix` clone) | once — publish reuses the clone workspace |
| Secondary parents: borrow code / config / level data | `remix.mjs` (other sources → MCP text read) | once, at publish, via `clide.json` |
| Publish and declare every parent | paean-publish | — |

Rules:

- The **first** source passed to the script is the primary. Put the game whose loop,
  structure and assets the new game builds on first; only it is cloned server-side.
- Secondary sources arrive as **text only** (`read_app_file` decodes UTF-8; binaries and
  files over 256KB are listed in `.remix-sources/<hash>/REMIX-FETCH.json`, not downloaded).
  Recreate such assets. Only if the remix genuinely needs a secondary's binaries as-is,
  re-run with `--clone-all` — each secondary is then counted twice for its creator (once
  for the throwaway clone, once at publish), so say so to the user first.
- Never call MCP `remix_app` or `POST /remix` just to *look at* a game: it creates a
  workspace in the user's account and credits the creator for a remix that may never exist.
  Reading is what `read_app_file` is for. `remix_app` is for "give me a working copy in the
  cloud, I will edit it there" — not for this local flow.
- Without the MCP server, `remix.mjs` still works (it calls `/8x/mcp` itself with the same
  token). Only URL/title discovery is lost: ask the user for hashKeys.

## Source references

Use Square app `hashKey` values: a bare hashKey, `https://8x.gg/<hashKey>`, or
`hashKey=role` to tag the borrowed aspect (e.g. `h1=gameplay h2=art h3=theme`). A
`*.clide.app` play URL contains the deployed site handle, not necessarily the Square
`hashKey`. If the user gives only a play URL, a title or a description, resolve it with the
MCP `find_app` / `search_apps` tools first (they accept any 8x.gg / clide.app URL or a
title); without the MCP server, ask for the hashKey from the publish result or Square app
detail before running the script.

## Run

`$SKILL_DIR` is the directory containing this file. Run from where you want the new project.

Before running anything, if the `8xgg` MCP server is available, study the candidates:
`get_app` / `get_remix_lineage` for each (what it is, how it performs, who already remixed
it), then `read_app_file` on the entrypoint to see what each game actually contributes. That
is how you pick the primary and assign roles honestly.

1. **Inspect the plan (no downloads, no writes):**
   ```bash
   node "$SKILL_DIR/scripts/remix.mjs" --dry-run <primary> [<source> ...]
   ```
   Resolves each hash to its Square app and prints title/category/author, the target
   directory, and per source `fetch` (`remix-clone` or `mcp-read`) and `credit` (when its
   creator is counted). The **first source is the primary** — the game whose loop, structure
   and assets the new game builds on.

2. **Confirm with the user** — the primary is cloned into the user's Paean workspace and its
   creator is credited now; every other source is credited once, at publish.

3. **Download + scaffold:**
   ```bash
   node "$SKILL_DIR/scripts/remix.mjs" --yes h1=gameplay h2=art h3=theme [--dir <target>] [--title "<Name>"]
   ```
   The target directory then contains `.remix-sources/<h1>/` (the primary's full source,
   binaries included), `.remix-sources/<h2>/`, `<h3>/` (each secondary's **text** sources
   plus `REMIX-FETCH.json` listing anything not downloaded — recreate those assets, or use
   `--clone-all` as the double-credit fallback described above), `clide.json` (the remix
   graph), `.clide/publish.json` (the primary's clone workspace — **paean-publish reuses it**,
   which is what keeps the primary from being counted twice; do not delete it, and publish
   from this directory), `LICENSE`, and `.clideignore` (excludes `.remix-sources/` and
   `.clide/`).

4. **Build the new game with the `paean-game-create` production standard.** Read its `SKILL.md`
   and `references/production-standard.md`, then inspect each `.remix-sources/<hash>/` and
   synthesize a genuinely new game at the target top level, honoring each source's assigned
   aspect. Do NOT ship the upstream sources verbatim — combine the chosen aspects into a new
   `index.html` (+ assets).
   Keep the remix standalone: no runtime imports from `.remix-sources/`, parent folders, or
   remote assets unless their license explicitly allows it and attribution is recorded.
   If the remix uses vector/skeletal art, resolve it into one coherent cartoon family and explicit
   head-to-body proportion system for the new game. Rebuild crude source rigs or linework as needed;
   do not inherit thick black contours, mixed anatomy, or rigid paper-doll animation.
   Keep English as the primary/fallback language and replace inherited hard-coded display strings
   with semantic locale keys. A future language must be addable through locale configuration and a
   new catalog without editing the remixed gameplay or scene logic.
   Include top-level `favicon.svg` and `banner.jpg`; `banner.jpg` should be exactly 800x400.
   Follow the production standard's banner workflow: use image generation when available only with
   enough finished-game references to preserve the remix's actual identity; otherwise compose it
   from the UI-free attract scene or a dedicated in-game promotional camera capture.
   Reassess platform features for the new loop rather than copying a parent's integration blindly.
   Prefer the current `paean-sdk` when its documented storage, leaderboard, payment, advertising,
   multiplayer, or social capabilities suit the remix; never invent unavailable APIs, and preserve
   graceful local play for optional capabilities.

5. **Finalize `clide.json`** — set `title`, `summary`, `category`, `tags`, and each
   `remix.parents[].role` (and `weight` for an uneven split). If the remix keeps a parent
   gameplay loop, save keys, storage namespaces, and visible title/identity must be changed
   so it does not collide with or impersonate the parent.

6. **Validate** with `paean-game-create/scripts/validate-game.mjs`, including Playwright runtime
   checks and full-size visual review at its phone, tablet, and desktop viewports in both mobile
   orientations. Confirm every initial load automatically reaches the UI-free core-play highlight,
   and inspect the banner at full 800x400 size and listing-thumbnail size.

7. **Publish** with the paean-publish skill from the target directory; it reads `clide.json`
   for naming, metadata, and lineage automatically, publishes into the workspace saved in
   `.clide/publish.json`, and on that first publish removes any clone-only files no longer in
   your project, so nothing upstream ships unintentionally.

## Remix graph (clide.json)

- `remix.parent` — single primary upstream. This is sent as backend `remixOfHashKey`,
  populates the legacy source/root columns, and should be the parent with the strongest
  structural contribution (usually gameplay).
- `remix.parents[]` — every direct upstream with its borrowed `role` and revenue `weight`
  (the remix DAG adjacency list). On publish these hashKeys are sent as backend
  `remixOfHashKeys`, which creates `SquareRemixEdge` rows for the full graph.

Both are kept in sync: tree-only consumers keep working; graph-aware consumers get the full
multi-parent picture. Do not include transitive ancestors unless the new work directly used
them as sources.

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
`--role <aspect>` (applies to the preceding source), `--clone-all` (clone every source with
`/remix` — full assets for all, but each secondary is credited twice), `--dry-run`, `--yes`.
`--help` prints usage.

## Failure handling

- Missing credentials → follow `../paean-zero-setup/SKILL.md`, or set `PAEAN_AUTH_TOKEN`.
- A source not found / not listed / not remixable → reported before any download; fix or drop it.
- `MCP list_app_files HTTP 401` → token invalid or expired; sign in again. `HTTP 429` → the
  MCP server allows 120 requests per minute per user; wait and re-run.
- A secondary's `REMIX-FETCH.json` lists files you truly need as-is → recreate them, or re-run
  with `--clone-all` after telling the user that source will be credited twice.
- `unzip` not found → install it.
