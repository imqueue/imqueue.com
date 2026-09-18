---
layout: post.html
permalink: /blog/redis-acl-least-privilege-nodejs/
templateEngineOverride: md
title: "Least privilege for your Redis broker: the ACL a Node.js service fleet actually needs"
summary: "TLS decides who can listen to your broker. It says nothing about what a connected process may do after it is in — and on a Redis left at its defaults the answer is everything, including FLUSHALL. Here is the exact rule set an @imqueue fleet needs, the permissions that look optional and quietly are not, and how to rotate the password without a restart storm. Every behaviour is measured."
description: "A measured recipe for Redis ACLs under a Node.js service fleet on @imqueue: the exact commands, key patterns and Pub/Sub channels a queue process uses, a copy-paste ACL SETUSER rule set, what each missing permission breaks, isolating two fleets on one Redis by prefix, zero-downtime password rotation, and watching ACL LOG."
keywords: "redis acl nodejs, redis acl least privilege, redis acl setuser example, redis per-service credentials, redis acl pubsub channel pattern, redis acl log noperm, ioredis username password acl, rotate redis password without downtime, redis acl key prefix isolation, imqueue redis acl"
date: 2026-09-18
author: mykhailo-stadnyk
illustration: broker-acl
topics: [security, queue, resilience]
ogType: article
---

Open a terminal on any machine that can reach your broker and type one word:

```bash
redis-cli -h broker.internal FLUSHALL
```

If Redis answers `OK`, every queue in the fleet is now empty. Every request in
flight, every delayed message, every job waiting for tonight. Nobody had to
steal a password, because there was none to steal: a Redis with no access rules
has a single user called `default`, that user has no password, and it may run
every command on every key.

[Encrypting the connection](/blog/tls-redis-broker-nodejs/) does not change
that. TLS decides who can *listen*. It says nothing about what a process may
*do* after it has connected, and the process that gets compromised is rarely a
stranger on the wire. It is one of your own services, with a valid certificate,
holding an open connection to the broker all day.

Redis has had the answer since version 6: access control lists. An ACL user has
a password, a list of commands it may run, a list of key patterns it may touch
and a list of Pub/Sub channels it may use. Everything else is refused.

The hard part is not the syntax. It is knowing what your queue actually needs,
because a rule set that is too tight does not always fail loudly. This post
gives you the exact rule set for an `@imqueue` fleet, shows what each missing
permission costs, and covers the three things teams ask next: how to share one
Redis between two fleets, how to rotate the password, and how to see a refusal
when it happens. Everything here was measured on `@imqueue/core` 3.5.3,
`@imqueue/rpc` 3.9.4 and `@imqueue/job` 3.3.4 against Redis 8.0.5.

> **TL;DR** — Give the fleet its own Redis user and switch `default` off. A
> queue process needs 27 commands, the key pattern `~imq:*` and three channel
> patterns; the full rule set is in Recipe 1, ready to paste. Three permissions
> look cosmetic and are load-bearing: `client|setname` (without it one in-flight
> message was started **9 times in 9 seconds**), the literal channel pattern
> `&imq:delayed:*` (without it a 400 ms delay took **4.7 s**), and
> `client|list` (without it a service does not start). Do not derive the rules
> from a day of traffic: `LMOVE` and `EXISTS` only run after a crash. The key
> prefix is the isolation boundary, one user per prefix. A Redis user can hold
> two passwords at the same time, which is how you rotate without downtime.

## What a queue process asks Redis to do

Before writing rules, look at what is being ruled. One `@imqueue` queue holds up
to four connections to the broker, and each has one job:

| Connection | What it does | Commands |
|---|---|---|
| reader | waits for the next message | `BRPOP`, or `BLMOVE` with safe delivery |
| writer | sends, and runs the housekeeping | `LPUSH`, `ZADD`, `SET`, `LLEN`, `DEL`, `PUBLISH`, `EVALSHA` and the rest |
| watcher | hears timers expire, one per prefix | `PSUBSCRIBE` |
| subscription | receives published events | `SUBSCRIBE`, `UNSUBSCRIBE` |

Every connection names itself when it opens, for example
`imq:Order:reader:pid:4312:host:api-7`. Keep that detail in mind. It looks like a
debugging convenience and it turns out to be the most important line in this
post.

The keys are just as regular. With the default prefix `imq`:

