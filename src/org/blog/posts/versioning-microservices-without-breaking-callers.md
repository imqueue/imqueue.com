---
layout: post.html
permalink: /blog/versioning-microservices-without-breaking-callers/
templateEngineOverride: md
title: "Versioning microservices without breaking every caller"
summary: "A change to one service's method quietly breaks the services that call it — and you find out in production. Here's how to make breaking changes loud at build time and coordinate releases across a fleet."
description: "Strategies for versioning Node.js microservices without silently breaking callers: compile-time breakage via regenerated typed clients and coordinated fleet-wide version bumps with @imqueue."
keywords: "microservice versioning nodejs, breaking change microservices, coordinate service releases, api versioning, imqueue"
date: 2026-07-02
author: serhiy-morenko
illustration: versioning
topics: [versioning, types, dx]
ogType: article
---

The scariest kind of change in a microservice system is a small one: you tweak a method's parameters on service B, deploy it, and three services that call B keep compiling, keep deploying, and start failing at runtime because their assumptions about B are now wrong. The failure is far from the change that caused it. Making these changes *safe* is mostly about making them *loud* — early, and at build time.

## Why breakage goes silent

In a typical setup, the caller's knowledge of a service is a hand-maintained client or a set of assumptions baked into request code. When the service changes, nothing forces the caller to notice:

- The caller still compiles against its old idea of the contract.
- Tests pass, because they test the caller against its own (now-stale) assumptions.
- The mismatch only shows up when a real call hits the changed service — in production, usually.

The root cause is the same one behind so much microservice pain: the contract lives in two places, and nothing checks that they agree.

## Make breakage a compile error

Because `@imqueue` clients are **generated from the service**, the contract has one source of truth, and you can turn a breaking change into a build-time failure. The workflow:

1. Change the service method.
2. Regenerate the client (`imq client generate <ServiceName>`).
3. Every caller whose usage no longer matches the new types **fails to compile.**

```ts
// Service change: `get(id: string)` becomes `get(id: string, opts: GetOpts)`.
// After regenerating the client, this caller no longer compiles —
// you find out now, in CI, not at 2 a.m. in production:
const user = await users.get('42'); // TS error: expected 2 arguments
```

That's the whole game: the compiler becomes your integration test for contract changes. You still decide *how* to evolve the API, but you can no longer do it *silently*.

## Prefer additive changes

Compile-time safety tells you when you broke something; good API discipline lets you avoid breaking it at all:

- **Add, don't mutate.** New optional parameters and new methods are backward-compatible; renaming or removing is not.
- **Widen inputs, keep outputs stable.** Accepting more is safer than returning differently.
- **Deprecate before deleting.** Keep the old method working while callers migrate to the new one, then remove it once regeneration shows no one uses it.

## Coordinating a fleet

Sometimes a change genuinely has to ripple across many services — a shared type, a cross-cutting bump. Doing that by hand, service by service, is error-prone. The [`@imqueue/cli`](/cli/) includes a fleet-wide version workflow (`imq service update-version`, with `--bump`) to roll a version change across many services in a coordinated way, rather than editing each repo individually.

Combined, these give you a sane story for change: additive-by-default APIs, breakage surfaced at compile time by regenerated clients, and a tool to coordinate the releases that must move together. To see the generated-client model that makes this work, start with [Getting Started](/get-started/).
