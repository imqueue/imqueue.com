---
layout: post.html
permalink: /blog/benchmarking-imqueue-throughput/
templateEngineOverride: md
title: "Benchmarking @imqueue: throughput, delivery modes, and how to measure your own"
summary: "The published throughput numbers for @imqueue's message queue, what the two delivery modes cost, and a reproducible harness so you can measure the figures that actually matter — yours."
description: "Published throughput figures for @imqueue/core's message queue, the cost of guaranteed vs unreliable delivery, and a reproducible way to benchmark it on your own hardware."
keywords: "imqueue benchmark, message queue throughput, nodejs message queue performance, guaranteed delivery cost, imqueue performance, rpc benchmark"
date: 2026-05-27
author: maya-torres
illustration: throughput
topics: [performance, queue, benchmark]
ogType: article
---

Performance claims are only useful if you can reproduce them, so this post does two things: it reports the throughput figures `@imqueue/core` publishes, and it shows you how to run the benchmark yourself — because the only numbers that matter for your decision are the ones from *your* hardware and *your* message shapes.

> A note on honesty: the figures below are `@imqueue/core`'s own published benchmark results and are **hardware-dependent** (they were measured on an i7-class CPU). We deliberately don't print head-to-head numbers against other frameworks here, because a fair cross-framework benchmark has to run on identical hardware, message sizes, and delivery guarantees — see "Comparing fairly" at the end for how to do that yourself.

## The published figures

On an i7-class core, `@imqueue/core`'s reference benchmark reports, for 1 KB messages:

| Mode | Throughput (approx.) | Notes |
|---|---|---|
| Unreliable delivery | ~35,000–40,000 msg/s | Fastest; a consumer that dies mid-message loses it |
| Guaranteed (safe) delivery | ~20,000–25,000 msg/s | ~1.5–2× slower; a lost message is rescheduled |
| Delayed messages | ~10,000 msg/s | For scheduled/delayed delivery |

Two things are worth internalizing from this table:

1. **Guaranteed delivery isn't free, but it isn't catastrophic either.** Roughly halving throughput to never lose a message is a trade many workloads will happily make. You choose per queue, so latency-critical paths can stay in the fast mode while critical ones run safe.
2. **No polling means idle queues cost nothing.** The implementation uses blocking queue operations rather than timers, so throughput is the interesting number — there's no baseline CPU burn when the system is quiet.

## Why the delivery modes differ

The fast mode pops a message and hands it to a consumer. If that consumer crashes before finishing, the message is gone. The safe mode atomically *moves* the message into a per-consumer processing list as it's taken (using Redis `LMOVE`/`BLMOVE`, which is why Redis 6.2+ is required); if the consumer dies, the message is still there to be rescheduled. That extra atomic move is the source of the throughput difference. It's a clean, understandable cost model rather than a mysterious tax.

## Running the benchmark yourself

The harness ships with the repo. With a local Redis running:

```bash
git clone https://github.com/imqueue/core.git
cd core
npm install
node benchmark -c 4 -m 10000
```

Useful flags:

```bash
node benchmark -h
#  -c, --children   number of worker processes to fork
#  -m, --messages   messages sent per child during the test
#  -d, --delay      delay (ms) for delayed-message tests
#  -z, --gzip       enable gzip encoding of messages
#  -s, --safe       use safe (guaranteed) delivery
#  -t, --message-multiply-times  inflate the sample message size
```

A few things the harness does deliberately, so your numbers are meaningful:

- **CPU affinity.** Workers are pinned to dedicated cores, and the number of workers is capped at CPU count minus two (one core for the OS/stats collector, one for the local Redis process). On an 8-core machine you can run up to 6 workers; on a 4-core machine, 2.
- **Local Redis.** The benchmark measures Redis CPU too, so it expects Redis on localhost. This is Linux-oriented — macOS has no reliable CPU-affinity mechanism and Windows affinity isn't implemented, so results there won't be as predictable.

Run it with `-s` and without, and with `-t` to grow the message size, to see how *your* workload behaves — small-and-many versus large-and-few stress very different things.

## Comparing fairly against other tools

If you want to compare against Moleculer, a gRPC service, a BullMQ-based approach, or raw HTTP, the only comparison worth publishing is one where you hold everything else constant:

- **Same hardware**, same core count, same Redis (or same broker) version.
- **Same message size and shape.** 1 KB of JSON is a reasonable baseline; report the size you used.
- **Same delivery guarantee.** Comparing @imqueue's *guaranteed* mode against another tool's *fire-and-forget* mode is apples-to-oranges. Match the semantics.
- **Same concurrency.** Equal numbers of producers/consumers/connections.
- **Report percentiles, not just averages** — p50/p95/p99 latency tells you more than mean throughput for anything user-facing.

Build a tiny "ping" service in each contender that echoes a fixed payload, drive it with an identical load generator, and record throughput and latency percentiles. That harness — reproducible and hardware-honest — is worth far more than any number we could print for you.

To build the @imqueue side of such a comparison, [Getting Started](/get-started/) gets a service and a typed client running quickly, and [`@imqueue/core`](https://github.com/imqueue/core) contains the throughput harness described above.
