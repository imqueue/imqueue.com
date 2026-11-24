---
layout: post.html
permalink: /blog/http-api-gateway-nodejs-services/
templateEngineOverride: md
title: "An HTTP gateway in front of your Node.js services: errors, deadlines, restarts"
summary: "Your services talk to each other over a queue, but browsers, mobile apps and partners speak HTTP. The gateway is the one process where the two meet, and it is where a stack trace leaks, a request hangs forever, or a deploy cuts answers off mid-flight. Here is how to build one with Express and @imqueue clients that turns service errors into clean HTTP answers, never waits forever, runs as many copies as you need, and restarts without dropping a request. Every number is measured."
description: "A measured recipe for an HTTP API gateway in front of an @imqueue service fleet: shared generated clients, callTimeout as a 504, mapping RPC error codes to HTTP status without leaking stacks or arguments, passing the caller, running several gateways, a graceful shutdown with handleSignals: false, rate limits, and what the gateway costs per request."
keywords: "api gateway nodejs microservices, express api gateway, http gateway for microservices, map rpc errors to http status, gateway timeout 504 nodejs, graceful shutdown express gateway, node.js backend for frontend, imqueue gateway"
date: 2026-11-24
author: mykhailo-stadnyk
illustration: http-gateway
topics: [architecture, clients, rpc]
ogType: article
---

Inside your system, services call each other over a queue. Outside it, nobody
does. Browsers, mobile apps and partner integrations speak HTTP, and somewhere a
process has to translate between the two. That process is the gateway.

It is easy to write a gateway that works on the first day. A route calls a
service and sends back what it gets. The problems show up later, and they all
come from the same place: the gateway hands the outside world whatever the inside
world gave it. A failed call sends a stack trace to a browser. A stopped service
leaves a request waiting forever. A deploy cuts off answers that the services
had already worked out.

This post builds a gateway with Express and
[`@imqueue/rpc`](/api/rpc/latest/) clients that gets those parts right, one
recipe at a time.

**Everything below was measured** with `@imqueue/rpc` 3.12.0 and
`@imqueue/core` 3.8.0 against Redis 8 on Node.js 26, with Express 5, two
instances of an `Orders` service and up to three gateways.

## The short version

- **Create one client per service when the gateway starts**, and share it across
  every request.
- **Give every client a `callTimeout`.** With the service stopped and no
  timeout, an HTTP request was still waiting when we gave up at 20 seconds. With
  `callTimeout: 2000`, it got a `504` after 2.01 seconds.
- **Never send a service error to the caller as it is.** It carries the
  service's stack trace, its file paths and the call's arguments, a card number
  among them. Map its `code` to an HTTP status and a fixed message instead.
- **Run as many gateways as you like.** Three gateways in front of two services
  answered 3,000 requests, and every answer reached the gateway that asked.
- **Own the shutdown.** Give the gateway's clients `handleSignals: false` and
  close the HTTP server before them. Without it, a restart under load cut 15
  requests off mid-flight. With it, none.
- **The gateway is cheap.** It added about 0.07 ms per request: 0.15 ms at the
  median through HTTP, against 0.08 ms for the call alone.

## The shape of it

The gateway is an ordinary HTTP server that holds a set of
[generated clients](/blog/stop-hand-writing-microservice-clients/), one per
service it calls. A route reads the request, calls one or more services through
those clients, and turns what comes back into an HTTP answer.

