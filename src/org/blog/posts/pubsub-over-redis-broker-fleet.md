---
layout: post.html
permalink: /blog/pubsub-over-redis-broker-fleet/
templateEngineOverride: md
title: "One event, every instance: pub/sub over a Redis broker fleet with @imqueue"
summary: "You need to tell every instance of a service something at once — a price list changed, a tenant was suspended, an order was created and three concerns want to know. Pub/sub is the tool, and a fleet of brokers changes how it behaves. Here is what a clustered subscription does across several Redis brokers, how to publish and subscribe so brokers joining and leaving never cost you a handler, how to write a handler that stays correct when it gets one copy per broker, and how to see that it works."
description: "A recipe for pub/sub events over a clustered Redis broker fleet with @imqueue: how publish() and subscribe() fan out, what a broker that joins later receives, one delivery per broker and idempotent handlers, handlers that must not throw, no start() needed, reconnects, unsubscribe, and how to observe and test it."
keywords: "redis pubsub multiple servers, pub/sub across redis instances, redis pub/sub cluster, broadcast event to all instances nodejs, service events nodejs microservices, redis pubsub fan-out, idempotent event handler, pubsub handler called twice, redis pub/sub vs queue, cache invalidation broadcast, imqueue publish subscribe, IMQService publish, IMQClient subscribe, ClusteredRedisQueue subscribe, clusterManagers, UDPClusterManager, redis pubsub reconnect, redis pubsub no start"
date: 2026-09-15
author: yauheniya-habrykava
illustration: event-fanout
topics: [queue, patterns, discovery, resilience]
ogType: article
---

Some things every running instance of a service needs to hear at once. A price
list was republished. A tenant was suspended and its requests must start
failing now, not when the next cache entry expires. An order was created, and
the audit trail, the per-tenant counters and a cache of "recent orders" all
want to know, in three different processes that never call each other.

That is what pub/sub is for, and `@imqueue` gives it to you at two levels: a
raw channel on the queue, and one method on every service and every generated
client. Both work the same way over a single Redis. Once the broker is a
[fleet](/blog/horizontally-scalable-redis-broker/) — several Redis instances
that services discover at runtime and that come and go as the fleet scales —
pub/sub keeps working, but it behaves in ways that are worth knowing before
you write the first handler. This post is that knowledge, as a recipe: what a
subscription does across several brokers, how to publish and subscribe so that
brokers joining and leaving never cost you a handler, how to write a handler
that stays correct when it receives one copy per broker, and how to see that
all of it works. Every behaviour stated here was measured against a real
broker; the figures are in the text.

> **TL;DR** — On a clustered queue, `publish()` writes to **every** broker and
> `subscribe()` opens the channel on **every** broker, including brokers that
> join later, which are given every handler you registered, in order. A
> subscriber therefore receives one copy per broker, so key handlers by event
> id and act once. One channel per instance, any number of handlers on it;
> route several concerns with a `kind` field. Handlers must not throw — an
> exception in a handler is uncaught — and should hand real work to the queue.
> Subscribing needs no `start()`; publishing needs a started service and a
> known broker, so publish from work you are already doing, not at boot.
> Pub/sub is fire-and-forget: anything that must not be lost goes through the
> queue.

## What pub/sub does on a fleet: four rules

Clustering in @imqueue is on the client side.
[`IMQ.create()`](/api/core/latest/core.imq.create/) returns a
[`ClusteredRedisQueue`](/api/core/latest/core.clusteredredisqueue/) whenever
the options carry a static [`cluster`](/api/core/latest/core.imqoptions.cluster/)
list or a [`clusterManagers`](/api/core/latest/core.imqoptions.clustermanagers/)
entry, and every service and generated client gets the same thing through its
own options. Work queues spread across the brokers — each message goes to one
broker, by health-aware round-robin. Pub/sub does not spread; it repeats. Four
rules follow from that, and everything in the recipe rests on them.

**1. `publish()` writes to every broker.** A subscriber that happens to be
connected to broker 2 must hear an event published from a process that
round-robined onto broker 1, so
[`publish()`](/api/core/latest/core.clusteredredisqueue.publish/) sends the
payload to every broker the cluster knows. The word *knows* matters: with
discovery the cluster starts empty, and a publish made before the first broker
has announced itself has nowhere to go. Measured: publishing on a cluster with
no known broker delivered nothing and logged, once,
`nothing published to channel events: knownServers=0`; the next publish, after
a broker had joined, was delivered. So publish from work the service is already
doing — a service handling a request has a broker by definition — and not
from a boot hook.

