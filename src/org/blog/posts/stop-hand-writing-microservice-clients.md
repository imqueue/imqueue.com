---
layout: post.html
permalink: /blog/stop-hand-writing-microservice-clients/
templateEngineOverride: md
title: "Stop hand-writing and maintaining your microservice clients"
summary: "Every service you call needs a client, and hand-maintained clients drift out of sync with the services they talk to. Here's why that happens, how to make the client fall out of the service, and what the generated approach costs."
description: "Why hand-written microservice clients and SDKs rot, how self-describing services with generated typed clients keep callers in sync, and what it costs."
keywords: "generate typed api client typescript, stop writing api clients, sdk maintenance microservices, microservice client generation, imqueue"
date: 2026-07-17
dateModified: 2026-07-29
author: serhiy-morenko
illustration: generated-client
topics: [clients, types, dx]
ogType: article
---

**A hand-written client is a copy of a service's contract, kept somewhere else, maintained by hand — and copies drift.** The fix isn't more discipline; it's removing the copy. If the service describes itself and the client is generated from that description, there's exactly one source of truth, and a contract change becomes a compile error instead of a runtime surprise. That's the model `@imqueue` uses, and it has real costs worth knowing before you adopt it.

## Why hand-written clients rot

The problem isn't that clients are hard to write. It's that the contract lives in two places:

- A parameter becomes optional, or a return field is renamed — and the client still describes the old shape.
- Types are duplicated: the service defines `User`, the client re-declares `User`, and nothing forces them to agree.
- **The drift is invisible.** Nothing fails to compile. Callers get subtly wrong types until something breaks at runtime, usually in production, usually far from the change that caused it.

The usual remedies don't remove the copy, they just manage it:

| Remedy | Why it doesn't close the gap |
|---|---|
| "Remember to update the client" | Discipline degrades under deadline; nothing enforces it |
| A shared types package | Still a hand-maintained copy, now with its own release cycle |
| A schema language plus codegen | Three sources of truth — schema, service, client |
| Integration tests | Catches drift late, only on paths you thought to test |

Each is more process on top of the same underlying issue.

## Make the client fall out of the service

Have exactly **one** source of truth — the service — and derive the client from it. In `@imqueue` a service is an ordinary TypeScript class; you mark the methods you want reachable, and the framework builds the service's description from your code and its JSDoc:

```typescript
import { IMQService, expose } from '@imqueue/rpc';

export class UserService extends IMQService {
    /**
     * Returns a user by id
     *
     * @param {string} id - user identifier
     * @return {Promise<{ id: string; name: string } | null>}
     */
    @expose()
    public async get(id: string): Promise<{ id: string; name: string } | null> {
        return { id, name: 'Jane Doe' };
    }
}
```

You don't write the client. You generate it from the running service:

```bash
imq client generate UserService ./src/clients
```

```typescript
import { userService } from './clients/UserService.js';

const users = new userService.UserClient({ callTimeout: 5000 });
await users.start();

const found = await users.get('42'); // typed, autocompleted, no hand-written client
```

Two naming details, both of which bite: the module's **only** export is a namespace named after the service with a lower-case first letter, so there is no top-level `UserClient` to import on its own — and the class inside it is `UserClient`, not `UserServiceClient`, because the generator replaces a trailing `Service` with `Client` rather than appending.

Now there's no copy to drift. When `UserService.get` changes, you regenerate and every caller whose usage no longer matches **fails to compile** — the mistake surfaces at build time, in your editor, instead of at runtime in front of a customer.

## What it looks like in a real workflow

Generation needs the service running, because the client is built from the description the service reports. In practice that's a three-line loop, straight from the CLI guide:

```bash
# -s takes the repository name; `client generate` takes the service's CLASS name,
# because that is the queue the description request is addressed to.
imq ctl start -s user -c     # bring the service up and wait for readiness
imq client generate UserService ./src/clients
imq ctl stop -s user
```

Two shapes that work well around it:

