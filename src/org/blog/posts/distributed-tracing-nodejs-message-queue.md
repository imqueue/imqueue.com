---
layout: post.html
permalink: /blog/distributed-tracing-nodejs-message-queue/
templateEngineOverride: md
title: "Distributed tracing for Node.js services over a message queue"
summary: "The standard objection to queue-based RPC is that you lose the trace: the caller sends, something else picks it up, and the connection between them is gone. It isn't — the trace context rides in the request metadata. Here is a measured three-process trace, and the four ways it silently comes out wrong."
description: "How distributed tracing works across a message queue in Node.js: one trace over three processes, reading queue wait from the span gap, and the silent failure modes."
keywords: "distributed tracing nodejs microservices, opentelemetry message queue, trace context propagation queue, opentelemetry nodejs rpc, tracing async messaging, imqueue opentelemetry"
date: 2026-08-13
author: serhiy-morenko
illustration: tracing
topics: [observability, rpc, queue, patterns]
ogType: article
---

The usual argument against putting RPC on a message queue is that you give up
observability. With an HTTP call there is a socket, a client and a server holding
it open, and a header to hang a trace id on. Put a broker in the middle and the
caller's involvement appears to end at `send()`; something else, somewhere else,
later, does the work. The two halves look unrelatable.

They are not, and the reason is dull: a queue message has room for metadata, and
that is all trace propagation has ever needed. `@imqueue/opentelemetry` puts the
W3C trace context into the IMQ request's own metadata, under
`metadata.clientSpan`, and reads it back out on the handling side. A header and a
JSON field are the same idea.

What follows is that mechanism measured — three Node processes, a real Redis, a
span log I can diff — and then the four ways I could get it to produce wrong
answers, because those turned out to be the interesting part.

## One trace, three processes

The setup is an order service that charges through a billing service, and a
caller that calls the order service. Three processes, two queue hops. Each
process registers the instrumentation at start-up and writes finished spans to a
file; a script rebuilds the tree.

Registering it is the whole of the integration:

~~~typescript
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import { registerInstrumentations } from '@opentelemetry/instrumentation';
import { ImqueueInstrumentation } from '@imqueue/opentelemetry';

new NodeTracerProvider().register();

registerInstrumentations({
    instrumentations: [new ImqueueInstrumentation()],
});
~~~

No decorator on the service, no argument at the call site, no change to the
generated client. One `place()` call, and the span log across all three processes
reassembles into this:

~~~
trace d3ac295c867905ca628cd66e6ff21d16  (4 spans, 3 processes)
imq.request   Order.place                30.06ms  [caller]   +1.00ms before child started
  imq.response  Order.place              28.41ms  [order]    +0.00ms before child started
    imq.request   Billing.charge         27.42ms  [order]    +1.00ms before child started
      imq.response  Billing.charge       25.49ms  [billing]
~~~

One trace id, four spans, correct nesting two hops deep. The part worth pausing
on is the third span: `Billing.charge` is a call the order *service* makes from
inside a handler, and it nested under that handler's span rather than starting a
new trace. That nesting is not free, and it is the reason the service side uses
`wrapCall` — the around-hook — rather than the before/after pair the client uses.
The handler is invoked inside `context.with(...)`, so the active OpenTelemetry
context while your method body runs is the server span, and anything that body
traces becomes its child. Take that away and you get four spans in three traces
instead of one trace with four spans.

## The gap between the two spans is the queue

A CLIENT span opens in `beforeCall`, before the message is written, and closes in
`afterCall`, when the reply comes back. The SERVER span opens when the handler is
about to run. Neither of those is remarkable on its own; the space between them
is, because on a queue it is a real thing that HTTP does not have — the message
sitting in Redis, waiting for a consumer.

That is what the `+1.00ms before child started` column above measures: 1ms from
the caller starting its span to the order service starting its own. Under load,
or with every consumer busy, that number is where the latency will be, and it is
visible without instrumenting anything yourself. It is also the number that makes
a delayed call look alarming, which is the last section of this post.

## The failure that matters: a trace that begins in the middle

The instrumentation works by mutating `@imqueue/rpc`'s exported default option
singletons. `enable()` reaches into `DEFAULT_IMQ_CLIENT_OPTIONS` and
`DEFAULT_IMQ_SERVICE_OPTIONS` and attaches the hooks there. It deliberately does
not intercept module loading — for an ESM package that needs
import-in-the-middle and a rewritten module graph, which is fragile in a
different and worse way.

