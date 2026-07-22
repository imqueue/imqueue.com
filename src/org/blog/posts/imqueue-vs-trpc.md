---
layout: post.html
permalink: /blog/imqueue-vs-trpc/
templateEngineOverride: md
title: "tRPC vs @imqueue: client–server types vs service–service RPC"
summary: "tRPC gives you end-to-end types between a frontend and its backend. @imqueue gives you typed RPC between backend services over a queue. They solve adjacent — not competing — problems."
description: "How tRPC and @imqueue differ: tRPC for typed client-server calls over HTTP in a TypeScript monorepo, @imqueue for typed service-to-service RPC over a message queue."
keywords: "trpc vs imqueue, trpc alternative backend, typed rpc typescript, service to service rpc, imqueue, monorepo types"
date: 2026-06-14
author: andrii
illustration: boundaries
topics: [comparison, types, rpc]
ogType: article
---

[tRPC](https://trpc.io/) is loved for a good reason: in a TypeScript monorepo it gives you end-to-end type safety from your backend to your frontend with no code generation and no schema. People sometimes ask whether `@imqueue` is "tRPC for microservices." It's a useful comparison, as long as you keep the two problems distinct. (tRPC details reflect its documented behavior at the time of writing.)

## What tRPC is for

tRPC shines at the **client–server** boundary — typically a web frontend calling its own backend. You define routers and procedures on the server, and the client infers their types directly from the server's types through a shared TypeScript project. The transport is usually HTTP (with WebSocket support for subscriptions). The magic is that there's no build step: type inference does the work, as long as both sides share the same TypeScript types at compile time.

That last condition is the key constraint. tRPC's inference relies on the client being able to `import type` from the server — which is natural in a monorepo where frontend and backend are compiled together, and awkward or impossible across independently deployed, independently versioned services.

## What @imqueue is for

`@imqueue` targets the **service–service** boundary: backend services calling each other, often deployed separately, over a message queue rather than HTTP. It doesn't rely on a shared compile-time project. Instead, each service is self-describing at runtime, and a typed client is **generated** from the service's description. That generated client can live in a different repository, ship on its own schedule, and still be regenerated when the service changes.

So the distinction is:

- **tRPC:** compile-time type *inference* across a shared project → ideal frontend ↔ backend.
- **@imqueue:** runtime self-description → *generated* typed client → ideal service ↔ service.

## Transport and coupling

tRPC runs over HTTP, which is exactly right for reaching a backend from a browser. @imqueue runs over a message queue, which is exactly right for internal traffic — no per-service addressing, competing-consumer load balancing, and natural back-pressure — but not something a browser talks to directly.

They can coexist cleanly in one system: tRPC (or plain HTTP) at the edge for your client apps, @imqueue between the services behind it.

## Quick comparison

| | @imqueue | tRPC |
|---|---|---|
| Primary boundary | Service ↔ service (backend) | Client ↔ server (often frontend ↔ backend) |
| Transport | Message queue | HTTP / WebSocket |
| How types cross | Client generated from the service | Compile-time inference via shared project |
| Deployment coupling | Independent repos/services | Best in a shared monorepo |
| Load balancing | Competing consumers on a queue | Whatever fronts your HTTP server |

## How to choose

- **Use tRPC** to connect a TypeScript frontend to its backend with zero-boilerplate inferred types in a monorepo.
- **Use @imqueue** to connect backend services to each other with typed, queue-based RPC when they're deployed and versioned independently.
- **Use both** in the same architecture — they're solving different halves of the problem.

If the service-to-service half is what you're wrestling with, [Getting Started](/get-started/) shows the generated-client workflow end to end.
