---
name: paean-zero-setup
description: Install Zero CLI, help the user sign in to Paean so Paean publish/remix skills can read credentials, and register the 8x.gg MCP server (8xgg) used for remix discovery. Use when Zero is missing, Paean credentials are missing, login is needed, the 8x.gg / 8xgg MCP server is missing, or the user asks how to set up Zero / Paean auth / ~/.zero credentials for clide.app publishing.
---

# Paean Zero Setup (Codex)

Install Zero CLI and authenticate the local machine with Paean so the Paean publish/remix
skills can read credentials. Use this when `zero` is missing, Paean credentials are missing,
login is needed, or the user asks how to set up Zero / Paean auth / `~/.zero` credentials for
`clide.app` publishing.

> **Using this skill in Codex.** Reference this file explicitly — add a pointer in your
> project `AGENTS.md` ("To install Zero CLI or log in to Paean for publishing, follow
> `8x-skills/codex/paean-zero-setup/SKILL.md`.") or name the skill in your prompt.

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
Zero config directory. Do not ask the user to paste JWTs or API keys into chat.

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
anything). It authenticates with the same Paean token the scripts use. Add it once:

```bash
codex mcp add 8xgg --url https://api.paean.ai/8x/mcp --bearer-token-env-var PAEAN_AUTH_TOKEN
codex mcp list
```

Codex stores only the variable *name* in `~/.codex/config.toml`
(`[mcp_servers.8xgg]` with `url` and `bearer_token_env_var = "PAEAN_AUTH_TOKEN"`) and reads the
value from the environment when it starts, so `PAEAN_AUTH_TOKEN` must be exported in the shell
that runs `codex`. If the token only lives in `~/.paean/credentials.json` /
`~/.zero/credentials.json`, export it from there in the shell profile. Prefer an `os_ak_…` API
key (Paean dashboard → API keys) over the login JWT for a long-lived shell export; it can be
revoked on its own without signing the machine out.

`codex mcp list` must show `8xgg`; `codex mcp remove 8xgg` undoes it. Without the server
`remix.mjs` still works (it calls `/8x/mcp` itself for secondary sources) — only URL/title
discovery is lost, so ask the user for hashKeys instead.

## Verify for Paean skills

From the project or target working directory, dry-run the relevant skill:

```bash
node "<paean-publish-skill-dir>/scripts/publish.mjs" --dry-run
node "<paean-remix-skill-dir>/scripts/remix.mjs" --dry-run <hash>
```

If the only failure is missing credentials, repeat the login steps. If Zero is configured for
a third-party provider, `zero provider clear` restores Paean.ai as the active login surface.
