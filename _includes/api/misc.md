## Profiling and Debugging

Of course, profiling and debugging are very important and valuable things
during the development and post-development support of any system.

@imqueue provides a simple and basic tool to manage services methods execution,
profiling times of execution and debugging calls. This tool is a `@profile()`
decorator factory and is recommended to be used on that parts of the system which
are critical to monitor.

Profiled timing can have accuracy to **microseconds** and is so by default.

Usage:

~~~typescript
import { IMQService, expose, profile } from '@imqueue/rpc';

class MonitoredService extends IMQService {
    @profile()
    @expose()
    public exposedStuff() {
        // call for some internals:
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

When the `@profile()` decorator factory is called without arguments, it will
rely on environment configuration, which can either enable or disable
profiling. Those decorator factory calls, which provide arguments, override
environment settings and force time/args profiling explicitly.

It is recommended to manage profiling state via `.env` files for per-service
configuration or by setting profiling vars globally for the entire environment.

Those vars are:

- `IMQ_LOG_TIME=1|0`, empty is treated as 0 - the default value. Enables/disables
   execution time profiling.
- `IMQ_LOG_ARGS=1|0`, empty is treated as 0 - the default value. Enables/disables
   arguments debug logging.
- `IMQ_LOG_TIME_FORMAT="microseconds"|"milliseconds"|"seconds"`, empty is treated
  as "microseconds" - the default value. Specifies a time format in the debug
  output log.

`@profile()` decorator utilizes configured logger for @imqueue, so there is no
need in any additional configuration actions for that purpose. Also, this
decorator can be used within any class method, not specially on a service class
(meaning it is possible to be used anywhere else), like:

~~~typescript
import { profile } from '@imqueue/core';
class SomeClass {
   @profile()
   protected someProtectedMethod() {
   }  
}
~~~

Please, note, that turned on profiling can slightly decrease overall backend 
performance. But using profiling helps diagnose, find and eliminate potential 
"bottle-necks" and slow-running pieces of code in the system.
