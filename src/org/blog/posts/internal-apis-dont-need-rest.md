---
layout: post.html
permalink: /blog/internal-apis-dont-need-rest/
templateEngineOverride: md
title: "Internal APIs don't need to be REST"
summary: "REST is a fine choice for public, resource-oriented APIs. For internal service-to-service calls it's often ceremony over a plain function call. Here's when to drop it and what to reach for instead."
description: "Why REST is often the wrong fit for internal Node.js service-to-service APIs, and when function-call (RPC) semantics are simpler — a concept-level look, with @imqueue as one answer."
keywords: "internal api rpc, rest for internal services, service to service calls nodejs, rpc vs rest concept, imqueue"
date: 2026-06-27
author: andrii
illustration: rest-vs-rpc
topics: [rpc, architecture, comparison]
ogType: article
---

REST won the public web for good reasons: resources, uniform verbs, cacheability, and a shared vocabulary every client understands. But a lot of teams then apply REST to their *internal* service-to-service calls out of habit — and internally, most of what you're doing isn't manipulating resources. It's calling a function in another process. This is a concept post, not a product pitch: when is REST the wrong shape for an internal API, and what fits better?

## The impedance mismatch

Internal calls are usually verbs, not nouns. "Calculate this price." "Send this notification." "Reserve this inventory." Forcing those through resource-and-verb REST creates friction:

- **Modeling actions as resources.** "Calculate a price" becomes `POST /price-calculations`, inventing a resource that exists only to host an action.
- **Status-code semantics.** You map domain outcomes onto HTTP codes, then callers translate them back — is a 404 "no such user" or "route not found"? A 409 "already exists" or something else?
- **Untyped by default.** A route returns whatever it returns; the caller re-parses JSON and hopes the shape matches. Type safety is bolted on with generators and annotations.
- **Addressing overhead.** Each call needs a host, which drags in discovery and load balancing just so services can find each other.

None of this is fatal, but it's a lot of ceremony around "run this function over there and give me the result."

## RPC: model the call as a call

For internal traffic, RPC (remote procedure call) semantics fit the intent directly: you call a method, you get a typed result. No resource modeling, no status-code translation layer, no re-parsing. The mental model is "a function that happens to run elsewhere."

`@imqueue` is one way to do this in Node.js/TypeScript: a service exposes methods, and callers invoke them through a generated, typed client.

```ts
// Instead of POST /price-calculations and parsing a response body:
const { total } = await pricing.quote(cart); // a typed method call
```

`quote` returns a typed value or throws a typed error — the same ergonomics as calling a local function, which is what an internal call *is*. Addressing, balancing, and serialization are handled underneath, so there's no host to resolve and no body to hand-parse.

## When REST is still the right call

This isn't "REST is bad." It's "match the tool to the boundary":

- **Public / third-party APIs** — REST's ubiquity, cacheability, and tooling are real advantages. Keep it at the edge.
- **Genuinely resource-oriented interfaces** — CRUD over well-defined resources maps cleanly to REST; don't fight that.
- **Browser-facing endpoints** — browsers speak HTTP; that's the front door.

The point is just to stop *defaulting* to REST for internal calls that are really function calls. At your edge, REST. Between your services, consider whether a typed RPC call says what you mean with less ceremony. If that resonates, [Getting Started](/get-started/) shows the RPC-style model in practice.
