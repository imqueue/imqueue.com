---
layout: post.html
permalink: /blog/silent-failures-nodejs-message-queue/
templateEngineOverride: md
title: "Nothing threw, and the job never ran: silent failures in a Node.js message queue"
summary: "A send() that resolves with a message id nobody will ever deliver. A push() that returns cleanly onto a queue redis refused to write. Neither throws, and neither can — the caller has already moved on by the time redis answers. That silence is over: here is what each of those failures now writes to the log instead, and the one upgrade note that costs you a stack trace."
description: "Why a fire-and-forget send() or push() cannot throw in a Node.js message queue, and where a lost message shows up instead: the log output added in @imqueue/core 3.4.0, @imqueue/rpc 3.7.0 and @imqueue/job 3.1.0, with the redaction rules and what to alert on."
keywords: "nodejs message queue silent failure, send does not throw, job never ran no error, redis queue lost message debugging, fire and forget error handling nodejs, at-least-once delivery logging, imqueue logger, JobQueue push error, nodejs background job dropped silently"
date: 2026-08-21
author: andrii
illustration: silent-failures
topics: [observability, resilience, delivery, jobs]
ogType: article
---

The bug report is always the same sentence. *The email never went out, and there
is nothing in the logs.*

Not an error. Not a stack trace. Not a retry that gave up. Nothing — which is the
part that makes it expensive, because the first day goes on proving the code even
ran. And it did run. The call was made, it returned a message id, the function
that made it went on to return `200 OK` to somebody, and the message it described
never existed anywhere.

That is not a bug in the queue. It falls straight out of an enqueue that does not
wait for the broker, which is the reason an enqueue is cheap enough to put in a
request handler in the first place. What *was* wrong is that it left no trace at
all.

That part is fixed now. `@imqueue/core` **3.4.0**, `@imqueue/rpc` **3.7.0** and
`@imqueue/job` **3.1.0** are one change seen from three sides: the failures that
used to be invisible report through the logger you already configured. No
`verbose` flag to turn on, no new API to call, no options to pass — upgrade and
they are there.

Here is what each of them looks like, and what it lets you conclude.

> The output below is what these versions print, on Node 22.22.2 against Redis
> 7.0.15. Writes were failed on purpose by turning a destination key into a
> `string`, so redis rejects the `LPUSH` with `WRONGTYPE` — an easy way to
> reproduce any of it locally.

## Why `send()` cannot throw

Worth pinning down first, because every failure below follows from it.

An `@imqueue` enqueue does not wait for redis. `send()` mints a UUID locally,
hands the packet to the redis client, and resolves — the write is still in
flight:

~~~typescript
const id = await imq.send('Reports', { report: 1 });
// `id` exists. The LPUSH may not have happened yet, and may never happen.
~~~

`push()` in `@imqueue/job` goes further: it is not even `async`. It returns the
queue itself, for chaining.

So by the time redis says *no*, there is no promise left to reject and no caller
still holding one. The rejection has nowhere to go:

~~~mermaid
sequenceDiagram
    participant C as Caller
    participant Q as imq.send()
    participant R as Redis
    C->>Q: send("Reports", payload)
    Q-->>C: resolves with a message id
    Note over C: the handler returns 200 OK
    Q->>R: LPUSH imq:Reports
    R--xQ: WRONGTYPE
    Note over Q: nobody is waiting for this
~~~

An `@imqueue` enqueue resolves before the broker confirms the write, which is why
a rejected write cannot surface as a rejected promise.

That trade is deliberate and it has not changed. Waiting for the write would put
a redis round-trip in front of every fire-and-forget call, and the whole point of
`send()` returning immediately is that a request handler can hand off work
without paying for it. What changed is only who finds out when the write loses.

## Five messages, five ids, nothing on the queue

Send five messages to a destination redis will refuse, and pass no
`errorHandler` — which is how the overwhelming majority of calls are written,
since `errorHandler` is an optional fourth positional argument of
[`send()`](/api/core/latest/core.redisqueue.send/) that most callers never reach
for.

Every one of them comes back with an id:

~~~
send() resolved with 24e12d63-8e9c-4329-895c-4b8feced84c8
send() resolved with 981960a0-3fe5-4648-8c57-40e232cd7502
send() resolved with e174440a-7a28-45e3-b844-397ef5960032
send() resolved with d4493070-6bd7-44bf-96cf-fd0909be7ca6
send() resolved with 4ee77bf6-e046-4bd7-a56b-353f0a808585
~~~