The consequence is a timing rule: a client or service constructed **before**
`enable()` has already copied those defaults, and is never traced. The docs say
so plainly. What they do not say is what that looks like from the outside, so I
built it: one process, tracer provider registered first, one client constructed
before `registerInstrumentations` and one after, both calling the same method.

Both calls succeeded. `pay_early-1_4200`, `pay_late-1_4200`. And the span log
contains two traces for two identical calls:

~~~
trace c771148456d9f10521902b60843d5de6  (3 spans, 2 processes)
imq.response  Order.place                28.92ms  [order]    +0.00ms before child started
  imq.request   Billing.charge           27.79ms  [order]    +1.00ms before child started
    imq.response  Billing.charge         25.48ms  [billing]

trace e1e41fa0a489177e128746afc0456eec  (4 spans, 3 processes)
imq.request   Order.place                36.82ms  [caller]
  imq.response  Order.place              29.88ms  [order]
    imq.request   Billing.charge         28.52ms  [order]
      imq.response  Billing.charge       25.51ms  [billing]
~~~

The early client's call is the first trace. It is not missing — that would be
easy. It has three spans, two processes, the right durations, and a root span
that is `imq.response`: a service answering a request from nobody. The caller
injected no context, so the server span found no parent and became one.

This is worse than a gap in a dashboard, because nothing about it reads as
broken. Latency attribution is intact within the trace, the service graph looks
sane, and the only signal is that traces which should start at your entry point
sometimes start one hop in. On a fleet where most callers are fine, that is a
handful of odd-looking traces among thousands of good ones.

Two things follow. Put `registerInstrumentations` at the top of the process's
entry module, above the imports that build clients and services — which is what
the standard OpenTelemetry bootstrap does naturally, and one good reason to keep
tracing setup in its own module imported first. And if spans are missing
entirely, check for duplicate `@imqueue/rpc` installs at different tree depths
before anything else: the patch lands on whichever copy this package resolves,
and if the application imported a different one, `enable()` succeeds and nothing
is traced.

## Three span names, and the field to group by

There are exactly three span names, and none of them tells you which method ran:

| Span name | What it is |
|---|---|
| `imq.request` | a client issuing an RPC and awaiting the reply |
| `imq.response` | a service handling an inbound RPC |
| `method.call` | a method wrapped in the `traced` decorator |

The method is in the `resource.name` attribute — `Order.place`, `Billing.charge`,
`Reports.rebuild`. That split is deliberate: it lets a backend aggregate every
outbound RPC in the fleet as one operation and still break it down per method.
It also means filtering a dashboard by span name alone can never isolate a single
method, which is worth knowing before you build the dashboard.

The rest of the attribute set on a real span:

~~~json
{
  "span.kind":    "client",
  "resource.name":"Order.place",
  "service.name": "Order",
  "imq.client":   "OrderClient-b0b99528cb2f4113bdd673d9bc6d2a31-6:client",
  "component":    "imq"
}
~~~

Those are pre-OpenTelemetry, Datadog-shaped keys — `resource.name`,
`service.name`, `component` — not current semantic conventions. That is a
deliberate compatibility choice, and it is what lets these spans land in a
Datadog-shaped backend unmodified. If your backend wants
`rpc.service`/`rpc.method` instead, remap in a span processor; nothing in the
package reads these keys back, so renaming them breaks nothing.

`imq.client` is the underrated one. It is the calling client's queue name, which
carries the client class and the host it ran on, so "which deployment is calling
this method" is answerable from the span rather than from guesswork.

## An error marks both halves

A method that throws sends the error back to the caller, and both spans record
it. Measured on a handler that always throws:

~~~
order    imq.response  status=ERROR  msg="no such order: nope-1"  events=["exception"]
caller   imq.request   status=ERROR  msg="no such order: nope-1"  events=[]
~~~

Two details that decide how you query this. The failure detail is on the span
**status message**, not in an attribute — so a backend rule that reads
`error.message` off the attribute bag will find nothing. And `recordException`
runs on the service side only, so the stack-carrying exception event exists on
`imq.response` and not on `imq.request`; the client knows the message, not the
stack. Alert on span status, and read the detail from the status message.

The client's rejection is untouched by any of this: the instrumentation re-throws
what it was given. Tracing a call never changes what the caller sees.

## A deferred call is one very long span

`@imqueue/rpc` can defer a call by passing an `IMQDelay`, and — as
[delayed and scheduled work](/blog/scheduled-work-without-a-job-system/) covers —
that is still a real request/reply promise, pending across the whole delay. Which
means the CLIENT span is open for the whole delay too. A four-second delay,
measured:

