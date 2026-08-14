---
layout: docs.html
section: api
title: "FAQ: how to do the common things with @imqueue"
docLabel: FAQ
crumbLeaf: FAQ
heading: Frequently Asked Questions
lead: "Direct answers to the questions developers are actually asking — each one linking the reference for the symbols it names."
description: "@imqueue FAQ: expose a method, generate a typed client, cache and invalidate, validate arguments, delay and retry jobs, trace, log, auto-scale and rate-limit."
keywords: "imqueue faq, expose service method, imqueue generate typed client, classType property decorators, removeComments false imqueue, pg-cache cacheBy, imqueue job delay retry, PgPubSub singleListener, graphql N+1 microservices, ImqueueInstrumentation, LOGGER_TRANSPORTS, imqueue metrics server queue_length, kubernetes HPA queue length autoscaling, redis-broker-promoter, redis-broker-unicaster, UDPClusterManager, HttpProtect express middleware, CIDR membership Node.js"
relatedTopics: [rpc, dx, patterns, jobs]
faqPage: true
---

[[toc]]

## Services, methods and typed clients

### How do I build my first TypeScript RPC service, step by step?

Install the CLI, scaffold a service, implement the methods you want to expose,
run it, and generate a typed client from the running process. Five commands, and
the only prerequisites are Node.js 22.12+ and a reachable Redis 6.2+.

~~~bash
npm i -g @imqueue/cli
mkdir user-service && cd user-service
imq service create
npm run dev                                     # terminal 1: the service
imq client generate UserService ./src/clients   # terminal 2: the client
~~~

What the scaffold gives you is a class extending `IMQService` with `@expose()` on
each remotely callable method. There is no schema file and no IDL: the generated
client is built by asking the running service to describe itself, which is why
step four has to be running before step five.

Reference: [`IMQService`](/api/rpc/latest/rpc.imqservice/) ·
[`expose()`](/api/rpc/latest/rpc.expose/) ·
[`IMQClient.create()`](/api/rpc/latest/rpc.imqclient.create/). Worked
walkthroughs: [Get started](/get-started/) and the [Tutorial](/tutorial/).

### How do I expose a service method so it can be called remotely?

Decorate it with `@expose()` and give it a JSDoc block with typed `@param` and
`@returns` tags. A method without the decorator is absent from the service
description and stays callable in-process only — a remote call to it is rejected
with `IMQ_RPC_NO_ACCESS`.

~~~typescript
import { IMQService, expose } from '@imqueue/rpc';

export class UserService extends IMQService {
    /**
     * Returns how many users are active
     *
     * @return {Promise<number>} - the number of active users
     */
    @expose()
    public async countActive(): Promise<number> {
        return this.users.filter(user => user.isActive).length;
    }
}
~~~

Four things decide whether it actually works. The doc-block is not decoration:
it is the only type source the client generator has, and the documented `@param`
list is also what the service's argument-count check validates — it must match
the method's real arity or calls fail with `IMQ_RPC_INVALID_ARGS_COUNT`. Combined
with `@lock()`, `@cache` or `@logged()`, `@expose()` must be the innermost
decorator, listed last: those replace the method with a `(...args)` wrapper, and
registering the wrapper records its rest parameter as the method's only argument.
It applies to instance methods only — on a `static` method it silently registers
under the pseudo-class name `Function` and the method stays unreachable. And
under standard decorators registration is deferred to an initializer that runs on
first construction, so the description is empty until an instance exists.

Reference: [`expose()`](/api/rpc/latest/rpc.expose/) ·
[`IMQService`](/api/rpc/latest/rpc.imqservice/) ·
[`lock()`](/api/rpc/latest/rpc.lock/) · [`cache`](/api/rpc/latest/rpc.cache/) ·
[`logged()`](/api/rpc/latest/rpc.logged/)

### How do I return a complex type over RPC with classType and property?

Declare the type as a class, put `@classType()` on the class and `@property()` on
each field that crosses the wire. `@property()`'s first argument is the type in
TypeScript notation, and a second argument of `true` marks the field optional.
That pair is what lets the service and the generated client agree on the shape.

~~~typescript
import { classType, property } from '@imqueue/rpc';

@classType()
export class UserObject {
    @property('string')
    id: string;

    @property('boolean')
    isActive: boolean;

    // optional — pass true as the second argument
    @property('string', true)
    nickname?: string;
}
~~~

Under standard (TC39) decorators — the protocol `@imqueue/rpc` targets — a field
decorator cannot see its own class, so `@property()` only collects field
metadata and `@classType()` is what flushes it under the class name. Omitting it
raises no error: the type is silently missing from the RPC type description and
generated clients then reference a type nobody declared. `@indexed()` performs
the same flush plus an index signature, so a class carrying it does not also need
`@classType()`. A field may name another complex type (`'UserCarObject'`) or an
array of one (`'UserCarObject[]'`); everything crossing the queue is JSON, so
returning a plain object literal instead of a declared class works at runtime and
types the field `any` on the client.

