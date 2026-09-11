---
layout: post.html
permalink: /blog/guaranteed-message-delivery-cost/
templateEngineOverride: md
title: "Guaranteed delivery, tested with kill -9: what at-least-once actually promises when a worker dies"
summary: "\"Will I lose messages if a worker dies?\" is the right question, and for a year this page answered it wrong. Here is what guaranteed (at-least-once) delivery really promises — measured by killing workers mid-job — what the one deadline actually governs, what a drain does and doesn't save, what it costs, and how to choose per workload."
description: "What guaranteed, at-least-once message delivery really promises when a worker is killed mid-job: the lease holds through the handler, recovery within a sweep, the processing deadline that duplicates slow handlers, the throughput cost, and a per-workload decision guide for @imqueue."
keywords: "guaranteed message delivery nodejs, at-least-once delivery, at-most-once delivery, exactly-once delivery, message delivery semantics, delivery guarantees, is exactly once delivery possible, idempotent consumer, reliable messaging, safe delivery, message loss, worker crash mid job, job re-delivered after crash, kill -9 worker job queue, safeLockTtl processing deadline, drainRequeue duplicate, imqueue"
date: 2026-09-11
author: andrii
illustration: worker-death
topics: [delivery, queue, resilience, jobs]
ogType: article
---

The first serious question anyone asks about a message-based system is: *if a
worker grabs a message and then crashes, is that message lost?* It is the right
question. It is also a question this page used to answer wrong, and so did our
own reference documentation, for about a year.

The old answer was that guaranteed delivery protects the *hand-off* — the moment
between a worker taking a message and starting on it — and nothing after. A
worker killed three seconds into the actual work, we said, loses that attempt
like any other. That is not what the code does, and it never was. So rather than
patch a sentence, we went back and did what should have been done the first
time: killed workers mid-job, with `SIGKILL`, and watched what happened to the
work they were holding.

This is the corrected page. The semantics section at the top is unchanged,
because it was right. Everything after it is measured.

## The three delivery semantics, and the one that doesn't exist

Every broker's documentation uses the same three names, so it is worth being
precise about what each one promises before choosing.

- **At-most-once.** The message is delivered zero or one times. Send it, don't
  track it, accept that a crash loses it. Cheapest, and honest for telemetry or
  cache warmups.
- **At-least-once.** The message is delivered one or more times. Delivery is
  tracked until the consumer confirms, and an unconfirmed message is redelivered
  — which means duplicates are not an edge case, they are the guarantee. This is
  what "guaranteed delivery" means, here and in RabbitMQ, SQS, NATS JetStream
  and Kafka alike.
- **Exactly-once.** The message is processed once, no more and no less. **As a
  delivery guarantee this is not achievable**, and no broker provides it however
  the marketing is worded.

