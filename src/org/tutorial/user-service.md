---
chapter: 2
title: User Service — your first service
docLabel: TUTORIAL — CHAPTER 2
lead: "Create your first @imqueue service — the User service — and expose typed methods that other services can call."
description: "Build your first @imqueue service in Node & TypeScript — the User service — and expose typed methods other services can call over the message queue."
keywords: "@imqueue service, create Node.js microservice, expose RPC methods, IMQService, TypeScript service tutorial, @expose decorator, message queue service"
ogType: article
---

We're ready to create our first service. Start by making a project directory to
hold all of the tutorial's repositories:

~~~bash
mkdir ~/my-tutorial-app
cd ~/my-tutorial-app
~~~

### Creating the service

Scaffold the User service with a single command:

~~~bash
imq service create user ./user
~~~

If all goes well, you'll have a `./user` directory containing every file the
service needs, with all dependencies already installed.

### Configuring the service

You can check that it works by running `npm run dev`. This requires Redis
running on `localhost` and the default port. If your Redis runs on a different
host or port, adjust the configuration first.

The configuration file lives at `./user/config.ts`. Redis access can be
configured in two ways: a single Redis instance, or a cluster of instances.
Which one you choose depends on your scaling needs — configure a cluster for
services expected to handle heavy load, and a single instance otherwise.

A good practice at this point is to read the configuration from the environment
and pass it into the service config, so it can be changed at deployment time
without touching code. Here is one way to adapt `config.ts`:

~~~typescript
import {
    IMQServiceOptions,
    DEFAULT_IMQ_SERVICE_OPTIONS as opts,
} from '@imqueue/rpc';
import { config as initEnvironment } from 'dotenv';

initEnvironment();

export const serviceOptions: Partial<IMQServiceOptions> = {
    cluster: (process.env['IMQ_REDIS'] || `${opts.host}:${opts.port}`)
        .split(',').map((instance: string) => {
            const [host, port] = instance.split(':');
            return { host, port: Number(port) };
        }),
};
~~~

With that in place, you can put a `.env` file in the service's root directory to
set the Redis configuration for your local environment. For example, if Redis is
running at `some-redis-special.host:63790`:

`.env`:
~~~bash
IMQ_REDIS="some-redis-special.host:63790"
~~~

If your Redis runs at `localhost:6379` (the standard default), you can skip this
step for now.

### Local environment

During development it's convenient to run a service directly in your local
environment. Keep in mind, though, that in production the same service will
usually run with a different configuration.

Reading configuration from environment variables solves this cleanly. Because
you may have several projects on your development machine, setting environment
variables globally can get awkward — `.env` files avoid that. @imqueue services
support `.env` files out of the box: whenever a service needs local
configuration, create a `.env` file in its root directory and list the variables
you want to read from the environment. These files are never committed, so they
stay out of production runs.

### Verifying the service

Let's confirm the service is operational:

~~~bash
npm run dev
~~~

If everything is fine, you should see output like this:

~~~
User: starting single-worker, pid 27034
Starting clustered redis message queue...
User: reader channel connected, host localhost:6379, pid 27034
User: writer channel connected, host localhost:6379, pid 27034
~~~

That means the service is up and ready. The @imqueue boilerplate always
scaffolds a service with one remotely callable method — `hello()` — because a
service needs at least one exposed method to start without errors. Once you've
implemented your own first method, it's safe to remove the generated `hello()`.

For now, we'll use `hello()` to verify the service. Create a `debug.ts` file in
the service's root directory with the following content:

~~~typescript
import { IMQClient, ILogger } from '@imqueue/rpc';
import { User } from './src/index.js';
import { serviceOptions } from './config.js';

const logger: ILogger = serviceOptions.logger || console;

new User(serviceOptions).start().then((service: any) => {
    IMQClient.create('User', { write: false }).then(async (ns: any) => {
        let client: any;

        try {
            client = new ns.UserClient(serviceOptions);

            await client.start();
            console.log(await client.hello());
        }

        catch (err) {
            logger.error(err);
        }

        await client.destroy();
        await service.destroy();
    });
});
~~~

This starts the service and a client, then makes a remote call to the service's
`hello()` method. The output should look like:

~~~
User: starting single-worker, pid 32372
User: reader channel connected, host localhost:6379, pid 32372
User: writer channel connected, host localhost:6379, pid 32372
UserClient-6a4e92f40a6e4d7e8a650c6c44d79ab2-2:client: reader channel connected, host localhost:6379, pid 32372
UserClient-6a4e92f40a6e4d7e8a650c6c44d79ab2-2:client: writer channel connected, host localhost:6379, pid 32372
Hello!
~~~

That confirms the service works as expected.

In development mode, @imqueue watches for file changes with nodemon, so you can
simply run the service and start coding.

> **NOTE:** any file or folder whose name matches the `debug*` pattern is
> ignored by git, so you can use `debug.ts` freely — or adjust your ignore files
> if you prefer different behaviour.

### Adding dependencies

Adding dependencies works exactly as it does in any Node.js project — just use
`npm install`. We chose MongoDB as the data store for this service, so we'll use
the `mongoose` package to work with it:

~~~bash
npm i --save mongoose
~~~

### Implementing the service

#### Prepare the data store

First, define a Mongoose schema for the service. @imqueue imposes no constraints
here — do it the usual way.

Create `./user/src/schema.ts` (or any path you prefer) with the following
content:

~~~typescript
import * as mongoose from 'mongoose';

export const schema = new mongoose.Schema({
    email: {
        type: mongoose.SchemaTypes.String,
        unique: true,
        required: true,
    },
    password: {
        type: mongoose.SchemaTypes.String,
        required: true,
    },
    isActive: {
        type: mongoose.SchemaTypes.Boolean,
        default: true,
    },
    isAdmin: {
        type: mongoose.SchemaTypes.Boolean,
        default: false,
    },
    firstName: {
        type: mongoose.SchemaTypes.String,
        required: true,
    },
    lastName: {
        type: mongoose.SchemaTypes.String,
        required: true,
    },
    cars: {
        type: [{
            carId: {
                type: mongoose.SchemaTypes.String,
                required: true,
            },
            regNumber: {
                type: mongoose.SchemaTypes.String,
                required: true,
            },
        }],
        required: false,
        default: [],
    },
});
~~~

By design, we store the following for each user:

- identifier
- first name
- last name
- email
- password
- `isActive` flag — lets us block a user for any reason
- `isAdmin` flag — marks users with the admin role
- the user's cars ("garage") — a dedicated Car service will manage the cars
  database, but here we store the fields needed to link a user to a car and to
  hold user-specific data such as the car's registration number

Next we implement the operations on that data that remote clients can call — the
service's public methods.

Open `./user/src/User.ts`, which contains our service class.

#### Prepare the database connection

Import the Mongoose schema at the top of the file:

~~~typescript
import { schema } from './schema.js';
~~~

We then need to open the MongoDB connection when the service starts and register
the schema so we can use it. Declare these properties on the service class:

~~~typescript
private db: mongoose.Connection;
private UserModel: mongoose.Model<any>;
~~~

Opening a database connection is asynchronous, so the natural place to do it is
by overriding `IMQService.start()`. First, add a private `initDb()` method:

~~~typescript
/**
 * Initializes the MongoDB connection and the user schema
 *
 * @return {Promise<void>}
 */
@profile()
private async initDb(): Promise<void> {
    await mongoose.connect('mongodb://localhost/user');

    this.db = mongoose.connection;
    this.UserModel = this.db.model('User', schema);
}
~~~

Now override `start()` to call it:

~~~typescript
/**
 * Overrides start() to establish the MongoDB connection first
 */
@profile()
public async start(): Promise<IMessageQueue | undefined> {
    this.logger.log('Initializing MongoDB connection...');
    await this.initDb();

    return super.start();
}
~~~

#### A note on logging

Notice we used `this.logger` above. By default it's the standard `console`, but
you can swap in your own logger through `config.ts`, and every debug, log and
error output across the service will go through it. That's useful when you want
to route logs to a specific destination — for example, using `winston` with
transports that send output to local storage and/or a remote service such as
Sentry.

Using `this.logger` (rather than `console` directly) keeps all logging
manageable and monitorable from one place.

With that, we're ready to implement the service's remote interface.

#### Exposing the interface

Let's start by defining the external interface — the set of methods the service
will expose:

~~~typescript
/**
 * Creates or updates an existing user with the given data
 *
 * @param {UserObject} data - user data fields
 * @param {string[]} [fields] - fields to return on success
 * @return {Promise<UserObject | null>} - the saved user object
 */
@profile()
@expose()
public async update(data: UserObject, fields?: string[]): Promise<UserObject | null> {
    // TODO: implement...
    return null;
}

/**
 * Looks up and returns a user by e-mail or by object identifier
 *
 * @param {string} criteria - user identifier or e-mail
 * @param {string[]} [fields] - fields to select and return
 * @return {Promise<UserObject | null>} - the matching user, or null
 */
@profile()
@expose()
public async fetch(criteria: string, fields?: string[]): Promise<UserObject | null> {
    // TODO: implement...
    return null;
}

/**
 * Returns a collection of users matching the given criteria. Records can be
 * paginated using the skip and limit arguments.
 *
 * @param {UserFilters} [filters] - criteria to filter the user list
 * @param {string[]} [fields] - fields to select for each returned user
 * @param {number} [skip] - number of records to skip before fetching
 * @param {number} [limit] - maximum number of records to return
 * @return {Promise<UserObject[]>} - the matching users
 */
@profile()
@expose()
public async find(filters?: UserFilters, fields?: string[], skip?: number, limit?: number): Promise<UserObject[]> {
    // TODO: implement...
    return [];
}

/**
 * Returns the number of users matching the given criteria
 *
 * @param {UserFilters} [filters] - criteria to filter by
 * @return {Promise<number>} - the number of matching users
 */
@profile()
@expose()
public async count(filters?: UserFilters): Promise<number> {
    // TODO: implement...
    return 0;
}

