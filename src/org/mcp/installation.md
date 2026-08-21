---
chapter: 2
title: "Add the MCP server to Claude, ChatGPT, Cursor & VS Code"
docLabel: "MCP SERVER — 02 / 05"
lead: "Exact setup for Claude, ChatGPT, Codex, Cursor, VS Code, Visual Studio, JetBrains and every other MCP client — one click from OpenAI's plugin directory, or the config file path and paste-ready snippet for each."
description: "Add the @imqueue MCP server to Claude Code, Claude Desktop, ChatGPT, Codex, Cursor, VS Code, JetBrains, Windsurf or Zed — install from OpenAI's plugin directory, or the config file location and exact JSON for each."
keywords: "add @imqueue mcp to claude, imqueue chatgpt plugin, imqueue codex plugin, openai plugin directory imqueue, imqueue mcp cursor, imqueue mcp vs code, imqueue mcp jetbrains, imqueue mcp claude desktop, mcp.json mcpServers, npx @imqueue/mcp setup"
ogType: article
---

**Adding the `@imqueue` MCP server to any client means registering one command —
`npx -y @imqueue/mcp` — under that client's `mcpServers` config key.** Only the
config file's location and exact shape differ between Claude Code, Claude
Desktop, Cursor, VS Code, Visual Studio, JetBrains, Windsurf and Zed; this page
gives the path and a paste-ready snippet for each.