The reason is worth stating plainly, because it decides how you write
consumers. Delivery involves two separate actions — doing the work, and
recording that the work was done — on two different machines, and a crash can
land between them. Whichever order you pick, you get at-most-once (record first)
or at-least-once (record last). There is no third order. This is the
[Two Generals problem](https://en.wikipedia.org/wiki/Two_Generals%27_Problem),
and it does not yield to a better library.

What *is* achievable is **exactly-once processing**, and the distinction is the
useful part: you get it by making the *effect* idempotent rather than the
delivery unique. Kafka's transactions and SQS FIFO deduplication are both this —
deduplication at the consumer, given an at-least-once transport underneath. So
the practical rule is: pick at-least-once for anything that matters, then make
the handler safe to run twice. The rest of this post is about what that promises
and what it costs.

## Two modes, and what each one promises when a worker dies

`@imqueue` offers two delivery modes, and the difference is exactly the crash
scenario.

**Unreliable (fast) delivery.** A consumer pops a message and processes it. If
the process dies before finishing, that message is gone — there is no record
anywhere that it was ever taken. This is the fastest mode, because there is no
bookkeeping, and it is the right default for work that is frequent and cheap to
miss: best-effort notifications, cache warmups, telemetry.

**Guaranteed (safe) delivery.** Popping a message moves it atomically out of the
queue into a key owned by that worker, and — this is the part we had wrong — the
key is held until the handler's promise settles, not until the handler starts.
The whole attempt is covered. A worker that dies at any point before the
handler returns, whether it had only just popped the message or was seven
seconds into a nine-second job, leaves the message checked out to a process
that no longer exists. The watcher notices that process is gone and moves the
message back onto the queue for another worker.

Two mechanisms decide that a checked-out message has been abandoned, and they
are for different failures:

1. **The owner has left the broker's client list.** The worker key names the
   process that holds it; on each sweep the watcher reads Redis's `CLIENT LIST`
   and any key whose owner is no longer connected is returned to the queue. This
   is how a *dead* worker is detected — from the broker's connection state, as
   fast as the socket closes, with nothing to renew and no clock involved.
2. **The deadline has passed.** Each key carries the time by which its message
   should have been handled. This is how a *live* worker with one wedged handler
   is detected, since liveness can't see that case. It is a processing deadline,
   and it has a trap of its own, below.

Safe delivery is off by default in `@imqueue/core` and `@imqueue/rpc`, and on
by default in `@imqueue/job` — a job queue is the case where the extra
round-trip is worth paying.

## kill -9, measured

Two workers on the same queue, each with a handler that takes eight seconds. Push
one job. Two seconds after one worker logs that it has started on it, send that
worker `SIGKILL` — no signal handler, no cleanup, no chance to say anything to
Redis. Then time how long until the *other* worker starts the same job.

Three runs, on Redis 8.0.5 and Node.js 24 with `@imqueue/job` 3.3.2, default
settings:

| run | killed | job started again on the survivor after |
|---|---|---|
| 1 | 2.0 s into the handler | 7.4 s |
| 2 | 2.0 s into the handler | 7.4 s |
| 3 | 2.0 s into the handler | 7.3 s |

The job came back every time, and it came back in about seven seconds.
Nothing about that depends on the killed handler having been polite: `SIGKILL`
gives a process no opportunity to release anything, which is the point of the
test. The floor is the watcher's sweep, which runs every `watcherCheckDelay` —
five seconds by default — and reads the client list on each pass; most of the
remainder is a survivor taking over the watcher role the dead process was
holding. What matters is the shape: seconds, bounded by a setting you control,
and not dependent on any deadline the job was pushed with.

What the job did *not* do is finish where it started. The survivor ran the
handler again from the beginning. That is the whole meaning of at-least-once,
and it is why the handler has to be safe to run twice: a payment that had
already been submitted when the worker died is submitted again by the survivor
unless the handler checks first.

## The deadline is for a live worker, and it will duplicate a slow one

`safeDeliveryTtl` in core — exposed as `safeLockTtl` by `@imqueue/job` — is not
how a crash is recovered. Crashes are caught by the client list, above,
regardless of this value. The deadline exists for the one failure liveness
cannot see: a worker that is up, connected, serving other messages, and stuck
on this one.

Which makes it a **processing deadline**, and that has a consequence that is
easy to miss until it costs you. A handler that legitimately takes longer than
the deadline looks, to the watcher, exactly like a wedged one. Its message is
reclaimed from a worker that is still working on it and handed to another —
which may be the same worker, popping its own job a second time while the first
attempt is still running.

Measured: one worker, `safeLockTtl` of three seconds, a handler that takes
eight:

| | |
|---|---|
| times the same job **started** in 13 seconds | **3** |
| at | 0.0 s, 4.9 s and 9.9 s |

Every attempt overran the deadline, so every attempt was reclaimed and started
again, on a worker that was never unhealthy for a moment. With no
[`ttl`](/api/job/latest/job.pushoptions.ttl/) on the push, that continues
until something stops it.

There is a second subtraction hiding in that number. The deadline is stamped
when the worker *issues* its blocking pop, not when a message arrives, and that
pop blocks for up to five seconds. A message that lands late in the block
starts its handler with up to five seconds of its budget already spent. Under
a 10-second setting that is as little as **five seconds of real processing
time** — we watched an eight-second handler on a healthy worker get reclaimed
at 8.5 s for exactly this reason.

The defaults make this worth checking today rather than after an incident.
`@imqueue/core` defaults the deadline to **300 seconds**. `@imqueue/job` lowers
it to **10 seconds** — and a job queue is precisely where handlers take a long
time. Set `safeLockTtl` to your slowest handler, plus five seconds for the pop
window, plus headroom, and treat a handler that reaches it as a bug to fix
rather than a retry to welcome.

## A drain finishes work; it does not save it

The natural next question is what a graceful shutdown adds, given that a killed
worker's job comes back anyway. The honest answer is *completion*, not
*durability*, and the distinction changes how one option should be set.

With `drain` on, `SIGTERM` stops the worker popping, waits up to `drainTimeout`
for the handlers already running, and exits. The job it was working on finishes
*here*, once, instead of being abandoned and replayed from the start on another
worker. That is what a drain is for: a deploy that rolls through a fleet
without re-running every in-flight job.

`@imqueue/job` adds `drainRequeue`, on by default, which pushes whatever the
budget ran out on back onto the queue before exiting. It was written on the
same wrong model as the old version of this page — the belief that an abandoned
job was checked out to nobody and nothing else would bring it back. Under safe
delivery that job is still checked out, because its handler never settled, and
the lease returns it once the process is gone. So the re-push can only ever add
a copy. Measured, with a one-second drain budget against an eight-second
handler, `SIGTERM` sent one second into the job, and a second worker waiting:

| draining process | `drainRequeue` | what the survivor received |
|---|---|---|
| `JobQueueWorker` | off | the job once, 8.6 s after the signal — the lease |
| `JobQueueWorker` | on (default) | the job once, 8.6 s after the signal — and the draining worker logged `drain re-queue failed … code unknown` |
| `JobQueue` (pushes and handles) | off | the job once, 8.6 s after the signal |
| `JobQueue` (pushes and handles) | on (default) | the job **three** times: at 1.0 s from the re-push, then twice at 8.6 s — the dead process's lease, and the re-pushed copy's *own* lease, which had already expired while the survivor was still working on it |

The second row is a defect rather than a feature: a `JobQueueWorker` opens a
worker-only connection that cannot send, so its re-push throws every time and
the option silently does nothing — the job came back through the lease alone,
exactly as it would have with the option off. On a `JobQueue`, which can send,
the re-push lands, and then the lease returns the same job again when the
process is gone. The third copy in that row is the deadline trap from the
previous section striking the survivor: it popped the re-pushed copy with only
part of its budget left and was reclaimed mid-run.

Turn `drainRequeue` off when safe delivery is on, on either class. It is the
sole recovery only with `safe: false`, where nothing else holds the job.

## What guaranteed delivery costs

Safety is not free, and the shape of the bill is worth knowing. In a
`@imqueue/core` benchmark run — a 24-core Intel Core Ultra 9 275HX, Node.js 24,
~1 KB messages — unreliable delivery reached **~200,000 round-trip msg/sec** and
guaranteed delivery **~120,000 msg/sec**. Safe mode costs roughly **40% of
throughput**, keeping about 60%. Your numbers will differ with hardware and
message size; the [benchmark post](/blog/benchmarking-imqueue-throughput/) has
the full run and how to reproduce it.

That is a reasonable price for "this message survives the worker dying", and
the key point is that **you don't pay it globally.** It is chosen per queue.
Latency-critical, loss-tolerant paths stay fast; the paths that place orders and
move money run safe.

## Choosing per workload

Two questions about each kind of message:

1. **If this is lost, does it matter?** If no, unreliable is fine and faster. If
   yes, guaranteed — and it now protects the whole attempt, not the first
   millisecond of it.
2. **Is the handler safe to run twice?** Guaranteed delivery is at-least-once: a
   job whose worker died is replayed from the start, a job that outruns the
   deadline is replayed while still running, and `@imqueue/job` re-schedules a
   job whose handler throws. Design critical handlers to be **idempotent** — an
   idempotency key, a dedupe check, a "was this already done" read before the
   side effect.

And three settings that the measurements above make concrete:

| setting | set it to | because |
|---|---|---|
| `safeLockTtl` / `safeDeliveryTtl` | slowest handler + 5 s (the pop window) + headroom | it is a processing deadline, and up to 5 s of it can be spent before the handler starts; a live handler past it is reclaimed and duplicated |
| `drainRequeue` | `false` under safe delivery | the lease already brings the job back; the re-push is a second copy |
| `drain` + `drainTimeout` | on, with a budget longer than your slowest handler | a drain finishes work in place instead of replaying it elsewhere |

Match the mode to the message and you get both: raw speed where loss is
acceptable, and a guarantee where it isn't that actually covers the work.

## FAQ

### Will I lose a message if a worker crashes mid-handler?

Not under guaranteed (safe) delivery. The message is moved into a key owned by
the worker when it is popped, and that key is held until the handler's promise
settles — not merely until the handler starts. A worker killed at any point
before then, `SIGKILL` included, leaves the message checked out, and the
watcher returns it to the queue for another worker once the dead process has
left the broker's client list. Measured three times: re-delivered in
7.3–7.4 seconds. Under unreliable delivery the message is lost.

### Is exactly-once delivery possible?

No. Doing the work and recording that it was done are two actions on two
machines, and a crash can fall between them; whichever you do first gives you
at-most-once or at-least-once. Exactly-once *processing* is achievable by making
the handler idempotent on top of at-least-once delivery, which is what Kafka
transactions and SQS FIFO deduplication actually do.

### What does at-least-once delivery mean in practice?

That duplicates are part of the guarantee, not a failure of it. A message is
redelivered whenever the system cannot prove it was handled: the worker died
mid-handler, the handler outran its deadline, or the handler threw. Every one
of those replays the handler from the start, so the handler must be safe to run
more than once.

### How quickly is a crashed worker's message re-delivered?

Within one watcher sweep of the process disappearing from Redis's client list —
`watcherCheckDelay`, five seconds by default — plus a little more if the dead
process held the watcher role and a survivor has to take it over. Measured at
7.3–7.4 seconds across three `SIGKILL` runs. It does not wait for
`safeLockTtl`.

### What is safeLockTtl (safeDeliveryTtl) actually for?

A processing deadline: the longest a live worker may hold a message before the
watcher treats the handler as wedged and re-queues the message. It is not how a
crash is recovered — that comes from the client list. A healthy handler that
runs past it is reclaimed and duplicated. The clock starts when the worker
issues its blocking pop, up to five seconds before a message arrives, so set it
to your slowest handler plus five seconds plus headroom. The default is 300
seconds in `@imqueue/core` and 10 seconds in `@imqueue/job`.

### What happens to a job when I drain a worker on deploy?

The drain waits up to `drainTimeout` for the running handler, so the job
finishes in place rather than being replayed elsewhere. A job the budget runs out
on is still checked out and comes back through the lease once the process exits.
With `drainRequeue` on — the default in `@imqueue/job` — a `JobQueue` also pushes
it back explicitly, so the survivor receives it more than once; on a
`JobQueueWorker` the re-push cannot send at all and fails with `code unknown`,
so the option does nothing there. Measured either way: turn it off under safe
delivery.

### What does guaranteed delivery cost?

About 40% of throughput on one measured rig — roughly 200,000 round-trip
messages per second unreliable against 120,000 guaranteed, for ~1 KB messages —
and it is chosen per queue, so only the queues that need it pay.

### Do handlers have to be idempotent?

Yes, for anything on a guaranteed queue. At-least-once means the handler runs
again from the start after a crash, after a deadline overrun, and after a throw.
An idempotency key or a check for the effect before producing it is what turns
at-least-once delivery into exactly-once processing.

## Reference

- [`IMQOptions.safeDelivery`](/api/core/latest/core.imqoptions.safedelivery/) —
  the contract, where the behaviour lives
- [`IMQOptions.safeDeliveryTtl`](/api/core/latest/core.imqoptions.safedeliveryttl/)
  — the processing deadline
- [`IMQOptions.watcherCheckDelay`](/api/core/latest/core.imqoptions.watchercheckdelay/)
  — the sweep interval that bounds recovery
- [`JobQueueOptions.safe`](/api/job/latest/job.jobqueueoptions.safe/),
  [`safeLockTtl`](/api/job/latest/job.jobqueueoptions.safelockttl/),
  [`drain`](/api/job/latest/job.jobqueueoptions.drain/) and
  [`drainRequeue`](/api/job/latest/job.jobqueueoptions.drainrequeue/) — the
  job-queue settings
- [What happens to a job if the worker dies while handling it?](/api/faq/#what-happens-to-a-job-if-the-worker-dies-while-handling-it)
  — the short answer, in the FAQ
- [Graceful shutdown and zero-drop deploys](/blog/graceful-shutdown-zero-drop-deploys/)
  — the drain, end to end
- [Benchmarking @imqueue: throughput and delivery modes](/blog/benchmarking-imqueue-throughput/)
  — where the cost figures come from