On `@imqueue/core` **3.3.3**, here is the entire log for that:

~~~
info  | Sender: reader channel connected, host 127.0.0.1:6399, pid 21487
info  | Sender: writer channel connected, host 127.0.0.1:6399, pid 21487
info  | Sender: watcher channel connected, host 127.0.0.1:6399, pid 21487
~~~

Three lines, all of them about connecting. Five messages are gone and the log is
not merely quiet about it — it is *reassuring*.

Same code, same failure, on **3.4.0**:

~~~
info  | Sender: reader channel connected, host 127.0.0.1:6399, pid 21102
info  | Sender: writer channel connected, host 127.0.0.1:6399, pid 21102
info  | Sender: watcher channel connected, host 127.0.0.1:6399, pid 21102
error | [IMQ-CORE][Sender]: write to queue Reports rejected on LPUSH, message 2ee52f3d-af44-46b7-bab1-084c892ca41b, code WRONGTYPE
info  | [IMQ-CORE][Sender]: outbound writes resumed after 5 rejected writes
~~~

Two lines for five failures, and that ratio is the point. Repeating conditions
are reported **on entering the state**, not per occurrence: the first rejected
write of an episode is logged in full — operation, message id, failure code — and
every rejection after it just increments a counter. The counter comes back out
when a write finally succeeds, which is why the recovery line is the one that
tells you how big the outage was. A broker down for ten minutes costs you two log
lines, not ten minutes of them.

Notice what the error line does *not* carry: no payload, no arguments, no raw
redis key. That is a rule rather than an accident, and it gets a section of its
own below.

### Why `errorHandler` was never enough

The obvious objection is that `send()` has always taken an `errorHandler`, so
this was observable all along. It was — programmatically, by callers who
remembered to pass one. Two reasons that is not the same thing.

Run those five failures again, this time *with* a handler, and count the calls:

~~~
5 rejected sends -> errorHandler calls: 10, error lines: 1
~~~

Ten. The redis client delivers this particular failure twice, through the command
callback and through the returned promise, and `errorHandler` fires on each
delivery — exactly as it always has. The episode counts the *logical* failure
once. So if you have an `errorHandler` incrementing a metric somewhere, that
metric has been double-counting, and the log line beside it is now how you find
out.

The second reason is simpler. An `errorHandler` is per call site; the logging is
per queue. One is something you have to remember at every place that enqueues
work, the other is just true of the process.

## The job queue's version of the same silence

`@imqueue/job` has the sharper edge, because
[`push()`](/api/job/latest/job.jobqueuepublisher.push/) takes no error handler at
all. There is no parameter to pass. The log is the only channel there is — which
is exactly why that package's own documentation calls the `logger` option *worth
supplying*.

Push onto a queue redis refuses, and 3.1.0 gives you this:

~~~
error | [IMQ-CORE][Broken]: write to queue Broken rejected on LPUSH, message a7aeb890-beac-49ae-a761-cfd005d7a959, code WRONGTYPE
error | [JobQueue] push error: queue Broken, delay none, ttl none, code WRONGTYPE
~~~

Two lines, one from each layer: core reports the write, `@imqueue/job` reports
the enqueue — with the queue, the requested delay and ttl, and a code. `push()`
returned normally in between, as it always does. The marker text
`[JobQueue] push error:` is unchanged from earlier versions; what 3.1.0 added is
that it now also covers a write rejected *after* `push()` returned, and reports
at `error` level.

## `no retry` — the drop you used to have to infer

The failure that costs the most support time is not the one above. It is a job
that ran, threw, and was never seen again — because `@imqueue/job` has no
declarative `attempts` policy. Whether a failed job comes back is decided by the
handler's return value, plus one detail that is easy to miss.

Take the same handler, throwing `ECONNREFUSED`, and change nothing but the push.

**Pushed with no delay:**

~~~
error | [JobQueue] Error handling job: queue DropCase, message d6aa27d5-6613-4f70-98f3-682f0ecf7d8d, code ECONNREFUSED, no retry
~~~

Handler ran once. The job is gone. That is the trap, and now the queue states it
instead of leaving you to work it out: when a handler throws, the delay used to
re-schedule is the delay the job was **pushed** with — so a job pushed without one
has nothing to be re-scheduled by.

**Pushed with `{ delay: 400 }`:**

~~~
error | [JobQueue] Error handling job: queue RetryCase, message a6002f7c-915c-404d-a01b-090af8bf581e, code ECONNREFUSED, retry in 400 ms
error | [JobQueue] Error handling job: queue RetryCase, message 9c183c6d-3448-4cf7-b65d-e649279c50c0, code ECONNREFUSED, retry in 400 ms
~~~

