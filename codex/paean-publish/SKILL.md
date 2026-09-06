---
name: paean-publish
description: Publish a static frontend with a top-level index.html to Clide hosting, optionally without an Apps Square listing, or publish it publicly to Paean Apps Square. Use for clide.app hosting/deploy requests, Square listing requests, and custom *.clide.app subdomains. This skill does not deploy server-side Workers or provision D1/R2 bindings.
---

# Paean Publish (Codex)

Publish a static frontend to a public `*.clide.app` URL using the bundled
`scripts/publish.mjs`. The script needs Node 18+ and `zip` on PATH.

> **Using this skill in Codex.** Codex has no frontmatter skill loader, so
> reference this file explicitly: add a line to your project `AGENTS.md` such as
> *"For this task, follow `8x-skills/codex/paean-publish/SKILL.md`."*, or point Codex at
> this file in your prompt. Any scripts and reference files live next to this SKILL.md.

## Choose the mode from the user's intent

| User intent | Mode | Remote effect |
|---|---|---|
| Host/deploy on Clide, keep it out of the gallery | `--hosting-only` | Direct static hosting only; no workspace and no Apps Square row |
| Publish/list/share in Apps Square | default | Workspace upload, public Square listing, and `*.clide.app` site |

Do not turn a hosting request into a Square listing. If the user says “do not list in the
Square”, `--hosting-only` is mandatory. Both modes create a publicly reachable site, so get
explicit confirmation immediately before the real upload. A prior confirmation for one mode
does not authorize switching to the other.

## Credentials

Authentication resolves from `PAEAN_AUTH_TOKEN`, then `~/.paean/credentials.json` or
`~/.zero/credentials.json`. Prefer the `paean-zero-setup` skill when login is missing. Never
ask the user to paste a token into chat.

## Workflow

Run from the project root. Select the final mode during dry-run so the report describes the
same destination that will be used for the real publish.

```bash
# Clide hosting only; never creates a Square listing
node "$SKILL_DIR/scripts/publish.mjs" --dry-run --hosting-only [--dir dist] [--handle paeaninsight]

# Apps Square + Clide site
node "$SKILL_DIR/scripts/publish.mjs" --dry-run [--dir dist] [--title "Good Name"] [--handle chosen-name]
```

Review `publishDir`, file/byte summary, `secretScan`, `runtimeCompatibility`, destination,
and requested/effective handle. If the dry-run is safe and the user confirms that exact
public destination, run the same command without `--dry-run` and add `--yes`.

Report the URL, handle, file count, mode, and `.clide/publish.json`. Report workspace/Square
hashes only in Square mode.

## Full-stack and Worker projects

This skill uploads static browser files. It does not deploy Worker code, execute D1
migrations, create D1/R2/KV/Durable Object resources, or configure Worker bindings/routes.

The script inspects Wrangler configuration. When it detects server runtime or Cloudflare
bindings:

- dry-run returns `runtimeCompatibility.status: "blocked"`;
- a real publish stops before authentication or network mutation;
- `--allow-static-only` bypasses the block only when the user explicitly accepts that the
  backend/API will not be deployed and the uploaded frontend may be non-functional.

Do not use `--allow-static-only` merely to make a deployment succeed. Use the project's
Worker deployment workflow or add an actual Paean full-stack deployment API instead.

## Paid apps and durable products

A Square listing can be sold Steam-style: everyone may watch the demo; entering the full app
needs a one-time purchase in credits. Declare it on publish (Square mode only):

```bash
node "$SKILL_DIR/scripts/publish.mjs" --dry-run --dir dist --price 100 [--standalone allow|demo|shell] \
  [--product season_pass="Season Pass":50]...
```

