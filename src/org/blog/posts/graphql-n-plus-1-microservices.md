---
layout: post.html
permalink: /blog/graphql-n-plus-1-microservices/
templateEngineOverride: md
title: "The N+1 problem when GraphQL resolvers call microservices"
summary: "A field resolver runs once per parent object. Put a service call inside it and one innocent-looking query becomes twenty-six. Here is the same query measured at 26 calls and at 3, why your latency chart will not show you the difference, and the two ways the fix comes back silently empty."
description: "How to fix GraphQL N+1 across microservices in Node.js: declare bulk loaders and requirements once, make one load() call, and see the measured call counts, cost model and silent failure modes."
keywords: "graphql n+1 microservices, dataloader microservices, graphql resolver n+1 nodejs, batch loading across services, graphql gateway microservices, imqueue graphql-dependency"
date: 2026-08-14
author: andrii
illustration: graphql-batching
topics: [graphql, rpc, patterns, performance]
ogType: article
---

A GraphQL gateway in front of a fleet of services is the normal way to give a
web or mobile client one endpoint over many back-ends. The schema is assembled
in the gateway, the data lives behind service calls, and each field that crosses
a service boundary gets a resolver that makes one.

That last sentence is the whole problem. GraphQL runs a field resolver **once per
parent object**. Five companies in the result and a resolver on
`Company.employees` means five calls. Four employees each and a resolver on
`User.skills` means twenty more. Nobody wrote a loop, and there is a loop.

This is the N+1 problem, and over a message queue it has a particular character:
it does not announce itself. Twenty-six round trips on a quiet system are as fast
as three. The cost only appears when the system is busy, which is the point at
which you find out.

Below is the same query, against the same three services, resolved both ways —
naively, and through `@imqueue/graphql-dependency`. The call counts are counted
in the services themselves, not asserted by the gateway.

## One query, twenty-six calls

Three services: `Company`, `User`, `Skill`. Each exposes a list method that
takes a filter, and each records every call it serves. Five companies, four
employees per company, three skills per employee.

The gateway resolves the nested fields the way everyone writes first — a
resolver per field, each making its own call:

~~~typescript
employees: {
    type: new GraphQLList(UserType),
    resolve: async (company, args, context) =>
        await context.user.listUser({ companyId: company.id }),
},

// and, one level down
skills: {
    type: new GraphQLList(SkillType),
    resolve: async (user, args, context) =>
        await context.skill.listSkill({ userId: user.id }),
},
~~~

The query:

~~~graphql
{
  companies {
    id
    name
    employees { id firstName skills { id name } }
  }
}
~~~

What the services actually served:

~~~
### naive field resolvers
RPC calls: 26  {"Company":1,"User":5,"Skill":20}
   listCompany({})
   listUser({"companyId":"c1"})
   listUser({"companyId":"c2"})
   listUser({"companyId":"c3"})
   listUser({"companyId":"c4"})
   listUser({"companyId":"c5"})
   listSkill({"userId":"u1"})
   listSkill({"userId":"u2"})
   listSkill({"userId":"u3"})
   ... 17 more listSkill calls ...
   => 5 companies, 4 employees each, 3 skills each
~~~

One, then five, then twenty. The shape is `1 + C + C×E`, so it grows with the
data the query happens to match — not with anything visible in the query text. A
client that asks for the same fields over a hundred companies makes 501 calls
and nothing in the gateway looks different.

## The same query in three calls

`@imqueue/graphql-dependency` moves the loading out of the field resolvers
entirely. Instead of "how do I fetch this field for this object", you declare two
things per type, once, at start-up:

- a **loader** — how to fetch many objects of one type in a single call;
- **requirements** — which child types this type owns, where the children attach,
  and which of the parent's fields feed the child loader's filter.

~~~typescript
import { Dependency } from '@imqueue/graphql-dependency';
import { fieldsMap } from 'graphql-fields-list';

Dependency(SkillType).defineLoader(async (context, filter) =>
    await context.skill.listSkill(filter),
);

