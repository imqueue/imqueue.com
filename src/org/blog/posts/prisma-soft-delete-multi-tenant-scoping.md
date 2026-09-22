---
layout: post.html
permalink: /blog/prisma-soft-delete-multi-tenant-scoping/
templateEngineOverride: md
title: "Soft delete and tenant scoping in Prisma, written once instead of in every query"
summary: "Every team that soft-deletes rows ends up with a deletedAt filter in a hundred places, and the one that gets forgotten is usually inside an include. Tenant filters fail the same way, only worse. Here is how to move both below your queries with @imqueue/pg-prisma on Prisma Next, so a delete becomes a stamp and every read, relations included, sees only live rows the caller may see. Every behaviour is measured on a real Postgres."
description: "A measured recipe for soft delete, authorship stamps and multi-tenant row scoping in Prisma Next (8.x) with @imqueue/pg-prisma: the schema, one dataLayer call, what DELETE turns into, why the filter must reach included relations, OR/AND access levels, failing closed with no request context, restore and purge, and a partial unique index for soft-deleted rows."
keywords: "prisma soft delete, prisma soft delete middleware, prisma soft delete include relations, prisma deletedAt filter, prisma multi tenant row filtering, prisma tenant isolation, prisma next middleware, prisma createdBy updatedBy, soft delete unique constraint postgres, imqueue pg-prisma"
date: 2026-09-22
author: andrii
illustration: prisma-scope
topics: [security, patterns, architecture]
ogType: article
---

Soft delete sounds like a one-line decision. Instead of removing a row, you set
`deletedAt` and keep it. Support can bring it back, the audit trail stays
intact, and nothing downstream breaks on a missing foreign key.

Then the bill arrives, spread across the codebase. Every read now needs
`deletedAt IS NULL`. Every list, every lookup by id, every count on a dashboard.
Somebody adds a new endpoint and forgets it once, and a customer sees a task they
deleted last week. The forgotten filter is rarely in the obvious place. It is
inside an `include`, where the related rows are loaded in the same query and
nobody thought to filter them.

Multi-tenant scoping has the same shape and a worse failure. Forget
`workspaceId = ?` once, and one customer reads another customer's data.

The fix for both is the same: stop writing the filter in queries and put it
underneath them, in one place that every statement passes through. This post
shows how to do that on Prisma Next (Prisma 8) with
[`@imqueue/pg-prisma`](/api/pg-prisma/latest/), and what each piece does in the
SQL that actually reaches Postgres.

**Everything below was measured** with `@imqueue/pg-prisma` 2.3.0,
`@prisma/orm-postgres` 8.0.0-rc.11 and PostgreSQL 17, by running each query and
reading the statement Postgres received. Where something surprised us, it says
so.

## The short version

- Add `deletedAt`, `updatedAt`, `createdBy`, `updatedBy` and `deletedBy` to a
  model and it is soft-deleted and stamped. No list to maintain: the package
  reads your emitted `contract.json`.
- One [`dataLayer()`](/api/pg-prisma/latest/pg-prisma.datalayer_1/) call gives
  you a middleware array for `postgres()`. After that, `.delete()` writes a
  timestamp, and every read skips deleted rows, **including rows loaded through
  `include`**.
- Tenant scoping is declared per model, with levels: columns inside a level are
  OR-ed, levels are AND-ed. Reads, updates and deletes are narrowed. Inserts are
  not.
- A resolver that returns `undefined` switches its level off. Return `null` when
  there is no request, so a missing context shows nothing instead of everything.
- Restore and purge are admin work. Do them with a second client that has no
  data layer.
- Make unique keys partial (`WHERE "deletedAt" IS NULL`), or a deleted row keeps
  its name forever.

## Why the filter has to live below your queries

Here is a project with three tasks, one of which was deleted. This is an
ordinary Prisma Next client with no data layer, loading projects with their
tasks:

```typescript
const projects = await db.orm.public.Project
    .include('tasks')
    .all();
// Website: Draft copy, Pick fonts, Dave only
```

"Draft copy" was deleted. It is back, because nothing filtered it.

The reason matters. Prisma Next does not load relations with a second query you
could intercept. It compiles the whole read into **one** SQL statement, and the
related rows arrive through a nested `SELECT` inside it. A filter that only looks
at the outermost table misses every nested one.

This is the statement `@imqueue/pg-prisma` sends for the same call, shortened to
the parts that matter:

```sql
SELECT "project"."id", …, (
  SELECT json_agg(…) FROM (
    SELECT … FROM "public"."task"
    WHERE ("task"."projectId" = "project"."id"
      AND "task"."deletedAt" IS NULL)
      AND ("task"."workspaceId" = $1)
  ) AS "tasks__rows"
) AS "tasks"
FROM "public"."project"
WHERE "project"."deletedAt" IS NULL
  AND ("project"."workspaceId" = $2)
```

Both `SELECT`s got both filters. The middleware walks the whole query tree before
it is turned into SQL and adds the condition to every `SELECT` that reads a
soft-deleted or scoped table. It does the same for a relation count:
`include('tasks', t => t.count())` returned `2`, not `3`.

That is the whole argument for doing this in the data layer. A convention in code
review cannot see inside a compiled `include`. A middleware that rewrites the
query tree can.

## Recipe 1: give your models the columns

Membership is by convention. A model that has a `deletedAt` field is
soft-deleted. A model with `createdBy`, `updatedBy` or `deletedBy` gets those
stamped. The package reads this from the `contract.json` that
`prisma contract emit` writes, so there is no second list to keep in sync with
the schema.

```prisma
// use prisma-next

model Project {
  id          Int                @id @default(autoincrement())
  workspaceId String
  name        String
  tasks       Task[]
  createdAt   TimestamptzString  @default(now())
  updatedAt   TimestamptzString?
  deletedAt   TimestamptzString?
  createdBy   String?
  updatedBy   String?
  deletedBy   String?
}

model Task {
  id          Int                @id @default(autoincrement())
  workspaceId String
  ownerId     String
  assigneeId  String?
  title       String
  project     Project  @relation(fields: [projectId],
                                 references: [id])
  projectId   Int
  createdAt   TimestamptzString  @default(now())
  updatedAt   TimestamptzString?
  deletedAt   TimestamptzString?
  createdBy   String?
  updatedBy   String?
  deletedBy   String?
}
```

A few notes:

- `deletedAt` must be nullable. Null means the row is alive.
- The package writes `updatedAt` itself on every insert and update, so it does
  not need a default.
- `TimestamptzString` stores a real `timestamptz` and reads it back as text. On
  Node versions without a global `Temporal`, that also avoids Prisma Next's
  Temporal-backed date types.
- Different column names are fine. Pass them once as
  [`fields`](/api/pg-prisma/latest/pg-prisma.derivefields/), for example
  `fields: { deletedAt: 'removedAt' }`.

## Recipe 2: wire the data layer once

Install it next to Prisma Next:

```bash
npm i @imqueue/pg-prisma @prisma/orm-postgres
```

Keep the `prisma` CLI you already use to emit the contract; the two should come
from the same Prisma Next release. The package needs Node.js 22.12 or newer and
PostgreSQL 15 or newer. In an `@imqueue`
fleet it is the database toolkit to reach for, unless the fleet already runs on
Sequelize, in which case use `@imqueue/pg-sequelize` instead. Never install both.

The data layer needs two things from each request: **who** is acting, and
**which rows** they may see. Node's `AsyncLocalStorage` carries both without
passing them through every function:

```typescript
// src/db.ts
import { AsyncLocalStorage } from 'node:async_hooks';
import postgres from '@prisma/orm-postgres/runtime';
import { dataLayer } from '@imqueue/pg-prisma';
import type { Contract } from './prisma/contract.d.ts';
import contractJson from './prisma/contract.json'
    with { type: 'json' };

export interface RequestContext {
    userId: string;
    workspaceId: string;
    // set for members, left out for workspace admins
    personId?: string;
}

export const requestContext =
    new AsyncLocalStorage<RequestContext>();

const ctx = () => requestContext.getStore();

export const layer = dataLayer({
    contract: contractJson,
    scope: {
        Project: { workspace: ['workspaceId'] },
        Task: {
            workspace: ['workspaceId'],
            person: ['ownerId', 'assigneeId'],
        },
    },
    resolvers: {
        // no request: null, which shows nothing
        workspace: () => ctx()?.workspaceId ?? null,
        person: () => ctx()?.personId,
    },
    getActorId: () => ctx()?.userId ?? null,
});

export const db = postgres<Contract>({
    contractJson,
    url: process.env.DATABASE_URL!,
    middleware: layer.middleware,
});
```

`dataLayer()` returns its middlewares **already in order**. That is deliberate:
you never arrange them yourself, so you cannot arrange them wrongly. Call
`layer.close()` on shutdown. It only has work to do if you turned on the audit
trail, but calling it is always safe.

Each request then runs inside its context:

```typescript
await requestContext.run(
    { userId: 'alice', workspaceId: 'w1' },
    async () => {
        const tasks = await db.orm.public.Task.all();
        // only live tasks in workspace w1
    },
);
```