| Key | What it holds |
|---|---|
| `imq:Order` | the queue itself, a Redis list |
| `imq:Order:delayed` | delayed messages, a sorted set scored by due time |
| `imq:Order:<id>:ttl` | a timer key whose expiry releases one delayed message |
| `imq:Order:worker:<uuid>:pid:…` | a message a worker is processing right now (safe delivery) |
| `imq:OrderClient-<id>-0:client` | the reply queue of one generated client |
| `imq:watch:lock` | which process owns the watcher |

Events travel on the channel `imq:<name>`. `@imqueue/job` uses the same shapes
under its own prefix, `imq-job`, and the method cache stores its entries under
`imq-cache`.

You can check all of this on your own broker in a minute. Run
`CONFIG RESETSTAT` as an admin, exercise the fleet, then read
`INFO commandstats`. Unlike `MONITOR`, which hides administrative commands, the
statistics list every command that was called, including `client|list` and
`config|get`, together with how many calls were rejected.

## Recipe 1: create the user

Here is the whole rule set. It covers plain and delayed messages, safe delivery,
publish and subscribe, RPC services and their clients, and job queues.

```bash
redis-cli ACL SETUSER imq-service on '>a-long-random-secret' \
  '~imq:*' '~imq-job:*' \
  '&imq:*' '&imq:delayed:*' '&imq-job:*' '&imq-job:delayed:*' \
  '&__keyevent@0__:expired' \
  '+lpush' '+brpop' '+blmove' '+lmove' '+llen' '+del' \
  '+exists' '+set' '+setnx' \
  '+zadd' '+zrangebyscore' '+zremrangebyscore' \
  '+evalsha' '+eval' '+script|exists' '+script|load' \
  '+publish' '+subscribe' '+unsubscribe' '+psubscribe' \
  '+scan' '+client|setname' '+client|setinfo' '+client|list' \
  '+config|get' '+info' '+quit'
```

Read it as four groups: who (`on`, the password), which keys (`~`), which
channels (`&`), which commands (`+`). A new user starts with nothing, so this
list is everything the user can do.

Three notes before you paste it.

**Quote every rule.** `&` and `|` are shell operators. Leave one unquoted and
the shell cuts the command at that point, sends Redis the first half, and Redis
answers `OK` to the half it received. You end up with a user that looks created
and is missing most of its permissions. Check the result with
`ACL GETUSER imq-service`.

**Set the keyspace events yourself.** Delayed messages are released by a timer
key expiring, and Redis only announces expiries when
`notify-keyspace-events` contains `Ex`. A queue running as an unrestricted user
switches that on by itself. A least-privilege user should not hold `CONFIG SET`,
which can also repoint where Redis writes its files. So put this in
`redis.conf`, and grant only the read side, `config|get`, so the queue can see
the setting is already there:

```text
notify-keyspace-events Ex
aclfile /etc/redis/users.acl
```

On a managed Redis that does not offer `CONFIG` at all, set the same parameter
in the provider's settings.

**Make it permanent, then close the front door.** `ACL SETUSER` changes the
running server only. With an `aclfile` configured, `ACL SAVE` writes the users
to it, and the file is what you distribute to every broker. Then create an
admin user for humans and switch the open one off:

```bash
redis-cli ACL SETUSER ops on '>another-long-secret' \
  allkeys allchannels '+@all'
redis-cli ACL SETUSER default off
```

From here an unauthenticated connection gets `NOAUTH Authentication required.`
and the fleet keeps working under its own name. Measured: with `default` off,
the full scenario ran clean as `imq-service`.

## Recipe 2: hand the credentials to the fleet

Every `@imqueue` option bag takes `username` and `password`. They are passed to
the Redis client as they are, and they apply to all four connections. There is
no environment variable the framework reads for them, so read your own and pass
them in.

A service:

```typescript
import { IMQService, expose } from '@imqueue/rpc';

const broker = {
    host: process.env.REDIS_HOST,
    port: Number(process.env.REDIS_PORT),
    username: process.env.REDIS_USER, // imq-service
    password: process.env.REDIS_PASSWORD, // from a secret store
};

class Order extends IMQService {
    /**
     * Places an order for one item.
     *
     * @param {string} sku - what to order
     * @return {Promise<string>} - the new order id
     */
    @expose()
    public async place(sku: string): Promise<string> {
        return `order-for-${sku}`;
    }
}

await new Order(broker).start();
```

Its generated client takes the same object:

```typescript
const orders = new OrderClient(broker);

await orders.start();
await orders.place('sku-1'); // 'order-for-sku-1'
```

A job queue takes the credentials at the top level and the broker address in
`cluster`:

```typescript
import JobQueue from '@imqueue/job';

const emails = new JobQueue({
    name: 'Emails',
    cluster: [{ host: broker.host, port: broker.port }],
    username: broker.username,
    password: broker.password,
});
```

The method cache is the one place where a *second*, smaller user pays off. It
only reads, writes and deletes its own entries, so it needs three commands and
one key pattern:

```bash
redis-cli ACL SETUSER imq-cache on '>cache-secret' \
  resetchannels '~imq-cache:*' '+get' '+set' '+del' \
  '+client|setname' '+client|setinfo' '+info' '+quit'
```

```typescript
import { RedisCache } from '@imqueue/rpc';

await new RedisCache().init({
    host: broker.host,
    port: broker.port,
    username: 'imq-cache',
    password: process.env.REDIS_CACHE_PASSWORD,
});
```

Measured: `set`, `get` and `del` work, and an `LPUSH imq:Order` attempted over
that connection is refused. A cache that reuses the service's own connection
through the `conn` option runs as the service user instead, so that user would
then need `~imq-cache:*` and `+get`.

Two rules about identity are worth knowing before you deploy.

**On a clustered queue, the top-level credentials go to every broker.** A
`username` or `password` written on an individual `cluster` entry is ignored.
Measured with two brokers and decoy credentials on the second entry: both
brokers saw the top-level user authenticate, and messages were spread across
both. So every broker in the fleet must carry the same user with the same
password, which is one more reason to distribute a single `users.acl` file. A
broker that does not accept the credentials makes `start()` reject.

**One process has one identity per broker address.** Queues in the same process
share their writer and watcher connections when they point at the same Redis, and
the first queue created decides which user those connections log in as. Do not
try to run two Redis users against one broker from one process.

## Recipe 3: three permissions that look optional and are not

This is the part that does not show up in a quick test. Each row below is the
full rule set with one thing removed.

| Remove | What the application log says | What actually happens |
|---|---|---|
| `+client\|setname` | nothing | one message with a 4 s handler was **started 9 times in 9 s** |
| `&imq:delayed:*` | nothing | a 400 ms delay was delivered after **4.7 s** instead of 0.48 s |
| `+client\|list` | `error initializing watcher … NOPERM` | `start()` rejects, the process does not come up |
| `+config\|get` | one `events config error` line at start | nothing else, provided `Ex` is set in `redis.conf` |
| `+scan` | `safe queue message delivery problem` on every sweep | messages of a crashed worker are never returned |
| scripting (`+evalsha`, `+eval`) | `error processing delayed queue` on every tick | delayed messages are **never** delivered |
| `+info` | the Redis client prints `Skipping the ready check…` per connection | works, with noise |

The bottom of the table is loud, and loud is fine: you see it on the first
deploy. The top two rows are the dangerous ones, because nothing is logged
anywhere in the application.

### The connection name is how the fleet knows a worker is alive

With [safe delivery](/blog/guaranteed-message-delivery-cost/), a worker moves a
message into its own `worker` key while it processes it. A periodic sweep looks
for keys whose worker is gone and puts those messages back on the queue. "Gone"
is decided by reading `CLIENT LIST` and looking for the worker's connection
name.

Take `client|setname` away and every connection is anonymous. Redis refuses the
naming call, the client library carries on without it, and the queue works. But
the sweep now sees no workers at all, so every message being processed looks
abandoned and is handed out again. Measured with a one-second sweep: one
message, one worker, a handler that takes four seconds, **nine starts in nine
seconds**. At the default five-second sweep, a twelve-second handler was started
three times. With the permission in place, both runs started the handler exactly
once.

The only trace is one line from the sweep,
`re-queued 1 messages of expired leases to queue Order`, which reads like
healthy crash recovery. If you adopt one thing from this post, make it this:
`client|setname` and `client|list` are part of the delivery guarantee.

### Pattern subscriptions are matched literally

The watcher subscribes to two patterns, `__keyevent@0__:expired` and
`imq:delayed:*`. You would expect `&imq:*` to cover the second one. It does
not. Redis checks a `PSUBSCRIBE` pattern against your allowed patterns as plain
text, not as a glob, so `imq:delayed:*` must be listed word for word. And
because both patterns travel in one command, refusing one refuses both.

The queue does not stop. It falls back to its periodic check, which runs every
`watcherCheckDelay`, five seconds by default. So a message delayed by 400 ms
arrived after **4.70 s** in three runs out of three, against **0.47 to 0.48 s**
with the pattern allowed. No error, no warning, only a retry schedule that
quietly became seconds slower than you configured.

