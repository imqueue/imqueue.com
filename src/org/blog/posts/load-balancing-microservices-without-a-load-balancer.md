---
layout: post.html
permalink: /blog/load-balancing-microservices-without-a-load-balancer/
templateEngineOverride: md
title: "Load balancing internal microservices without a load balancer"
summary: "For internal service-to-service traffic, the load balancer you run and operate is often solving a problem a message queue solves for free. Here's the competing-consumers pattern and what it removes."
description: "How to load balance internal Node.js microservices without running a load balancer, using the competing-consumers pattern over a message queue with @imqueue."
keywords: "microservice load balancing nodejs, load balance internal services, load balancing without load balancer, competing consumers, imqueue"
date: 2026-07-14
author: mykhailo-stadnyk
illustration: load-balance
topics: [load-balancing, queue, architecture]
ogType: article
---

Load balancers are essential at the edge — spreading public traffic across your front-end fleet. But many teams reflexively put one in front of *internal* services too, and then have to operate it: health checks, connection draining, sticky-session quirks, and a component sitting in the request path that can fail and must be scaled. For internal calls, there's often a simpler answer.

## The problem with a balancer in the internal path

When service A calls service B over HTTP, something has to decide *which instance* of B gets the request. That decision usually lives in a load balancer or service mesh. It works, but it means:

- **You operate another moving part.** The balancer is infrastructure to configure, monitor, and scale.
- **Addressing and scaling are coupled.** Add an instance of B and the balancer has to learn about it (via discovery, health checks, or registration).
- **It's in the hot path.** Every internal call goes through it, so its latency and availability are now yours to worry about.

## Competing consumers: balancing that needs no balancer

Route internal calls through a message queue instead, and load balancing becomes a property of the queue rather than a component you run. Each service reads from its own named queue. Run five instances of that service and they all read from the *same* queue — the queue hands each incoming message to whichever instance is currently free.

That's the **competing-consumers** pattern, and it gives you balancing for free:

- **No balancer to operate.** Nothing extra sits in the request path.
- **Scaling is just starting more consumers.** Spin up another instance and it starts pulling work from the same queue immediately — no registration, no health-check wiring.
- **Work goes to whoever's free**, which naturally favors instances that aren't busy, rather than blindly round-robining to a saturated one.

With `@imqueue`, this is the default behavior. You don't configure a balancing strategy; you just run more instances of a service:

```ts
import { IMQService, expose } from '@imqueue/rpc';

export class ThumbnailService extends IMQService {
    /**
     * Generates a thumbnail and returns its URL
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

Start three copies of that service and callers keep calling `thumbnails.make(...)` exactly as before — the extra instances just share the load.

## What you should still think about

This isn't magic, and it's worth being clear about the edges:

- **The queue is now in the hot path** instead of the balancer. That's a deliberate trade — one piece of infrastructure most teams already run, versus one they'd otherwise add.
- **Long tasks and fairness.** If some calls take much longer than others, tune how many instances you run and (for critical work) use guaranteed delivery so a message a crashed worker was holding gets picked up by another.
- **It's for internal traffic.** Public/edge traffic from browsers still wants an HTTP front door; this pattern is about services talking to each other.

If you're standing up a load balancer purely so internal services can share work, the competing-consumers model likely removes that need. The [Tutorial](/tutorial/) shows a multi-service app where scaling a service is just running more of it.
