---
layout: post.html
permalink: /blog/message-ordering-nodejs-services/
templateEngineOverride: md
title: "Message ordering in Node.js services: why “delivered” turns back into “paid”"
summary: "You send an order's status changes in the right order, and the service still stores them in the wrong one. A queue delivers in order; your service doesn't handle in order, and more instances, more brokers and re-delivered messages each make it worse. We sent 1,000 status changes and measured where the order was lost: up to four in five orders ended in the wrong state. Here is why, and the two recipes that brought it to zero in every setup."
description: "A measured guide to message ordering with @imqueue: why a FIFO queue still leaves 61–81% of orders in the wrong state, how instances, brokers and re-delivery reorder calls, and how a version check or per-order waiting makes the result correct."
keywords: "message ordering microservices, out of order messages, process messages in order nodejs, redis queue fifo, event ordering microservices, last write wins, optimistic concurrency version column, stale update, imqueue message order, redelivered message out of order"
date: 2026-11-27
author: andrii
illustration: message-order
topics: [delivery, patterns, queue]
ogType: article
---

An order goes through five statuses: created, paid, packed, shipped,
delivered. Each change is a call to the Orders service, sent in exactly that
order. A customer opens the order page the next day and sees "paid". The
parcel has already arrived.

Nothing failed. Every call was delivered and handled, and every one returned
`true`. The service handled all five changes. It just didn't handle them in
the order they were sent, so the last write to land was an older one.

This post explains where the order of messages is kept and where it is lost
when services talk through a queue, and how to make the result correct anyway.
We sent 1,000 status changes and counted the orders that ended up in the
wrong state.

**Everything below was measured** with `@imqueue/rpc` 3.12.1 and
`@imqueue/core` 3.9.0 on Node.js 26, against Redis 7.4. The setup: 200
orders, five status changes each, 1,000 calls in total. The caller sent each
order's five changes one after another without waiting for the replies, the
way an import job or an event handler usually sends them. The service waited
0–5 ms on each write, about the cost of a database write. Every scenario
ran three times; the ranges below are from those runs.

## The short version

- **One queue on one broker is first in, first out.** All 1,000 calls arrived
  in the order they were sent, in every run.
- **Arriving in order is not the same as being handled in order.** A service
  starts the next call without waiting for the previous one to finish. With
  one instance and calls arriving in perfect order, 122–147 of the 200 orders
  still ended in the wrong state.
- **More instances, more brokers and re-delivery all reorder calls.** With
  three instances on two brokers, about half the calls arrived after a newer
  change to the same order. A call taken back from a killed worker came back
  8 seconds later, after "delivered", and overwrote it with "paid".
- **The fix belongs in the write, not in the queue.** Give every change a
  version and store it only if it is newer than what is stored: 0 wrong orders
  in every setup.
- **When every step has to happen, wait for it.** Sending an order's next
  change only after the previous one replied gave 0 wrong orders, and the
  whole run took the same time, because the 200 orders still ran side by
  side.

## What a queue does keep in order

A call to an @imqueue service is a message pushed onto the service's queue in
Redis. Every instance of the service takes messages from the other end of the
same list. On one broker that list is first in, first out: the first message
pushed is the first one taken.

We checked it the plainest way. Each call recorded its arrival as the first
thing the service did, before any work. With one instance on one broker, **0
of 1,000 calls** arrived after a newer change to the same order, in all three
runs.

So the queue keeps its promise. The trouble starts right after that.

## Where the order gets lost

### 1. One instance still runs calls side by side

An @imqueue service doesn't wait for one call to finish before it starts the
next. That's what lets one instance keep up with a busy queue, and it's
usually what you want. But it means two changes to the same order can be in
progress at once, and the one that started second can finish first.

That is exactly what happened. Calls arrived in perfect order, and the
service saved "shipped" after "delivered" for whole groups of orders because
one write took 1 ms and the other took 4. **122–147 of 200 orders** ended in
a state other than "delivered".

Running a single instance does not give you ordering.

### 2. Several instances share the queue

Add instances and each one takes the next message whenever it's free. The
five changes for one order end up spread across instances that run at
different speeds. With three instances on one broker, **269–294 of 1,000
calls** arrived after a newer change to the same order, and **147–153 orders**
ended in the wrong state.

### 3. Several brokers split the stream

A client connected to several Redis brokers sends each call to one of them in
turn. The service reads all of them at the same time, so calls sent one after
another travel through different lists. With one instance on two brokers,
**393–398 of 1,000** calls arrived late. With three instances on two brokers it
was **484–512**, and **151–161 orders** ended in the wrong state, about four in
five.

### 4. A re-delivered call comes from the past

With `safeDelivery` on, a call that a worker took but never finished is not
lost: when the worker dies, the call goes back on the queue for another
instance. It goes back at the end of the queue, behind everything sent since.

