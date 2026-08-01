## Messaging API

The Messaging API is the low-level API implementing the Message Queue pattern
used for inter-service communication. Reach for it when you need **only** the
messaging layer in your code.

This API concerns the messaging-engine adapter, its configuration, logging
injection and profiling.

### The IMQ factory and adapters

The [IMQ](/api/core/latest/core.imq/) factory constructs
message-queue instances. Currently IMQ ships with a Redis adapter out of the box.
Prefer creating instances through the factory rather than constructing a queue
class yourself: it picks the right implementation for the options you pass —
supplying [cluster](/api/core/latest/core.imqoptions.cluster/) or
[clusterManagers](/api/core/latest/core.imqoptions.clustermanagers/) gets you a
[ClusteredRedisQueue](/api/core/latest/core.clusteredredisqueue/) instead of a
[RedisQueue](/api/core/latest/core.redisqueue/), with no change at the call site.

`IMQ` is the **default** export of `@imqueue/core`, so import it without braces.
Note that `export *` never forwards a default: it is the one part of the core
surface `@imqueue/rpc` does not re-export, so import it from `@imqueue/core`
directly.

Example:

~~~typescript
import IMQ from '@imqueue/core';

const mq = IMQ.create('MyMQ', { vendor: 'Redis' });
~~~

You don't need to specify the vendor —
[`'Redis'`](/api/core/latest/core.imqoptions.vendor/) is the default, and
currently the only supported value; [IMQ.create()](/api/core/latest/core.imq.create/)
throws a `TypeError` for anything else. The factory builds only the adapters the
framework ships with, so a queue of your own is instantiated directly rather than
through it:

~~~typescript
import { MyMQAdapter } from './path/to/MyMQAdapter.js';

const mq = new MyMQAdapter('MyMQ');
~~~

Any such adapter must implement the
[IMessageQueue](/api/core/latest/core.imessagequeue/)
interface, extending `EventEmitter` and emitting `'message'` and `'error'`
events.

The factory performs no I/O, so the queue it returns is not connected — call
`start()` on it, or `send()`, which starts the queue implicitly.

### Redis Queue

[RedisQueue](/api/core/latest/core.redisqueue/) is the core
Redis-based message-queue implementation, providing the engine for a single Redis
node.

### Clustered Redis Queue

[ClusteredRedisQueue](/api/core/latest/core.clusteredredisqueue/)
extends `RedisQueue` to work across a cluster of Redis nodes, with automatic
round-robin load balancing between them.
