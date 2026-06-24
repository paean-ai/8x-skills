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
the environment — never paste it into chat.

## Source references

Each source is a published Square app reference. Accepted forms: a bare hashKey,
`hash.8x.gg`, `hash.clide.app`, `https://hash.clide.app/`, `https://8x.gg/hash`, or
`hash=role` to tag the aspect you want from it (e.g. `h1=gameplay h2=art h3=theme`).

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

4. **Build the new game.** Read the relevant files under each `.remix-sources/<hash>/` and
   compose a genuinely new game at the target directory's top level, honoring the aspect the
   user assigned to each source (the classic recipe is "h1 gameplay + h2 art/visual style +
   h3 theme/subject"). Do NOT ship the upstream sources verbatim — synthesize a new
   `index.html` (and assets) that combines the chosen aspects. Keep `.remix-sources/` for
   reference only; it is not published.

5. **Finalize `clide.json`.** Set a fitting `title`, `summary`, `category`, and `tags` for the
   new game, and set each `remix.parents[].role` to the aspect actually borrowed. Adjust
   `weight` if the user wants an uneven upstream split.

6. **Publish** with the **paean-publish** skill from the target directory. It reads
   `clide.json` for naming, metadata, and the remix lineage automatically.

## Remix graph (clide.json)

The manifest records lineage in two compatible shapes at once:

- `remix.parent` — a single upstream hashKey (the legacy *tree* form; mirrors the backend's
  `remixOfHashKey`). Always the first parent.
- `remix.parents[]` — the full *graph* form: every direct upstream, each with the borrowed
  aspect (`role`) and a suggested revenue `weight`. This is the adjacency list of the remix
  DAG (this game → each parent) that upstream revenue-sharing consumes.

Keeping both in sync means tree-only consumers keep working while graph-aware consumers get
the complete multi-parent picture.

## Flags

`--dir <dir>`, `--title <t>`, `--summary <t>`, `--category <c>`, `--license <spdx>`,
`--role <aspect>` (applies to the preceding source), `--dry-run`, `--yes`. Run with `--help`.

## Failure handling

- Missing credentials → tell the user to set `PAEAN_AUTH_TOKEN`.
- A source that is not found / not listed / not remixable → the script reports which hash
  failed before any download. Fix or drop that source and re-run.
- `unzip` not found → install it (ships with macOS and most Linux distros).
