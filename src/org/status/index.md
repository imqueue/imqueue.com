---
layout: docs.html
section: docs
title: "@imqueue package status — versions, licences and Node requirements"
docLabel: PACKAGE STATUS
lead: "The current version, licence, Node requirement and release date of every published @imqueue package, read from the npm registry at build time."
description: "Current version, licence and minimum Node version for every published @imqueue package — @imqueue/core, rpc, cli and the rest. Regenerated daily from npm."
keywords: "imqueue version, imqueue license, @imqueue/core version, @imqueue/rpc version, imqueue node version requirement, imqueue package list, imqueue npm packages, imqueue GPL"
relatedTopics: [tooling, dx]
wide: true
---

<!--
The tables below are GENERATED. Do not edit them by hand: scripts/gen-package-status.ts
rewrites everything between each `status:begin`/`status:end` pair from
src/_data/packageStatus.json, and `npm run check:package-status:npm` fails when what is
committed here no longer matches npm.

The prose is hand-written and must stay free of numbers — a version quoted in a sentence
is a version nothing updates, which is the failure this whole page exists to fix.

NOT Liquid, deliberately. The markdown mirrors are built from `doc.rawInput`, before any
template rendering, so a `{{ … }}` in this file would be served verbatim at /status.md —
to precisely the machine readers this page is for. Generating the source sidesteps that
entirely, and it is what sync-cli-wiki.ts already does for the CLI guide.
-->

Every published `@imqueue` package, with the facts you would otherwise go to npm
for. The numbers below come from the **npm registry**, read when this page was
built — not from a checkout, and not from anything written by hand.

