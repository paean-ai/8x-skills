# 8x Skills

Portable agent skills for **building**, **publishing**, and **remixing** games on
[Paean Apps Square](https://clide.app) (`*.clide.app` / `8x.gg`) — usable from **Zero CLI**,
**Claude Code**, **Codex**, **Gemini CLI**, **Antigravity**, and **DeepSeek Harness**
(or any agent that can read a `SKILL.md` and run a Node script).

For Xiaohongshu creators, the dedicated **[Red Skill edition](redskill/README.md)** combines
a Chinese creation entry with the existing conversion, recording, SDK, publishing and remix
workflows in one installable package. It produces an offline mini-tool by default and adds an
8x platform version when requested. Build it with `node scripts/build-redskill.mjs`; upload the
generated skill ZIP to **Red Skill**, and generated *work* ZIPs to **小工具**.

| Skill | What it does |
|-------|--------------|
| **paean-skills-update** | Update this repository and reinstall Paean skills for Zero CLI, Claude Code, Codex, Gemini CLI, Antigravity, or DeepSeek Harness. |
| **paean-zero-setup** | Install Zero CLI and sign in to Paean so publish/remix scripts can read local credentials from Zero or a Paean token file. |
| **paean-game-create** | Create or substantially upgrade a commercially polished, mobile-first Paean web game. Defines the production standard for art, gameplay, attract-mode previews, responsive UI, pure-JS architecture, compact assets, and Playwright release validation. |
| **paean-tts** | Generate game dialogue, spoken tutorials, pronunciation samples, and demo-video narration through Paean TTS using the creator's login. Includes a local CLI, resumable WAV output, and optional pitch-preserving speed adjustment. |
| **paean-sdk** | Design and integrate cloud save, ranking, paid access/IAP, rewarded ads/IAA, multiplayer rooms, AI including runtime TTS/read-aloud, shared data, and sharing. One entry routes to focused capability design guides; includes an integration module and offline mock host. |
| **paean-publish** | Deploy a static frontend (top-level `index.html`) to `*.clide.app` either as hosting-only (`--hosting-only`, no Apps Square row) or as a public Square listing. Supports custom handles, scans for secrets, and blocks accidental static-only upload of detected Worker/D1/R2 projects. |
| **paean-convert-to-ad** | Convert a finished work into an HTML5 playable-ad bundle (Google Ads `MEDIA_BUNDLE`): find the seam that opens straight into core play, tune a showcase run, auto-play then hand over control, exit to the store, and self-check that the bundle is fully offline. |
| **paean-convert-to-rednote** | Convert a finished work into a RedNote (Xiaohongshu) mini-tool: a fully offline zip on a Chrome 61 baseline. Ships the build pipeline, compatibility and artifact audits, plus a release standard for source credit in automatic demos and entry UI, optional virtual landscape with mapped controls, 14-character listing copy, a game-specific icon and a 30-second HD video from the final ZIP. Requires `esbuild`. |
| **paean-record-demo** | Record a 20–30 s arcade attract demo reel from a finished work: drives the game into a real session through its own seam, draws an optional title card, timed captions and a CTA end card over it, and exports MP4/WebM/GIF plus a poster frame. Playwright required; ffmpeg optional. |
| **paean-remix** | Remix one or more published games into a new one. Clones the primary source (full assets) into the user's workspace, reads secondary sources through the 8x.gg MCP server, and scaffolds a project with a multi-parent remix graph (e.g. *h1 gameplay + h2 art + h3 theme*) so every upstream creator is credited exactly once. |

For capability design, say `paean iap`, `paean iaa`, `paean net`, `paean rank`, or `paean ai`,
or combine them (for example, “use paean rank with an optional paean iaa revive”). These are
natural-language intents routed by [paean-sdk](claude-code/paean-sdk/SKILL.md), not CLI commands
or separately installed skills. Create and Remix select the same guides during their production
brief. Shared SDK contracts remain in one place; detailed design and acceptance live in
`paean-sdk/reference/design-*.md` and are loaded only when relevant.

The publish/remix skills ship as self-contained Node scripts — no npm install, no external
dependencies beyond the Node runtime. Archives are packed and unpacked in-process, so the
scripts run the same on macOS, Linux and Windows. The **paean-game-create** skill
ships a game-production standard plus a static/Playwright validator. The **paean-sdk** skill ships
browser reference files (no server, no build) you copy into your app. **paean-record-demo** needs
Playwright for the capture and uses `ffmpeg` when it is on PATH; **paean-convert-to-rednote** needs
`esbuild`. **paean-tts** needs Node.js 20+ and a Paean login; FFmpeg is only needed
for local speed changes or video mixing.

Every original work and remix should adapt to both portrait and landscape instead of requiring
players to rotate their device. Recompose the playfield and UI for the available screen, preserve
state when orientation changes, and verify actual play in both orientations before release.
Keep UI concise and compact so the playfield stays clear, with readable text and comfortable touch
targets on small screens and layouts that adapt across resolutions. Default to bright, approachable
casual colors and tactile surfaces unless the theme or explicit art direction calls for another style.

```
8x-skills/
├── zero/
│   ├── paean-skills-update/ SKILL.md
│   ├── paean-zero-setup/ SKILL.md
│   ├── paean-game-create/ SKILL.md + references/production-standard.md + scripts/validate-game.mjs
│   ├── paean-tts/       SKILL.md + scripts/paean_tts.mjs + references/api-and-production.md
│   ├── paean-sdk/       SKILL.md + reference/{paean-platform,mock-bridge}.js + test-example.mjs
│   ├── paean-publish/   SKILL.md + scripts/{publish,zip}.mjs
│   ├── paean-remix/     SKILL.md + scripts/{remix,zip}.mjs
│   ├── paean-convert-to-ad/      SKILL.md + scripts/{build-ad,zip}.mjs + reference/ad-*.{js,css}
│   └── paean-convert-to-rednote/ SKILL.md + scripts/{build-minitool,minitool-pipeline,audit-minitool,zip}.mjs + reference/platform-local.js
├── claude-code/
│   ├── paean-skills-update/ SKILL.md
│   ├── paean-zero-setup/ SKILL.md
│   ├── paean-game-create/ SKILL.md + references/production-standard.md + scripts/validate-game.mjs
│   ├── paean-tts/       SKILL.md + scripts/paean_tts.mjs + references/api-and-production.md
│   ├── paean-sdk/       SKILL.md + reference/{paean-platform,mock-bridge}.js + test-example.mjs
│   ├── paean-publish/   SKILL.md + scripts/{publish,zip}.mjs
│   ├── paean-remix/     SKILL.md + scripts/{remix,zip}.mjs
│   ├── paean-convert-to-ad/      SKILL.md + scripts/{build-ad,zip}.mjs + reference/ad-*.{js,css}
│   └── paean-convert-to-rednote/ SKILL.md + scripts/{build-minitool,minitool-pipeline,audit-minitool,zip}.mjs + reference/platform-local.js
└── codex/
    ├── paean-skills-update/ SKILL.md
    ├── paean-zero-setup/ SKILL.md
    ├── paean-game-create/ SKILL.md + references/production-standard.md + scripts/validate-game.mjs
    ├── paean-tts/       SKILL.md + scripts/paean_tts.mjs + references/api-and-production.md
    ├── paean-sdk/       SKILL.md + reference/{paean-platform,mock-bridge}.js + test-example.mjs
    ├── paean-publish/   SKILL.md + scripts/{publish,zip}.mjs
    ├── paean-remix/     SKILL.md + scripts/{remix,zip}.mjs
    ├── paean-convert-to-ad/      SKILL.md + scripts/{build-ad,zip}.mjs + reference/ad-*.{js,css}
    └── paean-convert-to-rednote/ SKILL.md + scripts/{build-minitool,minitool-pipeline,audit-minitool,zip}.mjs + reference/platform-local.js
```

All three source variants ship the **same** scripts and reference files; only the `SKILL.md`
packaging differs. Every variant includes `name` and `description` YAML frontmatter for skill
discovery. Gemini CLI, Antigravity, and DeepSeek Harness install the portable `claude-code/`
source; they do not need additional maintained copies of the same resources in this repository.

`claude-code/` is canonical: edit there, then run `node scripts/sync-variants.mjs` to regenerate
`codex/` and `zero/` (`--check` fails when they drift). Tests: `node --test tests/*.test.mjs`.

Square apps ship three assets at the top level: `favicon.svg`, an 800×400 `banner.jpg` and a
512×512 `icon.jpg`. Paid apps (Steam-style: watch the demo free, buy once to play) are declared
with `paean-publish --price <credits>` and gated in the app with `PaeanSDK.access.require()`;
see `paean-sdk` and its offline mock host `reference/paean-mock.js`.

## Requirements

- **Node.js 18+** (for global `fetch`); **20+ for paean-tts**.
- A **Paean JWT** (the token the Paean web app / Zero CLI uses).

The publish/remix/TTS API helpers use only the Node standard library; macOS, Linux and Windows
are supported. The optional capture, conversion, and audio-processing dependencies are listed above.
The `zip` / `unzip` commands are no longer needed — publish/remix archives are built and read
in-process by their bundled `scripts/zip.mjs`.

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

On Windows (PowerShell), `$env:PAEAN_AUTH_TOKEN = "<your-paean-jwt>"` sets it for the current
session; `~` in the credentials paths above means the user profile directory (`$env:USERPROFILE`).

The scripts also read `~/.zero/credentials.json` if present. **Never paste the token into the
chat** — keep it in the environment or the credentials file. Optional: `PAEAN_API_BASE`
overrides the API endpoint (default `https://api.paean.ai`). `ZERO_API_BASE` /
`ZERO_CLI_BASE_URL` are only honored when they point at a `*.paean.ai` host — in particular
`ZERO_CLI_BASE_URL` is often set to the LLM gateway (an Anthropic-compatible provider URL),
which is *not* a Paean API address and is ignored.

The TTS helper accepts `PAEAN_AUTH_TOKEN`, then the legacy `PAEAN_TOKEN`, then
`~/.paean/credentials.json` (`paean_token` / `token`) or `~/.zero/credentials.json` (`token`).
An explicit credentials file takes precedence. An empty or expired explicit environment token
fails instead of silently changing identity. TTS uses the fixed official API origin; the API-base
overrides above apply to publish/remix, not to the speech helper.

## Install and update local skills

Run the bundled installer from the checkout (Node.js 18+, no dependencies or network):

```bash
node scripts/install-skills.mjs --target claude-code,codex,zero,gemini,antigravity,deepseek-harness --dry-run
node scripts/install-skills.mjs --target claude-code,codex,zero,gemini,antigravity,deepseek-harness
node scripts/install-skills.mjs --target claude-code,codex,zero,gemini,antigravity,deepseek-harness --check
```

Choose only the clients you want to install. The same commands work in PowerShell. Every skill
is installed directly as `<skills-root>/paean-*/SKILL.md`, with its scripts and references beside
it. The installer updates all repository skills, including TTS and the recorder. It backs up
changed existing files under the destination's parent `.8x-skills-backups/`, preserves unrelated
skills and extra local metadata, and refuses symlinks inside a skill destination. Review a backup
before restoring custom edits; `--check` compares repository-owned files, not extra local files.
Both `--check` and `--dry-run` write nothing; `--check` exits 1 when an update is needed.
Installation neither logs in nor copies account credentials or changes model/proxy settings.

### Client directories

Paths checked against official documentation on **2026-10-05**. `~` is your user home on macOS,
Linux, or Windows. Use `--dest` for one selected target to override the default or install into
a project. Do not install a second copy in an alias root when the first is already discovered.

| Installer target | Global destination | Project destination / notes |
|---|---|---|
| `claude-code` | `~/.claude/skills/` | `.claude/skills/` |
| `codex` | `~/.agents/skills/` | `.agents/skills/`; existing clients using `$CODEX_HOME/skills/` / `~/.codex/skills/` can update in place with `--dest` |
| `zero` | `~/.zero/skills/` | `.zero/skills/` |
| `gemini` | `~/.gemini/skills/` | `.gemini/skills/`; `.agents/skills/` is also supported and takes precedence within a scope |
| `antigravity` | `~/.gemini/config/skills/` | `.agents/skills/`; desktop 2.0 and standalone IDE; IDE also supports legacy `~/.gemini/antigravity/skills/` |
| `antigravity-cli` | `~/.gemini/antigravity-cli/skills/` | `.agents/skills/`; select this separately if using the CLI |
| `deepseek-harness` | `$DSH_HOME/skills/`, otherwise `~/.dsh/skills/` | `.dsh/skills/`; also supports `.agents/skills/`, `$DSH_AGENTS_HOME/skills/` (default `~/.agents/skills/`), and configured custom roots |

Sources: [Codex local skills](https://learn.chatgpt.com/docs/build-skills#where-to-save-skills),
[Gemini CLI skills](https://geminicli.com/docs/cli/skills/),
[Antigravity skills by surface](https://antigravity.google/docs/skills/#skills-by-surface), and
[DeepSeek Harness filesystem provider](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/skill/skill-filesystem/README.md).
Harness discovers direct skill directories, not arbitrarily nested copies of the repository.
A Harness fork may choose a different home; inspect its configured home and use `--dest`.

```bash
# Update an existing Codex installation without adding a duplicate in ~/.agents/skills
node scripts/install-skills.mjs --target codex --dest "$HOME/.codex/skills"
# Install only in a Gemini project
node scripts/install-skills.mjs --target gemini --dest /path/to/project/.gemini/skills
# Explicit custom Harness home (no global environment change)
node scripts/install-skills.mjs --target deepseek-harness --dest /path/to/harness-home/skills
```

Gemini: inspect `gemini skills list` or `/skills list`, and use `/skills reload` after an update.
Antigravity IDE: inspect the Customizations menu; for desktop, start a fresh chat if needed.
Harness: the filesystem provider watches skills; verify the skill is in its catalog and can load.
Codex detects changes automatically; restart if they do not appear. Copying files verifies an
installation, not a running client's catalog or permission grants. You can also reference any
`SKILL.md` directly from a prompt or a project instruction file.

## Speech during creation

Say “use Paean TTS for this game's tutorial”, “给演示视频加中文旁白”, or `paean tts`.
Create, Remix, Record Demo, and the Red Skill edition route fixed speech assets to
[paean-tts](claude-code/paean-tts/SKILL.md). Dynamic in-app read-aloud uses
[paean-sdk's AI guide](claude-code/paean-sdk/reference/design-ai.md#speech-with-paean-tts)
and the player's host session. No upstream DashScope key is required: the local helper authenticates
with the creator's **Paean JWT**, while Paean manages upstream credentials. This is authenticated
account access, not anonymous or unlimited service. **Never ship that JWT in frontend code,
build-time environment variables, browser storage, Git, logs, or a ZIP.** Runtime apps use the
player's SDK host session and must not request or store their JWT. Follow the TTS skill's security
requirements and inspect the final artifact for credentials before sharing or publishing.

```bash
# Public availability / voices; no synthesis
node <skill-dir>/scripts/paean_tts.mjs status
# Validate an authored UTF-8 script without credentials, network, or output writes
node <skill-dir>/scripts/paean_tts.mjs synthesize --text-file narration.txt --voice Cherry --out audio/narration --dry-run
# Generate when narration is part of the requested work; may consume platform usage
node <skill-dir>/scripts/paean_tts.mjs synthesize --text-file narration.txt --voice Cherry --out audio/narration
```

Save returned audio locally and reuse it; temporary audio URLs are not permanent assets.
RedNote offline mini-tools cannot call cloud TTS or directly bundle WAV/MP3 under their current
whitelist. Their separate demo videos can use generated narration. The skill documents status,
voices, segmentation, authentication, supported fields, and bounded recovery from errors.

## Usage

Published work titles, descriptions, discovery tags, and player-facing READMEs default to
**English** unless the user explicitly requests another language. Use specific, accurate keywords
for gameplay, play style, art style, theme, setting/background, and distinctive design features;
keep technical implementation language in separate developer documentation. This applies to new
works, remixes, and release updates. See the
[release-copy standard](claude-code/paean-publish/references/release-copy.md).

Before a Square publish, save the reviewed `title`, `summary`, `category`, and complete `tags` in
the project's `clide.json`, and check the dry-run's resolved metadata against its README.

From the project you want to publish:

```bash
# Preview, then publish the reviewed clide.json metadata to Apps Square
node <skill-dir>/scripts/publish.mjs --dry-run
node <skill-dir>/scripts/publish.mjs --yes

# Preview, then deploy to Clide hosting without an Apps Square listing
node <skill-dir>/scripts/publish.mjs --dry-run --hosting-only --dir dist --handle neon-drift
node <skill-dir>/scripts/publish.mjs --yes --hosting-only --dir dist --handle neon-drift
```

Square publish results return `url` and `shareUrl` as `https://www.8x.gg/apps/{hashKey}`.
Use this canonical link when sharing the work. `playUrl` preserves the runtime address;
`shellUrl` is an optional diagnostic address. Hosting-only projects retain their actual
Clide URL because they have no Square listing. Dry-runs do not produce a published link.

Before publishing a newly created or remixed game, validate its self-contained project and browser
runtime (Playwright must be installed in the working environment):

```bash
node <paean-game-create-skill-dir>/scripts/validate-game.mjs <game-dir> \
  --screenshots <temporary-screenshot-dir>
```

To remix existing games into a new one:

```bash
# h1 is the primary: cloned server-side (full assets) into the user's workspace.
# h2/h3 are read through the 8x.gg MCP server (text sources, no workspace).
# Then build the new game and publish it — every parent is credited exactly once.
node <skill-dir>/scripts/remix.mjs --yes h1=gameplay h2=art h3=theme --dir my-remix
```

## The 8x.gg MCP server

`https://api.paean.ai/8x/mcp` is the discovery/study half of remixing: `find_app` /
`search_apps` resolve any 8x.gg or clide.app URL, title or description to an app;
`get_app` / `get_remix_lineage` / `get_app_growth` say whether it is worth remixing;
`list_app_files` / `read_app_file` let the agent read source without cloning anything.
The scripts are the delivery half (full assets, local scaffold, publish). `paean-zero-setup`
registers the server per host (`zero mcp add` / `claude mcp add` / `codex mcp add`) using
the same Paean token; inside the Paean Mac app it is registered automatically as `8xgg`.

Run any script with `--help` for full usage. See each skill's `SKILL.md` for the complete
workflow the agent should follow.

## The remix graph (`clide.json`)

`paean-remix` writes a `clide.json` manifest that records lineage in two compatible shapes at
once:

```jsonc
{
  "schemaVersion": 1,
  "title": "Neon Drift Racer",
  "summary": "Chase high scores in a fast-paced drift racer through a neon-noir cyberpunk city. Chain slides around rain-slick corners, choose branching shortcuts, and keep your combo alive beneath glowing skylines.",
  "category": "racing",
  "tags": ["drift-racing", "score-attack", "fast-paced", "neon-noir", "cyberpunk", "city-at-night", "branching-shortcuts", "drift-combos"],
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