**2. `subscribe()` opens the channel on every broker, including the ones that
join later.** [`subscribe()`](/api/core/latest/core.clusteredredisqueue.subscribe/)
fans out to every known broker and remembers what you registered, so a broker
that joins afterwards — discovery completing after start-up, a broker pod
replaced by the scheduler — is given every handler, in registration order, as
part of coming up. Measured: two handlers registered while the cluster was
still empty were both invoked once a broker joined; a broker withdrawn and
re-announced came back with both; a handler registered *after* the broker was
already known was installed straight away. Order of events at start-up is not
something you have to control.

**3. One channel per instance, any number of handlers on it.** A queue
instance — and so a client — subscribes to exactly one channel until
[`unsubscribe()`](/api/core/latest/core.clusteredredisqueue.unsubscribe/)
resets it; a second channel name is refused with
`Invalid channel name provided: expected "events", but "events-other" given
instead!`. On that one channel, calling `subscribe()` again *adds* a handler:
every registration is kept and every one is invoked, and the same function
registered twice runs twice. Several concerns in one process therefore share a
channel and tell events apart by a field in the payload, which is the dispatch
pattern below.

**4. It is fire-and-forget.** Redis pub/sub has no persistence and no
acknowledgement. Measured: a message published while no handler was
subscribed was gone; only the publish made after `subscribe()` arrived. This is
not a defect to design around, it is the contract: pub/sub carries *news*,
and [the queue carries work](/blog/guaranteed-message-delivery-cost/).

One consequence of rules 1 and 2 deserves its own line, because it is the
thing people meet first. A publish goes to every broker; a clustered
subscriber is subscribed on every broker; so **a subscriber receives one copy
per broker**. Measured with two brokers in the fleet, one handler and one
`publish()`: the handler ran twice. That is the price of reaching a subscriber
wherever it is connected, and it is why the handler recipe starts with an
event id.

## Recipe 1: publish from the service, after the fact

A service publishes with one call.
[`IMQService.publish()`](/api/rpc/latest/rpc.imqservice.publish/) writes the
payload on the channel named after the service, so every client of that
service that has subscribed receives it:

~~~typescript
import { IMQService, expose } from '@imqueue/rpc';

export class OrderService extends IMQService {
    /**
     * Places an order and announces it to every subscribed client.
     *
     * @param {OrderInput} input - what to order
     * @return {Promise<Order>} the stored order
     */
    @expose()
    public async place(input: OrderInput): Promise<Order> {
        const order = await this.orders.insert(input);   // committed first

        await this.publish({
            kind: 'order.placed',
            id: `order.placed:${order.id}`,   // one id per event, not per call
            orderId: order.id,
            tenantId: order.tenantId,
            at: order.createdAt,
        });

        return order;
    }
}
~~~

Three habits make this reliable on a fleet:

- **Publish after the fact.** The event says something *happened*. Publish
  after the write has committed, so a subscriber that reacts by reading the
  order finds it. An event published before the commit describes a future that
  may never arrive.
- **Carry an id and a kind.** `kind` is what subscribers route on; `id` is what
  they deduplicate on. Make the id a property of the event, not of the call —
  a retry of the same operation should produce the same id, and one publish
  delivered from two brokers certainly does.
- **Keep it small and plain.** Payloads are plain JSON; the queue's
  [`useGzip`](/api/core/latest/core.imqoptions.usegzip/) does not apply to
  pub/sub (measured: with `useGzip` on, a plain-JSON message published from
  `redis-cli` was delivered as normal). Send ids and the fields a subscriber
  needs to decide; let it fetch the rest through the service if it wants it.

`publish()` needs the service's writer connection, so it throws before
`start()` — and, as rule 1 says, it needs a known broker. Both are true
whenever a service is handling requests, which is where a publish belongs.

## Recipe 2: subscribe from the client, as early as you like

The other side is one method on a generated client.
[`IMQClient.subscribe()`](/api/rpc/latest/rpc.imqclient.subscribe/) listens on
the service's channel, and it needs neither the client's `start()` nor a
broker to exist yet: the subscription has a connection of its own, and a
broker that arrives later is caught up. Measured: a subscription made on an
instance that was never started delivered the next message published to the
channel.

~~~typescript
import { UDPClusterManager } from '@imqueue/rpc';
import { OrderClient } from './clients/OrderClient'; // imq client generate

