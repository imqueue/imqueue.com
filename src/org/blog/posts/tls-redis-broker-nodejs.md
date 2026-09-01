---
layout: post.html
permalink: /blog/tls-redis-broker-nodejs/
templateEngineOverride: md
title: "Meeting compliance: how to talk to your Redis broker over TLS"
summary: "The questionnaire asks whether data is encrypted in transit, and you know the answer for the edge. Then you remember the broker — the one connection every service holds open all day, carrying every argument and every return value, and speaking a protocol that puts them on the wire as text. Here is what encrypting it takes, what it costs, and the two places it is easy to get wrong."
description: "How to encrypt the connection between Node.js services and their Redis broker with TLS in @imqueue: one option across every channel, mutual TLS with a private CA, turning it on fleet-wide from the environment with IMQ_REDIS_TLS, and why pooled connections must be keyed by their TLS configuration."
keywords: "redis tls nodejs, encrypt redis connection nodejs, redis mutual tls, message queue encryption in transit, imqueue tls, ioredis tls certificate, redis tls-port nodejs, secure message broker nodejs, redis private ca nodejs, encryption in transit compliance nodejs"
date: 2026-09-01
author: mykhailo-stadnyk
illustration: broker-tls
topics: [security, transport, queue]
ogType: article
---

The security questionnaire arrives with forty questions, and thirty-nine of them
you can answer from memory. Then you reach this one: *is data encrypted in
transit between all system components?*

You think about the edge first, because that is the part everybody looks at. TLS
terminates at the load balancer, the certificates renew themselves, the browser
shows a padlock. That has been true for years and nobody has had to think about
it since.

Then you remember the broker.

It is the connection every service in the fleet holds open all day. Every RPC
argument goes through it. Every return value comes back through it. The cache
sits on it, the job queues sit on it, and the whole thing has been quietly
working so well that the last time anyone looked at its configuration was when
they first set the hostname.

And the honest answer, for most fleets, is: no. That part is not encrypted.

## What is actually on the wire

Redis speaks RESP, a line-oriented protocol that is deliberately simple and
entirely plaintext. That is not a flaw; it is a design choice that makes the
server fast and its wire format debuggable with `nc`. But it does mean that
anyone who can read the bytes between your service and your broker can read
everything.

Everything, in this case, is more than most people picture. It is the arguments
of every service call, which for a user service means the user records
themselves. It is the return values. It is the job payloads, which tend to
accumulate exactly the fields nobody wanted to look up twice — addresses, order
totals, whatever the job needs to run without another round trip. And because
authentication happens in-band, it is also the password: on an unencrypted
connection the `AUTH` command crosses the wire before anything else does, in the
clear, once per connection.

The usual reassurance is that this all happens inside the perimeter. That was a
better answer when the perimeter was a rack. Today the broker is frequently a
managed instance in someone else's account, reached across a VPC peering link,
or a hop that traverses a network segment you do not own and cannot audit. The
question is not whether you trust your colleagues. It is whether you can
demonstrate — to an auditor, or to yourself after an incident — that the bytes
were unreadable in transit. If they were plaintext, you cannot.

## One option, and it covers every channel

The first thing worth knowing is that a queue is not one connection.
[`@imqueue/core`](/api/core/latest/) opens up to four: a reader that blocks on
the queue, a writer that publishes, a watcher that handles delivery safety, and
a subscription channel. They are separate sockets doing separate jobs.

They are also all created by the same internal factory, which is why TLS is one
option rather than four:

```typescript
import IMQ from '@imqueue/core';
import { readFileSync } from 'node:fs';

const queue = IMQ.create('user-service', {
    host: 'redis.internal',
    port: 6380,
    tls: { ca: readFileSync('/etc/ssl/internal-ca.crt') },
});

await queue.start();
```

Set [`tls`](/api/core/latest/core.imessagequeueauthconnection.tls/) once and the
whole bus is encrypted — reader, writer, watcher and subscription alike. There
is no per-channel setting to forget.

The value is `boolean | TlsOptions`. Passing `true` connects with Node's
defaults, which means the broker's certificate is verified against the system
trust store — correct for a managed Redis with a certificate from a public CA,
and almost never what you want internally. Passing an object hands it to
`tls.connect()` as given, so anything Node accepts works, and the option is not
a curated subset that will need extending the first time you meet a real
deployment.

