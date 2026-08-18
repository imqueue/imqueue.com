---
layout: post.html
permalink: /blog/cache-invalidation-nodejs-microservices/
templateEngineOverride: md
title: "Cache invalidation across services: a TTL, a tag, or the database"
summary: "Caching a service method is one decorator. Deciding when the entry dies is the whole job. Here are the three mechanisms measured — a guessed TTL, a tag invalidated by an event, and PostgreSQL dropping the entry 6ms after the row changes — plus the four ways a cache goes on serving data it already knows is stale, and a fifth that got fixed while this was being written."
description: "How to cache and invalidate service method results in Node.js microservices: the @cache decorator, tag-based invalidation, and PostgreSQL-driven invalidation, with measured call counts, costs and silent failure modes."
keywords: "cache invalidation microservices, nodejs redis cache decorator, cache stale data microservices, tag based cache invalidation redis, postgres listen notify cache invalidation, imqueue pg-cache tag-cache"
date: 2026-08-18
author: mykhailo-stadnyk
illustration: cache-invalidation
topics: [cache, performance, rpc, patterns]
ogType: article
---

Putting a cache in front of an expensive service method is the easiest
performance work there is. One decorator, and a 153ms call becomes a 0.6ms one.
Nobody needs convincing.

The part that goes wrong is the other half of the sentence: **when does the entry
die?** Most answers to that question are a number somebody picked in a hurry —
`ttl: 60000`, because a minute sounded fine. A minute is a bet that nothing
important changes within a minute, placed without looking at what changes.

`@imqueue` gives you three different answers, in three packages, and they are not
alternatives to each other so much as three different amounts of knowledge about
your data:

- **`@cache()`** from `@imqueue/rpc` — a TTL. You guess.
- **`@imqueue/tag-cache`** — a tag. You invalidate on an event you name.
- **`@imqueue/pg-cache`** — a table. PostgreSQL tells the service when a row
  behind the entry changed, and the entry dies then.

Below is each of them measured in a lab, and — the part that took longer — the
windows in which each of them cheerfully serves data it already knows is stale.
Every count here was recorded by the code that ran, not asserted by the caller.

> Measured on Node 24.19.0 with `@imqueue/rpc` 3.6.0, `@imqueue/tag-cache`
> 3.0.3, `@imqueue/pg-cache` 5.1.0, Redis 7.0.15 and PostgreSQL 17.10, on an
> isolated Redis and a throw-away database. Three full runs; the counts were
> identical in all three.

## One decorator, and a 300× read

The service is deliberately dull — a method that takes 150ms of work and returns
a small object:

~~~typescript
import { IMQService, cache, expose } from '@imqueue/rpc';

export class ReportService extends IMQService {
    /**
     * @param {number} id - report identifier
     * @return {Promise<{ id: number, total: number }>}
     */
    @cache({ ttl: 3000 })
    @expose()
    public async withTtl(id: number): Promise<{ id: number, total: number }> {
        await expensiveWork();

        return { id, total: id * 100 };
    }
}
~~~

Two calls, back to back:

~~~
cold: {"id":1,"total":100} 153.1ms
warm: {"id":1,"total":100}   0.6ms
method body executions: 1
cache keys now: ["imq-cache:RedisCache:a5a8e2c27ac40170"]
~~~

That is the whole feature working: the second call never entered the method. The
key is worth a look, because two of the failure modes further down are properties
of it. It is `imq-cache:RedisCache:` followed by a hash of exactly three things —
the **class name**, the **method name**, and the **arguments**
([`cache`](/api/rpc/latest/rpc.cache/)).

One good consequence first. The argument hash is order-insensitive, so two
callers who build the same filter object with the keys in a different order share
one entry:

~~~typescript
await svc.byRange({ from: '2026-01-01', to: '2026-01-31' });
await svc.byRange({ to: '2026-01-31', from: '2026-01-01' });
~~~

~~~
keys after both calls: ["imq-cache:RedisCache:88f1761181cf9ec9"]
method body executions: 1
~~~

One key, one execution. That is not luck — the framework serialises argument
objects with their keys sorted before hashing, precisely so that JSON built in a
different order does not fork the cache. It is a small thing that saves a
surprising amount of duplicated work in a gateway that assembles filters from
query parameters.