## Recipe 3: what `.delete()` does now

Nothing changes at the call site:

```typescript
const task = await db.orm.public.Task
    .where({ id: 1 })
    .delete();
```

This is what Postgres received:

```sql
UPDATE "public"."task"
SET "deletedAt" = $1, "updatedAt" = $2,
    "updatedBy" = $3, "deletedBy" = $4
WHERE (("task"."id" = 1
  AND "task"."deletedAt" IS NULL)
  AND ("task"."workspaceId" = $5))
RETURNING …
```

Four things happened, and each one is worth knowing:

1. **The `DELETE` became an `UPDATE`.** The row is still in the table, with
   `deletedAt` and `deletedBy: 'alice'` set.
2. **The caller still gets the row back.** The `RETURNING` clause survives the
   rewrite, so code that used the deleted row keeps working.
3. **Only live rows can be deleted.** Deleting the same row a second time
   returns `null` and changes nothing, so the original `deletedAt` and
   `deletedBy` are never overwritten.
4. **The tenant filter came along.** More on that in Recipe 5.

It is not only the ORM. A delete built with the SQL builder,
`db.sql.public.task.delete().where(…)`, was rewritten the same way and reported
`affectedRows: 1` with the row still in place. Any statement built as a query
tree goes through the middleware.

Updates are protected the same way. An update aimed at a deleted row returned
`null` and changed nothing, because the rewritten `WHERE` only matches live rows.

### Authorship comes for free

The same middleware stamps who did what:

| operation | `createdBy` | `updatedBy` | `deletedBy` | `updatedAt` |
|---|---|---|---|---|
| create as alice | alice | alice | — | now |
| update as erin | alice (kept) | erin | — | now |
| delete as alice | kept | alice | alice | now |
| create with no actor | `null` | `null` | — | now |

A write with no actor stamps `null` instead of skipping the column. That keeps a
system write (a nightly job, a migration script) distinguishable from a row
whose author was simply never recorded.

## Recipe 4: tenant scoping, with levels

`scope` says which columns decide whether a row belongs to the caller. It is
keyed by model name, and each model can have several **levels**:

```typescript
scope: {
    Task: {
        workspace: ['workspaceId'],
        person: ['ownerId', 'assigneeId'],
    },
},
```

Read it as: *a task is visible if it is in your workspace, **and** you either own
it **or** it is assigned to you.* Columns inside one level are OR-ed. Levels are
AND-ed together. Here is the `WHERE` for a member called Carol:

```sql
WHERE "task"."deletedAt" IS NULL
  AND (("task"."workspaceId" = $1)
  AND ("task"."ownerId" = $2
    OR "task"."assigneeId" = $3))
```

With three live tasks in the table, this is what each caller saw:

| caller | `workspace` | `person` | tasks returned |
|---|---|---|---|
| Carol, a member | `'w1'` | `'carol'` | 1 (assigned to her) |
| Alice, a member | `'w1'` | `'alice'` | 1 (owned by her) |
| Alice, an admin | `'w1'` | `undefined` | 2 (all of w1) |
| a support tool | `['w1','w2']` | `undefined` | 3 |
| anyone | `null` | — | 0 |
| anyone | `[]` | — | 0 |

The resolver's return value decides what a level does:

- a **string** matches rows where one of the level's columns equals it;
- an **array** matches rows where one of them is in the list;
- **`null`** or an **empty array** matches nothing. The SQL literally becomes
  `AND (FALSE)`;
- **`undefined`** turns the level off for this request.

That last rule is how the admin row works: an admin has no `personId`, so the
`person` level steps aside and only the workspace applies.

Scoping covers updates and deletes too. Alice, working in `w1`, tried to read,
update and delete a task from `w2` by its id. All three returned `null`, and the
row was untouched. She cannot reach it even when she knows the id.

A `scope` entry with a typo is caught at start-up:

```text
deriveDataLayer: scope names Tasks, which the contract
does not define
```

That is on purpose. A silently ignored typo would leave a model unscoped, and
that mistake leaks data instead of throwing an error.

## Recipe 5: when there is no request, show nothing

`undefined` meaning "this level is off" is useful for admins. It is dangerous
when nobody set a context at all. We ran `Task.all()` with an empty context:
every live task in every workspace came back, because every level was switched
off.

Three situations produce that empty context in real code:

1. **A background job or script** that queries the database without calling
   `requestContext.run()`.
2. **A resolver that was never registered.** A level named in `scope` with no
   resolver in `resolvers` is skipped, just like `undefined`. We declared a
   `workspace` level, passed `resolvers: {}`, and got rows from both workspaces.
