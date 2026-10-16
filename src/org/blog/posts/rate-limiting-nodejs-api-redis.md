---
layout: post.html
permalink: /blog/rate-limiting-nodejs-api-redis/
templateEngineOverride: md
title: "Rate limiting a Node.js API across many instances, without letting a forged header ban your customers"
summary: "A per-process rate limiter stops counting the moment you run a second copy of your API. Moving the counter into Redis fixes that, and exposes the question that matters more: who is the client? Here is how @imqueue/http-protect counts and bans across every instance, what the counter really measures, why trusting X-Forwarded-For lets anyone get your customers banned, and how to set it up so it can't. Every behaviour is measured."
description: "A measured recipe for per-IP rate limiting and banning in a Node.js API that runs on several instances, with @imqueue/http-protect and Redis: one shared counter, what the TTL-based counter really measures, resolving the client IP safely behind a proxy, exempting your own networks, lifting bans, Retry-After, and failing fast when Redis is down."
keywords: "rate limiting nodejs redis, express rate limit multiple instances, distributed rate limiting nodejs, x-forwarded-for spoofing rate limit, express trust proxy rate limit, ban ip after too many requests nodejs, retry-after header express, rate limiter redis down, imqueue http-protect"
date: 2026-10-16
author: mykhailo-stadnyk
illustration: rate-limit
topics: [security, performance, patterns]
ogType: article
---

Somebody is hammering your login endpoint. You add a rate limiter, the kind
that keeps a counter per IP address in memory, and it works on your laptop.

Then it goes to production, where the API runs as three copies behind a load
balancer. Each copy keeps its own counter, so a client that should be stopped
after 100 requests gets 300 before anything notices. And when the third copy is
added next month, the limit quietly becomes 400.

The fix for that is well known: keep the counter in one place that every copy
shares, and Redis is the usual place. This post shows how to do that with
[`@imqueue/http-protect`](/api/http-protect/latest/), and then spends most of
its time on the question that turns out to matter more: **who is the client?**
Get that wrong and a rate limiter stops being protection. It becomes a way for
a stranger to have your customers blocked.

**Everything below was measured** with `@imqueue/http-protect` 3.0.3, Express
5 and Redis 8 on Node.js 24: three gateway instances sharing one Redis, and
clients sending real HTTP requests.

## The short version

- **One counter for every instance.** Three gateways, one client, 300 requests:
  exactly 100 served, then refused. It doesn't matter which instance answers.
- **The counter measures a stream, not a rate.** It is forgotten only after a
  full `ttl` of silence. A client sending a quarter of the nominal rate, but
  never pausing, was still refused.
- **The client's address is the whole security model.** By default it comes
  from `X-Forwarded-For`, which any client can set. A forged header got a
  customer's address banned.
- **Trust the header only from your own proxy**, and write addresses one way:
  Node reports IPv4 clients as `::ffff:a.b.c.d`.
- **Bans are permanent** until you remove them from Redis yourself.
- **Decide what happens when Redis is down.** Out of the box, a request waited
  10.4 s and then failed.

## How it decides

For every request, `HttpProtect` makes one decision in a fixed order:

| step | outcome |
|---|---|
| the client's address can't be determined | `429`, Redis is not touched |
| the address is in `safeNetworks` | served, Redis is not touched |
| the address is on the block list | `418` |
| the counter passes `banLimit` | added to the block list, `418` |
| the counter passes `maxRequests` | `429` |
| otherwise | served |

The counter lives in Redis under `imq:http-protect:<address>`, and the block
list is one Redis set, `imq:http-protect:block-list`. Every instance pointed at
the same Redis reads and writes the same keys. That is the entire trick behind
sharing the limit.

`429 Too Many Requests` is temporary: the client recovers by going quiet.
`418` is the ban.

## Recipe 1: one counter for every instance

The smallest working setup, for an Express gateway:

```typescript
import express from 'express';
import HttpProtect from '@imqueue/http-protect';

const protect = new HttpProtect({
    redisOptions: { host: 'redis.internal', port: 6379 },
    ttl: 10,
    maxRequests: 100,
    banLimit: 250,
});

const app = express();

app.use(protect.jsonMiddleware()); // first, before body parsing
```

Mount it before anything else, so a refused request costs as little as
possible. Every instance gets the same code and the same Redis.

We ran three instances and sent one client's requests to them in turn, 300 in
all:

| requests | answer |
|---|---|
| 1 – 100 | 200 |
| 101 – 250 | 429 |
| 251 – 300 | 418 |

The limits were exact, as if there were one gateway. With an in-memory counter,
each instance would have allowed its own 100.

Don't run this test the way it's written here, with these small numbers, in a
staging environment people share: request 251 banned our client for good.
Recipe 5 explains why.

## Recipe 2: read the counter as a stream, not a window

Most rate limiters count requests per fixed period: "100 requests per minute",
with the count starting again every minute. This one doesn't. Its counter has a
time-to-live of `ttl` seconds, and **every request resets that clock**. The
count is only forgotten after `ttl` seconds in which the address sent nothing.

That makes it a limit on how long a client may keep talking without a pause,
not on how fast it talks. Two measurements show the difference:

| settings | client behaviour | first refused |
|---|---|---|
| `maxRequests: 20`, `ttl: 10` | 2 requests a second | request 21 |
| `maxRequests: 5`, `ttl: 3` | 1 request every 2.5 s | request 6 |

The second client sent about a quarter of what "5 per 3 seconds" sounds like it
allows. It was refused anyway, because a 2.5 s gap never reached the 3 s needed
to reset the counter. In both cases, a pause longer than `ttl` brought the
client straight back.

So choose the numbers as two questions, not one:

- **`ttl`**: how long does a normal user pause? Pick a value shorter than that.
  A user reading a page for 15 seconds resets the counter if `ttl` is 10.
- **`maxRequests`**: how many requests can a normal user send *without* such a
  pause? A page that fires 30 API calls when it opens needs headroom well above
  30.

The defaults are `ttl: 10`, `maxRequests: 200` and `banLimit: 1000`. They can
also be set through `HTTP_PROTECT_TTL`, `HTTP_PROTECT_MAX_REQUESTS` and
`HTTP_PROTECT_BAN_LIMIT`.

## Recipe 3: decide who the client is

Everything above is keyed by one string: the client's address. Where that
string comes from is the most important setting in this post.

By default, `HttpProtect` uses the `request-ip` package, which reads the usual
proxy headers first, `X-Forwarded-For` among them. That is convenient behind a
load balancer, which sets the header. The trouble is that **a client can set it
too**. We tried both things a client can do with it.

**Dodge the limit.** A client that sent a different `X-Forwarded-For` value on
every request got all 1,000 of its requests through, and left 250 separate
counters in Redis.

**Ban somebody else.** This one is worse. A client sent 260 requests with
`X-Forwarded-For: 203.0.113.7`, the address of a real customer. The limiter
counted them against the customer, and request 251 put `203.0.113.7` on the
block list. The customer's next request, arriving properly through the load
balancer, got `418`. The attacker was never blocked at all.

Simply ignoring the header is not the answer either. Behind a load balancer,
the connection always comes from the load balancer, so every client would share
one counter, and the first busy minute would ban the load balancer itself.

The right rule is: **believe the header only when it was added by your own
proxy.** Express does this with its `trust proxy` setting, and `req.ip` then
returns the right address:

```typescript
const app = express();

// the load balancer's address, and nothing else
app.set('trust proxy', ['10.0.0.10']);

const protect = new HttpProtect({
    redisOptions: { host: 'redis.internal', port: 6379 },
    getClientIp: req =>
        req.ip?.replace(/^::ffff:/, '') ?? null,
});
```

