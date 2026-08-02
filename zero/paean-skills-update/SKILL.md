---
name: paean-skills-update
description: Update the local 8x-skills repository and reinstall the Paean skills for Zero CLI. Use when the user asks to update skills, refresh Paean skills, pull the latest skill instructions, or sync paean-publish / paean-remix / paean-zero-setup / paean-sdk skill changes.
---

# Paean Skills Update (Zero CLI)

Update the local `8x-skills` checkout and reinstall the Paean skills into Zero CLI's skill
directory (`~/.zero/skills/` for all projects, or a project's `.zero/skills/`).

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

## Reinstall for Zero CLI

Copy each Zero skill directory into the global skill folder. Zero auto-discovers skills
from `~/.zero/skills/`:

```bash
mkdir -p ~/.zero/skills
cp -R zero/paean-publish ~/.zero/skills/
cp -R zero/paean-remix ~/.zero/skills/
cp -R zero/paean-zero-setup ~/.zero/skills/
cp -R zero/paean-sdk ~/.zero/skills/
cp -R zero/paean-skills-update ~/.zero/skills/
```

If a project should get its own copy, use `.zero/skills/` there instead or in addition.

## Verify

```bash
find claude-code codex zero -maxdepth 2 -name SKILL.md | sort
node --check zero/paean-publish/scripts/publish.mjs
node --check zero/paean-remix/scripts/remix.mjs
```

Report the current commit hash and any files that remain modified.
