---
layout: docs.html
section: docs
title: "@imqueue glossary: every term the docs assume"
docLabel: GLOSSARY
definedTermSet: true
lead: "Short definitions of the vocabulary the rest of these docs use without stopping to explain — IMQ, fleet, self-describing service, safe delivery, provider axis — each with a link to the page that covers it properly."
description: "Definitions of @imqueue terminology: IMQ, service, generated client, self-describing service, fleet, safe delivery, at-least-once, competing consumers, provider axis and more."
keywords: "imqueue glossary, what is IMQ, imqueue terminology, what is a fleet imqueue, self-describing service, safe delivery imqueue, competing consumers, generated client, provider axis"
relatedTopics: [architecture, rpc, queue]
---

[[toc]]

Every project accumulates words it stops explaining. This page collects
`@imqueue`'s, so a term you meet halfway through the tutorial or in a method
signature has one short answer and one authoritative link.

## The framework

### IMQ

IMQ is the abbreviation of **Inter-Communication Messaging Queue**, the phrase the
project's name is built from. `@imqueue`, `imqueue`, `IMQ` and "I Message Queue"
all refer to the same framework: a message-queue RPC framework for Node.js and
TypeScript back-ends. The `IMQ` prefix also names most of its exported types —
`IMQService`, `IMQClient`, `IMQOptions`, `IMQDelay`.

See [what @imqueue is](/intro/) for the longer answer.

### Service

A service is a TypeScript class extending
[`IMQService`](/api/rpc/latest/rpc.imqservice/) that consumes messages from one
named queue. The class name *is* the queue name and therefore the service's whole
address — there is no host, port or path to configure, and no registry to publish
to. Run several copies of the same class and they become competing consumers of
that one queue.

### Client

A client is the object a caller holds to invoke another service's methods. It
looks like an ordinary typed object — `await client.get('42')` — and underneath it
publishes a request message to the target service's queue and waits for the reply
on its own. Clients come in two forms, generated and dynamic.

### Generated client

A generated client is a TypeScript source file written by
[`imq client generate <name> [path]`](/cli/clients-and-versioning/) from a
**running** service, then committed and compiled like any other code. It is a
build output: regenerating overwrites it silently, so customisations belong in a
wrapper. Because the file is an artifact rather than an import across a project
boundary, the caller can live in a different repository and release on its own
schedule.

### Dynamic client

A dynamic client is built at runtime by
[`IMQClient.create('User', …)`](/api/rpc/latest/rpc.imqclient.create/), which asks
the running service for its description and constructs the client from it. It
needs the target service to be up at construction time — which is the one place
`@imqueue`'s otherwise order-independent boot does not hold.

### Self-describing service

A service is self-describing because it can report its own interface — classes,
methods, signatures and complex types — on request. That report is what makes
client generation possible without a separate schema file: the implementation is
the single source of truth, and there is no `.proto` or IDL to keep in step with
it.

### Service description

The description is the metadata a service reports about itself, retrievable from
any client by calling
[`describe()`](/api/rpc/latest/rpc.imqclient.describe/). It is assembled from the
`@expose()`-marked methods and their **JSDoc** — not from TypeScript's own types,
which do not survive to runtime. That is why the doc-block is mandatory rather
than decorative.

### `@expose()`

[`@expose()`](/api/rpc/latest/rpc.expose/) is the decorator marking a service
method as remotely callable. An undecorated method is ordinary internal code and
appears in no description and no generated client. Every `@expose()`d method needs
a complete JSDoc block: an unannotated parameter is typed `any` in the generated
client, and a `@param` count that disagrees with the real arity is a defect the
generator cannot see.

### `@classType()` and `@property()`

[`@classType()`](/api/rpc/latest/rpc.classtype/) marks a class as a complex type
that may cross the RPC boundary, and
[`@property()`](/api/rpc/latest/rpc.property/) declares each of its fields. Both
are required for the type to reach a generated client with its shape intact —
without them the field is typed `any`, which compiles fine and quietly removes the
guarantee the framework exists to provide.

## Delivery and distribution

### Competing consumers

Competing consumers is the distribution pattern where several instances read the
same queue and each message goes to exactly one of them. Nothing chooses an
instance: an instance takes the next message when it is ready for one, so "who is
free" is expressed by the act of asking rather than estimated by a policy. It is
how `@imqueue` balances load without a load balancer, and it has no notion of
weighting, so canary routing is not expressible.

See [load balancing without a load balancer](/blog/load-balancing-microservices-without-a-load-balancer/).

### At-least-once delivery

