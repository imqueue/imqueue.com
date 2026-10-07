---
layout: post.html
permalink: /blog/redis-restart-persistence-eviction/
templateEngineOverride: md
title: "When Redis restarts: persistence, eviction and reconnects for a Node.js service fleet"
summary: "Sooner or later the Redis under your services restarts: an upgrade, a moved node, a process killed for memory. Whether your queued messages are still there afterwards depends on three Redis settings most teams never chose, and what your services do in the meantime depends on how the framework reconnects. Here is what we measured on a real Redis, the five lines of configuration that decide it, and what to do in code for the seconds the broker is gone."
description: "A measured guide to running Redis under an @imqueue service fleet: which persistence setting keeps queued and delayed messages through a crash, why maxmemory-policy must be noeviction, what send() and RPC calls do while Redis is down, how long reconnecting takes, and what to do after a broker restart."
keywords: "redis aof vs rdb queue, redis appendonly message broker, redis maxmemory-policy noeviction, allkeys-lru deletes queue, redis restart lost messages, redis crash queued messages, redis down send fails nodejs, redis reconnect backoff nodejs, notify-keyspace-events after restart, imqueue redis configuration"
date: 2026-10-06
author: yauheniya-habrykava
illustration: broker-restart
topics: [resilience, delivery, queue]
ogType: article
---

Your services can be built carefully, with guaranteed delivery, graceful
shutdown and handlers that survive being run twice. Then one night the Redis
underneath them restarts. Someone upgraded it, or the machine it ran on was
replaced, or the kernel killed it for using too much memory.

When it comes back, are the messages still there? And what did your services do
during the seconds it was gone?

The answers don't depend on your code as much as you'd expect. They depend on
three Redis settings that most teams never chose: whether Redis saves its data
to disk, what it does when it runs out of memory, and which events it publishes.
The rest depends on how your services reconnect, and on what your code does
with a write that failed.

This post goes through each one. Every behaviour below was **measured**, not
taken from documentation: `@imqueue/core` 3.5.4 and `@imqueue/rpc` 3.9.5 against
Redis 8.10, restarting it on purpose and counting what was left.

## The short version

- **Turn on `appendonly yes`.** With Redis's default snapshots, a clean restart
  kept all 1,010 queued messages and a crash lost all of them.
- **Keep `maxmemory-policy noeviction`.** Under `allkeys-lru`, Redis quietly
  deleted queues to make room, including a queue nobody was writing to, and no
  service saw an error.
- **Set `notify-keyspace-events Ex` in the Redis config.** The services put it
  back themselves after a restart, but only where they may run `CONFIG SET`.
- **A message sent while Redis is down is not retried.** `send()` still
  resolves. Pass an error handler and decide what to do with the failure.
- **Set `callTimeout` on RPC clients.** A call that was in flight when Redis went
  down never settled without one.
- **Expect services to come back a little after Redis does.** Reconnect attempts
  back off from 1 s up to 30 s. In our test, an 8.5 s outage meant 15 s
  without delivery.
- **Delayed messages survive and stay on time.** With the append-only file they
  are kept through a crash, and once the services reconnect they are released on
  time again, with no restart on your side.

## Where your messages live

Everything a queue holds lives in Redis memory, under keys that start with your
prefix (`imq` by default):

| what | Redis key | Redis type |
|---|---|---|
| messages waiting for a worker | `imq:Orders` | list |
| delayed messages | `imq:Orders:delayed` | sorted set |
| a message a worker is processing (with [safe delivery](/api/core/latest/core.imqoptions.safedelivery/)) | `imq:Orders:worker:…` | list |

Nothing else holds a copy. Your services only pass through. So the question
"what survives a restart" is a question about Redis, and Redis answers it with
its configuration.

## Recipe 1: decide what survives a crash

Redis can keep data on disk in two ways. **Snapshots** (RDB) write the whole
dataset every so often. **The append-only file** (AOF) records every write as it
happens. Out of the box, Redis takes snapshots on a schedule
(`save 3600 1 300 100 60 10000`) and has the append-only file off.

We put 1,000 messages in a queue and 10 delayed messages in its sorted set,
then restarted Redis two ways: a clean stop (`docker restart`, which sends
`SIGTERM`) and a crash (`kill -9`). Here is what was left each time:

| Redis persistence | clean restart | crash |
|---|---|---|
| none (`save ""`, `appendonly no`) | 0 of 1,010 | 0 of 1,010 |
| Redis defaults (snapshots only) | **1,010 of 1,010** | **0 of 1,010** |
| `appendonly yes` | 1,010 of 1,010 | 1,010 of 1,010 |

The middle row is the one that catches people out. On a clean shutdown Redis
writes one last snapshot, so a planned restart looks perfectly safe, and every
test you run on purpose passes. A crash gets no last snapshot. Anything written
since the previous one is gone, and with these schedules that can be up to an
hour of messages.