3. **A query that runs after the context has ended.** This one is subtle.

The third deserves its own example. In Prisma Next, `.all()` does not start the
query. It returns something you can await, and the query runs **when you
await it**. The resolvers are called at that moment, not when the query was
built:

```typescript
// Wrong: returns the query unstarted; it runs
// after run() has already returned
const tasks = await requestContext.run(ctx, () =>
    db.orm.public.Task.all(),
);

// Right: awaited while the context is active
const tasks = await requestContext.run(ctx,
    async () => await db.orm.public.Task.all(),
);
```

The first version returned tasks from every workspace, filtered only by
`deletedAt`. The second returned what Carol was allowed to see. `.all()` does not
even return a real `Promise`: calling `.catch()` on it throws
`TypeError: … .catch is not a function`.

The defence for all three is the same: **make the tenant level's resolver return
`null` when there is no context**, as the `?? null` in Recipe 2 does. We ran
`Project.all()` with no context at all against that resolver and got 0 rows.
Code that forgot its context now shows an empty page instead of the wrong
customer's data, and an empty page gets noticed.

Leave `undefined` for levels that are supposed to be optional, like `person`,
and give jobs that really need to see everything an explicit context that says
so.

## Recipe 6: what scoping does not cover

Scoping filters **which existing rows** a statement may touch. It does not
check **what you write into them**. Two measured cases:

- **Inserts are not scoped.** There is no existing row to filter. Alice, working
  in `w1`, created a task with `workspaceId: 'w2'`. The insert succeeded, and she
  could not read the new task back, because it is now in someone else's
  workspace.
- **An update can move a row out.** Alice updated one of her own tasks with
  `{ workspaceId: 'w2' }`. The `WHERE` only checked that the row was in `w1`
  *before* the change, so the update went through and the task left her
  workspace.

The fix is ordinary code: take the tenant columns from the context, never from
the request body.

```typescript
export function createTask(input: NewTask) {
    const { workspaceId, userId } = requestContext.getStore()!;

    return db.orm.public.Task.create({
        ...input,
        workspaceId,        // from the context, not the input
        ownerId: userId,
    });
}
```

For updates, leave the tenant columns out of the fields a caller may set.

## Recipe 7: restore and purge are admin work

A layered client cannot see deleted rows, so it cannot restore them either. We
tried both routes:

```typescript
// ORM: finds nothing, returns null
await db.orm.public.Task
    .where({ id })
    .update({ deletedAt: null });

// SQL builder: affectedRows 0
```

Both statements carried `AND "deletedAt" IS NULL`, so they matched nothing. The
same is true of a hard delete: the layered client always turns it into a stamp.

Keep a second client **without** the data layer for this, and keep it out of
ordinary request code:

```typescript
// src/admin-db.ts — sees every row, stamps nothing
export const adminDb = postgres<Contract>({
    contractJson,
    url: process.env.DATABASE_URL!,
});

// restore: clear the stamp and say who did it
await adminDb.orm.public.Task
    .where({ id })
    .update({
        deletedAt: null,
        deletedBy: null,
        updatedBy: userId,
    });

// purge: really remove the row
await adminDb.orm.public.Task.where({ id }).delete();
```

Both worked: the restored task was live again with `deletedBy` cleared, and the
purged one was gone from the table. Notice that the admin client stamps nothing,
so the restore sets `updatedBy` by hand.

Raw SQL is the other path around the layer, and it is worth knowing that it is
one. A statement written with `db.raw.sql` runs through the same client
**without** being rewritten. A raw `UPDATE … SET "deletedAt" = NULL` restored a
row even on the layered client, but left `deletedBy` in place, and a raw
`SELECT count(*)` counted all 13 rows in the table while the ORM on the same
client saw 5. Anything you write by hand is outside both soft delete and
scoping, so treat raw SQL with the same care as the admin client.

## Recipe 8: unique keys and soft-deleted rows

Soft delete has one classic trap. A deleted row keeps its value in every unique
column. Delete a project called `launch`, try to create a new `launch`, and
Postgres refuses:

```text
duplicate key value violates unique constraint
```

The row is invisible to your app, but the index still counts it. The fix is a
**partial** unique index that only covers live rows, and Prisma Next can declare
one in the schema:

```prisma
model Project {
  // …
  slug        String?

  @@index([workspaceId, slug], unique: true,
          where: "(\"deletedAt\" IS NULL)",
          name: "project_slug_live")
}
```

Measured through the data layer:

| step | result |
|---|---|
| create `launch` in w1 | created |
| create another live `launch` in w1 | refused, `23505` |
| delete the first one | stamped |
| create `launch` in w1 again | created |
| create `launch` in w2 | created |

Duplicates among live rows are still refused, which is the rule you wanted in
the first place. Including `workspaceId` in the index makes the rule per tenant,
so two customers can both have a project called `launch`.

## What this does not do

- **It is not Postgres row-level security.** The filters live in your service,
  not in the database. Anything that reaches Postgres another way, such as
  `psql`, a reporting tool, another service or raw SQL, sees every row. If you
  need the database itself to enforce tenant boundaries, that is RLS, and it is
  a separate decision.
- **It does not decide who belongs to which workspace.** Scoping applies
  whatever your resolvers return. Checking that a user may act in `w1` happens
  before you put `w1` in the context.
- **It does not clean up deleted rows.** They stay until you purge them. The
  same package can move aged rows into an archive schema on a schedule, and it
  can record every write in an audit table; both are opt-in, and both are
  documented in the [API reference](/api/pg-prisma/latest/).

## FAQ

### How do I implement soft delete in Prisma?

Add a nullable `deletedAt` column, then rewrite deletes and reads in one place
rather than in every query. With `@imqueue/pg-prisma` on Prisma Next, any model
that has a `deletedAt` field is soft-deleted automatically: `.delete()` becomes
an `UPDATE` that sets the timestamp, and every `SELECT` gets
`deletedAt IS NULL`.

### Does soft delete filter included relations?

With this data layer, yes. Prisma Next compiles an `include` into one statement
with nested selects, and the middleware adds the filter to every select that
reads a soft-deleted table. We measured it on `include('tasks')` and on an
`include` with `count()`. Without it, deleted related rows come back.

### How do I scope Prisma queries by tenant?

Declare `scope` per model in `dataLayer()`, keyed by level, and give each level a
resolver that reads the current request. Reads, updates and deletes are
narrowed to matching rows. Inserts are not, so set tenant columns from the
request context yourself.

### What happens if the resolver returns undefined?

That level is switched off for the request. That is useful for optional levels,
such as a per-person filter an admin should skip, but it means a missing context
removes the filter entirely. Return `null` from a tenant resolver when there is
no context: `null` matches nothing.

### How do I restore a soft-deleted row?

Use a client created without the data layer and set `deletedAt` back to `null`.
The layered client cannot see deleted rows, so its updates match nothing. Clear
`deletedBy` and set `updatedBy` in the same update, because the plain client
stamps nothing.

### Why does a unique constraint fail after a soft delete?

The deleted row is still in the table and still in the index. Make the unique
index partial, `WHERE "deletedAt" IS NULL`, so it only covers live rows. Prisma
Next can declare that with `@@index([...], unique: true, where: "...")`.

### Does raw SQL respect soft delete and scoping?

No. `db.raw.sql` statements run unchanged, even on a client with the data layer.
Only statements built by the ORM or the SQL builder are rewritten.

### Is this the same as Postgres row-level security?

No. RLS is enforced by the database for every connection. This is enforced by
your service for the queries it builds. They solve related problems and can be
used together.

## Reference

[`dataLayer()`](/api/pg-prisma/latest/pg-prisma.datalayer_1/) ·
[`DataLayerOptions`](/api/pg-prisma/latest/pg-prisma.datalayeroptions/) ·
[`DataLayerOptions.getActorId`](/api/pg-prisma/latest/pg-prisma.datalayeroptions.getactorid/) ·
[`DataLayerOptions.resolvers`](/api/pg-prisma/latest/pg-prisma.datalayeroptions.resolvers/) ·
[`DeriveOptions.scope`](/api/pg-prisma/latest/pg-prisma.deriveoptions.scope/) ·
[`DeriveFields`](/api/pg-prisma/latest/pg-prisma.derivefields/) ·
[`AccessScopeResolver`](/api/pg-prisma/latest/pg-prisma.accessscoperesolver/) ·
[`accessScope()`](/api/pg-prisma/latest/pg-prisma.accessscope/) ·
[`stamp()`](/api/pg-prisma/latest/pg-prisma.stamp/) ·
[`StampColumns`](/api/pg-prisma/latest/pg-prisma.stampcolumns/) ·
[`deriveDataLayer()`](/api/pg-prisma/latest/pg-prisma.derivedatalayer/) ·
[`@imqueue/pg-prisma`](/api/pg-prisma/latest/) ·
[Least privilege for your Redis broker](/blog/redis-acl-least-privilege-nodejs/)