The services don't know the gateway exists. To them it's one more caller. That
is why the same fleet can have a REST gateway, a GraphQL gateway and a partner
API side by side, and why the
[tutorial's REST chapter](/tutorial/rest-api/) could replace its GraphQL
gateway without touching a single service.

## Recipe 1: create the clients once

A client is not a cheap object. Creating one opens its own queue in Redis, and
starting it connects. So clients are created and started when the gateway
starts, before it accepts any traffic, and every request shares them:

```typescript
// src/clients.ts
import { orders } from './clients/Orders.js';

export const ordersClient = new orders.OrdersClient({
    callTimeout: 5000,     // Recipe 2
    handleSignals: false,  // Recipe 6
});

export async function startClients(): Promise<void> {
    await ordersClient.start();
}
```

```typescript
// src/server.ts
import express from 'express';
import { ordersClient, startClients } from './clients.js';
import { sendError } from './errors.js';

await startClients();

const app = express();

app.use(express.json());

app.get('/orders/:id', async (req, res) => {
    res.json(await ordersClient.get(req.params.id));
});

app.post('/orders/:id/pay', async (req, res) => {
    res.json(await ordersClient.pay(req.params.id, req.body.cardNumber));
});

// Express 5 sends a rejected promise from a route here
app.use(sendError);

export const server = app.listen(8080);
```

The `Orders.js` module is generated from the running service with
`imq client generate`, so its methods and types always match what the service
exposes. Nobody writes it by hand.

## Recipe 2: never wait forever

A call to a service goes into its queue and waits there until an instance picks
it up. That is what lets a service restart without losing calls, but it also
means that a call to a service that isn't running doesn't fail. It waits.

We stopped every instance of `Orders` and sent one request to the gateway:

| client setting | what the HTTP caller got |
|---|---|
| no `callTimeout` | nothing; still waiting when we gave up at 20 s |
| `callTimeout: 2000` | `504` after 2.01 s |

Without a timeout, the request holds its connection open until the caller gives
up, and the gateway keeps the pending call in memory for the life of the
process. Behind a busy page, those add up fast. With
[`callTimeout`](/api/rpc/latest/rpc.imqclientoptions.calltimeout/), the call
fails with the code `IMQ_RPC_CALL_TIMEOUT`, which the next recipe turns into a
`504 Gateway Timeout`.

Pick the timeout from what the caller will tolerate, not from how long the
service usually takes. A page that gives up after 10 seconds gains nothing from
a gateway that waits 30.

One thing a timeout does not do is take the call back. Both requests from the
test above were still in the queue afterwards, and a service started later would
have run them. For reads that's harmless. For writes, send a deadline with the
call so the service can skip work nobody is waiting for any more:
[deadlines for queued calls](/blog/request-deadlines-queued-calls-nodejs/) shows
how.

## Recipe 3: turn service errors into HTTP answers

When a service method throws, the client rejects with an
[`IMQRPCError`](/api/rpc/latest/rpc.imqrpcerror/). It is built for the people
debugging the service, so it carries everything they need. This is what a
gateway that sends the error as it is (`res.status(500).json(err)`) gave a
caller whose card was declined:

| field | what it held |
|---|---|
| `code` | `CARD_DECLINED` |
| `message` | `card declined` |
| `stack` | the service's stack trace, with its file paths on disk |
| `method` | `pay` |
| `args` | `["42", "4111 1111 1111 1111"]`, the card number |

The status was `500`, too, for what is really the caller's problem.

So the gateway translates. A service signals what went wrong with a `code` on
the error it throws, and that code survives the trip:

```typescript
// in the Orders service
class OrderNotFound extends Error {
    public readonly code = 'ORDER_NOT_FOUND';
}

throw new OrderNotFound(`order ${id} not found`);
```

The gateway keeps one table of the codes it knows, each with a status and a
message written for the public, and treats everything else as its own failure:

```typescript
// src/errors.ts
import type { NextFunction, Request, Response } from 'express';

const PUBLIC: Record<string, [status: number, message: string]> = {
    ORDER_NOT_FOUND: [404, 'Order not found'],
    CARD_DECLINED: [402, 'The card was declined'],
    IMQ_RPC_CALL_TIMEOUT: [504, 'The request took too long'],
};

export function sendError(
    err: any,
    req: Request,
    res: Response,
    _next: NextFunction,
): void {
    const known = PUBLIC[err?.code];

    if (!known) {
        // the full error stays in the gateway's log
        console.error('call failed', req.method, req.path, err);
    }

    const [status, message] = known ?? [500, 'Something went wrong'];

    res.status(status).json({ error: err?.code ?? 'INTERNAL', message });
}
```

With that in place, the same three requests answered:

| request | status | body |
|---|---|---|
| an order that exists | `200` | the order |
| an order that doesn't | `404` | `ORDER_NOT_FOUND`, "Order not found" |
| a declined card | `402` | `CARD_DECLINED`, "The card was declined" |

Two details matter here. The message comes from the table, not from the error,
because a service's message is written for developers: the timeout's own message
names the service and the method. And a code the table doesn't know becomes a
`500` with nothing inside it, while the whole error, stack and all, goes to the
gateway's log, where it helps. Codes such as `IMQ_RPC_NO_METHOD` or
`IMQ_RPC_NO_ACCESS` belong there: they mean the gateway called something that
isn't there, which is a bug in the gateway, not the caller's fault.

## Recipe 4: tell the services who is calling

The gateway is where you know who the user is. It checks the token or the
session once, and the services behind it should trust that answer rather than
check again. The way to pass it on is
[`IMQMetadata`](/api/rpc/latest/rpc.imqmetadata/), which travels with the call
without becoming one of its arguments.
[Request context across services](/blog/request-context-across-services-nodejs/#recipe-1-attach-the-context-at-the-edge)
covers it end to end, including how to carry it from one service to the next.

## Recipe 5: run as many gateways as you need

A gateway holds no state of its own, so you scale it like any web server: start
more copies behind your load balancer. The part people worry about is the
answers. If three gateways call the same service, does each answer come back to
the gateway that asked?

It does, because each client listens for its answers on a queue of its own, and
every call says which queue to answer on. We ran three gateways in front of two
`Orders` instances, sent 3,000 requests across them, 30 at a time, and checked
that every answer was for the order its request named:

| | result |
|---|---|
| answers for the right order | 3,000 of 3,000 |
| requests per gateway | 1,000 each |
| calls per service instance | 1,484 and 1,516 |

No sticky sessions, no shared state between gateways, and no configuration to
make it work. The services shared the calls between themselves, as they do with
any caller: [load balancing without a load balancer](/blog/load-balancing-microservices-without-a-load-balancer/)
explains how.

## Recipe 6: restart without cutting requests off

A deploy stops the old gateway while requests are still in flight. Stopping
well means three steps, in this order: stop accepting new connections, let the
requests already accepted finish, and only then close the clients they are
using.

There's a catch. By default, every `@imqueue` client and service installs its
own handlers for `SIGTERM`, `SIGINT`, `SIGHUP` and `SIGQUIT`, which close it and
end the process within a second. That's the right default for a service that
never thinks about shutdown, but a gateway has its own HTTP server to drain,
and those handlers end the process before it can. Setting
`handleSignals: false` on a client hands the signals to you.

We sent `SIGTERM` to a gateway in the middle of a steady load of 50 requests a
second, each taking 300 ms, and counted the requests that were cut off after
the gateway had accepted them. Each way of stopping ran three times, and gave
the same count every time:

| how the gateway stopped | requests cut off |
|---|---|
| the framework's handlers alone | 15 |
| its own handler, clients left with their handlers | 15 |
| its own handler, clients with `handleSignals: false` | **0** |

In the first two cases, every one of those requests had already been worked on
by a service. The work was done; only the answers were lost. With its own
handler, the gateway finished every request it had accepted and stopped in 0.6
seconds.

One request in two of the three runs still saw its connection reset. It was sent
down an idle keep-alive connection at the moment the gateway closed it, so it
never reached the gateway's code or any service, and sending it again is always
safe. A load balancer retries those for you.

This is the handler:

```typescript
// src/shutdown.ts
import { server } from './server.js';
import { ordersClient } from './clients.js';

let stopping = false;

export const isStopping = () => stopping;

async function shutdown(): Promise<void> {
    stopping = true;

    // no new connections; resolves once the last open one has ended
    const closed = new Promise<void>(resolve => server.close(() => resolve()));

    server.closeIdleConnections();

    // never outlive the orchestrator's grace period
    const deadline = setTimeout(() => server.closeAllConnections(), 10_000);

    await closed;            // every accepted request has been answered
    clearTimeout(deadline);
    await ordersClient.destroy();
    process.exit(0);
}

// once: a second signal finds no handler and ends the process at once
process.once('SIGTERM', shutdown);
process.once('SIGINT', shutdown);
```

And two small additions to the server, so the load balancer and the callers'
open connections move away while the gateway drains:

```typescript
app.use((_req, res, next) => {
    // once stopping, every answer closes its connection, so a caller
    // reconnects to another gateway instead of holding this one open
    if (isStopping()) {
        res.set('Connection', 'close');
    }

    next();
});

app.get('/ready', (_req, res) => {
    res.status(isStopping() ? 503 : 200).end();
});
```

Without the `Connection: close` line, the gateway still dropped nothing, but it
took 2.8 seconds to stop instead of 0.6, because callers kept sending new
requests down the connections they already had open.

Two rules make this work:

- **Every client and service in the process needs `handleSignals: false`.** The
  handlers are process-wide, so a single client left with its own handlers still
  ends the process early.
- **Close the clients last.** A client closed while a call is in flight never
  answers that call. Closing the HTTP server first guarantees there are none.

## Recipe 7: guard the door

The gateway is the only part of the system the internet can reach, so it is
where limits belong. Two earlier posts cover them:

- [Rate limiting across instances](/blog/rate-limiting-nodejs-api-redis/) keeps
  one shared counter per client, so three gateways enforce one limit, not three.
  Its section on deciding who the client is matters most behind a load
  balancer.
- [IP allow-lists with CIDR ranges](/blog/ip-allow-lists-cidr-nodejs/) checks a
  partner's address against a list of networks in constant time, for routes
  only some callers may use.

## What it costs

We sent 2,000 requests one after another through the gateway, and the same
2,000 calls straight through a client, with Redis on the same machine:

| | median | slowest 1% |
|---|---|---|
| the service call alone | 0.08 ms | 0.9 ms |
| the same call through the HTTP gateway | 0.15 ms | 1.8 ms |

About 0.07 ms per request for HTTP parsing, Express routing and the JSON
response. In a real deployment, the network between the caller and the gateway
will cost many times more than that.

## What this does not do

- **It doesn't design your public API.** Which routes exist, how they are
  versioned and what they return is your decision. The
  [tutorial's REST chapter](/tutorial/rest-api/) shows one way to lay them out,
  with an OpenAPI document and Swagger UI.
- **It doesn't make writes safe to retry.** A caller that times out and tries
  again can cause the same write twice. That needs an idempotency key, checked
  by the service.
- **It doesn't replace a CDN or a web application firewall.** Those sit in front
  of the gateway and handle traffic it should never see.

## FAQ

### What is an API gateway in a Node.js microservice system?

A process that receives HTTP requests from outside, calls the services behind
it, and turns their answers into HTTP responses. With `@imqueue`, it is an
ordinary Express (or Fastify, or GraphQL) server holding a generated client for
each service it calls.

### How do I turn an RPC error into an HTTP status code?

Have the service throw an error with a `code`, and keep a table in the gateway
that maps each code to a status and a public message. Anything the table
doesn't know becomes a `500` with no details, and the full error goes to the
gateway's log.

### Is it safe to send an RPC error to the browser?

No. An `@imqueue` RPC error carries the service's stack trace, its file paths
and the call's arguments. In our test, that included a card number. Send a code
and a fixed message instead.

### What happens if a service is down when the gateway calls it?

The call waits in the service's queue. Without a `callTimeout`, the HTTP request
waits with it, indefinitely. With one, the call fails with
`IMQ_RPC_CALL_TIMEOUT` when the time is up, which the gateway should answer as
`504`.

### Can I run several copies of the gateway?

Yes. Each client receives its answers on its own queue, so every answer returns
to the gateway that asked. In our test, three gateways answered 3,000 requests
with no misrouted answers and no shared state.

### How do I shut down an Express gateway without dropping requests?

Give every client in the process `handleSignals: false`, then handle `SIGTERM`
yourself: close the HTTP server, wait for it to finish the requests it has
accepted, and only then destroy the clients. In our test, that took a restart
under load from 15 cut-off requests to none.

## Reference

[`IMQClientOptions.callTimeout`](/api/rpc/latest/rpc.imqclientoptions.calltimeout/) ·
[`IMQClientOptions`](/api/rpc/latest/rpc.imqclientoptions/) ·
[`IMQRPCError`](/api/rpc/latest/rpc.imqrpcerror/) ·
[`IMQMetadata`](/api/rpc/latest/rpc.imqmetadata/) ·
[`IMQClient.start()`](/api/rpc/latest/rpc.imqclient.start/) ·
[`IMQClient.destroy()`](/api/rpc/latest/rpc.imqclient.destroy/) ·
[Bonus: REST & OpenAPI gateway with Swagger UI](/tutorial/rest-api/) ·
[Deadlines for queued calls](/blog/request-deadlines-queued-calls-nodejs/) ·
[Rate limiting across instances](/blog/rate-limiting-nodejs-api-redis/) ·
[Graceful shutdown and zero-drop deploys](/blog/graceful-shutdown-zero-drop-deploys/)