Same handler, same throw, opposite outcome — because the push carried a delay.
One thing to catch here: the two lines carry **different message ids**. A retry
is a fresh `send()`, so it gets a fresh id. You cannot count one job's attempts
by grouping on the message id, and an alert that tries to will read every attempt
as a new job.

**Pushed with `{ delay: 400, ttl: 500 }`:**

~~~
error | [JobQueue] Error handling job: queue TtlCase, message 06812f73-fc51-4d16-b890-8eb460d2fda3, code ECONNREFUSED, retry in 400 ms
error | [JobQueue] Error handling job: queue TtlCase, message 7c2d3326-8c2e-4555-85b8-3f40c71b930e, code ECONNREFUSED, no retry
info  | [JobQueue] retry suppressed, ttl expired: queue TtlCase, message 7c2d3326-8c2e-4555-85b8-3f40c71b930e
~~~

`ttl` bounds how long a job stays worth re-scheduling, counted from the push — so
the second attempt runs, fails, and finds the window already closed. The decision
flips to `no retry`, and a second line says which of the two reasons it was.
Without that pair, a job that stopped retrying after one round looks identical to
a job that was never retried at all.

**And the retry that was promised and is not coming:**

~~~
error | [JobQueue] Error handling job: queue ReschedCase, message e3c3ef78-31f2-492a-9590-c19786a63c32, code ECONNREFUSED, retry in 300 ms
error | [IMQ-CORE][ReschedCase]: write to queue ReschedCase rejected on ZADD, message b8b70e90-b645-42e9-9cf1-71b3d3fbc2dc, code WRONGTYPE
error | [JobQueue] Job re-schedule failed: queue ReschedCase, message e3c3ef78-31f2-492a-9590-c19786a63c32, code WRONGTYPE
~~~

This is the sequence worth pinning to a wall. The queue said `retry in 300 ms`,
the re-schedule's own write to redis was then rejected, and the third line
retracts the promise the first one made. Read the ids: the core line names the
**new** delivery that failed to be written, the job lines name the job you were
already following. Treat a re-schedule as an enqueue that can fail, because that
is what it is.

## A late reply is not a missing reply

On the RPC side, `@imqueue/rpc` 3.7.0 adds one line, for a condition that used to
be indistinguishable from a service that simply never answered.

Give a client `callTimeout: 300` and a service that answers in 600ms:

~~~
caller got: IMQ_RPC_CALL_TIMEOUT — Call to UserService.get() timed out after 300 ms.

warn  | UserService: response to request 7a9fb5cc-6979-4840-a61a-c00c6ab42fd8 has no pending call, method get
~~~

The caller's rejection tells you the call did not finish in time. The warning
tells you the service **did answer** — you gave up first. Those are different
incidents with different fixes: one is a `callTimeout` set too tight or a
consumer pool that is saturated, the other is a service that is genuinely down.
And after a restart, a burst of these lines is the backlog the previous process
left behind, addressed to a reply queue nobody is reading any more.

A publish has its own version of the same idea:

~~~
warn  | [IMQ-CORE][Events]: published to channel Events on host 127.0.0.1:6399 with no subscribers
~~~

`publish()` resolved successfully every time. Redis pub/sub delivers to whoever
happens to be listening and reports success either way, so "the event fired" and
"somebody received it" have always been two different claims. Now the second one
is checkable.

## What these lines will never print

The reason this is not simply *log more* is the rule underneath it: **no failure
code is ever taken from the error as-is.**

Only an allow-listed code is printed — an `IMQ_`-prefixed framework code, a
system errno such as `ECONNREFUSED`, a small integer, a known redis reply code
(`WRONGTYPE`, `NOSCRIPT`, `LOADING`, `MISCONF`, …), or one of a few fixed
redis-client failure messages mapped to codes of the framework's own. Everything
else — the error's message, its stack, its class name — comes out as `unknown`.

That looks over-cautious until you see what it is protecting against. Here is
`@logged()` on `@imqueue/rpc` **3.4.4**, on a method that throws an application
error:

~~~
logger.error <- Error: card 4111111111111111 declined for 42 EUR
    at PaymentService.charge (…/payment-service.js:12:17)
    at PaymentService.charge (…/@imqueue/rpc/src/decorators/logged.js:46:39)
    … {
  code: 'CARD_DECLINED',
  args: [ { pan: '4111111111111111', cvv: '737' }, 42 ]
}
~~~

