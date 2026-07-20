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
    "moduleResolution": "nodenext"
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

### Removed re-exported helpers

Several helper utilities that `@imqueue/core` re-exported (and that
`@imqueue/rpc` re-exported transitively) have been removed from the public API.
Replace them with the standard equivalents:

| Removed export | Replacement |
| --- | --- |
| `uuid()` | `randomUUID()` from `node:crypto` |
| `promisify()` | `promisify` from `node:util` |
| `buildOptions()` | internal helper — removed, inline your own option merge |
| `copyEventEmitter()` | internal helper — removed |

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
`@cache()` / `@property()` decorators — is unchanged.