The broker has to be listening for TLS, which in Redis means `tls-port`. A
common production shape is to give it a TLS port and turn the plaintext one off
entirely:

```bash
redis-server --port 0 --tls-port 6380 \
  --tls-cert-file /etc/redis/server.crt \
  --tls-key-file /etc/redis/server.key \
  --tls-ca-cert-file /etc/redis/ca.crt
```

`--port 0` is the part that matters. Encryption you can opt out of is a
suggestion; a broker with no plaintext listener is a guarantee.

## It fails closed — and it will not tell you why

The reassuring half of this is that nothing quietly downgrades. There is no
negotiation step that can be talked out of encryption, because there is no
negotiation: either both ends are speaking TLS or the connection does not
happen. I checked each way it can be wrong against a real broker, and all of
them fail:

| Misconfiguration | Result | Time to report |
| --- | --- | --- |
| Plaintext client, TLS-only broker | rejected | immediate |
| TLS client, plaintext broker | rejected | about 10 seconds |
| Certificate signed by an untrusted CA | rejected | immediate |
| `servername` that the certificate does not carry | rejected | immediate |
| No client certificate, broker requires one | rejected | immediate |

The unreassuring half is the diagnostics. Every one of those rejections surfaces
as the same message from the underlying client — `Connection is closed.` — with
no error event carrying the actual TLS reason. The verification failure happens
below the queue, and what comes back up is a closed socket.

So when a deploy comes up unable to reach the broker and the log says the
connection closed, resist the urge to treat that as a network problem. Reach for
`openssl s_client` against the broker with the same trust anchors and read the
real error there:

```bash
openssl s_client -connect redis.internal:6380 \
  -CAfile /etc/ssl/internal-ca.crt -servername redis.internal
```

The one failure that *is* diagnostic is a missing certificate file, and it is
deliberately loud. If TLS material is named but cannot be read — a mistyped
path, a secret that did not mount — construction throws an error carrying the
code `IMQ_TLS_MATERIAL_UNREADABLE` and naming the variable at fault. It does not
fall back to an unencrypted connection. That distinction is the whole design:
the failure mode of a broken TLS configuration is a service that will not start,
never a service that starts and talks in the clear.

## Turning it on across a fleet without touching the code

The code above is fine for one service. It is the wrong shape for thirty,
because it puts a security decision in thirty repositories, where enabling it
means thirty pull requests and verifying it means thirty code reviews.

So when `tls` is left unset, `@imqueue/core` consults the environment instead,
through [`envTls()`](/api/core/latest/core.envtls/):

| Variable | Effect |
| --- | --- |
| `IMQ_REDIS_TLS` | Enables TLS with Node's default verification |
| `IMQ_REDIS_TLS_CA_FILE` | PEM bundle of trust anchors, for a private CA |
| `IMQ_REDIS_TLS_CERT_FILE` | Client certificate, for mutual TLS |
| `IMQ_REDIS_TLS_KEY_FILE` | The client certificate's private key |
| `IMQ_REDIS_TLS_KEY_PASSPHRASE` | Passphrase for an encrypted key |
| `IMQ_REDIS_TLS_SERVERNAME` | Expected certificate name |
| `IMQ_REDIS_TLS_REJECT_UNAUTHORIZED` | Set to `0` to accept an unverified certificate |

Three rules govern how they combine, and each one is a decision rather than an
accident.

**Supplying key material is enough to turn TLS on.** A `CA_FILE` on its own
enables it, because there is no other reason to have named one. You do not have
to remember to set the switch as well as the paths.

**The off switch beats everything.** `IMQ_REDIS_TLS=0` disables TLS even when
certificates are configured, and it short-circuits before the files are read —
so a rollback works even if the certificates have already been removed from the
image. Booleans are read generously, `1`/`true`/`yes`/`on` and their negatives,
case-insensitively.

**Options that only shape a connection cannot start one.** Setting
`IMQ_REDIS_TLS_REJECT_UNAUTHORIZED=0` by itself does not enable TLS. Neither
does `SERVERNAME` alone. Reading an *enable* out of "and by the way, do not
verify the certificate" would be a perverse way to arrive at an encrypted
connection, so it does not happen.

