---
name: paean-publish
description: Publish a static frontend (a game or site with a top-level index.html) to Paean Apps Square and a *.clide.app URL using a Paean JWT. Use when the user asks to publish, deploy, ship, or list a static app/game to Paean Apps Square / clide.app (e.g. "publish this game", "deploy to clide.app", "发布到应用广场"). Runs from Zero CLI.
---

# Paean Publish (Zero CLI)

Publish the current project's static frontend to a Paean workspace, deploy it to a
`*.clide.app` URL, and list it publicly in **Paean Apps Square**.

This skill bundles a self-contained Node script — `scripts/publish.mjs` — that does the
upload. It needs Node 18+ (for global `fetch`) and the `zip` command on PATH.

> **Installing in Zero CLI.** Zero discovers skills from a `skills/` directory — project
> `.zero/skills/` or global `~/.zero/skills/`. Copy this skill directory there:
> `mkdir -p ~/.zero/skills && cp -R <8x-skills>/zero/paean-publish ~/.zero/skills/`. The
> skill is then auto-offered when a request matches its description.

## Credentials

The script authenticates with a Paean JWT, resolved in this order:

1. `PAEAN_AUTH_TOKEN` environment variable (your Paean JWT) — recommended.
2. `~/.paean/credentials.json` or `~/.zero/credentials.json` as `{"token":"<jwt>"}`.

Zero CLI's own `zero login` writes `~/.zero/credentials.json`, so after a Paean login the
script works with no further setup. If none is set, the script stops with an error. Prefer
the **paean-zero-setup** skill to install Zero and run `zero login`; never paste the token
into chat.

## Run

Let `$SKILL_DIR` be the directory containing this SKILL.md. Always run from the project
root so the script treats the current directory as the project to publish.

1. **Inspect first (no API calls, no writes):**
   ```bash
   node "$SKILL_DIR/scripts/publish.mjs" --dry-run
   ```
   The dry-run prints the resolved publish directory, the file/byte summary, the secret
   scan result, the chosen `title` and its `titleSource`, the license, and any remix
   lineage read from `clide.json`.

2. **Choose a good public name.** Do NOT publish under the bare directory name. If the
   dry-run reports `titleSource: "directory-name"` or a `titleWarning`, read the game's
   own content (its `index.html` title/heading, `clide.json`, `package.json`) and pass an
   explicit `--title` that reflects the theme and gameplay (e.g. `--title "Neon Drift Racer"`).
   Add `--summary`, `--category`, and repeated `--tag` when they improve the listing.

3. **Confirm with the user.** Publishing is public: the site becomes reachable at a
   `*.clide.app` URL and is listed in Paean Apps Square. Get explicit confirmation.

4. **Publish:**
   ```bash
   node "$SKILL_DIR/scripts/publish.mjs" --yes --title "<Good Name>" [--summary "..."] [--category "..."] [--tag "..."]
   ```
   `--yes` skips the script's own interactive prompt (you already confirmed with the user).

5. Report the resulting `*.clide.app` URL, the Square app hash, and the workspace hash.

## Behavior

- Publishes a directory containing a top-level `index.html`. For built apps it prefers the
  build output: `dist`, `build`, `out`, `.output/public`, then `public`; falls back to the
  project root. If there is no output but `package.json` has a `build` script, it builds first.
- Before a real publish it ensures the project files are complete: `.clideignore` (safety
  defaults), `clide.json` (the metadata manifest), and `LICENSE` are created if missing.
  `clide.json` and `.remix-sources/` are excluded from the published site.
- Published games should carry the standard `index.html` copyright comment near `<head>`:
  `Copyright (c) 2026 paean.ai and the game's creator(s).` If it is missing, add it before
  publishing.
- Games should include top-level `favicon.svg` and `banner.jpg` (exactly 800x400). Missing or
  wrong-size media is reported as `assetWarnings`; it does not block publishing.
- Naming precedence: `--title` > `clide.json` title > `package.json` name > a meaningful
  `index.html` `<title>` > directory name (last resort, surfaced as a warning).
- `--license <spdx>` sets the license (default `MIT`; e.g. `MIT`, `Apache-2.0`, `CC-BY-4.0`,
  `CC0-1.0`, `UNLICENSED`).
- Secrets: `.env`, keys, `.git`, `node_modules`, logs, source maps, and editor/OS junk are
  excluded by default, and included text assets are scanned for high-confidence secrets.
  If the scan blocks the publish, add the file to `.clideignore`, or use `--allow-secrets`
  only when the match is intentional.
- Remix lineage: if `clide.json` records a remix (written by the **paean-remix** skill), the
  publish sends `remixOfHashKey` (the primary parent) plus `remixOfHashKeys` (all direct
  parents) so zero-api records both the legacy primary parent and the full
  `SquareRemixEdge` DAG.
- Re-publishing reuses the saved workspace (`.clide/publish.json`) to update the same Square
  listing.

## Flags

`--dry-run`, `--yes`, `--allow-secrets`, `--dir <dir>`, `--title <t>`, `--summary <t>`,
`--category <c>`, `--tag <t>` (repeatable), `--license <spdx>`. Run with `--help` for usage.

## Failure handling

- Missing credentials → use the **paean-zero-setup** skill, or tell the user to set
  `PAEAN_AUTH_TOKEN`.
- No top-level `index.html` → built apps must publish their build output directory, not the
  source directory. Build first, or pass `--dir <build-output>`.
- `zip` not found → install it (it ships with macOS and most Linux distros).
