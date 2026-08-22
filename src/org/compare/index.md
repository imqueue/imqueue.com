---
layout: docs.html
section: docs
title: "@imqueue compared: every alternative, side by side"
docLabel: COMPARISONS
lead: "One matrix covering every alternative we have written up — gRPC, tRPC, NestJS, Moleculer, NATS, BullMQ and plain REST — with the disqualifying constraints stated first and a link to the detailed comparison for each."
description: "@imqueue compared with gRPC, tRPC, NestJS, Moleculer, NATS, BullMQ and REST: one matrix of languages, contracts, infrastructure, delivery guarantees and licences."
keywords: "when not to use imqueue, imqueue disqualifiers, should I use imqueue, imqueue limitations, imqueue alternatives, imqueue vs, Node.js RPC comparison, microservices framework comparison, gRPC vs tRPC vs NATS, TypeScript RPC alternatives, message queue RPC comparison"
relatedTopics: [comparison, architecture, rpc, transport]
---

[[toc]]

## Start with what disqualifies @imqueue

Feature tables are the least useful part of a comparison, because the decision is
usually made by a constraint rather than by a score. These rule `@imqueue` out
outright, so they belong first:

- **Your fleet is not all Node.js and TypeScript.** There are no clients in other
  languages, and there is no plan to add them. Use gRPC or NATS.
- **You cannot run Redis, or you already run a different bus and will not add a
  second.** `vendor` defaults to `'Redis'` and is currently the only supported
  value. `IMessageQueue` is the documented seam for another adapter; none ships.
- **You need streaming, replay or message retention.** This is a call-and-reply
  framework, not a log. NATS JetStream or Kafka.