A card number, a CVV and the full argument list, in your log aggregator, forever.
Nobody logged them on purpose — the decorator handed the caught error to the
logger and the error carried them along. An `@imqueue` framework error carries
the call arguments in its own properties by design, so this is not limited to
errors somebody wrote carelessly.

The same method on **3.7.0**:

~~~
logger.error <- PaymentService.charge() failed, code unknown
~~~

`CARD_DECLINED` is not on the allow-list, so it reports as `unknown` — the rule
holds even where the code was harmless. The class and the method survive, because
those are yours and are not data.

**This is the one upgrade note in the wave.** If you were parsing stack traces or
error messages out of `@logged()` records, they are gone, and the new line cannot
give them back. Everything else about the decorator is unchanged: which logger it
resolves, `doNotThrow`, and the value it re-throws. Where you do need the error
itself, catch it in the method and log it yourself, with whatever redaction your
own policy calls for.

## A broken logger cannot break the queue

Every line added here goes through a contained writer, so a logger that throws
cannot turn into a queue failure. Give the queue a logger that throws on every
`warn` and `error` call, break the destination, then repair it:

~~~
send() resolved both times: true
messages actually on the queue after repair: 1
process still alive: true
~~~

The failure was reported to a logger that exploded, the queue carried on, and the
message written after the repair arrived normally.

One honest limit: that containment covers the lines this wave added. The older
connection-lifecycle lines — the `channel connected` messages — are still written
directly, so a logger that throws on `info` can still take `start()` down. That
is a pathological logger rather than a realistic one, but if you are wrapping a
transport that can throw on a full disk, wrap it so it cannot.

## What to alert on

The lines are per-event; your alerts should not be. A practical mapping, with the
level each line is written at:

| Line | Level | What it means | Reasonable response |
| --- | --- | --- | --- |
| `write to queue … rejected on …` | `error` | a `send()` never reached redis | page if it repeats — the messages are gone, not delayed |
| `outbound writes resumed after N rejected writes` | `info` | the episode ended | record `N`; it is the only count of what was lost |
| `[JobQueue] push error: …` | `error` | a job was never enqueued | same as above, and the caller does not know |
| `Error handling job: … no retry` | `error` | that job is finished, unsuccessfully | this is your dead-letter signal — there is no dead-letter queue |
| `Error handling job: … retry in N ms` | `error` | it is coming back | alert on rate, not on occurrence |
| `retry suppressed, ttl expired` | `info` | a retry was wanted and refused | usually a `ttl` set shorter than the retry needs |
| `Job re-schedule failed: …` | `error` | a promised retry is not coming | treat exactly like `no retry` |
| `response to request … has no pending call` | `warn` | the service answered after you gave up | look at `callTimeout` and consumer saturation, not at the service |
| `published to channel … with no subscribers` | `warn` | the event reached nobody | a consumer is down, or the channel name is wrong |
| a subscription restored after a reconnect | `info` | the subscription survived | the **absence** of this line after a reconnect is the alert |

Two of those invert the usual instinct, so they are worth repeating. The recovery
line is the one carrying the outage's size, so a rule that only matches `error`
throws the count away. And a lost subscription is provable only by a line that
*does not* appear — so if you take one thing from this list, alert on reconnects
that are not followed by a restore.

## Turning them on (you already have)

There is nothing to enable. `logger` defaults to `console`, so on these versions
the lines are already on your stdout. To send them somewhere more useful, set
[`logger`](/api/core/latest/core.imqoptions.logger/) in the queue options to
anything matching [`ILogger`](/api/core/latest/core.ilogger/) — four methods,
`log`, `info`, `warn` and `error`:

~~~typescript
import logger from '@imqueue/async-logger';
import { IMQService } from '@imqueue/rpc';

const service = new IMQService({ logger });
~~~

[`@imqueue/async-logger`](/api/async-logger/latest/)'s default export satisfies
that shape and configures its transports from the environment, so a service
already using it needs no change at all. `@imqueue/job` takes the same option as
[`JobQueueOptions.logger`](/api/job/latest/job.jobqueueoptions.logger/), and it
is the one option that package actively recommends setting.

None of this is [`verbose`](/api/core/latest/core.imqoptions.verbose/). That flag
still controls the chatty per-operation tracing and still defaults to `false`;
the lines here are written regardless of it. They are failures, not diagnostics.

## FAQ

### Why does a failed send() or push() not throw in @imqueue?

