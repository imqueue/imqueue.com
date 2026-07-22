---
layout: post.html
permalink: /blog/rpc-over-redis-nodejs/
templateEngineOverride: md
title: "RPC over Redis in Node.js: patterns, pitfalls, and a typed implementation"
summary: "How request/reply RPC over Redis actually works in Node.js — the correlation, timeout and delivery problems you have to solve yourself, why the old npm packages stalled, and how @imqueue turns it into typed, boilerplate-free calls."
description: "A practical guide to doing RPC over Redis in Node.js & TypeScript: the request/reply pattern, its real pitfalls (correlation, timeouts, at-least-once delivery, backpressure), and a maintained, fully-typed implementation with @imqueue."
keywords: "RPC over Redis, redis rpc, redis rpc node.js, typed rpc redis, node.js redis rpc, request reply redis, redis pub/sub rpc, imqueue"
date: 2026-07-23
author: serhiy-morenko
illustration: redis-rpc
topics: [rpc, queue, transport, patterns]
ogType: article
---

**RPC over Redis** means making one service call a method on another by sending
the request through Redis and getting the reply back the same way — instead of
opening an HTTP connection or a gRPC channel between them. Redis is already in
most Node.js stacks, it's fast, and using it as the transport removes a surprising
amount of moving parts: no per-service HTTP server to expose, no load balancer in
front, no service registry to look anybody up. This post explains how the pattern
works, the problems you have to solve to make it production-grade, and how
[`@imqueue`](/get-started/) implements all of that with fully-typed clients.

> **TL;DR** — RPC over Redis is request/reply messaging: the caller drops a request
> on the callee's Redis-backed queue and waits for a correlated response on its own.
> It's simpler to operate than HTTP-between-services, but you have to handle
> correlation, timeouts, at-least-once delivery, serialization and backpressure
> yourself. The maintained, typed way to get it in Node.js/TypeScript is
> `@imqueue/rpc`, which generates the client for you from the running service.

## The pattern, concretely

At its core the pattern is four steps:

1. The **caller** serializes a request — target method, arguments, a unique
   correlation ID, and the name of the queue it wants the answer on — and pushes it
   onto the **callee's** queue in Redis.
2. The **callee** is blocked waiting on that queue. It pops the request, runs the
   method, and pushes the result onto the **reply queue** named in the request.
3. The caller, blocked on its own reply queue, receives the message, matches the
   correlation ID to the pending call, and resolves the promise.
4. Both sides go back to waiting.

Redis gives you the two primitives this needs: a place to put messages
(lists consumed with a blocking `BRPOP`, or streams) and low latency. There's no
direct connection between the two services at all — Redis is the rendezvous point,
which is exactly why you stop needing service discovery and a load balancer. Add a
second instance of the callee and it simply reads from the same queue; Redis
distributes the work.

## The pitfalls (what "just use Redis" leaves out)

The four-step sketch is easy to prototype and deceptively hard to make reliable.
Every one of these is a problem you own the moment you hand-roll it:

- **Correlation.** Many calls are in flight at once over one reply queue. Every
  request needs a unique ID and the caller needs a map of ID → pending promise, or
  responses get delivered to the wrong caller.
- **Timeouts.** If the callee is down or throws before replying, the response never
  comes. Without a per-call timeout the caller's promise hangs forever and the
  pending-call map leaks memory.
- **Delivery semantics.** A reliable queue gives you *at-least-once* delivery — a
  message can be redelivered after a crash. That means your handlers should be
  idempotent, and "exactly once" is something you engineer, not something Redis
  hands you.
- **Serialization.** `JSON.stringify` silently drops `Date`, `Map`, `Set`,
  `BigInt`, `undefined` and typed arrays. Round-tripping rich objects needs a real
  serializer, or subtle data corruption creeps in.
- **Backpressure.** If callers produce faster than callees consume, the queue grows
  without bound and latency climbs. You need to watch queue depth and push back.
- **Redis itself.** Redis becomes shared infrastructure on the hot path. In
  production that means clustering/failover, not a single node — the transport is
  only as available as the Redis behind it.
- **Types.** Nothing above says anything about *types*. A raw Redis message is an
  opaque blob; the caller has no idea what shape the arguments or the result should
  be. This is where hand-rolled RPC hurts most over time.

## Why the existing packages stalled

Search npm for "redis rpc" and you'll find a scatter of small libraries —
`node-redis-rpc`, `redis-rpc`, `rpc-redis` — most last published five to ten years
ago, none TypeScript-first, and none solving the typing problem. They prove the
pattern is sound and useful, but they were built for a callback-era Node.js and
stopped being maintained. If you adopt one today you inherit the correlation and
timeout machinery but still hand-write an untyped client for every service, and
you're on your own for the rest of the list above.

## Doing it typed: @imqueue

[`@imqueue`](/get-started/) is a maintained implementation of this exact pattern,
built for TypeScript. Two pieces do the work:

- [`@imqueue/core`](/api/core/latest/) is the reliable message queue over Redis
  (`ClusteredRedisQueue`) — it owns delivery, blocking reads, reconnection and the
  serialization that plain JSON gets wrong.
- [`@imqueue/rpc`](/api/rpc/latest/) is the RPC layer on top. You write a service as
  a class and mark the callable methods with `@expose()`:

~~~typescript
import { IMQService, expose } from '@imqueue/rpc';

class UserService extends IMQService {
    /**
     * Returns a user by id.
     *
     * @param {string} id
     * @return {Promise<User>}
     */
    @expose()
    public async get(id: string): Promise<User> {
        return this.db.users.find(id);
    }
}
~~~

The service is **self-describing**: it publishes its method signatures (JSDoc is the
type source), so the caller doesn't need a hand-written client. You generate the
real one from the running service:

~~~bash
imq client generate UserService
~~~

and call it like a local, fully-typed object — the correlation, reply routing and
timeouts are handled for you:

~~~typescript
const users = new UserServiceClient();
await users.start();

const user = await users.get('42'); // typed: User, no client boilerplate
~~~

Because the client is generated from the live service rather than hand-maintained,
the types can't drift out of sync with the implementation — the failure mode that
makes hand-rolled RPC rot. Everything on the pitfalls list (correlation, timeouts,
at-least-once delivery, serialization, backpressure handling) lives in the library,
not in your service code.

## When this is the right call — and when it isn't

RPC over Redis is a good fit when your services already share a Redis, when you want
internal calls without standing up and load-balancing HTTP endpoints, and when
strong typing across service boundaries matters. It is **not** a workflow engine:
if you need durable, resumable, long-running orchestration with history and
compensation, a system like Temporal is a different tool. And it does add Redis to
your critical path — worth it when Redis is already there, a cost to weigh when it
isn't.

If that fit sounds right, the [getting-started guide](/get-started/) has a working
two-service example running in a couple of minutes, and the
[throughput benchmark](/blog/benchmarking-imqueue-throughput/) covers the numbers
and a reproducible harness.
