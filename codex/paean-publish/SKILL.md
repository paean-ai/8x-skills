---
name: paean-publish
description: Publish a static frontend (a game or site with a top-level index.html) to Paean Apps Square and a *.clide.app URL using a Paean JWT. Use when the user asks to publish, deploy, ship, or list a static app/game to Paean Apps Square / clide.app (e.g. "publish this game", "deploy to clide.app", "发布到应用广场").
---

# Paean Publish (Codex)

Publish the current project's static frontend (a game or site with a top-level `index.html`)
to a Paean workspace, deploy it to a `*.clide.app` URL, and list it publicly in **Paean Apps
Square**.

> **Using this skill in Codex.** Codex has no frontmatter skill loader, so reference this
> file explicitly: add a line to your project `AGENTS.md` such as
> *"To publish to Paean Apps Square, follow `8x-skills/codex/paean-publish/SKILL.md`."*,
> or point Codex at this file in your prompt ("use the paean-publish skill"). The skill is a
> self-contained Node script — `scripts/publish.mjs` — needing Node 18+ and `zip` on PATH.

## Credentials

The script authenticates with a Paean JWT, resolved in order:

1. `PAEAN_AUTH_TOKEN` environment variable (your Paean JWT) — recommended.
2. `~/.paean/credentials.json` or `~/.zero/credentials.json` as `{"token":"<jwt>"}`.

Prefer the `paean-zero-setup` skill to install Zero and run `zero login`. Otherwise set the
token via the environment; never paste it into the conversation.

## Run

`$SKILL_DIR` is the directory containing this file. Run all commands from the project root
(the script publishes the current working directory).

1. **Inspect first (no API calls, no writes):**
   ```bash
   node "$SKILL_DIR/scripts/publish.mjs" --dry-run
   ```
   It prints the resolved publish directory, file/byte summary, secret-scan result, the
   chosen `title` + `titleSource`, the license, and any remix lineage from `clide.json`.

2. **Pick a good public name.** Do NOT publish under the bare directory name. If the dry-run
   reports `titleSource: "directory-name"` or a `titleWarning`, inspect the game's content
   (`index.html` title/heading, `clide.json`, `package.json`) and pass an explicit `--title`
   that reflects the theme and gameplay. Add `--summary`, `--category`, and `--tag` as useful.

3. **Confirm with the user** — publishing is public (a `*.clide.app` site + a Square listing).

4. **Publish:**
   ```bash
   node "$SKILL_DIR/scripts/publish.mjs" --yes --title "<Good Name>" [--summary "..."] [--category "..."] [--tag "..."]
   ```

5. Report the `*.clide.app` URL, the Square app hash, and the workspace hash.

## Behavior

- Publishes a directory with a top-level `index.html`. For built apps it prefers build output
  (`dist`, `build`, `out`, `.output/public`, `public`) and will run `npm/pnpm/yarn/bun build`
  if needed.
- A real publish ensures `.clideignore`, `clide.json` (metadata manifest), and `LICENSE` exist.
  `clide.json` and `.remix-sources/` are excluded from the published site.
- Published games should carry the standard `index.html` copyright comment near `<head>`:
  `Copyright (c) 2026 paean.ai and the game's creator(s).` If it is missing, add it before
  publishing.
- Games should include top-level `favicon.svg` and `banner.jpg` (exactly 800x400). Missing or
  wrong-size media is reported as `assetWarnings`; it does not block publishing.
- Naming precedence: `--title` > `clide.json` > `package.json` name > meaningful `<title>` >
  directory name (last resort, warned).
- `--license <spdx>` sets the license (default `MIT`).
- Secrets are excluded by default and scanned; the scan blocks on a high-confidence match
  (override with `--allow-secrets` only when intentional).
- If `clide.json` records a remix (from the paean-remix skill), the publish sends
  `remixOfHashKey` (primary parent) plus `remixOfHashKeys` (all direct parents) so zero-api
  records both the legacy primary parent and the full `SquareRemixEdge` DAG.

## Flags

`--dry-run`, `--yes`, `--allow-secrets`, `--dir <dir>`, `--title <t>`, `--summary <t>`,
`--category <c>`, `--tag <t>` (repeatable), `--license <spdx>`. `--help` prints usage.

## Failure handling

- Missing credentials → follow `../paean-zero-setup/SKILL.md`, or set `PAEAN_AUTH_TOKEN`.
- No top-level `index.html` → publish the build output, not source (build first or `--dir`).
- `zip` not found → install it.