Reference: [`classType()`](/api/rpc/latest/rpc.classtype/) ·
[`property()`](/api/rpc/latest/rpc.property/) ·
[`indexed()`](/api/rpc/latest/rpc.indexed/)

### Why must removeComments be false in a project that uses @imqueue?

Because the JSDoc block on an exposed method is the runtime type source. Standard
decorators provide no runtime type reflection, so the client generator reads the
doc-block and nothing else — strip comments and it sees no types at all:
parameters and return values degrade to `any`, and the `@param` list the
service's argument-count check validates against disappears with them.

~~~jsonc
{
  "compilerOptions": {
    "target": "es2024",
    "lib": ["es2024", "esnext.decorators"],
    "experimentalDecorators": false,

    // doc-blocks are the only type source the generator reads,
    // so stripping comments leaves it nothing
    "removeComments": false
  }
}
~~~

This is a property of the consuming project, not of the packages: your service
compiles fine with comments stripped, and the damage shows up later as an
untyped or empty generated client.

Reference: [`expose()`](/api/rpc/latest/rpc.expose/) ·
[`@imqueue/rpc` package reference](/api/rpc/latest/) ·
[migration from 2.x to 3.x](/api/#migration-from-2-x-to-3-x)

### How do I generate a typed client for a running service?

Run `imq client generate <ServiceName> <outDir>` while the service is up with
Redis reachable. Generation works by asking the running service to describe
itself, so there is no schema file to keep in step — and nothing to generate from
if the process is not running.

~~~bash
imq client generate UserService ./src/clients
~~~

The generated file exports exactly one thing: a namespace named after the service
with a lower-case first letter, holding a client class whose name is the
service's with a trailing `Service` replaced by `Client`. So `UserService` gives
you `userService.UserClient`, and there is no top-level `UserClient` to import.
Treat the file as a build artefact — regenerate it when the interface changes,
`-o` overwrites without prompting. `IMQClient.create()` does the same job
in-process when you would rather not shell out.

~~~typescript
import { userService } from './src/clients/UserService.js';

const client = new userService.UserClient();

await client.start();
try {
    console.log(await client.countActive());
} finally {
    await client.destroy();   // or the process will not exit
}
~~~

Reference: [`IMQClient.create()`](/api/rpc/latest/rpc.imqclient.create/) ·
[`IMQClient`](/api/rpc/latest/rpc.imqclient/) ·
[Clients & Versioning](/cli/clients-and-versioning/)

## Validating input

### How do I validate method arguments with decorators before the method runs?

Declare the rules on the input class — `@validate()` per field, `@validatable()`
on the class to seal them — and guard the method with `@validated(...)`. The
check runs before the method body, and the body then receives exactly what the
caller passed.

~~~typescript
import { z } from 'zod';
import { validatable, validate, validated } from '@imqueue/validation';

@validatable()
class Credentials {
    @validate(z.string().email())
    email!: string;

    @validate(z.string().min(8))
    password!: string;
}

class AuthService {
    @validated(Credentials)
    async signIn(creds: Credentials): Promise<string> {
        return `token-for-${creds.email}`;
    }
}
~~~

`@validatable()` is not optional bookkeeping. Field validators are buffered until
a class decorator claims them, so a class that uses `@validate()` without it
hands its fields to the next class that *is* sealed — which then rejects valid
input over properties it does not declare, while the class with the real mistake
validates nothing. Note also that arguments are checked but never replaced, so
transforming schemas (`z.coerce.number()`, `.trim()`, `.default(...)`) validate as
expected and change nothing the method sees. And a failure does not reach a
remote caller as a `ZodError`: `@imqueue/rpc` converts whatever a method throws
into its own error payload, so the caller sees `IMQ_RPC_CALL_ERROR` with Zod's
issue list as the message string.

Reference: [`validated()`](/api/validation/latest/validation.validated/) ·
[`validate()`](/api/validation/latest/validation.validate/) ·
[`validatable()`](/api/validation/latest/validation.validatable/) ·
[`schemaOf()`](/api/validation/latest/validation.schemaof/)

## Caching results

### How do I cache a service method result and invalidate it when a table row changes?

Decorate the service class with `@PgCache()` and the method with `@cacheWith()`,
naming the tables the result depends on. PostgreSQL then decides when the entry
dies: `@PgCache()` installs a change-notify trigger on each declared table and
subscribes to one LISTEN/NOTIFY channel per table, and a row change drops every
entry tagged with that table. So the entry lives exactly as long as the data
behind it is unchanged — no guessed TTL, no manual `del()`.

~~~typescript
import { PgCache, cacheWith } from '@imqueue/pg-cache';

@PgCache({
    postgres: process.env.DB_URL!,
    redis: { host: 'localhost', port: 6379 },
})
class UserService extends IMQService {
    @cacheWith({ channels: ['users'] })
    public async list(): Promise<User[]> {
        return this.db.query('SELECT * FROM users');
    }
}
~~~

Two things to know before you rely on it. The triggers and the subscription are
established in `start()`, so a service that never starts is never cached. And a
`ChannelFilter` given as an array of `ChannelOperation` is an *exclusion* list —
the operations named in it are the ones that do not invalidate — which reads the
opposite way round from how it looks.

Reference: [`PgCache()`](/api/pg-cache/latest/pg-cache.pgcache/) ·
[`cacheWith()`](/api/pg-cache/latest/pg-cache.cachewith/) ·
[`CacheWithOptions`](/api/pg-cache/latest/pg-cache.cachewithoptions/) ·
[`ChannelFilter`](/api/pg-cache/latest/pg-cache.channelfilter/) ·
[`ChannelOperation`](/api/pg-cache/latest/pg-cache.channeloperation/)

### What does the pg-cache cacheBy decorator do that cacheWith does not?

`@cacheWith()` names its tables literally; `@cacheBy()` derives them from a model
and narrows invalidation using the field map the caller actually asked for, so a
change to a column nobody selected does not drop the entry. It is the same
mechanism with a smaller blast radius.

~~~typescript
import { cacheBy } from '@imqueue/pg-cache';

class UserService extends IMQService {
    // fields is the 2nd argument, which is where cacheBy looks by default
    @cacheBy(User, { ttl: 30000 })
    public async list(filter: UserFilter, fields?: any): Promise<User[]> {
        return this.repo.find(filter, fields);
    }
}
~~~

`fieldsArg` is the zero-based position of that field map among the method's
runtime arguments. Omit it and the decorator looks at the second argument — the
position `@imqueue/pg-sequelize` services pass it in — and pass `-1` to disable
the analysis explicitly. The field map itself is the kind of thing
`fieldsMap()` from `graphql-fields-list` produces from an incoming GraphQL
request, which is where most callers get one.

Reference: [`cacheBy()`](/api/pg-cache/latest/pg-cache.cacheby/) ·
[`CacheByOptions`](/api/pg-cache/latest/pg-cache.cachebyoptions/) ·
[`CacheByOptions.fieldsArg`](/api/pg-cache/latest/pg-cache.cachebyoptions.fieldsarg/) ·
[`channelsOf()`](/api/pg-cache/latest/pg-cache.channelsof/) ·
[`cacheWith()`](/api/pg-cache/latest/pg-cache.cachewith/)

### How do I cache one value that several unrelated events should invalidate?

Store it with a set of tags and invalidate a tag rather than a key.
`@imqueue/tag-cache` keeps values under their own keys and additionally adds each
key to a Redis set per tag, so dropping a tag drops everything stored under it —
which is exactly what plain key-based caching cannot express.

~~~typescript
import { RedisCache } from '@imqueue/rpc';
import { TagCache } from '@imqueue/tag-cache';

const cache = new TagCache(await new RedisCache().init({ prefix: 'app' }));

await cache.set('user:1:invoices', invoices, ['user:1', 'invoices'], 60000);

// when user 1 changes: drops the entry above, and anything else
// tagged user:1, whatever key it was stored under
await cache.invalidate('user:1');
~~~

Reads and writes never throw on a Redis failure — they log and report it in the
return value, so an outage degrades to cache misses instead of taking the caller
down. Two consequences worth holding on to: `get()` returning `null` means "not
cached *or* the lookup failed", and `invalidate()` resolves once the work is
issued, not once the keys are gone.

Reference: [`TagCache`](/api/tag-cache/latest/tag-cache.tagcache/) ·
[`TagCache.set()`](/api/tag-cache/latest/tag-cache.tagcache.set/) ·
[`TagCache.invalidate()`](/api/tag-cache/latest/tag-cache.tagcache.invalidate/) ·
[`TagCache.get()`](/api/tag-cache/latest/tag-cache.tagcache.get/)

## Background and delayed work

### How do I run a job later with a delay and retry it if it fails?

Push it with `{ delay }` and return a positive number from the handler to have it
come back. The retry policy lives in the handler rather than in queue
configuration, because the handler's return value *is* the re-scheduling
instruction.

~~~typescript
import JobQueue from '@imqueue/job';

const queue = new JobQueue<Email>({ name: 'Email' });

queue.onPop(async (email: Email) => {
    try {
        await send(email);
        return -1;              // done; no re-schedule
    } catch (err) {
        return 60000;           // try again in a minute
    }
});

await queue.start();

queue.push({ to: 'a@b.c', subject: 'Later' }, {
    delay: 3600000,      // not before an hour from now
    ttl: 86400000,       // and stop re-scheduling after a day
});
~~~

| Handler outcome | Effect |
| --- | --- |
| returns a positive number | re-scheduled after that many milliseconds |
| returns `0` | re-scheduled immediately — a hot loop, never use it to stop |
| returns a negative number, or nothing | stops; no re-schedule |
| throws | re-scheduled with the delay the job was *originally pushed with* |

That last row is the trap: a job pushed with no delay and then throwing is
dropped rather than retried. Catch your own errors and return a number. `ttl`
bounds how long a job stays worth re-scheduling, counted from the push. Delivery
is at-least-once, so handlers must be idempotent, and job data travels as JSON —
class instances, `Date` and `undefined` properties do not arrive as they left.

Reference: [`JobQueue`](/api/job/latest/job.jobqueue/) ·
[`JobQueuePopHandler`](/api/job/latest/job.jobqueuepophandler/) ·
[`PushOptions.delay`](/api/job/latest/job.pushoptions.delay/) ·
[`PushOptions.ttl`](/api/job/latest/job.pushoptions.ttl/) ·
[`JobQueueWorker`](/api/job/latest/job.jobqueueworker/) ·
[`JobQueuePublisher`](/api/job/latest/job.jobqueuepublisher/)

## PostgreSQL notifications

### How do I listen for Postgres notifications with only one replica handling each?

Use `PgPubSub` and leave `singleListener` at its default of `true`. LISTEN/NOTIFY
is a broadcast — every listening connection receives every notification, so a
service scaled to N replicas handles each message N times. In single-listener
mode the replicas compete for a per-channel lock held as a row in PostgreSQL,
only the holder listens, and the rest stay connected as hot standbys.

~~~typescript
import { type AnyJson, PgPubSub } from '@imqueue/pg-pubsub';

const pubSub = new PgPubSub({ connectionString: process.env.DB_URL });

pubSub.on('connect', async () => {
    await pubSub.listen('UserChanged');
});
pubSub.on('message', (channel: string, payload: AnyJson) =>
    handle(channel, payload),
);

await pubSub.connect();
~~~

The trade is worth stating plainly: this makes delivery at-most-once. NOTIFY has
no backlog, so anything published while no process holds the lock is gone. A
clean shutdown releases the lock and a standby takes over at once; an unclean
exit leaves the channel unhandled until the next acquire retry. PostgreSQL also
caps payloads at 8000 bytes. Where losing a message is unacceptable, pair this
with a durable queue rather than replacing one.

Reference: [`PgPubSub`](/api/pg-pubsub/latest/pg-pubsub.pgpubsub/) ·
[`PgPubSubOptions.singleListener`](/api/pg-pubsub/latest/pg-pubsub.pgpubsuboptions.singlelistener/) ·
[`PgPubSub.listen()`](/api/pg-pubsub/latest/pg-pubsub.pgpubsub.listen/) ·
[`PgPubSub.notify()`](/api/pg-pubsub/latest/pg-pubsub.pgpubsub.notify/)

### How does the PgPubSub inter-process lock work, and when should I turn it off?

`PgIpLock` holds the lock for one channel as a row in PostgreSQL and retries
acquiring it on an interval; it also installs `SIGINT`, `SIGTERM` and `SIGABRT`
handlers so a shutdown releases the lock and another process can pick the channel
up immediately. Turn it off — `singleListener: false`, which swaps in `NoLock` —
only when every replica genuinely needs to see every notification, such as
invalidating an in-process cache in each one.

~~~typescript
const pubSub = new PgPubSub({
    connectionString: process.env.DB_URL,
    singleListener: false,   // every replica handles every notification
});
~~~

`acquireInterval` is the tuning knob while the lock is on, and it is a real
trade-off in both directions: too short, with many replicas, floods the database
with lock-acquire requests; too long widens the window in which a silent
disconnect leaves a channel unhandled. You do not normally construct `PgIpLock`
yourself — `PgPubSub` does it — but it is exported so the mechanism can be reused
elsewhere.

Reference: [`PgIpLock`](/api/pg-pubsub/latest/pg-pubsub.pgiplock/) ·
[`NoLock`](/api/pg-pubsub/latest/pg-pubsub.nolock/) ·
[`PgPubSubOptions.singleListener`](/api/pg-pubsub/latest/pg-pubsub.pgpubsuboptions.singlelistener/) ·
[`PgPubSubOptions.acquireInterval`](/api/pg-pubsub/latest/pg-pubsub.pgpubsuboptions.acquireinterval/)

## GraphQL composition

### How do I avoid N+1 service calls when resolving nested GraphQL fields?

Take the loading out of the field resolvers. Declare a bulk loader per type and
the requirements between types once at start-up, then make a single `load()` call
in the top-level resolver: it walks the fields the client actually asked for,
merges everything that needs the same type into one filter, and calls each loader
once per level instead of once per parent object.

~~~typescript
import { Dependency } from '@imqueue/graphql-dependency';
import { fieldsMap } from 'graphql-fields-list';

// at start-up, next to the type definitions
Dependency(UserType).defineLoader(async (context, filter, fields) =>
    (await context.user.listUser(filter, fields)).data,
);

Dependency(CompanyType).require(UserType, () => ({
    as: CompanyType.getFields().employees,
    filter: {
        [UserType.getFields().companyId.name]: CompanyType.getFields().id,
    },
}));

// in the top-level company resolver
async function companies(source, args, context, info) {
    const data = await context.company.listCompany(args);

    return Dependency(CompanyType).load(data, context, fieldsMap(info));
}
~~~

Every object taking part must carry an `id` — loaded rows are matched back onto
their parents by id and by nothing else. Batching is per level rather than
global: siblings of one type run concurrently, and the next level down waits,
because a child's filter is built from values the parent level has just loaded.
The resolution cache lives for the duration of one `load()` call, so no request
can serve another request's stale data. On a `type-graphql` schema use
`@DependencyFor()` on the decorated class instead — and remember to run every
hook in `schemaHooks` after building the schema, because nothing else does, and
missing that step leaves the dependency fields silently empty.

For what that is worth in measured calls — the same query at 26 and at 3, why the
difference does not show up in latency until the system is busy, and the two ways
a dependency comes back silently empty — see
[the N+1 problem when GraphQL resolvers call microservices](/blog/graphql-n-plus-1-microservices/).

Reference: [`Dependency`](/api/graphql-dependency/latest/graphql-dependency.dependency/) ·
[`defineLoader()`](/api/graphql-dependency/latest/graphql-dependency.graphqldependency.defineloader/) ·
[`require()`](/api/graphql-dependency/latest/graphql-dependency.graphqldependency.require/) ·
[`load()`](/api/graphql-dependency/latest/graphql-dependency.graphqldependency.load/) ·
[`DependencyFor()`](/api/type-graphql-dependency/latest/type-graphql-dependency.dependencyfor/) ·
[`schemaHooks`](/api/type-graphql-dependency/latest/type-graphql-dependency.schemahooks/)

## Tracing and logging

### How do I register OpenTelemetry instrumentation once at startup so every RPC is traced?

Register `ImqueueInstrumentation` at start-up, before any client or service is
constructed. Every RPC through `@imqueue/rpc` then produces a CLIENT span on the
calling side and a SERVER span on the handling side, linked into one trace by
context carried in the IMQ request metadata — with no changes to service or
client code.

~~~typescript
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import { registerInstrumentations } from '@opentelemetry/instrumentation';
import { ImqueueInstrumentation } from '@imqueue/opentelemetry';

new NodeTracerProvider().register();

registerInstrumentations({
    instrumentations: [new ImqueueInstrumentation()],
});
~~~

"Before any client or service is constructed" is the whole reason this belongs at
start-up. The instrumentation works by patching `@imqueue/rpc`'s exported default
option singletons rather than by hooking module loading, so anything built before
`enable()` has already copied those defaults and is not traced. The same
mechanism has a second failure mode: if the `@imqueue/rpc` this package resolves
is a different copy from the one your application imported — duplicate installs
at different tree depths — the patch lands on the wrong singletons and no spans
appear at all. Note also that this package only *produces* spans; exporting them
is the host application's job.

For what that produces — a measured three-process trace, how to read queue wait
out of it, and the failure modes that leave a trace starting one hop in — see
[distributed tracing over a message queue](/blog/distributed-tracing-nodejs-message-queue/).

Reference: [`ImqueueInstrumentation`](/api/opentelemetry/latest/opentelemetry.imqueueinstrumentation/) ·
[`traced()`](/api/opentelemetry/latest/opentelemetry.traced/) ·
[`traceStart()`](/api/opentelemetry/latest/opentelemetry.tracestart/) ·
[`traceEnd()`](/api/opentelemetry/latest/opentelemetry.traceend/)

### How do I write structured JSON logs from a service to a file?

Declare a `file` transport in `LOGGER_TRANSPORTS` and import the default logger.
There is nothing to construct and nothing to wire: the default export is already
configured from the environment, and its records go to a winston File transport,
which writes one JSON object per line unless you hand it a different `format`.

~~~bash
export LOGGER_TRANSPORTS='[{
  "type": "file",
  "options": { "filename": "/var/log/user-service.log" },
  "enabled": true
}]'
export LOGGER_METADATA='{"service":"%name %version"}'
~~~

