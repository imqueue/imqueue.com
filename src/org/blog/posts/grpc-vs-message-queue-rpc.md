---
layout: post.html
permalink: /blog/grpc-vs-message-queue-rpc/
templateEngineOverride: md
title: "gRPC vs message-queue RPC for internal Node.js services"
summary: "gRPC is the default answer for typed RPC — and a great one, especially across languages. For an all-Node.js back-end, routing RPC through a queue trades some of gRPC's strengths for a lot less infrastructure."
description: "gRPC vs message-queue RPC for internal Node.js services: schema vs generated client, addressing, load balancing, failure semantics, and what you operate."
keywords: "grpc vs message queue, grpc alternative nodejs, rpc over redis, grpc nodejs microservices, imqueue, protobuf alternative"
date: 2026-06-09
dateModified: 2026-07-29
author: mykhailo-stadnyk
illustration: grpc-queue
topics: [comparison, rpc, transport]
ogType: article
---

**gRPC and message-queue RPC solve the same problem — a typed call from one service to another — with opposite defaults.** gRPC dials a host over HTTP/2 with a Protobuf schema as the contract, and leaves addressing, balancing and retries to your infrastructure. Message-queue RPC (the `@imqueue` model) sends to a named queue, derives the contract from the service itself, and gets balancing for free — at the cost of language reach and streaming. For an all-Node.js back-end that trade is worth examining rather than assuming.

(gRPC details reflect its documented behavior at the time of writing.)

## What gRPC gives you

gRPC is a mature, cross-language RPC system built on HTTP/2 and Protocol Buffers. Its strengths are real:

- **Cross-language by design.** Define a `.proto` once, generate clients and servers in Go, Java, Python, Node, Rust and more. If your services aren't all one language, this is the headline feature and nothing here competes with it.
- **Efficient binary wire format.** Protobuf is compact and fast to encode and decode.
- **Streaming.** First-class client, server and bidirectional streaming over HTTP/2.
- **A schema as a contract.** The `.proto` file is an explicit, versioned artifact that isn't tied to any one implementation.
- **Deadlines and cancellation.** A deadline travels with the call, and a cancelled call actually signals the server. This matters more than it sounds — see below.

## What gRPC costs you to operate

gRPC's strengths come with structure you have to run:

- **A separate schema language.** You author and version `.proto` files and run codegen in every build. That's a second source of truth alongside your implementation, and it can drift from both sides.
- **Addressing is still your problem.** gRPC calls a host; something has to tell the caller where the service is and balance across instances — DNS, a service mesh, or client-side load balancing. HTTP/2's long-lived connections also interact awkwardly with naive L4 load balancers, which is how you end up with a mesh you didn't plan on.
- **It's request-shaped, not buffered.** If a callee is down or slow, the caller feels it immediately; retries, backoff and circuit breakers are yours to add.

## What message-queue RPC changes, in the `@imqueue` model

Routing RPC through a queue removes the addressing and balancing problems and drops the schema language, in exchange for narrowing scope:

- **No `.proto`, no schema codegen.** The service *is* the contract; a typed client is generated from the running service, and the types come from your TypeScript and JSDoc.
- **No discovery or load balancer.** A service reads from its named queue; multiple instances compete on that queue and balance themselves. The queue name is the address.
- **Natural back-pressure.** If consumers fall behind, the queue absorbs it instead of failing connections.

## The contract, side by side: `.proto` vs an `@imqueue` service class

With gRPC, the contract is a file in a third language:

```protobuf
// user.proto — versioned separately from either implementation
syntax = "proto3";

service User {
  rpc Get (GetRequest) returns (GetReply);
}

message GetRequest { string id = 1; }
message GetReply  { string id = 1; string name = 2; }
```

You run a generator, get stubs on both sides, and implement against them. The `.proto` is genuinely useful — it's language-neutral, reviewable, and diffable — and it's genuinely a third thing to keep honest.

With `@imqueue`, the contract is the service class, and the doc-block is load-bearing: JSDoc is the *only* type source the generator reads.

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

```bash
imq client generate User ./src/clients
```

```typescript
import { user } from './clients/index.js';

const client = new user.UserClient({ callTimeout: 5000 });
await client.start();

const found = await client.get('42');
```

One source of truth instead of two — and the price is that the contract is only expressible in TypeScript, so a Go service can't consume it.

