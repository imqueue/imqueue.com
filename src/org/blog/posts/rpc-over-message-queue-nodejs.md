---
layout: post.html
permalink: /blog/rpc-over-message-queue-nodejs/
templateEngineOverride: md
title: "RPC between Node.js microservices over a message queue — no HTTP, no gRPC"
summary: "Why route internal service-to-service calls through a message queue instead of HTTP or gRPC — and how @imqueue makes those calls fully typed with zero client boilerplate."
description: "A practical look at doing RPC between Node.js & TypeScript microservices over a message queue instead of HTTP or gRPC, with a working @imqueue example."
keywords: "message queue RPC, Node.js microservices RPC, TypeScript microservices, imqueue, service-to-service communication, no HTTP RPC, queue-based RPC"
date: 2026-07-22
author: maya-torres
illustration: queue-rpc
topics: [rpc, queue, architecture]
ogType: article
---

Most Node.js microservices talk to each other over HTTP. It works, it's familiar, and it comes with a stack of accidental complexity: you run load balancers, you wire up service discovery, you handle retries and timeouts, you serialize and re-parse JSON on both ends, and you hand-write (or hand-maintain) a client for every service you call.

There is another option that predates the microservice hype and still holds up well: **put a message queue between your services and do RPC over it.** This post explains when that's a good idea, what you give up, and how `@imqueue` turns it into typed, boilerplate-free calls.

## The problem with HTTP for internal calls

HTTP is a great protocol for the edge — for talking to browsers, mobile apps, and third parties. For *internal* service-to-service traffic it drags along baggage you don't need:

- **You need to know where the other service is.** That means service discovery, DNS, or a load balancer sitting in the request path.
- **Scaling is coupled to addressing.** Add an instance and something has to notice and start routing to it.
- **The contract is untyped by default.** A route returns whatever it returns; your caller finds out at runtime. Teams paper over this with OpenAPI generators, but that's another build step and another artifact to keep in sync.

None of this is fatal. It's just a lot of moving parts for "service A wants to call a function in service B."

## What a queue changes

When services communicate through a shared message queue, addressing becomes a non-problem. A service reads from its own named queue; a caller drops a message on that queue. If you run five instances of a service, they all read from the same queue and the queue hands each message to whichever instance is free. That's load balancing for free, with no component in the request path that you have to operate.

- **No service discovery.** The queue name *is* the address.
- **No load balancer.** Competing consumers on one queue balance themselves.
- **Back-pressure is natural.** If consumers fall behind, the queue grows; it doesn't drop connections.

A message queue is a particularly practical substrate for this: it's fast, and blocking queue operations let you build it with no polling and no idle CPU cost. In practice, `@imqueue` runs on a queue you very likely already operate.

## Where the types come from

The usual objection to queues is: "great, but now I'm sending untyped JSON blobs around." That's the part `@imqueue` solves. A service is an ordinary TypeScript class; you mark the methods you want to expose, and the framework derives the service's description from your code and its JSDoc:

```ts
import { IMQService, expose } from '@imqueue/rpc';

export class UserService extends IMQService {
    /**
     * Returns a user by id
     * @param {string} id - user identifier
     * @return {Promise<{ id: string; name: string } | null>}
     */
    @expose()
    public async get(id: string): Promise<{ id: string; name: string } | null> {
        return { id, name: 'Jane Doe' };
    }
}
```

Because the service is self-describing, a fully typed client can be **generated** from it — you never write the client by hand:

```bash
imq client generate UserService
```

```ts
const client = new UserServiceClient();
await client.start();
const user = await client.get('42'); // typed, autocompleted, no HTTP in sight
```

If `UserService.get` changes its signature, you regenerate the client and the type error shows up at compile time in every caller — the same safety a monorepo gives you, but across independently deployed services.

## What you give up

This isn't free of trade-offs, and it's worth being honest about them:

- **The message queue is now in the hot path.** @imqueue needs a running queue; for most teams that infrastructure is already there, and if it isn't, that's a real addition to operate.
- **It's request/response over a broker, not a streaming protocol.** If you need bidirectional streaming or HTTP/2 semantics, this isn't that.
- **It's a Node.js/TypeScript-first tool.** If you need first-class clients in Go, Rust, and Python too, a cross-language protocol like gRPC will fit better.

## When it's the right call

Reach for queue-based RPC when your internal services are Node.js/TypeScript, you want typed calls without maintaining clients, and you'd rather not run discovery and load-balancing infrastructure just so services can find each other. That's the sweet spot `@imqueue` was built for.

If that sounds like your architecture, the [Getting Started](/get-started/) guide takes you from an empty terminal to a running service and a generated client in a few minutes, and the [Tutorial](/tutorial/) builds a complete example app one service at a time.
