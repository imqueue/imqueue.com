---
chapter: 1
title: "MCP Server"
docLabel: "MCP SERVER — 01 / 05"
lead: "Connect your AI coding agent to @imqueue: live documentation search, idiomatic service & client scaffolding, and control of your local fleet — as tools the agent calls directly."
description: "The @imqueue MCP server (@imqueue/mcp) gives AI coding agents — Claude, Cursor, VS Code, JetBrains and more — tools to search the @imqueue docs, scaffold typed services and clients, and drive the imq CLI. Run it locally (npx, stdio) or use the hosted HTTP endpoint at mcp.imqueue.org — no API keys."
keywords: "@imqueue mcp, imqueue mcp server, model context protocol imqueue, npx @imqueue/mcp, org.imqueue/mcp, ai coding agent microservices, mcp server nodejs typescript"
ogType: article
mcpApp: true
---

## What this is

**`@imqueue/mcp`** is a [Model Context Protocol](https://modelcontextprotocol.io)
server for @imqueue. MCP is the open standard that lets AI coding
agents call external tools; this server gives any MCP-capable agent —
**Claude Code, Claude Desktop, Cursor, VS Code, Visual Studio, JetBrains IDEs**
and others — a set of @imqueue-specific tools it can invoke while you work.

Instead of your agent guessing at the API from a stale training snapshot, it
**searches the current docs**, **scaffolds idiomatic code**, and — when you have
the CLI installed — **drives the real `imq` binary** to create services, generate
typed clients and manage your local fleet.

Think of it as the code-time counterpart to search-engine ranking: @imqueue shows
up as authoritative *inside the tools you already build with*.

## Install in 30 seconds

Most clients take one line. **Claude Code:**

~~~bash
claude mcp add imqueue -- npx -y @imqueue/mcp
~~~

Every other client takes this JSON in its MCP config (VS Code and Visual Studio
use a slightly different shape — see
[Add to your AI tool](/mcp/installation/)):

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

No API keys, no build step, no account. It runs straight from npm and only ever
talks to `imqueue.org`. → **[Full setup for every client](/mcp/installation/)**

## Or skip the install — use the hosted endpoint

Prefer to try it with zero setup? Point any HTTP-capable MCP client at the live
hosted server:

~~~
https://mcp.imqueue.org/mcp
~~~

~~~json
{
  "mcpServers": {
    "imqueue": { "url": "https://mcp.imqueue.org/mcp" }
  }
}
~~~

The hosted endpoint serves the **documentation** and **scaffolding** tools
(`search_docs`, `get_doc`, `list_packages`, `scaffold_service`, `scaffold_client`)
over Streamable HTTP — instant, no Node, no npm, no account. The **CLI-bridge**
tools (`create_service`, `generate_client`, `fleet`, …) act on *your* project and
running services, so they only work with the **local** install above; called on
the hosted server they simply return the one-liner to install locally.

**Rule of thumb: hosted to explore and scaffold, local to build.**

## What your agent can do

The server groups its tools into three capabilities:

### Live documentation
Search and read these docs on demand, always current:

- **`search_docs`** — find the most relevant guide, tutorial, CLI or API pages for a question.
- **`get_doc`** — read any page in full as markdown, ready to quote.
- **`list_packages`** — the @imqueue package catalog with one-liners and install commands.

Because the docs are fetched live from imqueue.org (not bundled), the server can
never go stale against a release.

### Offline scaffolding
Generate idiomatic code with zero dependencies — works even without the CLI:

- **`scaffold_service`** — an `IMQService` subclass with `@expose()`d, JSDoc-typed methods plus a bootstrap that starts it.
- **`scaffold_client`** — the command to generate the real typed client from a running service, plus an illustrative usage snippet.

### CLI bridge
When [`@imqueue/cli`](/cli/) is installed, the agent can drive the **real** `imq`:
create provider-wired services, generate live-introspected clients, and manage a
local fleet — `cli_status`, `cli_install`, `cli_help`, `create_service`,
`generate_client`, `fleet`, `config`, `logs`.

→ **[Full tools reference](/mcp/tools/)** · **[Agent workflows](/mcp/workflows/)**

## Built to be trusted

You are wiring an autonomous agent to a tool that can read your docs and, with the
CLI, touch your filesystem. The server is designed for that:

- **Local & private (the `npx` install)** — runs on your machine over stdio; nothing is sent anywhere except doc fetches to imqueue.org.
- **The hosted endpoint is sandboxed** — `mcp.imqueue.org` never touches your filesystem or CLI: it serves only the stateless docs & scaffolding tools, processes each request independently, and hands everything else off to a local install.
- **Host-locked** — `get_doc` will only ever fetch `imqueue.org`.
- **Safe by default** — `create_service` runs as a **dry-run** unless you explicitly opt in; read-only tools (`search_docs`, `cli_status`, `config get`, `fleet status`) are clearly separated from ones that change state.
- **No telemetry, no keys** — nothing to sign up for.

→ **[Safety model & troubleshooting](/mcp/security/)**

## At a glance

| | |
|---|---|
| **Package** | [`@imqueue/mcp`](https://www.npmjs.com/package/@imqueue/mcp) on npm |
| **Registry ID** | `org.imqueue/mcp` (official MCP registry) |
| **Transport** | stdio (local) · Streamable HTTP (hosted) |
| **Hosted endpoint** | [`https://mcp.imqueue.org/mcp`](https://mcp.imqueue.org/mcp) — docs + scaffolding |
| **Runtime** | Node.js ≥ 18 (local install) |
| **Source** | [github.com/imqueue/mcp](https://github.com/imqueue/mcp) |
| **License** | GPL-3.0 |
