---
layout: post.html
permalink: /blog/graceful-shutdown-zero-drop-deploys/
templateEngineOverride: md
title: "Graceful shutdown and zero-drop deploys"
summary: "Every deploy sends a kill signal to a process that is probably in the middle of something. Nothing 500s, no dashboard turns red, and the work is gone anyway. Here's what actually happens to an in-flight message on SIGTERM, and the built-in drain that keeps it."
description: "Shut down Node.js queue consumers without losing in-flight work: what SIGTERM does to a message mid-process, how to drain, and how to size a grace period."
keywords: "graceful shutdown nodejs, zero downtime deploy microservices, sigterm nodejs worker, drain in-flight requests, rolling deploy message queue, IMQ_DRAIN_ENABLE, imqueue"
date: 2026-07-28
author: andrii
illustration: shutdown
topics: [resilience, queue, patterns]
ogType: article
---

Every deploy is a kill signal aimed at a process that is probably busy. The
orchestrator sends `SIGTERM` to the old instance, starts a new one, and moves on.
The interesting question isn't whether the new version comes up — it's what
happened to the message the old one was holding.

Usually the answer is that it vanished, and that nothing said so. No request
failed, because there was no request to fail: the caller is still waiting on a
promise that will never settle. Deploy dashboards stay green. This is why
graceful shutdown keeps getting filed as a nice-to-have: it's a reliability
problem whose only symptom is *silence*.

## What a consumer has to do on the way out

Three steps, and only one of them takes real thought:

1. **Stop taking new work.**
2. **Finish what's already in hand.**
3. **Let go of the connections and exit.**

For an HTTP service, step 1 is "stop listening" and step 2 mostly happens for
you — the server knows what a request is, so it can count them. A queue consumer
has no request object and no connection per unit of work. It has a loop that
pops messages, and once a message is popped, the only thing that knows the work
exists is your own handler.

## The signals are already taken

The first surprise when you go to wire this up in `@imqueue` is that the signals
are not free. `IMQService` and `IMQClient` register handlers for `SIGTERM`,
`SIGINT`, `SIGHUP` and `SIGQUIT` in their constructors, and the Redis-backed
queue adds its own for `SIGTERM`, `SIGINT` and `SIGABRT` when you call `start()`
— that last set governed by
[`handleSignals`](/api/core/latest/core.imqoptions.handlesignals/), on by
default.

That's a genuinely good default. A service that never thinks about shutdown
still releases its watcher lock and closes its Redis connections on the way out,
rather than leaving them for a timeout to reap. What it does *not* do is wait for
your work.

Here is a service whose only method takes three seconds, sent `SIGTERM` 50 ms
after the handler started:

~~~
HANDLER START  ...548
SIGTERM        ...598   (2.5s of work still outstanding)
PROCESS EXIT code=0 at ...602
~~~

Twenty milliseconds. `HANDLER DONE` never printed, no reply was ever published,
and the exit code was a clean `0` — the deploy looked fine.

It's worth knowing why it's 20 ms and not the one second you might expect.
`IMQService`'s handler kicks off `destroy()` without awaiting it and schedules a
hard exit at `IMQ_SHUTDOWN_TIMEOUT` (1000 ms by default). The queue's own handler
runs immediately after, finds nothing left to release, and calls `process.exit()`
on the next microtask. The exact timing doesn't matter much, though, because
neither path waits for a handler: there is no ack, no in-flight counter, and no
drain hook anywhere in the framework.

That was the whole story until `@imqueue/rpc` 3.8, which ships the drain itself
behind an opt-in. Steps 1 and 2 are now a flag rather than code you write — but
the levers underneath it are unchanged, and they are worth knowing either way.

## Two levers, and the order matters

- **`service.stop()`** drops the reader connection and nothing else. Consumption
  stops; the writer stays up, so a handler that is still finishing can publish
  its reply. That is exactly step 1.
- **`service.destroy()`** tears the transport down — and also deregisters the
  signal handlers `IMQService` installed, which is what allows a shutdown of your
  own to reach its end.

Getting these backwards is the classic mistake: `destroy()` first closes the very
connection your in-flight reply still needs.

## Turning the drain on

One environment variable:

~~~bash
IMQ_DRAIN_ENABLE=1
~~~

That is the whole opt-in. `SIGTERM` and `SIGINT` now run the sequence above in
the order above: log the drain and how much is in flight, `stop()`, wait for the
outstanding handlers, `destroy()`, exit `0`.

The same service as before — the same three-second method, the same `SIGTERM`
50 ms in — with the flag set:

~~~
HANDLER START  ...110
SIGTERM        ...160   (2.95s of work still outstanding)
HANDLER DONE   ...111  (+2951ms)
REPLY SENT     ...112
PROCESS EXIT code=0
~~~

