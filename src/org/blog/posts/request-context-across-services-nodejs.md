---
layout: post.html
permalink: /blog/request-context-across-services-nodejs/
templateEngineOverride: md
title: "Request IDs and user context across Node.js services, without adding a parameter to every method"
summary: "A log line in your billing service says a charge failed. Which user? Which request? Billing cannot tell you, because nobody told it. Here is how to carry a request ID, the user and the tenant from the edge of your system through every service call it causes, read them anywhere in a handler, and pass them on automatically, plus the one place where that context must never decide the answer. Every behaviour is measured."
description: "A measured recipe for request context in a Node.js service fleet on @imqueue: attach a request ID and user with IMQMetadata at the edge, read it anywhere with currentMetadata(), forward it on every downstream call with a beforeCall hook, keep it isolated between concurrent requests, and why @lock and @cache must never depend on it."
keywords: "correlation id microservices nodejs, request id across microservices, pass request context between services, user context microservices nodejs, propagate request id nodejs, asynclocalstorage request context, imqueue metadata, imqueue currentmetadata, imqueue beforecall hook, tenant id across services"
date: 2026-10-09
author: serhiy-morenko
illustration: request-context
topics: [rpc, patterns, observability]
ogType: article
---

A customer writes in: their payment failed at 14:02. You open the billing
service's logs and find it straight away:

```text
14:02:11 charge failed: card declined
```

Now the questions start. Which customer? Which order? What else happened during
that same click, in the orders service that called billing, or in the gateway
that called orders? Billing has no idea. It received an amount and a card token,
and nothing else.

The usual first fix is to add a `requestId` or a `userId` parameter to the
method. Then to the method that calls it. Then to every method in between,
including the ones that have no use for it except to hand it on. Six months
later half your service interfaces carry a parameter that has nothing to do with
what the method does.

There is a better place for this kind of information: next to the call, not
inside it. This post shows how to do that with `@imqueue/rpc`:
- attach a request ID and the user once, at the edge;
- read them anywhere inside a service without changing a single signature;
- pass them on to every downstream call automatically.

It also shows the one thing this context must never be used for.

**Everything below was measured** with `@imqueue/rpc` 3.9.5 and
`@imqueue/core` 3.5.4 against Redis 8. The setup was three real processes: an
edge script, an Orders service, and a Billing service that Orders calls.

## The short version

- **Every call can carry a small bag of facts.** It's called `IMQMetadata`: a
  plain JSON object that travels next to the call's arguments.
- **A service reads it with `currentMetadata()`**, anywhere in the handler,
  however deep, without passing it around.
- **It does not travel on by itself.** When Orders called Billing, Billing saw
  nothing until we added one small client hook.
- **A `beforeCall` hook on the client forwards it.** Copy only the fields you
  own, and merge them into what the call already has.
- **Requests never see each other's context.** 100 concurrent calls with
  different IDs: zero mix-ups.
- **Context is never an input.** `@lock` and `@cache` ignore it, so a result that
  depends on the user must take the user as an argument. We watched Bob receive
  Alice's report.

## Three pieces

There are only three things to know:

| piece | where | what it does |
|---|---|---|
| [`IMQMetadata`](/api/rpc/latest/rpc.imqmetadata/) | the caller | the bag of facts sent with one call |
| [`currentMetadata()`](/api/rpc/latest/rpc.currentmetadata/) | the service | returns the bag of the request being handled |
| [`beforeCall`](/api/rpc/latest/rpc.imqclientoptions.beforecall/) | a client's options | runs before every call, so it can attach the bag |

The middle one is what makes this work. When a service receives a request, the
framework runs its handler inside
[`runWithRequest()`](/api/rpc/latest/rpc.runwithrequest/), which binds the
request to that piece of async work using Node's `AsyncLocalStorage`. Anything
the handler calls, awaits or schedules can then ask "which request am I part
of?" and get the right answer, without the request being passed along.

## Recipe 1: attach the context at the edge

The edge is wherever a request first enters your system, usually an HTTP
gateway in front of the services. That is where you know who the user is and
where a request ID should be created.

Every generated client method takes an optional `imqMetadata` argument after its
own arguments:

```typescript
import { randomUUID } from 'node:crypto';
import { IMQMetadata } from '@imqueue/rpc';

app.post('/orders', async (req, res) => {
    const metadata = new IMQMetadata({
        requestId: req.get('x-request-id') ?? randomUUID(),
        userId: req.user.id, // set by your auth middleware
        tenantId: req.user.tenantId,
    });

    res.json(await orders.place(req.body.item, metadata));
});
```

Reusing an incoming `x-request-id` header, when there is one, means the ID in
your logs is the same one your load balancer or the browser already has.

