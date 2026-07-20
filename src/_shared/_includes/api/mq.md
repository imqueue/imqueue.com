## Messaging API

The Messaging API is the low-level API implementing the Message Queue pattern
used for inter-service communication. Reach for it when you need **only** the
messaging layer in your code.

This API concerns the messaging-engine adapter, its configuration, logging
injection and profiling.

### The IMQ factory and adapters

The [IMQ](/api/core/{{latest_core}}/classes/imq.html) factory constructs
message-queue instances. Currently IMQ ships with a Redis adapter out of the box.
Prefer creating instances through the factory rather than directly — this lets
functionality be extended later, on your side or the framework's.

Example:

~~~typescript
import { IMQ } from '@imqueue/core';

const mq = IMQ.create('MyMQ', { vendor: 'Redis' });
~~~

You don't need to specify the Redis vendor — it's the default — but you can
inject your own adapter implementation like this:

~~~typescript
import { MyMQAdapter } from './path/to/MyMQAdapter';
import { IMQ } from '@imqueue/core';

const mq = IMQ.create('MyMQ', { vendor: MyMQAdapter });
~~~

Any adapter built by the IMQ factory must implement the
[IMessageQueue](/api/core/{{latest_core}}/interfaces/imessagequeue.html)
interface, extending `EventEmitter` and emitting `'message'` and `'error'`
events.

### Redis Queue

[RedisQueue](/api/core/{{latest_core}}/classes/redisqueue.html) is the core
Redis-based message-queue implementation, providing the engine for a single Redis
node.

### Clustered Redis Queue

[ClusteredRedisQueue](/api/core/{{latest_core}}/classes/clusteredredisqueue.html)
extends `RedisQueue` to work across a cluster of Redis nodes, with automatic
round-robin load balancing between them.
