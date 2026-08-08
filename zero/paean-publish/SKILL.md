---
name: paean-publish
description: Publish a static frontend (a game or site with a top-level index.html) to Paean Apps Square and a *.clide.app URL using a Paean JWT. Use when the user asks to publish, deploy, ship, or list a static app/game to Paean Apps Square / clide.app (e.g. "publish this game", "deploy to clide.app", "发布到应用广场"). Also use when they want to choose or change the app's *.clide.app subdomain (e.g. "publish it at neon-drift.clide.app", "change my app's subdomain", "自定义子域名", "改子域名") — a paid-subscription feature this skill's --handle flag exposes. Runs from Zero CLI.
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

3. **Only if the user asked for a specific subdomain, add `--handle`.** Do not pass it
   otherwise — omitting it is what keeps an existing app's URL stable, and it is the only
   way a free account can publish at all. See **Custom subdomains** below for who may use
   it and what changing one costs.

4. **Confirm with the user.** Publishing is public: the site becomes reachable at a
   `*.clide.app` URL and is listed in Paean Apps Square. Get explicit confirmation.

5. **Publish:**
   ```bash
   node "$SKILL_DIR/scripts/publish.mjs" --yes --title "<Good Name>" [--summary "..."] [--category "..."] [--tag "..."] [--handle "<subdomain>"]
   ```
   `--yes` skips the script's own interactive prompt (you already confirmed with the user).

6. Report the resulting `*.clide.app` URL, the Square app hash, and the workspace hash.

## Custom subdomains (paid plans)

Every published app is served at `https://<handle>.clide.app/`. By default the server picks
that handle: a random one on first publish, and the app's existing one on every re-publish.
`--handle <subdomain>` overrides it.

- **Who may.** Claiming a subdomain requires an **active paid Paean subscription**. Free
  accounts get an auto-assigned handle; passing `--handle` fails with a 402 and nothing is
  published. The server is the authority on this — the script does not pre-check the plan,
  so never tell the user they are eligible based on anything but a successful publish.
- **Format.** 9–32 characters, lowercase `a-z`, `0-9`, and `-`, starting with a letter or
  digit. A set of names is reserved (`admin`, `api`, `app`, …) and rejected with a 400. The
  script shape-checks the value before uploading anything, so typos fail instantly.
- **Cost.** Claiming a subdomain costs 30 credits, against 5 for a first publish under an
  assigned one. Only the claim is surcharged — once the handle is yours, re-publishing over
  it costs the ordinary 2-credit overwrite. Mention this when the user is choosing.
- **Changing an existing app's subdomain is destructive.** The app moves to the new URL and
  the old one is torn down — previously shared links, embeds, and QR codes break. Confirm
  this explicitly with the user before passing a `--handle` that differs from the app's
  current one.
- **Re-publishing keeps the URL.** Once an app has a handle, re-running without `--handle`
  publishes over the same subdomain. Re-passing the app's current handle is treated as an
  overwrite too — same URL, no new claim, no subscription check.
- Handles are globally unique across all Paean users; one taken by someone else fails with
  a 409. Suggest a different name rather than retrying.

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
- The dry-run echoes the subdomain you asked for as `requestedHandle` / `requestedUrl`
  (both `null` when `--handle` is omitted); a real publish reports the handle the server
  actually assigned as `handle`, alongside `requestedHandle`.

## Flags

`--dry-run`, `--yes`, `--allow-secrets`, `--dir <dir>`, `--title <t>`, `--summary <t>`,
`--category <c>`, `--tag <t>` (repeatable), `--license <spdx>`, `--handle <subdomain>`
(paid plans — see **Custom subdomains**). Run with `--help` for usage.

## Failure handling

- Missing credentials → use the **paean-zero-setup** skill, or tell the user to set
  `PAEAN_AUTH_TOKEN`.
- `--handle` rejected with **402** → the account has no active paid subscription. Offer to
  publish without `--handle` (auto-assigned URL), or point them at https://one.paean.ai to
  upgrade. Do not retry the same command.
- `--handle` rejected with **409** (taken) or **400** (reserved/malformed) → propose a
  different subdomain; the app was not published.
- No top-level `index.html` → built apps must publish their build output directory, not the
  source directory. Build first, or pass `--dir <build-output>`.
- `zip` not found → install it (it ships with macOS and most Linux distros).