The payoff is that encrypting the fleet becomes a deployment change: set the
variables in the environment every service already inherits, restart, done. One
place to change, one place to audit, and it covers `@imqueue/core`,
`@imqueue/rpc` caches and `@imqueue/job` queues identically — they all consult
the same variables.

If one service genuinely must stay in plaintext — a local reproduction, a
sidecar on a loopback interface — passing `tls: false` explicitly declines the
environment fallback. Unset means "ask the environment"; `false` means "no".

## A private CA, and then mutual TLS

Internal brokers rarely have certificates from a public CA, so the realistic
configuration verifies against your own trust anchor:

```typescript
const tls = { ca: readFileSync('/etc/ssl/internal-ca.crt') };
```

That gets you an encrypted connection to a broker you have authenticated. The
next step up is authenticating in the other direction too — the broker verifying
the client — which is mutual TLS, and it is the configuration that lets you stop
treating the broker password as the only thing standing between an attacker and
your queues:

```typescript
const tls = {
    ca:   readFileSync('/etc/ssl/internal-ca.crt'),
    cert: readFileSync('/etc/ssl/user-service.crt'),
    key:  readFileSync('/etc/ssl/user-service.key'),
};
```

With `tls-auth-clients yes` on the broker, a client that does not present a
certificate signed by that CA is refused at the handshake, before it ever gets
to send `AUTH`. For a compliance conversation this is a materially different
claim: not "the connection is encrypted" but "the broker will only speak to
services holding a certificate we issued".

Two practical notes.

The certificate is verified against the host you connected to. If you reach the
broker by IP address, its certificate needs that address as an IP SAN, or
verification fails — this is standard TLS behaviour and it catches people who
address brokers by IP out of habit. Set `servername` to the name on the
certificate, or better, reach the broker by that name.

And if you are tempted by `rejectUnauthorized: false`, know that the queue logs
a warning the moment you construct it with that set, saying in as many words
that the connection is encrypted but the server is not authenticated. That is
worth internalising rather than filtering out of the logs: without verification
you have confidentiality against a passive eavesdropper and nothing at all
against an active one, because anything that can intercept the connection can
also present its own certificate. It is a fine flag for a local experiment. In a
deployment it is the kind of thing that passes a questionnaire and fails an
incident.

## Pooled connections have to remember how they were opened

Here is the part that is easy to get wrong, and it is not obvious until it bites.

The writer and watcher connections are shared per broker within a process. Two
queues pointing at the same `host:port` reuse one socket, which is the right
call — a process running eight services should not open eight identical writers.

But now add TLS to one of them. If the pool were keyed by address alone, a queue
that asked for an encrypted connection could be handed a plaintext socket that
some earlier queue opened first, and it would never know. The security posture
of a connection would depend on construction order. That is the sort of bug that
does not show up in tests, does not throw, and is discovered by someone reading
a packet capture.

So the pool key includes the transport.
[`tlsFingerprint()`](/api/core/latest/core.tlsfingerprint/) reduces a TLS
configuration to a stable digest, and the pool slot is the address plus that
digest:

```typescript
// plaintext queues pool on the address alone
'redis.internal:6380'

// encrypted ones carry their configuration in the key
'redis.internal:6380#bc0ae316c743a8b05632409fe1fbdf1fa593fdd1'
```

The fingerprint compares by value, not by identity, so two option objects built
independently in different modules still share a connection as long as they
describe the same thing — key order does not matter, `true` and `{}` agree,
`undefined` entries are ignored, and CA buffers compare by their contents.
Anything that genuinely changes the security posture changes the digest: a
different trust anchor, a different client certificate, a different
`servername`, `rejectUnauthorized`, even a different `checkServerIdentity`
callback, which is compared by its source text so that two connections differing
only in their verifier are not pooled together.

One caveat is worth knowing. An opaque host object — a prebuilt `SecureContext`,
an `Agent` — has no readable structure to compare, so it is fingerprinted by its
class name alone, and two distinct instances of the same class collide. If you
build contexts yourself, pass the certificate material rather than the
prebuilt object and the comparison stays exact.

