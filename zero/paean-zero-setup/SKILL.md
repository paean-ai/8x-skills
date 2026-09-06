---
name: paean-zero-setup
description: Install Zero CLI, authenticate the local machine with Paean so the Paean publish/remix skills can read credentials, and register the 8x.gg MCP server (`8xgg`) used for remix discovery. Use when `zero` is missing, Paean credentials are missing, login is needed, the 8x.gg / `8xgg` MCP server is missing, or the user asks how to set up Zero / Paean auth / `~/.zero` credentials for `clide.app` publishing.
---

# Paean Zero Setup (Zero CLI)

Install Zero CLI and authenticate the local machine with Paean. Use this before
`paean-publish` or `paean-remix` when credentials are missing.

Since this skill is running inside Zero CLI already, the install step is usually a no-op —
the main job is making sure the machine is signed in to **Paean** (not a third-party
provider) so the publish/remix scripts can read `~/.zero/credentials.json`.

## What to check first

Run these without printing secrets:

```bash
command -v zero
zero --version
zero auth status --json
zero provider status --json
```

If `zero` is missing, install it. If a third-party provider is active and the user wants
Paean login for publishing, switch back to Paean with `zero provider clear`.

## Install Zero CLI

Zero requires Node.js 18+.

```bash
node -v
npm install -g @paean-ai/zero-cli
zero --version
```

If the user uses Bun:

```bash
bun add -g @paean-ai/zero-cli
```

If global install is not desired, use `npx @paean-ai/zero-cli` for one-off runs, but prefer a
global install for ongoing publish/remix workflows.

## Sign in to Paean

Use the browser/device flow provided by Zero:

```bash
zero provider clear
zero login
zero auth status --json
```

`zero login` is the shortcut for `zero auth login`. It stores Paean auth locally under the
Zero config directory (`~/.zero/credentials.json`), which is exactly the file the
publish/remix scripts read. Do not ask the user to paste JWTs or API keys into chat.

## Manual fallback

If browser login is not possible, ask the user to set a local environment variable or
credentials file themselves:

```bash
export PAEAN_AUTH_TOKEN="<your-paean-jwt>"
```

or create `~/.paean/credentials.json`:

```json
{"token":"<your-paean-jwt>"}
```

The publish/remix scripts also read `~/.zero/credentials.json`. `PAEAN_API_BASE` overrides the
API endpoint (default `https://api.paean.ai`); `ZERO_API_BASE` / `ZERO_CLI_BASE_URL` are
honored only when they point at a `*.paean.ai` host — `ZERO_CLI_BASE_URL` is often the LLM
gateway (e.g. an Anthropic-compatible provider URL) and is never a Paean API address.

## Register the 8x.gg MCP server (remix discovery)

The **paean-remix** flow pairs with the 8x.gg MCP server at `https://api.paean.ai/8x/mcp`.
It gives the agent `find_app` / `search_apps` (resolve any 8x.gg or clide.app URL, a title or a
description to an app), `get_app` / `get_remix_lineage` / `get_app_growth` (decide whether a
remix is worth doing) and `list_app_files` / `read_app_file` (study source without cloning
anything). It authenticates with the same Paean token the scripts use.

- **Inside the Paean Mac app (Deeptide engine)** the server is registered automatically as
  `8xgg` for the signed-in account — nothing to do. Check with `/mcp`; a user-defined `8xgg`
  entry always overrides the automatic one.
- **Standalone Zero CLI** does not auto-register it. Add it once at user scope:

  ```bash
  zero mcp add --transport http --scope user 8xgg https://api.paean.ai/8x/mcp \
    --header 'Authorization: Bearer ${PAEAN_AUTH_TOKEN}'
  zero mcp list
  ```

  Zero expands `${VAR}` in headers when it connects, so the token never lands in the config
  file — `PAEAN_AUTH_TOKEN` must be exported in the shell that launches `zero`. If the token
  only lives in `~/.paean/credentials.json` / `~/.zero/credentials.json`, either export it
  from there in the shell profile, or register a literal `os_ak_…` API key (Paean dashboard →
  API keys) instead of the login JWT: a literal header is stored on disk in Zero's config, and
  an API key can be revoked on its own without signing the machine out.

`zero mcp list` must show `8xgg` as connected; `zero mcp remove --scope user 8xgg` undoes it.
Without the server `remix.mjs` still works (it calls `/8x/mcp` itself for secondary sources) —
only URL/title discovery is lost, so ask the user for hashKeys instead.

## Verify for Paean skills

From the project or target working directory, dry-run the relevant skill:

```bash
node "<paean-publish-skill-dir>/scripts/publish.mjs" --dry-run
node "<paean-remix-skill-dir>/scripts/remix.mjs" --dry-run <hash>
```

If the only failure is missing credentials, repeat the login steps. If Zero is configured for
a third-party provider, `zero provider clear` restores Paean.ai as the active login surface.