~~~typescript
import logger from '@imqueue/async-logger';

logger.info('service started on port %s', port);
~~~

`%name` and `%version` are substituted from the running service's own
`package.json`, so one configuration can be shared across services. With no
transports configured the logger still works, console only — that is the intended
local-development mode, not a misconfiguration. One caveat that follows from the
package's name: console writes are deferred with `setTimeout`, so a process that
exits immediately after logging may lose the tail. Log a tick before exiting if
the last lines matter.

Reference: [`Logger`](/api/async-logger/latest/async-logger.logger/) ·
[`TransportOptions`](/api/async-logger/latest/async-logger.transportoptions/) ·
[`getTransport()`](/api/async-logger/latest/async-logger.gettransport/) ·
[`defaultMetadata()`](/api/async-logger/latest/async-logger.defaultmetadata/)

### How do I configure async-logger Logger transports?

`LOGGER_TRANSPORTS` is a JSON array of transport declarations, each one
`{ type, options, enabled }`. `type` is `'file'` or `'http'` and any other value
is rejected at construction time; `options` is handed straight to the winston
transport constructor; and `enabled: false` skips a transport entirely, so it can
be left in the configuration and switched off per environment rather than
deleted.

~~~bash
export LOGGER_TRANSPORTS='[{
  "type": "file",
  "options": { "filename": "/var/log/user-service.log" },
  "enabled": true
}, {
  "type": "http",
  "options": {
    "ssl": true,
    "port": 443,
    "host": "http-intake.logs.datadoghq.com",
    "path": "/v1/input/<API_KEY>"
  },
  "enabled": true
}]'
~~~

