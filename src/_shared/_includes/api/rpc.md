## RPC API

The RPC API is a high-level framework for building client–server communication
between services using the Remote Procedure Call pattern. If you want the full
set of @imqueue features, this is the API to build on.

### Configuration

Configuration options are usually passed to a Service or Client constructor. In a
real-world setup, the cleanest approach is to map option values from environment
variables into the object at instantiation, giving you full flexibility at
deployment time. Every service scaffolded from the boilerplate includes a
`config.ts` file where these options can be set, for example:

~~~typescript
export const serviceOptions: Partial<IMQServiceOptions> = {
    cluster: JSON.parse(process.env['REDIS_CLUSTER_CONFIG']),
    safeDelivery: !!process.env['MQ_SAFE_DELIVERY'],
    // etc...
};
~~~

This lets a service be reconfigured by the environment it runs in. For local
deployment you can define environment variables in your shell (global
configuration) or in a `.env` file in the service's root directory (per-service
configuration). On platforms such as AWS you can pass variables in from Parameter
Store, and so on.

#### Generic options (Service and Client)

- **host** — Redis server host. Default: `"localhost"`.
- **port** — Redis server port. Default: `6379`.
- **cluster** — defines a cluster of Redis servers, used instead of the
  host/port pair when provided. It's an array of Redis host/port pairs; @imqueue
  automatically distributes messages across the configured cluster nodes.
- **prefix** — the Redis key prefix used for @imqueue key/value pairs. Default:
  `"imq"`.
- **logger** — a reference to a logger implementation, used by the whole library.
  Default: `console`. The implementation must satisfy the
  [ILogger](/api/core/latest/core.ilogger/) interface.
- **safeDelivery** — enables or disables safe (guaranteed) message delivery.
  Default: `false` (off). When on, every consumer either processes a message or
  the message is rescheduled for re-handling by another instance of the same
  consumer type, so a message is never lost.
- **safeDeliveryTtl** — time to live, in milliseconds, for a message being
  processed by a consumer instance — that is, how long the message stays in a
  worker queue. When the time elapses, the message is moved from the worker queue
  back to the message queue. Default: `5000` (5 seconds). If a task can run longer
  than five seconds and safe delivery is on, increase this value accordingly.
- **useGzip** — enables or disables gzip compression. Default: `false` (off).
  @imqueue exchanges messages as plain JSON. If your messages are large and your
  message throughput is low, compression can be a sensible way to reduce traffic
  between consumer instances and Redis nodes. Note that turning it on roughly
  halves message throughput, so avoid it where throughput is critical.

#### Client-only options

There are several ways to create and instantiate service clients:

1. Using only pre-generated client source files.
2. Instantiating clients dynamically, with or without generating source files.
3. Implementing clients manually, when you need to.

The following options select among these modes:

- **compile** — allows the generated client module to be interpreted by
  JavaScript on the fly. Default: on, so dynamically generated clients work out
  of the box with no extra configuration. Can be turned off if needed.
- **write** — enables or disables persistence of the generated client code.
  Default: on.
- **path** — where the generated client source files are written. Default:
  `"./src/clients"`.

### Service and Client

IMQ is built so that **you focus only on service development** — the client is
generated automatically from the service's description. Every @imqueue service is
self-describing, so your only responsibilities are writing good descriptions
(correct type definitions and doc-blocks) and, of course, implementing the
functionality itself.

This keeps development simple: you write the service, and the framework handles
the rest.

If you have special requirements, there's nothing stopping you from implementing
clients by hand — but that adds significant work, both to build and, more
importantly, to maintain afterwards.

@imqueue provides the
[IMQService](/api/rpc/latest/rpc.imqservice/) and
[IMQClient](/api/rpc/latest/rpc.imqclient/) abstract base classes
for concrete implementations to extend.

Each service is treated as a package containing at least one service class. A
complex service may consist of several classes, though in microservice terms
that's usually best avoided.

A minimal, empty service looks like this:

~~~typescript
import { IMQService } from '@imqueue/rpc';

export class SomeService extends IMQService {
    // service implementation goes here
}
~~~

A service is an ordinary TypeScript class — it can have private, protected and
public methods, and any properties you like. A few rules must be followed to make
it work correctly:

* Methods that aren't exposed are not accessible remotely. To make a method
  remotely callable, you **must** expose it with the `@expose()` decorator:
  ~~~typescript
  import { IMQService, expose } from '@imqueue/rpc';

  export class SomeService extends IMQService {
    @expose()
    public exposedMethod() { /* implementation... */ }

    public unexposedMethod() { /* implementation... */ }
  }
  ~~~
* Only methods can be exposed. You **cannot** expose class properties.
* To run asynchronous setup during service initialization, override the
  `start()` method:
  ~~~typescript
  import { IMessageQueue, IMQService, expose } from '@imqueue/rpc';

  export class SomeService extends IMQService {
    public async start(): Promise<IMessageQueue | undefined> {
      // async setup here — e.g. open a database connection...
      return super.start();
    }
  }
  ~~~
