---
layout: post.html
permalink: /blog/cache-stampede-single-flight-nodejs/
templateEngineOverride: md
title: "Fifty callers, one query: the cache stampede and the decorator that ends it"
summary: "A cache is at its most useless in the one moment you need it: the key is cold, fifty requests miss it together, and fifty copies of the same query hit the database. Measured — and measured again with one line above the method that makes it one query, one result, fifty callers served."
description: "How a cache stampede happens in a Node.js service, measured with fifty concurrent callers, and how @imqueue/rpc's @lock() decorator coalesces them into one execution — with the decorator order, the per-process scope, skipArgs and the deadlock timeout."
keywords: "cache stampede nodejs, thundering herd nodejs, dogpile effect cache, single flight nodejs, request coalescing nodejs, deduplicate concurrent calls, imqueue lock decorator, coalesce identical requests, cold cache burst, in-flight promise memoization"
date: 2026-09-08
author: mykhailo-stadnyk
illustration: single-flight
topics: [cache, patterns, performance, rpc]
ogType: article
---

The cache has been doing its job all week. Hit rate in the high nineties, the
database idling, nobody thinking about it. Then something makes one popular key
cold — a TTL expires, a deploy restarts the process, someone invalidates a tag —
at exactly the moment that key is popular.

Fifty requests arrive inside the same hundred milliseconds. The first one checks
the cache, misses, and goes to the database. So does the second, because the
first has not come back yet. So do all fifty. The database, which has spent the
week answering this query once a minute, now gets it fifty times in one burst,
and every one of those fifty queries returns the same rows. Then fifty identical
`SET`s land on the cache, one after another, writing the same value.

That is a **cache stampede** — also sold under the names *thundering herd* and
*dogpile effect* — and the part people find hard to accept is that the cache is
working exactly as designed while it happens. It just has a gap in it.

## The gap is between *miss* and *set*

A read-through cache does four things: get, miss, run, set. The stampede lives
entirely between the second and the fourth. From the moment the first caller
misses until the moment it writes the result back, the key is still cold, and
every caller who arrives in that window sees the same emptiness and does the
same work.

Nothing in a cache can close that gap, because the cache does not know a fill is
already in progress. `@imqueue/rpc`'s own
[`@cache()`](/api/rpc/latest/rpc.cache/) is a plain get-miss-run-set — it
memoises the result under a key built from class, method and arguments, and it
has no opinion about how many callers are mid-miss at once. Measured with fifty
concurrent callers on a cold key, against a live Redis:

| | method body ran | wall clock |
|---|---|---|
| `@cache()` alone, cold key | **50 times** | 108 ms |

Fifty callers, fifty executions. The cache's job starts one instant too late.

## One decorator above it, one execution

The fix is not in the cache. It is a lock around the fill, so that the first
caller to miss does the work and everyone who misses behind it *waits for that
result* instead of producing their own:

```typescript
import { IMQService, expose, lock, cache } from '@imqueue/rpc';

class PostService extends IMQService {
    /**
     * Returns the post for a given identifier
     *
     * @param {string} id - post identifier
     * @return {Promise<Post>} - the post
     */
    @lock()
    @cache({ ttl: 60000 })
    @expose()
    public async fetchPost(id: string): Promise<Post> {
        return this.db.posts.findById(id);
    }
}
```

[`@lock()`](/api/rpc/latest/rpc.lock/) coalesces concurrent calls that share
the same arguments: the first executes, the rest resolve with its result. Same
fifty callers, same cold key, same Redis:

| | method body ran | wall clock |
|---|---|---|
| `@cache()` alone, cold key | 50 times | 108 ms |
| `@lock()` above `@cache()`, cold key | **once** | 101 ms |
| same key again, now warm | none | 0 ms |

One execution for fifty callers, and the wall clock did not move: the first
caller pays the same hundred milliseconds it always did, and the other
forty-nine are resolved the instant it returns. Nobody waited longer than they
would have anyway. They just stopped duplicating the work while they waited.

The lock is keyed on the argument values, so different arguments run under
different locks. Fifty callers spread across five post ids ran the body five
times, not one and not fifty — each id got its own single execution.

And it is symmetric about failure. When the executing call throws, every waiter
is rejected with that same error: fifty callers, one execution, fifty rejections
carrying `db down`. Nobody is left hanging on a promise that will never settle,
and nobody gets a stale value pretending to be fresh.

## Idempotent for how long?

The objection arrives on cue: *`getUser(id)` is not idempotent. Call it now and
call it tomorrow and you get different rows. You cannot coalesce that.*

True over a day. Irrelevant over a hundred milliseconds. The lock does not hold
across calls in general — it holds for **exactly one execution**, and every
caller it coalesces arrived while that execution was in flight. So the question
is never "is this method idempotent" in the abstract. It is: *would two callers
who arrived within the same hundred milliseconds be entitled to different
answers?* For a user record, a product page, a price, a permissions set — no.
Whatever the database said at the start of the query is what all of them should
get, and it is what the one who ran the query gets anyway.

