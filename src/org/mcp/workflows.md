---
chapter: 4
title: "Agent workflows"
docLabel: "MCP SERVER — 04 / 05"
lead: "End-to-end recipes: what to ask your agent for, and how the @imqueue MCP tools chain together behind each request."
description: "Practical @imqueue MCP server workflows — build a service from a prompt, generate a typed client, run and inspect a local fleet, and what happens when the CLI isn't installed."
keywords: "@imqueue mcp workflow, ai agent build imqueue service, scaffold service prompt, generate typed client agent, imq fleet mcp, mcp recipes imqueue"
ogType: article
---

Each recipe below is a natural-language request you make to your agent, followed
by the tool chain it runs. You don't script these — the agent picks the tools
from your prompt. Knowing the chain helps you phrase requests and understand what
the agent is about to do.

## Build a service from a prompt

> *"Build me an @imqueue user service with getUser, createUser and deleteUser,
> and set it up as a real project."*

A well-behaved agent will:

1. **`search_docs`** → *"create a service"* to ground itself in the current guide.
2. **`cli_status`** → is `imq` available? If not, **`cli_install`** (or drop to step 5's offline path).
3. **`cli_help`** `service create` → discover the exact flags so the run is non-interactive.
4. **`create_service`** (name `user`) — first as a **dry-run** so you see what it would create.
5. On your go-ahead, **`create_service`** again with **`apply: true`** to actually scaffold the project.

If the CLI is not installed and you don't want it, the agent uses
**`scaffold_service`** instead to hand you the `IMQService` code directly — no
project wiring, but immediately usable.

## Generate a typed client

> *"Give me a typed client for the UserService."*

1. **`cli_status`** → confirm `imq` is present.
2. **`generate_client`** `UserService` → emits the real, introspected client.

The catch @imqueue is built around: the client is generated from a **running**
service, so the types are always the truth. If the service isn't running, the
agent will tell you to start it first (see the fleet recipe) — it can't and won't
fabricate a client from guesses. If you only need to *see the shape*,
**`scaffold_client`** returns an illustrative snippet without a running service.

## Run and inspect a local fleet

> *"Start all my services and show me if anything is failing."*

1. **`fleet`** `status` → what's already running (read-only).
2. **`fleet`** `start` (optionally `update: true` to `git pull` first, `calm: true` to start one at a time) → bring the fleet up.
3. **`logs`** `dump` → pull the recent combined logs (capped, never streaming) so the agent can spot errors.
4. If needed, **`fleet`** `restart` a specific service, then **`logs`** `dump` again.

Because `logs` never follows/streams, the agent gets a bounded snapshot it can
actually reason about instead of an endless tail.

## Learn the API without leaving your editor

> *"How does @imqueue handle delayed jobs? Show me an example."*

1. **`search_docs`** *"delayed jobs"* → the relevant guide/API pages.
2. **`get_doc`** on the top hit → full markdown to read and quote.
3. Optionally **`list_packages`** if a specific package (e.g. `@imqueue/job`) is involved.

This is the everyday use: authoritative answers from the current docs, inline,
instead of hallucinated APIs from a training snapshot.

## Configure the CLI for a project

> *"Set this project up to use GitHub Actions for CI."*

1. **`config`** `check` → is config initialized?
2. **`config`** `get` → read current values.
3. **`config`** `set` `ci.provider` `github-actions` → write the single value.

The agent prefers `set` over the interactive `init`, which would time out in a
non-interactive context.

## When the CLI isn't installed

Everything degrades gracefully. With no `imq` on `PATH`:

- **Docs** (`search_docs`, `get_doc`, `list_packages`) — fully available.
- **Scaffolding** (`scaffold_service`, `scaffold_client`) — fully available; the agent hands you code and the client-generation command to run yourself.
- **CLI bridge** — the agent offers **`cli_install`**, or continues with the offline tools above.

So even a fresh machine with just the MCP server configured gets useful,
grounded help — the CLI simply unlocks the "do it for real" tools.

---

Next: the [Safety & troubleshooting](/mcp/security/) page covers the trust model
behind `apply`, host-locking and read-only tools — worth a read before you let an
agent run `create_service` or `fleet` unattended.
