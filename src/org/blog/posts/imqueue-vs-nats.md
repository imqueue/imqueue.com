---
layout: post.html
permalink: /blog/imqueue-vs-nats/
templateEngineOverride: md
title: "@imqueue vs NATS: a framework and a transport are not the same choice"
summary: "NATS is a messaging system; @imqueue is an RPC framework that happens to use one. Comparing them means deciding how much of the contract you want to write yourself — and whether your fleet is Node-only."
description: "@imqueue vs NATS for service-to-service calls: subjects and queue groups vs a queue per service, hand-written contracts vs generated typed clients, and what each asks you to operate."
keywords: "imqueue vs nats, NATS alternative Node.js, NATS request reply, NATS JetStream, nats vs redis microservices, typed RPC Node.js, service to service communication Node.js"
date: 2026-08-03
author: andrii
illustration: compare-frameworks
topics: [comparison, transport, rpc, architecture, delivery]
ogType: article
---

**These are not the same kind of thing, and the honest comparison starts there.**
NATS is a messaging system — a server you run, with subjects, queue groups and
request-reply built in, and clients in roughly forty languages. `@imqueue` is an
RPC framework for Node.js and TypeScript that uses a message queue underneath.
Asking "NATS or @imqueue" is really asking two questions: *do I want the contract
between my services generated for me or written by me*, and *is my fleet Node-only*.

If your services are polyglot, NATS wins on that fact alone and the rest of this
post is background. If they are all Node and TypeScript, the interesting
difference is how much plumbing you end up owning.