## Failure and timeouts: where gRPC and queue RPC diverge most

Failure handling is the part most gRPC comparisons skip, and it is where the two models diverge most sharply in production.

~~~mermaid
flowchart TB
    subgraph g["gRPC — connection-shaped"]
        direction LR
        GC[caller] -->|"HTTP/2, deadline travels with the call"| R["DNS / mesh picks an instance"]
        R --> GS["service instance"]
        GS -.->|"UNAVAILABLE / DEADLINE_EXCEEDED immediately, and the server is signalled"| GC
    end
    subgraph i["@imqueue — buffered"]
        direction LR
        IC[caller] -->|"request message"| IQ[("queue 'User'")]
        IQ --> IS["any free instance"]
        IS -->|"reply message"| IC
        IQ -.->|"no consumer: the message waits forever, unless callTimeout is set"| IQ
    end
~~~

gRPC tells the caller immediately that nobody is listening; `@imqueue` lets the
request wait until somebody is. The first makes retry policy possible, the second
makes boot order irrelevant — and neither is free.

**gRPC is connection-shaped.** A deadline is part of the call and propagates to the server; a cancelled or expired call signals the server so it can stop working. Status codes (`UNAVAILABLE`, `DEADLINE_EXCEEDED`, `RESOURCE_EXHAUSTED`) let a caller tell "the service is down" from "the service said no", which is what makes sensible retry policy possible. If nobody is listening, you find out immediately.

**Queue RPC is buffered, and that cuts both ways.** If the callee is down, the request waits in the queue instead of failing — services can even start in any order, because a caller's messages simply wait for a consumer to appear. That's a genuine operational nicety. But it changes three things you must design for:

- **Delivery is at-least-once, in both modes.** `@imqueue` may deliver the same message twice, so exposed methods should be idempotent. Safe delivery re-queues a message a dying worker never *started*; it does not protect work already in flight. [What guaranteed delivery really costs](/blog/guaranteed-message-delivery-cost/) goes through the mechanics.
- **`callTimeout` is unset by default.** With no timeout, a call to a service that never answers stays pending *forever*. Set it explicitly — the docs recommend it for production.
- **A timeout is not a cancellation.** `callTimeout` rejects the caller's promise with `IMQ_RPC_CALL_TIMEOUT`. There's no documented signal that reaches the service, which never saw a deadline and keeps working. gRPC's propagating deadlines have no equivalent here, and on long or expensive methods that difference is worth designing around.

There's a fourth asymmetry: nothing in the framework drains in-flight work on shutdown. A worker killed mid-handler loses that message either way. [Graceful shutdown and zero-drop deploys](/blog/graceful-shutdown-zero-drop-deploys/) shows what it actually takes to close that gap yourself.

## What you actually operate with gRPC vs with `@imqueue`

The operational surface is usually the deciding factor, so it is worth comparing honestly:

| | gRPC | Queue RPC |
|---|---|---|
| To route calls | DNS, service mesh, or client-side LB config | Nothing — the queue name is the address |
| To balance load | Mesh or client-side policy | Nothing — consumers compete |
| To survive a callee restart | Retry policy, circuit breaker | Nothing — messages wait |
| New infrastructure | Possibly a mesh and its control plane | Redis (3.2+; 6.2+ for safe delivery) |
| Build step | `.proto` codegen in every build | One client generation per contract change |

The queue column is shorter, which is the entire pitch — but "Redis" is not nothing. It's a stateful dependency in the request path for every internal call, and its availability becomes your RPC layer's availability.

## gRPC vs `@imqueue` performance, honestly

Protobuf over HTTP/2 is hard to beat on pure encoding cost, and a JSON-over-queue design isn't trying to. What `@imqueue` measures on one rig — 22 worker processes, ~1 KB messages, round-trip messages/second **summed across all workers** — is roughly 200,000/s with default delivery and about 120,000/s with safe delivery. Enabling gzip cost ~15% of throughput and cut payload size by about 70%.

Those are aggregate figures from a single run on one machine, not per-core numbers and not latency percentiles; [the benchmark post](/blog/benchmarking-imqueue-throughput/) states the rig and method. Treat them as a shape, measure your own workload, and note that for most internal services the bottleneck is the handler, not the transport.

## Where gRPC is the better choice

