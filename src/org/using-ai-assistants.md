---
layout: docs.html
section: docs
title: Using @imqueue with AI assistants
docLabel: AI ASSISTANTS
lead: "Build @imqueue services faster with Claude, ChatGPT, Cursor, GitHub Copilot and other coding agents. Paste the context block below into your assistant so it generates correct, idiomatic @imqueue code."
description: "How to use @imqueue with AI coding assistants like Claude, ChatGPT, Cursor and Copilot — a paste-ready context block and the machine-readable docs endpoints (llms.txt, markdown mirrors) agents can fetch."
keywords: "@imqueue AI assistant, imqueue Cursor, imqueue Claude, imqueue Copilot, AI coding assistant Node.js RPC, llms.txt, generate imqueue service with AI, TypeScript microservices AI"
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
  hand-written. Usage:
    const client = new UserClient();
    await client.start();
    const user = await client.update({ ... });
- There is no service discovery or load balancer to configure; the queue handles
  routing.

Runtime:
- Requires Node.js 22.12+ and Redis 3.2+ (default connection localhost:6379).
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

Then generate and use a fully typed client:

~~~bash
imq client generate UserService
~~~

~~~typescript
const client = new UserServiceClient();
await client.start();
const user = await client.get('42'); // fully typed, no hand-written client
~~~

## Endpoints for AI agents

If you are building an agent, or your assistant can fetch URLs, these endpoints
serve the documentation in machine-friendly form:

- **[/llms.txt](/llms.txt)** — a curated, machine-readable index of the docs
  (following the [llmstxt.org](https://llmstxt.org/) convention).
- **[/llms-full.txt](/llms-full.txt)** — the full documentation concatenated into
  a single markdown file for one-shot ingestion.
- **Markdown mirror of any docs page** — append `index.md` to a page URL, e.g.
  [`/get-started/index.md`](/get-started/index.md) or
  [`/tutorial/user-service/index.md`](/tutorial/user-service/index.md).
- **[/api/](/api/)** — the full generated API reference for `@imqueue/core` and
  `@imqueue/rpc`.

## Next steps

- Work through the [Getting Started](/get-started/) guide.
- Follow the [Tutorial](/tutorial/) for a complete example application.
- Explore the [CLI User Guide](/cli/) for scaffolding and fleet management.