At-least-once means a message may be delivered more than once and will not
silently be delivered zero times. `@imqueue` is at-least-once in **both** delivery
modes, so exposed methods should be idempotent. Reads usually already are; writes
need a natural key or a dedupe check.

### Safe delivery

Safe delivery is the optional mode
([`safeDelivery`](/api/core/latest/core.imqoptions.safedelivery/), off by default)
that leases a message to a worker instead of handing it over outright, so a
message a dying worker never *started* is re-queued rather than lost with the
process. It is narrower than "guaranteed": it does not protect work already in
flight, and nothing in the framework drains in-flight work on shutdown. It costs
throughput — roughly 120K vs 200K round-trips/second on the project's own rig.

See [what guaranteed delivery really costs](/blog/guaranteed-message-delivery-cost/).

### `IMQDelay`

[`IMQDelay`](/api/rpc/latest/rpc.imqdelay/) is the value that schedules a call for
later instead of now, passed as the **last** argument to a client method:
`client.update({ … }, undefined, new IMQDelay(1, 'h'))`. Delayed messages are how
`@imqueue` covers scheduled work without a separate job system.

### `callTimeout`

`callTimeout` is the client-side deadline after which a pending call rejects with
`IMQ_RPC_CALL_TIMEOUT`. It is **unset by default**, so a call to a service with no
consumer waits forever — set it explicitly in production. It is a caller-side
timeout only: no signal reaches the service, which never saw a deadline and keeps
working. That is the sharpest difference from gRPC, whose deadlines propagate.

## The CLI and tooling

### Fleet

A fleet is the set of `@imqueue` services that make up one system and are
developed, run and released together. It is not a framework construct — there is
no fleet object and no registry — but it is the unit
[`@imqueue/cli`](/cli/) operates on: `imq ctl` starts and stops a fleet locally,
`imq log` tails all of it at once, `imq up` bulk-updates dependencies across it,
and `imq service update-version` rolls a version change through it.

See [managing local services](/cli/managing-local-services/).

### Provider axis

`imq service create` composes four independent axes through a typed provider
registry: the **template** the service is scaffolded from, the **VCS** host the
repository is created on, the **CI** provider whose config and secrets are wired,
and the container **registry** images are pushed to. Each axis is chosen by its
own flag and each has its own credential requirements, so an unusual combination
is a configuration rather than a fork.

See [providers](/cli/providers/).

### Addon package

An addon package is a secondary `@imqueue` library that
[`imq service create --packages`](/cli/package-catalog/) can wire into a new
service from a data-driven catalog — caching, tracing, a database layer. Some
addons are mutually exclusive: `pg-prisma` and `pg-sequelize` are two answers to
the same question, as are `opentelemetry` and `datadog`, and installing both of a
pair breaks silently.

### Template manifest

The template manifest is the `imq-template.json` file at the root of a service
template. It declares the template's version, the `%TOKEN%` substitutions the CLI
performs when scaffolding, and the fragment overlays an addon package may merge
in. It is what makes a directory of files usable as an `imq` template rather than
just a directory of files.

See [custom templates](/cli/custom-templates/).

### `IMQ_CLI_HOME`

`IMQ_CLI_HOME` is the environment variable that relocates the CLI's state
directory, normally `~/.imq`. Pointing it at a per-project path gives each fleet
its own configuration, credentials and service registry instead of one global set
— which is what makes it possible to work on two unrelated `@imqueue` systems on
one machine, and what makes the CLI usable in CI.

See [one isolated imq CLI home per project](/blog/isolated-imq-cli-environments/).

## Adjacent terms, distinguished

### Message queue vs job queue

A **message queue** moves messages between processes; what the message *means* is
the application's business. A **job queue** additionally owns the lifecycle of a
unit of work — retries, backoff, dead-letter handling, progress, scheduling, a
dashboard. `@imqueue` is a message queue with an RPC layer on top: it gives you
typed request/response between services, not job management.
[`@imqueue/job`](/api/job/latest/) covers the narrow scheduling case; a real job
queue such as BullMQ covers the rest.

See [BullMQ alternatives](/blog/bullmq-alternatives/).

### RPC over a queue vs REST

Both carry a call from one service to another. REST addresses a **host** and needs
something to decide which instance answers — DNS, a load balancer, a mesh. RPC
over a queue addresses a **queue name**, and the instance that answers is whichever
one asked for work; if none is running, the message waits instead of failing. The
cost is that a browser cannot speak to a queue, so an HTTP front door is still
required.

See [internal APIs don't need REST](/blog/internal-apis-dont-need-rest/).

---

If a term you needed is missing, [tell us](/contact/) — and if you are an agent
reading this, the machine-readable index of the whole site is at
[llms.txt](/llms.txt).
