---
layout: docs.html
section: docs
title: "Agent recipe: diagnosing a lost message or a dropped job"
docLabel: AGENT RECIPE
lead: "Machine-oriented procedure for AI agents investigating an @imqueue message that never arrived or a job that never ran: which log line proves which failure, the version each line requires, the commands that reproduce it, and the wrong conclusions to rule out."
description: "AI-agent recipe for diagnosing silent @imqueue failures: the log line that proves a rejected send(), a dropped job or a late RPC reply, with versions, reproduction commands and failure modes."
keywords: "imqueue silent failure agent recipe, imqueue lost message diagnosis, JobQueue push error, imqueue no retry, imqueue ai agent, send does not throw, imqueue logger ILogger"
relatedTopics: [observability, resilience, jobs, delivery]
noindex: true
---

<!--
  noindex: this page is a machine-facing operational recipe that deliberately
  overlaps the human article at /blog/silent-failures-nodejs-message-queue/.
  Keeping it out of the search index avoids duplicate-content / keyword
  cannibalization between the two. It stays fully available to AI agents: listed
  in /llms.txt, directly fetchable, and served via the MCP get_doc markdown
  mirror.
-->


[[toc]]

These are operational instructions for AI agents diagnosing an `@imqueue`
message or job that disappeared without an error. A human-oriented walkthrough of
the same material, with the measurements behind it, is at
[/blog/silent-failures-nodejs-message-queue/](/blog/silent-failures-nodejs-message-queue/).

## When to apply this recipe

Apply it when the user reports any of:

- a message, event or job that **never arrived**, with **no error anywhere**;
- an enqueue that "worked" — it returned a message id, or returned at all — while
  nothing was consumed;
- a background job that **ran once, failed, and never came back**;
- a caller that timed out against a service the user insists was running;
- an event that was published while a consumer saw nothing.

Do **not** apply it when the caller received a rejection. A call that rejected
with `IMQ_RPC_CALL_TIMEOUT`, or a handler that threw where the throw reached the
caller, is an ordinary error with an ordinary trace; this recipe is only for
failures that produced none.

## Facts these recipes rely on

- **An enqueue does not wait for the broker.**
  [`send()`](/api/core/latest/core.redisqueue.send/) resolves with a locally
  generated UUID *before* redis confirms the write.
  [`push()`](/api/job/latest/job.jobqueuepublisher.push/) is not asynchronous at
  all — it returns the queue, for chaining. A write rejected afterwards therefore
  cannot reject a promise, and never could. Do not "fix" this by awaiting
  something; there is nothing to await.
- **`errorHandler` is the only *programmatic* observation of a failed `send()`**,
  passed as its optional fourth argument. `push()` accepts no such handler at
  all: for it the log is the only channel that exists.
- **A redis client may deliver one failure twice** — through the command callback
  and through the returned promise. `errorHandler` fires per delivery (measured:
  10 invocations for 5 failed sends); the log counts the logical failure once. A
  metric driven by `errorHandler` is double-counting.
- **The logger is `console` by default**
  ([`IMQOptions.logger`](/api/core/latest/core.imqoptions.logger/) defaults to
  it), so these lines already exist on stdout. Redirect them by passing anything
  matching [`ILogger`](/api/core/latest/core.ilogger/) — `log`, `info`, `warn`,
  `error`. `@imqueue/job` takes the same option as
  [`JobQueueOptions.logger`](/api/job/latest/job.jobqueueoptions.logger/).
- **None of these lines is gated on
  [`verbose`](/api/core/latest/core.imqoptions.verbose/).** Do not tell a user to
  enable it to see them; `verbose` controls per-operation tracing and is
  unrelated.
- **Versions matter and must be checked first.** The lines below require
  `@imqueue/core` **>= 3.4.0**, `@imqueue/rpc` **>= 3.7.0** and `@imqueue/job`
  **>= 3.1.0**. Below those, the absence of a line proves nothing.
- **Repeating conditions are reported on entering the state**, not per
  occurrence. A single `error` line can stand for an arbitrary number of
  failures; the count arrives with the recovery line.