## The TTL you did not write is not zero

`@cache()` takes its TTL in milliseconds. Leave it out and there is no default
minute, no default hour:

~~~
@cache({ ttl: 3000 }) -> pttl 2998
@cache()              -> pttl   -1
~~~

`-1` is Redis for *this key has no expiry*. An entry written by a bare
`@cache()` lives until something deletes it, and nothing in `@cache()` ever
deletes anything: the decorator has no invalidation hook and no sweep. The
adapter underneath it does expose
[`del()`](/api/rpc/latest/rpc.rediscache.del/) and
[`purge()`](/api/rpc/latest/rpc.rediscache.purge/), reachable as
[`this.cache`](/api/rpc/latest/rpc.imqservice.cache/) inside the service, but
calling them is entirely your job — and doing that by hand is the thing the other
two packages exist to stop you doing. If the only thing you wrote was `@cache()`,
the first result that method ever produced is the result it will keep returning
until someone flushes Redis or the key is evicted under `maxmemory` pressure.

This is documented behaviour — "omitted or non-positive means the entry never
expires"
([`CacheDecoratorOptions.ttl`](/api/rpc/latest/rpc.cachedecoratoroptions.ttl/)) —
and it is the right default for a memoised pure function. It is a very expensive
default for a method that reads a database. Write the TTL. Every time.

## Fifty callers, one cold key, fifty executions

Here is the failure that actually takes services down, and it happens at the
moment the cache is at its least useful: the key is cold and everyone wants it.

Fifty concurrent calls, same arguments, nothing in the cache:

~~~
50 concurrent calls on a cold key
  distinct results: 1
  method body executions: 50
  wall clock: 163.1ms
~~~

Fifty executions of a 150ms method. Every one of those callers checked the cache,
found nothing — correctly, nothing was there yet — and went to do the work.
Nothing in `@cache()` coalesces them: the sequence is *get, miss, run, set*, and
fifty of those interleave perfectly happily. The cache is written fifty times
with the same value.

This is the classic stampede, and on a queue-based fleet it has a specific
consequence: those fifty executions are fifty concurrent database queries from
one service, arriving in the same millisecond, triggered by a cache **miss** —
which is to say, triggered by your cache expiring. A TTL is a synchronised
alarm clock for every replica at once.

The fix is in the same package. [`@lock()`](/api/rpc/latest/rpc.lock/) coalesces
concurrent calls that share arguments — the first one runs, the rest wait for its
result:

~~~typescript
@lock()
@cache({ ttl: 60000 })
@expose()
public async guarded(id: number): Promise<Report> {
    await expensiveWork();

    return buildReport(id);
}
~~~

Same burst, same cold key:

~~~
50 concurrent calls, @lock() above @cache()
  distinct results: 1
  method body executions: 1
  wall clock: 156.0ms
~~~