## Recipe 2: read it anywhere in a service

Inside Orders, the handler can read the bag directly:

```typescript
import { currentMetadata } from '@imqueue/rpc';

interface RequestContext {
    requestId?: string;
    userId?: string;
    tenantId?: string;
}

export const context = () =>
    (currentMetadata() ?? {}) as RequestContext;
```

Because the context is bound to the request, not to a function, the most useful
place to read it is somewhere generic, such as a logging helper:

```typescript
export function log(message: string): void {
    const { requestId = '-' } = context();

    console.log(`[${requestId}] ${message}`);
}
```

Now every line any code writes while handling a request carries that request's
ID, with no parameter added anywhere.

Two details about what arrives:

- **It's a plain object.** In the service, `currentMetadata()` is the JSON
  version of what the caller sent, not an `IMQMetadata` instance:
  `instanceof IMQMetadata` was `false`. Read its fields; don't check its class.
- **It went through JSON.** We sent a `Date` and a field set to `undefined`. The
  date arrived as the string `"2026-10-09T10:00:00.000Z"`, and the `undefined`
  field was gone. Send IDs and simple values.

Outside a request, at start-up, in a script or in a test, `currentMetadata()`
returns `undefined`. The helper above turns that into an empty object, so code
that runs in both places doesn't need two versions.

## Recipe 3: pass it on to every downstream call

Here is the measurement that surprises people. Orders received a bag and then
called Billing:

| how Orders called Billing | Orders saw | Billing saw |
|---|---|---|
| no metadata from the edge | nothing | nothing |
| edge sent `r-1 / alice`, plain client | `r-1 / alice` | **nothing** |
| edge sent `r-2 / alice`, client with the hook | `r-2 / alice` | `r-2 / alice` |

The bag belongs to one call. When a service makes a new call, that call starts
with an empty bag unless something fills it. That is deliberate: a service
should decide what it forwards, not leak everything it was given.

The `beforeCall` client option is the place to decide. It runs before every
call the client makes, with the request about to be sent, and it runs inside
the handler's context, so `currentMetadata()` still works there:

```typescript
// src/context.ts — shared by every client of this service
import { IMQMetadata, currentMetadata } from '@imqueue/rpc';

const FORWARD = ['requestId', 'userId', 'tenantId'];

export async function passContext(req: any): Promise<void> {
    const incoming: any = currentMetadata();

    if (!incoming) {
        return;
    }

    const pass: Record<string, unknown> = {};

    for (const key of FORWARD) {
        if (incoming[key] !== undefined) {
            pass[key] = incoming[key];
        }
    }

    // what this call set explicitly wins
    req.metadata = new IMQMetadata({
        ...pass,
        ...(req.metadata ?? {}),
    });
}
```

Give it to each client the service creates:

```typescript
const billing = new BillingClient({ beforeCall: passContext });
```

Two choices in that hook matter, and both were measured.

**It copies a list of fields, not the whole bag.** The bag can hold things that
belong to one hop only. The
[tracing integration](/blog/distributed-tracing-nodejs-message-queue/) stores the
caller's span under `clientSpan`, and forwarding that one would point the next
service at the wrong parent. We sent Orders a bag with `requestId`, `userId`,
`clientSpan` and an `internal` field. Billing received `requestId` and `userId`
only.

**It merges instead of replacing.** A call can still set its own metadata, and
the explicit value wins. Orders issued a refund on Alice's request, marked as
done by the system:

```typescript
await billing.charge(10, new IMQMetadata({ userId: 'system' }));
```

Billing saw `requestId: "r-10"` from Alice's request and `userId: "system"` from
the call itself. Merging is also what lets this hook and the tracing
integration both write to the same bag without undoing each other: each one
keeps the fields it didn't set.

## Recipe 4: trust it under load

Context bound to async work raises an obvious worry: with many requests in
flight, could one handler read another one's bag? We sent 100 calls at once,
each with its own `requestId`, each waiting a random time before calling
Billing. **Not one of the 100 came back with someone else's ID**, in Orders or in
Billing.

Two more cases behaved the same way:

- **A delayed call** (a call with
  [`IMQDelay`](/api/rpc/latest/rpc.imqdelay/), delivered 500 ms later) arrived
  with its metadata, and forwarded it to Billing.
- **Work scheduled by a handler** keeps the handler's context, even after the
  reply has gone. A handler set a 300 ms timer and returned. When the timer fired
  and called Billing, Billing still saw that request's ID.

The second one is usually what you want: a follow-up job is logged against the
request that caused it. It also means anything long-lived, such as a background
loop or a connection pool, should be started when the service starts, not
lazily during the first request, or it will carry that first request's identity
for the rest of its life.

