---
layout: docs.html
section: docs
title: "Agent recipe: delayed & scheduled work"
docLabel: AGENT RECIPE
lead: "Machine-oriented instructions for AI agents implementing \"run this later\" in an @imqueue codebase: picking between a delayed call, @imqueue/job and an external scheduler, the exact trailing-argument contract, verification commands and failure modes."
description: "AI-agent recipe for delayed and scheduled work with @imqueue: the IMQDelay contract, send/push delay options, self-re-arming recurrence and failure modes."
keywords: "imqueue delayed job agent recipe, IMQDelay, imqueue scheduled task ai agent, imq job delay, delayed rpc call nodejs, imqueue cron alternative"
relatedTopics: [jobs, delivery, queue]
noindex: true
---

<!--
  noindex: this page is a machine-facing operational recipe that deliberately
  overlaps the human article at /blog/scheduled-work-without-a-job-system/.
  Keeping it out of the search index avoids duplicate-content /
  keyword-cannibalization between the two. It stays fully available to AI
  agents: listed in /llms.txt, directly fetchable, and served via the MCP
  get_doc markdown mirror.
-->


[[toc]]

These are operational instructions for AI agents asked to run work later —
deferred, retried or recurring — in a codebase that already uses
[`@imqueue`](/get-started/). A human-oriented walkthrough of the same material
is at
[/blog/scheduled-work-without-a-job-system/](/blog/scheduled-work-without-a-job-system/).

## When to apply this recipe

Apply it when the user asks for work that runs later over machinery they
already have:

- "send / notify / charge / clean up **in N minutes or hours**";
- "**retry** this failed call later", with backoff;
- "run this **every N minutes**" as a sweep or reconciliation;
- "do we need **BullMQ / a job queue / cron** for this?" — check this recipe's
  decision table before adding a dependency.

Do **not** apply it when the requirement is declarative scheduling (cron
strings, timezones, calendar dates), operator control of the queue
(priorities, attempt caps, dead-lettering, pause/resume, a dashboard), or a
multi-step resumable workflow. Those need a real scheduler, a dedicated job
system, or an orchestration engine — say so instead of approximating them.

## Choose the mechanism first

| Requirement | Mechanism |
| --- | --- |
| Defer a method the service already exposes | Delayed RPC call — `IMQDelay` as the last argument |
| Deferred/retried background work with a payload you own | `@imqueue/job` — `push(job, { delay })` |
| Raw message, no RPC or job semantics | `@imqueue/core` — `send(queue, message, delayMs)` |
| Recurring tick | Self-re-arming `@imqueue/job` chain, seeded out of band |
| Cron strings, timezones, "skip missed runs" | External scheduler that triggers an ordinary call |
| Priorities, attempt caps, dead-letter, dashboard | Dedicated job system — see [/blog/bullmq-alternatives/](/blog/bullmq-alternatives/) |

## Facts these recipes rely on

Verified against `@imqueue/core`, `@imqueue/rpc` and `@imqueue/job` sources and
by measurement against a live Redis.

**The call contract.** Generated clients take **two** optional trailing
parameters, in this order: `imqMetadata?: IMQMetadata`, then
`imqDelay?: IMQDelay`. The delay is always last. `IMQDelay(timer, unit)` accepts
a unit of `'ms' | 's' | 'm' | 'h' | 'd'`, defaulting to `'ms'`.

Those two parameters are stripped from the request **by identity (`instanceof`),
not by position**. All of the following are measured; do not guess between them:

- **`method(data, undefined, delay)` — emit this form** on `@imqueue/rpc`
  **>= 3.4.0**. A trailing `undefined` on a delayed call is a placeholder and is
  never delivered, whether or not metadata is also passed, and however many
  trailing placeholders there are. So `method(a, undefined, undefined, delay)`
  sends `[a]`, and a skipped optional declared param falls back to its default.
- `method(data, new IMQMetadata({ ... }), delay)` compiles and runs on **every**
  version. **Emit this form** when the installed version is `<= 3.3.0` or
  unknown, because there the placeholder survives into the request as a real
  argument (serialized `null`) and a method whose params are all required
  rejects the call with **`IMQ_RPC_INVALID_ARGS_COUNT`**.
- On **3.3.1** only, the rule is narrower: one placeholder is dropped, and only
  when no metadata is passed. Treat 3.3.1 as "prefer the bag" too.
- `method(data, delay)` **runs**, but fails type-check with **TS2345**
  (`IMQDelay` is not assignable to `IMQMetadata`) on every version. Do not emit
  it, and do not reach for `as any` to silence it — on 3.3.1 that cast changes
  what a skipped optional param delivers.