const orders = new OrderClient({ clusterManagers: [new UDPClusterManager()] });

await orders.subscribe(appendToAuditTrail);   // both stay registered,
await orders.subscribe(refreshRecentOrders);  // in this order, on every broker
~~~

Two `subscribe()` calls are fine; the framework keeps both and installs both on
each broker. When a process has several concerns, though, one **dispatcher**
is the better shape: one registration, one place to deduplicate, one place to
catch errors, and routing by `kind` instead of by handler:

~~~typescript
import type { JsonObject } from '@imqueue/core';

type Handler = (event: JsonObject) => void | Promise<void>;

const handlers: Record<string, Handler[]> = {
    'order.placed': [appendToAuditTrail, refreshRecentOrders],
    'tenant.suspended': [dropTenantFromCache],
};

await orders.subscribe(event => {
    const kind = String(event.kind);

    for (const handler of handlers[kind] ?? []) {
        // never let a handler throw — see recipe 3
        Promise.resolve()
            .then(() => handler(event))
            .catch(err => logger.error(`event ${kind} ${event.id}: ${err}`));
    }
});
~~~

One thing to know about the client API: `subscribe()` listens on the
*service's* channel, and the client's own
[`broadcast()`](/api/rpc/latest/rpc.imqclient.broadcast/) publishes on the
*client's* channel. A broadcast from one client is not heard by other clients
of the same service through `subscribe()`; a consumer would have to subscribe
to that client's queue name explicitly. For "tell every instance of a
service", the service publishes and the clients subscribe.

## Recipe 3: write the handler for a fleet

A handler on a fleet has three obligations that a handler on a single Redis
can get away without.

**Act once, keyed by the event id.** It will be invoked once per broker that
delivers the message — twice on a two-broker fleet, as measured — and again
after any retry the publisher makes. The framework does not deduplicate for
you, deliberately: the same function registered twice is expected to run
twice. So the handler remembers what it has seen:

~~~typescript
const seen = new Map<string, number>();          // event id -> expiry
const DEDUPE_TTL = 60_000;

function once(event: JsonObject, run: () => void): void {
    const id = String(event.id);
    const now = Date.now();

    for (const [key, expires] of seen) {         // cheap sweep, bounded by TTL
        if (expires <= now) seen.delete(key);
    }

    if (seen.has(id)) return;                     // the copy from another broker
    seen.set(id, now + DEDUPE_TTL);
    run();
}

const refreshRecentOrders: Handler = event =>
    once(event, () => recentOrders.invalidate(String(event.tenantId)));
~~~

A per-process map is enough for the copies a fleet produces, because they
arrive within milliseconds of each other. If the *action* must be exactly-once
across processes — a payment, an email — the event is the wrong carrier;
send that through the queue as a job, and let the handler be the thing that
enqueues it.

**Never throw.** The subscription connection hands the parsed payload straight
to your function, and the framework does not contain what the function does
with it. Measured: a handler that threw produced an **uncaught exception** in
the process, which on Node's defaults is the end of the process. The
dispatcher in recipe 2 wraps every handler in a promise and logs a rejection
instead; if you register handlers directly, wrap each one the same way. The
same goes for a payload that is not what you expected: check the shape and log,
do not throw.

**Hand real work to the queue.** A handler runs on the subscription's
connection for every message the channel carries. Invalidating a cache entry
or bumping a counter is fine. Re-indexing the tenant's catalogue is not: it
belongs in a job that the queue will [deliver at least
once](/blog/guaranteed-message-delivery-cost/), survive a crash, and retry.
The event says "something changed"; the job does the changing:

~~~typescript
const reindexTenant: Handler = event =>
    once(event, () => {
        // push() is fire-and-forget: a failed enqueue is logged by the job
        // queue as "[JobQueue] push error:", so keep its logger wired up
        jobs.push({ kind: 'reindex', tenantId: String(event.tenantId) });
    });
~~~

## Recipe 4: brokers come and go

A fleet's membership is not a constant, and the subscription follows it
without help:

- **A broker joins.** It is brought up to date as part of joining: every
  handler registered so far, in registration order, installed once each. Live
  registrations and this catch-up go through one serialised operation per
  broker, so a handler is never installed twice on the same broker.
- **A broker leaves.** Its subscription goes with it; nothing to clean up. The
  remaining brokers still carry every handler, and every publish still reaches
  them.