Idempotency is relative to a timeframe, and the lock's timeframe is one query
long. Inside it, a read is as idempotent as it needs to be.

That reframing changes the arithmetic from a one-off burst to a steady state.
A thousand calls to `getUser(7)`, arriving one per millisecond, against a body
that takes a hundred:

| 1000 calls over ~1.2 s, 100 ms body | |
|---|---|
| method body ran | **12 times** |
| distinct results returned | 12 |
| callers answered | 1000 of 1000 |
| callers served per execution | ~83 |

Twelve queries instead of a thousand. And the twelve distinct results are the
point, not a blemish: each hundred-millisecond window ran its own fresh
execution, so **no caller received a value older than one query**. The ones who
arrived together shared an answer; the ones who arrived later got a newer one.
That is not an approximation of correct behaviour. Under load, it is correct
behaviour with the redundant work removed.

## The order of the two decorators is the whole trick

`@lock()` goes *above* `@cache()`. That is not a style preference — it is which
one wraps which, and getting it backwards produces a result that looks fine
until you watch Redis.

With `@cache()` outermost, every caller checks the cache first, misses, and
*then* reaches the lock. The lock still does its job — the body runs once — but
by then fifty callers are each inside their own cache miss, and each one writes
the result back:

| | method body ran | Redis `SET` calls |
|---|---|---|
| `@lock()` above `@cache()` | once | 1 |
| `@cache()` above `@lock()` | once | **50** |

One execution either way, so a counter on the method would tell you the problem
is solved. Fifty writes of the same value to the same key say otherwise. Put the
lock outside, so the entire get-miss-run-set happens once and the other
forty-nine never touch the cache at all.

## This is per process, and it is still the win

Here is the scope, stated plainly rather than buried: **`@lock()` is
in-process.** [`IMQLock`](/api/rpc/latest/rpc.imqlock/), which the decorator is
built on, keeps its lock table in the memory of one Node.js process and touches
neither Redis nor the network. Four replicas of the service under the same burst
run the guarded code four times — once each — not once in total.

That is a very different thing from a distributed lock, and it would be
dishonest to sell it as one. If you need genuine mutual exclusion across
replicas — one writer, fleet-wide — you need a Redis- or database-backed lock,
and this is not it.

But look at what it does to the arithmetic. Fifty callers across four replicas
is fifty database queries without the lock and **four** with it. The stampede
was never really about the number of replicas; it was about the number of
*concurrent callers per replica* all missing together, and that is exactly the
quantity this collapses. The pathological case — a hot key going cold under load
and taking the database with it — is gone. What remains is one fill per process,
which is the floor a cache warms from anyway.

## The argument that should not be in the key

Similarity is computed from *all* the argument values. That is correct for the
post id and wrong for anything that is unique per request — a trace context, a
request id, a correlation object, a callback. Pass one of those and every call
has different arguments, so every call gets its own lock, so nothing coalesces:

| `fetchPost(id, ctx)`, fifty callers, same id | method body ran |
|---|---|
| `@lock()` | **50 times** |
| `@lock({ skipArgs: [1] })` | once |

[`skipArgs`](/api/rpc/latest/rpc.lockoptions.skipargs/) takes the positional
indices to leave out of the key. If a method carries request context, this is
not optional — without it the decorator is silently doing nothing, and the
counter you would need to notice is the one nobody adds.

## Three edges the reference is honest about

These are all in the docs. They are worth reading before the first incident
rather than during it.

**The deadlock timeout is real, and it is 10 seconds.**
[`IMQLock.deadlockTimeout`](/api/rpc/latest/rpc.imqlock.deadlocktimeout/)
exists so that a holder which never releases — a bug, a hung connection —
cannot poison a key for the life of the process. When it fires, the *waiters*
are rejected with `Lock timeout` (the error carries the class, method and
arguments), while the holder keeps running. Measured with the timeout set below
the body's duration: one caller fulfilled, nine rejected, the body still ran
exactly once. The subtle part is what happens *next*: a fresh call arriving
after the timeout finds the key free, acquires it, and runs alongside the
still-running holder. Exclusion is not absolute. If you would rather waiters
wait forever than ever overlap, set `deadlockTimeout` to `0`.

**Hashing the signature costs something.** To decide whether two calls are the
same call, the lock hashes the arguments, and that cost grows with the size of
the signature. For a slow method under load it is nothing. For a method that is
cheaper to run than its arguments are to hash, the lock is pure overhead — the
reference says so, and a lock on a two-microsecond getter is a net loss.

**Using `IMQLock` directly has a protocol.** The decorator handles this for
you, but if you reach for the class — for locking something that is not a
method — three lines of the documented example are load-bearing:
[`locked()`](/api/rpc/latest/rpc.imqlock.locked/) is the only reliable way to
tell the holder from a waiter; read the
[`token()`](/api/rpc/latest/rpc.imqlock.token/) immediately after acquiring
and pass it to every [`release()`](/api/rpc/latest/rpc.imqlock.release/), so a
late release cannot land on a later holder's lock; and release on *both* the
success and the error path, or waiters hang until the timeout above rescues
them. Keys are used verbatim with no namespacing, so two unrelated call sites
that happen to share a string share a lock.

