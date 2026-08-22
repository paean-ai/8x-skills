---
name: paean-publish
description: Publish a static frontend with a top-level index.html to Clide hosting, optionally without an Apps Square listing, or publish it publicly to Paean Apps Square. Use for clide.app hosting/deploy requests, Square listing requests, and custom *.clide.app subdomains. This skill does not deploy server-side Workers or provision D1/R2 bindings.
---

# Paean Publish (Codex)

Publish a static frontend to a public `*.clide.app` URL using the bundled
`scripts/publish.mjs`. The script needs Node 18+ and `zip` on PATH.

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
- `--dry-run` makes no API calls and writes no local state.

## Flags

`--hosting-only` (alias `--no-square`), `--dry-run`, `--yes`, `--dir <dir>`,
`--handle <subdomain>`, `--title`, `--summary`, `--category`, repeated `--tag`, `--license`,
`--allow-secrets`, `--allow-static-only`, and `--delete [--handle <handle>]`.

`--delete` removes a direct Clide-hosted deployment owned by the current account. Deletion is
destructive; resolve the exact saved/explicit handle and obtain confirmation first.