- **A broker is replaced.** The new address is a broker that joins, and
  receives everything. Measured: a broker withdrawn and re-announced delivered
  to both registered handlers.
- **A connection drops and comes back.** The subscription is re-established
  automatically. Measured: after `CLIENT KILL TYPE pubsub` on the broker cut
  the subscription connection, the next `publish()` was delivered to the
  handler with no action on the client side.

Two operations are yours. `unsubscribe()` closes the channel on every broker
and forgets every handler, so brokers joining afterwards are subscribed to
nothing; a client's `destroy()` does the same. And `subscribe()` is
**additive and not retryable**: a call that rejected still counts, and may
already be installed on some brokers, so calling it again adds another
registration rather than repairing the first. To put a subscription into a
known state, `await unsubscribe()` and register the set again — which is one
more reason to keep the set in one dispatcher table.

Subscription operations serialise per broker and run independently across
brokers, so a broker that is slow to acknowledge holds up its own catch-up and
nobody else's. The catch-up for joining brokers works as described from
`@imqueue/core` 3.5.2; `@imqueue/rpc` 3.9.3 pins it.

## Recipe 5: see it working

Three things tell you a subscription on a fleet is healthy, and only one of
them is the number most dashboards look at.

**The cluster's own log lines.** Every registration and every catch-up is
reported at `info`:

~~~
registered handler #2 for channel OrderService
server 10.0.0.7:6379 installed 2 handler(s) for channel OrderService
~~~

After a deploy, one line per broker naming the full handler count is what you
want to see. A failed install is an `error` line naming the broker and the
channel, and it says plainly that the missing handlers stay missing until a
later registration triggers another catch-up.

