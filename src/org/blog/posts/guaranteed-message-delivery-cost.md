---
layout: post.html
permalink: /blog/guaranteed-message-delivery-cost/
templateEngineOverride: md
title: "Guaranteed message delivery: what it costs and when you need it"
summary: "\"Will I lose messages if a worker dies?\" is the right question — and the answer is a trade-off, not a yes/no. Here's how guaranteed delivery works, what it costs, and how to choose per workload."
description: "How guaranteed (safe) message delivery works versus fast unreliable delivery, the throughput cost, and a decision guide for choosing per workload with @imqueue."
keywords: "guaranteed message delivery nodejs, at-least-once delivery, reliable messaging, safe delivery, message loss, imqueue"
date: 2026-07-07
author: mykhailo-stadnyk
illustration: delivery
topics: [delivery, queue, resilience]
ogType: article
---

The first serious question anyone asks about a message-based system is: "if a worker grabs a message and then crashes, is that message lost?" It's the right question. The answer isn't a simple yes or no — it's a trade-off you should make deliberately, per workload, with your eyes open about the cost.

## Two honest modes

`@imqueue` offers two delivery modes, and the difference is exactly about that crash scenario.

**Unreliable (fast) delivery.** A consumer takes a message and processes it. If it crashes before finishing, that message is gone. This is the fastest mode — there's no bookkeeping — and it's the right default for work that is frequent, idempotent-on-retry-elsewhere, or simply not costly to miss (think best-effort notifications, cache warmups, telemetry).

**Guaranteed (safe) delivery.** As a consumer takes a message, it's atomically moved into that consumer's own "processing" holding area. If the consumer finishes, the message is cleared. If the consumer dies mid-work, the message is still there and gets **rescheduled** to another instance. Nothing is silently dropped. This is what you want for work that must not vanish — placing an order, charging a card, kicking off a payout.

## What guaranteed delivery costs

Safety isn't free, and it's useful to know the rough shape of the bill. In `@imqueue`'s published benchmarks, guaranteed delivery runs roughly **1.5–2× slower** than unreliable delivery — call it "about half the throughput" as a planning heuristic (exact numbers depend on your hardware and message sizes; measure yours).

That's a very reasonable price for "never lose this message," and the key insight is that **you don't pay it globally.** You choose per queue. Latency-critical, loss-tolerant paths stay in the fast mode; critical paths run safe. You're not forced into one guarantee for the whole system.

## The knob that bites if you ignore it

Guaranteed mode uses a **processing time-to-live** (`safeDeliveryTtl`, default 5 seconds). If a consumer holds a message longer than the TTL, the system assumes that consumer died and hands the message to someone else. That's the mechanism that makes rescheduling work — but it means:

> If a task can legitimately take longer than the TTL, you **must** raise `safeDeliveryTtl` above your realistic worst-case processing time.

Otherwise a slow-but-healthy task gets re-queued and processed twice. Set the TTL with your actual p99 processing time in mind, not the average.

## A quick decision guide

Ask two questions about each kind of message:

1. **If this is lost, does it matter?** If no → unreliable is fine, and faster. If yes → guaranteed.
2. **Is the work idempotent?** Guaranteed delivery is *at-least-once*: under rescheduling, a message can be processed more than once (e.g. the original consumer finished just as the TTL expired). So design critical handlers to be **idempotent** — safe to run twice — using an idempotency key or a dedupe check. This matters regardless of framework; at-least-once is the honest guarantee, not exactly-once.

Match the mode to the message and you get the best of both: raw speed where loss is acceptable, and durability where it isn't — without paying for durability everywhere. The delivery options are covered in the [API reference](/api/); [Getting Started](/get-started/) gets you a service to try them on.
