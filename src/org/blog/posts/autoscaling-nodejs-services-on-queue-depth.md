---
layout: post.html
permalink: /blog/autoscaling-nodejs-services-on-queue-depth/
templateEngineOverride: md
title: "Autoscale on queue depth, not CPU"
summary: "CPU tells you a process is busy, not whether anyone is waiting. An @imqueue service's backlog is a Redis list, so KEDA can scale on it with no exporter, no Prometheus and no code change — and the metrics server covers the case where you need more."
description: "Autoscale Node.js microservices on queue depth with @imqueue: a KEDA ScaledObject reading LLEN directly, the built-in /metrics endpoint with a Kubernetes HPA, and the four properties of the number that decide whether the loop behaves."
keywords: "autoscale on queue depth, keda redis scaler nodejs, scale microservices queue length, kubernetes hpa queue length, imqueue metrics server, queue_length prometheus, scale nodejs workers backlog, keda scaledobject redis list"
date: 2026-08-22
author: mykhailo-stadnyk
illustration: queue-depth-scaling
topics: [queue, architecture, performance, resilience]
ogType: article
---

**CPU is a lagging proxy for "is this service behind?"** It goes up when a
process is working and stays up whether that work is useful or a retry storm
eating itself. It says nothing about whether anyone is waiting. Most HTTP
services scale on it anyway, for a structural reason rather than a lazy one:
there is no queue in front of an HTTP handler, so there is nothing else to
measure. Requests either get a worker or they get a connection error, and the
backlog exists only as latency after the fact.

A queue-based service has the number directly. With
[`@imqueue`](/get-started/), work waiting for a service is a Redis list, and its
length is the signal an autoscaler actually wants: **how much work is waiting**,
independent of how hard anything is currently working on it.

> **TL;DR** — The backlog is `LLEN imq:<ServiceName>`. KEDA's built-in `redis`
> scaler reads that directly: no exporter, no Prometheus, no code change. If you
> already run Prometheus, or you run a clustered broker fleet, turn on the
> service's own `/metrics` endpoint instead and point an HPA at it. Both read the
> same number, so the same four caveats apply to both — and the one that bites is
> that the number is **0 while the queue's writer is disconnected**.

## The number

Every `IMQService` reads from one Redis list. The key is the queue's prefix and
name joined by a colon; the prefix defaults to `imq`, and the name defaults to
the service class name. A service class called `UserService` therefore drains:

~~~bash
$ redis-cli LLEN imq:UserService
17
~~~

That is the whole contract. Everything below is a way of getting that number to
a scaling loop.

## Rung 1: KEDA, reading the list

KEDA ships a `redis` scaler that does exactly this, so the cheapest working setup
involves nothing new inside your service at all:

~~~yaml
apiVersion: keda.sh/v1alpha1
kind: ScaledObject
metadata:
  name: user-service
spec:
  scaleTargetRef:
    name: user-service
  minReplicaCount: 1        # never 0 — see "0 means two things", below
  maxReplicaCount: 20
  triggers:
    - type: redis
      metadata:
        address: redis:6379
        listName: imq:UserService
        listLength: "20"    # scale out while more than 20 are waiting
      authenticationRef:
        name: redis-auth    # if your broker has a password, and it should
~~~

No exporter to deploy, no Prometheus, no adapter, no `metricsServer` option, and
no change to the service. If your fleet is one Redis and you are already running
KEDA, stop here.

## Rung 2: the service's own `/metrics`, and an HPA

Rung 1 depends on the scaler being able to reach Redis and knowing the key. When
you would rather the *service* publish its backlog — because Prometheus is
already the system of record, because you want the figure on a dashboard next to
everything else, or because of the clustered case in rung 3 — every `IMQService`
can serve it, one option away:

~~~typescript
import { IMQService, expose } from '@imqueue/rpc';

export class UserService extends IMQService {
    // ...exposed methods
}

const service = new UserService({
    metricsServer: {
        enabled: true,   // off by default
        port: 9090,      // the default
    },
});

await service.start();   // the listener comes up with it
~~~

It answers exactly one route, in Prometheus exposition format, and 404s for
anything else:

~~~bash
$ curl -s localhost:9090/metrics
queue_length{} 17
~~~

Point Prometheus at it, expose `queue_length` as an external metric through
prometheus-adapter, and a `HorizontalPodAutoscaler` reads it like any other:

~~~yaml
metrics:
  - type: External
    external:
      metric:
        name: queue_length
      target:
        type: Value
        value: "20"      # scale out while more than 20 wait
