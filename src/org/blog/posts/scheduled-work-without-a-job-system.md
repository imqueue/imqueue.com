---
layout: post.html
permalink: /blog/scheduled-work-without-a-job-system/
templateEngineOverride: md
title: "Delayed and scheduled work without adding a job system"
summary: "\"Send that email in 24 hours\" usually turns into a second deployment, a second data model, and a job record shadowing a service method you already wrote. Often the message queue you already run can just do it. Here's how deferral works as a parameter, and what it costs."
description: "Run delayed and scheduled work in Node.js without a separate job queue: defer a typed RPC call, shape retry backoff, and build a recurring sweep."
keywords: "delayed jobs nodejs, background jobs nodejs, background tasks nodejs, do I need a separate job queue, scheduled tasks nodejs microservices, cron job nodejs, cron alternative nodejs, delayed message queue, retry with backoff nodejs, imqueue"
date: 2026-07-25
author: mykhailo-stadnyk
illustration: deferred
topics: [jobs, delivery, queue]
ogType: article
---

It always arrives as one small requirement. Retry that webhook in five minutes.
Release expired inventory holds every minute. Send the trial-expiry email in 24
hours. The reflex is to reach for a job system, and the feature you need really
is in there — along with a deployment, a data model and a worker tier you didn't
ask for.

The requirement is not "we need jobs." It is: **run this later.** If your
services already talk over a message queue, later is a parameter you're not
using yet.

## The work you're deferring is a call you already have

A job system asks you to describe the work a second way. The handler itself can
be three lines calling the method you already have; it's the description around
it that costs you:

- **The payload is an untyped mirror of a method signature.** Hand-maintained on
  both sides, and nothing checks the two against each other when that signature
  changes.
- **The worker is a tier.** A queue to name, an entrypoint to roll out, one more
  thing to page on.
- **The job rows are a second source of truth.** Their own lifecycle, their own
  retention, their own answer to "did this run?".

That isn't an argument against job systems. It's an argument against standing one
up to run three delayed operations.

In `@imqueue`, deferral isn't a component — it's an argument. The generator
appends two optional trailing parameters to every exposed method: call metadata
first, then an [`IMQDelay`](/api/rpc/latest/rpc.imqdelay/).

~~~typescript
import { IMQDelay, IMQMetadata } from '@imqueue/rpc';
// The generated module exports one namespace, which holds the client class.
import { notificationService } from './clients/NotificationService.js';

// callTimeout has no default, and unset means "wait forever"
const notifications = new notificationService.NotificationClient({ callTimeout: 30_000 });

await notifications.start();

notifications
    .sendTrialEndingEmail(
        { userId: '42', plan: 'pro' },
        new IMQMetadata({ reason: 'trial-expiry' }), // metadata slot first
        new IMQDelay(24, 'h'),                       // the delay is always last
    )
    .then(result => console.log('reminder sent', result))
    .catch(err => console.error('reminder failed', err));
~~~

> **Updated for `@imqueue/rpc` 3.4.0.** When this went out, skipping the metadata
> slot with `undefined` failed outright; 3.3.1 made it work for one placeholder,
> and 3.4.0 made it the rule — on a delayed call a trailing `undefined` is never
> delivered. The sample above works on every version, so it stands unchanged.

Fill that metadata slot, or pass `undefined` for it. Both trailing parameters are
optional, but they're stripped by identity, not by position — which is why the
placeholder took two releases to settle. On 3.3.0 and earlier an explicit
`undefined` type-checked and then travelled as a real argument, so a method whose
parameters are all required rejected the call with
`IMQ_RPC_INVALID_ARGS_COUNT`. From 3.4.0 a trailing `undefined` on a delayed call
is dropped, so both spellings work and a skipped optional argument falls back to
its default. Dropping the delay straight into the metadata slot is the mirror
image — it runs, but it doesn't type-check, on any version. Keep the delay last.
`IMQDelay` takes a number plus one of `ms`, `s`, `m`, `h`, `d`. What comes back is a
real request/reply promise, pending across the whole delay, so don't `await` one
inside a request handler: its resolver lives only in the caller's memory, and a
restart loses it while the reply still arrives, to nobody waiting. `callTimeout`
is the only backstop, and a delay extends its budget rather than firing early.

One layer down it's the same parameter without the sugar: `send()` takes the
delay in plain milliseconds, which `@imqueue/job` surfaces as
`push(data, { delay })`. The service can't tell either way — an RPC request
carries only `from`, `method`, `args` and optional metadata, so validation,
decorators and handlers behave exactly as for an immediate call. (`@imqueue/job`
keeps the delay in its envelope only to re-arm a retry; the handler gets the job,
not the envelope.)

