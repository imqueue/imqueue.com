---
chapter: 5
title: "MCP safety model & troubleshooting"
docLabel: "MCP SERVER — 05 / 05"
lead: "The trust model behind the server — what it can and can't touch — and fixes for the setup problems you're most likely to hit."
description: "The @imqueue MCP server's safety model — local stdio, sandboxed hosted endpoint, dry-run by default, no telemetry — plus common troubleshooting fixes."
keywords: "@imqueue mcp security, mcp server safe by default, npx not found mcp, imqueue mcp troubleshooting, mcp server nvm path, dry-run create_service"
ogType: article
---

## Trust model

You are connecting an autonomous agent to a tool that reads your docs and, with
the CLI, can touch your machine. Here is exactly what the server can and cannot
do.

- **The `npx` install runs locally over stdio.** The server is a subprocess your client launches, with no account — your prompts and code never leave your machine except for documentation fetches.
- **The hosted endpoint offers only tools it can run.** `mcp.imqueue.org` runs on Cloudflare and **cannot reach your filesystem or CLI**, so it does not register the CLI-bridge tools at all — they are absent from its tool list rather than present-but-inert. What it serves is six read-only tools: `search_docs`, `get_doc`, `list_packages`, `scaffold_service`, `scaffold_client` and `local_install_guide`. Each request is handled independently (no sessions, no stored state). Use it to explore; use the local install to build.
- **Every tool declares its own blast radius.** All of them carry the MCP `readOnlyHint`, `destructiveHint` and `openWorldHint` annotations, so your client can decide what to run unattended instead of inferring it from a name. A tool that accepts several operations is marked by its **worst** one — `fleet` is destructive because `stop` is, `config` because `set` overwrites, `logs` because `clean` deletes.
- **Network access is host-locked.** The only network calls are to `imqueue.org` (for `search_docs` / `get_doc` / the docs cache). `get_doc` explicitly refuses any other host, so it can't be steered into fetching arbitrary URLs.
- **Read-only and state-changing tools are separated.** See the table below — the agent (and you) can tell at a glance which tools only read.
- **`create_service` is a dry-run by default.** It writes nothing unless called with `apply: true`. Creating repos, configuring CI or pushing to a remote never happens silently.
- **Interactive commands fail fast.** Every CLI call runs with stdin closed and a timeout, so a command that would block on a prompt returns guidance instead of hanging your agent indefinitely.
- **Log output is bounded.** `logs dump` never follows/streams and its output is capped, so it can't flood the agent's context.
- **No telemetry.** The server collects and phones home nothing.

### What each tool can touch

| Read-only | Changes state |
|---|---|
| `search_docs`, `get_doc`, `list_packages` | `cli_install` (global npm install) |
| `scaffold_service`, `scaffold_client` | `create_service` **with `apply: true`** |
| `cli_status`, `cli_help` | `generate_client` (writes client files) |
| `create_service` (default dry-run) | `fleet start/stop/restart` |
| `config check/get`, `fleet status` | `config set`, `logs clean` |
| `logs dump` | |

If you want a purely read-only setup — great for exploring the docs — simply don't
install `@imqueue/cli`; the CLI-bridge tools then stay dormant and only the docs
and offline scaffolding tools are active.

## Local or hosted — which should you use?

