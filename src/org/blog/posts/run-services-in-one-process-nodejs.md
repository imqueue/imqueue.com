---
layout: post.html
permalink: /blog/run-services-in-one-process-nodejs/
templateEngineOverride: md
title: "Several Node.js services in one process: a modular monolith you can take apart later"
summary: "Running a system as separate services means deploying, monitoring and paying for many processes from day one, long before most of them need it. With @imqueue/rpc 3.11 you can write separate services and run them together in one process, where their calls to each other skip the queue entirely, then move any of them out later without touching the code that calls it. Here is how, what stays exactly the same, what changes, and when to split. Every number is measured."
description: "A measured recipe for running several @imqueue services in one Node.js process with local: true: the host file, what in-process calls keep (hooks, checks, JSON copies, timeouts, errors), what they change (no Redis, 14x lower latency, a shared event loop), how replicas and outside callers are served, shutdown, and when to move a service into its own process."
keywords: "modular monolith nodejs, run multiple services in one process, in-process service calls nodejs, microservices too early, imqueue local service, imqueue in process"
date: 2026-11-17
author: serhiy-morenko
illustration: one-process
topics: [architecture, migration, rpc]
ogType: article
---

Running a system as separate services has a cost that arrives on day one. Every
service is a process to deploy, to monitor, to restart and to pay for, and every
call between two of them is a trip over the network. That cost is worth paying
for the services that need to scale on their own or fail on their own. Most
services, most of the time, need neither.

The alternative is usually described as a choice: a monolith now, and a painful
rewrite later, or services now, and their overhead from the start.
`@imqueue/rpc` 3.11 takes the choice away. You write separate services, each
with its own class, methods and generated client, and you can run them together
in one process. Calls between them then skip the queue and run as direct
function calls. When one of them needs its own process, you start it on its
own. **The code that calls it doesn't change.**

This post shows how to set that up, what stays exactly the same, what changes,
and how to tell when a service is ready to move out.

**Everything below was measured** with `@imqueue/rpc` 3.11.0 and
`@imqueue/core` 3.6.0 against Redis 8 on Node.js 24, running each test both
ways: with the service in the caller's process, and in a process of its own.

## The short version

- **Set `local: true` on a service** and start it in the same process as its
  callers. Clients in that process call it directly; nothing else changes.
- **The behaviour is the same.** The same hooks run, the same checks apply, and
  arguments and results are copied exactly as the queue copies them.
- **It's faster and quieter.** 0.005 ms per call instead of 0.07 ms at the
  median, and zero Redis commands for 2,200 calls instead of 8,800.
- **The queue is still served.** Other processes, delayed calls and events keep
  working, so moving a service out later is a deployment change, not a code
  change.
- **The services share one event loop.** A method that keeps the CPU busy for
  1.5 seconds froze its caller for 1.5 seconds. Separate processes don't.

## How it works

Every `@imqueue` service listens on a Redis queue named after it, and every
client sends its calls there. That's what lets any number of processes call any
number of others without knowing where they run.

A service started with
[`local: true`](/api/rpc/latest/rpc.imqserviceoptions.local/) does two
things. It still listens on its queue, exactly as before. And it registers
itself with the process it runs in, so that a client **in the same process**
finds it there and calls it directly instead of sending a message.

The client checks on every call. If the service it wants is registered in its
own process, the call is made in place. If not, the call goes through the queue
as it always has. The calling code is the same either way.

## Recipe 1: a host for several services

The services stay exactly as they are: separate classes, each with its own
[`@expose()`](/api/rpc/latest/rpc.expose/)d methods. What's new is a small file
that starts several of them together:

```typescript
// src/host.ts
import { localServiceNames } from '@imqueue/rpc';
import { Users } from './users/Users.js';
import { Orders } from './orders/Orders.js';

const options = { local: true };
const services = [new Users(options), new Orders(options)];

for (const service of services) {
    await service.start();
}

console.log('serving in process:', localServiceNames());

async function shutdown(): Promise<void> {
    for (const service of services) {
        await service.destroy();
    }

    process.exit(0);
}

process.once('SIGTERM', shutdown);
process.once('SIGINT', shutdown);
```