- **GPL-3.0 does not work for you and a commercial licence is not an option.** See
  [licensing](https://imqueue.com/license/) — a non-issue for internal services and
  SaaS, since it is not AGPL and running a service is not distribution; a real
  decision if you ship closed-source software to other people.
- **Your work is job-shaped, not call-shaped.** Background jobs with no caller
  waiting for a reply — retries, backoff, scheduled runs, a dashboard to watch them
  — is what a job queue is for. Use [BullMQ](/blog/imqueue-vs-bullmq/), which is
  usually the better pick there, or `@imqueue/job` if you already run this stack.
- **You want end-to-end types from a browser to a backend.** `@imqueue` is
  service-to-service: a browser cannot join a Redis queue, and there is no HTTP
  edge in the box. Use [tRPC](/blog/imqueue-vs-trpc/) for that hop and, if you want
  both, terminate HTTP at a gateway service that calls @imqueue behind it.

If none of those apply, the rest of this page is about fit rather than
possibility.

## The matrix

| | Kind | Languages | Contract comes from | Infra in the call path | Delivery | Licence | Detail |
|---|---|---|---|---|---|---|---|
| **@imqueue** | RPC framework | Node.js / TS only | **Generated** from the running service | Redis | At-least-once | GPL-3.0 / commercial | — |
| **gRPC** | RPC framework | Any (~11 official) | **Declared** in a `.proto` | Load balancer or mesh | At-most-once per attempt | Apache-2.0 | [detail](/blog/grpc-vs-message-queue-rpc/) |
| **tRPC** | Type-safe RPC | TypeScript only | **Inferred** by the compiler | HTTP server | At-most-once per attempt | MIT | [detail](/blog/imqueue-vs-trpc/) |
| **NestJS** | Full framework | JS / TS | Yours to assemble | Depends on transport | Depends on transport | MIT | [detail](/blog/imqueue-vs-nestjs/) |
| **Moleculer** | Full framework | JS-first | Yours to assemble | Broker + registry | Depends on transporter | MIT | [detail](/blog/imqueue-vs-moleculer/) |
| **NATS** (core) | Messaging system | ~40 | Yours to design | NATS server | **At-most-once** | Apache-2.0 | [detail](/blog/imqueue-vs-nats/) |
| **NATS JetStream** | Persistence on NATS | ~40 | Yours to design | NATS server + storage | At-least-once | Apache-2.0 | [detail](/blog/imqueue-vs-nats/) |
| **BullMQ** | Job queue | Node.js | Yours to design | Redis | At-least-once | MIT | [detail](/blog/imqueue-vs-bullmq/) |
| **REST** over HTTP | Convention | Any | Convention, or OpenAPI you write | LB / discovery / DNS | At-most-once per attempt | n/a | [detail](/blog/internal-apis-dont-need-rest/) |

Two columns carry most of the weight.

**Languages** eliminates more options than anything else, and it is the question
teams answer optimistically. "We might add a Go service" is a real constraint if it
is true and an excuse if it is not.

**Contract comes from** is the axis this framework is actually built on. Four
answers exist: declared in a schema you write, inferred by the compiler across a
shared build, generated from a running implementation, or established by convention
and discovered when it breaks. That last one is where most systems are — not as a
mistake, but as a default worth choosing deliberately.

## Not the same category

Three rows above are frequently compared with `@imqueue` and should not be, or at
least not directly:

- **NATS and Kafka are transports.** `@imqueue` is a framework that uses one. The
  fair pairing is "NATS plus the RPC conventions you write" against "`@imqueue` on
  Redis" — comparing a transport with a framework flatters whichever one you
  already prefer.
- **BullMQ is a job queue.** Jobs and RPC calls are different shapes: a job is
  fire-and-forget work with a lifecycle you inspect, a call is a request waiting
  for a typed answer. `@imqueue/job` exists for the job-shaped half; BullMQ is more
  capable there and is usually the better pick unless you are already on
  `@imqueue`. See [BullMQ alternatives](/blog/bullmq-alternatives/).
- **tRPC solves the front-end-to-back-end problem.** It is close to ideal at it.
  Comparing it on service-to-service ground is comparing it at the thing it was
  not built for.

## Where each one is genuinely better

Stated as flatly as we can manage:

- **gRPC** — anywhere a language boundary is crossed, and anywhere the schema has
  to be an artefact that outlives every implementation of it.
- **tRPC** — a TypeScript front-end calling a TypeScript back-end built alongside
  it. No code generation at all.
- **NestJS** — you want a platform: DI, modules, a large ecosystem, conventions a
  new hire will already know.
- **Moleculer** — you want breadth in one dependency: pluggable transporters, a
  registry, balancing strategies, circuit breakers, a gateway.
- **NATS** — polyglot fleets, event-driven designs, streaming and replay, very high
  message rates, a permissive licence.
- **BullMQ** — background jobs, scheduling, retries with a visible lifecycle. The
  most capable option in that category.
- **REST** — consumers outside your control, and the lowest-friction thing that
  works absolutely everywhere.

## Where @imqueue is the better choice

One case, narrowly: **an all-TypeScript back-end whose services call each other a
lot, where the recurring cost is writing and re-writing the client for every
service.** That is the cost the generated-from-the-implementation model removes,
and the reason there is no schema file, no IDL, no service registry and no internal
load balancer in the request path.

If the pain you actually feel is deployment, observability, database coupling or an
unclear service boundary, none of the options on this page will fix it, and
choosing between them is a way of not working on it.

## Reading order

- [How Node.js services talk to each other in 2026](/blog/nodejs-service-communication-options-2026/)
  — the neutral survey of all six approaches, if you have not chosen yet.
- [Why internal APIs do not need REST](/blog/internal-apis-dont-need-rest/) — the
  argument for RPC over HTTP internally, before any framework is involved.
- [RPC over a message queue](/blog/rpc-over-message-queue-nodejs/) — the transport
  model itself.
- [Get started](/get-started/) — a working typed remote call, with the code.

## FAQ

### When should I not use @imqueue?
Six constraints rule it out outright, and they are worth checking before any
feature comparison: your fleet is not all Node.js and TypeScript; you cannot run
Redis, or will not add a second bus; you need streaming, replay or message
retention; your work is job-shaped rather than call-shaped, with no caller waiting
for a reply; you want end-to-end types from a browser, which is a different hop
entirely; or GPL-3.0 does not work for you and a commercial licence is not an
option. If none of those apply, the rest is a question of fit rather than
possibility.

### What are the alternatives to @imqueue?
For typed service-to-service RPC: gRPC (any language, schema-first), tRPC
(TypeScript, monorepo-shaped), and full frameworks such as NestJS and Moleculer.
For the transport underneath: NATS, Kafka, RabbitMQ or Redis directly. For
background jobs rather than calls: BullMQ, pg-boss or `@imqueue/job`.

### Is @imqueue a replacement for gRPC?
Only inside an all-Node.js fleet. gRPC's central advantage is a language-neutral
schema, and if you cross a language boundary that advantage is decisive. Where
every service is TypeScript, a `.proto` is a second type system beside the one the
compiler already provides.

### Which option needs the least infrastructure?
`@imqueue` needs Redis and nothing else — no service registry, no internal load
balancer, no sidecar — because the queue name is the address and instances compete
for messages on it. REST needs the fewest new components only if you already run a
load balancer and DNS-based addressing, which is the part usually left out of the
comparison.

### Can I use @imqueue alongside gRPC or NATS?
Yes, and it is a reasonable split: gRPC or NATS where you cross a language
boundary, `@imqueue` between your Node services. Decide deliberately which owns a
given call path, so you are not operating two RPC layers over the same traffic.

### Does @imqueue work with Kafka or RabbitMQ?
Not today. `vendor` defaults to `'Redis'` and is currently the only supported
value, with `IMessageQueue` as the documented interface an adapter would implement.
If you are committed to Kafka or RabbitMQ, use a framework whose transport is
pluggable.
