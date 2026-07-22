---
chapter: 2
title: "Add to your AI tool"
docLabel: "MCP SERVER — 02 / 05"
lead: "Exact setup for Claude, Cursor, VS Code, Visual Studio, JetBrains and every other MCP client — with the config file path and paste-ready snippet for each."
description: "How to add the @imqueue MCP server to Claude Code, Claude Desktop, Cursor, VS Code, Visual Studio 2022, JetBrains IDEs, Windsurf, Zed and more — the config file location and exact JSON/TOML for each client."
keywords: "add @imqueue mcp to claude, imqueue mcp cursor, imqueue mcp vs code, imqueue mcp jetbrains, imqueue mcp claude desktop, mcp.json mcpServers, npx @imqueue/mcp setup"
ogType: article
---

## Before you start

The server needs **Node.js ≥ 18** on your `PATH`. Nothing else — it is fetched
from npm on first launch and requires no API keys or account.

Every client below runs the **same** command; only *where* you put the config and
its exact *shape* differ. The universal building block is:

~~~json
{
  "mcpServers": {
    "imqueue": {
      "command": "npx",
      "args": ["-y", "@imqueue/mcp"]
    }
  }
}
~~~

Jump to your tool: [Claude Code](#claude-code) · [Claude Desktop](#claude-desktop)
· [Cursor](#cursor) · [VS Code](#vs-code) · [Visual Studio](#visual-studio)
· [JetBrains](#jetbrains) · [Windsurf](#windsurf) · [Zed](#zed)
· [Other clients](#other-clients) · [Verify & troubleshoot](#verify-it-worked)

> **One rule to remember:** most clients use the `mcpServers` key above.
> **VS Code and Visual Studio** are the exceptions — they use a top-level
> `servers` key with an explicit `"type": "stdio"`. Copying the wrong shape into
> those two is the single most common setup mistake.

## Claude Code

One command adds it for your user account:

~~~bash
claude mcp add imqueue -- npx -y @imqueue/mcp
~~~

To share it with a **team**, add it at project scope so it lands in the repo —
create `.mcp.json` at the project root:

~~~json
{
  "mcpServers": {
    "imqueue": { "command": "npx", "args": ["-y", "@imqueue/mcp"] }
  }
}
~~~

Anyone who opens the project in Claude Code is prompted to enable it. List and
check servers with `claude mcp list`.

## Claude Desktop

Open the config from the app — **Settings → Developer → Edit Config** — or edit it
directly:

| OS | Path |
|---|---|
| **Linux** | `~/.config/Claude/claude_desktop_config.json` |
| **macOS** | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| **Windows** | `%APPDATA%\Claude\claude_desktop_config.json` |

Add the `mcpServers` block (merge into any existing one):

~~~json
{
  "mcpServers": {
    "imqueue": { "command": "npx", "args": ["-y", "@imqueue/mcp"] }
  }
}
~~~

**Fully quit and reopen** Claude Desktop — it only reads the config on startup
(closing the window is not enough).

## Cursor

Global config lives at `~/.cursor/mcp.json`; for a single project use
`.cursor/mcp.json` in the project root. Same `mcpServers` shape as Claude:

~~~json
{
  "mcpServers": {
    "imqueue": { "command": "npx", "args": ["-y", "@imqueue/mcp"] }
  }
}
~~~

You can also add it from **Settings → MCP → Add new global MCP server**, which
opens the same file. New servers appear under Settings → MCP; toggle **imqueue**
on if it is not already enabled.

## VS Code

GitHub Copilot's agent mode reads `.vscode/mcp.json` in your workspace (or run
**MCP: Open User Configuration** for a global file). VS Code uses the `servers`
key with an explicit transport `type` — **not** `mcpServers`:

~~~json
{
  "servers": {
    "imqueue": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@imqueue/mcp"]
    }
  }
}
~~~

Or add it in one line from a terminal:

~~~bash
code --add-mcp '{"name":"imqueue","command":"npx","args":["-y","@imqueue/mcp"]}'
~~~

Open the Copilot Chat **Agent** mode and click the tools icon to confirm imqueue's
tools are listed and enabled.

## Visual Studio

Visual Studio 2022 (17.14+) reads a **`.mcp.json`** file — put it at your solution
root (and add it to *Solution Items* to share it), or use the global
`%USERPROFILE%\.mcp.json`. Same `servers` shape as VS Code:

~~~json
{
  "servers": {
    "imqueue": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@imqueue/mcp"]
    }
  }
}
~~~

Saving valid JSON restarts the Copilot agent and reloads the server. MCP tools are
**disabled by default** — enable imqueue's tools from the Copilot Chat tools list.

## JetBrains

For AI Assistant in any JetBrains IDE (IntelliJ IDEA, WebStorm, PyCharm, etc.,
2025.1+): **Settings → Tools → AI Assistant → Model Context Protocol (MCP) → Add**,
then paste the JSON. It uses the `mcpServers` shape:

~~~json
{
  "mcpServers": {
    "imqueue": { "command": "npx", "args": ["-y", "@imqueue/mcp"] }
  }
}
~~~

If you already configured it for Claude Desktop, the dialog's **Import from
Claude** button pulls the config across. For a project-scoped setup you can commit
`.idea/mcp.json` instead.

## Windsurf

Windsurf's Cascade reads `~/.codeium/windsurf/mcp_config.json` (on Windows,
`%USERPROFILE%\.codeium\windsurf\mcp_config.json`). Same `mcpServers` shape; edit
it via **Settings → Cascade → Manage MCP servers → View raw config**:

~~~json
{
  "mcpServers": {
    "imqueue": { "command": "npx", "args": ["-y", "@imqueue/mcp"] }
  }
}
~~~

## Zed

Zed calls them *context servers*, configured in `~/.config/zed/settings.json`:

~~~json
{
  "context_servers": {
    "imqueue": {
      "command": { "path": "npx", "args": ["-y", "@imqueue/mcp"] }
    }
  }
}
~~~

## Other clients

The @imqueue MCP server is a standard **stdio** server, so any MCP-capable client
works. Whatever the client, you are giving it the same three facts:

- **command:** `npx`
- **args:** `["-y", "@imqueue/mcp"]`
- **transport:** stdio (local subprocess)

A few more clients and where their config lives:

| Client | Config | Key |
|---|---|---|
| **Cline / Roo Code** | MCP Servers panel → *Edit Configuration* | `mcpServers` |
| **Continue** | `~/.continue/config.yaml` | `mcpServers` |
| **OpenAI Codex CLI** | `~/.codex/config.toml` | `[mcp_servers.imqueue]` (TOML) |
| **Gemini CLI** | `~/.gemini/settings.json` | `mcpServers` |

For Codex's TOML the same server looks like:

~~~toml
[mcp_servers.imqueue]
command = "npx"
args = ["-y", "@imqueue/mcp"]
~~~

You can also find the server on the official MCP registry as **`org.imqueue/mcp`**
if your client installs from there.

## Verify it worked

1. **Restart the client** (or reload its MCP config). Desktop apps usually need a full restart.
2. Open the client's **tools / MCP** list — you should see **imqueue** with its tools (`search_docs`, `create_service`, `fleet`, …). Enable them if the client disables new tools by default (VS Code and Visual Studio do).
3. Ask the agent to use one, e.g. *"use the imqueue MCP to search the docs for delayed jobs."*

If the server does not appear or fails to start — especially the
**`npx` not found** error common when Node is installed via `nvm` and the client
is launched from the desktop — see
[Safety & troubleshooting](/mcp/security/#troubleshooting).