Because neither waits for the broker. `send()` resolves with a locally generated
message id before redis confirms the write, and `push()` is not asynchronous at
all — it returns the queue for chaining. By the time redis rejects the write the
caller has moved on, so there is no promise left to reject. That is the design,
and it is what makes an enqueue cheap enough to put in a request handler. Since
`@imqueue/core` 3.4.0, `@imqueue/rpc` 3.7.0 and `@imqueue/job` 3.1.0 the failure
is reported through the configured logger instead.

### How do I find out that a job was dropped instead of retried?

Look for `[JobQueue] Error handling job:` with `no retry` at the end. Since
`@imqueue/job` 3.1.0 every handler failure states the decision it just made —
`retry in <ms>` or `no retry` — with the message id, so a drop is provable rather
than inferred. The usual cause is that the job was pushed without a delay: when a
handler throws, the delay used for the retry is the delay the job was pushed
with, and there is nothing to re-schedule by if it had none.

### Do I still need to pass an errorHandler to send()?

Only if you need to react in code — to increment a metric, fail a request, or
fall back to another path. For simply finding out that something failed, the log
line is better: it is per queue rather than per call site, so it cannot be
forgotten at one of the places that enqueue work. Note too that a redis client
may deliver the same failure twice, so `errorHandler` fires twice per logical
failure — ten calls for five failed sends — while the log counts it once.

### Will @imqueue log my message payload or my error message?

No. No line carries a message payload, call arguments, a raw redis key or an
error text. Only an allow-listed failure code is printed: an `IMQ_`-prefixed
framework code, a system errno, a small integer, a known redis reply code, or one
of a few fixed redis-client messages mapped to codes of the framework's own.
Everything else, the error's message, stack and class name included, comes out as
`unknown` — because an application error may carry personal data and an imq error
carries the call arguments in its properties.

### What breaks when I upgrade to @imqueue/rpc 3.7.0?

One thing: `@logged()` now writes `Class.method() failed, code ...` — the class,
the method and an allow-listed failure code — instead of handing the caught error
to the logger, so stack traces and error messages no longer appear in those
records. If you parse them, that is the change to plan for. Everything else about
the decorator is unchanged, including which logger is resolved, `doNotThrow`, and
the value re-thrown. The upside is that arguments and error text can no longer
leak into your log aggregator through it.

### Can a broken logger break my queue?

Not through the lines this wave added: each of them is written through a
contained writer, so a logger that throws is swallowed and the queue carries on.
The older connection-lifecycle lines are not contained, so a logger that throws
on `info` can still fail `start()`. Wrap a transport that can genuinely throw.

## What the silence was costing

The interesting thing about this whole class of failure is that none of it was a
delivery bug. The queue behaved exactly as specified every time: an enqueue that
does not wait cannot report, a handler that throws without a delay has nothing to
re-schedule with, and a publish reaches whoever is listening. Each one is a
documented property.

What it cost was that those properties were only knowable by reading the source.
An enqueue that vanished and a queue that was idle looked identical from outside,
and so did a job that was dropped and a job that was still coming, and a service
that never answered and a service that answered too late. Every one of those
pairs now differs by a line — a smaller change than it sounds like, and a much
larger one than it looks like at three in the morning.

~~~bash
npm i --save @imqueue/core@^3.4.0 @imqueue/rpc@^3.7.0 @imqueue/job@^3.1.0
~~~

If you are pointing an AI assistant at one of these incidents, there is a
machine-readable version of the same material — the diagnostic table, the
commands to reproduce each line, and the failure modes as a lookup — in the
[agent recipe on diagnosing silent failures](/agents/silent-failures/). The
reference pages for the symbols named here are
[`IMQOptions.logger`](/api/core/latest/core.imqoptions.logger/),
[`ILogger`](/api/core/latest/core.ilogger/),
[`RedisQueue.send()`](/api/core/latest/core.redisqueue.send/),
[`JobQueuePublisher.push()`](/api/job/latest/job.jobqueuepublisher.push/),
[`JobQueuePopHandler`](/api/job/latest/job.jobqueuepophandler/),
[`PushOptions.ttl`](/api/job/latest/job.pushoptions.ttl/) and
[`logged()`](/api/rpc/latest/rpc.logged/); the [API FAQ](/api/faq/) has the
one-question version. If what you are chasing is a delayed job rather than a lost
one, [delayed and scheduled work](/blog/scheduled-work-without-a-job-system/)
covers the timing side, and [guaranteed message
delivery](/blog/guaranteed-message-delivery-cost/) covers what `safeDelivery`
does and does not promise.
