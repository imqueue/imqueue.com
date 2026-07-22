---
layout: post.html
permalink: /blog/stop-hand-writing-microservice-clients/
templateEngineOverride: md
title: "Stop hand-writing and maintaining your microservice clients"
summary: "Every service you call needs a client, and hand-maintained clients drift out of sync with the services they talk to. Here's why that happens and how to make the client fall out of the service for free."
description: "Why hand-written microservice clients and SDKs rot, and how self-describing services with generated typed clients keep callers in sync automatically."
keywords: "generate typed api client typescript, stop writing api clients, sdk maintenance microservices, microservice client generation, imqueue"
date: 2026-07-21
author: dan-ivanov
illustration: generated-client
topics: [clients, types, dx]
ogType: article
---

Here's a pattern almost every microservice team ends up in. You build a service. Then, so other teams can call it, you write a client — a little SDK that knows the method names, the argument shapes, and the return types. You publish it. Weeks later the service changes, and now there are two things to update instead of one. Multiply that by every service in the fleet and you have a standing maintenance tax that never goes away.

## Why hand-written clients rot

The problem isn't that clients are hard to write. It's that a client is a **copy** of the service's contract, kept in a different place, maintained by hand. Copies drift:

- A parameter becomes optional, or a return field is renamed — and the client still describes the old shape.
- Types are duplicated: the service defines `User`, the client re-declares `User`, and nothing forces them to agree.
- The drift is invisible. Nothing fails to compile; callers just get subtly wrong types until something breaks at runtime, usually in production.

Teams try to fix this with discipline ("remember to update the client!"), shared type packages (still a hand-maintained copy), or a schema language plus a code-generation step (a third source of truth to keep in sync). All of these are more process layered on top of the same underlying issue: the contract lives in two places.

## Make the client fall out of the service

The fix is to have exactly **one** source of truth — the service — and derive the client from it. `@imqueue` works this way. A service is an ordinary TypeScript class; you mark the methods you want reachable, and the framework builds the service's description from your code and its JSDoc:

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

You don't write the client. You generate it from the running service:

```bash
imq client generate UserService
```

```ts
const users = new UserServiceClient();
await users.start();
const user = await users.get('42'); // typed, autocompleted, no hand-written client
```

Now there's no copy to drift. When `UserService.get` changes, you regenerate the client and every caller whose usage no longer matches **fails to compile** — the mistake surfaces at build time, in your editor, instead of at runtime in front of a customer.

## What this removes from your week

- **No SDK to publish and version by hand** for each service.
- **No duplicated type declarations** to keep in agreement.
- **No "did someone update the client?" ritual** in code review.
- **No silent drift** — a breaking change is a compile error, not a 2 a.m. page.

## One thing to know

Because the types come from your JSDoc (`@param`/`@return`), keeping those tags accurate is part of the job — an undocumented parameter falls back to `any` in the generated client. That's a small, healthy discipline: your documentation and your wire contract are the same artifact, so they can't disagree.

If maintaining a drawer full of clients is draining your team, this is the shape of the fix. The [Getting Started](/get-started/) guide walks from an empty terminal to a generated client in a few minutes.