* Prefer the injected logger over `console` for debug, info, warning and error
  output:
  ~~~typescript
  import { IMQService, expose } from '@imqueue/rpc';

  export class SomeService extends IMQService {
    @expose()
    public loggedStuff() {
      this.logger.log('I am a logged string!');
    }
  }
  ~~~
* Because remote calls send data across the network, all arguments and return
  values of exposed methods **must be JSON-serializable**.
* You **cannot** use the spread operator for exposed-method arguments — it won't
  work on the generated client (a known limitation). Pass such arguments as an
  array instead:
  ~~~typescript
  import { IMQService, expose } from '@imqueue/rpc';

  export class SomeService extends IMQService {
    // INCORRECT — the client for this service will not compile
    @expose()
    public incorrectStuff(...args: any[]) {
      args.forEach((arg) => {
        // do something with arg...
      });
    }

    // CORRECT
    @expose()
    public correctStuff(args: any[]) {
      args.forEach((arg) => {
        // do something with arg...
      });
    }

    // Also fine — this one isn't exposed
    private somePrivateStuff(...args: any[]) {
      args.forEach((arg) => {
        // do something with arg...
      });
    }
  }

  (async () => {
    // assuming we have a client for the service:
    const client = new SomeServiceClient();
    await client.start();

    // we'd like to write this:
    client.incorrectStuff(1, 2, 3);
    // but we do this instead — hardly a hardship:
    client.correctStuff([1, 2, 3]);
  })();
  ~~~

### The importance of doc-blocks

JavaScript and TypeScript offer little reflection tooling, so there's no easy way
to recover argument and return-value types at runtime. @imqueue works around this
by reading the doc-blocks attached to your class methods to build its service
description.

This is good practice from every angle: well-written doc-blocks make code more
readable and self-documenting, and let you auto-generate API docs. In @imqueue's
case they're also **mandatory** — the framework needs them to describe a service
and to generate a correctly working client.

Here's what you need to know about writing doc-blocks for @imqueue services:

* Always use `@param` and `@return` tags with a proper type for every input
  argument and return value:

  ~~~typescript
  {% raw %}import { IMQService, expose } from '@imqueue/rpc';

  export class SomeService extends IMQService {
    /**
     * Some method description goes here
     *
     * @param {string} argOne - description of the first argument
     * @param {boolean} argTwo - description of the second argument
     * @param {{name: string, value: number}} [argThree] - description of the third, optional argument
     * @return {{x: number, y: number}} - description of the return value
     */
    @expose()
    public someMethod(
      argOne: string, argTwo: boolean, argThree?: { name: string, value: number },
    ): { x: number, y: number } {
      // do something with the args...
      return { x: 5, y: 7 };
    }
  }{% endraw %}
  ~~~
* Wrap optional argument names in `[]` in the doc-block — this is what marks them
  as optional on the generated client.
* Use TypeScript type notation in doc-blocks for arguments and return values;
  it's carried through into the generated client code.

### Complex types

@imqueue services support complex types in the data exchanged between a client
and a service. A few rules ensure that both sides understand and use them
correctly.

Define a complex type's interface on the service side using a **class**, not a
TypeScript interface. This is because a class exists in the compiled JavaScript,
whereas an interface exists only in TypeScript and is gone at runtime. There's a
second wrinkle: JavaScript classes don't support bare properties (only getters
and setters), so while TypeScript is happy with a plain property definition,
@imqueue needs extra metadata to see it at the JavaScript level. That metadata is
supplied by the `@property()` decorator:

~~~typescript
function property(typeName: string, isOptional: boolean = false): () => {}
~~~

Since v3.x, each complex-type class **must** also be annotated with the
`@classType()` class decorator. @imqueue v3 uses standard (TC39) decorators, under
which `@property()` only collects field metadata — the class-level `@classType()`
then finalizes and registers that metadata as a named type, so that both the
service and the generated client recognise it:

~~~typescript
function classType(): (value: Function, context: ClassDecoratorContext) => void
~~~

Putting it together:

~~~typescript
// service-side definition of the type:
import { classType, property } from '@imqueue/rpc';

@classType()
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

This compiles, on the client side, to a matching TypeScript interface, so the
type can be used for correct type-checking on both sides:

~~~typescript
// generated client-side definition of the type
interface UserObject {
    firstName: string;
    lastName: string;
    email: string;
    phoneNumber?: string;
}
~~~

The type can then be used in service methods (assuming the definition lives in
its own file):

~~~typescript
import { IMQService, expose } from '@imqueue/rpc';
import { UserObject } from './types/UserObject';

class UserService extends IMQService {
    /**
     * Updates a user record
     *
     * @param {UserObject} data - user data fields
     * @return {Promise<UserObject | null>} - the saved user, or null on failure
     */
    @expose()
    public async update(data: UserObject): Promise<UserObject | null> {
        // do logic...
        return data;
    }
}
~~~

