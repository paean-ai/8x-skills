---
name: paean-skills-update
description: Update the local 8x-skills repository and install or refresh Paean skills for Claude Code, Codex, Zero CLI, Gemini CLI, Antigravity, or DeepSeek Harness. Use for skill updates, missing/stale local installations, or configuring supported client skill directories.
---

# Paean Skills Update (Codex)

Update the local `8x-skills` checkout and reinstall the Paean skills into the target agent.

> **Using this skill in Codex.** Install this directory under `~/.agents/skills/`
> or the project's `.agents/skills/` for discovery. Existing clients that already load
> `$CODEX_HOME/skills/` (default `~/.codex/skills/`) can update that directory in place.
> You can also reference `8x-skills/codex/paean-skills-update/SKILL.md` directly.
> Keep the bundled scripts and references beside this file; avoid duplicate installations.

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

## Install into the client's actual discovery directory

A repository update does not update an installed copy. Inspect the existing skill directories and
update the user's selected clients. Preserve other skills and local metadata; do not claim a
running client has loaded new instructions merely because a copy succeeded.

Run the repository's `scripts/install-skills.mjs` from the checkout. It discovers all ten Paean
skills, copies their resources, and backs up changed existing files outside the discovery root.
It preserves extra local files and refuses symlinks inside skill destinations; inspect a refused
link and its owner before deciding how to update that installation.

```bash
node scripts/install-skills.mjs --target claude-code,zero,gemini,antigravity,deepseek-harness --dry-run
node scripts/install-skills.mjs --target claude-code,zero,gemini,antigravity,deepseek-harness
node scripts/install-skills.mjs --target claude-code,zero,gemini,antigravity,deepseek-harness --check
```

Choose only requested clients; these commands also work in PowerShell. `--dry-run` and `--check`
write nothing. `--check` exits 1 for differing/missing repository files; additional local files
are preserved and are not part of that comparison. Backups live in `.8x-skills-backups/` beside
the destination skills directory. Do not copy credentials or change the model, proxy, or VPN.

| Target | Global default | Project root / compatibility |
|---|---|---|
| `claude-code` | `~/.claude/skills/` | `.claude/skills/` |
| `codex` | `~/.agents/skills/` | `.agents/skills/`; update an existing `$CODEX_HOME/skills/` or `~/.codex/skills/` installation with `--dest` when the client already discovers it |
| `zero` | `~/.zero/skills/` | `.zero/skills/` |
| `gemini` | `~/.gemini/skills/` | `.gemini/skills/`; `.agents/skills/` is also discovered and takes precedence within a scope |
| `antigravity` | `~/.gemini/config/skills/` | `.agents/skills/`; desktop 2.0 / IDE; legacy IDE path is `~/.gemini/antigravity/skills/` |
| `antigravity-cli` | `~/.gemini/antigravity-cli/skills/` | `.agents/skills/`; separate from the desktop/IDE default |
| `deepseek-harness` | `$DSH_HOME/skills/`, otherwise `~/.dsh/skills/` | `.dsh/skills/`, `.agents/skills/`, shared `$DSH_AGENTS_HOME/skills/` (default `~/.agents/skills/`), or configured custom roots |

Use `--dest` with one target for a project or a verified custom home:

```bash
node scripts/install-skills.mjs --target codex --dest "$HOME/.codex/skills"
node scripts/install-skills.mjs --target deepseek-harness --dest /path/to/harness-home/skills
```

Do not guess `.deepseek/skills/`, confuse Antigravity with Gemini CLI, or add a duplicate in a
shared root. A Harness fork can override the official home; inspect that client's configuration.
Each root must directly contain `paean-name/SKILL.md`, not an extra `8x-skills/` or `claude-code/`
layer. Gemini, Antigravity, and Harness use the portable canonical source without new repo mirrors.

Directory references checked 2026-10-05:
[Codex](https://learn.chatgpt.com/docs/build-skills#where-to-save-skills),
[Gemini CLI](https://geminicli.com/docs/cli/skills/),
[Antigravity](https://antigravity.google/docs/skills/#skills-by-surface),
[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/skill/skill-filesystem/README.md).

## Mirrors and verification

`claude-code/` is canonical. After pulling, `node scripts/sync-variants.mjs --check` confirms
`codex/` and `zero/` match it. Regenerate mirrors only while editing the skills, not during a plain
installation. The installer does not pull, regenerate mirrors, install dependencies, or log in.

After installation, run `--check` with the same target and destination. Verify the relevant
client catalog where available: Gemini `gemini skills list` / `/skills list` and `/skills reload`;
Antigravity IDE Customizations; Harness skill catalog; Codex's skill selector (restart if changes
have not appeared). Do not start a paid model or synthesis request merely to verify installation.

Report the repository commit, modified files, actual destination paths, backup locations, and
whether verification covered only files or also live client discovery.