- Nothing is dropped when there is no delay, on any version: `method(a,
  undefined)` delivers `null`, so a default does not fire.
- The service-side arity check is `declared === received` when every declared
  parameter is required, and `declared >= received` when at least one is
  optional. So a method with an optional parameter accepts a call that *omits*
  trailing arguments, and a surviving placeholder that lands in an optional slot
  passes the check instead of being rejected. A count *above* the declared total
  is rejected either way. A passing call therefore proves nothing about a method
  with a different signature — do not generalise from it.

**Caller-side.** `callTimeout` has no default, and unset means wait forever; a
delay extends its budget rather than firing early. The pending promise's
resolver lives only in the caller's memory, so never `await` a long delayed call
inside a request handler — a restart loses the resolver while the reply still
arrives.

**Enqueue is not a durability confirmation.** `send(toQueue, message, delay?,
errorHandler?)` takes milliseconds and resolves with a locally generated UUID
*before* the write is confirmed — pass `errorHandler` to learn about failures.
`push(job, { delay })` returns synchronously and takes no error handler, so a
failed enqueue only reaches the queue's logger.

**`@imqueue/job` handler return contract** — get this exactly right:

| Handler outcome | Effect |
| --- | --- |
| returns positive number | re-scheduled after that many ms |
| returns `0` | re-scheduled **immediately** — a hot loop, never use it to stop |
| returns negative number, or nothing | stops; no re-schedule |
| **throws** | re-scheduled with the delay the job was **originally pushed with** — so a job pushed *without* a delay is **dropped**, not retried |

Catch handler errors explicitly and return a delay; do not rely on a throw.
There is no declarative `attempts` policy and no dead-letter destination —
carry the attempt counter in the job payload and write your own park-for-review
table.

**Delivery mode.** `safeDelivery` defaults to `false` in `@imqueue/core` and
`@imqueue/rpc`, and to `true` through `@imqueue/job` (whose `safeLockTtl` maps
to `safeDeliveryTtl`). The lease covers the hand-off only, so a process killed
mid-handler still loses that attempt. At-least-once is the guarantee either way:
make deferred handlers re-runnable. See
[/blog/guaranteed-message-delivery-cost/](/blog/guaranteed-message-delivery-cost/).

**Promotion path.** The producer parks the packed message in the sorted set
`<prefix>:<queue>:delayed`, scored `Date.now() + delay`, plus an empty companion
key `<prefix>:<queue>:<id>:ttl` set with `PX <delay> NX`. That key's expiry
fires a keyspace notification, and one elected watcher moves everything now due
onto the ready list; failing that, workers sweep every `watcherCheckDelay`
(default **5000 ms**). Default prefixes: `imq` for core/rpc, `imq-job` for jobs.
Prompt promotion needs `notify-keyspace-events` to include `Ex`.

**Accuracy is "no earlier than."** Pass whole integer milliseconds: a
fractional delay fails to set the alarm key and waits for the next sweep, and an
`IMQDelay` carrying an unrecognised unit string yields no delay at all. The due
time comes from the *sending* process's clock and is compared against the
*sweeping* one.

**Absent features.** There is no cron, repeat or recurrence primitive anywhere
in the ecosystem. There is also no handle for a single scheduled message:
nothing cancels, reschedules or inspects one, and the only removal path is
wholesale. If an action can be revoked, gate the handler with a state check
rather than trying to unschedule it.

## Recipe: defer a call the service already exposes

~~~typescript
import { IMQDelay, IMQMetadata } from '@imqueue/rpc';
// The generated module exports one namespace, which holds the client class.
import { notificationService } from './clients/NotificationService.js';

const notifications = new notificationService.NotificationClient({ callTimeout: 30_000 });

await notifications.start();

// fire-and-forget: do not await a 24h call in a request handler
notifications
    .sendTrialEndingEmail(
        { userId, plan },
        undefined,                                   // metadata slot — skipped
        new IMQDelay(24, 'h'),                       // delay is always last
    )
    .catch(err => logger.error('deferred call failed to enqueue', err));
~~~

The service method needs no change: a delayed request carries only `from`,
`method`, `args` and optional metadata, so validation, decorators and handlers
behave exactly as for an immediate call.

## Recipe: retry with backoff you control

~~~typescript
import JobQueue from '@imqueue/job';

type Sync = { orderId: string; attempt: number };