If you change the queue `prefix`, change these patterns with it:
`&<prefix>:*` and `&<prefix>:delayed:*`.

### Commands inside scripts are checked too

Delayed messages are moved by a small Lua script, and Redis applies your rules
to every command the script runs. Allowing `evalsha` is not enough. Without
`zrangebyscore` the script fails with `ERR ACL failure in script`, and delayed
messages stay where they are. That is why `zrangebyscore`, `zremrangebyscore`
and `lpush` are all in the list even though your code never calls the first two.

## Recipe 4: the commands that only run on a bad day

A tempting way to build an ACL is to watch production for a day and allow what
you saw. It produces a rule set that works until the first crash, because some
commands only run when something has gone wrong:

- `LMOVE` returns a dead worker's message to the queue.
- `EXISTS` is the first step when a surviving process takes over the watcher
  from an owner that died.
- `EVAL` and `SCRIPT LOAD` put the Lua script back after a Redis restart has
  emptied the script cache. On a warm server neither is ever called.

Measured with `kill -9` on a worker in the middle of a message. Under the full
rule set, a second worker received the message, and `LMOVE` and `EXISTS` each
ran once. Those were their only calls in the whole test.

Without `+lmove`, the second worker started normally and logged
`safe queue message delivery problem … 'lmove'` on every sweep. The message was
never delivered: 13 refusals in 14 seconds. Without `+exists` it was worse. The
replacement worker *could not start*, because taking over the watcher from a
dead owner begins with that command. A fleet that started fine on Monday would
fail to restart after its first crash.

The script pair behaves the same way. Measured after `SCRIPT FLUSH`, which is
what a restarted Redis looks like to the queue: with both allowed, `EVAL` ran
once, cached the script again, and nothing was refused. With neither, delayed
messages were never delivered again.

So take the rule set from Recipe 1 rather than from observation. Then prove it
in staging the way it will be tested in production: kill a worker mid-message,
restart the broker, and read the refusal log (Recipe 7) afterwards. It should be
empty.

## Recipe 5: two fleets on one Redis

Inside one prefix there is no finer boundary to draw. A service replies to
whichever client called it, so it must be able to write to any reply queue. And
the watcher serves every queue under the prefix, while any process may become
its owner. Every process therefore needs the whole prefix: one fleet, one
prefix, one user.

*Between* fleets the boundary is real. Give each fleet its own `prefix` and a
user limited to it:

```typescript
const broker = {
    host: process.env.REDIS_HOST,
    port: Number(process.env.REDIS_PORT),
    prefix: 'billing',
    username: 'billing',
    password: process.env.REDIS_PASSWORD,
};
```

```bash
redis-cli ACL SETUSER billing on '>billing-secret' \
  '~billing:*' '&billing:*' '&billing:delayed:*' \
  '&__keyevent@0__:expired' \
  '+lpush' '+brpop' '+blmove' '+lmove' '+llen' '+del' \
  '+exists' '+set' '+setnx' \
  '+zadd' '+zrangebyscore' '+zremrangebyscore' \
  '+evalsha' '+eval' '+script|exists' '+script|load' \
  '+publish' '+subscribe' '+unsubscribe' '+psubscribe' \
  '+scan' '+client|setname' '+client|setinfo' '+client|list' \
  '+config|get' '+info' '+quit'
```

Measured with two fleets, `billing` and `shop`, each in its own process. Both
ran normally, delayed messages included. Then the `shop` credentials reached for
the other side by hand:

| Attempt as `shop` | Result |
|---|---|
| `LPUSH billing:Ledger` | `NOPERM No permissions to access a key` |
| `LLEN billing:Ledger` | `NOPERM No permissions to access a key` |
| `SUBSCRIBE billing:Ledger` | `NOPERM No permissions to access a channel` |
| `KEYS *` | `NOPERM … 'keys' command` |
| `FLUSHALL` | `NOPERM … 'flushall' command` |
| `CONFIG SET dir /tmp` | `NOPERM … 'config\|set' command` |
| `SCAN 0 MATCH billing:*` | **returns `billing:Ledger`** |

The last row is the honest one. Key patterns protect the *contents* of keys, not
their names: `SCAN` takes no key argument, so it lists names across the whole
database. `CLIENT LIST` likewise shows every connection on the server, with its
name, address and user. A fleet sharing a Redis can learn that another fleet
exists and what its queues are called. It cannot read or write a byte of them.