## The cache is one connection, and the first caller wins

[`@imqueue/rpc`](/api/rpc/latest/) accepts the same `tls` option for its Redis
cache, and reads the same environment variables, so in the ordinary case caches
get encrypted along with everything else and you never think about it.

The exception is worth knowing about, because it behaves differently from
queues. The cache connection is process-wide: the first
[`RedisCache`](/api/rpc/latest/rpc.rediscache/) initialised in a process opens
it, and every later one reuses it — including one configured differently.
Where a queue would give you a second connection, the cache hands back the
existing one and logs a warning that it is not the transport these options
asked for.

It is a sensible design for a shared cache, but it means the configuration that
takes effect is the one that ran first, which in a process with several
initialisation paths is not always the one you would predict. Two things keep it
boring: configure caches through the environment so every caller agrees by
construction, and treat that warning as a real finding rather than noise, since
it fires exactly when a cache is not encrypted the way its caller believed.

## Jobs inherit all of it

[`@imqueue/job`](/api/job/latest/) sits on the same core queue, so
[`JobQueueOptions.tls`](/api/job/latest/job.jobqueueoptions.tls/) passes straight
through — and when you leave it unset, it is omitted entirely rather than being
set to `undefined`, which is what lets core's environment fallback work for job
queues too.

The one thing to notice is addressing. Job queues take their broker as a
`cluster` array rather than top-level `host` and `port`:

```typescript
import { JobQueueWorker } from '@imqueue/job';

const worker = new JobQueueWorker({
    name: 'invoices',
    cluster: [{ host: 'redis.internal', port: 6380 }],
    tls: { ca: readFileSync('/etc/ssl/internal-ca.crt') },
});

worker.onPop(async job => { /* ... */ });
await worker.start();
```

For a genuinely clustered broker there is a useful detail here: each cluster
entry may carry its own `tls`, overriding the top-level one for that server
alone, falling back to the top level when it does not. That is what you need
during a migration where the nodes do not yet share trust anchors. Per-entry
`username` and `password` are ignored — credentials stay top-level.

## What it costs

Less than people expect, and not where they expect it.

The handshake is real and measurable. On loopback with RSA-2048 certificates,
establishing a mutually-authenticated connection took a median of 9.5 ms against
1.6 ms for plaintext — call it 8 ms of TLS. Over a real network with real
round trips it will be more.

Steady-state throughput, though, is where the intuition misleads. Pushing 5,000
small messages through an encrypted queue and a plaintext one, alternating, the
difference disappeared into the measurement noise — some rounds the encrypted
queue was faster. Symmetric encryption on a modern CPU is not the bottleneck; on
loopback, neither is the network. Your own results will differ with message size
and real latency, but the shape holds: the cost is the handshake, not the
traffic.

And the handshake is paid once per connection, not once per message, because the
queue holds its connections open. A service that runs for a week pays it at
startup and never again. That is the whole budget, and it is one of the better
security-to-cost ratios available to you.

## What TLS does not do

Worth being precise about, because "encrypted in transit" gets stretched to
cover things it does not.

It protects the bytes *between* your service and the broker. Redis decrypts them
on arrival, so the broker holds your data in memory as plaintext, and anything
persisted to disk is written as plaintext unless you have arranged encryption at
rest separately. If your threat model includes the broker host itself, TLS is
not the control you are looking for — payload-level encryption is.

Mutual TLS authenticates callers; it does not authorize them. A service holding
a valid certificate can read any queue it knows the name of. Redis ACLs are the
tool for restricting *what* an authenticated client may do, and they compose
with everything above.

And turning encryption on adds an availability dependency you did not have
before: certificates expire. A queue whose broker certificate lapsed does not
degrade to plaintext, it stops — which is the correct behaviour, and also a
scheduled outage waiting to happen if nobody owns renewal. Put the expiry dates
somewhere that alerts before they matter, and rehearse a rotation before you
need one.

None of that argues against encrypting the broker. It argues for describing what
you did accurately, which is the thing the questionnaire was really asking.

## FAQ

### How do I enable TLS for a Redis connection in Node.js?