## What happens between now and then

Nothing of *your* work runs in your process while it waits: no per-message
`setTimeout`, no in-memory timer heap on the delivery path. The only clocks are a
maintenance interval per queue instance, the broker's own expiry, and the
optional, unref'd `callTimeout` timer. That's what makes this survive a deploy —
the caller can exit one second after scheduling a call for next Tuesday.

The mechanics belong to the transport. On the Redis-backed core the producer
computes a due time — `Date.now() + delay` — and parks the packed message in a
sorted set beside the queue, scored by that time, plus a small companion key that
expires about then and carries no payload — an alarm clock, nothing more. Its
expiry fires a keyspace notification, and one elected watcher runs a single atomic
script that moves everything now due onto the ordinary ready list. Failing that,
every worker sweeps its own delayed set every `watcherCheckDelay`, 5 seconds by
default.

~~~mermaid
flowchart LR
    A["client.update(…, new IMQDelay(24, 'h'))"] --> B["packed message parked in a sorted set, scored Date.now() + delay"]
    A --> C["companion key expiring about then, carrying no payload"]
    C -->|"expiry fires a keyspace notification"| D["one elected watcher runs one atomic promote script"]
    B --> D
    E["every worker, every watcherCheckDelay (5s)"] -.->|"fallback sweep"| D
    D --> F["ordinary ready list"]
    F --> G["any free consumer, behind the existing backlog"]
~~~

`@imqueue` schedules a delayed call in the broker, not in your process — which is
why the caller can exit one second after scheduling something for next Tuesday.
Where keyspace notifications are unavailable, promotion degrades to the 5-second
sweep rather than stopping.

From there it's an ordinary message, load-balanced like any other and queued
behind the existing backlog. That notification is the primitive covered in
[Redis as a message bus](/blog/redis-message-bus-patterns/), including the line
that catches people out: some managed offerings need `notify-keyspace-events Ex`
enabled by hand, and where you can't, promotion quietly degrades to the 5-second
sweep.

## Backoff without a retry policy

"Retry the webhook in five minutes" points the same primitive back at yourself —
and programmable retry timing means a job record again. `@imqueue/job` is a thin
envelope over the same `send()` — its own `imq-job` prefix, a queue matched to its
handler by `name` alone — so it runs inside a process you already deploy, but the
payload is yours. Return a number from a handler and the same job is re-sent after
that many milliseconds.

~~~typescript
import JobQueue from '@imqueue/job';

type Sync = { orderId: string; attempt: number };

new JobQueue<Sync>({ name: 'OrderSync' })
    .onPop(async job => {
        try {
            await warehouse.sync(job.orderId);
        } catch (err) {
            console.error('order sync failed', job.orderId, err);

            job.attempt += 1;

            if (job.attempt > 5) {
                await parkForReview(job); // your own dead-letter table

                return -1; // negative: stop
            }

            return 1000 * 2 ** (job.attempt - 1); // 1s, 2s, 4s, 8s, 16s
        }
    })
    .start()
    .then(queue => queue.push({ orderId: 'A-1001', attempt: 0 }))
    .catch(err => console.error('OrderSync failed to start', err));
~~~

Re-scheduling re-sends the same envelope, so incrementing `job.attempt` in place
carries it forward — and that counter is the only attempt cap there is.
`parkForReview()` is your own table: there is no declarative `attempts` policy
and no dead-letter destination. Catch your own
errors rather than leaning on a throw, which re-schedules with the job's
*original* delay — so a job pushed without one is dropped instead of retried.
Returning `0` isn't a stop either; it re-runs immediately, a hot loop. Stop by
returning nothing or a negative number, and note that re-arming publishes: a
worker-only queue cannot re-schedule at all.

## Recurrence, honestly

There is no cron here. No cron expressions, no repeatable option, no timezone
rules, no recurrence rule stored anywhere: a delay is one-shot, at every layer.
What you can build is a chain — a tick that schedules its own successor.

~~~typescript
import JobQueue from '@imqueue/job';

const EVERY_MINUTE = 60_000;
const sweeper = new JobQueue<Record<string, never>>({ name: 'ExpireHolds' });

sweeper.onPop(async () => {
    await releaseExpiredHolds();

    return EVERY_MINUTE; // re-arm: the next tick is scheduled from here
});

await sweeper.start();

// seed exactly one chain, out of band — never on every process boot
if (process.env['SEED_EXPIRE_HOLDS']) {
    sweeper.push({}, { delay: EVERY_MINUTE });
}
~~~

