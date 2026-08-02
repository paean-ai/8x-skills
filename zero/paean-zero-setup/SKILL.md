---
name: paean-zero-setup
description: Install Zero CLI and authenticate the local machine with Paean so the Paean publish/remix skills can read credentials. Use when `zero` is missing, Paean credentials are missing, login is needed, or the user asks how to set up Zero / Paean auth / `~/.zero` credentials for `clide.app` publishing.
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

## Verify for Paean skills

From the project or target working directory, dry-run the relevant skill:

```bash
node "<paean-publish-skill-dir>/scripts/publish.mjs" --dry-run
node "<paean-remix-skill-dir>/scripts/remix.mjs" --dry-run <hash>
```

If the only failure is missing credentials, repeat the login steps. If Zero is configured for
a third-party provider, `zero provider clear` restores Paean.ai as the active login surface.
