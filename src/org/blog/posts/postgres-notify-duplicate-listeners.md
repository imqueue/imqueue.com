---
layout: post.html
permalink: /blog/postgres-notify-duplicate-listeners/
templateEngineOverride: md
title: "One notification, every replica: the LISTEN/NOTIFY duplicate problem"
summary: "LISTEN/NOTIFY is a broadcast, not a queue. Scale a Node app to three replicas and the same notification gets handled three times — no error, no warning, three charges on the card. Here's why, and what an inter-process lock actually does about it."
description: "LISTEN/NOTIFY delivers to every listening process, so scaling Node.js duplicates work. How an inter-process lock elects one listener, and how failover behaves."
keywords: "postgres notify multiple instances, postgres listen notify duplicate, listen notify scaling nodejs, single listener postgres, pg_notify multiple consumers, imqueue pg-pubsub"
date: 2026-07-31
author: serhiy-morenko
illustration: single-listener
topics: [patterns, resilience, delivery]
ogType: article
---

`LISTEN`/`NOTIFY` is the cheapest way to get change events out of PostgreSQL and
into a Node process. No broker, no extra infrastructure, a trigger and a few
lines of `pg`. It works beautifully on your laptop, where there is one process.

Then you scale to three replicas, and every notification is handled three times.

The reason is stated plainly in the Postgres documentation, and is easy to read
past: `NOTIFY` delivers to **every** session that has issued `LISTEN` on that
channel. It is a publish/subscribe broadcast. It has no
consumer groups, no partitions, no acks, no concept of a message being *taken*
by one subscriber. Every listener gets its own copy, and none of them can tell
how many others also got one.

Here is three replicas of the same service, one notification, nothing else
changed:

~~~
PUBLISHED order=1001
A HANDLED order=1001 at ...993230
B HANDLED order=1001 at ...993230
C HANDLED order=1001 at ...993230
~~~

Same order, same millisecond, three times. If the handler sends a welcome email,
three emails go out. If it charges a card, you have a support ticket.

What makes this a nasty class of bug is that nothing anywhere reports a problem.
Every replica did exactly what it was told. There is no error to catch, no
metric that moves, and the behaviour is *correct* on a single instance — which
is where it gets written and tested. The failure mode arrives with the second
replica, months later, as a business problem rather than an engineering one.

## Why the obvious fixes are worse than they look

**Elect a listener with configuration.** Give one replica `IS_LISTENER=true`
and have the others skip `listen()`. It works, and it converts a duplicate-work
bug into a single point of failure: when that pod is rescheduled, nobody is
listening, and — because `NOTIFY` has no backlog — the notifications sent while
it was down are gone for good. You have also made your deployment topology
special, which tends to be discovered by whoever is on call.

**Deduplicate in the handler.** Keep a `processed_events` table, insert the
event id, let the unique constraint reject the duplicates. This is a genuinely
sound pattern and you may want it anyway for idempotency — but as a fix for
this problem it means all N replicas do all the work and then N−1 of them throw
it away. It also needs a stable id in every payload, which trigger-generated
notifications frequently do not have.

**Advisory locks.** `pg_try_advisory_lock` is the right primitive and the wrong
scope: a session-level advisory lock is held until the session ends, so you are
back to writing the liveness and handover logic yourself, which is the actual
hard part.

The thing you want is for exactly one process to be the listener at any moment,
chosen automatically, with the guarantee that if it dies another one takes over.
That is what `@imqueue/pg-pubsub` calls `singleListener`, and it is on by
default:

~~~typescript
import { PgPubSub } from '@imqueue/pg-pubsub';

const pubSub = new PgPubSub({ connectionString });
// singleListener: true is the default -- this is the same thing:
// new PgPubSub({ connectionString, singleListener: true })

pubSub.on('connect', async () => {
    await pubSub.listen('OrderCreated');
});

pubSub.channels.on('OrderCreated', payload => {
    // runs in exactly one process across the whole fleet
});

await pubSub.connect();
~~~

The same three replicas, the same single notification:

~~~
PUBLISHED order=2002
A LISTENING
A active=true
A HANDLED order=2002 at ...015018
B active=false
C active=false
~~~

One handler. B and C connected fine, and never subscribed.

## The mechanism, because it decides how it fails

Anything claiming "only one process will do this" is making a distributed-systems
promise, and the interesting question is always what happens when the holder
dies. So it is worth knowing exactly what this is built from — it is much
simpler than you might expect.

There is one table. Acquiring the lock is one statement:

~~~sql
INSERT INTO pgip_lock.lock (channel, app) VALUES ($channel, $app)
ON CONFLICT (channel) DO
    UPDATE SET app = pgip_lock.deadlock_check(pgip_lock.lock.app, $app)
~~~

The row *is* the lock, and `channel` is its primary key, so the second process
to try this hits the conflict and lands in `deadlock_check`:

~~~sql
CREATE FUNCTION pgip_lock.deadlock_check(old_app TEXT, new_app TEXT)
RETURNS TEXT LANGUAGE PLPGSQL AS $$
DECLARE num_apps INTEGER;
BEGIN
    SELECT count(query) INTO num_apps
    FROM pg_stat_activity
    WHERE application_name = old_app;

    IF num_apps > 0 THEN
        RAISE EXCEPTION 'Duplicate channel for app %', new_app
        USING DETAIL = 'LOCKED';
    END IF;

    RETURN new_app;
END; $$
~~~

That is the whole design, and the good idea in it is the `FROM pg_stat_activity`.
Each connection sets its `application_name` to a UUID on connect, so the lock
row records *which connection* holds it. To decide whether the current holder is
still alive, the function does not consult a heartbeat, a lease, or a TTL — it
asks Postgres whether that connection is still there.

Which means the liveness detector is the same component as the message bus and
the lock store. There is no separate thing to be up, no clock skew between a
lease writer and a lease reader, and no window in which a process believes it
holds a lock that has actually expired. If the holder's connection is gone,
`count` is `0`, the `UPDATE` proceeds, and the newcomer owns the row. If the
connection is alive, the `INSERT` raises and the caller reports `LOCKED`.

Handover has two paths, and they perform very differently.

**A clean exit** deletes the lock row. There is a deferred constraint trigger on
that table whose only job is `PERFORM PG_NOTIFY(OLD.channel, '1')` — so the
release is itself a notification, on a private internal channel that the standby
processes are already listening to. They wake up and race for the row
immediately. Failover is effectively instant:

~~~
A LISTENING at ...528023
A active=true
A SIGTERM -> releasing
                            B active=false
                            B LISTENING at ...532001
                            B HANDLED order=3003 at ...535040
~~~

`SIGTERM` landed on A about four seconds after it took the lock, and B was
subscribed within milliseconds of the release — the trigger's notification doing
the work, nowhere near the 30-second retry timer.

**A crash** deletes nothing. `SIGKILL`, an OOM kill or a lost node leaves the row
in place with a dead connection recorded in it, and since no `DELETE` happened,
no `PG_NOTIFY` fired, so nothing tells the standbys to try again. The only thing
that recovers this is a retry timer, ticking every `acquireInterval` —
**30 seconds by default**. Measured, holder killed with `SIGKILL`:

| `acquireInterval` | time to takeover |
|---|---|
| `30000` (default) | 27.1s |
| `5000` | 3.0s |

Those 27 seconds are a real gap during which nobody is listening and every
notification sent is lost, because `NOTIFY` has no backlog. That is the number
to have an opinion about before this goes to production. Tuning it down is one
option:

~~~typescript
const pubSub = new PgPubSub({ connectionString, acquireInterval: 5000 });
~~~

It is not free — every listener retries every interval, so the cost is a small
query per standby per tick, and the README is direct about the trade-off being
between system load and reliability. A few seconds is usually the right answer;
30 is a sensible default only because it assumes clean shutdowns are the normal
case, which is true right up until it isn't.

Which makes graceful shutdown load-bearing here rather than merely tidy. Signal
handling is **opt-in** since 3.0.0 — importing the package does not take over
your process lifecycle:

~~~typescript
const pubSub = new PgPubSub({ connectionString, handleSignals: true });
// or, if you run your own shutdown sequence:
//   await pubSub.destroy();
~~~

Without one of those, every deploy costs you a takeover delay, on a channel
nobody is listening to. The general shape of that problem, and the drain that
goes with it, is [graceful shutdown and zero-drop
deploys](/blog/graceful-shutdown-zero-drop-deploys/).

## `listen()` resolving does not mean you are listening

This is the API's sharpest edge. Under `singleListener`, `listen()` on a channel
another process already owns is not an error — it is the expected outcome for
every replica but one. So it resolves quietly, having subscribed to nothing:

~~~typescript
await pubSub.listen('OrderCreated');   // resolves in all three replicas
~~~

There is no rejection and no warning at that call site, by design: `listen()` is
retried by the timer, by the release notification and by reconnects, so logging
there would produce noise on every tick. Ask explicitly instead:

~~~typescript
pubSub.isActive('OrderCreated');   // true only in the holder
pubSub.activeChannels();           // channels this process actually owns
pubSub.inactiveChannels();         // known, but owned by someone else
~~~

Worth wiring into a health endpoint, because "we are up" and "somebody is
listening" are different questions and only the second one matters here.

## `singleListener` does not spread channels across replicas

The natural assumption — mine included, until it was measured — is that because
locks are per-channel, three channels across three replicas will settle into
roughly one channel each. They do not. Three channels, three replicas started
together, three consecutive runs:

~~~
===== run 1 =====
A holds: (none)
B holds: (none)
C holds: OrderCreated,UserChanged,InvoicePaid
===== run 2 =====
A holds: (none)
B holds: OrderCreated,UserChanged,InvoicePaid
C holds: (none)
===== run 3 =====
A holds: OrderCreated,UserChanged,InvoicePaid
B holds: (none)
C holds: (none)
~~~

Winner takes all, and which replica wins is a coin toss. Each process acquires
its channels in a tight sequential loop, so whichever one gets there first is
still ahead by the time it reaches the last channel. There is no fairness or
rebalancing anywhere in the design, and none is attempted.

So the accurate mental model for `singleListener` is **one active process and
N−1 hot standbys**, not a distributed subscriber pool. That is the right shape
for handling change events once. It is the wrong shape for spreading load, and
if that is what you are after, adding replicas achieves nothing at all.

## When you want every replica working

For that there is `executionLock`, which inverts the arrangement: every process
subscribes, and the lock moves from the channel to the individual message. The
key is a hash of the notifying backend's PID, the channel and the payload —
identical in every listener that receives that notification — so the first one
to insert it processes the message and the rest find the row already there.

~~~typescript
const pubSub = new PgPubSub({ connectionString, executionLock: true });
~~~

Three replicas, six notifications:

~~~
A LISTENING at ...187069      <- all three subscribe
B LISTENING at ...187671
C LISTENING at ...188277

A HANDLED order=501 at ...192897
A HANDLED order=502 at ...193336
A HANDLED order=503 at ...193797
A HANDLED order=504 at ...194253
B HANDLED order=505 at ...194706
C HANDLED order=506 at ...195152
~~~

Six notifications, six handlers, no duplicates — and a 4/1/1 split. This is a
race, not a balancer: whoever is idle and quickest wins. Over a real workload it
evens out somewhat, but it is not a scheduler and should not be sold to yourself
as one.

Two things to know before turning it on. It is **off by default**, and it costs
a write per message per listener rather than one lock per channel, so the
database does more work in exchange for the parallelism. And `isActive()`
reports `false` in every process even though all of them are subscribed —
`activeChannels()` is derived from held *channel* locks, which this mode does
not use. Do not health-check on it here.

The dedupe key deserves one more look, because it is content-addressed. Two
genuinely distinct notifications with byte-identical payloads on the same
channel from the same backend collapse into one — the second is treated as
already processed. The markers live for an hour (`UNIQUE_LOCK_TTL`), so this is
not a narrow window. If your events can legitimately repeat, put something
unique in the payload; an id or a timestamp is enough. The README flags this
too, and it is the one failure mode here that silently loses data rather than
duplicating it.

## The limits worth knowing before you commit

The lock solves duplicate handling. It does not upgrade what `LISTEN`/`NOTIFY`
fundamentally is, and most of what follows is Postgres, not the library:

- **Delivery is at-most-once, with no backlog.** Anything published while no
  process holds the lock, or while the holder is reconnecting, is gone. There is
  no replay. If losing an event is unacceptable, the notification should be a
  hint to go read a table — not the carrier of the fact itself. That is the
  same trade-off as [what guaranteed delivery
  costs](/blog/guaranteed-message-delivery-cost/), arrived at from the other
  direction.
- **Payloads cap at 8000 bytes**, and `notify()` throws a `RangeError` rather
  than letting Postgres reject it. Another reason to send ids, not rows.
- **A connection pooler in transaction mode will break this.** `LISTEN` needs a
  session that stays put, and the lock's identity is a per-connection
  `application_name`. Use a session-mode connection, or a direct one.
- **The first run needs DDL rights** to bootstrap the lock schema — `CREATE
  SCHEMA`, `TABLE`, `FUNCTION`, `TRIGGER`. In a locked-down database, provision
  it ahead of time; a failed bootstrap is logged, and locking silently does not
  work.
- **A wedged holder keeps the lock.** Liveness here means "the connection is
  open", so a process whose event loop is blocked, or one on the far side of a
  network partition whose TCP connection has not yet timed out, still counts as
  alive. Nothing takes over, and the standbys are correct not to.
- **Always attach an `'error'` handler.** Connection errors are emitted there;
  with no listener they go to the logger instead of crashing, which means a
  silent-but-degraded process is the default if you skip it.

None of that argues against the approach. It argues for using it where it fits:
a service that reacts to database change events and needs each one handled once,
where a lost event during a crash window is survivable because the next
notification, or a periodic reconciliation, will catch up. Inside that envelope
this is a remarkable amount of reliability for one table and one function, and
no new infrastructure at all.

If it does not fit — if you need replay, ordering guarantees, or delivery that
survives a subscriber being down — then you want a broker, and the honest
recommendation is to stop stretching `LISTEN`/`NOTIFY` toward one.

~~~bash
npm i --save @imqueue/pg-pubsub
~~~

The [full option list and API
reference](/api/pg-pubsub/latest/) covers the reconnect settings, the `filtered`
option for ignoring your own notifications, and the lock schema name.