The reply is the point. The work didn't just finish, it finished *visibly*: the
caller's promise settled instead of hanging for the life of its process.

Both controls are also constructor options, for services that would rather
configure in code than in the environment:

~~~typescript
import { IMQService, expose } from '@imqueue/rpc';

class OrderService extends IMQService {
    @expose()
    public async placeOrder(order: Order): Promise<Receipt> {
        // no wrapper, no registration — every @expose()d method is tracked
    }
}

const service = new OrderService({ drain: true, drainTimeout: 4000 });

await service.start();
~~~

| control | option | default |
|---|---|---|
| enable draining | `drain` | `IMQ_DRAIN_ENABLE`, itself `0` |
| drain budget, ms | `drainTimeout` | `IMQ_DRAIN_TIMEOUT`, itself `4000` |

Both variables are read numerically, the same as the rest of the `IMQ_*` family
— and a value that isn't a number throws at construction rather than quietly
reading as *off*, because `IMQ_DRAIN_ENABLE=true` coercing to `NaN` and
disabling the feature is precisely the failure worth being loud about.

### What the opt-in changes, and what it doesn't

Left off — the default — nothing moves. The signal handlers, the timing and the
dispatch path are what they have always been, down to the tracking set that is
never allocated. This is a feature you turn on, not a behaviour that changes
under you on upgrade.

Turned on, three things follow:

- **Every exposed method is tracked, automatically.** Tracking sits at the one
  point where an incoming message is dispatched, so there is no per-method
  wrapper to add — and therefore no method anyone can forget to wrap, which is
  the failure this exists to remove. The bookkeeping watches a *derived*
  promise, so a handler's rejection stays its caller's to handle and never
  surfaces as an unhandled rejection.
- **The drain takes over the framework's own signal handlers.** All of them, and
  only them: `IMQService`'s fixed-timer handler, any client's in the same
  process, each removed by the exact function reference that was registered.
  Handlers belonging to unrelated libraries are left alone, which is the part
  `process.removeAllListeners()` cannot do.
- **The queue's handler is suppressed.** Enabling the drain forces
  [`handleSignals: false`](/api/core/latest/core.imqoptions.handlesignals/) on
  the service's queue, since that handler exits the process without waiting and
  would otherwise cut the drain short from the side.

A second signal during a drain exits immediately — the double-interrupt
convention, for when you have changed your mind about waiting.

### Doing it by hand

On a release older than 3.8, or draining work that isn't an `@expose()`d method,
the same sequence is about thirty lines. Count the work yourself:

~~~typescript
const inFlight = new Set<Promise<unknown>>();

/** Register a unit of work so shutdown can wait for it. */
function tracked<T>(work: Promise<T>): Promise<T> {
    inFlight.add(work);

    const done = () => { inFlight.delete(work); };

    // bookkeeping on a derived promise, so rejection stays the caller's to
    // handle and this never becomes an unhandled rejection of its own
    work.then(done, done);

    return work;
}
~~~

Wrap the actual work in it — every method, remembering that the one you miss is
the one that drops work:

~~~typescript
class OrderService extends IMQService {
    @expose()
    public async placeOrder(order: Order): Promise<Receipt> {
        return tracked(this.fulfil(order));
    }

    private async fulfil(order: Order): Promise<Receipt> {
        // the real work, however long it takes
    }
}

const service = new OrderService();
~~~

Then take the signals over. This has to happen *after* `start()`, because the
queue registers its handler during startup:

~~~typescript
const GRACE_MS = 25_000;

async function shutdown(signal: string): Promise<void> {
    console.log(`${signal}: draining ${inFlight.size} in flight`);

    await service.stop();                       // stop popping; writer stays up

    await Promise.race([                        // bounded, never open-ended
        Promise.allSettled([...inFlight]),
        new Promise(resolve => setTimeout(resolve, GRACE_MS)),
    ]);

    await service.destroy();                    // now release the transport

    process.exit(0);
}

await service.start();

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    // @imqueue's own handlers exit without draining — take over from them
    process.removeAllListeners(signal);
    process.once(signal, () => {
        shutdown(signal).catch(err => {
            console.error('shutdown failed', err);
            process.exit(1);
        });
    });
}
~~~

`removeAllListeners()` is blunt — it drops any other listener for that signal
too, including ones a library you depend on may have installed. Doing it directly
after `start()` keeps the blast radius to the framework's own handlers, which is
the point, and is the one thing the built-in drain does more precisely. Note also
that `handleSignals: false` is not a substitute by itself: it silences the
queue's handler, but `IMQService`'s is unconditional unless the drain owns it.

