# Paean Remix (Codex)

Download the source of one or more published `*.clide.app` games (by hash) and use them as the
basis for a new game, recording the full remix lineage so upstream creators are credited.

> **Using this skill in Codex.** Reference this file explicitly — add a pointer in your project
> `AGENTS.md` ("To remix Paean Apps Square games, follow
> `8x-skills/codex/paean-remix/SKILL.md`.") or name the skill in your prompt. It is a
> self-contained Node script — `scripts/remix.mjs` — needing Node 18+ and `unzip` on PATH.

## Credentials

A Paean JWT from `PAEAN_AUTH_TOKEN`, or `~/.paean/credentials.json` / `~/.zero/credentials.json`
as `{"token":"<jwt>"}`. Set it via the environment; never paste it into the conversation.

## Source references

A bare hashKey, `hash.8x.gg`, `hash.clide.app`, `https://hash.clide.app/`, `https://8x.gg/hash`,
or `hash=role` to tag the borrowed aspect (e.g. `h1=gameplay h2=art h3=theme`).

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

4. **Build the new game.** Read each `.remix-sources/<hash>/` and synthesize a genuinely new
   game at the target top level, honoring each source's assigned aspect. Do NOT ship the
   upstream sources verbatim — combine the chosen aspects into a new `index.html` (+ assets).

5. **Finalize `clide.json`** — set `title`, `summary`, `category`, `tags`, and each
   `remix.parents[].role` (and `weight` for an uneven split).

6. **Publish** with the paean-publish skill from the target directory; it reads `clide.json`
   for naming, metadata, and lineage automatically.

## Remix graph (clide.json)

- `remix.parent` — single primary upstream (tree form; mirrors backend `remixOfHashKey`).
- `remix.parents[]` — every direct upstream with its borrowed `role` and revenue `weight`
  (the remix DAG adjacency list, for upstream revenue-sharing).

Both are kept in sync: tree-only consumers keep working; graph-aware consumers get the full
multi-parent picture.

## Flags

`--dir <dir>`, `--title <t>`, `--summary <t>`, `--category <c>`, `--license <spdx>`,
`--role <aspect>` (applies to the preceding source), `--dry-run`, `--yes`. `--help` prints usage.

## Failure handling

- Missing credentials → set `PAEAN_AUTH_TOKEN`.
- A source not found / not listed / not remixable → reported before any download; fix or drop it.
- `unzip` not found → install it.