The shutdown handler is the host's job. A service started with `local: true`
deliberately installs no signal handlers of its own, because it doesn't own the
process. With the handler above, a `SIGTERM` closed both services and exited
with code 0 in 9 ms, leaving no connections open in Redis.

Inside `Orders`, calling `Users` looks exactly as it would across processes,
through the generated client:

```typescript
const user = await this.users.get(userId);
```

With `Users` started in the same host, that line is now a direct call.

Redis is still needed: each service keeps listening on its queue, so that other
processes can reach it.

## Recipe 2: trust that nothing changed

The point of this feature is that moving a service between "in process" and
"its own process" must not change what its callers see. So we ran the same set
of calls both ways and compared:

| what we checked | in process | through the queue |
|---|---|---|
| client and service hooks, in order | all 4 ran | all 4 ran |
| a `Date` argument arrives as | ISO string | ISO string |
| a class instance arrives as | plain object | plain object |
| an `undefined` property | dropped | dropped |
| the service changes an argument | caller's object untouched | caller's object untouched |
| [`IMQMetadata`](/api/rpc/latest/rpc.imqmetadata/) | arrives | arrives |
| a method that hangs, with `callTimeout` | `IMQ_RPC_CALL_TIMEOUT` | `IMQ_RPC_CALL_TIMEOUT` |
| a method that throws | same code and message | same code and message |
| a method not marked `@expose()` | `IMQ_RPC_NO_ACCESS` | `IMQ_RPC_NO_ACCESS` |

The copying is the part that matters most, and the easiest to get wrong. A
plain function call would hand the service the caller's own objects, so a
`Date` would stay a `Date` in process and become a string the day the service
moved out, and a service that changed its argument would change the caller's
data. The client avoids both by copying every request and every answer through
JSON, as the queue does. The function that does it,
[`wireCopy()`](/api/rpc/latest/rpc.wirecopy/), is exported if you want to test
your own values with it.

One difference is an improvement. A method that returned a value JSON can't
carry, a `BigInt`, failed at once in process with `IMQ_RPC_CALL_ERROR` and a
clear message. Through the queue, the same call simply timed out after its
1-second `callTimeout`.

## Recipe 3: know what it saves

The same method, called 2,000 times in a row, with Redis on the same machine:

| | in process | through the queue |
|---|---|---|
| median call | 0.005 ms | 0.070 ms |
| slowest 1% | 0.022 ms | 0.617 ms |
| Redis commands for 2,200 calls | **0** | 8,800 |

About 14 times faster at the median and 28 times at the slowest one percent,
and that's with Redis on the same machine, the best case for the queue. With
Redis across a network, every queued call also pays two network round trips,
which an in-process call doesn't.

The Redis line matters as much as the speed. Calls between services that live
together no longer use Redis memory, connections or CPU at all.

## Recipe 4: keep the queue for everything else

`local: true` adds a shortcut; it doesn't remove the queue. We checked the three
things that must still go through it.

**Calls from other processes.** We ran two processes, each hosting its own
copy of `Orders` in process, and a third process with no services calling
`Orders` 100 times. The queue shared those calls exactly **50 and 50** between
the two copies, as it always does.

**Calls from inside a host stay there.** Process A, calling `Orders` 100 times
itself, was served by its own copy **100 times out of 100**. Its calls never
reached the other copy. That's what you want for speed, but it means an
in-process caller gets no load balancing. If a busy caller needs its calls
spread across several copies of a service, that service belongs in processes
of its own.

**Delayed calls.** A call made with
[`IMQDelay`](/api/rpc/latest/rpc.imqdelay/) always goes through the queue, which
is what holds it until it's due. We saw its two queue commands in Redis while
the undelayed calls in the same process used none. Events sent with
`publish()` also travel through Redis as before.

To force a particular client to use the queue anyway, give it
[`local: false`](/api/rpc/latest/rpc.imqclientoptions.local/).

## Recipe 5: know the trade-off

Services in one process share one event loop, so they share one CPU core's
time. A method that keeps the CPU busy, such as building a large report or
resizing an image, holds up everything else in that process while it runs.

We called a method that keeps the CPU busy for 300 ms five times in a row, while
the caller ran a timer every 10 ms to measure how long it went without a turn:

| where the service ran | caller's longest freeze |
|---|---|
| in the caller's process | **1,507 ms** |
| in a process of its own | 11 ms |

In process, the five calls ran back to back with no gap, and for a second and a
half the caller could do nothing else: no other requests, no timers, no
heartbeats. In a process of its own, the same work happened somewhere else and
the caller barely noticed.

The same goes for failures. A service in your process shares its memory and its
fate: if it leaks memory or crashes, the whole process goes with it. And an
in-process call never passes through Redis, so if the process dies in the middle
of it, there's no queued message for
[safe delivery](/blog/guaranteed-message-delivery-cost/) to bring back. The
caller dies with it, so nobody is left waiting, but the work is lost.

## When to move a service out

Start everything in one host. Move a service into a process of its own when it
shows one of these signs:

- **It uses a lot of CPU**, and its callers notice. Recipe 5 is the test: if a
  timer in the host goes quiet while the service works, it's time.
- **It needs to scale differently.** One host process means one copy of every
  service in it. A service that needs five copies while the rest need one should
  run on its own.
- **It fails differently.** A service that calls an unreliable third party, or
  could run out of memory, shouldn't be able to take the others down.
- **A different team owns it**, and wants to deploy it on its own schedule.

Moving it out is a deployment change. Start that service in its own process,
without `local: true` or with it, and remove it from the host's list. Its
callers find it gone from their process and send their calls through the queue,
as Recipe 4 showed. No caller changes a line.

The [first-extraction post](/blog/monolith-to-services-first-extraction/)
covers the earlier step: turning code inside an existing monolith into a
service in the first place.

## What this does not do

- **It doesn't remove Redis.** Each service still listens on its queue. That's
  what keeps other processes, delayed calls and events working.
- **It doesn't spread one process across CPU cores.** A service with
  `local: true` can't also use `multiProcess`; the two options are refused
  together. Run several hosts instead.
- **It doesn't start a metrics server or drain on shutdown.** Both belong to the
  host process now, which decides when the services stop.

## FAQ

### Can I run several @imqueue services in one Node.js process?

Yes. Create each service with `local: true` and start them all in one host
file. Clients in that process call those services directly; other processes
still reach them through their queues.

### Is an in-process call different from a call through the queue?

Not in what the caller sees. The same hooks and checks run, and arguments and
results are copied through JSON exactly as the queue copies them. We ran the
same calls both ways and every result matched; only the speed differed.

### How much faster is an in-process service call?

In our test, the median call took 0.005 ms in process and 0.070 ms through the
queue, with Redis on the same machine. The slowest one percent took 0.022 ms
and 0.617 ms. In-process calls also send no commands to Redis.

### What is a modular monolith?

A system built from separate, clearly divided modules that still runs as one
deployable program. Here each module is a full `@imqueue` service with its own
interface, so any of them can later run as a separate process without changing
the code that calls it.

### Do calls from other processes still work?

Yes. A service with `local: true` keeps listening on its queue. In our test,
calls from a separate process were shared 50 and 50 between two hosts, as they
would be without the option.

### When should a service get its own process?

When it uses enough CPU to hold up the others, when it needs more copies than
the rest, when its failures shouldn't affect them, or when another team needs to
deploy it on its own. Moving it doesn't change its callers.

## Reference

[`IMQServiceOptions.local`](/api/rpc/latest/rpc.imqserviceoptions.local/) ·
[`IMQClientOptions.local`](/api/rpc/latest/rpc.imqclientoptions.local/) ·
[`localServiceNames()`](/api/rpc/latest/rpc.localservicenames/) ·
[`localService()`](/api/rpc/latest/rpc.localservice/) ·
[`wireCopy()`](/api/rpc/latest/rpc.wirecopy/) ·
[`IMQServiceOptions.multiProcess`](/api/rpc/latest/rpc.imqserviceoptions.multiprocess/) ·
[`IMQDelay`](/api/rpc/latest/rpc.imqdelay/) ·
[`@expose()`](/api/rpc/latest/rpc.expose/) ·
[From monolith to services: a low-risk first extraction](/blog/monolith-to-services-first-extraction/) ·
[Guaranteed delivery, tested with kill -9](/blog/guaranteed-message-delivery-cost/)