~~~
trace e15baca2c525b5e1367b36247fdd2919  (4 spans, 3 processes)
imq.request   Order.place              4083.18ms  [caller]  +4052.00ms before child started
  imq.response  Order.place              30.74ms  [order]   +1.00ms before child started
    imq.request   Billing.charge         29.05ms  [order]   +2.00ms before child started
      imq.response  Billing.charge       25.76ms  [billing]
~~~

The trace is correct — one trace id across a four-second gap, because the context
travels in the message and the message waits in Redis. It is also, read quickly,
a four-second p99 on `Order.place`. There were 30.74ms of work in it.

So: a deferred RPC belongs in a different latency bucket from a synchronous one,
and if you defer by hours you will have hour-long spans, with everything that
implies for a backend's ingest limits. Worse, a process that restarts while one
is pending never runs `afterCall` — the resolver lives only in the caller's
memory — so the span is never ended, and a span that never ends is never
exported. The call is lost and so is its evidence. If you are deferring work by
more than a few seconds, that is an argument for `@imqueue/job` rather than a
delayed RPC, and the tracing story is one more reason.

## The manual tools, and what they will not do for you

Automatic spans cover RPC. For work that is not an RPC but is worth seeing — a
cache rebuild, a report query, a third-party HTTP call — there is a decorator:

~~~typescript
import { traced, TraceKind } from '@imqueue/opentelemetry';

class Reports {
    @traced()
    public async rebuild(day: string): Promise<void> {
        // span stays open until this promise settles
    }

    @traced({ kind: TraceKind.CLIENT, tags: { 'peer.service': 'stripe' } })
    public async fetchInvoices(userId: string): Promise<Invoice[]> {
        return this.http.get(`/invoices/${ userId }`);
    }
}
~~~

It does the things you would hope. A returned promise keeps the span open until
it settles, so the duration is the work and not the time to return a promise. A
rejection or a synchronous throw records the error, marks the span `ERROR`, ends
it and re-throws. `tags` are applied after the automatic attributes, so you can
override any of them, `resource.name` included.

The one thing it does not do is establish context, and this surprised me enough
to measure it. A `traced()` method that makes an RPC from inside its body:

~~~
method.call   Reports.rebuild        31.64ms  trace=986f74d4  parent=ROOT
imq.request   Order.place            30.83ms  trace=32bb544a  parent=ROOT
~~~

Two roots, two different traces, for one nested piece of work. The span is
created but never made active, so the RPC inside the method does not know it has
a parent. `ImqueueInstrumentation` establishes context for RPC handlers;
`traced()` does not. Use it to time a leaf, and do not expect it to be a
container.

`traceStart()`/`traceEnd()` cover the last case — a block no decorator can wrap.
The spans live in a module-level registry keyed by name, which is what lets
`traceEnd()` close one from an unrelated call site, and that registry has three
consequences all worth knowing:

~~~
[manual] second traceStart threw: TypeError: Trace with name collision has been already started!
~~~

A name holds one open span at a time, and a second `traceStart()` under a live
name throws rather than silently replacing it — replacing would leak the first
forever. An unclosed span is never exported: my `never-closed` probe span is
absent from every log, which is why the `try`/`finally` in the docs is not
decoration. And a `traceStart` span gets **no** `resource.name` — only the tags
you pass — so if you want these grouped alongside the rest, set it yourself:

~~~typescript
traceStart('import-batch', {
    'resource.name': 'Importer.batch',
    'batch.size': String(rows.length),
});

try {
    await importRows(rows);
} finally {
    traceEnd('import-batch');
}
~~~

## What it costs

Less than I could measure. A no-op RPC round trip, 2000 sequential calls, three
runs each way, client-side instrumentation on and off against the same service:

| | mean | p50 | p95 | p99 |
|---|---|---|---|---|
| untraced | 0.414 – 0.576ms | 0.273 – 0.418ms | 1.00 – 1.48ms | 1.30 – 1.94ms |
| traced | 0.348 – 0.486ms | 0.176 – 0.327ms | 1.29 – 1.40ms | 1.81 – 1.96ms |

The ranges overlap, and the fastest run of the six was a traced one. On a
sub-millisecond round trip the per-call cost of starting a span, injecting
context into a JSON object and ending the span is under the run-to-run noise of
the transport itself. That is a claim about span *creation*, not about export:
what a collector, a sampler and a network hop cost is your SDK configuration's
problem, and it is where the real budget goes. This package only produces spans —
without a tracer provider registered, they go nowhere, silently.

