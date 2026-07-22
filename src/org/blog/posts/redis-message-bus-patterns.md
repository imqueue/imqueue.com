---
layout: post.html
permalink: /blog/redis-message-bus-patterns/
templateEngineOverride: md
title: "Redis as a message bus: patterns beyond pub/sub"
summary: "Most people know Redis pub/sub and stop there. Redis has richer primitives — lists, blocking pops, and streams — that make it a capable message bus. Here's a tour, and where each fits."
description: "Patterns for using Redis as a message bus beyond pub/sub: work queues with lists and BLMOVE, reliable delivery, and Redis Streams — plus where @imqueue fits."
keywords: "redis message bus, redis pub sub, redis queue, redis streams, BLMOVE, work queue redis, reliable messaging redis, imqueue"
date: 2026-06-22
author: maya-torres
illustration: message-bus
topics: [queue, transport, patterns]
ogType: article
---

Redis is often introduced as "a cache with pub/sub," and many teams never look past those two features. But Redis has a set of primitives that make it a genuinely capable message bus — and understanding them helps you reason about what tools like `@imqueue` are doing under the hood. Here's a practical tour.

## Pub/sub: simple, and fire-and-forget

Redis pub/sub is the obvious starting point: publishers send to a channel, subscribers receive. It's great for broadcast — invalidate a cache everywhere, notify all instances of a config change.

Its limitation is that it's **fire-and-forget**. If no subscriber is connected when a message is published, that message is gone; there's no buffering and no delivery guarantee. That's fine for broadcasts you can afford to miss, and wrong for work you can't lose.

## Lists as work queues

The more interesting pattern uses Redis **lists** as queues. A producer `LPUSH`es a message; a consumer `RPOP`s it. Run several consumers against the same list and each message goes to exactly one of them — a competing-consumers work queue, with load balancing for free.

Naively, consumers would have to poll (`RPOP` in a loop), burning CPU and adding latency. Redis solves that with **blocking** variants: `BRPOP` / `BLMOVE` let a consumer block until a message arrives, so there's no polling and no idle cost. This is the backbone of most Redis-based queues.

## Making delivery reliable

Plain `RPOP` has a gap: if a consumer pops a message and then crashes before finishing, the message is lost. The fix is to move the message to a per-consumer "processing" list atomically as you take it, using `LMOVE` / `BLMOVE` (available in Redis 6.2+). If the consumer dies, the message is still sitting in its processing list and can be rescheduled; only on success do you remove it.

This is exactly the trade-off `@imqueue` exposes as its two delivery modes: a fast *unreliable* mode (a lost consumer means a lost message) and a *safe/guaranteed* mode (a grabbed-then-lost message is rescheduled), the latter built on those atomic list moves. Guaranteed delivery costs some throughput; you choose per workload.

## Redis Streams

Redis 5 added **Streams**, an append-only log with consumer groups, message IDs, and acknowledgements — closer in spirit to Kafka than to a simple list. Streams are powerful when you need replay, multiple independent consumer groups over the same data, or a durable event log. They're also more to manage. For straightforward work-queue and RPC routing, lists with blocking moves are simpler and lighter; for event-sourcing-style needs, Streams earn their complexity.

## Keyspace notifications

One more primitive worth knowing: Redis can emit **keyspace notification** events when keys change. This lets a system react to expirations and mutations without polling. It's off or partial by default on some managed Redis offerings (for example, you may need to set `notify-keyspace-events Ex` on AWS ElastiCache). If you build on a library that relies on these events, that's a configuration line to remember.

## Where @imqueue sits

`@imqueue/core` is essentially a well-engineered application of these patterns: blocking list operations for no-poll delivery, atomic moves for optional guaranteed delivery, round-robin balancing across multiple Redis instances for horizontal scale, and no timers so idle queues cost nothing. On top of that, `@imqueue/rpc` adds the typed request/response layer. You could assemble these patterns yourself — but the value of a framework is that the tricky parts (reliability, scaling, no-poll efficiency) are already handled and tested.

If you want to see the RPC layer built on these foundations, start with [Getting Started](/get-started/), or read the [Messaging API overview](/api/) for how the queue itself is exposed.