## The caller's half

Zero-drop is two-sided, and the caller's side has a default worth changing.
[`callTimeout`](/api/rpc/latest/rpc.imqclientoptions.calltimeout/) is unset out of
the box, and unset means *wait forever* — so a caller whose service was killed
mid-request holds that promise for the life of the process.

~~~typescript
// The generated module exports one namespace, which holds the client class.
import { orderService } from './clients/OrderService.js';

const orders = new orderService.OrderClient({ callTimeout: 30_000 });
~~~

Destroying a client doesn't help the calls it already made: pending requests are
abandoned rather than rejected, so `callTimeout` is the only thing that ever
frees them. Set it on every client, drain or no drain.

## What safe delivery does not cover

The natural objection is that guaranteed delivery should make all of this moot.
It doesn't, and the shape of the gap is worth being precise about.

Safe delivery is off by default in `@imqueue/core` and `@imqueue/rpc`, and on in
`@imqueue/job`. What it protects is the **hand-off**: the move from the shared
queue into a worker's own holding area, so a process that dies *between* taking a
message and starting on it doesn't swallow it. What it does not protect is the
part that takes time. A worker killed three seconds into `await chargeCard()`
loses that attempt in either mode — the same limit behind
[what guaranteed delivery costs](/blog/guaranteed-message-delivery-cost/) and the
deferred work in [scheduled work without a job
system](/blog/scheduled-work-without-a-job-system/).

Draining, in other words, isn't an optimisation layered on top of safe delivery.
It's the only mechanism that finishes work already in progress.

`@imqueue/job` ships the same opt-in, under the same `IMQ_DRAIN_ENABLE`, with one
addition that follows directly from the paragraph above. Because a job's worker
key is released the moment the job reaches the handler, a job the drain gives up
on at its budget is checked out to nobody and nothing would ever bring it back —
so `drainRequeue`, on by default, pushes it back before the process exits. That
buys a possible duplicate in exchange for a certain loss, which is the trade
at-least-once was already making.

## Sizing it for a real deploy

- **The grace period has to exceed the drain budget.** Kubernetes sends
  `SIGTERM`, waits `terminationGracePeriodSeconds` (30 by default), then sends
  `SIGKILL`. A 25-second drain under a 30-second grace period leaves room; a
  60-second drain under it is decoration.
- **Locally, `imq stop` is stricter than your cluster.** It signals the process
  group, polls for about five seconds, then escalates to `SIGKILL` — six times
  tighter than the Kubernetes default. That window, not the cluster's, is what
  sets `IMQ_DRAIN_TIMEOUT`'s 4000 ms default: it leaves roughly a second for
  `stop()`, `destroy()` and process teardown inside the five seconds the CLI
  allows. Raise it for a cluster deployment by all means — but then either stop
  using `imq stop` on that service or expect the local CLI to be the harsher of
  the two.
- **The signal has to reach PID 1.** A shell wrapper that spawns node as a child
  usually doesn't forward signals, so nothing you wired up ever runs — the
  built-in drain included, since it is registered on the process that never gets
  signalled. The project template gets this right with `exec npm start` — `exec`
  replaces the shell rather than parenting a process under it.
- **Rolling deploys need no traffic choreography.** There is no load balancer to
  drain and no registry to deregister from: the new instance starts popping, the
  old one stops, and the queue is the handover point. Start the replacement
  before the old one finishes draining and the backlog never even grows.

## The limits to be honest about

A drain narrows the window; it doesn't close it. `SIGKILL`, an OOM kill, or a
lost node still takes in-flight work with it, so *at-least-once* remains the
honest guarantee and handlers still need to be idempotent. Work that genuinely
takes ten minutes cannot be drained inside any sane grace period — that wants
checkpointing and a progress record, so a re-run resumes instead of restarting.
And a producer is not exempt: `send()` resolves against a locally generated id
before the broker confirms the write, so a process that exits immediately after
enqueuing has proven nothing about durability.

Safe delivery's own lease is worth one more line here, because the drain does not
change it: the worker key is released as soon as the message is handed to the
listener, not when the handler settles. That is what makes safe delivery a
guarantee about the hand-off rather than about the processing, and it is why
draining and safe delivery solve different halves of the same sentence.

None of that argues against draining. It argues for treating the drain as what it
is: the cheapest large reduction in dropped work available to a queue-based
service, and now a single environment variable. [Getting Started](/get-started/)
gets you a service to try it on;
[`IMQServiceOptions`](/api/rpc/latest/rpc.imqserviceoptions/) documents `drain`
and `drainTimeout`, and
[`IMQService`](/api/rpc/latest/rpc.imqservice/) has the exact `stop()` and
`destroy()` semantics.
