---
layout: post.html
permalink: /blog/versioning-microservices-without-breaking-callers/
templateEngineOverride: md
title: "Versioning microservices without breaking every caller"
summary: "A change to one service's method quietly breaks the services that call it — and you find out in production. Here's how to make breaking changes loud at build time, which changes are actually safe, and how to handle the window where both versions are live."
description: "How to version Node.js microservices without silently breaking callers: turning contract changes into compile errors with regenerated clients, which changes are additive, and surviving the mixed-version deploy window."
keywords: "microservice versioning nodejs, breaking change microservices, coordinate service releases, api versioning, imqueue"
date: 2026-07-02
dateModified: 2026-07-29
author: serhiy-morenko
illustration: versioning
topics: [versioning, types, dx]
ogType: article
---

**Breaking changes between services are dangerous because they're silent: the caller keeps compiling against its old idea of the contract and fails at runtime instead.** Making them safe is mostly about making them *loud* — early, and at build time. Generated clients get you most of the way by turning a contract change into a compile error, but they don't cover the window where both versions are running at once, and that window is where the actual outages happen.

## Why breakage goes silent

In a typical setup the caller's knowledge of a service is a hand-maintained client, or assumptions baked into request code. When the service changes, nothing forces the caller to notice:

- The caller still compiles against its old idea of the contract.
- Tests pass, because they test the caller against its own — now stale — assumptions.
- The mismatch surfaces only when a real call hits the changed service. In production, usually, and far from the change that caused it.

The root cause is the one behind so much microservice pain: the contract lives in two places and nothing checks that they agree. [Generated clients remove the copy](/blog/stop-hand-writing-microservice-clients/), which is where this gets tractable.

## Make breakage a compile error

Because `@imqueue` clients are generated from the service, the contract has one source of truth, and you can turn a breaking change into a build failure:

1. Change the service method.
2. Regenerate the client — `imq client generate <name> [path]`.
3. Every caller whose usage no longer matches **fails to compile.**

```typescript
// Service change: `get(id: string)` becomes `get(id: string, opts: GetOpts)`.
// After regenerating, this caller no longer compiles — you find out in CI,
// not at 2 a.m. in production:
const user = await users.get('42'); // TS2554: expected 2 arguments, but got 1
```

The compiler becomes your integration test for contract changes. You still decide *how* to evolve the API; you just can't do it silently any more.

Two limits worth stating plainly, because they're easy to over-read:

- **The error arrives at regeneration, not at deploy.** Nothing detects that a running peer has drifted from a client generated last month. If regeneration isn't wired into the service's release process, you've bought a slower version of the same problem.
- **It's a compile check, not a runtime one.** A caller that never recompiles keeps calling the old shape. Which brings us to the part most articles skip.

## The mixed-version window

This is where real incidents come from, and no amount of type generation removes it.

Between the moment you deploy service B v2 and the moment every caller has been regenerated and redeployed, **both versions of the contract are live**. With a queue in between, that window has a specific shape:

- Messages sent by an old caller may be consumed by a **new** instance of B.
- Because delivery is **at-least-once** and instances compete on the same queue, you don't control which version handles which message. A rolling deploy means a mix.
- Anything already queued when you deploy will be handled by whatever consumes it next — which may be the new code.

So the rule is not "regenerate and ship". The rule is: **a service must be able to handle requests from the previous contract for as long as any caller might still send them.** That's ordinary API compatibility discipline, and the queue makes it non-optional rather than merely advisable.

Practical consequence for deploy order: ship the *service* first, in a backward-compatible form, then the callers. Never the reverse — a caller sending a v2-shaped request to a v1 service has nothing to fall back on.

## Which changes are actually safe

| Change | Safe? | Notes |
|---|---|---|
| Add a new exposed method | Yes | Nothing calls it yet |
| Add an **optional** parameter | Yes | Old callers omit it |
| Add a field to a returned object | Usually | Safe unless callers do exhaustive checks |
| Widen an input type | Yes | Accepting more is backward-compatible |
| Add a **required** parameter | **No** | Old callers fail argument validation |
| Rename a method or parameter | **No** | Old callers call something that no longer exists |
| Remove a method | **No** | Deprecate first |
| Narrow an input type | **No** | Previously valid calls become invalid |
| Change a return type's shape | **No** | Callers destructure what isn't there |

One `@imqueue` specific: argument **count** is validated at the boundary, and a mismatch fails with `IMQ_RPC_INVALID_ARGS_COUNT`. So adding a required parameter isn't a subtle type problem — it's an immediate rejection for every old caller. That's arguably better than silent misbehaviour, but it's a hard break.

Also remember the `@param` tags in your doc-block *are* the contract. Changing the JSDoc without changing the signature is a contract change, and changing the signature without the JSDoc means the generated client won't reflect what you did.

## Deprecate, don't mutate

The pattern that avoids most of this:

1. Add the new method alongside the old one. Both exposed, both working.
2. Regenerate clients. Callers migrate at their own pace — nothing breaks, because nothing was removed.
3. Watch for calls to the old method.
4. Remove it once nobody calls it, and regenerate again.

Slower than editing in place, and much cheaper than an incident. For a method you can't cleanly duplicate, add an optional options object and branch on it — an optional parameter is backward-compatible, a required one isn't.

## Coordinating a fleet

Sometimes a change genuinely has to ripple across many services — a shared type, a cross-cutting dependency bump. Doing that by hand, repo by repo, is where mistakes get made. [`@imqueue/cli`](/cli/) includes a fleet-wide version workflow (`imq service update-version`, with `--bump`) to roll a version change across many services in a coordinated way rather than editing each one individually.

For the mechanics of running several services together while you do it, [isolated imq CLI environments](/blog/isolated-imq-cli-environments/) covers keeping fleets from colliding on one machine.

## A checklist for a contract change

- Is the change additive? If not, can it be expressed additively?
- Will the service accept the **old** shape for as long as old callers exist?
- Is the service deploying **before** its callers?
- Have you regenerated clients and let the compiler find the call sites?
- Is anything already sitting in the queue that the new code will consume?
- Are the JSDoc annotations updated alongside the signature?

## FAQ

**Do generated clients eliminate breaking changes?**
No. They make breaking changes *visible* at compile time after regeneration. They don't make an incompatible change compatible, and they don't cover callers that haven't recompiled.

**How do I version a service — v1/v2 method names, or separate services?**
For most changes, neither: add an optional parameter or a new method and deprecate the old one. Reach for a parallel `getV2` only when the shapes genuinely can't coexist in one signature, and treat it as debt to remove.

**What about messages already in the queue during a deploy?**
They'll be handled by whatever consumes them next, which may be the new code. That's the core reason a new version must still understand the old request shape.

**Can I run two versions of the same service at once?**
They'd compete on the same queue, so requests would be split between them unpredictably. If you need genuine version isolation, give the new version its own service name and route at the caller.

**How do I know a deprecated method is unused?**
Log calls to it and watch. There's no built-in usage tracking, so instrument the method before you plan its removal.

**Does @imqueue check the contract at runtime?**
It validates argument count and rejects mismatches with `IMQ_RPC_INVALID_ARGS_COUNT`. It doesn't deep-validate payload shapes — if you need schema validation, add it yourself.

---

Additive-by-default APIs, breakage surfaced at compile time by regenerated clients, and a deploy order that never puts callers ahead of services — that's a sane story for change. To see the generated-client model that makes it work, start with [**Getting Started**](/get-started/). Shipping inside a closed-source product? See [commercial licensing & support](/license/).