**ChatGPT and Codex users can skip all of that**: @imqueue is listed in OpenAI's
plugin directory, so installing it there is one click and no config file at all.
That route installs the hosted endpoint and its six read-only tools; Codex can
*also* run the local server for the full thirteen, including the `imq` CLI bridge.
[Both options, side by side](#chatgpt-codex).

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

Jump to your tool: [ChatGPT & Codex](#chatgpt-codex)
· [Claude Code](#claude-code) · [Claude Desktop](#claude-desktop)
· [Cursor](#cursor) · [VS Code](#vs-code) · [Visual Studio](#visual-studio)
· [JetBrains](#jetbrains) · [Windsurf](#windsurf) · [Zed](#zed)
· [Other clients](#other-clients) · [Verify & troubleshoot](#verify-it-worked)

> **One rule to remember:** most clients use the `mcpServers` key above.
> **VS Code and Visual Studio** are the exceptions — they use a top-level
> `servers` key with an explicit `"type": "stdio"`. Copying the wrong shape into
> those two is the single most common setup mistake.

## Two ways to connect: local or hosted

- **Local (`npx`, recommended for building)** — the server runs on your machine
  over stdio and exposes **every** tool, including the CLI-bridge that creates
  services, generates live-introspected clients and manages your fleet. All the
  per-client sections below cover this.
- **Hosted (zero-install, for exploring)** — point an HTTP-capable client at
  **`https://mcp.imqueue.org/mcp`**. No Node, no npm, no account; it serves six
  read-only tools — the documentation and scaffolding ones plus
  `local_install_guide`. The CLI-bridge tools are **not offered there**, because a
  hosted server cannot reach your machine.

### Connect to the hosted endpoint

Clients that support remote (HTTP) MCP servers take a **`url`** instead of a
`command`:

~~~json
{
  "mcpServers": {
    "imqueue": { "url": "https://mcp.imqueue.org/mcp" }
  }
}
~~~

- **Claude Code:** `claude mcp add --transport http imqueue https://mcp.imqueue.org/mcp`
- **VS Code / Visual Studio:** use the `servers` shape with `"type": "http"`:
  ~~~json
  { "servers": { "imqueue": { "type": "http", "url": "https://mcp.imqueue.org/mcp" } } }
  ~~~
- **Cursor, Windsurf, JetBrains and others:** the `url` form above (in place of `command`/`args`).

## ChatGPT & Codex: install from OpenAI's plugin directory {#chatgpt-codex}

@imqueue is published in **OpenAI's plugin directory** — the one directory shared
by ChatGPT and Codex (it replaced the App directory in July 2026). Installing from
there writes no config file and needs no Node: the listing already points at the
hosted endpoint above, so it works the moment you install it.

**→ [Open the @imqueue listing in the plugin directory](https://chatgpt.com/plugins/plugin_asdk_app_6a6f945292888191a7d77db4893f8520)**

**ChatGPT (web or desktop app).** Open the **Plugins** tab from the sidebar — or go
straight to [`chatgpt.com/plugins`](https://chatgpt.com/plugins) — search for
**@imqueue**, open the listing, and press the **+** button to install it.

**Codex CLI.** Run the slash command:

~~~
/plugins
~~~

That opens the same directory inside the CLI, where you can switch sources, open
**@imqueue** to inspect what it exposes, and install it.

**Codex IDE extension.** Plugins are not supported in the IDE extension — install
from the ChatGPT desktop app or the Codex CLI instead, or register the server
yourself in `~/.codex/config.toml` (see [Codex: the local server](#codex-local)).

### What the plugin gives you — and what it does not

The listing installs the **hosted** endpoint, so you get its **six read-only
tools**: `search_docs`, `get_doc`, `list_packages`, `scaffold_service`,
`scaffold_client` and `local_install_guide`.

The **CLI-bridge** tools are deliberately absent, exactly as they are for anyone
else on `mcp.imqueue.org`: a hosted server cannot reach your filesystem or your
`imq` config, so it does not advertise tools that would claim otherwise. Nothing
in the plugin can create a service on disk, generate a client from a running
service, or touch your fleet.

That is the whole trade-off, and it is worth stating plainly:

| | **Plugin directory** (hosted) | **Local install** (`npx`, stdio) |
|---|---|---|
| **Setup** | one click, no config file, no Node | one config entry, needs Node ≥ 18 |
| **Tools** | 6 — docs + scaffolding | **13** — the same 6 plus the CLI bridge |
| **Can write files / run `imq`** | no | yes (`create_service`, `generate_client`, `fleet`, `config`, `logs`, …) |
| **Works in ChatGPT** | yes | no — ChatGPT connects to MCP servers over HTTP only |
| **Works in Codex CLI** | yes | yes |
| **Good for** | asking, reading, drafting code | actually building services |

### Codex: the local server, with the CLI bridge {#codex-local}

If you want Codex to *build* — scaffold a provider-wired service, generate a typed
client by introspecting a running one, manage your local fleet — install the local
server too. Codex reads `~/.codex/config.toml`, and MCP servers go under
`mcp_servers` in TOML rather than the `mcpServers` JSON key every other client uses:

~~~toml
[mcp_servers.imqueue]
command = "npx"
args = ["-y", "@imqueue/mcp"]
~~~

Restart Codex; `/mcp` lists the servers it loaded. Pair it with
[`@imqueue/cli`](/cli/) — `npm i -g @imqueue/cli` — since the CLI-bridge tools
drive the real `imq` binary, and `cli_status` will tell you whether it found one.

The two are **not** mutually exclusive: nothing stops you keeping the plugin for
its zero-setup docs search and the local server for the work that touches disk. If
you do run both, give them different names in the config so the tool lists stay
distinguishable — the plugin's tools and the local server's overlap by design.

**ChatGPT is hosted-only.** It connects to MCP servers by URL, so there is no local
option there; the plugin is the whole story. Build with Codex, Claude Code, Cursor
or any other client that launches a local subprocess.

Everything below is the **local** (stdio) setup — the full-power option, client by
client.

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

Or install it in one click:

<a href="cursor://anysphere.cursor-deeplink/mcp/install?name=imqueue&config=eyJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsIkBpbXF1ZXVlL21jcCJdfQ==" style="display:inline-block;font-family:var(--font-mono);font-size:13px;padding:9px 16px;border:1px solid var(--accent);border-radius:8px;color:var(--accent);text-decoration:none;">▶ Add to Cursor</a>

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

Or install it in one click (opens VS Code):

<a href="https://vscode.dev/redirect/mcp/install?name=imqueue&config=%7B%22type%22%3A%22stdio%22%2C%22command%22%3A%22npx%22%2C%22args%22%3A%5B%22-y%22%2C%22%40imqueue%2Fmcp%22%5D%7D" style="display:inline-block;font-family:var(--font-mono);font-size:13px;padding:9px 16px;border:1px solid var(--accent);border-radius:8px;color:var(--accent);text-decoration:none;">▶ Install in VS Code</a>

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

That TOML is the **local** server, with all 13 tools; see
[Codex: the local server](#codex-local) above for what to pair it with. If the docs
and scaffolding tools are all you need, Codex has a shorter path — install @imqueue
[from OpenAI's plugin directory](#chatgpt-codex) and skip the file entirely.

You can also find the server on the official MCP registry as **`org.imqueue/mcp`**
if your client installs from there, and in
[OpenAI's plugin directory](https://chatgpt.com/plugins/plugin_asdk_app_6a6f945292888191a7d77db4893f8520)
for ChatGPT and Codex.

## Verify it worked

1. **Restart the client** (or reload its MCP config). Desktop apps usually need a full restart. Installing from [OpenAI's plugin directory](#chatgpt-codex) takes effect immediately — there is no config file to reload.
2. Open the client's **tools / MCP** list — you should see **imqueue** with its tools (`search_docs`, `create_service`, `fleet`, …). Enable them if the client disables new tools by default (VS Code and Visual Studio do).
3. Ask the agent to use one, e.g. *"use the imqueue MCP to search the docs for delayed jobs."*

If the server does not appear or fails to start — especially the
**`npx` not found** error common when Node is installed via `nvm` and the client
is launched from the desktop — see
[Safety & troubleshooting](/mcp/security/#troubleshooting).