The append-only file is what makes a crash survivable:

```conf
appendonly yes
appendfsync everysec
```

`everysec` writes the file to disk once a second. Redis documents that a crash
can then lose up to about one second of writes. That is the usual trade-off
between safety and speed, and it is the right default for a message queue.
`appendfsync always` closes even that second, at a real cost in throughput.

To check what a running Redis is doing:

```bash
redis-cli CONFIG GET appendonly
redis-cli INFO persistence | grep -E 'aof_enabled|rdb_last_save'
```

On a managed Redis service, these settings are usually in the provider's
console or parameter group rather than in `redis.conf`. The question to ask is
the same: is every write logged, or only a snapshot now and then?

## Recipe 2: never let Redis evict a queue

When Redis reaches its `maxmemory` limit, `maxmemory-policy` decides what
happens. Some policies make room by deleting keys. For a cache that's the point.
For a queue, a deleted key is a deleted queue.

We gave Redis an 8 MB limit and two queues. `Mail` held 20 messages and 5
delayed ones. `Orders` had no consumer, and we sent it 6,000 messages of about
2 KB each, far more than fits:

| `maxmemory-policy` | what the sender saw | left in `Orders` | left in `Mail` |
|---|---|---|---|
| `noeviction` (Redis default) | `OOM` errors, logged | 2,777 | 20 + 5 delayed |
| `allkeys-lru` | **nothing** | 451 | **0 + 0 delayed** |
| `volatile-lru` | `OOM` errors, logged | 2,772 | 20 + 5 delayed |

Read the `allkeys-lru` row twice. Redis deleted the whole `Orders` list several
times over to make room (5 evicted keys), so only the last 451 messages were
left. Worse, it also deleted `Mail`, a queue that was not being written to at
all. The sender saw no error and the log stayed empty, because from Redis's
point of view nothing went wrong. It did what that policy says.

`noeviction` refuses new writes instead. That's louder, and it's what you want:
the queue keeps everything it had, other queues are untouched, and the failure
reaches your code and your logs:

```text
[IMQ-CORE][Sender]: write to queue Orders rejected on LPUSH,
message 48bbccea-…, code OOM
```

The `volatile-*` policies only evict keys that have an expiry. Queue lists never
do, so they behaved like `noeviction` here. They can still evict the small
timer keys behind delayed messages; one was evicted in this test. That does not
lose the delayed messages themselves, but nothing gains from it either.

So:

```conf
maxmemory 2gb
maxmemory-policy noeviction
```

Size `maxmemory` for your worst backlog, not your average one, and alert on
memory use well before the limit. A queue that grows because a consumer is down
is exactly the moment you can least afford to run out.

If the same Redis also serves as a cache, this is a good reason to give the
cache its own Redis. One instance can only have one eviction policy, and the
cache wants the opposite of what the queue needs.

## Recipe 3: handle a send that failed

Now the outage itself. We ran a consumer and a sender, sending 10 messages a
second, and stopped Redis for about 8.5 seconds:

```text
sent 218, received 69, errorHandler: 149 messages / 298 calls, lost 149
```

Every message sent while Redis was unreachable was lost: 149 of 149. Nothing
retried them. Every message sent before and after arrived.

The reason is in how [`send()`](/api/core/latest/core.redisqueue.send/) works. It
hands the write to the connection and resolves straight away, without waiting
for Redis to reply. That is what makes it fast, and it means a resolved
`send()` does not prove the message was stored. In the test every `send()`
resolved in under 50 ms, outage or not.

The failure is reported in two places. The queue's logger writes the first
failure of an episode and a summary when writes work again:

```text
[IMQ-CORE][Sender]: write to queue Orders rejected on LPUSH,
message 367fcb1d-…, code CONNECTION_CLOSED
[IMQ-CORE][Sender]: outbound writes resumed after 149
rejected writes
```

And `send()` takes a fourth argument, an error handler, which is the only way
for your code to learn that a particular message failed:

```typescript
import IMQ from '@imqueue/core';

const queue = IMQ.create('Billing');
const unsent = new Map<string, object>();

const message = { orderId, amount };

await queue.send(
    'Orders',
    message,
    undefined,                         // no delay
    () => unsent.set(orderId, message), // did not land
);
```

The handler captures the message itself, so it knows exactly what to send
again.

What to do with a failure depends on the message. Some can be dropped. Others
belong in a retry list, or in your own database first so that a background job
can send them again once Redis is back. That pattern is often called an
outbox. The framework won't choose for you, and it shouldn't: only your code
knows which messages matter.

One detail to plan for: the handler **can be called more than once for the same
message**. During the outage it was called 298 times for the 149 lost messages,
and when Redis was out of memory 6,446 times for 3,223 rejected writes: exactly
twice each, because the client reports one failure through two paths. Key what you keep by something that identifies the message, as the `Map`
above does, rather than counting calls.

