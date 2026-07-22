---
layout: post.html
permalink: /blog/cutting-boilerplate-nodejs-microservices/
templateEngineOverride: md
title: "Cutting the boilerplate out of Node.js microservices"
summary: "Most of a new service's first commit is ceremony — transport wiring, serialization, a client, CI, a Dockerfile. Here's where the boilerplate hides and how to stop writing it by hand."
description: "Where boilerplate accumulates in Node.js microservices and how scaffolding plus self-describing services with generated clients removes most of it, using @imqueue."
keywords: "reduce microservice boilerplate nodejs, microservice scaffolding typescript, rapid application development microservices, imqueue cli"
date: 2026-06-30
author: dan-ivanov
illustration: boilerplate
topics: [dx, tooling, clients]
ogType: article
---

Open a fresh microservice repo and look at what's there before any business logic exists: transport setup, request/response serialization, a client for other services to call you, a Dockerfile, a CI pipeline, config plumbing. That's the boilerplate tax — and because it's per-service, it scales linearly with your fleet. Every new service is another round of copying, tweaking, and forgetting one thing.

## Where the boilerplate actually hides

It helps to name the categories, because they have different fixes:

1. **Transport & wiring** — connecting to the message bus, framing requests and responses, routing a call to the right handler.
2. **Serialization & types** — turning calls into messages and back, and keeping argument/return types correct on both ends.
3. **Clients** — the code other services use to call you, which someone has to write and keep in sync.
4. **Project setup** — repo layout, TypeScript config, a Dockerfile, a CI workflow, a container registry push.

Most teams hand-roll all four for every service. The first three are exactly what a good RPC framework should absorb; the fourth is what a good scaffolding tool should generate.

## Let the framework own the wiring

With `@imqueue`, categories 1–3 mostly disappear. A service is just a class with the methods you expose; the framework handles transport, framing, and serialization, and the **client is generated from the service** rather than written:

```ts
import { IMQService, expose } from '@imqueue/rpc';

export class OrderService extends IMQService {
    /**
     * Places an order and returns its id
     * @param {{ items: string[]; userId: string }} order
     * @return {Promise<{ id: string }>}
     */
    @expose()
    public async place(order: { items: string[]; userId: string }): Promise<{ id: string }> {
        return { id: 'ord_123' };
    }
}
```

There's no transport code in that file, no serializer, and no client to maintain — callers generate one with `imq client generate OrderService` and call `orders.place(...)` with full types.

## Let the CLI own the setup

Category 4 — the repo scaffolding — is what [`@imqueue/cli`](/cli/) is for. Instead of copying a template repo and editing it by hand, you scaffold a service and its surrounding setup in one command:

```bash
imq service create
```

The CLI lays down the service structure, wires up your VCS/CI/registry providers, and can generate clients and run a local fleet of services during development. The ceremony that used to be a checklist becomes a command.

## The point isn't fewer keystrokes

It's fewer places to make a mistake. Hand-written wiring and clients aren't just tedious — they're where inconsistencies creep in: one service serializes dates differently, another's client is a version behind, a third's CI is missing a step. Generating that layer makes services uniform by construction, which pays off most when you have a lot of them.

If your services' first hundred lines are always the same hundred lines, that's boilerplate a framework and a scaffolder should be writing for you. Start with [Getting Started](/get-started/), or jump into the [CLI User Guide](/cli/).
