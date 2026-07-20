## Profiling and debugging

Profiling and debugging matter throughout the development and ongoing support of
any system.

@imqueue provides a simple, built-in tool for measuring and debugging service
method execution: the `@profile()` decorator. Apply it to the parts of the system
you most need to keep an eye on.

Profiled timing is accurate to **microseconds** by default.

Usage:

~~~typescript
import { IMQService, expose, profile } from '@imqueue/rpc';

class MonitoredService extends IMQService {
    @profile()
    @expose()
    public exposedStuff() {
        // call some internals:
        this.internalStuff(1, 2, 3);
        // do anything else...
    }

    @profile()
    private internalStuff(...args: any[]) {
        for (let i = 0; i < 100000; i++) {
        }
    }

    @profile(true)
    private forcedTimeProfiling(...args: any[]) {

    }

    @profile(undefined, true)
    private forcedArgsProfiling(...args: any[]) {

    }

    @profile(true, true)
    private forcedFullProfiling(...args: any[]) {

    }
}
~~~

Called with no arguments, `@profile()` follows the environment configuration,
which can turn profiling on or off. Calls that pass arguments override the
environment and force time and/or argument profiling explicitly.

We recommend managing profiling state through `.env` files (per service) or by
setting the variables globally (for the whole environment). Those variables are:

- `IMQ_LOG_TIME=1|0` — enables or disables execution-time profiling. Empty is
  treated as `0`, the default.
- `IMQ_LOG_ARGS=1|0` — enables or disables argument debug logging. Empty is
  treated as `0`, the default.
- `IMQ_LOG_TIME_FORMAT="microseconds"|"milliseconds"|"seconds"` — sets the time
  format in the debug output. Empty is treated as `"microseconds"`, the default.

`@profile()` uses @imqueue's configured logger, so it needs no extra setup. It
also works on any class method, not just service classes:

~~~typescript
import { profile } from '@imqueue/core';

class SomeClass {
    @profile()
    protected someProtectedMethod() {
    }
}
~~~

Note that enabling profiling can slightly reduce overall back-end performance —
but it's invaluable for diagnosing and eliminating bottlenecks and slow code
paths.
