---
layout: docs.html
section: docs
title: "Using AI coding assistants with @imqueue"
docLabel: AI ASSISTANTS
lead: "Build @imqueue services faster with Claude, ChatGPT, Cursor, GitHub Copilot and other coding agents. Paste the context block below into your assistant so it generates correct, idiomatic @imqueue code."
description: "Use @imqueue with Claude, ChatGPT, Cursor and Copilot: a paste-ready context block plus the machine-readable docs endpoints agents can fetch."
keywords: "@imqueue AI assistant, imqueue Cursor, imqueue Claude, imqueue Copilot, AI coding assistant Node.js RPC, llms.txt, generate imqueue service with AI, TypeScript microservices AI"
relatedTopics: [dx, tooling, clients]
---

[[toc]]

## Why this page exists

@imqueue is a small, strongly-typed framework, and coding assistants work best
when they have accurate context about its packages, decorators and conventions.
This page gives you a **paste-ready context block** and points AI agents at the
**machine-readable versions** of these docs.

## Paste this into your AI assistant

Copy the block below into Claude, ChatGPT, Cursor, Windsurf, GitHub Copilot Chat
or any other assistant before asking it to write @imqueue code. It captures the
package names, the core APIs and the constraints that most often trip up
generated code.

~~~text
You are helping me build back-end services with @imqueue, an RPC framework for
Node.js and TypeScript that communicates over a Redis-backed message queue.

Packages:
- @imqueue/rpc  — typed RPC: services, clients, decorators.
- @imqueue/core — the underlying message queue over Redis.
- @imqueue/cli  — scaffolding (`imq service create`) and client generation
                  (`imq client generate <ServiceName>`).

How a service is written:
- A service is a class that extends `IMQService` from '@imqueue/rpc'.
- Only methods decorated with `@expose()` are callable remotely.
- Exposed-method arguments and return values MUST be JSON-serializable.
- Do NOT use the spread/rest operator for exposed-method arguments — the
  generated client won't compile. Pass an array instead:
    // wrong: public doThing(...args: any[])
    // right: public doThing(args: any[])
- Write doc-blocks with accurate @param/@return types — they are part of the
  service's self-description and drive the generated client's types.

Complex types:
- Declare data objects as classes decorated with `@classType()`, and each field
  with `@property('type', optional?)`, e.g. `@property('string')` or
  `@property('AddressObject[]', true)` for an optional array.

Clients:
- Clients are GENERATED from a running service (`imq client generate`), not
  hand-written. The name you pass is the service's CLASS name, because that is
  its queue name: `imq client generate UserService ./src/clients`.
- The generated file exports ONE symbol: a namespace named after the service with
  a lower-case first letter, holding a client class whose trailing `Service` is
  replaced by `Client`. There is no top-level export of the class, so importing it
  by name does not resolve. Usage:
    import { userService } from './src/clients/UserService.js';
    const client = new userService.UserClient();
    await client.start();
    const user = await client.update({ ... });
- Every generated method takes two extra optional trailing params, in this
  order: `imqMetadata?: IMQMetadata`, then `imqDelay?: IMQDelay`. They are
  stripped by identity, not by position. To delay a call, skip the metadata slot
  and keep the delay last:
    client.update({ ... }, undefined, new IMQDelay(1, 'h'));
  From @imqueue/rpc 3.4.0 a trailing `undefined` on a delayed call is a
  placeholder and is never delivered. On <= 3.3.0 it travels on as a real
  argument and the call fails with IMQ_RPC_INVALID_ARGS_COUNT, so on those
  versions pass a bag instead:
    client.update({ ... }, new IMQMetadata({}), new IMQDelay(1, 'h'));
  Passing the delay alone, in the metadata slot, runs but does not type-check on
  any version — do not silence that error with a cast.
- There is no service discovery or load balancer to configure; the queue handles
  routing.

Runtime:
- Requires Node.js 22.12+ and Redis 6.2+ (default connection localhost:6379).
  Guaranteed delivery needs LMOVE/BLMOVE, which is why 6.2 is the floor; 3.2+
  suffices only with safeDelivery left off.
- Configure host/port/cluster/safeDelivery via IMQServiceOptions or environment.

