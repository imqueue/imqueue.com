---
layout: post.html
permalink: /blog/monolith-to-services-first-extraction/
templateEngineOverride: md
title: "From monolith to services: a low-risk first extraction"
summary: "You don't migrate a monolith by rewriting it. You extract one capability, keep everything else in place, and repeat. Here's a concrete, low-risk first step for a Node.js team."
description: "A practical, low-risk approach to starting a monolith-to-microservices migration in Node.js: extract one capability behind a typed service call and iterate, using @imqueue."
keywords: "monolith to microservices nodejs, extract first microservice, strangler fig nodejs, incremental migration, imqueue"
date: 2026-06-24
author: priya-nair
illustration: monolith-split
topics: [architecture, migration, rpc]
ogType: article
---

Most microservice regret starts the same way: a team decides to "go microservices," stops feature work, and attempts a big-bang rewrite that takes two quarters and lands late. There's a far safer path — extract *one* capability, leave the rest of the monolith exactly as it is, and iterate only if the first step pays off. Here's how to make that first extraction low-risk.

## Pick the right first capability

Don't start with the hardest or most central part of the system. Look for a capability that is:

- **Loosely coupled** — it doesn't reach into half the monolith's internals.
- **Clearly bounded** — you can describe its inputs and outputs in a sentence.
- **Independently valuable** — it scales differently, deploys on a different cadence, or is owned by a distinct team.

Classic good first candidates: image/PDF processing, notifications, a recommendation or pricing calculation, search indexing. Bad first candidates: the thing every request touches.

## Define the seam as a typed call

The key to a safe extraction is that the monolith shouldn't know or care whether the capability moved. So define the seam as a **typed service call**, not as scattered HTTP requests. With `@imqueue`, the extracted capability becomes a service:

```ts
import { IMQService, expose } from '@imqueue/rpc';

export class PricingService extends IMQService {
    /**
     * Calculates the total price for a cart
     * @param {{ items: string[]; coupon?: string }} cart
     * @return {Promise<{ total: number; currency: string }>}
     */
    @expose()
    public async quote(cart: { items: string[]; coupon?: string }): Promise<{ total: number; currency: string }> {
        // ...the logic you're lifting out of the monolith
        return { total: 4200, currency: 'USD' };
    }
}
```

The monolith generates a typed client and calls it like a local function:

```ts
const pricing = new PricingServiceClient();
await pricing.start();
const { total } = await pricing.quote(cart);
```

Because the client is typed and generated from the service, the monolith's call site is checked at compile time — the seam is as safe as an in-process function call.

## Keep the blast radius small

A few disciplines make the first step reversible:

- **Move behavior, not the world.** Lift the logic and its immediate data access; don't try to untangle everything it transitively touches on day one.
- **Run it beside the monolith.** No need for a platform overhaul — start the service, point the monolith's generated client at it, done. There's no load balancer or discovery layer to stand up first (the queue handles addressing and balancing).
- **Have an escape hatch.** Because the seam is a single typed call, falling back to the in-monolith implementation is a small change, not a rollback of an architecture.

## Then, and only then, iterate

Ship the one extraction. Watch it in production. If it made that capability easier to scale, deploy, and own — extract the next one, using the same pattern. If it didn't, you've spent days, not quarters, and the monolith is intact. That's the whole advantage of incremental: every step is small, typed, and reversible.

To build that first service and generate the client the monolith calls, start with [Getting Started](/get-started/); the [Tutorial](/tutorial/) shows several services coming together the same way.
