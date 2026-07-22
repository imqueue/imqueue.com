---
chapter: 5
title: "Safety & troubleshooting"
docLabel: "MCP SERVER — 05 / 05"
lead: "The trust model behind the server — what it can and can't touch — and fixes for the setup problems you're most likely to hit."
description: "The @imqueue MCP server's safety model (local-only, host-locked, dry-run by default, no telemetry) plus troubleshooting: npx not found, imq missing, config init timeouts, capped logs and per-client config gotchas."
keywords: "@imqueue mcp security, mcp server safe by default, npx not found mcp, imqueue mcp troubleshooting, mcp server nvm path, dry-run create_service"
ogType: article
---

## Trust model

You are connecting an autonomous agent to a tool that reads your docs and, with
the CLI, can touch your machine. Here is exactly what the server can and cannot
do.

- **Runs locally over stdio.** The server is a subprocess your client launches. There is no hosted endpoint and no account — your prompts and code never leave your machine except for documentation fetches.
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
      "acceptedAnswer": { "@type": "Answer", "text": "Yes. It runs locally over stdio with no hosted endpoint, telemetry or account. Its only network access is to imqueue.org for documentation, and get_doc is host-locked to that domain. State-changing tools are separated from read-only ones, and create_service is a dry-run unless you pass apply: true." }
    },
    {
      "@type": "Question",
      "name": "Will the @imqueue MCP server modify my files or push to git without asking?",
      "acceptedAnswer": { "@type": "Answer", "text": "No. create_service runs as a dry-run by default and writes nothing; a real run requires an explicit apply: true. Fleet start/stop/restart and config set change state and are clearly marked, while search, scaffolding and status tools are read-only." }
    },
    {
      "@type": "Question",
      "name": "Why does my MCP client say 'npx not found'?",
      "acceptedAnswer": { "@type": "Answer", "text": "Desktop apps launched from the OS menu often do not inherit your shell PATH, so a Node installed via nvm is invisible to them. Point the command at the absolute path to npx (from 'which npx'), or use a system-wide Node install." }
    },
    {
      "@type": "Question",
      "name": "Do I need the @imqueue CLI to use the MCP server?",
      "acceptedAnswer": { "@type": "Answer", "text": "No. Documentation search and offline scaffolding work without it. Installing @imqueue/cli additionally unlocks the CLI-bridge tools that create real services, generate typed clients and manage a local fleet." }
    }
  ]
}
</script>