- `--price <credits>` lists the app as paid (server limits, roughly 10–100000 credits; the
  platform keeps 20%, remix ancestors share the creator's cut). The declaration is written to
  `clide.json` `access`, so a later flag-less publish keeps it. Never invent a price: get the
  user's explicit number and confirmation.
- `--standalone` decides what a bare `https://<handle>.clide.app/` visit (no Paean host) does:
  `allow` = full app, `demo` = stay in demo and offer the 8x.gg shell (default for paid apps),
  `shell` = redirect to `https://<handle>.8x.gg/`. This is the publisher's choice.
- `--product sku=Title:credits` (repeatable) declares durable in-app items; the platform records
  ownership per player and the app reads it via `PaeanSDK.access`.
- **Paid is one-way**: `--free` on an app that has sold as paid is rejected
  (`ACCESS_MODEL_LOCKED`). Say so before the first paid publish.
- **Remixes of a paid app are paid**: `paean-remix` writes the inherited `access` into
  `clide.json`; publishing such a remix as free is rejected (`ACCESS_MODEL_INHERITED`), and an
  undeclared one inherits the parent's price.
- The app must ship the SDK gate (`PaeanSDK.access.require()` on the first intentional tap —
  see `paean-sdk`) or paying players never leave the demo. Confirm it exists before a paid
  publish.

Report `access` and `shellUrl` from the publish output. Access options are not valid with
`--hosting-only`.

## Custom subdomains

`--handle <subdomain>` requests `https://<subdomain>.clide.app/`. The server is authoritative
for availability and validation. Current server rules are approximately 9–32 lowercase
letters, digits, and dashes, starting with a letter or digit; some names are reserved.

- Claiming a new custom handle requires an active paid subscription and may cost more credits.
- A taken handle returns 409; a malformed/reserved handle returns 400; an ineligible account
  returns 402. Do not retry unchanged after these responses.
- Hosting-only re-publishes automatically reuse the handle saved in `.clide/publish.json`.
- If a hosting-only project already has a saved handle, passing a different handle is blocked
  instead of silently creating a second site. Rename or delete the old deployment explicitly.

## Packaging and safety

- Publish directories must contain top-level `index.html`. Auto-detection prefers `dist`,
  `build`, `out`, `.output/public`, `public`, then project root; a build runs when needed.
- `.clideignore` safety defaults exclude credentials, local state, source maps, dependency
  folders, editor files, logs, and common key formats. Included text assets receive a
  high-confidence secret scan.
- `--allow-secrets` is an exceptional override that requires the user to accept the concrete
  finding. Prefer excluding the file.
- Square mode ensures `clide.json` and `LICENSE` and uses listing metadata/remix lineage.
  Hosting-only mode does not create a Square row or require listing metadata/assets.
- Square listings expect three assets at the top level: `favicon.svg`, `banner.jpg` (exactly
  800×400) and `icon.jpg` (exactly 512×512, the square tile). Dry-run reports `assetWarnings`;
  fix them before a real publish rather than shipping placeholders.
- `--dry-run` makes no API calls and writes no local state.

## Flags

`--hosting-only` (alias `--no-square`), `--dry-run`, `--yes`, `--dir <dir>`,
`--handle <subdomain>`, `--title`, `--summary`, `--category`, repeated `--tag`, `--license`,
`--price <credits>` / `--free`, `--standalone allow|demo|shell`, repeated
`--product sku=Title:credits`, `--allow-secrets`, `--allow-static-only`, and
`--delete [--handle <handle>]`.

`--delete` is mode-aware through `.clide/publish.json`:

- for `hosting-only`, it deletes the owned Clide site;
- before any handle deletion, it checks `GET /square/apps/by-handle/:handle`; lookup failures or a
  mismatch with the saved Square hash stop without mutating either target;
- for `square`, it first calls `DELETE /square/apps/:hashKey` to hide the listing, and only after
  that succeeds deletes the Clide site. It uses the saved `squareAppHashKey`, or resolves an
  explicit/saved handle through `GET /square/apps/by-handle/:handle`; if a saved Square project
  cannot be resolved safely, it stops before deleting hosting;
- a Square-site 404 after a successful unlist is accepted as already deleted, which repairs state
  left by older versions that deleted hosting without unlisting Square.

Deletion is destructive; resolve the exact saved app/hash/handle and obtain confirmation first.
