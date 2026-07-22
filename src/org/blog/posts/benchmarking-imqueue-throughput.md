---
layout: post.html
permalink: /blog/benchmarking-imqueue-throughput/
templateEngineOverride: md
title: "Benchmarking @imqueue: throughput, delivery modes, and how to measure your own"
summary: "Real measured throughput for @imqueue's message queue — ~200k msg/sec unreliable, ~120k guaranteed on a 24-core box — what the delivery modes cost, and a reproducible harness to measure the figures that matter: yours."
description: "Measured throughput figures for @imqueue/core's message queue (round-trip ~200k msg/sec unreliable, ~120k guaranteed), the cost of guaranteed vs unreliable delivery and gzip, and a reproducible way to benchmark it on your own hardware."
keywords: "imqueue benchmark, message queue throughput, nodejs message queue performance, guaranteed delivery cost, imqueue performance, rpc benchmark"
date: 2026-06-07
author: mykhailo-stadnyk
illustration: throughput
topics: [performance, queue, benchmark]
ogType: article
---

Performance claims are only useful if you can reproduce them, so this post does two things: it reports figures from a real `@imqueue/core` benchmark run, and it shows you how to run the same benchmark yourself — because the only numbers that matter for your decision are the ones from *your* hardware and *your* message shapes.

> A note on honesty: the figures below are from one benchmark run and are **hardware-dependent** — see the exact rig under the table. We deliberately don't print head-to-head numbers against other frameworks here, because a fair cross-framework benchmark has to run on identical hardware, message sizes, and delivery guarantees — see "Comparing fairly" at the end for how to do that yourself.

## The measured figures

These come from the benchmark that ships with `@imqueue/core`, run in July 2026 on:

- **CPU:** Intel Core Ultra 9 275HX (24 cores) · **RAM:** 61 GB · **OS:** Linux (x64) · **Node.js:** 24.15.0
- **22 worker processes** (cores − 2), each with a dedicated CPU core and Redis pinned to its own core
- **~1 KB messages** (1,030-byte JSON payload)

Throughput is reported as **round-trip messages/second** — a full send→receive cycle, summed across all workers:

| Mode | Round-trip throughput | Notes |
|---|---|---|
| Unreliable delivery (default) | **~200,000 msg/sec** (196k–208k) | Fastest; a consumer that dies mid-message loses it |
| Guaranteed (safe) delivery | **~120,000 msg/sec** (118k–129k) | A message a crashed consumer was holding is rescheduled |
| Guaranteed + gzip | ~100,000–105,000 msg/sec | Payload compressed ~1,030 → ~322 bytes (≈70% less traffic) |

Three things worth internalizing:

1. **Guaranteed delivery costs throughput, but not dramatically.** Safe mode runs at roughly 60% of unreliable throughput here (about 1.7× slower) — a trade many workloads happily make to never silently lose a message. You choose per queue, so latency-critical paths can stay in the fast mode while critical ones run safe.
2. **gzip trades CPU for traffic, not free speed.** Compression cut each 1 KB message to ~322 bytes on the wire (~70% less Redis traffic) but *lowered* throughput, because encoding/decoding costs CPU. Turn it on when bandwidth is the bottleneck, not when throughput is.
3. **No polling means idle queues cost nothing.** The implementation uses blocking queue operations rather than timers, so throughput is the interesting number — there's no baseline CPU burn when the system is quiet.

(These are aggregate round-trip figures across 22 workers pushing hundreds of thousands of messages per run, at average end-to-end delivery times of ~2–4 seconds for the full batch — not per-message latency. Measure percentiles on your own workload; see below.)

## Why the delivery modes differ

The fast mode pops a message and hands it to a consumer. If that consumer crashes before finishing, the message is gone. The safe mode atomically *moves* the message into a per-consumer processing list as it's taken (using Redis `LMOVE`/`BLMOVE`, which is why Redis 6.2+ is required); if the consumer dies, the message is still there to be rescheduled. That extra atomic move is the source of the throughput difference. It's a clean, understandable cost model rather than a mysterious tax.

## Running the benchmark yourself

The harness ships with the repo. With a local Redis running:

```bash
git clone https://github.com/imqueue/core.git
cd core
npm install
npm run benchmark              # auto: (cores - 2) workers, 100k msgs each
# or drive it directly, e.g. the run above (22 workers, 20k msgs each):
node benchmark -c 22 -m 20000
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
