---
layout: post.html
permalink: /blog/nodejs-service-communication-options-2026/
templateEngineOverride: md
title: "How Node.js services talk to each other in 2026: the honest options"
summary: "REST, gRPC, tRPC, NATS, a framework like NestJS or Moleculer, or RPC over a message queue. Six real approaches, what each one costs, and the two questions that actually decide it — including when @imqueue is the wrong answer."
description: "A neutral survey of service-to-service communication for Node.js and TypeScript back-ends in 2026: REST, gRPC, tRPC, NATS, full frameworks and message-queue RPC, with the trade-offs of each."
keywords: "Node.js service communication, nodejs microservices communication, microservices communication 2026, REST vs gRPC vs tRPC, gRPC vs REST, gRPC vs REST vs GraphQL, tRPC vs gRPC, how microservices communicate with each other, service to service Node.js, internal API design, message queue RPC, TypeScript microservices architecture"
date: 2026-08-03
author: mykhailo-stadnyk
illustration: rest-vs-rpc
topics: [architecture, comparison, rpc, transport, types]
ogType: article
---

**There are six approaches in real use, none of them wrong, and the choice is
decided by two questions rather than by a feature table.** Is your fleet
Node-and-TypeScript-only or polyglot? And do you want the contract between
services generated, declared, or negotiated by convention? Everything else —
throughput, tooling, how fashionable something is — moves the answer far less than
those two.

This is written by the maintainers of one of the six, so read the section about it
sceptically. We have tried to make it the section that is hardest on itself.

## The six

### 1. REST over HTTP

The default, and the one nobody has to justify. Every language speaks it, every
proxy understands it, every tool can call it, and a new engineer needs no
onboarding.

The cost is that HTTP is a document-transfer protocol being used as a function
call. You hand-write a client or generate one from OpenAPI you also hand-write;
you invent conventions for errors, pagination and partial responses; and the type
safety between two TypeScript services is whatever you took the trouble to
arrange. For *internal* calls you are also paying for a load balancer, service
discovery or DNS-based addressing, and a retry policy — infrastructure whose only
job is to find the other service.

**Right when:** your consumers are outside your control, or the fleet is polyglot
and you want the lowest-friction thing that works everywhere.

We have written up [why internal APIs do not need
REST](/blog/internal-apis-dont-need-rest/), which is the argument against it in
this specific setting — not against REST at the edge, where it is usually correct.

### 2. gRPC

The serious answer for cross-language RPC. Protobuf over HTTP/2, a written schema
that is language-neutral and independent of any implementation, generated clients
and servers in every language that matters, streaming, deadlines, and a
well-understood operational story.

The cost is the `.proto` file and everything around it: a build step, a schema
repository, versioning discipline, and a code-generation pipeline in CI. For a
fleet that is entirely TypeScript, you are maintaining a second type system
alongside the one the compiler already has.

**Right when:** you cross a language boundary, or you need the schema to be an
artefact that outlives any one implementation.

See [gRPC vs message-queue RPC](/blog/grpc-vs-message-queue-rpc/) for the detailed
comparison, including where gRPC is straightforwardly better.

### 3. tRPC

The best answer to a *different* question. tRPC gives end-to-end type safety with
no code generation at all — the client's types are inferred from the server's
router through the TypeScript compiler. For a front-end talking to its own
back-end in one repository, it is close to ideal.

The cost is that the mechanism is compile-time type inference across a shared
codebase, so it wants a monorepo and a build relationship between caller and
callee. That is a natural fit for a web app and its API, and an awkward one for
services deployed independently on their own release cycles.

**Right when:** a TypeScript front-end calls a TypeScript back-end you build
together.

[@imqueue vs tRPC](/blog/imqueue-vs-trpc/) goes further into where the boundary
sits.

### 4. NATS (or another message bus, directly)

Excellent primitives, honestly presented: subjects with wildcards, queue groups
that give you competing consumers, request-reply built in, clients in about forty
languages, and JetStream when you need persistence and replay. Kafka, RabbitMQ and
Redis Streams occupy nearby ground with different trade-offs.