We made one instance hang on order `o0`'s "paid" call, killed it with
`kill -9`, and let a second instance carry on. The other four changes for that
order were handled at once. "Paid" came back about **8 seconds** after the kill
and was handled last. The order's history arrived as
`created, paid, packed, shipped, delivered, paid`, and the stored status was
"paid", in both runs.

Re-delivery is the reason to use safe delivery, and it is working as
designed. A re-delivered message is simply an old message that arrives late,
and your code has to be ready for that.

### 5. Delays and retries arrive later by design

A call sent with an `IMQDelay` waits outside the queue until it's due, then
joins the end of the queue. A failed job that is re-scheduled does the same.
Both are, by definition, messages that arrive after things sent later than
them.

### 6. Events split across brokers too

Pub/sub follows the same rules. A clustered publish goes to one broker per
event. With two brokers, a subscriber received **498–500 of 1,000** events
after a newer one when they were published in a burst. Even when every
publish was awaited before the next, 0–1 of 1,000 arrived late: a publish
that has returned has been sent, not received. On one broker none were late.

### All of it in one table

| Setup | Calls that arrived late | Orders in the wrong state |
|---|---|---|
| 1 instance, 1 broker | 0 | 122–147 of 200 |
| 3 instances, 1 broker | 269–294 | 147–153 |
| 1 instance, 2 brokers | 393–398 | 142–152 |
| 3 instances, 2 brokers | 484–512 | 151–161 |
| 3 instances, 2 brokers, **write only if newer** | 486–491 | **0** |
| 3 instances, 2 brokers, **wait for each step** | 0 | **0** |

"Arrived late" counts calls that reached the service after a newer change to
the same order had already arrived. The two recipes below are the last two
rows.

## Recipe 1: store a change only if it is newer

Give every change a number that says where it sits in the order's history,
and have the service store it only if that number is higher than the one
already stored. Arrival order then stops mattering: an old change that arrives
late is rejected, whichever instance, broker or retry it came through.

In SQL it's one condition on the update:

~~~typescript
import { IMQService, expose } from '@imqueue/rpc';

export class Orders extends IMQService {
    /**
     * Moves an order to a new status, unless a newer change is already stored
     *
     * @param {string} orderId - order id
     * @param {string} status - the new status
     * @param {number} version - position of this change in the order's history
     * @return {Promise<boolean>} false when a newer change was already stored
     */
    @expose()
    public async setStatus(
        orderId: string,
        status: string,
        version: number,
    ): Promise<boolean> {
        const { rowCount } = await db.query(
            `UPDATE orders SET status = $2, version = $3
              WHERE id = $1 AND version < $3`,
            [orderId, status, version],
        );

        return rowCount === 1;
    }
}
~~~

Our test stored order status in Redis and made the same check in a small
script, so the compare and the write happen in one step. In both forms, what
matters is that the check and the write are a single operation. If you read
the version, compare it in JavaScript, then write, two changes can both pass
the check before either one is written.

**Result: 0 orders in the wrong state, in every setup and every run**,
including three instances on two brokers and the killed worker, where the late
"paid" was rejected and the order stayed "delivered". The service rejected
358–399 of the 1,000 changes as stale with one instance, and 534–552 with three
instances on two brokers. Those are the calls that would have overwritten a
newer status.

### Where the version number comes from

The number has to be set where the order of changes is decided. In our test
that was the caller, which knew the order's history and numbered the steps 1
to 5. More often it's the service that owns the record: it raises the version
in the same statement that makes the change, and sends the new number with
every event and call that carries the change downstream.

~~~sql
UPDATE orders SET status = $2, version = version + 1
 WHERE id = $1
 RETURNING version;
~~~

Don't use clock time from different machines. Two servers' clocks are never
exactly equal, and a change made a millisecond later on a server whose clock
is behind would lose to an older one. A counter owned by one place can't
disagree with itself.

### What this recipe is for

A version check fits values that are *replaced*: a status, a balance shown on
a screen, a cached profile, a search document. Skipping an old value is the
right result, because only the newest one matters.

It's the wrong tool for steps that must all happen. If "paid" charges a card
and "shipped" sends an email, skipping a stale "paid" means skipping a charge.
Those steps need the next recipe.

## Recipe 2: send the next step after the previous one replies

When every step has to happen and in order, the caller waits for each step's
reply before sending the next. An @imqueue call resolves when the service has
handled it, so `await` is all it takes:

~~~typescript
const steps = ['created', 'paid', 'packed', 'shipped', 'delivered'];

// one sequence per order; the orders themselves still run side by side
await Promise.all(orderIds.map(async orderId => {
    for (const [i, status] of steps.entries()) {
        await orders.setStatus(orderId, status, i + 1);
    }
}));
~~~