## OpenTelemetry or Datadog, never both

There are two packages, they cover the same ground, and they are not additive:

- **`@imqueue/opentelemetry`** is the default. Vendor-neutral, so the backend can
  change without touching service code.
- **`@imqueue/datadog`** is a drop-in replacement for `dd-trace` — import it
  instead, call `init()` as usual, and every RPC is traced. Take it only for a
  fleet already standing on Datadog's own agent.

They patch the same `@imqueue/rpc` hooks, so installing both means whichever
loads last wins, silently. Pick one. Both were renamed from longer names —
`@imqueue/opentelemetry-instrumentation-imqueue` and `@imqueue/dd-trace` — which
are deprecated; a service still declaring one should be moved.

The Datadog package differs in one way worth knowing if you go that route: its
hooks install at **import** time rather than on an `enable()` call, so the
ordering rule is about where you import it, and `init()` is what starts
reporting. Both halves are configurable as an ordinary `dd-trace` plugin:

~~~typescript
tracer.use('imq', { client: false });     // trace incoming calls only
tracer.use('imq', { service: 'my-api' }); // report both halves as `my-api`
~~~

## FAQ

### How does trace context survive a message queue?

The trace context is injected into the IMQ request's own metadata, under
`metadata.clientSpan`, before the message is written — and extracted from it on
the handling side, where it becomes the parent of the SERVER span. A queue
message has room for metadata, so propagation needs nothing that an HTTP header
would not also need. It survives a delayed message sitting in Redis for seconds
or hours, because the context travels with the message rather than with a
connection.

### Why are my @imqueue spans missing?

Three causes, in the order worth checking. The client or service was constructed
before the instrumentation was enabled, so it copied untraced defaults — register
`ImqueueInstrumentation` at the top of the entry module, before anything builds a
client. Or no tracer provider is registered, in which case the package produces
spans that go nowhere, since exporting them is the host application's job. Or
there are duplicate `@imqueue/rpc` installs at different tree depths, so the
patch landed on a copy the application never imported.

### Can I see how long a call waited in the queue?

Yes, without instrumenting anything extra: it is the gap between the CLIENT span
starting and its child SERVER span starting. The client span opens before the
message is written and the server span opens when the handler is about to run, so
the difference is time spent in Redis plus dispatch. On an idle fleet that is
about a millisecond; when it grows, it is telling you consumers are saturated
rather than slow.

### Does tracing slow @imqueue down?

Span creation did not register above measurement noise: across 2000-call runs of
a no-op RPC, traced and untraced mean latencies overlapped at 0.35–0.58ms. The
cost that matters is export — sampling, batching, the collector hop — which is
configured in the OpenTelemetry SDK rather than in this package, since it only
produces spans.

### Should I use @imqueue/opentelemetry or @imqueue/datadog?

Take `@imqueue/opentelemetry` unless the fleet already runs Datadog's own agent,
in which case take `@imqueue/datadog`. Never install both: they patch the same
`@imqueue/rpc` hooks and whichever loads last silently wins. Both are optional —
a fleet that does not need distributed tracing needs neither.

## Where this leaves the objection

"You cannot trace async messaging" is wrong, and it is wrong in a specific way
worth naming: the trace is not lost by the queue, it is lost by instrumentation
that was wired up in the wrong order. Every failure in this post is a
registration-time mistake or a misread span, not a limit of putting a broker
between two services.

What the queue does change is what a trace *means*. There is a real waiting
period between the two halves of every call, deferred work produces spans whose
duration is mostly deliberate idleness, and a span that never closes because its
process restarted is a category of loss HTTP does not have. Those are worth
building dashboards around rather than being surprised by.

~~~bash
npm i --save @imqueue/opentelemetry
~~~

The [full API reference](/api/opentelemetry/latest/) covers
[`ImqueueInstrumentation`](/api/opentelemetry/latest/opentelemetry.imqueueinstrumentation/),
the [`traced()`](/api/opentelemetry/latest/opentelemetry.traced/) options,
[`traceStart()`](/api/opentelemetry/latest/opentelemetry.tracestart/) and the
full [attribute](/api/opentelemetry/latest/opentelemetry.attributenames/) and
[span-name](/api/opentelemetry/latest/opentelemetry.spannames/) sets; the
[Datadog reference](/api/datadog/latest/) covers the plugin options. For the
one-question version of the setup, the [API FAQ](/api/faq/) has it.
