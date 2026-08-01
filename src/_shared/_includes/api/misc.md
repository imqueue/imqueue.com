## Profiling and debugging

Profiling and debugging matter throughout the development and ongoing support of
any system.

@imqueue provides a simple, built-in tool for measuring and debugging service
method execution: the `@profile()` decorator. Apply it to the parts of the system
you most need to keep an eye on.

Profiled timing is reported in **microseconds** by default.

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

    @profile({ enableDebugTime: true })
    private forcedTimeProfiling(...args: any[]) {

    }

    @profile({ enableDebugArgs: true })
    private forcedArgsProfiling(...args: any[]) {

    }

    @profile({ enableDebugTime: true, enableDebugArgs: true })
    private forcedFullProfiling(...args: any[]) {

    }
}
~~~

Called with no arguments, `@profile()` follows the environment configuration,
which can turn profiling on or off. A
[ProfileDecoratorOptions](/api/core/latest/core.profiledecoratoroptions/) object
overrides the environment and forces time and/or argument profiling explicitly —
but only for fields passed as real booleans; any other value is ignored and the
environment default applies.

Whether timing and argument logging are enabled is resolved **once, when the
class is defined**, so changing `process.env` later has no effect.

We recommend managing profiling state through `.env` files (per service) or by
setting the variables globally (for the whole environment). Those variables are:

- `IMQ_LOG_TIME=1|0` — enables or disables execution-time profiling. Empty is
  treated as `0`, the default.
- `IMQ_LOG_ARGS=1|0` — enables or disables argument debug logging. Empty is
  treated as `0`, the default.
- `IMQ_LOG_TIME_FORMAT="microseconds"|"milliseconds"|"seconds"` — sets the time
  format in the debug output. Empty is treated as `"microseconds"`, the default.

`@profile()` writes through the `logger` property of **the instance it decorates**
— any [ILogger](/api/core/latest/core.ilogger/). Inside a service class that
property is already there, so the decorator needs no extra setup. It also works on
any class method, not just service classes, but then the logger is yours to
provide: an instance with no `logger` profiles the method and produces no output
at all, with no warning. Static methods are never logged, because the logger is
looked up on instances only.

~~~typescript
import { profile } from '@imqueue/core';

class SomeClass {
    // the decorator logs through this property only;
    // without a logger nothing is ever written
    public logger = console;

    @profile()
    protected someProtectedMethod() {
    }
}
~~~

Note that enabling profiling can slightly reduce overall back-end performance —
but it's invaluable for diagnosing and eliminating bottlenecks and slow code
paths.
