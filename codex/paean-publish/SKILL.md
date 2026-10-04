---
name: paean-publish
description: Publish a static frontend with a top-level index.html to Clide hosting, optionally without an Apps Square listing, or publish it publicly to Paean Apps Square. Use for clide.app hosting/deploy requests, Square listing requests, and custom *.clide.app subdomains. This skill does not deploy server-side Workers or provision D1/R2 bindings.
---

# Paean Publish (Codex)

Publish a static frontend to a public `*.clide.app` URL using the bundled
`scripts/publish.mjs`. The script needs Node 18+ and nothing else — the upload archive is
built in-process by `scripts/zip.mjs`, so it runs the same on macOS, Linux and Windows.

> **Using this skill in Codex.** Install this directory under `~/.agents/skills/`
> or the project's `.agents/skills/` for discovery. Existing clients that already load
> `$CODEX_HOME/skills/` (default `~/.codex/skills/`) can update that directory in place.
> You can also reference `8x-skills/codex/paean-publish/SKILL.md` directly.
> Keep the bundled scripts and references beside this file; avoid duplicate installations.

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

Here "project root" means the directory containing the intended `clide.json`
and, when present, `.clide/publish.json`, not necessarily the Git root. `--dir` chooses uploaded
assets; it does **not** change where the script reads `clide.json`. For a nested
app with its own manifest, run from that app directory. Check the dry-run `access`
and product list explicitly: `access: null` means "preserve server configuration",
not "discover the manifest inside the uploaded assets".

```bash
# Clide hosting only; never creates a Square listing
node "$SKILL_DIR/scripts/publish.mjs" --dry-run --hosting-only [--dir dist] [--handle paeaninsight]

# Apps Square + Clide site
node "$SKILL_DIR/scripts/publish.mjs" --dry-run [--dir dist] [--title "Good Name"] [--handle chosen-name]
```

Review `publishDir`, file/byte summary, `secretScan`, `runtimeCompatibility`, destination,
and requested/effective handle. If the dry-run is safe and the user confirms that exact
public destination, run the same command without `--dry-run` and add `--yes`.

Report the returned `url`, handle, file count, mode, and `.clide/publish.json`. Report
workspace/Square hashes only in Square mode.

For Square publishes, `url` and `shareUrl` are the canonical public link
`https://www.8x.gg/apps/{squareAppHashKey}`. Use this link in the final reply and anywhere a
user will share or open the published work, including paid apps and remixes. `playUrl`
remains the runtime address and `shellUrl` remains available for technical diagnostics;
only show those alternative URLs when the user asks for them. The same distinction is
saved in `.clide/publish.json` so later updates retain the public link and runtime address.

Hosting-only results have no Square app ID: return their actual hosted `url`. Never invent
an `/apps/` link from a site handle or workspace ID. A dry-run has not published anything;
its `requestedUrl` describes the requested hosting address, not a completed share link.

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
- A **free base game can sell paid durable products**. Use `model: "free"` with
  `access.products`; an app-entry `--price` is not required for skin sales.
  Product prices, as well as entry prices, need the publisher's explicit approval.
- **Paid is one-way**: `--free` on an app that has sold as paid is rejected
  (`ACCESS_MODEL_LOCKED`). Say so before the first paid publish.
- **Remixes of a paid app are paid**: `paean-remix` writes the inherited `access` into
  `clide.json`; publishing such a remix as free is rejected (`ACCESS_MODEL_INHERITED`), and an
  undeclared one inherits the parent's price.
- The app must ship the SDK gate (`PaeanSDK.access.require()` on the first intentional tap —
  see `paean-sdk`) or paying players never leave the demo. Confirm it exists before a paid
  publish.

Report `access` alongside the canonical `url` from the publish output. Access options are not valid with
`--hosting-only`.

### Register and verify the product catalogue

This section applies to platform-managed `access.require({ sku })` products.
An app-managed `pay.spend` shop keeps its own prices and fulfillment logic and
does not need `access.products`. Check which contract the app actually uses;
an empty platform catalogue alone is not a failure of a direct-spend shop. See
`paean-sdk`'s IAP guide for receipt persistence and restoration requirements.

The tool reads `clide.json` in the command's working directory and sends its
resolved `access` as JSON in `POST /square/publish`. Merely uploading changed
HTML, models or `clide.json` leaves the listing's product catalogue unchanged.
`/paean-app.json` is generated from the platform listing; do not replace it to
pretend that products have been registered.

For an existing app needing only a catalogue update, the owner-authorized
`PATCH /square/apps/:hashKey` accepts `{ "access": ... }`. Resolve the exact
existing app and preserve its model, standalone policy and full intended product
list: `access` is a replacement, not a per-SKU merge. Verify the deployed endpoint
and ownership before use. A metadata-only administrator editor is not necessarily
a product editor. Do not recreate the listing to evade an ownership failure.

After an authorized update, verify `access.products` in the server response and
a fresh hosted `(await PaeanSDK.access.status()).products` against the intended catalogue.
The hosted `/paean-app.json` should also reflect it after its cache expires.
If products are absent, report incomplete catalogue activation even if the page
and local mock shop work. When the user defers publishing, provide the exact
declaration and state that the products are not yet live; do not activate prices.

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
