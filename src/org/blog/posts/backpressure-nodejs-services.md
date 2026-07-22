---
layout: post.html
permalink: /blog/backpressure-nodejs-services/
templateEngineOverride: md
title: "Back-pressure for Node.js services (and why HTTP makes it hard)"
summary: "When a downstream service slows down, HTTP tends to turn that into a cascading failure. A queue absorbs the spike instead. Here's the difference, and the trade-offs to watch."
description: "How back-pressure works for Node.js microservices, why synchronous HTTP calls cause cascading failures under load, and how a message queue buffers spikes — with @imqueue."
keywords: "nodejs backpressure microservices, cascading failure, handle traffic spikes microservices, overload resilience, imqueue"
date: 2026-07-09
author: maya-torres
illustration: backpressure
topics: [backpressure, queue, resilience]
ogType: article
---

Every system has a breaking point under load. What matters is *how* it breaks. With synchronous HTTP calls between services, a slowdown in one place tends to propagate outward into a cascading failure. With a queue between services, the same spike gets absorbed. Understanding why is worth more than any single resilience library.

## Why HTTP struggles under load

Say service A calls service B over HTTP, and B gets slow — a dependency is struggling, or traffic spiked. Here's the chain reaction:

- A's requests to B pile up as **open connections**, each holding memory and a socket while it waits.
- A's own callers are now waiting on A, so the pressure propagates **upstream**.
- Timeouts fire, clients **retry**, and retries add *more* load to the very service that's already overwhelmed.
- Eventually connection pools exhaust and healthy requests fail alongside the unhealthy ones.

Teams patch this with timeouts, circuit breakers, and bulkheads — all genuinely useful — but they're mechanisms to *fail faster*, layered on top of a transport that couples caller and callee tightly in time.

## What a queue changes

When A talks to B through a message queue, A doesn't hold a connection open waiting for a free instance of B. It puts a message on B's queue. If B is momentarily slower than its inflow, the **queue grows** — it buffers the spike rather than converting it into failed connections. B works through the backlog at its own pace, and when consumers catch up, the queue drains.

That's back-pressure done structurally: the queue is a shock absorber between producer and consumer. Add more consumers (more instances of B) and the backlog clears faster, with no balancer to reconfigure.

`@imqueue` gives you a couple of levers that matter here:

- **Delivery mode.** In guaranteed (safe) mode, a message a consumer grabbed but didn't finish — because it crashed or was killed mid-spike — is rescheduled to another instance instead of being lost. You trade some throughput for not dropping work under stress.
- **A processing time-to-live.** Safe delivery uses a `safeDeliveryTtl`: if a consumer holds a message longer than that, it's returned to the queue for another instance to handle. Set it above your realistic worst-case processing time so legitimate slow work isn't re-queued prematurely.

## The trade-offs to respect

A queue changes the failure mode; it doesn't repeal physics:

- **A backlog is latency.** Buffering a spike means requests wait. That's usually far better than failing them, but for user-facing, latency-critical calls you still want enough consumers that the queue stays shallow.
- **Unbounded growth is its own failure.** If inflow *permanently* exceeds what your consumers can handle, the queue grows without bound. Monitor queue depth and scale consumers (or shed load deliberately) — a growing backlog is the signal.
- **Not everything should wait.** Truly time-sensitive interactive calls may still want a fast-fail path; use back-pressure where deferral is acceptable.

The headline: HTTP couples services in time, so overload spreads; a queue decouples them, so overload is absorbed and bounded by how fast you choose to consume. If cascading failures under load are a recurring pain, that structural difference is the lever. See [Getting Started](/get-started/) to try the model, and the delivery-mode options in the [API reference](/api/).
