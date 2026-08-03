---
layout: docs.html
section: docs
title: "Agent recipes for @imqueue codebases"
docLabel: AGENT RECIPES
lead: "Machine-oriented, verifiable procedures an AI coding assistant can follow to make a change in an @imqueue codebase — each with the facts it relies on, the commands to prove it worked, and the ways it goes wrong."
description: "Machine-oriented procedures for changing an @imqueue codebase: the contracts each step relies on, commands that prove it worked, and known failure modes."
keywords: "imqueue agent recipes, ai coding agent nodejs, imqueue ai assistant, machine readable docs, llms.txt, mcp get_doc"
relatedTopics: [tooling, dx, jobs]
---

An **agent recipe** is written for a machine, not a reader. Where a blog article
explains *why* an approach works and what the trade-offs feel like in production,
a recipe states the contract precisely, gives the exact commands, and lists the
failure modes an agent should expect — so an assistant can apply it to a codebase
without inferring the parts nobody wrote down.

Every recipe below assumes one mechanism, so it is worth stating once. An
`@imqueue` RPC call is two messages over Redis — a request onto the callee's
queue, a reply onto the caller's — and the queue name *is* the service class name:

~~~mermaid
sequenceDiagram
    participant C as Caller (generated client)
    participant Q as Redis (@imqueue transport)
    participant S as UserService (extends IMQService)
    C->>Q: request onto queue "UserService"
    Note over Q: {method:"get", args:["42"], from:"caller-reply-queue"}
    Q-->>S: whichever instance asks first
    S->>S: run the @expose()d get(id)
    S->>Q: reply onto the caller's own queue
    Q-->>C: resolves await client.get("42")
~~~

An `@imqueue` call has no host, port or connection: the caller addresses a queue
name, and if no instance of that service is running the request waits instead of
failing — forever, unless `callTimeout` is set.

Each recipe follows the same shape:

- **When to apply this recipe** — the trigger, so an agent can rule it out fast.
- **Facts these recipes rely on** — the API contracts the steps depend on, stated
  explicitly rather than left to be guessed from a signature.
- **The recipes themselves** — numbered, copy-pasteable procedures.
- **Verify** — commands that prove the change actually took effect.
- **Failure modes** — what breaks, what it looks like, and what to do instead.

## Available recipes

- **[Delayed &amp; scheduled work](/agents/delayed-scheduled-work/)** — implementing
  "run this later": choosing between a delayed call, `@imqueue/job` and an external
  scheduler, the trailing-argument `IMQDelay` contract, self-re-arming recurrence,
  and the accuracy and cancellation limits to plan for.
- **[Isolated imq CLI environments](/agents/isolated-imq-environments/)** — running
  several @imqueue projects on one machine without collisions, using `IMQ_CLI_HOME`
  for a dedicated CLI home per fleet, plus disposable sandboxes for CI.

## Why these pages are not in search results

Each recipe deliberately covers the same ground as a human-facing article, so the
recipes carry `noindex` to keep the two from competing for the same queries. The
narrative versions are the ones written to be read and the ones that rank:
[delayed and scheduled work](/blog/scheduled-work-without-a-job-system/) and
[one isolated imq CLI home per project](/blog/isolated-imq-cli-environments/).

Staying out of the search index does not make the recipes any less available to an
agent. They are listed in [`/llms.txt`](/llms.txt), every page has a plain-markdown
mirror at both `<page-url>index.md` and `<page>.md` (byte-identical — the ecosystem
is split on which shape it should be, so this site serves both), and the
[@imqueue MCP server](/mcp/)'s `get_doc` tool fetches them directly.

## Getting an assistant set up

If you are pointing an AI assistant at @imqueue for the first time, start with
[using AI coding assistants with @imqueue](/using-ai-assistants/) for a paste-ready
context block, or install the [MCP server](/mcp/installation/) so your agent can
search the docs and scaffold services itself.
