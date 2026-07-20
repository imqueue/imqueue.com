## Introduction

`@imqueue` is made up of three packages — `core`, `rpc` and `cli`. `cli` is a
rapid-development command-line tool, used globally as a utility; `core` and `rpc`
make up the runtime API documented below.

@imqueue packaging follows a nesting principle: each higher-level package
re-exports the full functionality of the package it depends on. So importing
`@imqueue/rpc` also gives you everything from `@imqueue/core`.

This means a single import is enough whether you use only the core features or
the RPC features as well. For example, these two imports are equivalent:

~~~typescript
import { profile, IMQMode } from '@imqueue/core';
import { profile, IMQMode } from '@imqueue/rpc';
~~~

Both work because `profile` and `IMQMode` are defined in `core`, which is a
dependency of `rpc`.

> **Using v3?** @imqueue 3.x ships as native ES modules and requires Node.js
> 22.12 or newer. If you're upgrading from 2.x, see the
> [Migration from 2.x to 3.x](#migration-from-2.x-to-3.x) section below.