/**
 * Attaches a new car to a user
 *
 * @param {string} userId - identifier of the user to attach the car to
 * @param {string} carId - identifier of the selected car
 * @param {string} regNumber - car registration number
 * @param {string[]} [selectedFields] - fields to return for the modified user
 * @return {Promise<UserObject | null>} - the modified user
 */
@profile()
@expose()
public async addCar(userId: string, carId: string, regNumber: string, selectedFields?: string[]): Promise<UserObject | null> {
    // TODO: implement...
    return null;
}

/**
 * Removes a car from a user
 *
 * @param {string} carId - identifier of the user's car
 * @param {string[]} [selectedFields] - fields to return for the modified user
 * @return {Promise<UserObject | null>} - the modified user
 */
@profile()
@expose()
public async removeCar(carId: string, selectedFields?: string[]): Promise<UserObject | null> {
    // TODO: implement...
    return null;
}

/**
 * Returns a given user's car, fetched by identifier
 *
 * @param {string} userId - user identifier
 * @param {string} carId - car identifier
 * @return {Promise<UserCarObject | null>}
 */
@profile()
@expose()
public async getCar(userId: string, carId: string): Promise<UserCarObject | null> {
    // TODO: implement...
    return null;
}

/**
 * Returns the number of cars registered for the user with the given id or email
 *
 * @param {string} idOrEmail - user identifier or e-mail
 * @return {Promise<number>}
 */
@profile()
@expose()
public async carsCount(idOrEmail: string): Promise<number> {
    // TODO: implement...
    return 0;
}
~~~

There are a few mandatory rules for defining externally callable methods:

1. To make a method callable remotely, wrap it with the `@expose()` decorator.
2. Every service must have at least one externally callable method.
3. Write a doc-block for each exposed method. Two rules apply:
   - Describe all argument and return-value types in TypeScript notation.
   - Mark optional arguments as optional by wrapping the name in `[]`, like
     this: `@param {string} [name]`.

Following these rules guarantees a correct service description and, in turn,
correctly generated, working clients.

With the interface above in place, the service won't compile yet — we've
referenced types TypeScript doesn't know: `UserObject`, `UserCarObject` and
`UserFilters`. Let's define them.

#### Defining exposable complex types

You can describe complex data structures inline in doc-blocks using TypeScript
notation, but that quickly leads to duplication. A cleaner approach is to define
reusable complex types.

Complex types that can be exposed remotely **must be defined as classes**. Each
such class must be annotated with the `@classType()` class decorator, and each
exposed field with the `@property()` decorator. Under @imqueue v3's standard
(TC39) decorators, `@property()` only collects field metadata — the class-level
`@classType()` then registers that metadata as a named type, so both the service
and the generated client recognise it.

Create the first type:

~~~bash
mkdir ./user/src/types
touch ./user/src/types/UserObject.ts
~~~

Put the following inside:

~~~typescript
import { classType, property } from '@imqueue/rpc';
import { UserCarObject } from './UserCarObject.js';

/**
 * Serializable user type
 */
@classType()
export class UserObject {
    @property('string', true)
    _id?: string;

    @property('string')
    email: string;

    @property('string')
    password: string;

    @property('boolean')
    isActive: boolean;

    @property('boolean')
    isAdmin: boolean;

    @property('string')
    firstName: string;

    @property('string')
    lastName: string;

    @property('UserCarObject[]')
    cars: UserCarObject[];
}
~~~

A few things to note about `@property()`:

- Its first argument is the property type in TypeScript notation.
- Pass `true` as the second argument to mark the property as optional.
- A property may reference another complex type — here, `cars` references an
  array of `UserCarObject`.
- Types defined this way appear on the client side as TypeScript interfaces,
  giving you full type-checking across the client and service.
- Leaving a property undecorated hides it from the remote interface, which is a
  handy way to keep service-internal fields private.

Now define the remaining types.

~~~bash
touch ./user/src/types/UserCarObject.ts
~~~

~~~typescript
import { classType, property } from '@imqueue/rpc';

@classType()
export class UserCarObject {
    @property('string')
    _id: string;

    @property('string')
    carId: string;

    @property('string')
    regNumber: string;
}
~~~

And `UserFilters`:

~~~bash
touch ./user/src/types/UserFilters.ts
~~~

~~~typescript
import { classType, property } from '@imqueue/rpc';

@classType()
export class UserFilters {
    @property('string', true)
    email?: string;

    @property('boolean', true)
    isActive?: boolean;

    @property('boolean', true)
    isAdmin?: boolean;

    @property('string', true)
    firstName?: string;

    @property('string', true)
    lastName?: string;
}
~~~

Finally, import the types into the service class module:

~~~typescript
import { UserCarObject } from './types/UserCarObject.js';
import { UserFilters } from './types/UserFilters.js';
import { UserObject } from './types/UserObject.js';
~~~

The service should now compile without errors.

All that's left is to implement the logic of the service methods — we'll leave
that as homework, but you can always refer to the [source
code](https://github.com/imqueue-sandbox/user) on GitHub.

Next up: [Auth Service — inter-service communication](/tutorial/auth-service).
