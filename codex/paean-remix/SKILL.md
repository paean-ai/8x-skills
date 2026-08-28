---
name: paean-remix
description: Remix one or more published Paean Apps Square games into a brand-new game. Downloads each source game's project files by hash and scaffolds a new project with a multi-parent remix graph. Use when the user asks to remix, fork, combine, or mash up published clide.app / Paean Apps Square games (e.g. "remix hash1 hash2", "用 hash1 的玩法 + hash2 的美术做个新游戏").
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

## Source references

Use Square app `hashKey` values: a bare hashKey, `https://8x.gg/<hashKey>`, or
`hashKey=role` to tag the borrowed aspect (e.g. `h1=gameplay h2=art h3=theme`). A
`*.clide.app` play URL contains the deployed site handle, not necessarily the Square
`hashKey`; if the user gives only a play URL, ask for the Square hashKey from the publish
result or Square app detail before running the script.

## Run

`$SKILL_DIR` is the directory containing this file. Run from where you want the new project.

1. **Inspect (no downloads, no writes):**
   ```bash
   node "$SKILL_DIR/scripts/remix.mjs" --dry-run <source> [<source> ...]
   ```
   Resolves each hash to its Square app and prints title/category/author + the target
   directory and remix graph that would be created.

2. **Confirm with the user** — remixing records lineage and credits each upstream creator.

3. **Download + scaffold:**
   ```bash
   node "$SKILL_DIR/scripts/remix.mjs" --yes h1=gameplay h2=art h3=theme [--dir <target>] [--title "<Name>"]
   ```
   The target directory then contains `.remix-sources/<hash>/` (full upstream source per
   game), `clide.json` (the remix graph), `LICENSE`, and `.clideignore` (excludes
   `.remix-sources/`).

4. **Build the new game with the `paean-game-create` production standard.** Read its `SKILL.md`
   and `references/production-standard.md`, then inspect each `.remix-sources/<hash>/` and
   synthesize a genuinely new game at the target top level, honoring each source's assigned
   aspect. Do NOT ship the upstream sources verbatim — combine the chosen aspects into a new
   `index.html` (+ assets).
   Keep the remix standalone: no runtime imports from `.remix-sources/`, parent folders, or
   remote assets unless their license explicitly allows it and attribution is recorded.
   Include top-level `favicon.svg` and `banner.jpg`; `banner.jpg` should be exactly 800x400.

5. **Finalize `clide.json`** — set `title`, `summary`, `category`, `tags`, and each
   `remix.parents[].role` (and `weight` for an uneven split). If the remix keeps a parent
   gameplay loop, save keys, storage namespaces, and visible title/identity must be changed
   so it does not collide with or impersonate the parent.

6. **Validate** with `paean-game-create/scripts/validate-game.mjs`, including Playwright runtime
   checks and full-size visual review at its phone and desktop viewports.

7. **Publish** with the paean-publish skill from the target directory; it reads `clide.json`
   for naming, metadata, and lineage automatically.

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
`--role <aspect>` (applies to the preceding source), `--dry-run`, `--yes`. `--help` prints usage.

## Failure handling

- Missing credentials → follow `../paean-zero-setup/SKILL.md`, or set `PAEAN_AUTH_TOKEN`.
- A source not found / not listed / not remixable → reported before any download; fix or drop it.
- `unzip` not found → install it.
