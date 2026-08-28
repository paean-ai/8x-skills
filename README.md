# 8x Skills

Portable agent skills for **building**, **publishing**, and **remixing** games on
[Paean Apps Square](https://clide.app) (`*.clide.app` / `8x.gg`) — usable from **Zero CLI**,
**Claude Code**, and **Codex** (or any agent that can read a `SKILL.md` and run a Node script).

| Skill | What it does |
|-------|--------------|
| **paean-skills-update** | Pull or sync this `8x-skills` repo and reinstall/refresh the Paean skill files for Zero CLI, Claude Code, or Codex projects. |
| **paean-zero-setup** | Install Zero CLI and sign in to Paean so publish/remix scripts can read local credentials from Zero or a Paean token file. |
| **paean-game-create** | Create or substantially upgrade a commercially polished, mobile-first Paean web game. Defines the production standard for art, gameplay, attract-mode previews, responsive UI, pure-JS architecture, compact assets, and Playwright release validation. |
| **paean-sdk** | Add Paean platform capabilities — cross-device **cloud save** and a **shared global leaderboard** — to a static app/game via the Paean Web SDK. Ships a verified, framework-agnostic integration module + a mock host bridge for offline testing. Handles the cross-host edge cases (per-scope grants, return-shape differences, late bridge injection, offline queue) and degrades cleanly to `localStorage` in a plain browser. |
| **paean-publish** | Deploy a static frontend (top-level `index.html`) to `*.clide.app` either as hosting-only (`--hosting-only`, no Apps Square row) or as a public Square listing. Supports custom handles, scans for secrets, and blocks accidental static-only upload of detected Worker/D1/R2 projects. |
| **paean-remix** | Download the source of one or more published games by hash and scaffold a new game that remixes them, recording a multi-parent remix graph (e.g. *h1 gameplay + h2 art + h3 theme*) so upstream creators can be credited. |

The publish/remix skills ship as self-contained Node scripts — no npm install, no external
dependencies beyond the Node runtime and a system `zip`/`unzip`. The **paean-game-create** skill
ships a game-production standard plus a static/Playwright validator. The **paean-sdk** skill ships
browser reference files (no server, no build) you copy into your app.

```
8x-skills/
├── zero/
│   ├── paean-skills-update/ SKILL.md
│   ├── paean-zero-setup/ SKILL.md
│   ├── paean-game-create/ SKILL.md + references/production-standard.md + scripts/validate-game.mjs
│   ├── paean-sdk/       SKILL.md + reference/{paean-platform,mock-bridge}.js + test-example.mjs
│   ├── paean-publish/   SKILL.md + scripts/publish.mjs
│   └── paean-remix/     SKILL.md + scripts/remix.mjs
├── claude-code/
│   ├── paean-skills-update/ SKILL.md
│   ├── paean-zero-setup/ SKILL.md
│   ├── paean-game-create/ SKILL.md + references/production-standard.md + scripts/validate-game.mjs
│   ├── paean-sdk/       SKILL.md + reference/{paean-platform,mock-bridge}.js + test-example.mjs
│   ├── paean-publish/   SKILL.md + scripts/publish.mjs
│   └── paean-remix/     SKILL.md + scripts/remix.mjs
└── codex/
    ├── paean-skills-update/ SKILL.md
    ├── paean-zero-setup/ SKILL.md
    ├── paean-game-create/ SKILL.md + references/production-standard.md + scripts/validate-game.mjs
    ├── paean-sdk/       SKILL.md + reference/{paean-platform,mock-bridge}.js + test-example.mjs
    ├── paean-publish/   SKILL.md + scripts/publish.mjs
    └── paean-remix/     SKILL.md + scripts/remix.mjs
```

All three variants ship the **same** scripts and reference files; only the `SKILL.md`
packaging differs. The **zero/** and **claude-code/** variants use YAML frontmatter
(`name:` + `description:`) for auto-loading — Zero CLI discovers skills from
`.zero/skills/` / `~/.zero/skills/`, Claude Code from `.claude/skills/` /
`~/.claude/skills/`. Codex has no skill loader and references the files explicitly.

## Requirements

- **Node.js 18+** (for global `fetch`).
- `zip` on PATH for publishing; `unzip` on PATH for remixing (both ship with macOS and most
  Linux distributions).
- A **Paean JWT** (the token the Paean web app / Zero CLI uses).

## Credentials

Install Zero CLI and log in to Paean (recommended):

```bash
npm install -g @paean-ai/zero-cli
zero provider clear
zero login
zero auth status --json
```

The publish/remix scripts read the Paean credentials saved by Zero in `~/.zero/credentials.json`.
If browser login is not possible, set your Paean JWT via the environment, or a credentials file:

```bash
export PAEAN_AUTH_TOKEN="<your-paean-jwt>"
# or: ~/.paean/credentials.json  →  {"token":"<your-paean-jwt>"}
```

The scripts also read `~/.zero/credentials.json` if present. **Never paste the token into the
chat** — keep it in the environment or the credentials file. Optional: `PAEAN_API_BASE`
overrides the API endpoint (default `https://api.paean.ai`). `ZERO_API_BASE` /
`ZERO_CLI_BASE_URL` are only honored when they point at a `*.paean.ai` host — in particular
`ZERO_CLI_BASE_URL` is often set to the LLM gateway (an Anthropic-compatible provider URL),
which is *not* a Paean API address and is ignored.

## Install

### Zero CLI

Zero discovers skills from a `skills/` directory — project `.zero/skills/` or global
`~/.zero/skills/`. Copy each Zero skill directory in:

```bash
mkdir -p ~/.zero/skills
cp -r 8x-skills/zero/paean-publish ~/.zero/skills/
cp -r 8x-skills/zero/paean-remix   ~/.zero/skills/
cp -r 8x-skills/zero/paean-zero-setup ~/.zero/skills/
cp -r 8x-skills/zero/paean-game-create ~/.zero/skills/
cp -r 8x-skills/zero/paean-sdk ~/.zero/skills/
cp -r 8x-skills/zero/paean-skills-update ~/.zero/skills/
```

Zero auto-offers a skill when a request matches its `description`; you can also invoke it
explicitly ("use the paean-publish skill").

### Claude Code

Copy a skill directory into your skills folder (project `.claude/skills/` or global
`~/.claude/skills/`):

```bash
cp -r 8x-skills/claude-code/paean-publish ~/.claude/skills/
cp -r 8x-skills/claude-code/paean-remix   ~/.claude/skills/
cp -r 8x-skills/claude-code/paean-zero-setup ~/.claude/skills/
cp -r 8x-skills/claude-code/paean-game-create ~/.claude/skills/
cp -r 8x-skills/claude-code/paean-sdk ~/.claude/skills/
cp -r 8x-skills/claude-code/paean-skills-update ~/.claude/skills/
```

Claude Code auto-discovers the `SKILL.md` and offers the skill when relevant. You can also
invoke it explicitly ("use the paean-publish skill").

### Codex

Codex has no frontmatter skill loader, so reference the skill explicitly. Either keep this
repo in your project and add a pointer to your `AGENTS.md`:

```markdown
## Skills
- To update Paean skills, follow `8x-skills/codex/paean-skills-update/SKILL.md`.
- To install Zero CLI or log in to Paean for publishing, follow `8x-skills/codex/paean-zero-setup/SKILL.md`.
- To create or substantially polish a Paean game, follow `8x-skills/codex/paean-game-create/SKILL.md`.
- To add cloud save or a global leaderboard, follow `8x-skills/codex/paean-sdk/SKILL.md`.
- To host on Clide or publish to Paean Apps Square, follow `8x-skills/codex/paean-publish/SKILL.md`.
- To remix Paean Apps Square games, follow `8x-skills/codex/paean-remix/SKILL.md`.
```

…or point Codex at the file directly in your prompt.

## Usage

From the project you want to publish:

```bash
# Preview, then publish to Apps Square under a good name
node <skill-dir>/scripts/publish.mjs --dry-run
node <skill-dir>/scripts/publish.mjs --yes --title "Neon Drift Racer" --category racing

# Preview, then deploy to Clide hosting without an Apps Square listing
node <skill-dir>/scripts/publish.mjs --dry-run --hosting-only --dir dist --handle neon-drift
node <skill-dir>/scripts/publish.mjs --yes --hosting-only --dir dist --handle neon-drift
```

Before publishing a newly created or remixed game, validate its self-contained project and browser
runtime (Playwright must be installed in the working environment):

```bash
node <paean-game-create-skill-dir>/scripts/validate-game.mjs <game-dir> \
  --screenshots <temporary-screenshot-dir>
```

To remix existing games into a new one:

```bash
# Download h1's gameplay, h2's art, h3's theme; then build the new game and publish it
node <skill-dir>/scripts/remix.mjs --yes h1=gameplay h2=art h3=theme --dir my-remix
```

Run any script with `--help` for full usage. See each skill's `SKILL.md` for the complete
workflow the agent should follow.

## The remix graph (`clide.json`)

`paean-remix` writes a `clide.json` manifest that records lineage in two compatible shapes at
once:

```jsonc
{
  "schemaVersion": 1,
  "title": "Neon Drift Racer",
  "category": "racing",
  "tags": ["neon", "racing"],
  "license": "MIT",
  "remix": {
    "parent": "h1",                                  // tree form: primary upstream
    "parents": [                                     // graph form: the remix DAG
      { "hashKey": "h1", "role": "gameplay", "weight": 1 },
      { "hashKey": "h2", "role": "art",      "weight": 1 },
      { "hashKey": "h3", "role": "theme",    "weight": 1 }
    ]
  }
}
```

`remix.parent` keeps tree-only consumers (and the backend `remixOfHashKey` primary-parent
field) working, while `remix.parents[]` is the adjacency list of the multi-parent remix DAG —
each direct upstream with the aspect it contributed and a suggested revenue `weight`.
`paean-publish` forwards the direct parent hashKeys as `remixOfHashKeys`, so zero-api records
`SquareRemixEdge` rows for the full graph.

## Safety

- Both modes create a **publicly reachable site**. The scripts require explicit confirmation
  (or `--yes`); hosting-only never creates a workspace or Apps Square listing.
- Wrangler/Worker/D1/R2 projects are reported as runtime-incompatible and blocked before
  upload unless the user explicitly accepts a frontend-only deployment with
  `--allow-static-only`.
- Published games should include the standard paean.ai copyright comment in `index.html` and
  carry a project `LICENSE`; remixes should also record direct parents in `clide.json`.
- Games should ship a top-level `favicon.svg` and an 800x400 `banner.jpg`. The publish script
  warns when either is missing or the banner size is wrong, but does not block publishing.
- Credentials are read from the environment / a credentials file only — never hard-coded, and
  never written into the published output.
- A high-confidence secret scanner blocks publishing files that look like private keys or API
  tokens.
- Raw downloaded upstream sources (`.remix-sources/`) and the `clide.json` manifest are
  excluded from the published site by default.
- `paean-publish --delete` is mode-aware: Square projects are unlisted before their Clide files are
  removed, while hosting-only projects delete only their site. It can resolve a missing Square hash
  from the saved/explicit handle and refuses cleanup when the Square identity cannot be established
  safely.

## License

MIT — see [LICENSE](./LICENSE).