One execution, and the burst finished no slower than the unguarded one. Note the
decorator order: `@expose()` innermost, closest to the method, then `@cache()`,
then `@lock()` outermost. `@cache()` and `@lock()` both replace the method with a
`(...args)` wrapper, so `@expose()` applied *after* one of them records that
rest parameter as the method's only argument and breaks both the generated client
signature and argument validation. The rule is in the
[FAQ](/api/faq/#how-do-i-expose-a-service-method-so-it-can-be-called-remotely)
and it is not optional.

### The lock is per process, and that is the honest number

`@lock()` keeps its held locks in a process-local map, so it coalesces within one
replica. Two replicas of the same service, both cold, both hit at the same
moment by a Redis barrier so the bursts really overlap:

~~~
[r1] 50 concurrent calls on the same cold key -> executions in this process: 1
[r2] 50 concurrent calls on the same cold key -> executions in this process: 1
~~~

A hundred callers, two executions. That is the shape to plan for: `@lock()` turns
a stampede of *N concurrent callers* into one of *one call per replica*. On six
replicas a cold popular key costs six queries, not six hundred. If six is still
too many for what that method does, the entry should not be expiring on a timer
at all — which is the rest of this article.

## The cache key does not know which service you are

The key contains the class name. It does not contain the service name, the queue
name, or the queue prefix. The cache prefix is a constant, `imq-cache`,
independent of whatever `prefix` the service passes for its queues.

So: two services, two different processes, two different fleets isolated by
different queue prefixes, on one shared Redis. Both happen to declare a class
called `ReportService` with a method called `shared`. The first one runs and
caches. Then the second one:

~~~
keys visible to process B: ["imq-cache:RedisCache:75749d2a27b519af"]
B.shared(3) returned: {"id":3,"total":300,"from":"report-service-A"}
B method body executions: 0
~~~

Process B returned process A's data and never ran its own method body. Read that
twice, because it reads two ways depending on what you were hoping for:

- **If they are replicas of one service, this is the feature.** The cache is
  shared, a warm key warms every replica, and a rolling deploy does not start
  from cold. This is the reason to put method caching on Redis rather than in a
  per-process `Map`.
- **If they are two unrelated services, this is a data leak between fleets** —
  and neither service is doing anything wrong. Two teams, two repositories, one
  Redis, one popular class name.

The same experiment with the class renamed and the code left identical:

~~~
V2.shared(3) returned: {"id":3,"total":-1,"from":"billing-service-B"}
B method body executions now: 1
~~~

A different key, its own entry — so a class rename silently throws away
everything that class had cached. Usually harmless, and it is exactly the moment
the stampede above arrives.

The collision, though, is worth fixing rather than hoping about, and it does not
require a second Redis. The decorator uses whatever adapter is already registered
and ready, so claim the namespace yourself at start-up, before any decorated
class runs a method:

~~~typescript
import { IMQCache, RedisCache } from '@imqueue/rpc';

await IMQCache.register(RedisCache, {
    host: process.env.REDIS_HOST,
    port: Number(process.env.REDIS_PORT),
    prefix: 'imq-cache:billing',   // this fleet, and nobody else
}).init();
~~~

~~~
adapter ready before any cached call: true
cache keys written: ["imq-cache:billing:RedisCache:75749d2a27b519af"]
~~~

Same hash — it is still class, method and arguments — under a prefix that is
yours. One call in the process bootstrap, and two fleets can share a Redis
without sharing a cache
([`IMQCache.register()`](/api/rpc/latest/rpc.imqcache.register/)).

## When one value has several invalidators

Everything so far shares one limitation: a key-based cache can only be
invalidated by something that knows the key. Plenty of cached values do not work
that way. An invoice summary for user 7 derives from that user, from their
invoices, and from the tax rates table. Any of the three changing makes it wrong.
None of the three knows what key it was stored under.

That is what [`@imqueue/tag-cache`](/api/tag-cache/latest/) is for. A value is
stored with a set of tags; each tag is a Redis set of the keys stored under it;
invalidating a tag drops everything in it:

~~~typescript
import { RedisCache } from '@imqueue/rpc';
import { TagCache } from '@imqueue/tag-cache';

// 'taglab' is this lab's key prefix — it is why the raw output further down
// says taglab:RedisCache:…
const cache = new TagCache(await new RedisCache().init({ prefix: 'taglab' }));

await cache.set('invoice-summary:7', summary,
    ['user:7', 'invoices', 'tax-rates'], 60000);
await cache.set('user-profile:7', profile, ['user:7'], 60000);
~~~

A tax-rate change has nothing to do with user 7, and knows nothing about
`invoice-summary:7`:

~~~
await cache.invalidate('tax-rates');

  invoice-summary:7 -> null
  user-profile:7    -> {"name":"Ada"}
~~~

The summary is gone; the profile, which does not derive from tax rates, is
untouched. That is the whole idea, and it is the one caching primitive that a
plain `SET`/`DEL` cache genuinely cannot express
([`TagCache.invalidate()`](/api/tag-cache/latest/tag-cache.tagcache.invalidate/)).

Two things about it are worth knowing before you rely on it, and one of them is
the most expensive thing in this article.

### Two TTLs under one tag, and one of them becomes uninvalidatable

`set()` applies the entry's TTL to the tag sets as well — each `SADD` is followed
by a `PEXPIRE` on the tag key with the same value. Every write to a tag
therefore **overwrites that tag's expiry with its own TTL**. Write a
long-lived entry and a short-lived one under the same tag:

~~~typescript
await cache.set('long-lived',  { v: 'still here' }, ['orders'], 60000);
await cache.set('short-lived', { v: 'gone soon' },  ['orders'],   700);
~~~

~~~
tag key: taglab:RedisCache:tag:orders pttl 700
after 1s — tag key pttl: -2 (-2 = the tag set itself is gone)
  members left in tag set: []

await cache.invalidate('orders');
  long-lived -> {"v":"still here"}
~~~

The tag set expired after 700ms, taking with it the only record that
`long-lived` was ever tagged `orders`. The entry itself is still there, with 59
seconds left on its own TTL, and `invalidate('orders')` — the call whose entire
job is to drop it — now finds an empty set and reports success. It returns
`true`. Nothing is logged. The value stays until its own TTL runs out, however
long that is.

This is the failure mode to watch for, because it is invisible from the call
site: your invalidation *works*, in the sense that it does not error, and the
stale value survives it. The rule that avoids it is simple, and worth putting in
a code review checklist: **all entries sharing a tag must share a TTL** — or at
least, no entry under a tag may have a TTL longer than the shortest one written
under it. If you need mixed lifetimes, use different tags.

### What invalidating one tag costs

`invalidate()` reads the members of the named tags, deletes those keys, and then
— to keep the tag sets from filling up with dead keys — `SCAN`s the *whole*
tag keyspace and issues an `SREM` against every tag set it finds. So the cost of
dropping one tag is a function of how many tags exist in total, not of how many
entries are under the one you named:

| Tag sets in Redis | `invalidate()` one tag |
| --- | --- |
| 1 | 0.5ms |
| 5,001 | 12–15ms |
| 50,001 | 115–186ms |

Same single entry being dropped in all three rows. At 50,000 distinct tags an
invalidation issues 50,000 `SREM` commands, and they go in one `MULTI` — which
Redis, being single-threaded, executes without interleaving anything else. That
is what the third row is: not slow client code, a Redis instance doing your
housekeeping instead of serving reads.

The practical reading is not "do not use tags" — it is that **your tag
vocabulary is your invalidation cost**. Tagging by entity (`user:7`) is normal
and fine at thousands of tags. Tagging by entity at millions is a design that
gets slower every day it runs. Give tags a TTL so the vocabulary prunes itself,
keep the tag space bounded, and if a per-entity tag is genuinely needed at high
cardinality, that is the signal to move up to the next mechanism.

One more, for completeness: `invalidate()` returns after *issuing* the deletion,
not after it completes — the underlying transaction is fired without being
awaited. I went looking for the read-after-invalidate race that implies and could
not produce one: 200 attempts reading on the same connection and 200 more from a
second connection both returned zero stale values, because the delete is
dispatched before `invalidate()` resolves and Redis serves commands in the order
they arrive. What the unawaited transaction does cost you is error reporting: if
that delete fails, `invalidate()` has already returned `true`, and the only trace
is a warning in the log.

## Or let PostgreSQL decide

The third mechanism removes the guess entirely. If a cached result is derived
from database tables, then the database already knows exactly when it became
stale, and it is the only participant that does.

[`@imqueue/pg-cache`](/api/pg-cache/latest/) is that idea wired up:
[`@PgCache()`](/api/pg-cache/latest/pg-cache.pgcache/) on the class installs a
change-notify trigger on every table the methods declare and subscribes to one
`LISTEN`/`NOTIFY` channel per table;
[`@cacheWith()`](/api/pg-cache/latest/pg-cache.cachewith/) on the method names
the tables:

~~~typescript
@PgCache({
    postgres: process.env.DB_URL!,
    redis: { host: 'localhost', port: 6379 },
})
class OrderService extends IMQService {
    /**
     * @return {Promise<number>}
     */
    @cacheWith({ channels: ['orders'] })
    @expose()
    public async total(): Promise<number> {
        const res = await db.query('select sum(amount) as t from orders');

        return res.rows[0].t;
    }
}
~~~

With the subscription established, a warm entry and one `UPDATE`:

~~~
re-warmed. executions: 0            (served from cache)
update orders set amount = 900 where id = 2
invalidated after: 6.9ms
total() -> 1700                     (freshly computed)
~~~

Six point nine milliseconds from the commit to the entry being gone. No TTL
expired; the row changed, so the entry died. Across three runs the same
measurement came out at 6.9, 5.5 and 3.5ms, and the equivalent for an `INSERT`
at 4.7–6.1ms.

The interesting case is a result that derives from a table the caller has no
reason to think about. `withTax()` reads `orders` and one row of `tax_rates`, and
declares both:

~~~typescript
@cacheWith({ channels: ['orders', 'tax_rates'] })
~~~

~~~
withTax() twice -> 2520, executions: 1
update tax_rates set rate = 0.25 where id = 1
invalidated after: 6.7ms
withTax() -> 2625
~~~

This is the same problem tag-cache solves — one value, several unrelated
invalidators — with the tags derived from the schema instead of maintained by
hand. Under the hood it *is* tag-cache: each entry is tagged with the tables it
depends on. The difference is that nobody has to remember to call
`invalidate()`, which means nobody can forget to, and the notification arrives
even when the row was changed by something that is not your service at all — a
migration, a support script, another service writing the same table, `psql`.
That last property is the one a TTL can never give you and a hand-rolled
`invalidate()` call almost never does.

### The operation filter reads backwards

A [`ChannelFilter`](/api/pg-cache/latest/pg-cache.channelfilter/) given as an
array of operations is an **exclusion** list. `[ChannelOperation.DELETE]` does
not mean "invalidate on deletes":

~~~typescript
@cacheWith({ channels: { orders: [ChannelOperation.DELETE] } })
~~~

~~~
warm. executions: 1
delete from orders where id = 3
after DELETE: executions: 1          <- the delete did NOT invalidate
insert into orders (amount) values (700)
after INSERT: executions: 2          <- invalidated after 6.1ms
~~~

Deletes named, deletes ignored, everything else invalidates. This is documented,
in those words, and it is still the single easiest thing to get backwards in the
package — the array form excludes, the predicate form
([`ChannelPayloadFilter`](/api/pg-cache/latest/pg-cache.channelpayloadfilter/))
includes. If you find yourself reasoning about it for more than a moment, use the
predicate: `payload => payload.operation === ChannelOperation.DELETE` reads the
way it behaves.

## Two start-up windows, one of them since closed

Neither of these raises an error, and they fail in opposite directions: the first
leaves caching off, which costs latency, and the second left caching on with
invalidation off, which is the worst state a cache can be in.

**A service that never starts.** The triggers and the subscription are
established in `start()`. Construct the service, call the method, and:

~~~
PgCache:cacheWith: cache is not initialized on OrderService, called in total
PgCache:cacheWith: cache is not initialized on OrderService, called in total
two calls before start(): method body executions: 2
~~~

This one is benign and well handled: nothing was cached, both calls ran, and the
package said so at warning level twice. Uncached is a performance bug, not a
correctness one. Worth knowing if you unit-test a decorated service without
starting it and wonder why the cache never hits.

**The gap between `start()` resolving and the subscription existing.** This one
was not benign, and it is the reason this article has a version number at the top.
Up to and including `@imqueue/pg-cache` 5.0.6, `start()` awaited the connection,
but the trigger installation and the `LISTEN` calls happened in a `connect` event
handler whose promise nobody held. Timestamps from one run on 5.0.6, all relative
to the call to `start()`:

~~~
start() resolved at                                +26.1ms
change-notify triggers in the database then:             0
UPDATE issued at                                   +55.0ms
channels confirmed (listen) at                     +66.6ms, +66.8ms
~~~

The `UPDATE` at +55ms landed on a table that had no trigger on it yet. No
trigger, no `NOTIFY`, nothing to invalidate — and the entry cached just before it
survived:

~~~
after that update, total() -> 600   (the database says 1000)
invalidated after: NaNms            (never, inside a 3s budget)
~~~

Forty milliseconds of exposure, once per process start. That sounds negligible
until you count what it applies to: every deploy, every restart, every replica,
every scale-up event — and a fleet under a rolling deploy is a fleet of processes
in exactly that window, at exactly the moment its caches are cold and being
refilled. An entry poisoned there was not corrected on a timer either. It survived
until either the *next* change to one of its tables (the run above recovered on
the second `UPDATE`, 6.6ms after it) or the TTL — and the default TTL for
`@cacheWith()` is
[24 hours](/api/pg-cache/latest/pg-cache.default_cache_ttl/). On a slow-moving
table — pricing, tax rates, feature flags, configuration, the exact tables people
reach for `@cacheWith()` to cache — a value written in that window could be wrong
for a day.

**This is fixed in 5.1.0**, which shipped while this article was being written.
`start()` now holds the promise for that setup and awaits it, so it does not
resolve until the triggers exist and every channel is subscribed. The same probe,
on 5.1.0, with no gate of any kind in the caller's code:

~~~
start() resolved at                                +49.0ms
change-notify triggers in the database then:             2
after an immediate UPDATE, total() -> 1000  (the database agrees)
invalidated after: 4.1ms
~~~

Across three runs `start()` resolved at 49.0, 57.1 and 53.6ms — about 30ms slower
than it used to, because it now includes the work it always implied — and the
immediate change invalidated in 1.7–4.1ms every time. Awaiting `start()` is now
the whole of the contract, which is what it always looked like.

Two notes for the versions in between. If you are pinned to 5.0.6 or earlier, the
gate is easy to write yourself: poll
[`pubSub.activeChannels()`](/api/pg-cache/latest/pg-cache.pgcacheable.pubsub/)
until it covers every key of
[`pgCacheChannels`](/api/pg-cache/latest/pg-cache.pgcacheable.pgcachechannels/),
and fail the health check until it does — poll the state rather than listening for
the `listen` event, which may already have fired by the time a handler is
attached. And on 5.1.0 the *other* half of this failure is now a choice rather
than a default: when the trigger setup fails outright, or is not confirmed within
[`invalidationTimeout`](/api/pg-cache/latest/pg-cache.pgcacheoptions.invalidationtimeout/),
the service still caches and expires by TTL, exactly as before. Pass
[`requireInvalidation: true`](/api/pg-cache/latest/pg-cache.pgcacheoptions.requireinvalidation/)
where a stale read is worse than a slow one, and it runs uncached instead.

## Which one to reach for

The three mechanisms line up with how much you know about what makes the result
wrong:

| You know… | Use | Entry dies when |
| --- | --- | --- |
| nothing — it is just expensive | `@cache({ ttl })` | the clock says so |
| the events that change it | `TagCache` + `invalidate()` | you say so |
| the tables it derives from | `@cacheWith({ channels })` | a row changes |

Read that top to bottom as an upgrade path, because that is how it goes in
practice. Start with a TTL and a `@lock()` above it — that is two lines and it
survives contact with production. Move a value to tags when you find yourself
writing `del()` calls in more than one place, or when the same result depends on
several entities. Move it to `pg-cache` when the value derives from tables and
the freshness actually matters, which is also the point at which hand-maintained
`invalidate()` calls start getting forgotten in code review.

And one thing not to do: do not reach for a longer TTL as a performance fix. A
longer TTL buys hit rate with staleness, and it makes the stampede worse, not
better — fewer, larger, more synchronised misses. If the hit rate is the problem,
the answer is a mechanism that lets the entry live indefinitely and die on an
event, which is the entire content of the two lower rows in that table.

## What this is not

- **Not an HTTP cache.** These are all server-side memoisations of a method
  result, keyed on arguments. Nothing here sets a cache header or talks to a CDN.
- **Not a read-through database cache.** `@cacheWith()` caches *method results*,
  not rows. Two methods reading the same table hold two entries, invalidated by
  the same notification.
- **Not distributed single-flight.** `@lock()` coalesces within a process. There
  is no cross-replica leader election on a cold key, and the numbers above say so
  — one execution per replica, not one overall.
- **Not a substitute for not calling.** A cached call over a queue is still a
  queue round trip from the caller's side. If the problem is the *number* of
  calls rather than their cost, that is a batching problem, and its own
  [article](/blog/graphql-n-plus-1-microservices/).

## The short version

- `@cache()` with no `ttl` never expires, and nothing else in the decorator ever
  deletes anything. Write the TTL.
- Fifty concurrent callers on a cold key ran the method fifty times. `@lock()`
  above `@cache()` made it one — per replica.
- The cache key is class name + method name + arguments, under a default
  `imq-cache` prefix that has nothing to do with the queue prefix. Two unrelated
  services sharing a class name on one Redis share cached values. Register
  `RedisCache` yourself with a fleet-specific prefix at boot.
- Renaming a service class throws away its cached entries. Deploy accordingly.
- Tags express what keys cannot: one value, several unrelated invalidators.
- All entries under one tag must share a TTL. A shorter write expires the tag set
  and leaves the longer-lived entry permanently uninvalidatable, silently, with
  `invalidate()` still returning `true`.
- Invalidating one tag costs a scan of the whole tag keyspace: 0.5ms at one tag,
  115–186ms at fifty thousand.
- `pg-cache` drops an entry 4–7ms after the row behind it changes, including when
  something other than your service changed it.
- The operation-array filter is an exclusion list. The predicate form is not.
- Up to pg-cache 5.0.6, `await start()` returned ~35ms before the triggers
  existed, and a row changed in that window was never noticed. Fixed in 5.1.0:
  `start()` now waits, at a cost of ~30ms at boot. On 5.0.6 and earlier, gate
  traffic on `pubSub.activeChannels()` yourself.
- If that setup fails on 5.1.0, the service still caches and expires by TTL.
  `requireInvalidation: true` makes it run uncached instead.

## FAQ

### What is the default TTL for the @cache decorator in @imqueue/rpc?

There is not one. If `ttl` is omitted or non-positive, the entry is written
without an expiry and Redis reports its TTL as `-1`. Because `@cache()` contains
no invalidation of any kind, that entry then lives until it is evicted or Redis
is flushed. Always pass a TTL, or use a mechanism that invalidates on an event
instead.

### Does @imqueue's cache decorator prevent a cache stampede?

No. Measured with fifty concurrent callers on a cold key, the method body ran
fifty times: `@cache()` does *get, miss, run, set* with nothing coalescing
concurrent misses. Adding [`@lock()`](/api/rpc/latest/rpc.lock/) above
`@cache()` reduced it to one execution. `@lock()` is process-local, so on a fleet
the cost of a cold popular key is one execution per replica.

### Can two different services share cached values by accident?

Yes, if they share a Redis. The cache key is a hash of the class name, the method
name and the arguments, under the constant prefix `imq-cache` — the queue prefix
is not part of it. Two unrelated services that both declare a class named
`ReportService` with a method named `shared` will read each other's entries. The
fix does not need a second Redis: call
[`IMQCache.register(RedisCache, { prefix })`](/api/rpc/latest/rpc.imqcache.register/)
at start-up with a prefix of your own, and the decorator uses that adapter for
every cached method in the process.

### Why does invalidating a tag not drop a value that was stored with that tag?

Most likely another write under that tag had a shorter TTL. `TagCache.set()`
expires the tag set along with the entry, so the shortest TTL written under a tag
decides when the tag set disappears — and once it is gone, the surviving entries
are no longer reachable by that tag. `invalidate()` finds an empty set and
returns `true`. Keep TTLs uniform within a tag.

### How long does pg-cache take to invalidate after a row changes?

In this lab, 4–7ms from the committed statement to the cached entry being gone,
for updates, inserts and changes to a second declared table alike. From
`@imqueue/pg-cache` 5.1.0 that holds from the moment `await start()` resolves, because
`start()` waits for the triggers and the channel subscriptions before returning.
Up to 5.0.6 it did not: for roughly 35ms after `start()` resolved there were no
triggers, so a row change in that window produced no notification at all and
anything cached there stayed until the next change to one of its tables or the
24-hour default TTL.

## Where to start

The FAQ has the short form of both invalidation mechanisms —
[caching against a table](/api/faq/#how-do-i-cache-a-service-method-result-and-invalidate-it-when-a-table-row-changes)
and
[one value with several invalidators](/api/faq/#how-do-i-cache-one-value-that-several-unrelated-events-should-invalidate)
— and [`@cacheBy()`](/api/pg-cache/latest/pg-cache.cacheby/) is worth a look
before you write `@cacheWith()` by hand: it derives the table list from a model
and the requested fields, so it invalidates on less.

If the `LISTEN`/`NOTIFY` half of `pg-cache` is new to you, the
[duplicate-listener problem](/blog/postgres-notify-duplicate-listeners/) is the
other thing worth knowing about running it across replicas. The full API surface
is in the references for
[`@imqueue/rpc`](/api/rpc/latest/rpc.cache/),
[`@imqueue/tag-cache`](/api/tag-cache/latest/) and
[`@imqueue/pg-cache`](/api/pg-cache/latest/).
