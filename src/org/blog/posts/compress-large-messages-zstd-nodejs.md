---
layout: post.html
permalink: /blog/compress-large-messages-zstd-nodejs/
templateEngineOverride: md
title: "Compressing messages between Node.js services: zstd for the big ones, plain JSON for the rest"
summary: "Most messages between your services are a few hundred bytes. A handful are reports, exports or month-long lists that weigh megabytes, and they are the ones that fill Redis when a consumer falls behind. @imqueue can compress just those with zstd. Here is what it saves, what it costs, where the size threshold belongs, and the rollout order that matters: a consumer that can't read zstd drops those messages for good. Every number is measured."
description: "A measured recipe for compressing large queue messages with zstd in @imqueue: compressAbove and IMQ_COMPRESS_ABOVE, bytes on the wire and Redis memory for each size, the break-even point, zstd versus gzip, rolling it out readers first, compressing RPC replies, and inspecting a compressed message."
keywords: "compress messages redis queue, zstd nodejs, nodejs zstd compression, zstd vs gzip json, reduce redis memory message queue, large messages message queue, compress rpc response nodejs, imqueue compressabove, IMQ_COMPRESS_ABOVE"
date: 2026-11-13
author: yauheniya-habrykava
illustration: zstd-threshold
topics: [queue, performance, transport]
ogType: article
---

Look at the messages your services send each other and most of them are tiny:
an order ID, a status, a user. A few hundred bytes each. Then there are the
others. The monthly report. The CSV export. The list of every order a customer
ever placed. One of those can weigh more than ten thousand of the small ones.

Those big messages are what fill Redis when a consumer stops for a while, and
what push a broker towards its memory limit. Compressing everything would help
them, but it would also make every small message slower and, as we'll see,
bigger.

`@imqueue/core` can compress only the big ones. A queue with
[`compressAbove`](/api/core/latest/core.imqoptions.compressabove/) set writes
any message longer than that many characters with zstd, a fast modern
compression format, and leaves the rest as plain JSON. This post shows what that
saves, what it costs, where to put the threshold, and the one rollout mistake
that loses messages.

**Everything below was measured** with `@imqueue/core` 3.6.0, `@imqueue/rpc`
3.11.0 and Redis 8 on Node.js 24, using realistic order-list messages from 130
characters to 4 MB.

## The short version

- **Set `compressAbove: 1024`**, or `IMQ_COMPRESS_ABOVE=1024` in the
  environment. Messages up to 1 KB stay plain JSON; larger ones are zstd.
- **Large messages shrank to about a quarter** of their size on our data, and a
  backlog of 10,000 messages took 30 MB of Redis instead of 98 MB.
- **Very small messages get bigger** when compressed. The break-even point was
  around 300 to 450 characters, which is why a threshold exists.
- **zstd beat `useGzip` at every size**, and cost about half as much time.
- **Upgrade every consumer first.** A consumer that can't read zstd drops those
  messages permanently, even with safe delivery on.
- **RPC replies are covered too.** Setting the variable on a service compressed
  its large responses without any change to its callers.

## Turning it on

In code, on the options every queue, service and client already takes:

```typescript
import { IMQService } from '@imqueue/rpc';

const service = new Reports({
    compressAbove: 1024, // characters of JSON
});
```

Or, with no code change at all, for every queue in the process:

```bash
IMQ_COMPRESS_ABOVE=1024 node dist/index.js
```

The rule is simple. Each message is turned into JSON as usual. If that JSON is
longer than `compressAbove` characters, it is compressed with zstd at its
fastest setting and written as text behind a one-letter marker. Otherwise it is
written exactly as before. The default is `0`, which never compresses.

zstd is built into Node.js from version 22.15. On an older Node,
`compressAbove` does nothing and messages stay plain JSON.

## What it saves

The bytes Redis actually stored for one message, by size:

| message JSON | plain | `useGzip` | zstd | zstd vs plain |
|---|---|---|---|---|
| 130 characters | 212 B | 269 B | 249 B | **117%** |
| 1.2 KB | 1.3 KB | 753 B | 661 B | 52% |
| 10 KB | 10.1 KB | 3.6 KB | 3.1 KB | 31% |
| 100 KB | 100 KB | 31.6 KB | 26.3 KB | 26% |
| 1 MB | 1.0 MB | 308 KB | 258 KB | 26% |
| 4 MB | 4.0 MB | 1.23 MB | 1.03 MB | 26% |

