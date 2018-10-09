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
* Remote calls means that from client to service and vice versa data are
 transmitted via network, so all arguments passed in and all return values of
 the exposed methods ***MUST* be JSON-serializable types**. 
* You *CAN NOT* use spread operator for exposed method arguments - that won't
  work on a client and is a known limitation. In this case bypass arguments as 
  an array:
  ~~~typescript
  import { IMQService, expose } from '@imqueue/rpc';
  export class SomeService extends IMQService {
    // this is INCORRECT
    // client for this service will not compile because of this
    @expose()
    public incorrectStuff(...args: any[]) {
      args.forEach((arg) => {
        // do something with arg...
      });
    }
  
    // this is CORRECT
    @expose()
    public correctStuff(args: any[]) {
      args.forEach((arg) => {
        // do something with arg...
      });
    }
  
    // this is also CORRECT
    // as far as it is not exposed
    private somePrivateStuff(...args: any[]) {
      args.forEach((arg) => {
        // do something with arg...
      });
    }
  }

  (async () => {
    // let's imagine we have a client for the service
    const client = new SomeServiceClient();
    await client.start();
    // and we want to have something like this:
    client.incorrectStuff(1, 2, 3);
    // but we can do like this instead,
    // which is not that significant problem as seen:
    client.correctStuff([1, 2, 3]);
  })();
  ~~~

### Importance of Using DocBlocks

JS/Typescript does not have very powerful tooling for reflections, so there is
no easy way to get all required information about arguments and return values
data types on a Typescript level. By the way description model of the services 
can easily utilize information from the doc-blocks associated with the class 
method, and @imqueue does that very well.

This is a very good practice form any point of view, as far as well written
doc-blocks make code more documented, readable and clear, provides an ability to
auto-generate API documentation for the written code, and, finally, in our case,
they become *MANDATORY* to use to provide possibility for @imqueue to describe 
the service and make its client to work correctly.

Here is what mandatory to know about writing doc-blocks for @imqueue services:

* Always use `@param` and `@return` tags with proper type definition to describe
  input args and return value:
  
  ~~~typescript
  import { IMQService, expose } from '@imqueue/rpc';
  export class SomeService extends IMQService {
    /**
     * Some method description goes here
     * 
     * @param {string} argOne - the first argument description string
     * @param {boolean} argTwo - the second argument description string
     * @param { {name: string, value: number} } [argThree] - the third optional argument description string
     * @return { {x: number, y: number} } - return value description string
     */
    @expose()
    public someMethod(
      argOne: string, argTwo: boolean, argThree?: { name: string, value: number }
    ): { x: number, y: number } {
      // do some stuff with args...
      return { x: 5, y: 7 };
    }
  }
  ~~~
* Use `[]` around those argument name, which are optional in doc-block argument
  description, it is important if you wish optional arguments to be defined
  correctly on a generated client.
* Use Typescript type definitions in doc-blocks for argument and return values,
  as far as it will be used as part of generated client code.

### Complex Types

@imqueue services support complex types to be defined and used within data
exchange between client and service. There are also several rules to know about
creating proper complex types which both service and client will understand and
use correctly.

Use **class declaration** for defining an interface of complex type on a service
side. This is related to the problem that in comparison to interface
declaration class is an accessible definition in JavaScript, but interface
is only accessible on Typescript. As far as any reflection are available only
on JavaScript level, there is no way to work with declaration of interfaces on it.
Another problem is that JavaScript classes does not support properties (only 
property getters and setters), so
for Typescript it is enough to have simple property definition, but to access
that definition on JavaScript level we need to have some extra definitions,
which are implemented by `@property()` decorator factory.

Here is an interface of `@property()` decorator factory:

~~~typescript
property(typeName: string, isOptional: boolean = false)
~~~

Usage:

~~~typescript
// service definition of the type:
import { property } from '@imqueue/rpc';

class UserObject {
    @property('string')
    firstName: string;
    
    @property('string')
    lastName: string;
    
    @property('string')
    email: string;
    
    @property('string', true)
    phoneNumber?: string;
}
~~~

This will be compiled on a client side to a proper Typescript interface and can
be correctly used for a proper type definitions on a client and service side:

~~~typescript
// client definition of the type
interface UserObject {
    firstName: string;
    lastName: string;
    email: string;
    phoneNumber?: string;
}
~~~

Now the type can be used within service methods:

~~~typescript
import { IMQService, expose } from '@imqueue/rpc';
import { UserObject } from './types/UserObject';
class UserService extends IMQService {
    /**
     * Updates user record
     * 
     * @param {UserObject} data - user data fields
     * @return {Promise<UserObject|null>} - saved user object or null if failed
     */
    @expose()
    public async update(data: UserObject): Promise<UserObject|null> {
        // do logic...
        return data;
    }
}
~~~

When using a client it will do a proper type-checks as well.

Complex types can aggregate another complex types. Let's imagine we want to
extend our user model to be associated with one or more addresses defined for
a user. It can look like this:

~~~typescript
import { property } from '@imqueue/rpc';

class AddressObject {
    @property('string')
    country: string;
    
    @property('string')
    city: string;
    
    @property('string')
    address: string;
    
    @property('string', true)
    phoneNumber?: string;
}

class UserObject {
    @property('string')
    firstName: string;
    
    @property('string')
    lastName: string;
    
    @property('string')
    email: string;
    
    @property('AddressObject[]', true)
    addresses?: AddressObject[]
}
~~~

### Working with Service Description

If you need, for some reason, to access service description metadata it is
enough to simply call for a `describe()` method on service client:

~~~typescript
// treating it is executed in async context:
const client = new UserClient();
await client.start();
console.log(client.describe());
~~~

It will return all metadata about service classes, methods and complex types
definitions.

### Delayed Messaging

Delayed messaging with `@imqueue/rpc` is easy. Any of exposed service method
can be called with a delay. So if you need to use delayed messaging to implement
scheduling queue for some operations it is as easy as specify `delay` (of 
[IMQDelay](/api/rpc/{{latest_rpc}}/classes/imqdelay.html) type) parameter 
within any client method call, like this:

~~~typescript
import { IMQDelay } from '@imqueue/rpc';
import { UserObject, UserClient } from './clients';

const client = new UserClient();
const data: UserObject = {
    firstName: 'John',
    lastName: 'Doe',
    email: 'john@doe.com'
}

await client.start();
// execute scheduled stuff in 1 hour, and obtain result asynchronously
// after execution without stacking the thread
client.doScheduledStuff(data, new IMQDelay(1, 'h'))
    .then((result: any) => console.log(result));
~~~

### Locking

Locking is a powerful tool `@imqueue/rpc` provides to potentially optimize
remote calls. For example, let's imagine your system can generate hundreds or
even thousands calls to some specific service method with the same context
and arguments and obtaining the same response result. It could be possible when
some popular content is requested by many users but that content is pretty
static at least for some period of time. In such case service executes the
same operations hundreds of times per second, but there actually no reasons
doing that. Locks allows to optimize such kind of behavior, and here is how.

When the lock is defined for a method it will create an asynchronous lock on the
first call and until the operation is not complete, all other similar calls
(having the same signature) will wait until a first call is resolved, and then
it resolves all enqueued calls with the data.

For example if there is a call to fetch some specific blog-post 100 times during 
the next 100 milliseconds, but operation to fetch a blog-post from a database 
takes around that 100 milliseconds it means that such call will 
execute the actual logic only once, than resolve all awaiting 100 clients
with the same return value:

~~~typescript
import { IMQService, expose, lock } from '@imqueue/rpc';
import { BlogPost } from './types';

class BlogService extends IMQService {

    /**
     * Returns the same blog post data object corresponding to a
     * given blog post identifier
     *
     * @param {string} id - blog post identifier
     * @return {BlogPost} - blog post data set
     */
    @lock()
    @expose()
    public async fetchPost(id: string): Promise<BlogPost> {
        let data: BlogPost;
        // do stuff...
        return data;
    }
}
~~~

From other hand if during that time there will be other calls with another 
blog post ids them will be executed using their locks and will return another
corresponding data value.

This gives several advantages:

  1. Decreases load on server
  1. Improves response time for the clients (first one will wait the most, but
     that which connected the last will obtain result almost immediately with no 
     delay, so average response time across clients will be improved).

Locking can be used also in another manner. @imqueue provides an implementation
of asynchronous locks as a generic class 
[IMQLock](/api/rpc/{{latest_rpc}}/classes/imqlock.html), which can be used for 
many different needs outside of the using `@lock()` decorator factory.

### Caching

Caching is another tool @imqueue provides for optimization purposes. It gives an
ability to cache method execution calls using a given caching adapter (of
course, Redis is by default and the only one implemented at this time). But it
is possible to define your own adapter, it is enough to implement properly
[ICache](/api/rpc/{{latest_rpc}}/interfaces/icache.html) and 
[ICacheConstructor](/api/rpc/{{latest_rpc}}/interfaces/imcacheconstructor.html)
interfaces.

Out-of-the-box it can be used as `@cache()` decorator factory on a service
methods or by utilizing [IMQCache](/api/rpc/{{latest_rpc}}/classes/imqcache.html)
registry and [RedisCache](/api/rpc/{{latest_rpc}}/classes/rediscache.html)
engine implementation.

Typical usage as follows:

~~~typescript
import { IMQService, expose, cache } from '@imqueue/rpc';
import { BlogPost } from './types';

class BlogService extends IMQService {

    /**
     * Returns the same blog post data object corresponding to a
     * given blog post identifier
     *
     * @param {string} id - blog post identifier
     * @return {BlogPost} - blog post data set
     */
    @cache()
    @expose()
    public async fetchPost(id: string): Promise<BlogPost> {
        let data: BlogPost;
        // do stuff...
        return data;
    }
}
~~~

`@cache()` decorator implements similar per-signature work principals as
`@lock()`.