There is one more shared thing: expiry events are announced server-wide. Each
fleet's watcher hears the other fleet's timers, tries the matching delayed
queue, is refused, and logs one `error processing delayed queue … NOPERM` line
per event. Nothing is lost, since each fleet still releases its own messages,
but the noise grows with the other fleet's delayed traffic. If that matters,
give the fleets separate Redis instances.

A process that must talk to both fleets can do it with a single user that holds
both prefixes (`'~shop:*' '~billing:*'` and the matching channel patterns).
Measured: one process, one such user, a queue under each prefix, delayed
messages on both, and an empty refusal log.

## Recipe 6: rotate the password without a restart storm

A Redis user can hold several passwords at the same time, which turns rotation
into three calm steps:

```bash
# 1. add the new password next to the old one
redis-cli ACL SETUSER imq-service '>new-secret'

# 2. roll the fleet onto the new password, at your normal pace

# 3. only then remove the old one
redis-cli ACL SETUSER imq-service '<old-secret'
```

Measured against a running worker. After step 1 it kept delivering. After step 3
it *still* kept delivering, because removing a password does not disconnect
sessions that are already authenticated. That is the trap, not the comfort: a
process you forgot to roll looks healthy for days. Then its connection drops,
for any reason, and it cannot come back. The log shows the reason on every
attempt:

```text
Order: error connecting redis host 10.0.0.5:6379 on reader,
  pid 4312: WRONGPASS invalid username-password pair or user
  is disabled.
[IMQ-CORE][Order]: reconnect of the reader channel failed,
  code CONNECTION_CLOSED
```

Its messages are not lost. They wait in the queue for a process that can log in.
But confirm step 2 before step 3: `CLIENT LIST` shows every connection with its
name, its user and its age in seconds, so a process that has been connected
since before the rollout stands out. On a fresh start a wrong password is loud:
`start()` rejects with `Connection is closed.`, and the `WRONGPASS` line above
it says why.

Remember to write the change to the `aclfile` on every broker. A broker that
restarts with last month's file will refuse the whole fleet.

## Recipe 7: watch the refusals

Redis keeps a log of everything it refused, and it is the best tool in this
post:

```bash
redis-cli --user ops --askpass ACL LOG
```

Each entry says what was refused (`command`, `key` or `channel`), the exact
object, the user, whether it happened inside a script, and the full client line,
which includes the connection name. Since `@imqueue` names its connections,
`name=imq:Order:watcher:pid:4312:host:api-7` tells you which service, which
connection and which process ran into the wall. `INFO commandstats` gives you
the same as counters: `rejected_calls` per command, easy to alert on.

The check worth automating is small. Run your integration suite as the
restricted user, then assert that the log is empty:

```typescript
import Redis from 'ioredis';
import assert from 'node:assert/strict';

const admin = new Redis({
    host,
    port,
    username: 'ops',
    password: opsPassword,
});

await admin.call('ACL', 'LOG', 'RESET');

// call, delay, publish, kill a worker: all as the fleet user
await runTheSuiteAsTheFleetUser();

assert.deepEqual(await admin.call('ACL', 'LOG'), []);
```

An empty log comes back as `[]`. This is how every rule in Recipe 1 was checked.
The whole scenario, an RPC service with its client, a job queue, a slow handler
and a killed worker all ran under that rule set with nothing refused.

## What an ACL does not do

It does not encrypt anything. Without [TLS](/blog/tls-redis-broker-nodejs/) the
password itself crosses the network as text. Use both: TLS for the wire, ACLs
for what happens after the handshake.

It does not separate the services *inside* a fleet. Any process holding the
fleet's credentials can read any queue under the prefix, push a message to any
service, or delete a queue, because those are the operations the queue is made
of. An ACL removes the catastrophic commands and fences the fleet in. It does
not make a compromised service harmless to its neighbours. If two groups of
services must not see each other's payloads, they are two fleets: two prefixes,
two users, or two Redis instances.

And it does not manage secrets for you. One password per fleet is shared by
every process in it, so treat it like any other shared credential: keep it in a
secret store, inject it at start, and rotate it on a schedule with Recipe 6.

## FAQ

### Which Redis commands does a Node.js message queue need in an ACL?