Two things stand out. Above a few kilobytes, zstd consistently cut messages to
about a quarter. And it beat gzip at every size, partly because gzip's output
gets larger again when the queue stores it as text.

How much you save depends on your data. Ours had a random ID and a random price
in every record, which compress poorly. Data with more repetition does far
better: the release notes for this feature report a 4.6 MB service description
shrinking to 293 KB, about one sixteenth.

The saving that matters most in practice is memory while messages wait. We
queued 10,000 messages of about 10 KB with no consumer running:

| setting | Redis memory for the backlog |
|---|---|
| plain JSON | 98 MB |
| `useGzip` | 37 MB |
| `compressAbove: 1024` | **30 MB** |

That is the difference between a consumer outage that fits in your Redis and
one that reaches `maxmemory`. What happens at that limit is covered in
[what survives a Redis restart](/blog/redis-restart-persistence-eviction/).

## Where to put the threshold

Compression has a fixed cost: the format's own header, and the conversion to
text, which adds about a third. For a small message that overhead outweighs the
saving. We measured where the line falls:

| message JSON | plain | zstd |
|---|---|---|
| 212 characters | 289 B | 321 B (111%) |
| 448 characters | 525 B | 405 B (77%) |
| 737 characters | 814 B | 505 B (62%) |
| 940 characters | 1017 B | 577 B (57%) |

So compression starts paying somewhere between 300 and 450 characters, and is
clearly worth it from about 1 KB. Note that the length counted is the whole
message the queue writes, including about 80 characters the framework adds
around your data.

`1024` is a sensible starting point. Everything at or below it stays plain
JSON, which keeps the common small messages fast and readable in `redis-cli`.
Lower it if your typical message sits just above a kilobyte; there is no reason
to go below about 500.

## What it costs

Compression takes CPU time on the sender, and decompression takes it on the
receiver. We timed one message from `send()` to the consumer's handler, both on
the same machine as Redis:

| message JSON | plain | `useGzip` | zstd |
|---|---|---|---|
| 10 KB | 0.09 ms | 0.19 ms | 0.12 ms |
| 100 KB | 0.89 ms | 2.01 ms | 0.95 ms |
| 1 MB | 7.2 ms | 15.2 ms | 8.0 ms |
| 4 MB | 25 ms | 55 ms | 29 ms |

zstd added about 10 to 15 percent. gzip roughly doubled the time.

This is a test where the network costs nothing, so it shows only the expense.
Between real machines, sending a quarter of the bytes also takes less time on
the wire, and the memory saving above doesn't depend on the network at all.

## Roll it out readers first

This is the part not to get wrong.

Since 3.6.0, every queue reads all three formats, plain JSON, gzip and zstd,
whatever its own settings are. Older consumers don't. We sent ten messages from
a writer with `compressAbove: 1024` to consumers of each version, with safe
delivery on:

| consumer | small messages (plain) | large messages (zstd) |
|---|---|---|
| core 3.6.0 | 5 of 5 | 5 of 5 |
| core 3.5.4 | 5 of 5 | **0 of 5, deleted** |

The older consumer read the small messages normally, failed on the large ones
with `Unexpected token 'Z'`, and dropped them. Nothing was left in the queue.
Safe delivery doesn't help, because the message did arrive; it just couldn't be
read.

That makes this failure easy to miss. A quick test with small messages passes,
and only the big ones vanish. So the order is:

1. **Upgrade every consumer** of the queue so it runs `@imqueue/core` 3.6.0 or
   later, on Node 22.15 or later.
2. **Check what is installed, not what is declared.** `@imqueue/rpc` 3.11 and
   `@imqueue/job` 3.3 accept older core versions, so a service can upgrade rpc
   and still run core 3.5.4 from its lockfile. Run this in each one:

   ```bash
   npm ls @imqueue/core
   ```

3. **Then turn compression on**, one producer at a time if you like. Producers
   and consumers don't have to agree on any setting.

## RPC replies are compressed too

An RPC call is a message to the service and a reply back, and both are queue
messages. We gave a service `IMQ_COMPRESS_ABOVE=1024` and nothing else, and
called a method that returns about 1 MB of orders:

| service setting | bytes written to Redis for the call |
|---|---|
| none | 980 KB |
| `IMQ_COMPRESS_ABOVE=1024` | 256 KB |

The caller had no setting and read the reply normally, because every reader
handles every format. This is usually where compression pays most: services that
return reports, exports or long lists. The calls themselves are compressed only
when the calling process has the setting too.

## Replacing useGzip

`useGzip` is the older way to compress, and it had two drawbacks: it compressed
every message, small ones included, and every consumer had to have the same
setting. A consumer without it couldn't read gzipped messages at all: in our
test, one older consumer without `useGzip` lost all ten messages a gzipping
writer sent it.

With every consumer on 3.6.0, neither drawback remains. To move over, remove
`useGzip` and set `compressAbove`. Do it in that order: where both are set,
`useGzip` wins. Messages already queued in gzip are still read normally.

## Looking inside a compressed message

A zstd message in Redis starts with the letter `Z`, followed by the compressed
data as base64 text. To read one while debugging, copy it out and decode it:

```bash
redis-cli LINDEX imq:Reports 0 > msg.txt

node -e "
const z = require('node:zlib');
const fs = require('node:fs');
const s = fs.readFileSync('msg.txt', 'utf8').trim();
const bytes = Buffer.from(s.slice(1), 'base64'); // drop the Z
const raw = z.zstdDecompressSync(bytes);
console.log(JSON.stringify(JSON.parse(raw), null, 2));
"
```

What you get back is the framework's envelope: an `id`, the sender in `from`,
and your data under `message`. Messages below the threshold are plain JSON and
readable as they are, which is another reason not to set it too low.

## What this does not do

- **It doesn't compress pub/sub.** Events sent with `publish()` are always plain
  JSON. The same is true of `useGzip`.
- **It doesn't encrypt anything.** Compressed is not secret. For that, see
  [TLS for the broker](/blog/tls-redis-broker-nodejs/).
- **It doesn't make huge messages a good idea.** A 4 MB message still takes 29 ms
  to move, and still occupies a worker while it's handled. For really large
  data, store it elsewhere and send a reference.

## FAQ

### How do I compress messages in an @imqueue service?

Set `compressAbove` to a number of characters, for example `1024`, on the
queue, service or client options, or set `IMQ_COMPRESS_ABOVE=1024` in the
environment. Messages whose JSON is longer than that are written with zstd, and
smaller ones stay plain JSON.

### Is zstd better than gzip for JSON messages?

In our measurements, yes: smaller at every size we tried, from 1 KB to 4 MB,
and about half the time per message. A 1 MB message was 258 KB with zstd and 308
KB with gzip.

### Should I compress small messages?

No. Below roughly 300 to 450 characters, a compressed message is larger than
the original. A 130-character message grew to 117% of its plain size. A
threshold of about 1 KB keeps small messages plain.

### How much Redis memory does compression save?

It depends on the data. On our order lists, 10,000 queued messages of about 10
KB took 98 MB plain and 30 MB compressed. Data with more repetition compresses
further.

### Why did messages disappear after I turned on compression?

Most likely a consumer was still running `@imqueue/core` older than 3.6.0. It
can't read zstd, so it fails on every compressed message and drops it, even
with safe delivery. Small messages still arrive, which hides the problem. Check
with `npm ls @imqueue/core` in every consumer.

### Do producers and consumers need the same compression setting?

Not since 3.6.0. Every queue reads plain JSON, gzip and zstd regardless of its
own setting, so you can turn compression on one producer at a time.

### Which Node.js version is needed for zstd?

Node.js 22.15 or later. On older versions `compressAbove` has no effect and
messages are written as plain JSON.

## Reference

[`IMQOptions.compressAbove`](/api/core/latest/core.imqoptions.compressabove/) ·
[`IMQOptions.useGzip`](/api/core/latest/core.imqoptions.usegzip/) ·
[`IMQOptions.safeDelivery`](/api/core/latest/core.imqoptions.safedelivery/) ·
[`IMQOptions`](/api/core/latest/core.imqoptions/) ·
[`RedisQueue.send()`](/api/core/latest/core.redisqueue.send/) ·
[What survives a Redis restart](/blog/redis-restart-persistence-eviction/) ·
[Talking to your Redis broker over TLS](/blog/tls-redis-broker-nodejs/)