## Recipe 4: give every RPC call a deadline

With `@imqueue/rpc`, a call is a message to the service plus a reply back. We
made two calls around the same outage, with Redis down from about 1.5 s to
7.5 s:

- **Call B was made while Redis was down.** It was rejected immediately with
  `Connection is closed.`. The client passes the failed write straight to the
  call, so nothing hangs.
- **Call A was made just before the outage**, to a method that takes 4 seconds.
  The service received it, did the work, and tried to reply while Redis was
  gone. The reply was lost.

What happened to call A depended on one option:

| `callTimeout` | call A after the outage |
|---|---|
| unset (the default) | **still pending after 45 s** |
| `10000` | rejected at 10 s with `IMQ_RPC_CALL_TIMEOUT` |

Without a timeout, the caller's promise never settles, and whatever was waiting
on it waits forever. Set one on every client:

```typescript
const orders = new OrdersClient({
    callTimeout: 10_000,
});
```

[`callTimeout`](/api/rpc/latest/rpc.imqclientoptions.calltimeout/) is the time to
wait for a reply, so pick it from how long the slowest method should take, plus
some margin.

Notice what a timeout does **not** tell you: whether the work happened. Call A
ran to the end on the service. Only the reply was lost. If the caller retries
after a timeout, the method runs twice. That's fine for a read and for any
method written to be safe to repeat, and it's a bug for "charge the card". This
is the same reason handlers should be idempotent under
[guaranteed delivery](/blog/guaranteed-message-delivery-cost/): the queue
delivers at least once, and a restart is one of the ways "at least once" turns
into "twice".

## Recipe 5: expect a short tail after Redis returns

Each service reconnects on its own schedule. After a connection drops, the
first attempt comes 1 s later, and every failed attempt doubles the wait, up to
30 s between attempts. The schedule is built into the queue and can't be
changed through options:

| attempt | 1 | 2 | 3 | 4 | 5 | 6 and on |
|---|---|---|---|---|---|---|
| wait before it | 1 s | 2 s | 4 s | 8 s | 16 s | 30 s |

That means services rarely come back the moment Redis does. In our outage test,
Redis was down for about 8.5 s. The attempts at 1, 3 and 7 s found nothing
there, and the next one came at 15 s, **6–7 s after Redis was already back**
(two runs).
So 8.5 seconds of downtime became 15 seconds without delivery.

After a long outage, that tail can reach 30 seconds. Nothing is wrong when it
happens, and nothing needs fixing. It's the price of not hammering a Redis that
is still starting up. Two practical consequences:

- **Health checks and alerts should allow for it.** A service that hasn't
  reconnected 10 s after Redis came back is behaving normally.
- **Recipes 3 and 4 cover the tail too.** Sends fail until the service has
  reconnected, not until Redis is up.

You can watch it happen in the log. Every failed attempt is logged as a
warning, and every channel logs a line when it connects again.

## Recipe 6: delayed messages and the restart

Delayed messages are stored in Redis like everything else, so with
`appendonly yes` they survived. We sent a message with a 4 s delay, then took
Redis down before it was due. It was delivered as soon as the service
reconnected. A delayed message that came due during the outage is not lost; it
is late.

Timing is the part to watch. On time, a delayed message is released by a
Redis event: its timer key expires, Redis announces the expiry, and the one
service that holds the queue's "watcher" moves the message into the queue. That
needs two things: Redis publishing expiry events, and the watcher listening for
them.

**Both come back on their own.** When the watcher's connection is replaced, the
service that owns it subscribes to expiry events again on the new connection,
and turns `notify-keyspace-events` back on if the restart dropped it. We sent
five messages with a 1 s delay before and after each kind of interruption:

| when | arrival after a 1 s delay |
|---|---|
| before the Redis restart | 1.01 – 1.14 s |
| after a restart, flag set by the services | 1.02 – 1.15 s |
| after a restart, flag in the Redis config | 1.03 – 1.20 s |
| after only the watcher's connection dropped | 1.07 – 1.08 s |

No service was restarted for any of these. The flag shows why the config file
still matters:

```text
before the restart:      notify-keyspace-events = xE
right after the restart: notify-keyspace-events = (empty)
after the reconnect:     notify-keyspace-events = xE
```

A restart reloads the configuration file, so a value set at runtime is gone
until a service puts it back, and a service can only do that if it is allowed to
run `CONFIG SET`. Managed Redis services often block `CONFIG`, and the
[ACL post](/blog/redis-acl-least-privilege-nodejs/) recommends not granting
`config|set`. In both cases the setting has to come from the configuration:

```conf
notify-keyspace-events Ex
```

