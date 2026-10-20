---
layout: post.html
permalink: /blog/request-deadlines-queued-calls-nodejs/
templateEngineOverride: md
title: "Deadlines for queued calls: stop doing work for callers who already gave up"
summary: "When a service behind a queue goes down, its callers time out, but their calls don't disappear. They wait in the queue, and when the service comes back it works through every one of them. We took a billing service down for 20 seconds: the customers whose checkout said “payment failed” were all charged anyway, and every retried order was charged twice. Here is why that happens, the twenty lines that stop it, and what a queue does instead of a circuit breaker. Every number is measured."
description: "A measured recipe for request deadlines with @imqueue/rpc: why calls that timed out still run when a service comes back, how a 20-second outage turned 95 successful orders into 265 charges, and how a deadline carried in IMQMetadata and checked in a wrapCall hook makes the service skip work nobody is waiting for."
keywords: "request deadline microservices, deadline propagation nodejs, timeout vs deadline, stale requests message queue, retry duplicate charge, timed out request still processed, circuit breaker message queue, imqueue calltimeout, imqueue wrapcall"
date: 2026-10-20
author: andrii
illustration: call-deadline
topics: [resilience, delivery, backpressure]
ogType: article
---

The billing service went down at 14:00 and came back 20 seconds later. Nobody
lost any data: the calls made during those 20 seconds waited in the queue, and
the service handled every one of them the moment it returned. That is the whole
promise of putting a queue between services, and it worked.

The trouble is in what "every one of them" means. The checkout page that sent
those calls had a 2-second timeout. It told the customer "payment failed,
please try again" long before billing came back. Some customers tried again.
Then billing came back and charged all of them, the first attempt and the
second.

A queue holds on to a call until it is handled, whether or not anyone is still
waiting for the answer. This post shows how much that costs after an ordinary
outage, and how to give each call a deadline so the service skips the work
nobody is waiting for.

**Everything below was measured** with `@imqueue/rpc` 3.9.5 and
`@imqueue/core` 3.5.4 against Redis 8. The setup was a billing service, and a
caller placing one order every 200 ms with a 2-second timeout and one retry.
Billing was stopped for 20 seconds in the middle of a 35-second run.

## The short version

- **A timeout ends the wait, not the call.** The call stays in the queue and is
  handled when the service returns.
- **After a 20-second outage, 95 orders succeeded and 265 charges were made.**
  80 customers who were told "payment failed" were charged anyway, and 90
  retried orders were charged twice.
- **Give each call a deadline.** The caller writes "I'll wait until 14:00:07"
  into the call's metadata, and the service checks it before doing any work.
- **With deadlines, the same run made exactly 95 charges.** 170 expired calls
  were skipped without running.
- **Deadlines don't replace idempotency.** A call can still be handled
  twice when it is retried while the first attempt is mid-run.

## A timeout ends the wait, not the call

Here is what happens to one call, step by step:

1. The caller sends `charge('o-42')`. The message goes into Billing's queue.
2. Billing is down, so nothing takes it.
3. After 2 seconds the caller's
   [`callTimeout`](/api/rpc/latest/rpc.imqclientoptions.calltimeout/) fires,
   and its promise rejects with `IMQ_RPC_CALL_TIMEOUT`. The checkout shows an
   error.
4. **The message is still in the queue.** Nothing in step 3 touched it.
5. Billing comes back, takes the message, and charges order `o-42`.
6. Billing sends a reply that nobody receives.

With an HTTP call the outage would have looked different. Connections would
have been refused, and nothing would have been charged later. With a queue the
call outlives its caller. Most of the time that is exactly what you want:
nothing is lost while a service restarts. It goes wrong only when the caller
has already decided the call failed, and acted on that.

## What one outage cost

Same caller, same billing service, 175 orders over 35 seconds, billing down for
20 of them:

| | result |
|---|---|
| orders the caller saw succeed | 95 |
| orders the caller saw fail | 80 |
| orders the caller retried | 90 |
| **charges billing actually made** | **265** |
| orders charged twice | 90 |
| orders charged although the caller saw "failed" | 80 |