Seeding is the part that bites. Every process that pushes a seed starts its own
chain, so ten replicas rolling through a deploy leave ten overlapping sweeps
forever. Seed from a one-off task or the scheduler you already run; if it has to
happen at boot, gate it on a `SET NX` lease whose TTL spans several periods,
retried on an interval so a deploy can't double-seed and a dead chain re-seeds
when the lease lapses.

> A self-re-arming tick is a chain, not a schedule. If the chain ever breaks,
> nothing restarts it — alert on the age of the last completed run.

The next fire time is computed *after* the work finishes, so the real period is
work plus delay and "every 60s" walks off wall clock. The re-arm is an ordinary
send inside an async handler: if it fails,
the recurrence ends and nothing says so. A chain of one-shot delays is not a
schedule — if the requirement is calendar-shaped, put it where calendars already
live and have it trigger an ordinary call.

## The trade-offs to know before you ship it

Skipping the job tier isn't free either — it moves the costs somewhere else:

- **It's "no earlier than," not "exactly at."** The delay is expressed in
  milliseconds; the delivery isn't accurate to one. A 1500 ms delay arrived at a
  consumer after 1532 ms on the notification path — and that's one hop, before
  any reply travels back; without notifications you inherit the poll interval
  instead. The due time comes from the *sending*
  process's clock and is compared against the *sweeping* one, so skew shifts it
  either way. Pass whole milliseconds, too: a fractional delay fails to set the
  alarm key and waits for the next sweep, and an `IMQDelay` carrying a unit string
  it doesn't recognise means no delay at all.
- **Enqueue is fire-and-forget.** `send()` resolves with a locally generated id
  before Redis confirms the write, and `push()` returns synchronously — awaiting
  either proves nothing about durability. `send()` takes an error handler for
  exactly that; `push()` takes none, so a failed enqueue only reaches the queue's
  logger. The delayed set is ordinary data too, so persistence is load-bearing
  for anything scheduled far out.
- **There is no handle for one message.** The id you get back isn't one: nothing
  cancels, reschedules or inspects a single scheduled message, and the only
  removal path is wholesale — clearing a queue's data wipes every scheduled
  message for it, other producers' included. If an action can be revoked, gate
  the handler with a state check.
- **Something has to be alive to sweep.** A waiting message needs neither its
  sender nor a consumer, and any live instance on the prefix elects itself watcher
  when none exists — but the polling fallback runs only on workers, so with
  notifications unavailable and no worker for that queue, nothing promotes it.
- **An outage ends in a burst.** Everything due while you were dark is promoted in
  one pass, with no rate limit, no "skip missed runs" policy and no concurrency
  cap to meter the result — and [a backlog is still
  latency](/blog/backpressure-nodejs-services/).

Guarantees are inherited, and narrower than they sound. Safe delivery is off by
default in `@imqueue/core` and `@imqueue/rpc` — `@imqueue/job` turns it on for
you — and with it off, a promoted message a dying consumer was holding is gone.
With it on, the lease covers only the hand-off, so a process killed three seconds
into `await warehouse.sync()` still loses that attempt. Same trade-off as
[what guaranteed delivery costs](/blog/guaranteed-message-delivery-cost/) —
`safeDeliveryTtl` on a queue or service, `safeLockTtl` through `@imqueue/job` —
and *at-least-once* is still the honest guarantee, so write long deferred work to
be re-runnable, with its own progress record.

## When a job system is the right call

Deferral-as-a-parameter fits when the work is a call you already expose and
"roughly then, at least once" is acceptable. Three things say otherwise:

- **Operators need to steer the queue.** Priorities, attempt caps,
  dead-lettering, pause and resume, per-job status, rate limiting, a concurrency
  cap, a dashboard — none of that exists here. The feature-by-feature split is in
  [`@imqueue/job` vs BullMQ](/blog/imqueue-vs-bullmq/).
- **The schedule is declarative.** Cron strings, timezones, "every 5 minutes" as
  configuration rather than as a self-re-arming chain. That's a scheduler's job,
  and [the alternatives guide](/blog/bullmq-alternatives/) maps the libraries that
  do it.
- **It's really a workflow.** Multi-step, resumable, with history and
  compensation. That's an orchestration engine like Temporal — a different
  category, not a bigger delay.

If none of those apply, you probably don't need a job system for this — you need
an extra argument or two on a call you already make. The
[`IMQDelay` reference](/api/rpc/latest/rpc.imqdelay/) has the exact signature,
and [Getting Started](/get-started/) gets you a service to schedule against in a
couple of minutes. If an AI assistant writes this code for you, point it at the
machine-readable version of these recipes:
[/agents/delayed-scheduled-work/](/agents/delayed-scheduled-work/).