There is a machine-readable copy of this exact data at
[imqueue.org/status.json](https://imqueue.org/status.json), and this page is also
served as plain markdown at
[imqueue.org/status.md](https://imqueue.org/status.md). If you are an agent, take
the JSON: it carries the install command, the docs URL and the repository for each
package as well as what the table shows.

## The framework

<!-- status:begin framework -->
| | |
|---|---|
| Licence | GPL-3.0-only, or a commercial licence for closed-source distribution. Not AGPL: running it as a network service is not distribution, so internal services and SaaS carry no source-release obligation |
| Node.js | 22.12 or newer |
| Redis | 3.2 or newer (6.2+ for safe delivery) |
| Commercial licence | [imqueue.com/license/](https://imqueue.com/license/) |
<!-- status:end framework -->

Every package is published under the same licence. A closed-source product needs
the [commercial licence](https://imqueue.com/license/) instead; that is one
arrangement covering the whole framework, not a per-package question.

## The packages

Install any of them with `npm i <name>` — except `@imqueue/cli`, which is a
command-line tool and wants `npm i -g @imqueue/cli`.

<!-- status:begin packages -->
| Package | Version | Licence | Node | Last release |
|---|---|---|---|---|
| [@imqueue/core](/api/core/latest/) | 3.4.2 | GPL-3.0-only | `>=22.12.0` | 2026-08-22 |
| [@imqueue/rpc](/api/rpc/latest/) | 3.7.2 | GPL-3.0-only | `>=22.12.0` | 2026-08-22 |
| [@imqueue/pg-pubsub](/api/pg-pubsub/latest/) | 3.0.7 | GPL-3.0-only | `>=22.12.0` | 2026-08-22 |
| [@imqueue/pg-cache](/api/pg-cache/latest/) | 5.1.2 | GPL-3.0-only | `>=22.12.0` | 2026-08-22 |
| [@imqueue/tag-cache](/api/tag-cache/latest/) | 3.0.5 | GPL-3.0-only | `>=22.12.0` | 2026-08-22 |
| [@imqueue/pg-sequelize](/api/pg-sequelize/latest/) | 4.2.3 | GPL-3.0-only | `>=22.12.0` | 2026-08-22 |
| [@imqueue/pg-prisma](/api/pg-prisma/latest/) | 1.0.3 | GPL-3.0-only | `>=22.12.0` | 2026-08-22 |
| [@imqueue/async-logger](/api/async-logger/latest/) | 3.2.0 | GPL-3.0-only | `>=22.12.0` | 2026-07-31 |
| [@imqueue/opentelemetry](/api/opentelemetry/latest/) | 4.1.1 | GPL-3.0-only | `>=22.12.0` | 2026-08-22 |
| [@imqueue/datadog](/api/datadog/latest/) | 3.2.1 | GPL-3.0-only | not declared | 2026-08-22 |
| [@imqueue/graphql-dependency](/api/graphql-dependency/latest/) | 3.1.1 | GPL-3.0-only | `>=22.12.0` | 2026-08-22 |
| [@imqueue/type-graphql-dependency](/api/type-graphql-dependency/latest/) | 3.0.4 | GPL-3.0-only | `>=22.12.0` | 2026-08-22 |
| [@imqueue/net](/api/net/latest/) | 3.0.5 | GPL-3.0-only | `>=22.12.0` | 2026-08-26 |
| [@imqueue/http-protect](/api/http-protect/latest/) | 3.0.2 | GPL-3.0-only | `>=22.12.0` | 2026-08-26 |
| [@imqueue/validation](/api/validation/latest/) | 1.1.1 | GPL-3.0-only | `>=22.12.0` | 2026-08-22 |
| [@imqueue/job](/api/job/latest/) | 3.1.1 | GPL-3.0-only | `>=22.12.0` | 2026-08-22 |
| [@imqueue/cli](/cli/) | 5.2.2 | GPL-3.0-only | `>=22.12.0` | 2026-08-22 |
| [@imqueue/mcp](/mcp/) | 3.7.7 | GPL-3.0-only | `>=18` | 2026-08-26 |
<!-- status:end packages -->

Two pairs are mutually exclusive: pick **either** `@imqueue/pg-prisma` **or**
`@imqueue/pg-sequelize` for the database toolkit, and **either**
`@imqueue/opentelemetry` **or** `@imqueue/datadog` for tracing. Installing both
halves of a pair fails silently rather than loudly. The
[API reference](/api/) states the choosing rule for each.

### What each package is for

<!-- status:begin blurbs -->
- [`@imqueue/core`](/api/core/latest/) — The JSON messaging-queue engine, the IMQ factory, and the pluggable adapter interface.
- [`@imqueue/rpc`](/api/rpc/latest/) — Services, clients and decorators — @expose, @remote, @lock, @cache — and the RPC runtime.
- [`@imqueue/pg-pubsub`](/api/pg-pubsub/latest/) — Reliable PostgreSQL LISTEN/NOTIFY with inter-process lock support.
- [`@imqueue/pg-cache`](/api/pg-cache/latest/) — PostgreSQL-managed cache on Redis for @imqueue service methods.
- [`@imqueue/tag-cache`](/api/tag-cache/latest/) — Tagged cache implementation over Redis.
- [`@imqueue/pg-sequelize`](/api/pg-sequelize/latest/) — Turns a query described as data — filters, paging, ordering and the requested fields — into one efficient Sequelize statement, with database views as models.
- [`@imqueue/pg-prisma`](/api/pg-prisma/latest/) — Prisma query extensions — soft-delete, access scoping, authorship and audit trails — plus row archiving, change-notify triggers and down-migrations.
- [`@imqueue/async-logger`](/api/async-logger/latest/) — Non-blocking logger over winston, with file and HTTP transports configured from the environment.
- [`@imqueue/opentelemetry`](/api/opentelemetry/latest/) — OpenTelemetry instrumentation for @imqueue/rpc — every RPC traced, with no changes to service or client code.
- [`@imqueue/datadog`](/api/datadog/latest/) — Datadog APM tracing for @imqueue/rpc — a drop-in replacement for Datadog's own dd-trace package that traces every RPC.
- [`@imqueue/graphql-dependency`](/api/graphql-dependency/latest/) — Declarative cross-service dependency loading for GraphQL — nested data in bulk instead of one call per resolved object.
- [`@imqueue/type-graphql-dependency`](/api/type-graphql-dependency/latest/) — The same dependency loading for type-graphql — declared on your decorated classes rather than on raw GraphQL types.
- [`@imqueue/net`](/api/net/latest/) — CIDR membership testing for IPv4 and IPv6 — sorted binary ranges searched in O(log n) rather than one comparison per network.
- [`@imqueue/http-protect`](/api/http-protect/latest/) — Per-IP rate limiting and banning for express-like servers, backed by Redis so every process sees one view of a client.
- [`@imqueue/validation`](/api/validation/latest/) — Zod-backed field- and method-level validation via native (TC39) decorators.
- [`@imqueue/job`](/api/job/latest/) — Safe-by-default Redis job queue — delayed and scheduled jobs, at-least-once delivery, and retries driven by the handler.
- [`@imqueue/cli`](/cli/) — Scaffolds services, generates typed clients, and runs a local fleet — the entry point.
- [`@imqueue/mcp`](/mcp/) — The Model Context Protocol server: these docs as tools, over stdio or the hosted endpoint.
<!-- status:end blurbs -->
