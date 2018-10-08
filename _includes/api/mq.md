## Messaging API

Messaging API is a low level API implementing Messaging Queue pattern used
to implement inter-service communication. Use it whenever you need to utilize
**only** messaging API in your development.

This API related only to messaging engine adapter implementation, its 
configuration, logging interface injection and profiling feature. 

### IMQ Factory and Adapters

[IMQ](/api/core/{{latest_core}}/classes/imq.html) Factory is usually used to 
construct messaging queue implementation instance.
For the moment IMQ supports only Redis adapter implementation out-of-the-box.
By the way, it is recommended to instantiate messaging queue engine instance
using the factory class instead of doing it directly, which gives an ability 
to extend existing functionality on your side or on framework side in the future.

Example:

~~~typescript
import { IMQ } from '@imqueue/core';
const mq = IMQ.create('MyMQ', { vendor: 'Redis' });
~~~

There is no actual need to specify Redis vendor in bypassed options at the moment
as it will be used by default, but in case you wish to inject your own 
implementation it can be done as follows:

~~~typescript
import { MyMQAdapter } from './path/to/MyMQAdapter';
import { IMQ } from '@imqueue/core';
const mq = IMQ.create('MyMQ', { vendor: MyMQAdapter });
~~~

Each Adapter constructed by IMQ factory must correctly implement 
[IMessageQueue](/api/core/{{latest_core}}/interfaces/imessagequeue.html)
interface, extending `EventEmitter` with emitting on implementation `'message'` 
and `'error'` events.

### Redis Queue

### Clustered Redis Queue
