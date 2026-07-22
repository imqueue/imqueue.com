---
chapter: 3
title: "Tools reference"
docLabel: "MCP SERVER — 03 / 05"
lead: "Every tool the @imqueue MCP server exposes — what it does, what it takes, what comes back, and an example prompt that triggers it."
description: "Reference for all @imqueue MCP server tools: search_docs, get_doc, list_packages, scaffold_service, scaffold_client, cli_status, cli_install, cli_help, create_service, generate_client, fleet, config and logs."
keywords: "@imqueue mcp tools, search_docs get_doc, scaffold_service scaffold_client, create_service generate_client, imq fleet config logs mcp, mcp tool reference imqueue"
ogType: article
---

The server exposes its tools in three groups. **Documentation** and **scaffolding**
tools work everywhere with no dependencies. The **CLI bridge** tools require
[`@imqueue/cli`](/cli/) (`imq`) on your `PATH` — call `cli_status` first, and if
it is missing either `cli_install` it or fall back to the offline `scaffold_*`
tools.

You never call these by hand — your agent picks them based on their descriptions.
This page is so you know what it *can* do, and what is safe.

## Documentation

### `search_docs`
Search the official @imqueue docs (guides, tutorial, CLI manual, API reference,
articles) and return the most relevant pages with their URLs.

- **Input:** `query` (string) — what you want to find; `limit` (1–20, default 6).
- **Returns:** a ranked list of matching pages with titles, sections and URLs.
- **Side effects:** none (read-only; fetches imqueue.org).
- **Example prompt:** *"How do I expose a method on an @imqueue service?"*

### `get_doc`
Fetch the full markdown of a documentation page by its URL (as returned by
`search_docs`), ready to read and quote.

- **Input:** `url` (string) — an `imqueue.org` page URL.
- **Returns:** the page as plain markdown.
- **Side effects:** none. **Host-locked to `imqueue.org`** — it will not fetch any other host.
- **Example prompt:** *"Read the getting-started guide and summarise the steps."*

### `list_packages`
The main @imqueue packages with a one-line summary and install command, so the
agent picks the right one before writing code.

- **Input:** none.
- **Returns:** the package catalog (e.g. `@imqueue/rpc`, `@imqueue/core`, `@imqueue/cli`) with install commands.
- **Side effects:** none.
- **Example prompt:** *"Which @imqueue package do I need for delayed jobs?"*

## Scaffolding (offline)

### `scaffold_service`
Generate an idiomatic `@imqueue/rpc` service — an `IMQService` subclass with
`@expose()`d, JSDoc-typed methods plus a bootstrap that starts it.

- **Input:** `name` (string); `methods` (optional array of `{ name, description?, params?, returns? }`).
- **Returns:** ready-to-save TypeScript. Omitting `methods` yields a starter template.
- **Side effects:** none — returns code as text; writes nothing.
- **Example prompt:** *"Scaffold an @imqueue user service with getUser and createUser."*

### `scaffold_client`
@imqueue generates the **real** typed client from a **running** service, so types
never drift. This tool returns the exact command to do that plus an illustrative
usage snippet — it does not fabricate a client that could go stale.

- **Input:** `service` (string); `methods` (optional, to shape the example).
- **Returns:** the `imq client generate` command and an example call.
- **Side effects:** none.
- **Example prompt:** *"How do I get a typed client for my user service?"*

## CLI bridge

These drive the real `imq` binary. Every call runs with **stdin closed and a
timeout**, so a command that would prompt interactively fails fast with guidance
rather than hanging your agent.

### `cli_status`
Detect whether `imq` (@imqueue/cli) is installed and report its version. The agent
should call this before any other CLI-bridge tool.

- **Input:** none. **Read-only.**
- **Example prompt:** *"Is the @imqueue CLI installed?"*

### `cli_install`
Install `@imqueue/cli` globally via `npm install -g @imqueue/cli` when it is
missing.

- **Input:** `version` (optional npm version/tag, default `latest`).
- **Side effects:** installs a global npm package (may need a writable prefix or elevated permissions).
- **Example prompt:** *"Install the @imqueue CLI for me."*

### `cli_help`
Run `imq [command] --help` and return the exact, version-accurate flags — the
agent uses this to build a non-interactive `create_service` call.

- **Input:** `command` (optional, e.g. `"service create"`). **Read-only.**
- **Example prompt:** *"What flags does imq service create take?"*

### `create_service`
Scaffold a real, provider-wired service via `imq service create`.

- **Input:** `name`; `path?`; `flags?` (from `cli_help`); `cwd?`; **`apply?`**.
- **Safety:** runs as a **dry-run by default** (shows the plan, writes nothing). A real run requires **`apply: true`** — it can write files, init git, configure CI and push to a remote, so an agent should only apply with your clear intent.
- **Example prompt:** *"Create a payments service — show me the plan first."*

### `generate_client`
Run `imq client generate <Service>` to emit the real, fully-typed client.

- **Input:** `service`; `path?`; `cwd?`.
- **Requirement:** the target service must be **running** — the CLI introspects the live service.
- **Example prompt:** *"Generate the typed client for the running UserService."*

### `fleet`
Run `imq ctl <action>` over a directory of service repositories.

- **Input:** `action` (`start` | `stop` | `restart` | `status`); `path?`; `services?`; `update?`; `calm?`; `verbose?`; `cwd?`.
- **Safety:** `status` is read-only; `start` / `stop` / `restart` change running processes.
- **Example prompt:** *"Start my local fleet and tell me what's running."*

### `config`
Run `imq config <action>` to manage CLI configuration.

- **Input:** `action` (`check` | `get` | `set` | `init`); `option?` (dot-path for nested keys); `value?`; `cwd?`.
- **Safety:** `check` / `get` are read-only; `set` writes one value; `init` is interactive, so automation should prefer `set`.
- **Example prompt:** *"Set my default CI provider to github-actions."*

### `logs`
Work with logs of services started by `imq ctl`.

- **Input:** `action` (`dump` (default) | `clean`); `services?`; `prefix?`; `cwd?`.
- **Safety:** `dump` reads the current combined logs and exits — it **never follows/streams**, and output is capped so it can't flood the agent; `clean` deletes collected logs.
- **Example prompt:** *"Show me the recent logs for the auth service."*

## Read-only vs state-changing

A quick map of what is safe to let an agent call freely versus what changes your
machine:

| Read-only | Changes state |
|---|---|
| `search_docs`, `get_doc`, `list_packages` | `cli_install` (global npm install) |
| `scaffold_service`, `scaffold_client` | `create_service` **with `apply: true`** |
| `cli_status`, `cli_help` | `generate_client` (writes client files) |
| `create_service` (default dry-run) | `fleet start/stop/restart` |
| `config check/get`, `fleet status` | `config set`, `logs clean` |
| `logs dump` | |

See [Safety & troubleshooting](/mcp/security/) for the full trust model, and
[Agent workflows](/mcp/workflows/) for how these tools chain together in practice.