Without it, delayed messages still arrive, released by the watcher's periodic
check every
[`watcherCheckDelay`](/api/core/latest/core.imqoptions.watchercheckdelay/)
(5 s by default), so up to about 5 s late.

So after a broker restart, check two things:

1. Redis came back with its data: `INFO persistence` and `DBSIZE`.
2. The services came back to it: every channel logs a `connected` line, and
   `redis-cli PUBSUB NUMPAT` is not zero, which means the watcher is listening
   again.

## The configuration, in one place

```conf
# keep every write, lose at most ~1 s on a crash
appendonly yes
appendfsync everysec

# refuse writes when full instead of deleting queues
maxmemory 2gb
maxmemory-policy noeviction

# the events delayed messages depend on
notify-keyspace-events Ex
```

Choose your own `maxmemory`. The other four lines are the same for any
`@imqueue` fleet. If you also restrict what services may run on Redis, the
[ACL post](/blog/redis-acl-least-privilege-nodejs/) has the matching rule set, and
[TLS for the broker](/blog/tls-redis-broker-nodejs/) covers the connection.

## What this does not cover

- **Replicas and automatic failover.** Redis copies data to replicas
  asynchronously, so a replica promoted after a crash can be missing the latest
  writes. We didn't measure that here. If you run one Redis per service group
  and want to add and remove brokers, see
  [the auto-scaling broker post](/blog/horizontally-scalable-redis-broker/).
- **Your own process dying.** A service killed while Redis is down loses
  anything it had not yet written. Safe delivery and a graceful shutdown cover
  the service side. See [zero-drop deploys](/blog/graceful-shutdown-zero-drop-deploys/).
- **Backups.** Persistence brings Redis back after a restart. It does not
  protect against deleting the data yourself.

## FAQ

### Does Redis keep queued messages after a restart?

Only if it saves them to disk. With no persistence everything is gone. With
Redis's default snapshots, a clean restart keeps everything and a crash loses
everything written since the last snapshot. With `appendonly yes` and
`appendfsync everysec`, a crash loses at most about one second of writes. We
measured 1,010 of 1,010 messages kept through `kill -9`.

### Should a message queue use AOF or RDB in Redis?

AOF, with `appendfsync everysec`. Snapshots alone only survive a clean
shutdown, and a planned restart is exactly the case that hides this. You can
keep snapshots on as well for backups.

### Which maxmemory-policy should Redis use for a queue?

`noeviction`. It refuses new writes when memory is full, and the sender gets an
`OOM` error. `allkeys-lru` deletes whole queues to make room, including queues
nobody is writing to, and nobody is told.

### What happens to send() while Redis is down?

It still resolves, because it doesn't wait for Redis to reply. The message is
not stored and not retried. The queue's logger reports the failures, and the
error handler you pass as the fourth argument is called for each failed
message, sometimes more than once.

### What happens to an RPC call during a Redis restart?

A call made while Redis is unreachable is rejected immediately. A call already
in flight can lose its reply, and without `callTimeout` its promise never
settles. Set `callTimeout`. A timeout doesn't mean the work didn't happen.

### How long does @imqueue take to reconnect to Redis?

Attempts start 1 s after the connection drops and double each time, up to 30 s
between attempts. Services usually come back some seconds after Redis does: in
our tests, 6–7 s after an 8.5 s outage.

### Are delayed messages lost when Redis restarts?

Not with `appendonly yes`. They are kept, and any that came due during the
outage are delivered as soon as the service reconnects. After that, delayed
messages are on time again without restarting anything.

### Why are delayed messages a few seconds late after a Redis restart?

Usually because `notify-keyspace-events` is empty. A restart drops a value set
at runtime, and the services can only set it again where `CONFIG SET` is
allowed. Put `notify-keyspace-events Ex` in the Redis configuration. Without
it, delayed messages are released by the periodic check, up to about 5 s late.

## Reference

[`RedisQueue.send()`](/api/core/latest/core.redisqueue.send/) ·
[`IMQOptions.watcherCheckDelay`](/api/core/latest/core.imqoptions.watchercheckdelay/) ·
[`IMQOptions.safeDelivery`](/api/core/latest/core.imqoptions.safedelivery/) ·
[`IMQOptions.verbose`](/api/core/latest/core.imqoptions.verbose/) ·
[`IMQClientOptions.callTimeout`](/api/rpc/latest/rpc.imqclientoptions.calltimeout/) ·
[`IMQClient.remoteCall()`](/api/rpc/latest/rpc.imqclient.remotecall/) ·
[`IMQRPCError`](/api/rpc/latest/rpc.imqrpcerror/) ·
[Guaranteed delivery, tested with kill -9](/blog/guaranteed-message-delivery-cost/) ·
[Least privilege for your Redis broker](/blog/redis-acl-least-privilege-nodejs/) ·
[Talking to your Redis broker over TLS](/blog/tls-redis-broker-nodejs/)