**Result: 0 calls arrived late and 0 orders ended in the wrong state**, with
three instances on two brokers. The whole run took 39–41 ms, against 38–41 ms
for the same 1,000 calls sent without waiting. Waiting per order cost nothing
overall, because only one order's changes wait for each other. The 200
orders still run at the same time, spread over every instance.

What it does cost is time for each order. Five steps now take five round
trips in a row instead of one. For a checkout or a fulfilment flow that's
usually fine; for a stream of thousands of updates to one hot record, Recipe 1
is the better fit.

Keep the version from Recipe 1 even here. Waiting protects against your own
calls overtaking each other; it doesn't protect against a re-delivered message
arriving after its successors.

## What doesn't give you ordering

- **Running a single instance.** It still handles calls side by side.
  Measured: up to 147 of 200 orders wrong with calls arriving in perfect
  order.
- **A lock inside the service.** [`@lock()`](/api/rpc/latest/rpc.lock/) and
  any other in-memory lock only cover the process it runs in; a second
  instance doesn't see it. It also exists to merge identical calls, not to
  order different ones.
- **Routing by key.** @imqueue has no partition key that sends one order's
  calls to one instance. Every instance takes from the same queue, which is
  what makes adding instances and replacing them painless.
- **Timestamps on the message.** They tell you when a change was sent, not
  which change came first, and two machines' clocks disagree.

## Ordering events for subscribers

The same rules apply to events. Put the version in the event and have every
subscriber store the event's change only if it is newer than what it already
has:

~~~typescript
await orders.subscribe(async event => {
    if (event.kind !== 'order.status') {
        return;
    }

    await view.setStatusIfNewer(event.orderId, event.status, event.version);
});
~~~

The subscriber then doesn't care which broker an event came through, or
whether a retried publish delivered it twice. The second copy of an event is
not newer than the first, so it's rejected too. More on how events flow across
brokers is in
[pub/sub across a fleet of Redis brokers](/blog/pubsub-over-redis-broker-fleet/).

## A checklist

1. Find the writes where a newer value must win: status, state, counters
   shown to people, cache entries, search documents.
2. Give each entity a version, raised by the service that owns the entity, in
   the same statement as the change.
3. Send the version with every change and every event.
4. Store a change only if its version is newer, in one operation.
5. For steps that must all run in order, await each step before sending the
   next, per entity.
6. Test it with more than one instance, with more than one broker if you run
   several, and with a worker killed mid-call. Each of them reorders calls in
   a way the others don't.

## FAQ

### Does a Redis queue keep messages in order?

A single queue on a single Redis broker is first in, first out: messages
are taken in the order they were pushed. That is the order they arrive in,
not the order they're handled in. A service runs several calls at once, so
a later call can finish first. Several instances, several brokers, retries
and re-delivered messages also change the arrival order.

### Why does my service save an older value over a newer one?

Because two changes to the same record were handled at the same time and the
older one finished last. In our test that happened to 61–74% of orders with a
single instance and calls arriving in perfect order. Store a change only if
its version is newer than the stored one, in a single operation.

### How do I process messages in order in Node.js microservices?

Decide which kind of order you need. If only the newest value matters, give
every change a version and reject stale ones when writing. If every step must
run and in sequence, have the caller await each step's reply before sending
the next, one sequence per entity. Both brought wrong results to zero in our
test, and neither needs a single consumer.

### Can a re-delivered message overwrite newer data?

Yes. With guaranteed delivery, a message whose worker died goes back to the
end of the queue, behind everything sent since. In our test it came back
about 8 seconds after the worker was killed and overwrote "delivered" with
"paid". A version check rejects it.

### Should I use timestamps or version numbers?

Version numbers, raised by the one service that owns the record. Timestamps
from different machines disagree by milliseconds or more, which is enough to
let an older change win.

## Reference

[`IMQService`](/api/rpc/latest/rpc.imqservice/) ·
[`IMQClient`](/api/rpc/latest/rpc.imqclient/) ·
[`IMQOptions.safeDelivery`](/api/core/latest/core.imqoptions.safedelivery/) ·
[`IMQOptions.cluster`](/api/core/latest/core.imqoptions.cluster/) ·
[`IMQDelay`](/api/rpc/latest/rpc.imqdelay/) ·
[`IMQService.publish()`](/api/rpc/latest/rpc.imqservice.publish/) ·
[`IMQClient.subscribe()`](/api/rpc/latest/rpc.imqclient.subscribe/) ·
[`@lock()`](/api/rpc/latest/rpc.lock/) ·
[Guaranteed delivery, tested with kill -9](/blog/guaranteed-message-delivery-cost/) ·
[Deadlines for queued calls](/blog/request-deadlines-queued-calls-nodejs/) ·
[Pub/sub across a fleet of Redis brokers](/blog/pubsub-over-redis-broker-fleet/)