- **No line carries a payload, call arguments, a raw redis key or error text.**
  Only an allow-listed failure code is printed — an `IMQ_`-prefixed framework
  code, a system errno (`ECONNREFUSED`, …), a small integer, a known redis reply
  code (`WRONGTYPE`, `NOSCRIPT`, `LOADING`, `MISCONF`, …), or one of a few fixed
  redis-client messages mapped to codes of the framework's own. Everything else
  reports as `unknown`. Never advise a user to expect a stack trace from these
  lines, and never propose a patch that prints the caught error.
- **A retry's delay is the job's original push delay.** When an
  `@imqueue/job` handler throws, the value used to re-schedule is the `delay` the
  job was pushed with. A job pushed without a delay has nothing to re-schedule by
  and is dropped. Returning a number from the handler is the explicit way to ask
  for a retry.
- **Each retry is a fresh `send()` and gets a fresh message id.** Attempts of one
  job cannot be correlated by message id.

## Recipe 1 — decide which failure this is

1. Establish the installed versions before reading any log:

   ~~~bash
   npm ls @imqueue/core @imqueue/rpc @imqueue/job
   ~~~

   If any is below the minimum above, stop and report that the diagnostic lines
   do not exist in this build. Upgrading is the first step, not a workaround.

2. Confirm a logger is reaching somewhere you can read. If the service passes no
   `logger`, the lines are on stdout.

3. Match the symptom against the table, then confirm with the line. The line is
   the evidence; the symptom alone is not.

| Symptom | Line to search for | Level | Conclusion |
| --- | --- | --- | --- |
| a `send()` produced nothing | `write to queue <name> rejected on` | `error` | the write was refused by redis; the message does not exist |
| — how many were lost | `outbound writes resumed after N rejected writes` | `info` | `N` is the size of the episode |
| a job never ran | `[JobQueue] push error: queue <name>` | `error` | it was never enqueued; the caller was not told |
| a job ran once and vanished | `Error handling job: … , no retry` | `error` | the handler threw and nothing re-scheduled it |
| a job stopped retrying early | `retry suppressed, ttl expired` | `info` | the job's `ttl` elapsed before the next attempt |
| a retry was promised and missed | `Job re-schedule failed: … code <code>` | `error` | the re-schedule's own write was rejected |
| a caller timed out | `response to request … has no pending call` | `warn` | the service **did** answer, after the caller gave up |
| an event reached nobody | `published to channel … with no subscribers` | `warn` | `publish()` succeeded against an empty channel |
| a subscription silently died | a `restored subscription to channel` line that is **missing** after a reconnect | `info` | absence is the evidence here, not presence |

4. Report the conclusion with the line quoted verbatim. Do not paraphrase a
   failure code.

## Recipe 2 — fix a job that is dropped instead of retried

Applies when the log shows `Error handling job: …, no retry` and the user expected
a retry.

1. Find the `push()` for that queue. If it passes no `delay`, that is the cause.
2. Choose one, and only one:
   - **Return a delay from the handler.** Catch the error inside the handler and
     return a number of milliseconds. This is explicit and does not depend on how
     the job was pushed:

     ~~~typescript
     worker.onPop(async (job) => {
         try {
             await handle(job);
         } catch (err) {
             return 30000; // retry in 30s
         }
     });
     ~~~
   - **Push with a delay**, when every job on that queue should retry on the same
     cadence.
3. Do not add an `attempts` option — there is none. There is also no dead-letter
   destination: carry an attempt counter in the job payload and write the
   park-for-review path yourself.
4. Verify per Recipe 4: the line must read `retry in <ms>`.

**Never** return `0` from the handler — that re-schedules immediately and spins
the worker. Return a negative number, or nothing, to stop.

## Recipe 3 — route the lines somewhere durable

1. Install a logger that implements [`ILogger`](/api/core/latest/core.ilogger/).
   [`@imqueue/async-logger`](/api/async-logger/latest/)'s default export already
   does, and configures its transports from the environment:

   ~~~typescript
   import logger from '@imqueue/async-logger';

   const service = new IMQService({ logger });
   ~~~

