---
layout: post.html
permalink: /blog/imqueue-vs-bullmq/
templateEngineOverride: md
title: "@imqueue vs BullMQ: RPC vs background job queues"
summary: "Both move messages through a queue — but BullMQ is a background-job queue and @imqueue is request/response RPC. Confusing them leads to the wrong architecture. Here's the line between them."
description: "The difference between @imqueue (request/response RPC) and BullMQ (background job/task queue over Redis), and when to use each — or both together."
keywords: "imqueue vs bullmq, bullmq alternative, redis job queue, background jobs nodejs, task queue vs rpc, request response vs job queue"
date: 2026-06-12
author: andrii
illustration: rpc-vs-jobs
topics: [comparison, queue, jobs]
ogType: article
---

[BullMQ](https://docs.bullmq.io/) and `@imqueue` both "put messages on a queue," so they get compared. But they're built for different jobs, and picking the wrong one leads to a lot of friction. This post draws the line clearly. (BullMQ details reflect its documented behavior at the time of writing.)

## The core distinction: jobs vs calls

**BullMQ is a background-job / task queue.** You enqueue a job ("resize this image", "send this email", "generate this report"), and one of your workers picks it up and processes it, later, possibly with retries, backoff, priorities, repeatable schedules, and rate limiting. The producer usually doesn't block waiting for a result — it fires the job and moves on. This is the classic *work queue* pattern, and BullMQ is excellent at it.

**@imqueue is request/response RPC.** You call `userService.get('42')` and you `await` a typed result, the way you'd call a local function. The queue is an implementation detail that routes the call to a service instance and routes the result back. The caller *does* block on the answer, because it needs it.

Put simply: **BullMQ answers "do this eventually"; @imqueue answers "give me this now."**

## Why the distinction matters

If you try to build request/response RPC on top of a job queue, you end up hand-rolling correlation IDs, reply queues, timeouts, and type plumbing — reinventing an RPC layer badly. If you try to run long-running background work through an RPC layer, you fight against the request/response grain and block callers on work that should be fire-and-forget.

They're complementary, not competing. A healthy system often uses both:

- **@imqueue** for the synchronous internal API surface: service A needs data or an action from service B and waits for the result.
- **BullMQ** for asynchronous, deferrable, retry-heavy work: image processing, emails, scheduled jobs, anything the caller shouldn't wait on.

## A note on delayed messages

`@imqueue` does support *delayed* delivery — you can send a message to be delivered after a delay — which overlaps slightly with a job queue's scheduling. But that's a lightweight primitive for timing, not a replacement for BullMQ's job lifecycle (attempts, backoff strategies, progress, repeatable jobs, flows). If you need that machinery, use a job queue built for it.

## Quick comparison

| | @imqueue | BullMQ |
|---|---|---|
| Pattern | Request/response RPC | Background job / work queue |
| Caller waits for result? | Yes (`await` a typed value) | Usually no (fire-and-forget) |
| Typed API | Generated typed clients | You define job data/return shapes |
| Retries/backoff/priorities | Not its focus | First-class |
| Scheduled/repeatable jobs | Basic delayed delivery | First-class |
| Typical use | Internal service-to-service calls | Deferred/heavy background work |
| License | GPL-3.0 (commercial available) | MIT |

## How to choose

- **Reach for BullMQ** when work can happen later, needs retries or scheduling, and the producer shouldn't block.
- **Reach for @imqueue** when one service needs a typed answer or action from another, now.
- **Use both** when you have both shapes of problem — which most non-trivial systems do.

If it's the synchronous, typed service-to-service half you need, the [Tutorial](/tutorial/) walks through building it with @imqueue.