new JobQueue<Sync>({ name: 'OrderSync' })
    .onPop(async job => {
        try {
            await warehouse.sync(job.orderId);
        } catch (err) {
            job.attempt += 1;                        // counter lives in the payload

            if (job.attempt > 5) {
                await parkForReview(job);            // your own dead-letter table

                return -1;                           // negative: stop
            }

            return 1000 * 2 ** (job.attempt - 1);    // 1s, 2s, 4s, 8s, 16s
        }
    })
    .start()
    .then(queue => queue.push({ orderId, attempt: 0 }))
    .catch(err => logger.error('OrderSync failed to start', err));
~~~

## Recipe: recurring sweep

~~~typescript
import JobQueue from '@imqueue/job';

const EVERY_MINUTE = 60_000;
const sweeper = new JobQueue<Record<string, never>>({ name: 'ExpireHolds' });

sweeper.onPop(async () => {
    await releaseExpiredHolds();

    return EVERY_MINUTE;    // re-arm; next tick is scheduled after the work
});

await sweeper.start();
~~~

Seeding rules — the part that breaks in production:

1. **Never seed on process boot unguarded.** Every process that pushes a seed
   starts its own chain, so N replicas rolling through a deploy leave N
   overlapping sweeps forever.
2. Seed from a one-off task, a migration step, or the scheduler the user already
   runs.
3. If it must happen at boot, gate it on a `SET NX` lease whose TTL spans
   several periods, retried on an interval, so a deploy cannot double-seed and a
   dead chain re-seeds when the lease lapses.
4. The period drifts: the next fire time is computed *after* the work finishes,
   so the real interval is work plus delay. Do not promise wall-clock alignment.
5. A chain is not a schedule. If a re-arm ever fails, the recurrence ends
   silently — instrument the age of the last completed run and alert on it.

## Verify

~~~bash
# prompt promotion requires keyspace expiry events (look for E and x)
redis-cli CONFIG GET notify-keyspace-events

# what is parked right now, and when it is due (scores are due-time in ms)
redis-cli --scan --pattern 'imq:*:delayed'
redis-cli ZRANGE imq:<ServiceName>:delayed 0 -1 WITHSCORES
redis-cli ZCARD imq-job:<JobName>:delayed

# the alarm keys that trigger promotion
redis-cli --scan --pattern 'imq:<ServiceName>:*:ttl'
~~~

Then confirm behaviour, not just configuration: schedule a short delay and
measure the actual arrival (expect "no earlier than", plus up to
`watcherCheckDelay` without notifications); kill a worker mid-handler and check
the work is either re-run or recorded as lost, according to the delivery mode
you chose; and run the handler twice to prove it is idempotent.

## Failure modes

| Symptom | Cause | Fix |
| --- | --- | --- |
| `IMQ_RPC_INVALID_ARGS_COUNT` on a delayed call | on `<= 3.3.0` an explicit `undefined` in the metadata slot is forwarded as a real argument | upgrade to `>= 3.4.0`, or pass an `IMQMetadata` bag |
| TS2345, `IMQDelay` not assignable to `IMQMetadata` | delay passed in the metadata slot | keep the delay in the last position |
| A skipped optional param arrives as `null` and its default never fires | `undefined` serializes to `null`; placeholders are dropped only on a *delayed* call, and on 3.3.1 only one was dropped | pass the real value, declare the param nullable, or upgrade to `>= 3.4.0` |
| Delayed call never settles in the caller | caller restarted, or no `callTimeout` set | set `callTimeout`; never `await` a long delay in a request handler |
| Everything arrives ~5 s late | keyspace notifications lack `Ex`, so the polling fallback is doing the work | enable `notify-keyspace-events Ex`, or accept the `watcherCheckDelay` sweep |
| Delay ignored entirely | fractional milliseconds, or an unrecognised `IMQDelay` unit | pass whole integer ms and a valid unit |
| Job dropped instead of retried | handler threw, and the job was pushed without a delay | catch the error and return a delay number |
| Worker spins at 100% CPU | handler returned `0`, re-scheduling immediately | return a negative number or nothing to stop |
| N overlapping recurrences | every replica seeded the chain | seed out of band, or behind a `SET NX` lease |
| Recurrence stopped silently | a re-arm failed and nothing restarts a broken chain | alert on the age of the last completed run, then re-seed |
| Scheduled work lost when a worker died | `safeDelivery` is off by default in core/rpc | enable safe delivery for that queue, and make handlers re-runnable |
| A queue's delayed messages never promote | no worker for that queue and no notifications available | keep a worker on the prefix, or ensure `Ex` notifications |
| Cannot cancel a scheduled message | there is no per-message handle | gate the handler with a state check; treat scheduling as irrevocable |
