---
layout: post.html
permalink: /blog/horizontally-scalable-redis-broker/
templateEngineOverride: md
title: "A horizontally auto-scaling Redis broker: recipes for networks with and without broadcast"
summary: "One Redis behind your message bus is a ceiling and a single point of failure. The promoter and unicaster modules turn a fleet of plain Redis instances into a horizontally auto-scaling broker — here are the recipes for networks that deliver broadcast and for clouds like GCP that don't."
description: "How to run a horizontally auto-scaling Redis message broker with @imqueue: client-side clustering with ClusteredRedisQueue, UDP-based broker discovery, redis-broker-promoter for broadcast-capable networks, and redis-broker-unicaster for GCP/Kubernetes where broadcast is blocked."
keywords: "horizontally scalable redis broker, redis broker auto-scaling, horizontal auto-scaling redis, scale redis message queue, redis broker cluster, redis broker discovery, redis-broker-promoter, redis-broker-unicaster, imqueue cluster, udp broadcast discovery, GCP redis broker, kubernetes redis broker"
date: 2026-07-24
author: serhiy-morenko
illustration: broker-fleet
topics: [discovery, queue, architecture, patterns]
ogType: article
---

**A horizontally scalable Redis broker** is the missing half of scaling a
message-driven system. Adding service instances is easy — with
[`@imqueue`](/get-started/) two copies of a service just read the same queue —
but all of that traffic still funnels through one Redis. At some point that
single broker is both your throughput ceiling and your single point of failure.
@imqueue's answer is not Redis Cluster and not a managed proxy: it's a **fleet
of plain, independent Redis instances** that services discover at runtime, with
producers spreading load across them and consumers draining all of them at
once. And because discovery runs continuously, the fleet doesn't just scale —
it **auto-scales**: add a broker and every service folds it into rotation
within a second; remove one and traffic re-routes just as fast, no config
pushes, no redeploys. The only part that changes between environments is *how
brokers announce themselves* — and that's what the two recipes below are about.