(Details about NATS reflect its documented behaviour at the time of writing;
check [nats.io](https://nats.io/) for the current state.)

## What each one actually gives you

NATS gives you a transport with excellent primitives. Publish to a subject,
subscribe with wildcards, and `request()`/`reply()` for request-response. Put
several subscribers in the same **queue group** and the server delivers each
message to exactly one of them — competing consumers, which is load balancing
without a load balancer. Core NATS is fire-and-forget: if nobody is listening, the
message is gone. **JetStream** is the persistence layer on top, and that is where
you go for at-least-once delivery, replay, and streams that outlive their
consumers.

What NATS does not give you is a contract. You decide the subject naming scheme,
the payload encoding, how errors travel back, what a timeout means, and how the
caller knows the shape of the reply. Those are all real decisions and NATS is
deliberately unopinionated about every one of them.

`@imqueue` starts at the other end. A service is a class; methods marked
`@expose()` are callable remotely; the service describes its own signatures at
runtime, and the CLI generates a typed client from a *running* service. There is
no subject scheme to design because the queue name is the service name, and no
payload format to choose because it is JSON. You get less transport flexibility
and a contract you did not have to write.

## The same call, both ways

With NATS you own both halves. A minimal request-reply service:

~~~typescript
import { connect, JSONCodec } from 'nats';

const nc = await connect({ servers: 'nats://localhost:4222' });
const jc = JSONCodec();

// "user.get" is a naming convention you invented and now have to maintain.
const sub = nc.subscribe('user.get', { queue: 'user-service' });

for await (const msg of sub) {
    const { id } = jc.decode(msg.data) as { id: string };

    msg.respond(jc.encode({ id, name: 'Jane Doe' }));
}
~~~

and the caller:

~~~typescript
const reply = await nc.request('user.get', jc.encode({ id: '42' }), { timeout: 2000 });
// `user` is whatever you assert it is. Nothing checked it.
const user = jc.decode(reply.data) as { id: string; name: string };
~~~

Note what the `as` is doing: it is a promise you are making to the compiler about
data that arrived over a network. If the service changes `name` to `fullName`,
this code compiles and fails at runtime.

The `@imqueue` equivalent is the service alone:

~~~typescript
import { IMQService, expose } from '@imqueue/rpc';
import { UserObject } from './types/UserObject.js';

export class UserService extends IMQService {
    /**
     * Returns a user by identifier
     *
     * @param {string} id - user identifier
     * @return {Promise<UserObject | null>} - the matching user
     */
    @expose()
    public async get(id: string): Promise<UserObject | null> {
        return this.users.find(user => user.id === id) || null;
    }
}
~~~

The caller is generated:

~~~bash
imq client generate UserService ./src/clients
~~~

~~~typescript
import { UserClient } from './clients/UserService.js';

const client = new UserClient();

await client.start();
const user = await client.get('42');  // UserObject | null, checked at compile time
~~~

Rename `name` to `fullName` in the service, regenerate, and the call site fails to
compile. That is the difference the whole comparison turns on — not throughput.

## Delivery semantics, precisely

This is the part where a loose comparison does real damage, so:

- **Core NATS is at-most-once.** No subscriber, no message. That is a feature for
  telemetry and a hazard for a call you needed to happen.
- **NATS JetStream is at-least-once** by default, with message deduplication
  windows and per-consumer acknowledgement, and it is the layer you would compare
  with a queue rather than core NATS.
- **`@imqueue` is at-least-once.** A request waits on its queue until a consumer
  appears rather than failing immediately — which is genuinely useful across
  restarts, and which also means "no answer yet" and "nothing will ever answer"
  look identical to the caller. That is what `callTimeout` is for.

At-least-once anywhere means the same thing for your code: **exposed methods should
be idempotent.** Most reads already are; writes need a natural key or a dedupe
check.

## What you operate

NATS is a single Go binary with clustering, superclusters and leaf nodes, and it
is genuinely good at being run. JetStream adds storage to manage — file or memory,
with replicas — so the operational picture grows when you enable it.

`@imqueue` needs Redis, which most Node fleets already run for something else.
That is the whole infrastructure requirement, and it is a deliberate ceiling:
`vendor` defaults to `'Redis'` and is currently the only supported value, with
`IMessageQueue` as the documented seam for another adapter. If you already run
NATS and would rather not add Redis, that is a real argument and `@imqueue` does
not have an answer for it today.

For scaling Redis itself rather than adding a second bus, see
[the horizontally scalable broker recipes](/blog/horizontally-scalable-redis-broker/).

## Where NATS is the better choice

- **Polyglot fleets.** Node, Go, Rust, Python and Java services on one bus.
  `@imqueue` is Node.js and TypeScript only, and no amount of framework quality
  changes that.
- **You need streaming, replay or fan-out.** JetStream retains messages and lets
  consumers replay from a position. `@imqueue` is a call-and-reply framework, not
  a log.
- **Very high message rates with small payloads**, where a purpose-built
  messaging server's numbers matter to you and you are prepared to own the
  contract layer yourself.
- **A permissive licence is required.** NATS is Apache-2.0. `@imqueue` is GPL-3.0
  with a [commercial licence](https://imqueue.com/license/) for shipping inside
  closed-source products — which is a non-issue for internal services and a real
  decision if you distribute software.
- **You already run NATS.** Adding a second transport to get typed clients is
  rarely worth it. Generate types from your own contracts instead.

## Where @imqueue's model costs you

- **Redis only, today.** One transport, no pluggable adapters shipped.
- **Node.js and TypeScript only.** A polyglot fleet is out of scope.
- **No streaming, no replay, no retention.** Different problem, different tool.
- **Client generation needs the service running.** It works by asking the live
  service to describe itself, which is what removes the IDL — and it means client
  generation is a step in your dev loop rather than a build-time artefact from a
  file.
- **The queue-name-is-the-address model is less flexible** than subject wildcards.
  There is no `user.*` to subscribe to.

## Quick comparison

| | @imqueue | NATS (core) | NATS JetStream |
|---|---|---|---|
| Kind of thing | RPC framework | Messaging system | Persistence layer on NATS |
| Languages | Node.js / TypeScript only | ~40 client languages | ~40 client languages |
| Infrastructure | Redis | NATS server (Go binary) | NATS server + storage |
| Addressing | Queue name = service class | Subjects, with wildcards | Subjects + streams |
| Load balancing | Competing consumers on a queue | Queue groups | Consumer groups |
| Service discovery | Not needed | Not needed | Not needed |
| Contract | Generated from the running service | You design it | You design it |
| Payload | JSON, handled for you | You choose and encode | You choose and encode |
| Typed call sites | Yes, generated | Hand-written or codegen you add | Hand-written or codegen you add |
| Contract drift caught | Compile errors after regenerating | At runtime | At runtime |
| Delivery | At-least-once | At-most-once | At-least-once |
| Replay / retention | No | No | Yes |
| Licence | GPL-3.0 / commercial | Apache-2.0 | Apache-2.0 |

## How to choose

- **Choose NATS** if your fleet is or will be polyglot, if you need streaming and
  replay, if you already run it, or if a permissive licence is a requirement — and
  accept that the contract between services is yours to design and keep correct.
- **Choose @imqueue** if your services are Node.js and TypeScript, you want the
  typed client generated rather than written, and you would rather run Redis than
  design a subject scheme, an encoding and an error convention.

They are not competitors so much as different amounts of decision-making. NATS
hands you excellent primitives and trusts you; `@imqueue` hands you a contract and
constrains you.

## FAQ

### Is NATS a replacement for @imqueue?
Not directly — NATS is a transport and `@imqueue` is a framework over one. The
comparable pairing is "NATS plus whatever RPC conventions you write" against
"`@imqueue` on Redis". If you only need messaging primitives, NATS alone is the
smaller answer.

### Can @imqueue use NATS as its transport?
Not today. `vendor` defaults to `'Redis'` and is currently the only supported
value. `IMessageQueue` is the documented interface an adapter would implement, so
it is a seam rather than a wall, but no NATS adapter ships.

### Does NATS give me typed clients?
No. NATS delivers bytes; the types on either side are yours to declare and keep in
step, usually with a shared package, protobuf, or a schema registry you run. That
is the work `@imqueue` removes by generating the client from the live service.

### Is NATS faster than @imqueue?
For raw message throughput on small payloads, a purpose-built Go messaging server
is the safer bet, and no head-to-head benchmark on one rig would settle it
honestly. For most internal services the handler dominates either way — the
database call is the cost, not the hop.

### Which has better delivery guarantees?
JetStream and `@imqueue` are both at-least-once, so neither lets you skip
idempotency. Core NATS is at-most-once and is the odd one out: it will drop a
message rather than wait for a consumer.

### Can I use both in the same system?
Yes, and it is a reasonable split: NATS for events, streams and anything crossing
a language boundary; `@imqueue` for typed calls between your Node services. Decide
deliberately which owns a given call path, so you are not operating two RPC layers
over the same traffic.

---

Comparing more than one option? The [comparison matrix](/compare/) puts every
alternative we have written up side by side. For the transport model itself see
[RPC over Redis in Node.js](/blog/rpc-over-redis-nodejs/), and for the
framework-level comparisons rather than the transport one,
[@imqueue vs NestJS](/blog/imqueue-vs-nestjs/) and
[vs Moleculer](/blog/imqueue-vs-moleculer/). Ready to try it?
[Get started](/get-started/).