## Recipe 5: context is never an input

This is the rule that matters most, and it comes from how two decorators work.

[`@lock`](/api/rpc/latest/rpc.lock/) makes identical concurrent calls share a
single run, and [`@cache`](/api/rpc/latest/rpc.cache/) returns a stored result
for a call it has seen before. Both decide that two calls are "the same" from the
class, the method and the **arguments**. Metadata is not an argument, so it
plays no part in either decision.

We measured what that means. A `report(day)` method behind `@lock` read the user
from the metadata. Alice and Bob asked for the same day at the same time:

| who asked | `forUser` in the answer | times the method ran |
|---|---|---|
| Alice | alice | 1 |
| Bob | **alice** | 1 (shared) |

Bob received Alice's report. Nothing failed and nothing was logged. When Bob
asked alone for another day, he got his own.

So the rule is simple: **if a value changes the answer, it is an argument.** A
per-user report is `report(userId, day)`, not `report(day)` reading the user
from the context. Keep the context for things that describe the request without
changing its result: IDs for logs, who to blame in an audit trail, how long the
caller has been waiting.

## Recipe 6: log every request once, on the service side

Services take hooks too, and they also run inside the request's context. A
service-side `beforeCall` saw the same metadata as the handler in our test. That
gives every service a single place to log what it is about to do:

```typescript
const service = new Orders({
    beforeCall: async req => {
        log(`→ ${req.method} from ${req.from}`);
    },
});
```

Because `log()` adds the request ID itself, this one line ties every incoming
call to the request that started it, in every service the request passes
through.

## What this does not do

- **It is not authentication.** Any process that can send to the broker can
  put any `userId` it likes into a bag. Verify the user once, at the edge, and
  restrict who may talk to the broker at all. The
  [ACL post](/blog/redis-acl-least-privilege-nodejs/) covers that.
- **It is not a trace.** A request ID tells you which log lines belong together.
  A trace also shows how long each step took and how they nest. For that, see
  [distributed tracing](/blog/distributed-tracing-nodejs-message-queue/); the
  two work side by side in the same bag.
- **It is not automatic.** Without a `beforeCall` hook, nothing is forwarded. That
  is the safe default, and one shared hook per service is all it takes.

## FAQ

### How do I pass a request ID between Node.js microservices?

Attach it to the call, not to the method's parameters. In `@imqueue/rpc`, pass
`new IMQMetadata({ requestId })` as the last argument of a client call. The
receiving service reads it with `currentMetadata()`, and a `beforeCall` hook on
its clients forwards it to the next service.

### Is the metadata forwarded to downstream services automatically?

No. Each call starts with an empty bag. When Orders called Billing without a
hook, Billing received nothing. Add a `beforeCall` hook that copies the fields
you want to forward.

### Can concurrent requests see each other's metadata?

No. Each request is bound to its own async work. With 100 concurrent calls,
each carrying a different ID, none received another one's.

### Does currentMetadata() work after an await, or in a timer?

Yes. It works after `await`, in a delayed call, and in a timer the handler
starts, even one that fires after the reply has been sent. It returns
`undefined` only outside a request: at start-up, in scripts and in tests.

### Why did a user get someone else's result?

Probably because a method behind `@lock` or `@cache` reads the user from the
metadata. Both treat calls with the same arguments as the same call, whatever
their metadata says. Make anything that changes the result an argument.

### What can I put in IMQMetadata?

JSON values: strings, numbers, booleans, arrays and plain objects. The bag goes
through JSON on the way, so a `Date` arrives as a string and a field set to
`undefined` disappears.

### Should I put the user ID in metadata or in the arguments?

Both have a place. Put it in the metadata when it only describes the request:
logs and audit trails. Make it an argument when it changes the answer: a
per-user query, a permission check.

## Reference

[`IMQMetadata`](/api/rpc/latest/rpc.imqmetadata/) ·
[`currentMetadata()`](/api/rpc/latest/rpc.currentmetadata/) ·
[`runWithRequest()`](/api/rpc/latest/rpc.runwithrequest/) ·
[`IMQRPCRequest`](/api/rpc/latest/rpc.imqrpcrequest/) ·
[`IMQClientOptions.beforeCall`](/api/rpc/latest/rpc.imqclientoptions.beforecall/) ·
[`IMQBeforeCall`](/api/rpc/latest/rpc.imqbeforecall/) ·
[`IMQDelay`](/api/rpc/latest/rpc.imqdelay/) ·
[`@lock`](/api/rpc/latest/rpc.lock/) ·
[`@cache`](/api/rpc/latest/rpc.cache/) ·
[Distributed tracing over a message queue](/blog/distributed-tracing-nodejs-message-queue/)
