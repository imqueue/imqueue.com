## RPC API

RPC is a high-level framework API allowing to create client-server communication
between services using Remote Procedure Call pattern. If you'd like to deal with
a full subset of @imqueue features it is recommended to rely on it.

### Configuration

Usually configuration options are bypassed to a Service or a Client constructor.
In a real-world setup there is an easy way to map option values exported from 
environment variables to an object instantiation, which gives a full flexibility
during deployment. Thus, each service generated from a boilerplate provides 
`config.ts` file where the options can be set, for example like this:

~~~typescript
export const serviceOptions: Partial<IMQServiceOptions> = {
    cluster: JSON.parse(process.env['REDIS_CLUSTER_CONFIG']),
    safeDelivery: !!process.env['MQ_SAFE_DELIVERY'],
    // etc...
};
~~~

Doing that it is easy to make service to be re-configured by the environment it
is executed in. For local deployment you can define environment
vars in your shell (as a global configuration setup) or by using `.env` file in 
the root directory of the service (as a per-service configuration). At the same
time on environments like AWS it is possible to bypass environment vars from
Parameters Store, etc.

#### Generic Options (Service and Client)

- **host** - Redis server host, default is `"localhost"`
- **port** - Redis server port, default is `6379`
- **cluster** - Defines a Redis servers cluster, actually it will be used instead of
  host/port combination if provided. Naturally it is an array of Redis servers
  host/port pairs. @imqueue will automatically distribute messages between
  configured here Redis cluster nodes.
- **prefix** - Redis keys prefix which should be used for @imqueue key/value
  pairs, default is `"imq"`
- **logger** - Reference to a logger implementation. By default is `console`.
  Configured logger implementation reference will be used by the whole set of 
  library entities. Provided logger implementation must implement 
  [ILogger](/api/core/{{latest_core}}/interfaces/ilogger.html) interface.
- **safeDelivery** - boolean value enabling/disabling safe (guaranteed) message
  delivery. By default is `false` - turned off. Turned on safe delivery 
  guaranties that each consumer will either process a message or it will be
  re-scheduled for re-handling by another instance of the same consumer type and
  that guaranties the message will be never lost.
- **safeDeliveryTtl** - time to live in milliseconds for messages in-process of 
  consumer instance. In another words, it is a time when message lives in a 
  worker queue. When the time ends it will be removed from worker queue and put 
  back into a message queue. By default is `5000` (5 seconds). take care that if
  there is a task running more than five seconds and safe delivery is turned on
  this value should be extended.
- **useGzip** - boolean flag which turns gzip compression on/off. By default is
  `false` - turned off. @imqueue exchanging messages in a plain JSON format.
  If in your system by design messages are large and throughput in number of
  messages is low it can be logical step to use compression to decrease
  traffic exchange between consumer instances and Redis nodes. From the other
  hand turning this option on will decrease throughput in number of messages
  per second around 2 times, so it is not recommended to turn it on in cases
  where throughput performance is a critical point. 

#### Client Extra Options

There are several ways of creating and instantiating service Clients:

  1. By using only pre-generated client source files
  1. Instantiating clients dynamically without source files generation
  1. Instantiating clients dynamically and automatically (re-)generate their source files

The following below options and their values combination can set one of the
described above modes.

- **compile** - enables client code module to be interpreted by JavaScript
  on-the-fly. By default is turned on, so it is possible to use dynamically
  generated clients out-of-the-box without additional configuration. Can be
  turned off for some reason. 
- **write** - enables/disables persistence of generated client code. By default
  is enabled.
- **path** - specifies a path where the client source files should be persisted.
  By default is `"./src/clients""`.

### Service and Client

IMQ is implemented in the way where **developer should focus only on Service
development** and a Client is going to be automatically generated from a Service
description. Each @imqueue Service instance is self-describable, so developer 
must take care only about good level of description which is reflected only to 
a proper code writing, including all correct types definitions and documenting 
blocks. And, of course, on functionality implementation itself.

Such a way provides a simplicity of development process - you just writing a
service code and frameworks takes care itself about everything else.

From the other hand in case of some specific need there is no limit of 
implementing Clients manually, but it can significantly increase amount of
work to be done on implementation, and what is the most critical - on support
after implementation.

Anyway, @imqueue provides 
[IMQService](/api/rpc/{{latest_rpc}}/classes/imqservice.html) and
[IMQClient](/api/rpc/{{latest_rpc}}/classes/imqclient.html) base abstract
classes which should be inherited by an exact implementation.

Each service is treated as a package, which should contain at least one 
service class. In case of complex service implementation it can consists of
many classes, what in terms of implementing microservices is usually unwanted.

Typical empty service implementation looks like this

~~~typescript
import { IMQService } from '@imqueue/rpc';
export class SomeService extends IMQService {
    // service implementation goes here
}
~~~

Implementation of a service is a typical Typescript class so it can implement
any method (including private, protected and public) and define any class
 properties. By the way there are some minimal rules required to follow to make
it work correctly:

* All methods which was not exposed will not be accessible remotely. If you need
  to make method accessible via remote calls, you *MUST* expose it. To do that you
  need to use `@expose()` decorator factory:
  ~~~typescript
  import { IMQService, expose } from '@imqueue/rpc';
  export class SomeService extends IMQService {
    @expose()
    public exposedMethod() { /* implementation goes here... */ }
    public unexposedMethod() { /* implementation goes here... */ }
  }
  ~~~
* Only class methods are allowed to expose. You *CAN NOT* expose class
  properties.
* There is no limit of implementing async methods, so feel free to implement
  them any time you need it:
  ~~~typescript
  import { IMQService, expose } from '@imqueue/rpc';
  export class SomeService extends IMQService {
    @expose()
    public async exposedMethod(): Promise<void> {
      // implementation goes here...
    }
  }
  ~~~
* If you need to make asynchronous operation on class service initialization -
  override `start()` method:
  ~~~typescript
  import { IMessageQueue, IMQService, expose } from '@imqueue/rpc';
  export class SomeService extends IMQService {
    public async start(): Promise<IMessageQueue | undefined> {
      // do your async stuff here, for example, init db connection, etc...
      return super.start();
    }
  }
  ~~~
* Prefer using aggregated logger, instead of using `console` for debugging and
  printing info/warning/errors:
  ~~~typescript
  import { IMQService, expose } from '@imqueue/rpc';
  export class SomeService extends IMQService {
    @expose()
    public loggedStuff() {
      this.logger.log('I am logged string!');
    }
  }
  ~~~

### Importance of Using DocBlocks

### Complex Types

### Working with Service Description

### Delayed Messaging

### Locking

### Caching

