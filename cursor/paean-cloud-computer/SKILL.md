---
name: paean-cloud-computer
description: Give a Personal Agent a Paean cloud computer for creative work. Use to create, inspect, pause, resume, connect, back up before deletion, restore a personal cloud computer, or delegate durable cloud tasks and retrieve private results. Works from Codex, Claude Code, Paean Harness and other skill-capable agents. Does not provision Aliyun infrastructure or implicitly publish work.
---

# Paean Cloud Computer (Cursor)

A computer for the user's existing Agent: create in the cloud, let the user observe or participate through Harness, and deliver private results. This skill is infrastructure access, not a replacement personal assistant.

> **Using this skill in Cursor.** Install this directory under `~/.cursor/skills/`
> or the project's `.cursor/skills/`. Cursor also discovers `.agents/skills/` and
> compatible Claude/Codex roots; avoid duplicate installations of the same skill.
> Find it in Customize → Skills, or type `/paean-cloud-computer` in Agent chat.
> Keep scripts and references beside this file and resolve their paths from this directory.
> Run commands in the project directory when the workflow requires project files.
> Local global skills are not automatically available to Cloud Agents; use project skills
> or the user's chosen Cursor sync setup for remote work.

## Start

1. Use the user's Paean identity. Reuse `zero login` credentials, or a securely configured `PAEAN_AUTH_TOKEN`. Never ask for a credential in chat, copy browser cookies, use an administrator account, or require Aliyun keys. An expired explicit credential must not cause an identity switch. See `paean-zero-setup` if sign-in is needed.
2. Resolve this skill directory, then run `node <skill-dir>/scripts/cloud-computer.mjs --help`. Node.js 18+; no dependencies.
3. Choose the appropriate mode below. Inspect existing state before mutations. State claims must come from API results, not inferred from UI URLs or model prose.

## Choose the environment

| Need | Use | Persistence and region |
| --- | --- | --- |
| User's personal computer, manual Harness access, pause/resume, restore | `personal` commands | Region-specific: `beijing` (`cc.paean.ai`), `hongkong` (`pc.paean.ai`), `singapore` (`sg.paean.ai`). Ask only if region matters and is not already established. |
| Agent should complete a self-contained task while the user's device is closed | Cloud MCP tools or `tasks` commands | New isolated **Beijing** environment per task. Accepted tasks survive client disconnect; they do not inherit personal computer files or the local working directory. |

A `*.pc.paean.ai` Harness hostname does not identify its region. Use the selected control-plane region and returned metadata. Do not promise arbitrary shell control or continuation of an existing personal Harness session: this release exposes personal lifecycle management and separate delegated execution.

## Personal computer lifecycle

```bash
node <skill-dir>/scripts/cloud-computer.mjs personal list --region beijing
node <skill-dir>/scripts/cloud-computer.mjs personal backups --region beijing
node <skill-dir>/scripts/cloud-computer.mjs personal create --region beijing
node <skill-dir>/scripts/cloud-computer.mjs personal get --region beijing --id ws-RETURNED_ID
node <skill-dir>/scripts/cloud-computer.mjs personal connect --region beijing --id ws-RETURNED_ID
node <skill-dir>/scripts/cloud-computer.mjs personal pause --region beijing --id ws-RETURNED_ID
node <skill-dir>/scripts/cloud-computer.mjs personal resume --region beijing --id ws-RETURNED_ID
```

- Use only returned IDs. A running computer incurs compute/model costs according to service billing; explain relevant costs when allocating work, without inventing a price.
- Return the connection URL privately to the user for observation or manual participation. Its fragment is a short-lived access ticket. Never put it in public artifacts or a published site.
- Pause/resume preserves the old environment and image; it does not upgrade the image. Use backup → delete → create with a selected restore point to move to the current image when requested.
- Deletion is destructive to the instance. Only do it when authorized by the user; `--confirm` records that authorization, it is not a reason to ask again when already given. The server backs up first. Poll `personal get`/`list`: `backing_up` is not deleted; `backup_failed` means the instance must remain. Do not retry via provider tools or bypass backup.

```bash
node <skill-dir>/scripts/cloud-computer.mjs personal delete --region beijing --id ws-RETURNED_ID --confirm
# After deletion and a verified restore point:
node <skill-dir>/scripts/cloud-computer.mjs personal create --region beijing --backup RETURNED_BACKUP_ID
```

Let the user select the restore point when there are multiple plausible dates. Verify restoration through status and, when requested, Harness; never claim file recovery based only on a successful create response.

## Delegate creative work

Prefer the already connected cloud MCP when available: `cloudTaskSubmit`, `cloudTasksList`, `cloudTaskGet`, `cloudTaskCancel`, `cloudTaskArtifacts`. Otherwise use the portable CLI:

```bash
node <skill-dir>/scripts/cloud-computer.mjs tasks list
node <skill-dir>/scripts/cloud-computer.mjs tasks submit --prompt-file brief.md --request-key a-stable-key-for-this-task
node <skill-dir>/scripts/cloud-computer.mjs tasks get --id cr-RETURNED_ID
node <skill-dir>/scripts/cloud-computer.mjs tasks artifacts --id cr-RETURNED_ID
```

Before submission, write a self-contained brief with objective, inputs the remote Agent can actually access, output paths and verification criteria. Local files are not transferred automatically. Include only necessary data and never embed credentials in the brief. User requests to create locally do not automatically mean paid remote delegation; use the user's intended scope.

Generate one stable `request_key` per logical task and retain it with the returned run ID. If submission times out, retry with **the same key and body**. Do not switch from MCP to REST to recover an uncertain submission: their origin namespaces differ. Query tasks first. A new key can create duplicate work and charges.

Poll at reasonable intervals, respecting the client's waiting capabilities. Report actual states (`queued`, `running`, `delivering`, `succeeded`, `failed`, etc.). `delivering` is still saving outputs. Retrieve artifacts only when `artifacts_ready` is true. Results include project files, session logs, archive size and SHA-256. Download links expire after 10 minutes; request a fresh one, never make the bucket public.

Cancel a task with `cloudTaskCancel` or `tasks cancel --id …` when the user asks to stop it. Stopping a foreground reply does not cancel accepted cloud tasks. Cancellation does not delete a personal computer.

Publishing is separate authorization. A request to create or test does not authorize public hosting, Apps Square listing, sharing session records or distributing private download URLs.

## Connect another Agent

Read [connection guide](references/connect.md) for portable installation and remote MCP configuration. Do not claim a particular client's MCP integration is verified without checking it. No client configuration changes are needed for the bundled CLI.
