---
layout: post.html
permalink: /blog/imqueue-vs-trpc/
templateEngineOverride: md
title: "tRPC vs @imqueue: client–server types vs service–service RPC"
summary: "tRPC gives you end-to-end types between a frontend and its backend. @imqueue gives you typed RPC between backend services over a queue. They solve adjacent — not competing — problems."
description: "tRPC infers types across a shared TypeScript project for HTTP calls; @imqueue generates clients from a running service for queue-based RPC between backends."
keywords: "trpc vs imqueue, trpc alternative backend, typed rpc typescript, service to service rpc, imqueue, monorepo types"
date: 2026-06-14
dateModified: 2026-07-29
author: andrii
illustration: boundaries
topics: [comparison, types, rpc]
ogType: article
---

**tRPC and `@imqueue` are both typed RPC for TypeScript, but they type different boundaries.** tRPC infers types across a shared TypeScript project, which suits a frontend calling its own backend over HTTP. `@imqueue` generates a client from a running service, which suits backend services calling each other over a message queue. People sometimes ask whether `@imqueue` is "tRPC for microservices" — it's a useful comparison, as long as you keep the two problems distinct.

(tRPC details reflect its documented behavior at the time of writing; check their docs for the current API surface.)

## What tRPC is for

tRPC shines at the **client–server** boundary — typically a web frontend calling its own backend. You define routers and procedures on the server, and the client infers their types directly from the server's types through a shared TypeScript project. The transport is usually HTTP, with WebSocket support for subscriptions. The magic is that there's no build step: type inference does the work, as long as both sides share the same TypeScript types at compile time.

That last condition is the key constraint. tRPC's inference relies on the client being able to `import type` from the server — natural in a monorepo where frontend and backend compile together, and awkward or impossible across independently deployed, independently versioned services.

## What @imqueue is for

`@imqueue` targets the **service–service** boundary: backend services calling each other, often deployed separately, over a message queue rather than HTTP. It doesn't rely on a shared compile-time project. Each service is self-describing at runtime, and a typed client is *generated* from the service's description. That generated client can live in a different repository, ship on its own schedule, and be regenerated when the service changes.

So the distinction is:

- **tRPC:** compile-time type *inference* across a shared project → ideal frontend ↔ backend.
- **@imqueue:** runtime self-description → *generated* typed client → ideal service ↔ service.

## The same contract, side by side

The difference is clearest in code. With tRPC, the contract is a value on the server whose *type* the client imports:

```typescript
// server/src/router.ts
import { initTRPC } from '@trpc/server';
import { z } from 'zod';

const t = initTRPC.create();

export const appRouter = t.router({
  userById: t.procedure
    .input(z.string())
    .query(({ input }) => getUser(input)),
});

export type AppRouter = typeof appRouter;
```

```typescript
// client — reaches into the server's source for its types
import type { AppRouter } from '../../server/src/router';

const client = createTRPCClient<AppRouter>({ /* links… */ });
const user = await client.userById.query('42');
```

That relative `import type` is the whole story: it's why tRPC feels frictionless in a monorepo, and why it stops being an option once the two sides live in separate repositories on separate release cadences.

With `@imqueue`, the contract is the service class, and the doc-block is load-bearing — JSDoc is the *only* type source the generator reads:

```typescript
import { IMQService, expose } from '@imqueue/rpc';

export class User extends IMQService {
    /**
     * Returns a user by id
     *
     * @param {string} id - user identifier
     * @return {Promise<{ id: string; name: string } | null>}
     */
    @expose()
    public async get(id: string): Promise<{ id: string; name: string } | null> {
        return { id, name: 'Jane Doe' };
    }
}
```

You generate the client against the **running** service:

```bash
imq client generate User ./src/clients
```

and the caller — in any repo — consumes a normal typed class:

```typescript
import { user } from './clients/index.js';

const client = new user.UserClient({ callTimeout: 5000 });
await client.start();

const found = await client.get('42'); // typed end to end
```

No `import type` reaching across a project boundary, because the types arrived as generated code.

## What happens in tRPC and `@imqueue` when the contract changes

Contract change is where the two models genuinely diverge, and it's the question worth asking of your own architecture.

Change a procedure's input in tRPC and the frontend stops compiling **immediately** — same build, same `tsc` run. That tight loop is tRPC's best feature. It works because both sides are one compilation unit, which is also why it can't help you across a deployment boundary: if the backend ships independently, nothing recompiles the caller at the moment the contract moves.

Change an exposed method in `@imqueue` and nothing breaks until someone regenerates. Regenerate, and mismatches become compile errors in the caller's own build. That's a deliberate trade: you get a versionable artifact that survives independent deploys, at the cost of a step you have to remember. In practice the loop looks like this, straight from the CLI guide:

```bash
imq ctl start -s user -c     # bring the service up and wait for readiness
imq client generate User ./src/clients   # the queue/class name, not the directory
imq ctl stop -s user
```

Neither model detects a *running* peer drifting from the client you generated last month — that's what [versioning your service contracts](/blog/versioning-microservices-without-breaking-callers/) is for, in either world.

## Transport and coupling

tRPC runs over HTTP, which is exactly right for reaching a backend from a browser. `@imqueue` runs over a message queue, which is right for internal traffic — no per-service addressing, competing-consumer load balancing, and natural back-pressure — but not something a browser talks to directly.