Outside Express, the
[`proxy-addr`](https://www.npmjs.com/package/proxy-addr) package does the same
job, and it's what Express uses internally.

We repeated the attack against this setup. The proxy was `127.0.0.1` and the
attacker connected directly from `127.0.0.2`:

| who | what they sent | counted as | result |
|---|---|---|---|
| attacker | 260 requests, forged `203.0.113.7` | `127.0.0.2` | banned itself |
| the customer, through the proxy | 3 requests | `203.0.113.7` | all served |
| another customer, through the proxy | 150 requests | its own address | limited at 101 |

The forged header was simply ignored, because it didn't come from the proxy.

The `replace(/^::ffff:/, '')` in that resolver matters too, and the next recipe
shows why.

## Recipe 4: exempt your own traffic

Health checks, monitoring and your own services shouldn't be rate limited.
`safeNetworks` takes a list of networks that are never counted:

```typescript
const protect = new HttpProtect({
    // ...
    safeNetworks: ['10.0.0.0/8', '192.0.2.15/32'],
});
```

Three things we found while testing it:

**Every entry needs a prefix length.** A single host is `/32` (or `/128` for
IPv6). A bare `192.0.2.15` makes the constructor throw, with the unhelpful
message `The number NaN cannot be converted to a BigInt`.

**Node writes IPv4 addresses two ways.** A Node server listening on its default
address accepts IPv4 and IPv6 together, and reports an IPv4 client as
`::ffff:127.0.0.1`. With the default resolver, `127.0.0.1/32` in `safeNetworks`
**exempted nothing**: our health check was counted and then banned like anyone
else. Listing the `::ffff:` form as well made it work. Stripping the prefix in
`getClientIp`, as in Recipe 3, is the cleaner fix: it gives every client one
address, one counter and one entry on the block list.

**With the default resolver, the exemption is open to anyone.** We listed
`10.0.0.0/8` and sent 1,000 requests claiming `X-Forwarded-For: 10.0.0.5` from
outside. All 1,000 were served, and none was counted. A safe list is only safe
when the address it is checked against can't be chosen by the client. With the
Recipe 3 resolver, the same trick was counted against the attacker's real
address.

Exempt addresses have one more useful property: they never touch Redis, so
they are still served when Redis is down. Your health checks keep passing
during a Redis outage. Whether that is what you want from a health check is
worth deciding on purpose.

## Recipe 5: a ban is permanent

The block list is a Redis set with no expiry, and nothing in the package
removes an entry. We banned a client, waited longer than `ttl`, and tried
again: still `418`, even though its counter had expired.

Lifting a ban is one Redis command:

```bash
redis-cli SREM imq:http-protect:block-list 203.0.113.7
```

The very next request from that address was served.

That makes `banLimit` a decision about when a human should look, not about
traffic shaping. Set it well above anything a real client could reach, and
remember from Recipe 2 that a steady client keeps counting: at the default
`banLimit` of 1,000, a client sending one request a second without a 10-second
pause reaches it in under 17 minutes.

To see what is banned, read the set directly with `SMEMBERS`. The package's own
`isBanned()` check is exact for IPv4 but can report false positives for IPv6
addresses, as its documentation notes.

## Recipe 6: tell clients when to come back

The built-in middlewares send the status code and an error body, and no
`Retry-After` header. A well-behaved client, or your own front end, can only
guess how long to wait.

`verify()` returns the same decision the middleware uses, so adding the header
takes a few lines:

```typescript
import HttpProtect, {
    VerificationStatus,
} from '@imqueue/http-protect';

app.use(async (req, res, next) => {
    const { status, httpCode } = await protect.verify(req);

    if (status === VerificationStatus.SAFE) {
        return next();
    }

    if (httpCode === 429) {
        res.set('Retry-After', String(protect.ttl));
    }

    res.status(httpCode).json({ error: { code: httpCode } });
});
```

The response then carried `Retry-After: 10`. The value is `ttl` because that is
exactly what the client needs: `ttl` seconds of silence. Call `verify()` once
per request: each call counts.

## Recipe 7: decide what happens when Redis is down

We stopped Redis and sent a request:

| setup | answer | after |
|---|---|---|
| default Redis options | `500` | **10.4 s** |
| `enableOfflineQueue: false` | `500` | **0.01 s** |
| that, plus the middleware below, "open" | `200` | 0.01 s |
| that, plus the middleware below, "closed" | `503` | 0.01 s |

By default the Redis client holds the command in memory and retries it 20 times
before giving up. Every request waited ten seconds, which is worse than either
serving it or refusing it. Turning off the offline queue makes the failure
immediate, and the gateway recovered on its own once Redis was back:

```typescript
const protect = new HttpProtect({
    redisOptions: {
        host: 'redis.internal',
        port: 6379,
        enableOfflineQueue: false,
    },
});

app.use(async (req, res, next) => {
    try {
        const { status, httpCode } = await protect.verify(req);

        if (status === VerificationStatus.SAFE) {
            return next();
        }

        res.status(httpCode)
            .json({ error: { code: httpCode } });
    } catch {
        next(); // fail open: serve while the limiter is blind
    }
});
```

Whether to fail open or closed depends on what the limiter protects. For a
public API whose main risk is overload, serving is usually right: losing Redis
shouldn't take the API down with it. For a login endpoint, where the limiter is
what stops password guessing, refusing with `503` is the safer choice.

## What it costs

With Redis on the same machine, the limiter added about **0.12 to 0.16 ms** to
the median request, over three runs of 3,000 requests each.

The number that carries over to production is the round trips. Redis's own
command statistics showed **three commands per request for a new address and
four for a returning one**, sent one after another. With Redis half a
millisecond away on your network, expect roughly 1.5 to 2 ms per request, and
keep Redis close to the gateways.

## What this does not do

- **It limits addresses, not users.** Everyone behind one office or mobile
  network address shares one counter. Limits per user or per API key need the
  user's identity, which comes after authentication.
- **It doesn't stop a flood from reaching your servers.** Every refused request
  still arrives and costs a Redis lookup. Large-scale attacks are stopped in
  front of your servers, by your hosting provider or a CDN.
- **IPv6 makes addresses cheap.** Each address gets its own counter, and a single
  IPv6 network can hold an enormous number of them.
- **For checking callers against long allow lists** rather than counting them,
  see [IP allow lists with CIDR](/blog/ip-allow-lists-cidr-nodejs/), built on the
  same network-matching package as `safeNetworks`.

## FAQ

### How do I rate limit an Express API that runs on several instances?

Keep the counter in a store every instance shares. With `@imqueue/http-protect`,
point every instance at the same Redis and mount `protect.jsonMiddleware()`
first. Three instances and one client gave exactly the configured limit, the
same as a single instance.

### Why did my rate limiter block a client that sends very few requests?

`HttpProtect` counts a continuous stream. The counter is forgotten only after
`ttl` seconds with no request from that address, so a slow client that never
pauses that long keeps counting. Raise `maxRequests`, or lower `ttl` below a
normal user's pauses.

### Can a client fake its IP address to avoid the rate limit?

Yes, if the limiter believes `X-Forwarded-For` from anyone, which is the
default. We sent 1,000 requests with a different header each time and none was
limited. Trust the header only from your own proxy, with Express's `trust proxy`
or the `proxy-addr` package.

### Can someone get another user banned?

Yes, with the same default. Requests with a forged `X-Forwarded-For` naming a
customer's address are counted against that customer, and past `banLimit` the
customer is banned. A resolver that trusts only your proxy counts the attacker's
real address instead.

### How do I unban an IP address?

Remove it from the Redis set:
`redis-cli SREM imq:http-protect:block-list <address>`. Bans never expire on
their own, and the package has no method that lifts one.

### Why is my health check being rate limited?

Probably because Node reports IPv4 clients as `::ffff:a.b.c.d`, which doesn't
match `a.b.c.d/32`. Strip the `::ffff:` prefix in `getClientIp`, or list both
forms in `safeNetworks`.

### What happens to the rate limiter when Redis is down?

With default options, each request waits about ten seconds and then fails.
Set `enableOfflineQueue: false` in `redisOptions` to fail at once, then catch
the error and either serve the request or answer `503`.

## Reference

[`HttpProtect`](/api/http-protect/latest/http-protect.httpprotect/) ·
[`HttpProtectOptions`](/api/http-protect/latest/http-protect.httpprotectoptions/) ·
[`HttpProtectOptions.getClientIp`](/api/http-protect/latest/http-protect.httpprotectoptions.getclientip/) ·
[`HttpProtectOptions.safeNetworks`](/api/http-protect/latest/http-protect.httpprotectoptions.safenetworks/) ·
[`HttpProtectOptions.ttl`](/api/http-protect/latest/http-protect.httpprotectoptions.ttl/) ·
[`HttpProtectOptions.maxRequests`](/api/http-protect/latest/http-protect.httpprotectoptions.maxrequests/) ·
[`HttpProtectOptions.banLimit`](/api/http-protect/latest/http-protect.httpprotectoptions.banlimit/) ·
[`HttpProtectOptions.redisOptions`](/api/http-protect/latest/http-protect.httpprotectoptions.redisoptions/) ·
[`HttpProtect.verify()`](/api/http-protect/latest/http-protect.httpprotect.verify/) ·
[`HttpProtect.jsonMiddleware()`](/api/http-protect/latest/http-protect.httpprotect.jsonmiddleware/) ·
[`VerificationStatus`](/api/http-protect/latest/http-protect.verificationstatus/) ·
[IP allow lists with CIDR](/blog/ip-allow-lists-cidr-nodejs/)