**The broker's subscriber count is sockets, not handlers.** `PUBSUB NUMSUB
imq:OrderService` on any broker returns the number of connections subscribed
to that channel. It reads the same whether a connection has one handler behind
it or five, so it confirms the socket and nothing else.

**Count invocations per handler, per replica.** This is the number that
means something. A counter per `kind`, exported with the service's other
metrics, lets you compare replicas: on a healthy fleet the counts move
together (allowing for the one-copy-per-broker multiplier), and a replica
whose counter for one kind stays flat is telling you exactly which handler is
not running there.

For a test, you do not need a fleet. `ClusterManager` is the documented
extension point that discovery plugs into, and a subclass that announces a
local Redis when the test says so exercises the join path the way a real
announcement would:

~~~typescript
import { ClusterManager, ClusteredRedisQueue } from '@imqueue/core';
import { once } from 'node:events';

class ScriptedManager extends ClusterManager {
    public constructor() { super(); }
    public announce(server: { host: string; port: number }): void {
        for (const cluster of this.clusters) cluster.add(server);
    }
    public destroy(): void {}
}

const manager = new ScriptedManager();
const queue = new ClusteredRedisQueue('OrderService', { clusterManagers: [manager] });
const seen: string[] = [];

await queue.subscribe('OrderService', e => seen.push(`A:${e.id}`));
await queue.subscribe('OrderService', e => seen.push(`B:${e.id}`));

// the broker arrives only now, so both handlers reach it through catch-up
manager.announce({ host: '127.0.0.1', port: 6379 });
await once((queue as any).clusterEmitter, 'initialized');

await queue.publish({ id: 'e1' }, 'OrderService');
// expect: seen contains A:e1 and B:e1, once each
~~~

Assert what the rules promise: every handler once per broker, in order, on a
broker that joined after the registrations; a handler registered after the
join installed as well; nothing delivered for a publish made before the
subscription. The framework's own suite runs the same scenarios against a real
broker and skips them, with a reason, where none answers.

## Pub/sub or the queue?

The recipe above assumes you have already decided that an event is the right
carrier. That decision is one question: *can this be missed?*

| need | carrier | why |
|---|---|---|
| every instance should hear it now; a missed one is repaired by the next event or a TTL | pub/sub | reaches every instance on every broker, no backlog, no persistence |
| cache invalidation, config reload, "look again" signals | pub/sub | idempotent by nature; a copy per broker costs nothing |
| something must be done exactly once, or at least once, and survive a crash | queue / job | at-least-once delivery, a lease that outlives the worker, retries |
| the reaction is heavy or slow | pub/sub **then** queue | the event notifies; the handler enqueues; the job does the work |
| one instance should react, not all | queue | competing consumers; pub/sub has no way to pick one |

If a subscriber being offline for a second would leave the system wrong, the
event is not enough on its own. Either the state it points at can be re-read
(the handler invalidates, the next read repairs), or the work goes through the
queue.

## FAQ

### Does Redis pub/sub work across several Redis brokers in @imqueue?

Yes. On a clustered queue, `publish()` writes the payload to every broker in
the fleet and `subscribe()` opens the channel on every broker, so a publisher
and a subscriber reach each other regardless of which broker either is
connected to. Nothing is configured per broker; the cluster options on the
service and the client are all it takes.

### How many times is my handler called on a fleet?

Once per broker that delivers the message. A clustered subscriber is
subscribed on every broker and a publish goes to every broker, so a fleet of
two brokers invoked one handler twice for one `publish()`. Key handlers by an
event id and act once; the framework does not deduplicate, because a function
registered twice is meant to run twice.

### Can I subscribe before the brokers have been discovered?

Yes. Subscribing does not need `start()` or a known broker; registrations are
remembered and every broker that joins later is given all of them, in order,
as part of joining. Publishing is different: a publish made while no broker is
known is dropped and logged once, so publish from work the service is already
doing.

### Can one client subscribe to two channels?

No. An instance supports one channel until `unsubscribe()` resets it, and a
different name is refused with a `TypeError`. Put several concerns on the one
channel and route on a `kind` field in the payload; a generated client's
channel is its service's name.

### What happens if a handler throws?

The exception is uncaught. The subscription connection calls the handler with
the parsed payload and does not contain what it does, so an exception
propagates to the process and, with Node's default handling, ends it. Wrap
handlers so they log instead of throwing, and validate payloads the same way.

### Is pub/sub in @imqueue guaranteed delivery?

No. It is fire-and-forget: a message published while nobody is subscribed is
lost, and there is no persistence or acknowledgement. Work that must not be
lost goes through the queue, where guaranteed delivery and retries apply. Use
pub/sub for news that the next event or a TTL would repair anyway.

### What happens to the subscription when a broker is replaced?

The old address leaves and takes its subscription with it; the new address
joins and is caught up with every registered handler. Handlers reach the
replacement before it is announced as initialised, and a dropped connection to
an existing broker is re-established automatically.

### How do I test pub/sub on a cluster without a fleet?

Subclass `ClusterManager` and announce a local Redis from the test after
`subscribe()` has run. That exercises the join path exactly as discovery
would: assert every handler once per broker, in order, and nothing delivered
for a publish made before the subscription existed.

### Why is my broadcast() not received by other clients?

Because `broadcast()` publishes on the client's own queue channel, while
`subscribe()` listens on the service's channel. Clients hear the service, not
each other. If every instance of a service needs to hear it, the service
publishes.

## Reference

- [`ClusteredRedisQueue.publish()`](/api/core/latest/core.clusteredredisqueue.publish/)
  and [`subscribe()`](/api/core/latest/core.clusteredredisqueue.subscribe/),
  [`unsubscribe()`](/api/core/latest/core.clusteredredisqueue.unsubscribe/)
  — the fan-out contract: every broker, every handler in order, serialised per
  host, not retryable
- [`IMessageQueue.subscribe()`](/api/core/latest/core.imessagequeue.subscribe/)
  — one channel per instance, additive handlers, no `start()` required,
  re-established on reconnect, plain JSON
- [`IMQService.publish()`](/api/rpc/latest/rpc.imqservice.publish/) and
  [`IMQClient.subscribe()`](/api/rpc/latest/rpc.imqclient.subscribe/) — the
  service channel from both sides; [`IMQClient.broadcast()`](/api/rpc/latest/rpc.imqclient.broadcast/)
  is the client's own channel
- [`IMQOptions.clusterManagers`](/api/core/latest/core.imqoptions.clustermanagers/),
  [`ClusterManager`](/api/core/latest/core.clustermanager/) and
  [`UDPClusterManager`](/api/core/latest/core.udpclustermanager/) — how brokers
  are discovered, and the base class a test can script
- [Auto-scaling Redis broker: with and without broadcast](/blog/horizontally-scalable-redis-broker/)
  — the fleet itself
- [Redis as a message bus: patterns beyond pub/sub](/blog/redis-message-bus-patterns/)
  — where pub/sub sits among the primitives
- [Guaranteed delivery, tested with kill -9](/blog/guaranteed-message-delivery-cost/)
  — what the queue promises when the work must not be lost
- [FAQ: how do I auto-scale the @imqueue broker?](/api/faq/#how-do-i-auto-scale-the-imqueue-broker)