## When not to reach for it

- **Anything where two callers in the same window must each produce their own
  effect.** Not "anything non-idempotent" — reads that change over a day are
  fine over a hundred milliseconds. But a method that creates, sends or charges
  owes every caller their own execution, and coalescing it silently drops
  forty-nine of them.
- **Anything already cheap.** See the hashing cost. If the body is a map lookup,
  the lock costs more than it saves.
- **Anything that needs one execution fleet-wide.** Per process is the scope.
  Reach for a distributed lock and accept its very different failure modes.
- **Anything where callers must not share an error.** One failure rejects every
  waiter. That is usually right — a database that is down is down for all of
  them — but a method whose errors are per-caller wants to stay uncoalesced.

For the case it is built for — an expensive read, a popular key, a burst of
identical calls — it is one decorator, in the right position, and the stampede
does not happen.

## FAQ

### What is a cache stampede?

A burst of concurrent requests that all miss the same cache key at once and all
run the underlying work independently, because the cache has no way to know a
fill is already in progress. Measured here as fifty concurrent callers on a cold
key producing fifty identical database queries. Also called the thundering herd
or the dogpile effect.

### Does a cache prevent a stampede on its own?

No. A read-through cache does get, miss, run, set, and the stampede happens
between miss and set — every caller who arrives in that window misses too.
`@imqueue/rpc`'s `@cache()` behaves this way by design: fifty concurrent callers
on a cold key ran the method body fifty times. Preventing the stampede needs a
lock around the fill, not a better cache.

### How does @lock() stop the stampede?

Concurrent calls to the decorated method that share the same arguments are
coalesced: the first call executes, and every other call waits for it and
resolves with its result. Fifty concurrent callers on one key produced one
execution, in the same wall-clock time as the unlocked version, because the
waiters resolve the instant the first call returns.

### Is it safe to coalesce a read like getUser(id) that is not idempotent?

Yes, because the lock only holds for one execution. Two calls a day apart may
legitimately return different rows; two calls a hundred milliseconds apart, both
in flight while the same query runs, are not entitled to different answers, so
resolving them from one result is correct rather than approximate. Measured with
a thousand calls streaming in over about 1.2 seconds against a 100 ms body: 12
executions, 12 distinct results, all 1000 answered, and no caller given a value
older than one query.

### Should @lock() go above or below @cache()?

Above. With `@lock()` outermost, the whole get-miss-run-set runs once and the
waiters never touch the cache. With `@cache()` outermost, every caller misses
the cache before reaching the lock — the body still runs once, but each caller
then writes the result back, measured as fifty Redis `SET` calls for one value.

### Is @lock() a distributed lock?

No. It is in-process: the lock table lives in the memory of one Node.js process
and does not touch Redis or the network. Separate processes, cluster workers and
service replicas each keep their own locks and each run the guarded code once.
Four replicas under a burst means four executions, not one. For mutual
exclusion across replicas, use a Redis- or database-backed lock.

### What happens if the locked call throws?

Every waiter is rejected with the same error the executing call threw. Fifty
callers, one execution, fifty rejections carrying the same message. No waiter is
left pending and none receives a stale or partial value.

### Why is @lock() not coalescing anything?

Almost always because an argument differs per call. Similarity is computed from
all argument values, so a request context, trace id or callback in the signature
makes every call unique. Pass `skipArgs` with the positional indices to exclude:
fifty callers with a per-request context argument ran the body fifty times, and
once with `@lock({ skipArgs: [1] })`.

### What does the deadlock timeout do?

After `IMQLock.deadlockTimeout` milliseconds — 10 seconds by default — waiters
on a key are rejected with `Lock timeout` so that a holder that never releases
cannot block the key for the life of the process. The holder keeps running, and
a new call arriving after the timeout will acquire the key and run alongside it,
so exclusion is not absolute. Set it to `0` to make waiters wait indefinitely.

## Reference

- [`lock()`](/api/rpc/latest/rpc.lock/) — the decorator, and
  [`LockOptions`](/api/rpc/latest/rpc.lockoptions/) with `skipArgs` and
  `disabled`
- [`IMQLock`](/api/rpc/latest/rpc.imqlock/) — the class underneath: scope,
  `acquire`/`release`/`locked`/`token`, and `deadlockTimeout`
- [Locking, in the RPC reference](/api/#locking) — the hashing trade-off and the
  per-process boundary
- [`cache()`](/api/rpc/latest/rpc.cache/) — what the get-miss-run-set actually
  does
- [Cache invalidation across services](/blog/cache-invalidation-nodejs-microservices/)
  — what happens to the entry *after* it is filled: TTL, tag, or the database
  row
- [RPC over Redis: patterns and pitfalls](/blog/rpc-over-redis-nodejs/) — the
  wider set of things that go wrong with concurrent calls