`options` is typed as winston's wide `LoggerOptions` for historical reasons, so
the compiler will not catch a mismatch for you: treat it as `FileTransportOptions`
or `HttpTransportOptions` according to `type` — `filename` for a file,
`host`/`port`/`path`/`ssl` for HTTP. `LOGGER_METADATA` is separate: a JSON object
of default fields attached to every record, with the same `%name`/`%version`
expansion.

Reference: [`TransportOptions.type`](/api/async-logger/latest/async-logger.transportoptions.type/) ·
[`TransportOptions.options`](/api/async-logger/latest/async-logger.transportoptions.options/) ·
[`TransportOptions.enabled`](/api/async-logger/latest/async-logger.transportoptions.enabled/) ·
[`AsyncLoggerOptions.transports`](/api/async-logger/latest/async-logger.asyncloggeroptions.transports/) ·
[`Logger`](/api/async-logger/latest/async-logger.logger/)

## Scaling out

### How do I auto-scale @imqueue services?

Scale on queue depth, and let the service report it. Every `IMQService` can serve
`GET /metrics` with the number of messages waiting in its queue — one option
away, no exporter to install — which is the signal an autoscaler actually wants:
work waiting for this service, rather than the CPU it happens to be burning.

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

The listener answers exactly one route, in Prometheus exposition format, and 404
for anything else:

~~~bash
$ curl -s localhost:9090/metrics
queue_length{} 17
~~~

Point Prometheus at it, expose `queue_length` as an external metric through
prometheus-adapter, and a HorizontalPodAutoscaler reads it like any other:

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

Four properties of the number decide whether that loop behaves. It counts
messages *waiting in the queue's main list*: delayed messages not yet due, and
messages already leased to a worker under `safeDelivery`, are not included, so it
is a backlog gauge and not the amount of outstanding work. It is **0 while the
queue's writer is disconnected**, which makes a broker outage indistinguishable
from an empty queue — keep `minReplicas` above zero so a Redis blip cannot scale
the service to nothing. Every replica of the service reads the same queue and so
reports the same figure, which is why an `External` target on the value is a
better fit than a per-pod average. And every process that starts the service
binds the port, so under `multiProcess` the primary plus N workers all try:
either leave it off there or expect N of the N+1 binds to fail. On a
`ClusteredRedisQueue` the figure is summed across every broker in the fleet.

One shutdown detail: the signal handlers close the listener on `SIGINT`/`SIGTERM`,
but [`destroy()`](/api/rpc/latest/rpc.imqservice.destroy/) does not — close
`service.metricsServer` yourself there, or the open listener keeps the process
alive.

Reference: [`IMQServiceOptions.metricsServer`](/api/rpc/latest/rpc.imqserviceoptions.metricsserver/) ·
[`IMQMetricsServerOptions`](/api/rpc/latest/rpc.imqmetricsserveroptions/) ·
[`IMQMetricsServerOptions.enabled`](/api/rpc/latest/rpc.imqmetricsserveroptions.enabled/) ·
[`IMQMetricsServerOptions.port`](/api/rpc/latest/rpc.imqmetricsserveroptions.port/) ·
[`IMQMetricsServerOptions.queueLengthFormatter`](/api/rpc/latest/rpc.imqmetricsserveroptions.queuelengthformatter/) ·
[`DEFAULT_IMQ_METRICS_SERVER_OPTIONS`](/api/rpc/latest/rpc.default_imq_metrics_server_options/) ·
[`IMQService.metricsServer`](/api/rpc/latest/rpc.imqservice.metricsserver/) ·
[`IMessageQueue.queueLength()`](/api/core/latest/core.imessagequeue.queuelength/) ·
[`ClusteredRedisQueue.queueLength()`](/api/core/latest/core.clusteredredisqueue.queuelength/) ·
[`IMQServiceOptions.multiProcess`](/api/rpc/latest/rpc.imqserviceoptions.multiprocess/)