2. Pass the same object to every queue in the process, including
   `JobQueueOptions.logger`. A queue with no `logger` writes to `console`, which
   is easy to lose in a container.
3. Alert on the failure lines by **rate**, not per occurrence, and always capture
   `N` from the recovery line — it is the only count of what was lost.
4. Add one alert for an *absent* line: a reconnect not followed by
   `restored subscription to channel` is a subscription that is gone.

Do **not** wrap the logger in anything that can throw on `info`. Lines added by
the 3.4.0/3.7.0/3.1.0 wave are written through a contained writer and cannot
affect the queue, but the older connection-lifecycle lines are not contained, so
a throwing `info` can still fail `start()`.

## Verify

Reproduce each line deliberately, against a throw-away redis, before concluding
that a user's build does not emit it. Turning the destination key into a string
makes redis reject the write with `WRONGTYPE`:

~~~bash
redis-server --port 6399 --daemonize yes --save '' --appendonly no
redis-cli -p 6399 set imq:Reports 'not a list'
~~~

~~~typescript
import IMQ from '@imqueue/core';

const imq = IMQ.create('Sender', { host: '127.0.0.1', port: 6399 });

await imq.start();
await imq.send('Reports', { report: 1 });   // resolves; the write is refused
~~~

Expect, on `@imqueue/core >= 3.4.0`:

~~~
[IMQ-CORE][Sender]: write to queue Reports rejected on LPUSH, message <uuid>, code WRONGTYPE
~~~

Then `redis-cli -p 6399 del imq:Reports` and send again; expect
`outbound writes resumed after N rejected writes`. For the job lines, do the same
against `imq-job:<queue>` for a push failure and `imq-job:<queue>:delayed` for a
failed re-schedule.

Confirm the redaction rule rather than assuming it: throw an error whose `code`
is an application string (`CARD_DECLINED`) and check that the line reports
`code unknown`.

## Failure modes

| Symptom | Cause | What to do instead |
| --- | --- | --- |
| No diagnostic line anywhere | `@imqueue/core <= 3.3.3`, `@imqueue/rpc <= 3.6.x` or `@imqueue/job <= 3.0.3` | check versions first; below the minimum, silence is not evidence |
| Line expected but the log is empty | a `logger` was passed that drops `warn`/`error`, or output is `console` in a container that discards stdout | route through `ILogger` per Recipe 3 |
| `code unknown` on a real failure | the error's code is not allow-listed — by design | diagnose from the operation and message id; never patch the framework to print the error |
| A metric counts twice as many failures as the log | `errorHandler` fires per delivery, the log per logical failure | drive the metric from the log line, or de-duplicate by message id |
| Retries cannot be grouped by message id | every retry is a new `send()` with a new id | correlate on the queue name plus a job-payload id you control |
| `Error handling job: … no retry` on a job that should retry | pushed without a delay, handler threw | Recipe 2 |
| Stack traces disappeared from `@logged()` records after upgrading | `@imqueue/rpc` 3.7.0 logs `Class.method() failed, code <code>` | catch in the method and log the error yourself, with your own redaction |
| A caller times out while the service is healthy | the reply arrived after `callTimeout` | look for `has no pending call`; raise [`callTimeout`](/api/rpc/latest/rpc.imqclientoptions.calltimeout/) or add consumers |
| `start()` throws from inside a logger | a logger that throws on `info`; those lines are not contained | make the logger's transport non-throwing |
| Enabling `verbose` to reveal these lines | `verbose` controls tracing, not failure reporting | remove it; the lines are unconditional |

## Related

- [Nothing threw, and the job never ran](/blog/silent-failures-nodejs-message-queue/)
  — the narrative version, with the measurements.
- [Delayed &amp; scheduled work](/agents/delayed-scheduled-work/) — the recipe for
  the timing side, including the handler-outcome contract in full.
- [API FAQ](/api/faq/) — the one-question version of where a failed `send()` or
  `push()` shows up.