Dependency(UserType)
    .defineLoader(async (context, filter) =>
        await context.user.listUser(filter),
    )
    .require(SkillType, () => ({
        as: UserType.getFields().skills,
        filter: {
            [SkillType.getFields().userId.name]: UserType.getFields().id,
        },
    }));

Dependency(CompanyType).require(UserType, () => ({
    as: CompanyType.getFields().employees,
    filter: {
        [UserType.getFields().companyId.name]: CompanyType.getFields().id,
    },
}));
~~~

`filter` reads child-side key first, parent-side source second:
`UserType`'s loader filters by `companyId`, and the values come from every
`CompanyType.id` in the result set.

The requirements are thunks because the types they name are usually still being
defined when this code runs — a `GraphQLObjectType` with circular references only
has its fields once the schema has settled.

Then the whole nested structure is one call in the top-level resolver:

~~~typescript
companies: {
    type: new GraphQLList(CompanyType),
    resolve: async (source, args, context, info) => {
        const data = await context.company.listCompany({});

        return Dependency(CompanyType).load(data, context, fieldsMap(info));
    },
},
~~~

There are no field resolvers left on `employees` or `skills`. The same query,
byte for byte, against the same services:

~~~
### Dependency().load()
RPC calls: 3  {"Company":1,"User":1,"Skill":1}
   listCompany({})
   listUser({"companyId":["c1","c2","c3","c4","c5"]})
   listSkill({"userId":["u1","u2","u3","u4","u5","u6","u7","u8","u9","u10",...
   => 5 companies, 4 employees each, 3 skills each
~~~

Twenty-six down to three, with an identical result graph. The five per-company
filters became one filter holding five ids; the twenty per-user filters became
one holding twenty. Work is batched **per level**: siblings within a level run
concurrently, and the next level waits, because a child's filter is built out of
values the parent level has just returned. Three levels, three calls.

That per-level batching is also the ceiling on what this can do. It cannot turn
three levels into one round trip, because level three does not know what to ask
for until level two answers. What it removes is the fan-out **within** a level,
which is where N+1 actually lives.

## Why your latency chart will not show you this

Here is the part worth internalising. The same two resolvers, timed end to end at
three levels of concurrency:

| In-flight queries | Naive, total | Naive p95 | `load()`, total | `load()` p95 |
|---|---|---|---|---|
| 1 | 5–8 ms | 5–8 ms | 3–8 ms | 3–8 ms |
| 10 | 17–28 ms | 14–25 ms | 6–13 ms | 4–10 ms |
| 50 | 75–91 ms | 55–73 ms | 25–29 ms | 17–19 ms |

At a single in-flight query the two are indistinguishable — the ranges overlap,
and on some runs the naive version wins. That is not a measurement error, it is
the shape of the problem. Both versions make three *sequential* levels of calls;
the naive one just makes each level wide. On an idle broker, twenty concurrent
`listSkill` calls complete in about the time one does.

Push concurrency up and the picture separates: at fifty in-flight queries the
naive resolver is doing 1,300 request/response pairs where `load()` does 150, and
the queue, the service processes and the event loops all start to feel it. Three
times the total time, and three to four times the p95.

So N+1 over a queue is not a latency bug you will find by staring at p50 on a
quiet staging environment. It is a **capacity** bug. It spends service
throughput, connection budget and broker headroom on work that has no reason to
exist, and it presents itself as "the fleet needs more replicas" long before it
presents itself as a slow query. Count calls, not milliseconds — that is the
number that changed by 8.7× here.

## Nothing asked for is nothing fetched

`load()` walks the fields the client actually selected, so the cost tracks the
query rather than the schema. Ask for the top level only:

~~~graphql
{ companies { id name } }
~~~

~~~
### load(), top level only
RPC calls: 1  {"Company":1}
   listCompany({})
   => employees attached: undefined
~~~

One call. `employees` was declared, has a loader, and was never touched. A falsy
field map short-circuits the whole thing and the source comes back untouched.

## The two ways it comes back silently empty

Both of these produce a valid GraphQL response with no error in it, which makes
them worth knowing before you meet them in production rather than after.

**A loader whose rows have no `id`.** Everything here is matched parent-to-child
by `id` and by nothing else. A service method that returns a projection without
its primary key — easy to do when you are pushing the requested-field list down
into a `SELECT` — produces this:

~~~
### p5 loader rows carry no id
RPC calls: 2  {"Company":1,"User":1}
   listCompany({})
   listUser({"companyId":["c1","c2","c3","c4","c5"]})
   => employees: []
~~~

The call was made. Twenty rows came back. Nothing attached, `employees` is an
empty list, and there is no error to find. (If the schema declares `id` as
non-null you get a hard `Cannot return null for non-nullable field` instead,
which is a considerably better outcome — one small argument for non-null ids.)

**The parent field that feeds the filter gets projected away.** This one is
subtler and easier to walk into precisely *because* you did the efficient thing.
Consider a relation whose filter needs `ownerId`:

~~~typescript
Dependency(CompanyType).require(UserType, () => ({
    as: CompanyType.getFields().owner,
    filter: { id: CompanyType.getFields().ownerId },
}));
~~~

The client asks for `owner`, not for `ownerId` — why would it, `ownerId` is an
implementation detail. If your top-level resolver honours the requested-field
list and returns only the selected columns, the company rows arrive without
`ownerId`, the filter is assembled from a field that is not there, and:

~~~
### p6 service projects, ownerId not asked for
RPC calls: 1  {"Company":1}
   => owner: null
~~~

`owner: null`, no error, and the user loader was never called at all — the filter
came out empty, so the dependency was skipped. The failure is not in the loader;
it is upstream of it.

This is exactly what `defineInitializer()` is for: an async routine that fills
fields onto the parent objects *before* the dependency level runs, declared with
the fields it fills so that dependencies not reading them need not wait:

~~~typescript
Dependency(CompanyType)
    .defineInitializer(async (context, source) => {
        const ids = (Array.isArray(source) ? source : [source])
            .map(row => row.id);
        const rows = await context.company.listCompany({ id: ids });

        // keyed by object id; merged onto the matching object
        return rows.reduce((res, row) => {
            res[row.id] = { ownerId: row.ownerId };

            return res;
        }, {});
    }, () => CompanyType.getFields().ownerId)
    .require(UserType, () => ({
        as: CompanyType.getFields().owner,
        filter: { id: CompanyType.getFields().ownerId },
    }));
~~~

~~~
### p7 same, with defineInitializer
RPC calls: 3  {"Company":2,"User":1}
   listCompany({})
   listCompany({"id":["c1","c2","c3","c4","c5"]})
   listUser({"id":["u1","u5","u9","u13","u17"]})
   => owner: {"id":"u1","firstName":"User1"}
~~~

Correct, at the cost of one extra bulk call. Worth noting that the cheaper fix is
often to stop projecting the field away — if `ownerId` always feeds a relation,
have the loader always return it. The initializer earns its keep when the value
genuinely is not there to be selected, such as a list of foreign ids that has to
be derived or fetched from somewhere else first.

## What a level actually costs

The useful mental model is per level, per type. At one level, the number of
loader calls for a child type is:

> (requested fields whose type is that child) × (requirements declared to that child)

Both halves matter, and the second one catches people out, because requirements
are keyed by **child type**, not by the field they attach to. Declare two
relations to `UserType` — say `owner` and `employees` — then ask for only one of
them:

~~~graphql
{ companies { id employees { id } } }
~~~

~~~
### p2 owner declared, only employees asked for
RPC calls: 3  {"Company":1,"User":2}
   listCompany({})
   listUser({"companyId":["c1","c2","c3","c4","c5"]})
   listUser({"id":["u1","u5","u9","u13","u17"]})
   => employees 4, owner in result: false
~~~

The `owner` relation was resolved even though the query never asked for it, and
GraphQL then discarded it during serialisation, because `owner` is not in the
selection set. One bulk call, fetched and thrown away.

Two practical consequences. Declare the relations you actually serve and no more
— an unused requirement is not free, it is a bulk call on every query that
touches its type. And when one type is reached through several relations, expect
a call per relation per requesting field; if that matters, splitting a
heavily-related type into narrower ones gives `load()` less to do.

Still three calls where the naive version made twenty-six, of course. The cost
model is worth knowing, not worth being frightened of.

## Where the resolution cache does save you

One thing that genuinely comes for free: within a single `load()`, ids already
resolved are dropped from later filters. A query that comes back to the same type
from a different direction can cost nothing at all.

`Company → employees → company`, with `Company` given a loader of its own:

~~~
### p4 same type again one level down
RPC calls: 2  {"Company":1,"User":1}
   listCompany({})
   listUser({"companyId":["c1","c2","c3","c4","c5"]})
   => nested company: {"id":"c1","name":"Company 1"}
~~~

Two calls, not three. Resolving `company` on twenty users needed companies
`c1`–`c5` — all of which the resolution cache already held from the root
resolver's own result — so the filter emptied out and no call was made. The
nested objects are shared by reference with their parents, so a wide result graph
stays cheap in memory too.

That cache is per `load()` call and is discarded afterwards. Nothing is shared
between requests, so one request can never serve another's stale data. It is a
request-scoped deduplicator, not a cache in the sense of something you would
have to invalidate. If you want a cache that survives the request, that is a
different tool — [@imqueue/tag-cache](/api/tag-cache/latest/) or
[@imqueue/pg-cache](/api/pg-cache/latest/) — and a different set of decisions.

## What this is not

It is worth being clear about the boundaries, because "GraphQL across services"
attracts some large architectural answers and this is a small one.

- **It is not federation.** There is no schema composition, no cross-service
  schema registry, and services do not need to speak GraphQL — they expose
  ordinary typed @imqueue methods. The schema lives in the gateway, where you
  wrote it. If you want services to own their slices of one supergraph, you want
  Apollo Federation, and this is not that.
- **It is not a general batching layer.** It batches what a declared dependency
  graph reaches through `load()`. Calls made anywhere else — a field resolver you
  kept, a mutation, a REST handler — are untouched.
- **Every participating object must carry an `id`.** Matching is by id and only
  by id, which is why `load()` adds `id` to the requested-field map at every
  level, mutating the map you handed it. `source` is mutated too: dependency
  fields are written onto the objects you passed in.
- **Your service methods have to accept sets.** A loader filter carries every
  parent's value at once, so `listUser({ companyId: [...] })` has to mean what it
  looks like. A method that only accepts one id cannot be a loader, and that is
  usually a small change on the service side — an `IN` instead of an `=`.
- **It only helps queries with structure.** A single object with no nested
  service data has no N+1 to remove, and `load()` on it is one short-circuit and
  a return.

## The short version

A field resolver that makes a service call is a loop you did not write, and over
a queue it stays invisible until the system is under load — 26 calls and 3 calls
are the same latency on an idle broker and three times apart at fifty in-flight
queries. Take the loading out of the field resolvers: a bulk loader per type,
requirements between them, both declared once at start-up, and a single `load()`
in the top-level resolver.

Then watch for the two silent modes — rows without an `id`, and a filter fed by a
field the query never selected — because both return a well-formed response with
nothing in it.

## FAQ

### Is this the same thing as DataLoader?

No, and the difference is where the knowledge lives. DataLoader is a per-request
batching and memoisation primitive: you still write a resolver per field, and
each one asks a loader instance for a key, which DataLoader coalesces within a
tick. It works, and it is a fine choice.

`@imqueue/graphql-dependency` removes the field resolvers instead. The relations
between types are declared once at start-up as data — child type, attachment
field, filter mapping — and a single `load()` call in the top-level resolver
walks the client's selection set and resolves the whole tree level by level.
There is no per-field code to keep in step with the schema, and the batching
window is the query rather than the event-loop tick.

### Do I still need Apollo Federation?

Only if you want services to own their parts of the schema. Federation solves
schema composition: each service publishes a subgraph, and a router plans queries
across them. That is a bigger commitment — every service has to speak GraphQL and
implement the federation directives.

This solves the narrower problem of a gateway that already holds the schema and
needs to fetch nested data from plain typed services without N+1. If your
services expose @imqueue RPC methods rather than GraphQL endpoints, the narrow
answer is the one that fits.

### What does a service method need to look like to be usable as a loader?

Two things. It must accept a **set** of values per filter key, since gathering a
whole level in one call is the entire point — `listUser({ companyId: ['c1',
'c2'] })` has to return the users of both companies. And every row it returns
must carry an `id`, because loaded rows are matched back onto their parents by id
and nothing else.

Beyond that it is an ordinary `@expose()`d method with a typed doc-block. The
loader also receives the merged set of fields the query asked for, so you can push
the projection down to the database — as long as you keep the fields your
dependency filters read.

### Does the batching cache anything between requests?

No. The resolution cache lives for the duration of a single `load()` call and is
discarded when it returns, so no request can ever serve another request's stale
data. Its job is to keep one query from asking for the same object twice.

Registration is the opposite: `Dependency(SomeType)` always returns the same
description for the same type, so loaders and requirements are global and
permanent, and belong next to the type definitions where they run once at
start-up. If you need caching that outlives a request, use a cache —
[@imqueue/tag-cache](/api/tag-cache/latest/) for values that several unrelated
events can invalidate, or [@imqueue/pg-cache](/api/pg-cache/latest/) when
Postgres should decide when a method's result went stale.

### Why did my nested field come back null with no error at all?

Almost always because the filter that finds it had nothing to work with. The
filter is assembled from fields on the parent objects, so if the field feeding it
is missing from the parent rows — commonly because the top-level resolver
projected down to exactly what the client selected, and the client never selected
a foreign key it does not care about — the filter comes out empty and the
dependency is skipped without a call.

The other cause is a loader returning rows without `id`: the call happens, the
rows arrive, and nothing can be attached, so you get an empty list. Check the
call actually reached the service. No call means the filter was empty; a call
with an empty result means the ids did not match.

## Where to start

~~~bash
npm i --save @imqueue/graphql-dependency
~~~

If your schema is built with type-graphql, declare the same relations with a
decorator on the classes you already have —
[@imqueue/type-graphql-dependency](/api/type-graphql-dependency/latest/) layers on
top of this package and shares its resolution machinery. One thing to know before
you start: on that path you must run every hook in `schemaHooks` after building
the schema, because nothing else will, and skipping it leaves the dependency
fields silently empty — a third way to get a well-formed response with nothing in
it.

- [@imqueue/graphql-dependency API reference](/api/graphql-dependency/latest/)
- [`GraphQLDependency.defineLoader()`](/api/graphql-dependency/latest/graphql-dependency.graphqldependency.defineloader/)
  — the bulk fetch, and what is required of it
- [`GraphQLDependency.require()`](/api/graphql-dependency/latest/graphql-dependency.graphqldependency.require/)
  — relations, `as` and `filter`
- [`GraphQLDependency.load()`](/api/graphql-dependency/latest/graphql-dependency.graphqldependency.load/)
  — the one runtime call
- [`GraphQLDependency.defineInitializer()`](/api/graphql-dependency/latest/graphql-dependency.graphqldependency.defineinitializer/)
  — filling in what the filters need
- [FAQ: avoiding N+1 service calls](/api/faq/#how-do-i-avoid-n-1-service-calls-when-resolving-nested-graphql-fields)

Counting calls is a habit worth keeping once the resolvers are gone, and the
cheapest place to see them is a trace — one span per service call, so an N+1
level shows up as a row of identical siblings. That is
[distributed tracing over the queue](/blog/distributed-tracing-nodejs-message-queue/).
