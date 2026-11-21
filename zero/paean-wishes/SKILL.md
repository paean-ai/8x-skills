---
name: paean-wishes
description: Browse, search, create, and prepare Paean community Wishes (许愿单). Anyone can view wishes openly, post a new wish for 10 credits (without starting an Agent task), or build and publish unlimited apps that fulfill any wish on 8x.gg and paean.ai. Runs from Zero CLI.
---

# Paean Wishes (Zero CLI) — Browse, Post & Fulfill Community Wishes

Paean Wishes (`许愿单`) connects players and creators directly across **paean.ai** and **8x.gg**.
Anyone can browse open wishes anonymously, anyone signed in can post a wish for **10 credits**
(without starting an automated agent job), and **anyone**—including the wisher themselves—can
build an app in Web Studio, Cloud Computer, Paean Harness, or CLI and link it when publishing.
A single wish can collect an unlimited number of fulfilling apps; each Square app can link to
at most one wish (`0..1`).

> **Installing in Zero CLI.** Zero discovers skills from a `skills/` directory — project
> `.zero/skills/` or global `~/.zero/skills/`. Copy this skill directory there:
> `mkdir -p ~/.zero/skills && cp -R <8x-skills>/zero/paean-wishes ~/.zero/skills/`. Any scripts and
> reference files live next to this SKILL.md.

When a user invokes this skill, check whether they want to browse/inspect wishes (`list` / `get`),
post a new wish (`create`), or set up a workspace to implement a specific wish (`prepare`).

## 1. Check Available Wishes

Use `list` and `get` without requiring credentials for public wishes:

```bash
# Search unfulfilled game wishes (newest first)
node "$SKILL_DIR/scripts/wishes.mjs" list --q "pixel pinball" --category game --fulfillment unfulfilled

# Inspect a full wish brief (accepts bare hashKey or https://paean.ai/wishes/<key> / https://8x.gg/wishes/<key>)
node "$SKILL_DIR/scripts/wishes.mjs" get <hashKey|url>

# Machine-readable JSON output for agents
node "$SKILL_DIR/scripts/wishes.mjs" list --json
node "$SKILL_DIR/scripts/wishes.mjs" get <hashKey|url> --json
```

When authenticated (Zero CLI login `~/.zero/credentials.json` or `~/.paean/credentials.json` or
`PAEAN_AUTH_TOKEN`), pass `--mine` to view your own posted wishes or `--fulfilled-by-me` to see
wishes you have already linked works to.

## 2. Prepare a Workspace to Fulfill a Wish

Before building a game or app for a wish, prepare the workspace directory so the brief and link
metadata are persisted locally:

```bash
node "$SKILL_DIR/scripts/wishes.mjs" prepare <hashKey|url> --dir . [--note "Added CRT shader & 2-player mode"]
```

This does two things:
1. Writes `WISH.md` with the wish title, creator, full prompt, tags, and reference image URLs.
2. Updates `clide.json` with `"wish": { "hashKey": "...", "title": "...", "note": "..." }`.

Once `clide.json.wish` is set, **paean-publish** automatically sends `wishHashKey` and `wishNote`
when publishing to Apps Square (unless overridden with `--wish` or detached with `--no-wish`).

## 3. Create a Wish (10 Credits, No Agent Job)

Posting a wish consumes **10 credits** from the caller's Paean account and lists the idea
publicly—no AI build job is started. Always preview with `--dry-run` and confirm the 10-credit
cost with the user before submitting:

```bash
# Preview payload & credit cost (no network write)
node "$SKILL_DIR/scripts/wishes.mjs" create \
  --title "Retro Cyber Pinball" \
  --prompt "A synthwave pixel-art pinball machine with multi-ball combos and leaderboard" \
  --category game \
  --tags "pinball,pixel,arcade" \
  --dry-run

# Submit for real (charges 10 credits)
node "$SKILL_DIR/scripts/wishes.mjs" create \
  --title "Retro Cyber Pinball" \
  --prompt "A synthwave pixel-art pinball machine with multi-ball combos and leaderboard" \
  --category game \
  --tags "pinball,pixel,arcade"
```

## 4. MCP Tools (`8x-gg` Server)

If the `8xgg` MCP server is connected, read-only tools **`search_wishes`** and **`get_wish`** are
also available alongside `search_apps`, `find_app`, `get_app`, and `read_app_file`.