The cost is that a transport is not a contract. You design the subject naming
scheme, the payload encoding, the error convention, what a timeout means, and how
a caller learns the shape of a reply. Those are all decisions you will make either
deliberately now or accidentally over eighteen months.

**Right when:** the fleet is polyglot, you need streaming or fan-out, or you
already run it.

[@imqueue vs NATS](/blog/imqueue-vs-nats/) has the detail.

### 5. A full framework — NestJS, Moleculer

Buy the whole platform. NestJS brings dependency injection, modules, a mature
ecosystem and transport adapters; Moleculer brings a service broker with pluggable
transporters, a built-in registry, load-balancing strategies, circuit breakers and
an API gateway. Both are actively maintained and both are more capable, in raw
feature count, than anything else on this list.

The cost is surface area: more to learn, more to configure, more opinions to work
within, and — in both cases — type safety between services that you assemble
yourself rather than get for free.

**Right when:** you want breadth and built-in resilience features, and you are
comfortable owning the typing story.

[vs NestJS](/blog/imqueue-vs-nestjs/) · [vs Moleculer](/blog/imqueue-vs-moleculer/)

### 6. RPC over a message queue — what @imqueue does

A service is a class. Methods marked `@expose()` are callable remotely. The
service describes its own signatures at runtime, so a typed client is *generated
from the running service* — no schema file, no IDL, no hand-written SDK. The queue
name is the address, so instances of a service compete for messages on it, which
removes service discovery and the internal load balancer from the request path.

The honest costs, in order of how often they matter:

- **Node.js and TypeScript only.** A polyglot fleet rules this out immediately, and
  nothing about the framework's quality changes that.
- **Redis only, today.** `vendor` defaults to `'Redis'` and is currently the only
  supported value. `IMessageQueue` is the documented seam for another adapter, but
  none ships.
- **At-least-once delivery**, so exposed methods need to be idempotent. Reads
  usually already are; writes need a natural key or a dedupe check.
- **A down service means a waiting call, not a failing one.** Useful across
  restarts; it also means "no answer yet" and "nothing will ever answer" look
  identical to the caller, which is what `callTimeout` exists for.
- **Client generation needs the service running.** That is the mechanism that
  removes the IDL, and it makes generation a step in the dev loop rather than a
  build artefact from a file in git.