### How do I auto-scale the @imqueue broker?

Run each Redis with one of the two announcer modules and give every service and
client a `UDPClusterManager`. The module makes a broker announce itself over UDP;
the manager folds announced brokers into a `ClusteredRedisQueue` round-robin as
they appear and drops them when they stop announcing. Starting or stopping a
`redis-server` then *is* the scaling operation — nothing is restarted or
reconfigured.

Which module depends on one question: does your network deliver broadcast?

~~~bash
# L2 segment — bare metal, VMs, a docker bridge, your laptop
REDIS_BROADCAST_NAME=imq-broker \
REDIS_BROADCAST_INTERVAL=1 \
redis-server --port 6379 --loadmodule $PWD/promoter.so

# Kubernetes on GCP or any cloud VPC, where broadcast is dropped:
# the same datagram, unicast to every pod the K8s API lists
DEPLOYMENT_ENV=production \
SELECTED_INTERFACES=10. \
redis-server --port 6379 --loadmodule $PWD/unicaster.so
~~~

The client side does not care which one is running, because both emit the same
datagram to the same port:

~~~typescript
import { IMQService, UDPClusterManager } from '@imqueue/rpc';

const options = +(process.env.DISABLE_CLUSTER_MANAGER || 0)
    ? { cluster: [{ host: 'localhost', port: 6379 }] }  // static
    : { clusterManagers: [new UDPClusterManager()] };  // discovery