They are not the same tool set, and the difference is not just *where the server
runs*. The [hosted endpoint](/mcp/#hosted-endpoint) (`mcp.imqueue.org`) is a great
zero-install way to explore the docs and scaffold snippets, with six read-only tools.
The local install has all thirteen. For real development work, **the local `npx`
install is the better choice** — here's why.

### Why run the MCP server locally instead of using the hosted endpoint?
The local install is the full product. Because it runs on your machine over stdio,
it can do the things that actually matter while building: scaffold provider-wired
services **straight into your repo**, generate a typed client by introspecting
your **running** service, and start/inspect your **local fleet** — none of which a
remote server can reach. The hosted endpoint deliberately can't touch your project,
and so it does not list those tools at all: if you connect to it and ask your agent
to start your fleet, there is no `fleet` tool for it to call.

### Is the local server more private?
Yes. Everything stays on your machine — the only network traffic is documentation
fetches to `imqueue.org`. With the hosted endpoint your tool inputs travel to the
server, so for proprietary code and context the local install keeps it local by
default.

### Is local faster?
Yes. Tool calls run in-process over stdio with no per-call network hop, so the
agent gets answers with lower latency. The hosted endpoint adds an HTTP round-trip
to every call.

### Does it keep working offline or behind a corporate firewall?
Largely, yes. Offline scaffolding works with no network at all, and only the
documentation tools need `imqueue.org`. The hosted endpoint requires reaching
`mcp.imqueue.org`, so on locked-down networks the local install is more reliable.

### Will it match my installed CLI and flags?
Yes — the local server drives *your* actual `imq` binary, so `create_service` and
`generate_client` reflect your project's exact CLI version, selected providers and
flags. The hosted server has no CLI at all, so it can only emit generic scaffolds.

**Bottom line:** start on the hosted endpoint to explore; switch to the one-line
local install the moment you're scaffolding real services or working with running
ones.

## Troubleshooting

### The server doesn't appear in my client
Almost always the client wasn't fully restarted, or the config has the wrong
shape. Check:

- **Restart the whole app**, not just the window (Claude Desktop, JetBrains, Visual Studio all cache the config at startup).
- **Right key for the client.** Cursor / Claude / JetBrains / Windsurf use `mcpServers`; **VS Code and Visual Studio use `servers` with `"type": "stdio"`.** Copying the wrong one is the most common mistake.
- **Enable the tools.** VS Code and Visual Studio disable newly added MCP tools by default — turn imqueue's tools on in the Copilot tools list.

### `npx` not found / server fails to start
Desktop apps launched from your OS menu often **don't inherit your shell's
`PATH`**, so if Node is installed via **`nvm`** the client can't find `npx`. Fix
it by pointing at the absolute path:

~~~bash
which npx   # e.g. /home/you/.nvm/versions/node/v22.15.0/bin/npx
~~~

~~~json
{
  "mcpServers": {
    "imqueue": {
      "command": "/home/you/.nvm/versions/node/v22.15.0/bin/npx",
      "args": ["-y", "@imqueue/mcp"]
    }
  }
}
~~~

(Use the `servers` shape for VS Code / Visual Studio.) A system-wide Node install
avoids this entirely.

### On Windows the command won't launch
Some Windows clients need the command wrapped:

~~~json
{ "command": "cmd", "args": ["/c", "npx", "-y", "@imqueue/mcp"] }
~~~

or use `npx.cmd` as the command.

### First launch is slow
`npx -y @imqueue/mcp` downloads the package on first run, so the initial start can
take a few extra seconds before tools appear. Subsequent launches are fast. To
avoid the download entirely, install it globally (`npm i -g @imqueue/mcp`) and
point `command` at `imqueue-mcp`.

### The CLI tools say `imq` isn't installed
The CLI-bridge tools need [`@imqueue/cli`](/cli/). Ask the agent to run
`cli_install`, or install it yourself with `npm i -g @imqueue/cli`. The docs and
offline scaffolding tools work regardless.

### `config init` or a service create "hangs" / times out
Those commands are interactive. The server deliberately runs with stdin closed, so
they fail fast instead of hanging — that's expected. Use `config set` for
individual values, and pass explicit `flags` (discovered via `cli_help`) to
`create_service` so it runs non-interactively.

### `generate_client` can't find the service
`imq client generate` introspects a **running** service. Start it first (e.g. via
the `fleet` tool), then retry.

### Logs look truncated
By design — `logs dump` caps its output so it can't overwhelm the agent. For full
logs, read the service's own log files directly, or narrow the `services`
argument.

Still stuck? The server is open source — file an issue at
[github.com/imqueue/mcp](https://github.com/imqueue/mcp/issues).

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "FAQPage",
  "mainEntity": [
    {
      "@type": "Question",
      "name": "Is the @imqueue MCP server safe to connect to an AI agent?",
      "acceptedAnswer": {
        "@type": "Answer",
        "text": "Every tool declares its own blast radius. All of them carry the MCP readOnlyHint, destructiveHint and openWorldHint annotations, so your client can decide what to run unattended instead of inferring it from a name. Network access is host-locked: the only network calls are to imqueue.org, and get_doc explicitly refuses any other host, so it can't be steered into fetching arbitrary URLs. No telemetry. The server collects and phones home nothing."
      }
    },
    {
      "@type": "Question",
      "name": "Will the @imqueue MCP server modify my files or push to git without asking?",
      "acceptedAnswer": {
        "@type": "Answer",
        "text": "create_service is a dry-run by default. It writes nothing unless called with apply: true. Creating repos, configuring CI or pushing to a remote never happens silently."
      }
    },
    {
      "@type": "Question",
      "name": "Why does my MCP client say 'npx not found'?",
      "acceptedAnswer": {
        "@type": "Answer",
        "text": "Desktop apps launched from your OS menu often don't inherit your shell's PATH, so if Node is installed via nvm the client can't find npx. Fix it by pointing at the absolute path."
      }
    },
    {
      "@type": "Question",
      "name": "Do I need the @imqueue CLI to use the MCP server?",
      "acceptedAnswer": {
        "@type": "Answer",
        "text": "If you want a purely read-only setup — great for exploring the docs — simply don't install @imqueue/cli; the CLI-bridge tools then stay dormant and only the docs and offline scaffolding tools are active."
      }
    },
    {
      "@type": "Question",
      "name": "Should I use the local @imqueue MCP server or the hosted endpoint?",
      "acceptedAnswer": {
        "@type": "Answer",
        "text": "Bottom line: start on the hosted endpoint to explore; switch to the one-line local install the moment you're scaffolding real services or working with running ones."
      }
    },
    {
      "@type": "Question",
      "name": "Why is the local @imqueue MCP server the better option for developers?",
      "acceptedAnswer": {
        "@type": "Answer",
        "text": "The local install is the full product. Because it runs on your machine over stdio, it can do the things that actually matter while building: scaffold provider-wired services straight into your repo, generate a typed client by introspecting your running service, and start/inspect your local fleet — none of which a remote server can reach."
      }
    },
    {
      "@type": "Question",
      "name": "Is the local MCP server more private and faster than the hosted endpoint?",
      "acceptedAnswer": {
        "@type": "Answer",
        "text": "Yes. Everything stays on your machine — the only network traffic is documentation fetches to imqueue.org. With the hosted endpoint your tool inputs travel to the server, so for proprietary code and context the local install keeps it local by default. Tool calls run in-process over stdio with no per-call network hop, so the agent gets answers with lower latency."
      }
    }
  ]
}
</script>