The queue also changes the delivery contract in a way HTTP doesn't. An HTTP call either returns, errors, or times out. A queue-based call is **at-least-once**: `@imqueue` may deliver the same message twice, so exposed methods should be idempotent. If you're used to reasoning about HTTP request/response, that's the one mental model you actually have to adjust — see [what guaranteed delivery really costs](/blog/guaranteed-message-delivery-cost/).

## Where tRPC is the better choice

Being honest about this is more useful than a feature count:

- **A browser is one of the callers.** Not a contest — the queue isn't reachable from a browser, and `@imqueue` has no story here.
- **You want zero build steps.** tRPC's inference needs no generator, no artifact, and no running service. `@imqueue` needs the service up to generate against.
- **You need subscriptions or streaming.** tRPC has WebSocket subscriptions; `@imqueue` is request/response over a broker, with no streaming.
- **You want validation and typing in one place.** tRPC composes with validators like zod so the runtime check and the static type come from one schema. `@imqueue` validates argument *count* and types from JSDoc, but a schema validator is yours to add.
- **Your whole app is one deployable.** If frontend and backend ship together forever, tRPC's constraint costs you nothing and its ergonomics are better.

## Where @imqueue's model costs you

Equally honest, and worth knowing before you adopt it:

- **JSDoc is mandatory and load-bearing.** Missing type annotations degrade to `any`, and the `@param` count must match real arity or calls fail with `IMQ_RPC_INVALID_ARGS_COUNT`. Consuming projects must compile with `removeComments: false` or the generator has nothing to read.
- **No rest or spread parameters** on exposed methods — a documented limitation. Pass an array instead.
- **`callTimeout` is unset by default.** A call to a service that never answers stays pending *forever*. Set it explicitly; the docs recommend it for production.
- **Decorator order matters.** `@expose()` must sit innermost — closest to the method — when combined with `@lock()`, `@cache` or `@logged()`, or argument validation and the generated signature break.
- **Node and TypeScript only, Redis only.** `@imqueue` is not polyglot and ships one transport. [gRPC is the better answer for a mixed-language fleet](/blog/grpc-vs-message-queue-rpc/).

## Using tRPC and `@imqueue` together

tRPC and `@imqueue` coexist cleanly, and in most systems that's the right answer: tRPC (or plain HTTP, or GraphQL) at the edge for your client apps, `@imqueue` between the services behind it.

```
browser ──tRPC/HTTP──▶ API gateway ──@imqueue/rpc──▶ user, billing, search…
```

The gateway is the only process that speaks both. Everything behind it gets queue semantics — competing consumers, no service discovery, no load balancer — and everything in front of it gets the browser-friendly transport it needs. The [tutorial](/tutorial/) builds exactly this shape with a GraphQL gateway, and swaps in a REST one later.

The one thing to decide deliberately is which tool *owns* service-to-service calls, so you aren't running two RPC mechanisms over the same traffic.

## Quick comparison

| | @imqueue | tRPC |
|---|---|---|
| Primary boundary | Service ↔ service (backend) | Client ↔ server (often frontend ↔ backend) |
| Transport | Message queue (Redis) | HTTP / WebSocket |
| How types cross | Client generated from the running service | Compile-time inference via shared project |
| Artifact | Committed generated client | None — types are inferred |
| Deployment coupling | Independent repos, independent cadence | Best as one compilation unit |
| Breaks on change | At regeneration | Immediately, same build |
| Delivery | At-least-once; handlers idempotent | HTTP request/response |
| Streaming | No | WebSocket subscriptions |
| Load balancing | Competing consumers on the queue | Whatever fronts your HTTP server |
| Languages | Node.js / TypeScript | TypeScript |

## How to choose

- **Use tRPC** to connect a TypeScript frontend to its backend with zero-boilerplate inferred types in a monorepo.
- **Use @imqueue** to connect backend services to each other with typed, queue-based RPC when they're deployed and versioned independently.
- **Use both** in the same architecture — they're solving different halves of the problem.

## Frequently asked questions about tRPC and @imqueue

### Is @imqueue a drop-in replacement for tRPC?
No. tRPC types the client–server boundary and speaks HTTP; `@imqueue` types the service–service boundary and speaks a queue. A browser can't talk to `@imqueue` at all.

### Can I use tRPC between backend services?
You can, and people do — it's HTTP underneath. The friction shows up in coupling: the caller needs the callee's TypeScript types at compile time, so independently deployed services end up publishing a types package or living in one repo. That's the constraint `@imqueue` removes by generating a client instead.

### Does @imqueue need a monorepo?
No — that's rather the point. The generated client is a committed artifact, so callers can live in separate repositories and regenerate on their own schedule.

### Do I still need code generation with @imqueue?
Yes, one command against a running service: `imq client generate <name> [path]`. That's the trade for working across deployment boundaries. See [why generated clients beat hand-written ones](/blog/stop-hand-writing-microservice-clients/).

### Which gives better type safety?
Both are strong, differently. tRPC's inference can't drift from the server because it *is* the server's types. `@imqueue`'s generated client can drift until you regenerate — but it's a real artifact you can version, review and ship independently.

### Can I use @imqueue with a GraphQL or REST gateway?
Yes, and it's the common shape: the gateway speaks HTTP outward and `@imqueue` inward. The [tutorial](/tutorial/) builds both variants.

---

If the service-to-service half is what you're wrestling with, [**Getting Started**](/get-started/) shows the generated-client workflow end to end, and [type-safe service communication in TypeScript](/blog/type-safe-service-communication-typescript/) covers the typing model in more depth. Shipping inside a closed-source product? See [commercial licensing & support](/license/).