For `@imqueue`: `LPUSH`, `BRPOP`, `BLMOVE`, `LMOVE`, `LLEN`, `DEL`, `EXISTS`,
`ZADD`, `ZRANGEBYSCORE`, `ZREMRANGEBYSCORE`, `SET`, `SETNX`, `EVALSHA`, `EVAL`,
`SCRIPT EXISTS`, `SCRIPT LOAD`, `PUBLISH`, `SUBSCRIBE`, `UNSUBSCRIBE`,
`PSUBSCRIBE`, `SCAN`, `CLIENT SETNAME`, `CLIENT SETINFO`, `CLIENT LIST`,
`CONFIG GET`, `INFO` and `QUIT`. That is 27 commands, on the key pattern
`~imq:*`, plus `~imq-job:*` if you run job queues.

### Why does my queue deliver the same message again and again after I added an ACL?

Almost certainly `client|setname` is missing. Safe delivery decides whether a
worker is alive by finding its connection name in `CLIENT LIST`. An anonymous
connection looks like a dead worker, so its in-flight message is re-queued on
every sweep. Measured: nine starts of one message in nine seconds. Allow
`+client|setname` and `+client|list`.

### Why are delayed messages late under a restricted Redis user?

Redis matches `PSUBSCRIBE` patterns against your allowed channel patterns
literally. `&imq:*` does not cover the pattern `imq:delayed:*`, so list it word
for word, together with `&__keyevent@0__:expired`. Without them the queue falls
back to its periodic check: 4.7 s for a 400 ms delay at the default settings.

### Can each service have its own Redis user?

Not inside one prefix. Services reply to any caller's queue, and whichever
process owns the watcher serves every queue under the prefix, so every process
needs all of `~imq:*`. The isolation boundary is the prefix: one prefix and one
user per fleet. The method cache is the exception and can run as its own
three-command user on `~imq-cache:*`.

### Does @imqueue need CONFIG SET?

No. It uses `CONFIG SET` only to switch on expiry notifications when they are
off. Set `notify-keyspace-events Ex` in `redis.conf`, or in your provider's
parameters, and grant `config|get` alone. The queue sees the flag is present and
changes nothing.

### How do I rotate a Redis password without downtime?

Add the new password with `ACL SETUSER user '>new'`, roll every process onto it,
then remove the old one with `'<old'`. Both passwords work in between. Removing a
password does not disconnect live sessions, so a process that was not rolled
fails only at its next reconnect, with `WRONGPASS` in its log.

### Do clustered brokers need the same user?

Yes. A clustered queue authenticates to every broker with the top-level
`username` and `password`, and credentials on individual `cluster` entries are
ignored. Distribute one `users.acl` file to all brokers.

### How do I see what Redis refused?

`ACL LOG` lists every refusal with its reason, object, user and client line.
`INFO commandstats` counts `rejected_calls` per command. `@imqueue` connections
are named after the service, connection type, process and host, so an entry
points at the exact process.

### Is an ACL a replacement for TLS?

No. They answer different questions. TLS protects the bytes and proves who the
broker is. An ACL limits what an authenticated connection may do. Without TLS
the ACL password travels in plaintext, so use both.

## Reference

[`IMessageQueueAuthConnection`](/api/core/latest/core.imessagequeueauthconnection/) ·
[`IMessageQueueAuthConnection.username`](/api/core/latest/core.imessagequeueauthconnection.username/) ·
[`IMessageQueueAuthConnection.password`](/api/core/latest/core.imessagequeueauthconnection.password/) ·
[`IMQOptions.prefix`](/api/core/latest/core.imqoptions.prefix/) ·
[`IMQOptions.cluster`](/api/core/latest/core.imqoptions.cluster/) ·
[`IMQOptions.safeDelivery`](/api/core/latest/core.imqoptions.safedelivery/) ·
[`IMQOptions.watcherCheckDelay`](/api/core/latest/core.imqoptions.watchercheckdelay/) ·
[`IMQServiceOptions`](/api/rpc/latest/rpc.imqserviceoptions/) ·
[`IMQClientOptions`](/api/rpc/latest/rpc.imqclientoptions/) ·
[`IRedisCacheOptions`](/api/rpc/latest/rpc.irediscacheoptions/) ·
[`DEFAULT_REDIS_CACHE_OPTIONS`](/api/rpc/latest/rpc.default_redis_cache_options/) ·
[`JobQueueOptions.username`](/api/job/latest/job.jobqueueoptions.username/) ·
[`JobQueueOptions.password`](/api/job/latest/job.jobqueueoptions.password/) ·
[Talking to your Redis broker over TLS](/blog/tls-redis-broker-nodejs/)
