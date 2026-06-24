# 8x Skills

Portable agent skills for **publishing** and **remixing** games on
[Paean Apps Square](https://clide.app) (`*.clide.app` / `8x.gg`) — usable outside Zero CLI,
from **Claude Code** and **Codex** (or any agent that can read a `SKILL.md` and run a Node script).

| Skill | What it does |
|-------|--------------|
| **paean-publish** | Publish a static frontend (top-level `index.html`) to a Paean workspace, deploy it to a `*.clide.app` URL, and list it in Paean Apps Square. Picks a meaningful title, ensures `.clideignore` / `clide.json` / `LICENSE` are complete, scans for secrets, and forwards remix lineage. |
| **paean-remix** | Download the source of one or more published games by hash and scaffold a new game that remixes them, recording a multi-parent remix graph (e.g. *h1 gameplay + h2 art + h3 theme*) so upstream creators can be credited. |

Both ship as self-contained Node scripts — no npm install, no external dependencies beyond
the Node runtime and a system `zip`/`unzip`.

```
8x-skills/
├── claude-code/
│   ├── paean-publish/   SKILL.md + scripts/publish.mjs
│   └── paean-remix/     SKILL.md + scripts/remix.mjs
└── codex/
    ├── paean-publish/   SKILL.md + scripts/publish.mjs
    └── paean-remix/     SKILL.md + scripts/remix.mjs
```

The Claude Code and Codex variants run the **same** scripts; only the `SKILL.md` packaging
differs (Claude Code uses YAML frontmatter for auto-loading; Codex references the file
explicitly).

## Requirements

- **Node.js 18+** (for global `fetch`).
- `zip` on PATH for publishing; `unzip` on PATH for remixing (both ship with macOS and most
  Linux distributions).
- A **Paean JWT** (the token the Paean web app / Zero CLI uses).

## Credentials

Set your Paean JWT via the environment (recommended), or a credentials file:

```bash
export PAEAN_AUTH_TOKEN="<your-paean-jwt>"
# or: ~/.paean/credentials.json  →  {"token":"<your-paean-jwt>"}
```

The scripts also read `~/.zero/credentials.json` if present. **Never paste the token into the
chat** — keep it in the environment or the credentials file. Optional: `PAEAN_API_BASE`
overrides the API endpoint (default `https://api.paean.ai`).

## Install

### Claude Code

Copy a skill directory into your skills folder (project `.claude/skills/` or global
`~/.claude/skills/`):

```bash
cp -r 8x-skills/claude-code/paean-publish ~/.claude/skills/
cp -r 8x-skills/claude-code/paean-remix   ~/.claude/skills/
```

Claude Code auto-discovers the `SKILL.md` and offers the skill when relevant. You can also
invoke it explicitly ("use the paean-publish skill").

### Codex

Codex has no frontmatter skill loader, so reference the skill explicitly. Either keep this
repo in your project and add a pointer to your `AGENTS.md`:

```markdown
## Skills
- To publish to Paean Apps Square, follow `8x-skills/codex/paean-publish/SKILL.md`.
- To remix Paean Apps Square games, follow `8x-skills/codex/paean-remix/SKILL.md`.
```

…or point Codex at the file directly in your prompt.

## Usage

From the project you want to publish:

```bash
# Preview, then publish under a good name
node <skill-dir>/scripts/publish.mjs --dry-run
node <skill-dir>/scripts/publish.mjs --yes --title "Neon Drift Racer" --category racing
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

`remix.parent` keeps tree-only consumers (and the current single-parent backend field
`remixOfHashKey`) working, while `remix.parents[]` is the adjacency list of the multi-parent
remix DAG — each direct upstream with the aspect it contributed and a suggested revenue
`weight`. `paean-publish` forwards both, so the data is ready for upstream revenue-sharing.

## Safety

- Publishing is **public**. The scripts require explicit confirmation (or `--yes`) and warn
  before listing.
- Credentials are read from the environment / a credentials file only — never hard-coded, and
  never written into the published output.
- A high-confidence secret scanner blocks publishing files that look like private keys or API
  tokens.
- Raw downloaded upstream sources (`.remix-sources/`) and the `clide.json` manifest are
  excluded from the published site by default.

## License

MIT — see [LICENSE](./LICENSE).