- **Commit the generated client.** It becomes a reviewable artifact: a diff on the generated file *is* the contract change, visible in code review, versionable, and shippable on the caller's own schedule.
- **Regenerate in CI on the service's release**, and open a PR against consumers. The compile step then tells you which callers break, before anyone deploys.

Either way the client is a build output, not a hand-maintained module.

## What generated clients remove from your week

- **No SDK to publish and version by hand** for each service.
- **No duplicated type declarations** to keep in agreement.
- **No "did someone update the client?" ritual** in review.
- **No silent drift** — a breaking change is a compile error, not a 2 a.m. page.

## What it costs

Being straight about this matters more than the pitch, because the costs are real and mostly front-loaded.

**JSDoc is not documentation, it's the contract.** The generator reads your doc-block, not TypeScript's own type information, so:

- An undocumented parameter falls back to `any` in the generated client — you lose typing silently, exactly the failure mode you adopted this to avoid.
- The `@param` count must match the method's real arity, or calls fail with `IMQ_RPC_INVALID_ARGS_COUNT`.
- Consuming projects must compile with `removeComments: false`, or the generator has nothing to read.

**Some shapes aren't expressible.** Rest and spread parameters on exposed methods are a documented limitation — the generated client won't compile. Pass an array instead. Only methods can be exposed, not properties, and `@expose()` on a static method silently registers under a pseudo-class name and stays unreachable.

**Decorator order is load-bearing.** `@expose()` must sit innermost — closest to the method — when combined with `@lock()`, `@cache` or `@logged()`. Those replace the method with a `(...args)` wrapper, so applying `@expose()` after them records the rest parameter as the only argument and breaks both argument validation and the generated signature.

**The service has to be up to generate.** That's a real step on a fresh checkout and in CI, and it means client generation can't happen in a pure offline build.

**Generation is a moment in time.** Nothing detects that a *running* peer has drifted from the client you generated last month. The compile error only arrives when someone regenerates — which is why [versioning your service contracts](/blog/versioning-microservices-without-breaking-callers/) still matters.

None of these are dealbreakers, but the first one catches most newcomers: your doc-blocks are now load-bearing code.

## How this compares to the alternatives

Generated-from-the-service isn't the only way to get typed calls, and it isn't always the best one:

- **tRPC** infers types across a shared TypeScript project with no generation step at all. Better ergonomics, at the cost of needing both sides in one compilation unit — [the full comparison](/blog/imqueue-vs-trpc/).
- **gRPC** puts the contract in a `.proto`, which is language-neutral and reviewable independently of any implementation — worth it if your fleet isn't all Node, and [compared here](/blog/grpc-vs-message-queue-rpc/).
- **A shared types package** is fine when one team owns both sides and the release cadences already match.

The generated approach wins specifically when services are TypeScript, deployed independently, and owned by different people.

## Frequently asked questions about generated service clients

### Do I have to commit the generated client?
No, but it's usually worth it. Committed, the diff on that file is the contract change — visible in review, versioned with the caller.

### Does the service need to be running to generate a client?
Yes. The client is built from the description the running service reports, so generation requires the service up and Redis reachable.

### What happens if I forget to regenerate?
Your caller keeps compiling against the old shape and can fail at runtime — the same drift as a hand-written client. Generation removes the *copy*, not the need to regenerate on change. Wire it into the service's release process.

### Why is JSDoc required if TypeScript already has types?
The generator reads the doc-block rather than reflecting on types at runtime, which is why the annotations are mandatory and why `removeComments: false` matters. It's the main friction in the model.

### Can I hand-edit the generated client?
Don't. It's a build output and the next generation overwrites it — existing files are replaced silently. Put anything custom in a wrapper around it.

### Does this work across repositories?
Yes, and that's the point of generating rather than inferring. The client is an artifact, so callers can live anywhere and regenerate on their own schedule.

---

If maintaining a drawer full of clients is draining your team, this is the shape of the fix. [**Getting Started**](/get-started/) walks from an empty terminal to a generated client in a few minutes, and [type-safe service communication in TypeScript](/blog/type-safe-service-communication-typescript/) covers the typing model in more depth. Shipping inside a closed-source product? See [commercial licensing & support](/license/).