This guarantees correct type-checking at the client level.

Complex types can nest other complex types. Suppose we extend the user model to
be associated with one or more address objects:

~~~typescript
import { classType, property } from '@imqueue/rpc';

@classType()
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

@classType()
class UserObject {
    @property('string')
    firstName: string;

    @property('string')
    lastName: string;

    @property('string')
    email: string;

    @property('AddressObject[]', true)
    addresses?: AddressObject[];
}
~~~

### Working with the service description

If you ever need to access a service's description metadata, just call
`describe()` on a service client:

~~~typescript
// assuming this runs in an async context:
const client = new UserClient();
await client.start();
console.log(await client.describe());
~~~

This prints all the metadata about the service's classes, methods and complex
types.

### Delayed messaging

Delayed messaging with `@imqueue/rpc` is easy: any exposed service method can be
called with a delay. This is handy for building scheduling queues. Just pass a
`delay` parameter (of type
[IMQDelay](/api/rpc/latest/rpc.imqdelay/)) in any client method
call:

~~~typescript
import { IMQDelay } from '@imqueue/rpc';
import { UserObject, UserClient } from './clients';

const client = new UserClient();
const data: UserObject = {
    firstName: 'John',
    lastName: 'Doe',
    email: 'john@doe.com',
};

await client.start();
// run the scheduled work in 1 hour, and handle the result asynchronously
// once it completes, without blocking:
client.doScheduledStuff(data, new IMQDelay(1, 'h'))
    .then((result: any) => client.logger.log(result));
~~~

### Locking

Locking is a powerful tool in `@imqueue/rpc` for optimising remote calls.
Imagine your system receives hundreds or thousands of calls to the same method,
with the same execution context, in a very short window — and each returns the
same result. This happens, for example, when popular content is requested by many
users but stays effectively static over that short period. Without help, your
back-end runs the same work hundreds or thousands of times a second for no real
reason. Locks fix this.

When `@lock()` wraps a method, the first matching call acquires an asynchronous
lock. Until that call resolves, all other calls with the same signature wait; when
it resolves, they're all resolved with the same result.

For example, if a specific blog post is fetched 100 times over 100 milliseconds,
and the database fetch itself takes about 100 milliseconds, the actual logic runs
just once — and all 100 waiting clients are resolved with the same value:

~~~typescript
import { IMQService, expose, lock } from '@imqueue/rpc';
import { BlogPost } from './types';

class BlogService extends IMQService {
    /**
     * Returns the blog post for a given identifier
     *
     * @param {string} id - blog post identifier
     * @return {Promise<BlogPost>} - the blog post data
     */
    @lock()
    @expose()
    public async fetchPost(id: string): Promise<BlogPost> {
        let data: BlogPost;
        // fetch the blog post from the database by id...
        return data;
    }
}
~~~

Meanwhile, concurrent calls for *different* blog post identifiers run under their
own contextual locks and resolve their clients with their own values.

This offers two advantages:

1. **Lower back-end load** — less logic executed, fewer database calls.
2. **Better average response time** — the first caller waits longest, but the
   last is served almost instantly, so the average across all callers improves.

There is a trade-off. To identify the execution context, the locking mechanism
hashes the call's signature, which costs time and CPU. The algorithm is efficient,
but its cost grows with the length of the method signature. In some cases you may
gain nothing from locking, so weigh it up: for high-load, slow methods it's
clearly worth it; when the method is cheaper to run than its signature is to hash,
it isn't.

Locking isn't limited to a method decorator. IMQ also provides a general-purpose
asynchronous lock class,
[IMQLock](/api/rpc/latest/rpc.imqlock/), that you can use
wherever you need it across your back-end.

### Caching

Caching is another optimisation tool @imqueue provides. It caches a method's
results using a caching adapter (Redis is the default, and currently the only
built-in one). You can supply your own adapter by implementing the
[ICache](/api/rpc/latest/rpc.icache/) and
[ICacheConstructor](/api/rpc/latest/rpc.icacheconstructor/)
interfaces.

Out of the box, use the `@cache()` decorator on service methods, or work with the
[IMQCache](/api/rpc/latest/rpc.imqcache/) registry and the
[RedisCache](/api/rpc/latest/rpc.rediscache/) engine directly.

Typical usage:

~~~typescript
import { IMQService, expose, cache } from '@imqueue/rpc';
import { BlogPost } from './types';

class BlogService extends IMQService {
    /**
     * Returns the blog post for a given identifier
     *
     * @param {string} id - blog post identifier
     * @return {Promise<BlogPost>} - the blog post data
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

Like `@lock()`, `@cache()` works per call signature. All of @imqueue's decorators
can be combined on a service method to improve overall performance and stability.
Write load tests for your back-end and use them to find the best optimisation
strategy for your case.