const service = new UserService(options);
~~~

Apply those same options to **every service and every client** in the fleet.
Replies travel back through whichever broker the request round-robined onto, so a
client pinned to one Redis silently misses responses that landed elsewhere.

The announce protocol is worth knowing because it sets the timings you observe. A
broker announces `up` every `REDIS_BROADCAST_INTERVAL` seconds (default 1) to
port 63000, and `down` on graceful shutdown, which removes it at once; a broker
that dies silently is dropped when its advertised liveness timeout plus
`aliveTimeoutCorrection` (5 s by default) passes without an announcement. So a
join takes about one interval, a graceful exit is immediate, and a crash costs a
few seconds during which sends may still be routed at it. Announcements are not
filtered by queue name — every cluster registered with a manager on that address
and port receives every server announced there, so unrelated fleets need distinct
addresses or ports. The datagrams are plain, unauthenticated UDP: keep port 63000
inside the cluster, and give every broker the same credentials, since any service
may connect to any broker it discovers.

The full recipes — building both modules, the RBAC a unicaster pod needs, and how
the fleet behaves as brokers come and go — are in
[Auto-scaling Redis broker: with and without broadcast](/blog/horizontally-scalable-redis-broker/).

Reference: [`UDPClusterManager`](/api/core/latest/core.udpclustermanager/) ·
[`UDPClusterManagerOptions`](/api/core/latest/core.udpclustermanageroptions/) ·
[`UDPClusterManagerOptions.port`](/api/core/latest/core.udpclustermanageroptions.port/) ·
[`UDPClusterManagerOptions.useAliveCheck`](/api/core/latest/core.udpclustermanageroptions.usealivecheck/) ·
[`UDPClusterManagerOptions.aliveTimeoutCorrection`](/api/core/latest/core.udpclustermanageroptions.alivetimeoutcorrection/) ·
[`IMQOptions.clusterManagers`](/api/core/latest/core.imqoptions.clustermanagers/) ·
[`IMQOptions.cluster`](/api/core/latest/core.imqoptions.cluster/) ·
[`ClusteredRedisQueue`](/api/core/latest/core.clusteredredisqueue/)

## Hardening an HTTP gateway

### How do I protect an HTTP gateway from too many requests per IP?

Mount `HttpProtect`. It counts requests per client IP in Redis and, past two
configurable thresholds, first answers 429 and then adds the address to a
persistent block list that is answered with 418.

~~~typescript
import HttpProtect from '@imqueue/http-protect';

