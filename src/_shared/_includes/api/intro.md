## Introduction

`core` and `rpc` are the framework spine — the runtime API documented below, and
the two packages every @imqueue service is built on. Capability packages such as
`pg-pubsub` or `async-logger` layer on top of them, each publishing its own
generated reference under `/api/`. `cli` is different again: a rapid-development
command-line tool installed globally, documented by a handwritten manual rather
than a generated reference.

`rpc` re-exports the entire `@imqueue/core` surface, so a single import is enough
whether you use only the core features or the RPC features as well. For example,
these two imports are equivalent:

~~~typescript
import { profile, IMQMode } from '@imqueue/core';
import { profile, IMQMode } from '@imqueue/rpc';
~~~

Both work because `profile` and `IMQMode` are defined in `core`, which is a
dependency of `rpc`.

There is exactly one exception: `export *` never forwards a default export, so
core's default-exported [IMQ](/api/core/latest/core.imq/) factory is **not**
available from `rpc` — `import IMQ from '@imqueue/rpc'` yields `undefined`.
Import it from `@imqueue/core` directly.

This pairing is specific to `core` and `rpc`. The capability packages do not
re-export their @imqueue dependencies: `@imqueue/pg-cache` and the rest export
only their own surface, so a service using one still imports `@imqueue/rpc` for
the framework types.

> **Using v3?** @imqueue 3.x ships as native ES modules and requires Node.js
> 22.12 or newer. If you're upgrading from 2.x, see the
> [Migration from 2.x to 3.x](#migration-from-2.x-to-3.x) section below.