- **GPL-3.0**, with a [commercial licence](https://imqueue.com/license/) for
  shipping inside closed-source products. A non-issue for internal services; a
  real decision if you distribute software.
- **No streaming, no replay, no retention.** It is a call-and-reply framework, not
  a log.

**Right when:** your services are all Node and TypeScript, they call each other a
lot, and you would rather run Redis than design and maintain a contract layer.

## Not on the list: GraphQL, Kafka, WebSockets

Three things get named in this comparison constantly and are missing above,
because they answer a different question.

**GraphQL** is a query language for a *client-facing* API. Its whole value is
letting a front-end ask for the shape it wants across several resources — which is
a problem your browser has and your services do not. Put it at the edge, in front
of the fleet, and let the gateway make ordinary typed calls behind it: that is
exactly what the [GraphQL gateway chapter](/tutorial/api-service/) builds. Using
GraphQL *between* services means writing resolvers, a schema and a loader layer to
replace a function call, and it is where the
[N+1 problem](/api/graphql-dependency/latest/) comes from. So "gRPC vs REST vs
GraphQL" is really two comparisons: gRPC against REST for internal calls, and
GraphQL against REST for the edge.

**Kafka** is a partitioned, replayable log rather than a transport for
request/reply. It is the right answer for event streams, audit trails and anything
you want to re-read later, and the wrong one for "call this service and give me
the result" — there is no reply channel and no per-message acknowledgement. Plenty
of fleets run both.

**WebSockets** and SSE are for pushing to a browser. They are a delivery mechanism
at the edge, not a service contract; behind the gateway you still need one of the
six.

## The two questions

Everything above collapses into this:

**Is the fleet polyglot?** If yes — now or credibly within a year — you are
choosing between gRPC, NATS and REST, and the rest of the list is out. This is the
question that eliminates most options, and it is the one teams most often answer
optimistically.

**Where does the contract come from?** Three real answers:

| Contract source | Approaches | What it costs you |
|---|---|---|
| **Declared** in a schema you write | gRPC, OpenAPI-first REST | A build step, a schema repo, versioning discipline — and a second type system if you are all TypeScript |
| **Inferred** by the compiler | tRPC | A build relationship between caller and callee, which in practice means a monorepo |
| **Generated** from the implementation | @imqueue | The generator has to reach a running service, and you are tied to its language |
| **By convention** — none of the above | REST without a schema, raw NATS, most framework setups | Nothing up front, and drift caught at runtime, in production, by a caller |

That last row is where most systems actually are. It is not a mistake; it is a
default, and it is worth choosing on purpose rather than arriving at.

## Side by side

| | Languages | Contract | Infra in the call path | Delivery | Licence |
|---|---|---|---|---|---|
| REST | Any | Convention or OpenAPI | LB / discovery / DNS | At-most-once per attempt | n/a |
| gRPC | Any | Declared (`.proto`) | LB or mesh | At-most-once per attempt | Apache-2.0 |
| tRPC | TS only | Inferred | HTTP server | At-most-once per attempt | MIT |
| NATS | ~40 | Yours to design | NATS server | At-most-once (core) | Apache-2.0 |
| NestJS / Moleculer | JS/TS | Yours to assemble | Depends on transport | Depends on transport | MIT |
| @imqueue | Node/TS only | Generated | Redis | At-least-once | GPL-3.0 / commercial |

The full matrix, with every row linked to a detailed comparison, is at
[/compare/](/compare/).

## What we would actually tell you to pick

If you are polyglot, use gRPC for calls and NATS for events, and stop reading
framework comparisons.

If you are all TypeScript and the pain you feel is *writing and re-writing
clients*, that is the specific problem generated-from-the-service RPC solves, and
it is worth thirty minutes of [Get started](/get-started/) to see whether the model
fits.

If the pain you feel is anything else — deployment, observability, database
coupling, an unclear service boundary — none of the six will fix it, and choosing
between them is a way of not working on it. [Splitting a monolith along the right
seam](/blog/monolith-to-services-first-extraction/) is usually the higher-value
work.

## Frequently asked questions about Node.js service-to-service communication

### What is the best way for Node.js microservices to communicate in 2026?
There is no single best. For a polyglot fleet, gRPC for calls and a message bus
for events is the safe default. For an all-TypeScript fleet, RPC over a message
queue with generated clients removes the most code. For a front-end calling its
own back-end, tRPC. The polyglot question decides more than any other.

### Is REST still fine for internal service calls?
Yes — it is never the wrong answer, only sometimes the expensive one. The cost is
hand-written clients, invented conventions, weak typing between two services that
could have had strong typing, and the load balancer and discovery layer that exist
only to find the other service.

### Do I need gRPC if all my services are TypeScript?
Usually not. gRPC's central advantage is a language-neutral schema, and if there
is no language boundary you are maintaining a second type system beside the one
the compiler already gives you. It is still the right call if the schema needs to
outlive the implementation.

### Can I use tRPC between back-end services?
You can, and it works, but the mechanism is compile-time type inference across a
shared codebase — so it pulls toward a monorepo and a build relationship between
caller and callee. Independently deployed services on separate release cycles fit
it badly.

### When is @imqueue the wrong choice?
When your fleet is not entirely Node.js and TypeScript; when you cannot run Redis
or already run a different bus and do not want a second; when you need streaming,
replay or retention; or when GPL-3.0 does not work for you and a commercial
licence is not on the table. Those are disqualifying, not inconvenient.

### Does at-least-once delivery mean duplicate work?
It means duplicates are possible, so exposed methods should be idempotent. Most
read methods already are. Writes need a natural key or a dedupe check — which is
work, and it is the honest price of not losing calls when a consumer restarts.

---

Each option above has its own detailed comparison; [/compare/](/compare/) is the
index. If you have decided the generated-client model fits, [Get
started](/get-started/) is about five minutes to a typed remote call.