const protect = new HttpProtect({ ttl: 60, maxRequests: 600, banLimit: 5000 });

app.use(protect.jsonMiddleware());
~~~

Three things here are load-bearing and none is visible in a signature. **A ban is
permanent** — addresses go into a Redis set that is never given an expiry, and no
method in the package removes one, so an address stays banned until something
outside it deletes the key. **The counter measures a continuous stream, not a
fixed window** — its TTL is pushed back to `ttl` on every request, so the count
only resets after a full `ttl` of silence; the default `maxRequests` of 200
therefore stops a steady one-request-per-second client after about 200 seconds,
not just a 200-request burst. And **everything is keyed by the client IP**, which
by default comes from proxy headers a client can set, so set `getClientIp` before
exposing this behind a proxy you do not control.

Reference: [`HttpProtect`](/api/http-protect/latest/http-protect.httpprotect/) ·
[`HttpProtect.maxRequests`](/api/http-protect/latest/http-protect.httpprotect.maxrequests/) ·
[`HttpProtect.banLimit`](/api/http-protect/latest/http-protect.httpprotect.banlimit/) ·
[`HttpProtect.ttl`](/api/http-protect/latest/http-protect.httpprotect.ttl/) ·
[`HttpProtectOptions.getClientIp`](/api/http-protect/latest/http-protect.httpprotectoptions.getclientip/)

### How do I mount HttpProtect as express middleware?

One `app.use()`, before the routes it protects, with the middleware that matches
how your gateway answers errors: `jsonMiddleware()` for a JSON API,
`textMiddleware()` for plain text, `middleware()` for the bare form.

~~~typescript
import HttpProtect from '@imqueue/http-protect';

// 429 then 418, as JSON, on default thresholds and a local Redis
app.use(new HttpProtect().jsonMiddleware());
~~~

If you would rather decide what happens yourself — a custom body, a redirect, a
metric — skip the middlewares and call `verify()` on the request, then act on the
`VerificationStatus` and `httpCode` it hands back:

~~~typescript
import HttpProtect, { VerificationStatus } from '@imqueue/http-protect';

const protect = new HttpProtect();
const { status, httpCode } = await protect.verify(req);

if (status !== VerificationStatus.SAFE) {
    res.status(httpCode).end();
}
~~~

Construct one instance and share it: each one holds its own Redis connection.

Reference: [`HttpProtect.jsonMiddleware()`](/api/http-protect/latest/http-protect.httpprotect.jsonmiddleware/) ·
[`HttpProtect.textMiddleware()`](/api/http-protect/latest/http-protect.httpprotect.textmiddleware/) ·
[`HttpProtect.middleware()`](/api/http-protect/latest/http-protect.httpprotect.middleware/) ·
[`HttpProtect.verify()`](/api/http-protect/latest/http-protect.httpprotect.verify/) ·
[`VerificationStatus`](/api/http-protect/latest/http-protect.verificationstatus/)

### How do I check whether an IP address is inside a CIDR range?

Build a `Networks` from your CIDR records and ask it. It covers IPv4 and IPv6 in
one object, dispatching on the address it is given, and answers from sorted
binary ranges rather than by comparing against each network in turn.

~~~typescript
import { Networks } from '@imqueue/net';

const allowed = new Networks(['10.0.0.0/8', '192.168.0.0/16', '2001:db8::/32']);

allowed.includes('10.1.2.3');     // true
allowed.includes('8.8.8.8');      // false
allowed.includes('2001:db8::1');  // true
~~~

Every record needs an explicit prefix length: a bare address is rejected, so a
single host is `203.0.113.7/32` or `2001:db8::1/128`. Anything invalid throws
while parsing rather than being skipped, so one bad entry fails the whole list —
validate with `isValid()` first when the input is untrusted. `cidrToRange()` and
`ipToInt()` are exported for building something else on the same primitives; this
is the package `@imqueue/http-protect` uses for its own allow-list.

~~~typescript
import { isValid, Networks } from '@imqueue/net';

const records = input.filter(r => isValid(r.split('/')[0]));
const networks = new Networks(records);
~~~

Reference: [`Networks`](/api/net/latest/net.networks/) ·
[`Networks.includes()`](/api/net/latest/net.networks.includes/) ·
[`isValid()`](/api/net/latest/net.isvalid/) ·
[`cidrToRange()`](/api/net/latest/net.cidrtorange/) ·
[`ipToInt()`](/api/net/latest/net.iptoint/)

## Where to look next

The full generated [API reference](/api/) covers every exported symbol of every
documented package, and [`/api/search-index.json`](/api/search-index.json) is the
same set as one machine-readable feed — `{name, kind, package, url, summary}` per
symbol — if you would rather look a name up than browse. For anything this page
does not answer, [support](/support/) lists which repository to file in.