- **A polyglot fleet.** Not a contest. `@imqueue` is Node.js and TypeScript only.
- **You need streaming.** Queue RPC here is request/response over a broker; there's no streaming.
- **You need propagating deadlines and real cancellation** — long-running or expensive calls that must actually stop.
- **You want a contract independent of any implementation.** A `.proto` can be reviewed and versioned without reference to the code that serves it.
- **Extreme wire efficiency matters**, or you're already running a mesh and the addressing problem is solved.

## Where `@imqueue`'s queue RPC costs you

- **Redis only.** `vendor` defaults to `'Redis'` and is currently the only supported value, though `IMessageQueue` is the documented seam for another adapter.
- **JSDoc is mandatory.** Missing annotations degrade to `any`, `@param` count must match real arity, and consuming projects must compile with `removeComments: false`.
- **No rest or spread parameters** on exposed methods — pass an array.
- **Generation needs the service running**, which is a real step in CI and on a fresh checkout.
- **At-least-once**, no cancellation, no drain — as above.
- **A smaller ecosystem.** No mesh integrations, no interceptor catalogue, far fewer people who have hit your problem before.

## @imqueue vs gRPC at a glance

| | @imqueue (queue RPC) | gRPC |
|---|---|---|
| Contract | The service (TS + JSDoc) | `.proto` schema + codegen |
| Sources of truth | One | Two (schema + implementation) |
| Languages | Node.js / TypeScript | Many (polyglot) |
| Transport | Message queue (Redis) | HTTP/2 |
| Addressing | Queue name (no discovery) | Host + discovery/mesh |
| Load balancing | Competing consumers | Client-side / mesh |
| Callee down | Request waits in the queue | Call fails now |
| Delivery | At-least-once; idempotent handlers | Exactly one attempt per call |
| Deadlines | Client-side timeout only, no cancellation | Propagating deadline + cancellation |
| Streaming | Request/response | Full streaming |
| Wire format | JSON (optional gzip) | Protobuf (binary) |

## How to choose between gRPC and `@imqueue`

- **Choose gRPC** if your services span multiple languages, you need streaming or real cancellation, or you want an explicit schema contract and don't mind operating discovery and load balancing.
- **Choose queue-based RPC with @imqueue** if your back-end is Node.js/TypeScript, you'd rather not maintain a `.proto` or a service mesh, and you want typed clients generated straight from your services — accepting at-least-once delivery and Redis in the path.

## Frequently asked questions about gRPC and @imqueue

### Is @imqueue faster than gRPC?
Not on wire efficiency — Protobuf over HTTP/2 is hard to beat there. The published `@imqueue` numbers are aggregate round-trips on one rig, not a head-to-head. For most internal services the handler dominates either way.

### Can I use gRPC and @imqueue in the same system?
Yes, and it's a reasonable split: gRPC where you cross a language boundary, queue RPC between your Node services. Decide deliberately which owns a given call path so you don't operate two RPC layers over the same traffic.

### Does queue-based RPC replace a service mesh?
For addressing and balancing of these calls, largely yes — the queue name is the address and consumers self-balance. It doesn't replace a mesh's other jobs: mTLS, observability, traffic shaping, policy.

### What happens if the target service is down?
The request waits on its queue until a consumer appears, rather than failing immediately. Useful for restarts and ordering-independent boot, but it means "no answer yet" and "nothing will ever answer" look identical to the caller — which is exactly why you set `callTimeout`.

### Do I lose type safety without a .proto?
No, but the mechanism differs: types come from your TypeScript and JSDoc, and the client is generated from the running service, so mismatches surface as compile errors after a regenerate. You lose the language-neutral, implementation-independent artifact.

### Is at-least-once delivery a problem?
It's a design constraint, not a defect: make exposed methods idempotent. Most read methods already are; writes need a natural key or a dedupe check.

---

If the second description fits, [**Getting Started**](/get-started/) gets you to a working typed call quickly. For the transport model itself see [RPC over Redis in Node.js](/blog/rpc-over-redis-nodejs/), and for the framework comparisons rather than the transport one, [@imqueue vs NestJS](/blog/imqueue-vs-nestjs/) and [vs tRPC](/blog/imqueue-vs-trpc/). Shipping inside a closed-source product? See [commercial licensing & support](/license/).