Set the `tls` option on the queue. `tls: true` connects with Node's defaults and
verifies the broker against the system trust store, which is right for a managed
Redis with a publicly-signed certificate. For an internal broker, pass an object
with your own trust anchor — `tls: { ca: readFileSync('/etc/ssl/ca.crt') }` — and
it is handed to `tls.connect()` as given. In `@imqueue` one setting covers every
channel the queue opens, so there is nothing else to configure.

### Can I turn on TLS without changing application code?

Yes, and for a fleet this is the better path. Leave `tls` unset and
`@imqueue/core` reads `IMQ_REDIS_TLS` and its companion variables from the
environment, so encrypting every service becomes a deployment change in one
place rather than a pull request per repository. The same variables cover
`@imqueue/rpc` caches and `@imqueue/job` queues. Setting `tls: false`
explicitly declines the fallback for a service that must stay in plaintext.

### Does @imqueue support mutual TLS with client certificates?

Yes. Pass `cert` and `key` alongside `ca` — plus `passphrase` for an encrypted
key — and the client presents its certificate during the handshake. With
`tls-auth-clients yes` on the broker, a client without a valid certificate is
refused before it can send its password. Configured through the environment, the
equivalent variables are `IMQ_REDIS_TLS_CERT_FILE` and `IMQ_REDIS_TLS_KEY_FILE`.

### What happens if the broker is not listening for TLS?

The connection is refused. There is no negotiation and no fallback, so an
encrypted client cannot be downgraded to plaintext by a broker that is not
configured for TLS, and a plaintext client cannot reach a TLS-only broker. Both
directions fail, though not at the same speed: a plaintext client against a TLS
broker is rejected immediately, while an encrypted client against a plaintext
broker takes about ten seconds to give up.

### Why does my Redis TLS connection fail when I connect by IP address?

Because the certificate is verified against the address you connected to, and a
certificate issued for a hostname does not match a bare IP unless it carries
that IP as a subject alternative name. Either reach the broker by the name on
its certificate, set `servername` to that name, or reissue the certificate with
an IP SAN. This is standard TLS behaviour rather than anything specific to the
queue.

### Is rejectUnauthorized: false acceptable in production?

No. It keeps the encryption and discards the authentication, which protects you
from someone passively reading the wire and not at all from someone
intercepting it — an attacker in the path can present any certificate and be
accepted. `@imqueue` logs a warning at construction whenever it is set, for
exactly that reason. If verification is failing, the fix is to supply the right
trust anchor through `ca`, or the right name through `servername`.

### How much does TLS slow down a Redis message queue?

Almost nothing in steady state. Measured on loopback, throughput over a mutually
authenticated connection was indistinguishable from plaintext across repeated
runs of thousands of messages. The measurable cost is the handshake — roughly
8 ms per connection in that test, more over a real network — and because the
queue holds its connections open, that is paid at startup rather than per
message.

### Do caches and job queues need to be configured separately?

Only if you configure them in code, in which case each takes its own `tls`
option. Configured through the environment they are covered together, since
`@imqueue/core`, `@imqueue/rpc` and `@imqueue/job` all consult the same
`IMQ_REDIS_TLS*` variables. The one behaviour worth knowing is that the RPC
cache connection is process-wide, so the first cache initialised in a process
decides the transport for all of them and later mismatched ones get a warning.

## Reference

[`IMessageQueueAuthConnection.tls`](/api/core/latest/core.imessagequeueauthconnection.tls/) ·
[`envTls()`](/api/core/latest/core.envtls/) ·
[`tlsFingerprint()`](/api/core/latest/core.tlsfingerprint/) ·
[`IMQOptions.cluster`](/api/core/latest/core.imqoptions.cluster/) ·
[`JobQueueOptions.tls`](/api/job/latest/job.jobqueueoptions.tls/) ·
[`IRedisCacheOptions`](/api/rpc/latest/rpc.irediscacheoptions/) ·
[`RedisQueue`](/api/core/latest/core.redisqueue/) ·
[FAQ: how do I encrypt the connection between my services and the broker?](/api/faq/#how-do-i-encrypt-the-connection-between-my-services-and-the-broker) ·
[FAQ: how do I turn on TLS across a fleet without changing application code?](/api/faq/#how-do-i-turn-on-tls-across-a-fleet-without-changing-application-code)
