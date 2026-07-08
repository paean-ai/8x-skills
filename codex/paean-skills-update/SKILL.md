---
name: paean-skills-update
description: Update the local 8x-skills repository and reinstall Paean skills for Claude Code or Codex. Use when the user asks to update skills, refresh Paean skills, pull the latest skill instructions, or sync paean-publish / paean-remix / paean-zero-setup skill changes.
---

# Paean Skills Update (Codex)

Update the local `8x-skills` checkout and refresh Paean skill instructions. Use this when the
user asks to update skills, refresh Paean skills, pull the latest skill instructions, or sync
`paean-publish` / `paean-remix` / `paean-zero-setup` changes.

> **Using this skill in Codex.** Reference this file explicitly — add a pointer in your
> project `AGENTS.md` ("To update Paean skills, follow
> `8x-skills/codex/paean-skills-update/SKILL.md`.") or name the skill in your prompt.

## Locate the skills repo

Prefer the current repo if it contains `claude-code/` and `codex/`. Otherwise use the user's
known checkout if present:

```bash
cd /Users/ryan/a8e/paean-opensource/8x-skills
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
cp -R claude-code/paean-skills-update ~/.claude/skills/
```

If a project uses `.claude/skills/`, copy there instead or in addition.

## Refresh Codex pointers

Codex can use this repo in place. Ensure the project `AGENTS.md` points at the current files:

```markdown
## Skills
- To update Paean skills, follow `8x-skills/codex/paean-skills-update/SKILL.md`.
- To install Zero CLI or log in to Paean for publishing, follow `8x-skills/codex/paean-zero-setup/SKILL.md`.
- To publish to Paean Apps Square, follow `8x-skills/codex/paean-publish/SKILL.md`.
- To remix Paean Apps Square games, follow `8x-skills/codex/paean-remix/SKILL.md`.
```

If the project keeps a vendored copy of `8x-skills/`, update that copy from this checkout with
the user's approval.

## Verify

```bash
find claude-code codex -maxdepth 2 -name SKILL.md | sort
node --check codex/paean-publish/scripts/publish.mjs
node --check codex/paean-remix/scripts/remix.mjs
```

Report the current commit hash and any files that remain modified.
