# 8x.gg MCP in Gemini CLI and Cursor

Use this reference when the user wants 8x.gg discovery in one of these clients. Skill
installation and MCP registration are separate: the installer copies skills only. Zero
login supplies Paean credentials; it does not require changing the Gemini/Cursor model.

## Gemini CLI

Merge the `mcpServers.8xgg` entry from [gemini-mcp.json](gemini-mcp.json) into
`~/.gemini/settings.json` (user) or the requested project's `.gemini/settings.json`.
Preserve existing settings and other servers. `httpUrl` selects Streamable HTTP;
Gemini expands `${PAEAN_AUTH_TOKEN}` in the header when loading settings.

Start Gemini in an environment with `PAEAN_AUTH_TOKEN` available, then check
`gemini mcp list` or `/mcp`. For skills, use `gemini skills list` or `/skills list`,
and `/skills reload` after updating files. Ask Gemini to use `paean-remix` to discover
a work. Normal skill activation and tool approval remain controlled by the client.

## Cursor

Merge the `mcpServers.8xgg` entry from [cursor-mcp.json](cursor-mcp.json) into
`~/.cursor/mcp.json` (user) or the requested project's `.cursor/mcp.json`.
Preserve other servers. Cursor uses `url` for the remote server and expands
`${env:PAEAN_AUTH_TOKEN}` in headers; the Gemini placeholder is not interchangeable.

Ensure the **Cursor process** has the environment variable. A desktop app already running
may not inherit a new terminal export; restart it from the prepared environment if needed.
Check `8xgg` in Cursor's MCP tools settings, then inspect its available discovery tools.
Find installed skills in Customize → Skills or invoke `/paean-remix` in Agent chat.

## Credentials and verification

Use the creator's existing Paean login/token. These clients do not automatically read
`~/.zero/credentials.json` for a remote MCP Authorization header, even though the bundled
publish/remix scripts do. Load a stored token into the launching process without printing
it; keep the template's environment reference in config. Do not replace it with a literal
token in Git, paste tokens into chat, enable blanket tool trust, or overwrite a whole
settings file just to add this server.

For a cloud/remote client, configure credentials in that client's own secret environment
only when requested. Copying local skills does not transfer the token or establish a remote
MCP connection. Report separately whether files were installed and whether `8xgg` connected.

Verify with a read-only `find_app`/`search_apps` request when needed. Do not publish, tip,
boost, or clone a paid work just to test connectivity. If authentication fails, refresh
Paean login and the client environment; do not switch models or network/proxy settings.
Without MCP discovery, the remix script can still use known Square hashKeys.

Checked against official documentation on 2026-10-15:
[Gemini MCP](https://geminicli.com/docs/tools/mcp-server/),
[Gemini settings and variable expansion](https://geminicli.com/docs/reference/configuration/),
[Cursor MCP configuration](https://cursor.com/docs/mcp).