License: the open-source packages are GPL-3.0. Commercial licensing for
closed-source products is available at https://imqueue.com.

Prefer generating a service class + its typed methods, and let the CLI generate
the client. Follow the patterns above exactly.
~~~

## A minimal service the way @imqueue expects it

~~~typescript
import { IMQService, expose } from '@imqueue/rpc';

export class UserService extends IMQService {
    /**
     * Returns a user by id
     *
     * @param {string} id - user identifier
     * @return {Promise<{ id: string; name: string } | null>}
     */
    @expose()
    public async get(id: string): Promise<{ id: string; name: string } | null> {
        // ...look the user up and return a JSON-serializable value
        return { id, name: 'Jane Doe' };
    }
}
~~~

Then generate and use a fully typed client. The name is the service's class name,
because that is its queue name:

~~~bash
imq client generate UserService ./src/clients
~~~

~~~typescript
// The generated module's only export is the namespace `userService`.
import { userService } from './src/clients/UserService.js';

const client = new userService.UserClient();
await client.start();
const user = await client.get('42'); // fully typed, no hand-written client
~~~

## MCP server: give your agent live docs & scaffolding

For agents that speak the [Model Context Protocol](https://modelcontextprotocol.io)
(Claude Code, Claude Desktop, ChatGPT, Codex, Cursor, VS Code, Visual Studio,
JetBrains, …), the **`@imqueue/mcp`** server is the best integration. Instead of
pasting the context above, your agent gets tools it can call directly — searching
these docs live, scaffolding `IMQService` code, and driving the `imq` CLI.

**ChatGPT & Codex:** install it from
[OpenAI's plugin directory](https://chatgpt.com/plugins/plugin_asdk_app_6a6f945292888191a7d77db4893f8520)
— the **Plugins** tab in ChatGPT, or `/plugins` in the Codex CLI. Nothing to
configure; the listing points at the hosted endpoint.

**Claude Code:**

~~~bash
claude mcp add imqueue -- npx -y @imqueue/mcp
~~~

Most other clients take this in their MCP config:

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

No API keys, no build step — it runs from npm and only ever fetches imqueue.org.
→ **[Full MCP server documentation](/mcp/)**: per-client setup, the complete tools
reference, agent workflows and the safety model.

## Endpoints for AI agents

If you are building an agent, or your assistant can fetch URLs, these endpoints
serve the documentation in machine-friendly form:

- **[/llms.txt](/llms.txt)** — a curated, machine-readable index of the docs
  (following the [llmstxt.org](https://llmstxt.org/) convention).
- **[/llms-full.txt](/llms-full.txt)** — the full documentation concatenated into
  a single markdown file for one-shot ingestion.
- **Markdown mirror of any docs page**, at either of two URL shapes — append
  `index.md` to the page URL, or replace its trailing slash with `.md`. Both serve
  the same bytes: [`/get-started/index.md`](/get-started/index.md) and
  [`/get-started.md`](/get-started.md) are the same file, as are
  [`/tutorial/user-service/index.md`](/tutorial/user-service/index.md) and
  [`/tutorial/user-service.md`](/tutorial/user-service.md). Stripe and Anthropic's
  docs use the second shape, Cloudflare's the first; rather than pick, this site
  answers both.
- **[/api/](/api/)** — the full generated API reference for every documented
  `@imqueue` package, and [`/api/search-index.json`](/api/search-index.json) to
  resolve a symbol name to its page.
- **[/api/faq/](/api/faq/)** — task-shaped questions answered directly, for when
  the question is "how do I do X" rather than "what does Y do". Every question is a
  `###` heading with a stable slug in both the page and
  [its mirror](/api/faq/index.md), so `/api/faq/#<slug>` addresses one answer
  instead of the whole page — worth returning in place of the full document when
  only one answer is wanted.

## Agent recipes

For specific tasks, [**/agents/**](/agents/) collects procedures written for a
machine rather than a reader — each one states the API contracts it depends on,
the commands that prove the change took effect, and the failure modes to expect.

## Next steps

- Work through the [Getting Started](/get-started/) guide.
- Follow the [Tutorial](/tutorial/) for a complete example application.
- Explore the [CLI User Guide](/cli/) for scaffolding and fleet management.