~~~

The service *is* the exporter — there is deliberately no separate
`imqueue-exporter` to install, and no @imqueue-specific KEDA scaler either. The
built-in `redis` scaler already covers rung 1 and prometheus-adapter already
covers rung 2; a published component in between would be a thing to maintain
that buys nothing the built-ins do not.

## Rung 3: a clustered broker fleet, where rung 1 is wrong

If your brokers are a
[fleet rather than one Redis](/blog/horizontally-scalable-redis-broker/), the
backlog is spread across all of them. `ClusteredRedisQueue.queueLength()` sums
the figure across every broker; a KEDA `redis` trigger pointed at one address
sees only that broker's share and scales on a fraction of the real backlog.

This is a correctness limit, not an upsell. On a clustered fleet, use rung 2 —
the service already sums for you — or give KEDA one trigger per broker and accept
that you are approximating. Rung 1 is the right answer for a single broker and
the wrong one for a fleet.

## Four properties of the number

Both rungs read the same value, so these apply to both, and they are the
difference between a scaling loop that behaves and one that oscillates.

**It counts messages waiting in the queue's main list.** Delayed messages that
are not yet due, and messages already leased to a worker under `safeDelivery`,
are not included. So it is a *backlog* gauge, not the amount of outstanding work
— which is usually what you want for scaling, and definitely not what you want
for a "how much is in flight" dashboard.

**0 means two things, and one of them is an outage.** The figure is `0` while the
queue's writer is disconnected, which makes a broker outage indistinguishable
from an empty queue. An autoscaler that trusts it will scale the service to
nothing at exactly the moment Redis comes back and the backlog is largest.
**Keep `minReplicas`/`minReplicaCount` above zero.** This is the caveat that
turns a Redis blip into an incident, and it is the reason scale-to-zero is a bad
fit here.

**Every replica reports the same figure.** They all read the same queue, so the
number is a property of the queue and not of a pod. That is why an `External`
target on the value fits, and why an averaged per-pod target does not — averaging
a constant across N pods gives you a target that moves as you scale, which is a
feedback loop with the sign you did not want.

**Under `multiProcess`, the port collides.** Every process that starts the
service binds the metrics port, so the primary plus N workers all try and N of
the N+1 fail. Either leave `metricsServer` off in that configuration, or expect
the noise. (Rung 1 is unaffected, since nothing in the service binds anything.)

One shutdown detail if you use rung 2: the signal handlers close the listener on
`SIGINT`/`SIGTERM`, but
[`destroy()`](/api/rpc/latest/rpc.imqservice.destroy/) does not — close
`service.metricsServer` yourself there, or the open listener keeps the process
alive after everything else has stopped.

## What this does not give you

Queue depth tells you work is waiting. It does not tell you *why*, and scaling is
the wrong response to some of the reasons. A backlog caused by a slow downstream
dependency grows just the same as one caused by genuine load, and adding replicas
to the first makes it worse — you have just increased the pressure on the thing
that was already the bottleneck. Scaling on backlog is a better default than
scaling on CPU; it is not a substitute for knowing where the time goes, which is
what [tracing](/blog/distributed-tracing-nodejs-message-queue/) is for.

It also does not decide the *broker* layer's capacity. That scales on its own
axis and by a different mechanism — see
[auto-scaling the Redis broker](/blog/horizontally-scalable-redis-broker/).

## Reference

[`IMQServiceOptions.metricsServer`](/api/rpc/latest/rpc.imqserviceoptions.metricsserver/) ·
[`IMQMetricsServerOptions`](/api/rpc/latest/rpc.imqmetricsserveroptions/) ·
[`IMQMetricsServerOptions.enabled`](/api/rpc/latest/rpc.imqmetricsserveroptions.enabled/) ·
[`IMQMetricsServerOptions.port`](/api/rpc/latest/rpc.imqmetricsserveroptions.port/) ·
[`IMessageQueue.queueLength()`](/api/core/latest/core.imessagequeue.queuelength/) ·
[`ClusteredRedisQueue.queueLength()`](/api/core/latest/core.clusteredredisqueue.queuelength/) ·
[`IMQOptions.prefix`](/api/core/latest/core.imqoptions.prefix/) ·
[`IMQServiceOptions.multiProcess`](/api/rpc/latest/rpc.imqserviceoptions.multiprocess/) ·
[FAQ: how do I auto-scale @imqueue services?](/api/faq/#how-do-i-auto-scale-imqueue-services)
