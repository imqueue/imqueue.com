## Introduction

`@imqueue` consists of three packages - `core`, `rpc` and `cli`, where `cli` is RAD
command line tool and should be used globally as utility, others two are related
to API, which is described below.

All `@imqueue` packaging follows nesting principles. It means that top level package
exports outside whole functionality of internally related package it depends on.
Thus if you're importing `@imqueue/rpc` it exports everything from `@imqueue/core`
as well.

That all provides the ability to use single import whenever you decide to use only
core features in you development or RPC features as well.

For example, such imports are equivalent from development point of view:

~~~typescript
import { IMQ, uuid, profile } from '@imqueue/core';
import { IMQ, uuid, profile } from '@imqueue/rpc';
~~~

As `IMQ`, `uuid` and `profile` are defined in core package which is a
dependency of rpc package.
