---
layout: post.html
permalink: /blog/imqueue-vs-bullmq/
templateEngineOverride: md
title: "@imqueue/job vs BullMQ: a simple Redis job queue vs a feature-rich one"
summary: "Both are Redis-backed job queues for Node.js. @imqueue/job is small, safe-by-default and scheduling-capable; BullMQ is the feature-rich one. Here's an honest split — plus the thing @imqueue does that BullMQ doesn't."
description: "An even-handed comparison of @imqueue/job and BullMQ as Redis-backed job queues for Node.js — guaranteed processing, delayed/scheduled jobs, retries, priorities, flows — and when to pick each."
keywords: "imqueue vs bullmq, bullmq alternative, redis job queue, background jobs nodejs, scheduled jobs nodejs, simple job queue, delayed jobs redis"
date: 2026-06-12
author: andrii
illustration: rpc-vs-jobs
topics: [comparison, queue, jobs]
ogType: article
---

If you need to run background jobs on Redis in Node.js, [BullMQ](https://docs.bullmq.io/) is the name everyone reaches for. But `@imqueue` also ships a job queue — [`@imqueue/job`](https://github.com/imqueue/job) — built on the same Redis-backed core as the rest of the framework. This is an honest comparison of the two, plus one thing `@imqueue` does that BullMQ doesn't. (BullMQ details reflect its documented behavior at the time of writing.)

## The one-line version

**`@imqueue/job` is a deliberately *simple*, safe-by-default job queue; BullMQ is the *feature-rich* one.** Both run on Redis, both do concurrent workers and delayed jobs. BullMQ adds a much larger job-lifecycle surface (retries with backoff, priorities, repeatable/cron jobs, rate limiting, flows, a dashboard). `@imqueue/job` keeps a tiny footprint and leans on guaranteed delivery being on by default.

## What @imqueue/job gives you

`@imqueue/job` is a Redis-backed job queue with a small, focused feature set:

- **Guaranteed processing by default.** Safe delivery is on out of the box: if a worker grabs a job and dies mid-processing, the job is re-queued for another worker (a per-worker lock TTL, `safeLockTtl`, controls how long before it's considered dead). No data loss.
- **Concurrent workers** on one queue — competing consumers with natural load balancing, no separate balancer.
- **Delayed / scheduled jobs** to millisecond granularity: `push(data, { delay })`.
- **Job expiration (TTL)** — a job can live forever or expire after a set time.
- **Publisher / worker / both** roles, so you can split producers and consumers across processes.
- **gzip** payload compression, and it's **TypeScript-first**.
- **One dependency** (`@imqueue/core`), event-driven (no polling), low idle cost.

```ts
import JobQueue from '@imqueue/job';

new JobQueue<string>({ name: 'Emails' })
    .onPop(job => sendEmail(job))
    .start()
    .then(q => q
        .push('welcome@acme.com')
        .push('reminder@acme.com', { delay: 60_000 })); // run in 1 minute
```

## Delayed & scheduled delivery is first-class — everywhere in @imqueue

This is worth stating plainly, because it's easy to assume a "simple" queue can't schedule: **delayed delivery is a core capability across the whole framework, not an afterthought.**

- In `@imqueue/core`, the fundamental `send(toQueue, message, delay?)` takes a delay, implemented with a dedicated delayed-set scored by due time, promoted by Redis keyspace notifications (with a polling fallback) — a proper scheduler, not a hack.
- In `@imqueue/rpc`, an `IMQDelay` value (with `ms`/`s`/`m`/`h`/`d` units) lets you delay *any* remote call.
- In `@imqueue/job`, that surfaces as `push(data, { delay })`.

So scheduling to the millisecond is built in at every layer.

## Retries and backoff

`@imqueue/job` retries failed jobs automatically, and the retry *timing* is under your control:

- A handler that **throws** re-schedules the job (with its original delay) — an automatic retry on failure.
- A handler that **returns a delay in milliseconds** re-runs the job after that delay — so you can shape the backoff (return a growing delay for exponential backoff), and finish by returning nothing.
- If a **worker dies mid-job**, safe delivery re-queues it after `safeLockTtl`.

```ts
new JobQueue<string>({ name: 'Fetch' })
    .onPop(async (url) => {
        await fetchAndStore(url); // if this throws, the job is retried
    })
    .start();
```

So retries and backoff *do* exist. What BullMQ adds on top is a **declarative** policy — a fixed `attempts` cap plus a named backoff strategy — with the job automatically **dead-lettered** once attempts run out. In `@imqueue/job` you cap attempts yourself (e.g. re-push the job with an incremented counter and stop re-scheduling).

## Where BullMQ goes further

Be fair about this — if you need these, BullMQ is the better fit and `@imqueue/job` isn't trying to compete:

- **A declarative retry policy** — `attempts` limit + named backoff strategy + automatic dead-lettering (vs the programmable retries above).
- **Priorities** across queued jobs.
- **Repeatable / cron jobs** on a recurring schedule.
- **Rate limiting** of processing.
- **Flows** — parent/child job dependencies.
- **Progress reporting, events, and a dashboard** ecosystem (e.g. Bull Board).

`@imqueue/job` gives you durable, concurrent, schedulable jobs with almost no surface area; BullMQ gives you a full job-orchestration platform.

## The thing BullMQ doesn't do: typed RPC

BullMQ is a job queue, full stop. `@imqueue` is a whole framework on one Redis-backed core, and jobs are just one part of it. The same stack also gives you **typed request/response RPC** via [`@imqueue/rpc`](https://github.com/imqueue/rpc): call another service like a local function and `await` a typed result, with the client generated from the service.

So if your system needs *both* "do this later" (jobs) *and* "give me this now" (service-to-service calls), `@imqueue` covers both with one dependency and one mental model. With BullMQ you'd pair it with a separate RPC/HTTP layer for the synchronous half.

## Quick comparison

| | @imqueue/job | BullMQ |
|---|---|---|
| Backing store | Redis | Redis |
| Guaranteed processing | ✅ on by default (re-queue on worker death) | ✅ (stalled-job recovery) |
| Concurrent workers | ✅ competing consumers | ✅ |
| Delayed / scheduled jobs | ✅ millisecond granularity | ✅ |
| Job expiration (TTL) | ✅ | ✅ (retention policies) |
| Retries + backoff | ✅ programmable (retry on error; return a delay to back off) | ✅ declarative (`attempts` + backoff strategy + dead-letter) |
| Priorities | ❌ | ✅ |
| Repeatable / cron | ❌ | ✅ |
| Rate limiting / flows / dashboard | ❌ | ✅ |
| Typed request/response RPC | ✅ (via @imqueue/rpc, same core) | ❌ (jobs only) |
| Dependencies | 1 (`@imqueue/core`) | several |

## How to choose

- **Reach for BullMQ** when you need the rich job lifecycle — retries with backoff, priorities, cron/repeatable jobs, rate limiting, flows, or a ready-made dashboard.
- **Reach for `@imqueue/job`** when you want a small, dependency-light, safe-by-default job queue with delayed/scheduled jobs — especially if you're already using `@imqueue` for service communication and want one stack for both jobs and RPC.

To try the @imqueue side, [Getting Started](/get-started/) covers the framework, and [`@imqueue/job`](https://github.com/imqueue/job) has the job-queue API.