> **TL;DR** — Load a tiny announcer module into every Redis broker and the
> broker layer becomes horizontally **auto-scaling**: services discover the
> fleet over UDP as brokers come and go. On networks that deliver limited
> broadcast (bare metal, LANs, Docker bridge) use
> [redis-broker-promoter](https://github.com/imqueue/redis-broker-promoter),
> which shouts to `255.255.255.255`. On networks that drop broadcast — GCP
> VPCs, most Kubernetes overlays — use
> [redis-broker-unicaster](https://github.com/imqueue/redis-broker-unicaster),
> which asks the Kubernetes API for pod IPs and unicasts the same datagram to
> each of them. The service side is identical either way:
> `clusterManagers: [new UDPClusterManager()]`.

## How @imqueue clusters the broker

Clustering lives on the client side, in
[`ClusteredRedisQueue`](/api/core/latest/core.clusteredredisqueue/). You never
instantiate it directly — the factory swaps it in whenever the options mention
a cluster, so services and generated clients get it with zero code changes:

~~~typescript
import { IMQServiceOptions, UDPClusterManager } from '@imqueue/rpc';

export const serviceOptions: Partial<IMQServiceOptions> = {
    // dynamic discovery (the subject of this post):
    clusterManagers: [new UDPClusterManager()],
    // …or, instead of a manager, a static fleet known up front:
    // cluster: [
    //     { host: 'redis-1', port: 6379 },
    //     { host: 'redis-2', port: 6379 },
    // ],
};
~~~

The model is deliberately simple. There is no sharding and no consistent
hashing: every broker hosts an identically-named queue, producers pick a broker
per message in **health-aware round-robin** (a broker whose connection is
known to be down is skipped), and consumers run a blocking read against **all brokers
concurrently**. Throughput scales with the number of brokers; losing one broker
just narrows the rotation. The brokers themselves are stock standalone Redis —
they never talk to each other, don't replicate, and don't even know they are
part of a fleet. Neither announcer module registers a single Redis command.

## The discovery protocol both recipes share

Each broker loads a small C module that periodically emits a one-line,
tab-separated UDP datagram:

~~~
imq-broker  2cc7c345-3569-44bb-b57a-b72d729d7012  up    10.0.4.12:6379  1
imq-broker  2cc7c345-3569-44bb-b57a-b72d729d7012  down  10.0.4.12:6379
~~~

That's `name`, a per-process GUID, `up`/`down`, the advertised `host:port`, and
— for `up` — the announce interval in seconds. On the service side,
[`UDPClusterManager`](/api/core/latest/core.udpclustermanager/) listens on UDP
port `63000` (its default) in a worker thread and translates datagrams into
cluster changes:

- **`up`** — add the broker (deduplicated by GUID or address) and re-arm its
  liveness timer.
- **`down`** — sent on graceful shutdown; the broker is removed immediately.
- **silence** — a broker that misses heartbeats for
  `interval × 1000 + 5000 + 1` ms (about six seconds at the default 1-second
  interval) is evicted, which covers crashes and network partitions.

Both modules read the same environment variables — `REDIS_BROADCAST_NAME`
(default `imq-broker`), `REDIS_BROADCAST_INTERVAL` (seconds, default `1`) —
and emit byte-identical messages. They differ **only in how the datagram
travels**, which is exactly why the client side doesn't care which one you run.

## Recipe 1: networks that deliver broadcast — redis-broker-promoter

If your brokers and services share an L2 segment — bare-metal boxes, on-prem
VMs, a Docker bridge network, your laptop — the simplest transport is UDP
*limited broadcast*: one `sendto()` to `255.255.255.255` reaches every host on
the segment, no inventory required. That's all
[redis-broker-promoter](https://github.com/imqueue/redis-broker-promoter) does:

~~~bash
git clone https://github.com/imqueue/redis-broker-promoter.git
cd redis-broker-promoter && make   # needs libuuid
REDIS_BROADCAST_NAME=imq-broker \
REDIS_BROADCAST_INTERVAL=1 \
redis-server --port 6379 --loadmodule $PWD/promoter.so
~~~

On load the module spawns one announcer thread per network interface allowed by
your Redis `bind` configuration (`0.0.0.0` means all of them) and broadcasts
`up` every interval to `255.255.255.255:63000` (`REDIS_BROADCAST_PORT`
configurable). On shutdown it broadcasts `down`. Scaling out is now an
operational no-op: start another `redis-server` with the module loaded, and
every service adds it to the rotation within roughly one interval. Stop it, and
the fleet shrinks just as automatically. That is horizontal **auto-scaling** of
the broker layer — hook broker instances to whatever triggers your scaling
decisions and the services follow along; nothing else needs restarting or
reconfiguring.

A useful side effect of limited broadcast: routers never forward
`255.255.255.255`, so announcements are confined to the local segment. That's
the constraint that breaks this recipe in the cloud — and a small security
property everywhere else.

## Recipe 2: networks that block broadcast — redis-broker-unicaster (Kubernetes on GCP and other clouds)

Cloud VPCs are software-defined networks, and most of them — GCP explicitly —
do not deliver broadcast or multicast at all. A datagram to `255.255.255.255`
in a GCP VPC or across a typical Kubernetes overlay simply vanishes, and the
promoter recipe goes silent.

[redis-broker-unicaster](https://github.com/imqueue/redis-broker-unicaster)
*emulates* broadcast instead of relying on it. Every interval it asks the
Kubernetes API for the pods in its namespace and sends the very same datagram
as plain UDP **unicast to each pod IP** at port `63000`. Pods that aren't
listening drop it; pods running `UDPClusterManager` get exactly what they would
have gotten from a broadcast. Newly scheduled service pods start receiving
announcements within one interval — no service registry, no headless-service
DNS, no multicast anywhere. Scale the broker Deployment up or down — by hand or
with an autoscaler — and the fleet follows: the same horizontal auto-scaling as
the broadcast recipe, minus the broadcast.

One boundary to be clear about: this recipe lives *inside Kubernetes* — the
module authenticates with the pod's mounted service-account token and talks to
`kubernetes.default.svc`. On cloud VMs outside Kubernetes, reach for the static
`cluster` list instead (last row of the table below). The broker's service
account needs permission to list pods:

~~~bash
git clone https://github.com/imqueue/redis-broker-unicaster.git
cd redis-broker-unicaster && make   # needs libuuid, libcurl, json-c

# inside the broker pod — the module needs the mounted service-account token
DEPLOYMENT_ENV=production \
SELECTED_INTERFACES=10. \
redis-server --port 6379 --loadmodule $PWD/unicaster.so
~~~

- **`DEPLOYMENT_ENV`** — the Kubernetes namespace to enumerate pods in (and
  therefore the blast radius of the announcements). Announcements reach only
  this namespace, so brokers and every service or client that should discover
  them must run in the same one.
- **`SELECTED_INTERFACES`** — comma-separated IP prefixes (e.g.
  `10.,192.168.`) selecting which local interfaces announce themselves; unset
  means all of them, loopback included, so set it in real deployments.
- The RBAC side is a `Role` with `list` on `pods` plus a `RoleBinding` to the
  broker pod's service account.
- In the current implementation the announce destination port is fixed at
  `63000`, so leave `UDPClusterManagerOptions.port` at its default on the
  service side.

## The service side is the same in both recipes

Whatever transport the announcements take, services and clients configure one
thing. A pattern that has served well in production keeps a static fallback one
environment variable away:

~~~typescript
const DISABLE_CLUSTER_MANAGER = !!+(process.env.DISABLE_CLUSTER_MANAGER || 0);
const cluster = (process.env.REDIS_CLUSTER || 'localhost:6379')
    .split(/\s*,\s*/)
    .map(cfg => {
        const [host, port] = cfg.split(/\s*:\s*/);
        return { host, port: +port };
    });

Object.assign(serviceOptions, DISABLE_CLUSTER_MANAGER
    ? { cluster }                                    // static list
    : { clusterManagers: [new UDPClusterManager()] } // discovery
);
~~~

One rule matters: **apply the same cluster options to every service and every
client**. Requests and replies flow through the whole fleet, so a client pinned
to a single broker will miss responses that round-robin landed elsewhere.

## Life of the fleet

- **A broker joins.** Discovered within about one announce interval; @imqueue
  starts its queue, replays subscriptions, and folds it into the rotation. If a
  service sends before *any* broker is known (cold start), the send waits for
  the first discovery for up to 30 seconds (`IMQ_SEND_INIT_TIMEOUT`) instead of
  failing.
- **A broker leaves gracefully.** The module's shutdown hook emits `down` and
  removal is immediate. That's reliable at the default 1-second announce
  interval; at longer intervals shutdown can outrun the announcer thread, in
  which case removal falls back to heartbeat eviction.
- **A broker crashes.** No `down` arrives; the missed-heartbeat eviction
  removes it a few seconds later. Messages already queued on it stay in its
  Redis (subject to your persistence settings) and become consumable again when
  it returns — the fleet keeps flowing through the remaining brokers meanwhile.
- **Auth.** Give every broker the same credentials (one shared ACL file works
  well), because any service may connect to any discovered broker.
- **Security.** The datagrams are plain, unauthenticated UDP — anyone who can
  reach the port can inject or evict brokers. Broadcast confines itself to the
  L2 segment; for the unicaster, keep UDP `63000` cluster-internal with a
  NetworkPolicy and treat the namespace boundary as the trust boundary.

## Picking a recipe

| Environment | Recipe |
| --- | --- |
| Bare metal, on-prem VMs, one L2 segment | promoter (broadcast) |
| Docker bridge network, local development | promoter (broadcast) |
| Kubernetes — on GCP or any cloud VPC | unicaster (K8s-API unicast) |
| Cloud VMs outside Kubernetes, fixed topology | static `cluster` list, no modules |

The broker fleet is the piece that turns "we can scale the services" into "the
whole system auto-scales". If you're starting fresh, the
[getting-started guide](/get-started/) gets a service and client running in
minutes; for how the discovery mindset extends to services themselves, see
[do Node.js backends need service discovery?](/blog/do-nodejs-backends-need-service-discovery/)
and [load balancing without a load balancer](/blog/load-balancing-microservices-without-a-load-balancer/).
