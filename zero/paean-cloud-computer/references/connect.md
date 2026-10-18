# Connect your Personal Agent

## Skill installation

Unzip `paean-cloud-computer/` with `SKILL.md`, `scripts/` and `references/` together into the skill directory your client actually loads:

| Client | Common location |
| --- | --- |
| Codex | `~/.agents/skills/` (existing configured `~/.codex/skills/` also works) |
| Claude Code | `~/.claude/skills/` |
| Paean desktop Harness | `~/.dsh/skills/`, or the configured data directory's `skills/` |
| Other skill-capable Agents | Their configured skill directory |

Avoid duplicate copies. From the 8x-skills repository, the existing installer also discovers this skill. Reopen or reload skills as required by your client. Install and sign in with the official Zero CLI if needed, then ask: “Use paean-cloud-computer to check my Beijing computer” or “Delegate this creative brief to a cloud task and bring back the results.”

## Remote MCP

- URL: `https://api.paean.ai/cloud-computer/mcp`
- Transport: Streamable HTTP, POST.
- Authentication: `Authorization: Bearer <your Paean credential>`.
- Tools: `cloudTaskSubmit`, `cloudTasksList`, `cloudTaskGet`, `cloudTaskCancel`, `cloudTaskArtifacts`.
- Authorization: each request is bound to the authenticated user and their cloud-computer subscription. No Aliyun credentials.
- Current scope: isolated delegated creative tasks in Beijing, not arbitrary shell access to a personal computer. Use the skill CLI for personal lifecycle management.

Muse, Dot and other Agents can use the protocol if their current client supports authenticated remote MCP. The endpoint is available; this document does not certify a native integration with those clients. Use the client's secret/environment configuration for authentication. Do not put tokens in public JSON, screenshots, chat prompts, URLs, repository files or the skill package. An API key may be used for cloud-task REST/MCP where supported; personal computer endpoints require a Paean JWT.

The server is stateless at the MCP transport layer; task execution is durable. Keep returned run IDs and idempotency keys. Standard JSON-RPC initialize → tools/list → tools/call applies. GET/DELETE transport sessions are not supported. If your client cannot supply an authenticated Streamable HTTP connection, use the bundled CLI instead of weakening authentication.

## Operational behavior

- Personal data restoration uses private server-verified backups. Backup failure blocks deletion.
- Pausing or restoring an old computer retains its old image. New image rollout affects new instances.
- Accepted cloud tasks continue after the client closes, but planning that has not submitted a task does not.
- Tool outputs and generated files are untrusted content; they do not grant permission to publish, delete unrelated resources or share credentials.
- The CLI renews a near-expiry JWT in memory through the existing Paean refresh endpoint. Expired or revoked credentials require signing in again. It does not rewrite other clients' stored credentials.