Every order the caller gave up on was charged anyway. Every order the caller
retried was charged twice: once for the attempt that timed out and waited, once
for the retry.

It also happened all at once. Within one second of coming back, billing made
195 charges: the backlog of calls from the last 20 seconds, the oldest of them
18 seconds past the point where anyone was waiting. In normal running, the
busiest second had 25.

New orders didn't suffer in this test: the first orders after the restart were
answered in about 22 ms, because billing worked through the backlog quickly. A
slower service, or a longer outage, would make new callers wait behind the old
ones too.

## Recipe 1: send a deadline with every call

The caller knows exactly how long it will wait: that is its `callTimeout`. The
fix is to tell the service. Every call can carry a small bag of facts,
[`IMQMetadata`](/api/rpc/latest/rpc.imqmetadata/), next to its arguments, and a
client's [`beforeCall`](/api/rpc/latest/rpc.imqclientoptions.beforecall/) hook
can add one to every call it makes:

```typescript
import { IMQMetadata } from '@imqueue/rpc';

const TIMEOUT = 2000;

const billing = new BillingClient({
    callTimeout: TIMEOUT,
    beforeCall: async req => {
        req.metadata = new IMQMetadata({
            ...(req.metadata ?? {}),
            deadline: Date.now() + TIMEOUT,
        });
    },
});
```

Two choices in that hook matter:

- **It's a deadline, not a timeout.** A timeout ("wait 2 seconds") means
  nothing to a service that receives the call 15 seconds late. A deadline
  ("until 14:00:07") still means exactly the same thing, however long the call
  waited in the queue.
- **It merges into the metadata instead of replacing it,** so it works next to
  anything else that uses the same bag, such as tracing or a request ID. The
  [request context post](/blog/request-context-across-services-nodejs/) covers
  that pattern.

A retry goes through the same hook, so it gets a fresh deadline of its own.

## Recipe 2: check the deadline before doing any work

On the service side, the check belongs in one place that runs before every
method. That is [`wrapCall`](/api/rpc/latest/rpc.imqserviceoptions.wrapcall/),
a hook that wraps each method call and decides whether to run it:

```typescript
import {
    IMQError, IMQService, currentMetadata,
} from '@imqueue/rpc';

async function skipExpired(req, res, next) {
    const deadline = Number(currentMetadata()?.deadline);

    if (deadline && Date.now() > deadline) {
        throw IMQError(
            'DEADLINE_EXCEEDED',
            'the caller stopped waiting',
            '', req.method, req.args,
        );
    }

    return next(); // runs the method
}

const service = new Billing({ wrapCall: skipExpired });
```

[`currentMetadata()`](/api/rpc/latest/rpc.currentmetadata/) returns the bag the
caller sent. A call without a deadline runs as before, so services can adopt
this one caller at a time.

Throwing is deliberate. The error travels back as an ordinary error reply, with
its code preserved, so a caller that is somehow still listening learns why. In
practice nobody is, and the reply is dropped. What matters is that the method
never ran.

Same run, with both recipes in place:

| | without deadlines | with deadlines |
|---|---|---|
| orders the caller saw succeed | 95 | 95 |
| orders the caller saw fail | 80 | 80 |
| charges billing made | 265 | **95** |
| orders charged twice | 90 | **0** |
| charged although the caller saw "failed" | 80 | **0** |
| expired calls skipped, unrun | 0 | 170 |
| most charges in any one second | 195 | 25 |

The callers' view didn't change at all: the same 95 successes and the same 80
failures. What changed is that billing's charges now agree with what the
callers were told. The 170 skipped calls were between 0.2 and 18 seconds past
their deadlines when billing got to them, 8.6 seconds at the median.

## Recipe 3: keep idempotency anyway

A deadline stops a service from starting work too late. It doesn't stop work
that starts in time from finishing after the caller has given up. If billing is
slow rather than down, a call can begin at 1.9 seconds, the caller times out at
2, retries, and both attempts run.

So keep the usual protection as well: make the operation safe to repeat. For a
charge, that means using the order ID as an idempotency key, so a second charge
for the same order returns the first receipt instead of charging again. The
[guaranteed delivery post](/blog/guaranteed-message-delivery-cost/) explains why
every handler behind a queue should be written this way: the queue delivers at
least once, and an outage is one of the ways "once" becomes "twice".

