---
layout: post.html
permalink: /blog/load-balancing-microservices-without-a-load-balancer/
templateEngineOverride: md
title: "Load balancing microservices without a load balancer"
summary: "For internal service-to-service traffic, the load balancer you run and operate is often solving a problem a message queue solves for free. Here's the competing-consumers pattern, why pull beats push, and what you give up."
description: "Load balance internal Node.js microservices without a load balancer, using competing consumers over a message queue — and what a balancer still does better."
keywords: "microservice load balancing nodejs, load balance internal services, load balancing without load balancer, competing consumers, imqueue"
date: 2026-07-14
dateModified: 2026-07-29
author: mykhailo-stadnyk
illustration: load-balance
topics: [load-balancing, queue, architecture]
ogType: article
---

**Competing consumers is load balancing without a balancer: instead of something choosing an instance and pushing work to it, idle instances pull work from a shared queue.** Every replica of a service reads the same named queue, so whoever is free takes the next message. There's no component in the request path deciding anything, nothing to register an instance with, and no health checks feeding a routing table. For internal service-to-service traffic that's usually a better deal than the balancer you'd otherwise operate.

## The problem with a balancer in the internal path

When service A calls service B over HTTP, something must decide *which instance* of B gets the request. That decision usually lives in a load balancer or service mesh. It works, but it means:

- **You operate another moving part** — configure it, monitor it, scale it.
- **Addressing and scaling are coupled.** Add an instance of B and the balancer has to learn about it, via discovery, health checks or registration.
- **It's in the hot path.** Every internal call traverses it, so its latency and availability become yours.

## Why pulling beats pushing: competing consumers vs a load balancer

Pull-based distribution is the actual mechanism behind competing consumers, and worth understanding on its own rather than as "one less component".

A load balancer **pushes**. It picks a target using a policy — round-robin, least-connections, random — and hands the request over. The policy is a guess about which instance can best handle the work right now, made by something that isn't that instance. Round-robin will happily hand a request to an instance that's mid-way through something expensive; least-connections is better but still infers load from connection count rather than from actual capacity.

~~~mermaid
flowchart LR
    subgraph push["Push — a load balancer chooses"]
        direction LR
        P1[caller] --> LB[load balancer]
        LB -->|"round-robin: next in sequence"| B1["instance 1 — busy, 5s handler"]
        LB --> B2["instance 2 — idle"]
    end
    subgraph pull["Pull — @imqueue competing consumers"]
        direction LR
        P2[caller] -->|"message"| Q[("queue 'Thumbnail'")]
        B3["instance 1 — busy, not asking"] -.-> Q
        B4["instance 2 — idle, asks"] -->|"takes it"| Q
    end
~~~

A load balancer hands work to an instance it picked; `@imqueue`'s competing
consumers hand work to whichever instance asked for it. That is the whole
difference, and it is why the busy instance in the lower half receives nothing.

Competing consumers **pull**. An instance takes the next message when it's ready for one, so "who is free" isn't estimated — it's expressed by the act of asking. An instance chewing on something slow simply doesn't ask for more work, and the queue hands the next message to one that does. You get load-aware distribution without any load-awareness logic, and without a component that has to be told about capacity.

In `@imqueue` this is the default and there's nothing to configure. Run more instances of a service:

```typescript
import { IMQService, expose } from '@imqueue/rpc';

export class Thumbnail extends IMQService {
    /**
     * Generates a thumbnail and returns its URL
     *
     * @param {string} imageId - source image id
     * @return {Promise<string>} - thumbnail URL
     */
    @expose()
    public async make(imageId: string): Promise<string> {
        // ...heavy work; run as many instances as you need
        return `https://cdn.example.com/thumbs/${imageId}.jpg`;
    }
}
```

Start three copies and callers keep calling `client.make(...)` exactly as before — the extra instances just share the load. No registration, no health-check wiring, no balancer config.

It's also not a polling loop. The implementation uses blocking queue operations rather than timers, so an idle worker costs no CPU and a message doesn't wait for the next tick of anything.

## Three ways to add capacity with `@imqueue`

`@imqueue` gives you three levers — more service instances, more workers inside one process, and more Redis nodes. They compose, and they fail differently, so it's worth knowing which you're using.

**More service instances.** The plain case above: separate processes, possibly on separate machines, all consuming the same queue. Nothing to configure.

**More workers inside one process** via `multiProcess`, which forks one cluster worker per CPU core (times `childrenPerCore`). Two documented gotchas here, both easy to trip over:

- The primary **also** starts its own consumer after forking, so N configured workers means N+1 consumers — and N+1 processes will try to bind the metrics port.
- **Workers are never respawned.** When one dies, an exit watcher kills the whole process with code 1, deliberately leaving supervision to your process manager. Don't enable this without one.

**More Redis nodes**, via clustering. Here the asymmetry matters: `send()` routes each message to exactly one server using health-aware round-robin that skips instances whose writer connection isn't ready — but every *other* operation (`start`, `stop`, `clear`, `publish`, `subscribe`, `queueLength`) fans out to every server using `Promise.all`. So one failing host fails the whole call, with no partial-failure reporting and no rollback. [Horizontally scalable Redis broker](/blog/horizontally-scalable-redis-broker/) goes through the topology properly.

## What a load balancer still does better than competing consumers

Competing consumers gives up capabilities a balancer genuinely has, and being straight about them matters more than the pitch:

- **Weighted and policy-based routing.** Canary deploys, traffic splitting, "send 5% to the new version" — competing consumers has no notion of any of it. Every consumer on a queue is equal.
- **Per-instance health.** A balancer knows which instance is unhealthy and stops sending to it. A queue has no view of your instances at all; an instance that consumes messages and then fails at them will happily keep consuming.
- **Fail-fast.** A balancer with no healthy backends returns an error immediately. A queue accepts the message and waits, which is why `callTimeout` is not optional in production — it's unset by default, and without it a call to a service with no consumers hangs forever.
- **Circuit breaking and retry policy.** Not present; some of the need is absorbed by messages waiting rather than failing, but the features aren't there.
- **Edge traffic.** Browsers can't talk to the queue. You still want an HTTP front door.

## Fairness and head-of-line effects on a shared `@imqueue` queue

Once distribution is consumption-driven, two effects of a shared queue are yours to design for.

**Mixed durations on one queue.** If a service has both 5 ms and 5 s methods, a burst of slow calls occupies your consumers and the fast calls queue behind them. The queue does not preempt; nothing interrupts a slow handler or re-queues it for taking too long. Where this bites, split the slow work onto its own service so it gets its own queue and its own scaling curve.

**Duplicates are possible.** Delivery is at-least-once in both modes, so handlers should be idempotent. Safe delivery re-queues a message a dying worker never *started*; it doesn't protect work already in flight, and nothing drains in-flight work on shutdown — see [graceful shutdown and zero-drop deploys](/blog/graceful-shutdown-zero-drop-deploys/) and [what guaranteed delivery costs](/blog/guaranteed-message-delivery-cost/).

## How you know competing consumers is keeping up

Without a balancer you lose its dashboard, so watch the queue instead. `@imqueue` can expose a `queue_length` metric, and the signal you want is **sustained growth** — that means arrival rate has outrun your consumers and it's time to add some.

Read it with care: `queueLength()` excludes messages not yet due and messages currently leased under safe delivery, so it isn't a measure of outstanding work, and it returns `0` when there's no writer connection — which makes "disconnected" indistinguishable from "empty". Alert on the trend, not the absolute number, and never treat zero as proof of health.

## When competing consumers is the right trade

Use competing consumers — over `@imqueue` or any other queue — for internal calls when your services are Node.js, you already run Redis or don't mind adding it, your handlers can be idempotent, and you don't need weighted routing or canaries on internal traffic.

Keep the balancer or mesh when you need traffic policy, per-instance health, mTLS and tracing, fail-fast semantics, or you're routing between languages — [gRPC and a mesh are the better answer there](/blog/grpc-vs-message-queue-rpc/).

## Frequently asked questions about load balancing without a balancer

### How does a message queue decide which service instance gets a message?
A queue does not decide, in the sense a balancer does. Instances pull when they're ready, so the next free consumer takes the next message. Distribution is a consequence of consumption rather than a routing decision.

### Are competing consumers the same as round-robin?
No, and that's the point. Round-robin sends to the next instance in sequence whether or not it's busy. Competing consumers sends to whichever instance asks, which is inherently load-aware.

### Do I still need a load balancer anywhere?
Yes — at the edge, for public HTTP traffic. Competing consumers is about services calling each other.

### How do I scale an `@imqueue` service?
Run more instances of it. They join the same queue and start taking work immediately, with no registration step.

### What if one service instance is much slower than the others?
That instance asks for work less often, so it naturally receives less. Self-throttling is the main advantage competing consumers has over push-based balancing.

### Can I do canary deploys with competing consumers?
Not with the queue alone — every consumer on an `@imqueue` queue is equal, and there's no weighting. Deploy a canary as a separate service with its own queue, and split traffic at the caller or the gateway.

---

The [**Tutorial**](/tutorial/) builds a multi-service app where scaling a service is just running more of it. For the addressing half of the same mechanism, see [do your Node.js back-ends really need service discovery?](/blog/do-nodejs-backends-need-service-discovery/) Shipping inside a closed-source product? See [commercial licensing & support](/license/).
