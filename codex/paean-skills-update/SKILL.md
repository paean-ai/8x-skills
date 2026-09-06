---
name: paean-skills-update
description: Update the local 8x-skills repository and reinstall Paean skills for Claude Code, Codex, or Zero CLI. Use when the user asks to update skills, refresh Paean skills, pull the latest skill instructions, or sync paean game-create / SDK / publish / remix / setup skill changes.
---

# Paean Skills Update (Codex)

Update the local `8x-skills` checkout and reinstall the Paean skills into the target agent.

> **Using this skill in Codex.** Reference this file explicitly — add a pointer in your
> project `AGENTS.md` ("To update Paean skills, follow
> `8x-skills/codex/paean-skills-update/SKILL.md`.") or name the skill in your prompt.

## Locate the skills repo

Prefer the current repo if it contains `claude-code/`, `codex/`, and `zero/`. Otherwise look
for the user's checkout (ask where it lives, or check common spots such as
`~/Zero/opensource/8x-skills` or `~/a8e/paean-opensource/8x-skills`). If there is no
checkout, clone it:

```bash
git clone https://github.com/paean-ai/8x-skills
cd 8x-skills
```

Check status before pulling. Do not discard local changes.

```bash
git status --short
git remote -v
```

If there are local changes, report them first. Pull only when the user wants the remote update
and the changes do not create an obvious conflict.

```bash
git pull --ff-only
```

If `--ff-only` fails, stop and report the conflict/divergence; do not reset or overwrite.

## Reinstall for Claude Code

Copy each Claude Code skill directory into the global skills folder:

```bash
mkdir -p ~/.claude/skills
cp -R claude-code/paean-publish ~/.claude/skills/
cp -R claude-code/paean-remix ~/.claude/skills/
cp -R claude-code/paean-zero-setup ~/.claude/skills/
cp -R claude-code/paean-game-create ~/.claude/skills/
cp -R claude-code/paean-sdk ~/.claude/skills/
cp -R claude-code/paean-skills-update ~/.claude/skills/
```

If a project uses `.claude/skills/`, copy there instead or in addition.

## Refresh Codex pointers

Codex can use this repo in place. Ensure the project `AGENTS.md` points at the current files:

```markdown
## Skills
- To update Paean skills, follow `8x-skills/codex/paean-skills-update/SKILL.md`.
- To install Zero CLI or log in to Paean for publishing, follow `8x-skills/codex/paean-zero-setup/SKILL.md`.
- To create or substantially polish a Paean game, follow `8x-skills/codex/paean-game-create/SKILL.md`.
- To add cloud save or a leaderboard, follow `8x-skills/codex/paean-sdk/SKILL.md`.
- To publish to Paean Apps Square, follow `8x-skills/codex/paean-publish/SKILL.md`.
- To remix Paean Apps Square games, follow `8x-skills/codex/paean-remix/SKILL.md`.
```

If the project keeps a vendored copy of `8x-skills/`, update that copy from this checkout with
the user's approval.

## Reinstall for Zero CLI

Zero CLI discovers skills from a `skills/` directory (project `.zero/skills/` or the global
config dir). Copy each Zero skill directory in:

```bash
mkdir -p ~/.zero/skills
cp -R zero/paean-publish ~/.zero/skills/
cp -R zero/paean-remix ~/.zero/skills/
cp -R zero/paean-zero-setup ~/.zero/skills/
cp -R zero/paean-game-create ~/.zero/skills/
cp -R zero/paean-sdk ~/.zero/skills/
cp -R zero/paean-skills-update ~/.zero/skills/
```

If a project uses `.zero/skills/`, copy there instead or in addition.

## Mirrors

`claude-code/` is the canonical tree. After pulling, `node scripts/sync-variants.mjs --check`
confirms `codex/` and `zero/` match it; drift means the checkout is mid-edit — run
`node scripts/sync-variants.mjs` only when you are editing the skills yourself, never on a
plain update.

## Verify

```bash
find claude-code codex zero -maxdepth 2 -name SKILL.md | sort
node --check codex/paean-publish/scripts/publish.mjs
node --check codex/paean-remix/scripts/remix.mjs
node --check codex/paean-game-create/scripts/validate-game.mjs
node --check zero/paean-publish/scripts/publish.mjs
node --check zero/paean-remix/scripts/remix.mjs
node --check zero/paean-game-create/scripts/validate-game.mjs
```

Report the current commit hash and any files that remain modified.