The two fixes cover different gaps:

| problem | deadline | idempotency key |
|---|---|---|
| work for a caller who already gave up | stops it | doesn't help |
| a retry while the first attempt is running | doesn't help | stops it |
| a burst of old work after a restart | stops it | doesn't help |

## Two details worth getting right

**Clocks.** The deadline is an absolute time written by one machine and checked
by another, so their clocks have to agree. Servers synchronised with NTP are
normally within a few milliseconds of each other, which is far smaller than any
sensible timeout. If you can't rely on that, add a margin when checking:
`Date.now() > deadline + 100`.

**Delayed calls.** A call sent with
[`IMQDelay`](/api/rpc/latest/rpc.imqdelay/) is meant to run later, and the
client's `callTimeout` already adds the delay to its wait. Add the delay to the
deadline too, or a deliberately delayed call will be skipped as expired.

## What a queue does in place of a circuit breaker

A circuit breaker is the usual answer to a failing service when calls go over
HTTP. After enough failures, it stops sending calls for a while and fails them
immediately, so a struggling service isn't buried under retries and callers
don't wait for answers that won't come.

Behind a queue, most of that job is already done or doesn't apply:

- **The service isn't buried.** Calls wait in the queue instead of piling onto
  the service's connections, and it takes them at its own pace when it returns.
- **Callers stop waiting on their own,** with `callTimeout`.
- **What a breaker would add** is not sending the call at all. And the problem
  we measured isn't that calls are sent. It's that they're handled after they
  stopped mattering, which is what deadlines fix.

A breaker still makes sense for calls that leave your system, such as a
payment provider's HTTP API, where none of the above applies. `@imqueue` ships
none; the [RPC over Redis FAQ](/blog/rpc-over-redis-nodejs/#is-there-a-circuit-breaker)
says what the queue gives you instead.

## FAQ

### Is the work still done after the caller's timeout?

Yes, behind a queue. A timeout only ends the caller's wait. The message stays
in the queue and is handled as soon as a worker picks it up, so the work happens
even though the caller already reported a failure.

### What is the difference between a timeout and a deadline?

A timeout is a duration ("wait 2 seconds"), measured from when the caller
started. A deadline is a point in time ("until 14:00:07"). A deadline keeps its
meaning when a call waits in a queue, so the service receiving it can tell
whether anyone is still waiting.

### How do I pass a deadline between Node.js services?

With `@imqueue/rpc`, add it to the call's `IMQMetadata` in a client
`beforeCall` hook, and check it in the service's `wrapCall` hook with
`currentMetadata()`, before the method runs. Neither the method signatures nor
the generated clients change.

### Why were customers charged twice after an outage?

Because the first attempt didn't disappear when it timed out. It waited in the
queue next to the retry, and the service handled both when it came back. In our
test, all 90 retried orders were charged twice.

### Do deadlines replace idempotency?

No. A deadline stops work that would start too late. An idempotency key stops
the same work from happening twice when a retry overlaps a slow first attempt.
Use both.

## Reference

[`IMQClientOptions.callTimeout`](/api/rpc/latest/rpc.imqclientoptions.calltimeout/) ·
[`IMQClientOptions.beforeCall`](/api/rpc/latest/rpc.imqclientoptions.beforecall/) ·
[`IMQServiceOptions.wrapCall`](/api/rpc/latest/rpc.imqserviceoptions.wrapcall/) ·
[`IMQWrapCall`](/api/rpc/latest/rpc.imqwrapcall/) ·
[`IMQMetadata`](/api/rpc/latest/rpc.imqmetadata/) ·
[`currentMetadata()`](/api/rpc/latest/rpc.currentmetadata/) ·
[`IMQError()`](/api/rpc/latest/rpc.imqerror/) ·
[`IMQDelay`](/api/rpc/latest/rpc.imqdelay/) ·
[Request IDs and user context across services](/blog/request-context-across-services-nodejs/) ·
[Guaranteed delivery, tested with kill -9](/blog/guaranteed-message-delivery-cost/)
