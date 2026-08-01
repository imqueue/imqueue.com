## Migration from 2.x to 3.x

Version 3.x is a modernization release of `@imqueue/core` and `@imqueue/rpc`.
It moves the packages to native ES modules and standard TypeScript decorators,
built with TypeScript 7. The public runtime API is largely the same, but the
following changes require attention when upgrading from 2.x.

### ES modules and Node

Both packages are now published as **native ES modules** (`"type": "module"`)
and require **Node.js 22.12 or newer**. In practice this means:

- Import `@imqueue/core` / `@imqueue/rpc` from ESM code; `require()` of these
  packages is no longer supported.
- In your own project, use ESM as well and add the `.js` extension to relative
  import specifiers (Node's `nodenext` resolution), for example
  `import { UserObject } from './types/UserObject.js';`.

### Standard decorators and tsconfig

@imqueue 3.x uses **standard (TC39) decorators** instead of the legacy
experimental implementation. Update your `tsconfig.json` accordingly:

~~~jsonc
{
  "compilerOptions": {
    // remove these — legacy decorators are no longer used:
    // "experimentalDecorators": true,
    // "emitDecoratorMetadata": true,

    // use a modern target and the standard-decorators metadata lib:
    "target": "es2024",
    "lib": ["es2024", "esnext.decorators"],
    "module": "nodenext",
    "moduleResolution": "nodenext",

    // keep this: doc-blocks are the only type source the client
    // generator reads, so stripping comments leaves it nothing
    "removeComments": false
  }
}
~~~

### `@classType()` is now required on complex types

Under standard decorators, `@property()` only collects field metadata — it no
longer registers the class itself. Every complex type must now be annotated with
the new `@classType()` class decorator (see
[Complex Types](#complex-types)). Add it to each `@property()`-decorated class:

~~~typescript
// 2.x
import { property } from '@imqueue/rpc';

class UserObject {
    @property('string')
    firstName: string;
}

// 3.x
import { classType, property } from '@imqueue/rpc';

@classType()
class UserObject {
    @property('string')
    firstName: string;
}
~~~

### Removed helpers

A number of general-purpose utilities that these packages exported alongside
their real API have been removed. Most had a standard-library equivalent by the
time 3.x was cut; the rest were internals that were never meant to be public.

Removed from `@imqueue/core` (and therefore from `@imqueue/rpc`, which
re-exports it):

| Removed export | Replacement |
| --- | --- |
| `uuid()` | `randomUUID()` from `node:crypto` |
| `promisify()` | `promisify` from `node:util` |
| `sha1()` | `createHash('sha1')` from `node:crypto` |
| `IJson` | `JsonObject` — `IJson` was only ever an alias for it |
| `intrand()` | no equivalent — inline your own random-integer helper |
| `propertiesOf()` | no equivalent — walk the prototype chain yourself if you need it |
| `pack()` / `unpack()` | internal message codec — removed; `useGzip` covers compression on the wire |
| `buildOptions()` | internal helper — removed, inline your own option merge |
| `copyEventEmitter()` | internal helper — removed |

Removed from `@imqueue/rpc`:

| Removed export | Replacement |
| --- | --- |
| `fileExists()` / `mkdir()` / `writeFile()` | `node:fs/promises` |
| `osUuid()` | no equivalent — it returned a machine UUID; use `randomUUID()` if a per-process id will do |
| `signature()` | internal — the call-signature hash behind `@lock()` and `@cache()` |
| `pid()` / `forgetPid()` / `IMQ_PID_DIR` / `IMQ_TMP_DIR` | internal PID-file bookkeeping — removed |
| `SIGNALS` | internal — see [IMQOptions.handleSignals](/api/core/latest/core.imqoptions.handlesignals/) |

For example:

~~~typescript
// 2.x
import { uuid } from '@imqueue/core';
const id = uuid();

// 3.x
import { randomUUID } from 'node:crypto';
const id = randomUUID();
~~~

The rest of the runtime API — `IMQ`, `RedisQueue`, `ClusteredRedisQueue`,
`profile`, `IMQService`, `IMQClient`, and the `@expose()` / `@lock()` /
`@cache()` / `@property()` decorators — is unchanged, `@classType()` above being
the one addition you must make.
