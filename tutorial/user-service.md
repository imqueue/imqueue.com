---
layout: page
title: "Tutorial"
section_id: docs
---

<div class="content">
    <div class="special-title centered-text">
        <i class="icon-book goldenrod-text"></i>
        <h1>{{ page.title }}</h1>
        <p>
            Step-by-step guide of building back-end services for car washing
            web application using @imqueue
        </p>
        <p class="shortline"></p>
        <div class="spacing"></div>
    </div>
</div>
<div class="large-3 columns right panel radius toc" markdown="1">
<h4>Table Of Contents</h4>
<h5>Chapter 2. User Service. Creating First Service</h5>
{:#toc}
* TOC
{:toc}

<h5>Next Chapters</h5>
<div markdown="1">
 - [Chapter 3. Auth service. Inter-Service Communication](/tutorial/auth-service)
 - [Chapter 4. Other Services](/tutorial/other-services)
 - [Chapter 5. API. Integration](/tutorial/api-service)
 - [Chapter 6. Deployment](/tutorial/deployment)
</div>

<h5>Previous Chapters</h5>
<div markdown="1">
 - [Chapter 1. Introduction](/tutorial/)
</div>
</div>

<h2>Chapter 2. User Service. Creating First Service</h2>

So we are ready to create our first service. It is recommended to create
project directory which will hold all your development repositories.

Let's start as:

~~~bash
mkdir ~/my-tutorial-app
cd ~/my-tutorial-app
~~~

### Creating The Service

Now we going to create the first service, which will be a user service.
Simply run:

~~~bash
imq service create user ./user
~~~

If everything goes well we should have `./user` directory created
containing all the files required and all dependencies installed.

### Service Configuration

We can test if it works simply running `npm run dev` command. Be aware
at this point that you need Redis running on your localhost and default
port. If you have Redis running on another host:port, then before
launching the service you need to change a configuration.

Configuration file is located at `./user/config.ts`. There are two
different possibilities configuring Redis access within the service -
a single Redis instance or a cluster of Redis instances. This should be
defined by a scaling needs. If you writing a service which should handle
very heavy load you might want to configure a cluster, otherwise
you may suggest a single instance is OK.

Anyway, a good option at this place would be to obtain a configuration
from an environment and bypass it to a service config, so this
configuration may be changed dynamically by a deployment needs.

Here is how we might want to change our `config.ts` file for the
service:

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

And what we can do now is simply put `.env` file in root directory of
the service specifying our Redis configuration we want to have on our
local environment (assuming we have redis running on
`some-redis-special.host:63790`.

`.env`:
~~~bash
IMQ_REDIS="some-redis-special.host:63790"
~~~

If you have Redis running at `localhost:6379`, which is default
standard address you can skip this configuration at this step.

### Local Environment

When developing a service usually we need to have an ability to launch
it in local environment directly which is useful during development
process. By the way, we must keep in mind that our service in production
environment most of the cases will run with a different configuration.

Hence a good way here is to get a configuration from environment
variables. As far as you may have different projects running on
your dev machine it could be tricky to setup an environment variables
globally for the system. Using `.env` files allows you to solve this
problem. This feature is available out-of-the-box with @imqueue
services, so whenever you need to have some specific configuration set
on your dev machine for the service - just create `.env` file in the
service root directory and put all required variables you may want to
read from the environment. Those files will be never committed, so it is
safe for production runs.

### Verifying

Now let's check if our service is operational. Run this command:

~~~bash
npm run dev
~~~

If everything is fine it should produce the following output:

~~~
User: starting single-worker, pid 27034
Starting clustered redis message queue...
User: reader channel connected, host localhost:6379, pid 27034
User: writer channel connected, host localhost:6379, pid 27034
~~~

That signals that everything is OK and we can now use the service. The
boilerplate produced by @imqueue always creates a service with one
method available to call remotely, which is `hello()`, as far as it
requires at least one external method to be implemented to run without
errors. When you implement your real first method on a service it is
safe to remove generated `hello()` method off the service.

But at this point we will use it to verify if our service works.
Let's create `debug.ts` file in the root directory of the service with
the following content:

~~~typescript
import { IMQClient, ILogger } from '@imqueue/rpc';
import { User } from './src';
import { serviceOptions } from './config';

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

That will launch the service and it's client and do a remote call of
service's `hello()` method. The output should look like:

~~~
User: starting single-worker, pid 32372
User: reader channel connected, host localhost:6379, pid 32372
User: writer channel connected, host localhost:6379, pid 32372
UserClient-6a4e92f40a6e4d7e8a650c6c44d79ab2-2:client: reader channel connected, host localhost:6379, pid 32372
UserClient-6a4e92f40a6e4d7e8a650c6c44d79ab2-2:client: reader channel connected, host localhost:6379, pid 32372
UserClient-6a4e92f40a6e4d7e8a650c6c44d79ab2-2:client: writer channel connected, host localhost:6379, pid 32372
Hello!
~~~

That means that service works as expected!

When running in development mode @imqueue is watching for file changes
using nodemon, so we can simply run our service and start development.

### Adding Dependencies

No differs from what we usually do, just use `npm install`. For this
service our choice of data storage was MongoDB, so we can consider to
use `mongoose` package to work with it. That's what we need:

~~~bash
npm i --save mongoose
npm i --save-dev @types/mongoose
~~~

### The Implementation

#### Prepare data storage

First of all let's create mongoose database schema for our service as
far as we decided to use MongoDB as data storage engine. It is can be
done in a usual way, @imqueue does not introduce any limits here.

Create file `./user/src/schema.ts` or whatever the path you would like
to have it and put the following content:

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

By design we need to store information about user, such as
- identifier
- first name
- last name
- email
- password
- isActive flag (to have an ability block users if there any reason)
- isAdmin flag (to define users of admin role)
- user cars in garage (we plan to have a service car which would manage
  cars database, but here we would need to assign the selected car data
  to a user, so we define only those fields which should implement
  references between users, car objects and additionally store
  user-specific car data, like car registration number)

Now we need to implement required operations on that data, which can be
called by a remote client, so we are going to implement our public
service methods now.

Open `./user/src/User.ts` file which contains our service class
implementation which we are going to change.

#### Prepare Database Connection

First of all let's import our mongoose schema, add the following line
at the top of the file:

~~~typescript
import { schema } from './schema';
~~~

Next thing we need to do initialize MongoDB connection on service
start-up and init our database schema so we can use it.

Thus, let's define the next properties on our service class:

~~~typescript
private db: mongoose.Connection;
private UserModel: mongoose.Model<any>;
~~~

Usually such thing as establishing database connection is asynchronous.
Better to override `IMQService.start()` method for such purpose.
As the first step to do that let's define private `initDb()` method:

~~~typescript
/**
 * Initializes mongo database connection and user schema
 *
 * @return Promise<any>
 */
@profile()
private async initDb(): Promise<any> {
    return new Promise((resolve, reject) => {
        mongoose.set('useCreateIndex', true);
        mongoose.set('useNewUrlParser', true);
        mongoose.connect('mongodb://localhost/user');

        this.db = mongoose.connection;
        this.db.on('error', reject);
        this.db.once('open', resolve);

        this.UserModel = mongoose.model('User', schema);
    });
}
~~~

Now let's override `start()` method:

~~~typescript
/**
 * Overriding start method to inject mongodb connection establishment
 */
@profile()
public async start(): Promise<IMessageQueue | undefined> {
    this.logger.log('Initializing MongoDB connection...');
    await this.initDb();

    return super.start();
}
~~~

#### Logging Ninja

We used `this.logger` here, which is a good way to deal with debugging
output. By default the used logger is standard `console`, but you can
re-configure it using `config.ts` and all debug/log/error outputs will
be handled by a configured logger. This might be useful if you want
to redirect all log outputs into some specific place or remote service.
For example you may want to use `winston` module to organize your
logging and provide different transports to put debug info into some
local storage and/or into remote service like logentries.

Hence using `this.logger` is a good practice to ensure your logs can be
easily managed and monitored.

Starting from this point we are ready to go implementing remote
interface for our User Service.

#### Exposing interface

Initially we can define an external interface of our service to mark
what our service will do, and here is what we can imagine:

~~~typescript
/**
 * Creates or updates existing user with the new data set
 *
 * @param {UserObject} data - user data fields
 * @param {string[]} [fields] - fields to return on success
 * @return {Promise<UserObject | null>} - saved user data object
 */
@profile()
@expose()
public async update(
    data: UserObject,
    fields?: string[]
): Promise<UserObject | null> {
    // TODO: implement...
    return null;
}

/**
 * Look-ups and returns user data by either user e-mail or by user object
 * identifier
 *
 * @param {string} criteria - user identifier or e-mail string
 * @param {string[]} [fields] - fields to select and return
 * @return {Promise<UserObject | null>} - found user object or nothing
 */
@profile()
@expose()
public async fetch(
    criteria: string,
    fields?: string[]
): Promise<UserObject | null> {
    // TODO: implement...
    return null;
}

/**
 * Returns collection of users matched is active criteria. Records
 * can be fetched skipping given number of records and having max length
 * of a given limit argument
 *
 * @param {UserFilters} [filters] - is active criteria to filter user list
 * @param {string[]} [fields] - list of fields to be selected and returned for each found user object
 * @param {number} [skip] - record to start fetching from
 * @param {number} [limit] - selected collection max length from a starting position
 * @return {Promise<UserObject[]>} - collection of users found
 */
@profile()
@expose()
public async find(
    filters?: UserFilters,
    fields?: string[],
    skip?: number,
    limit?: number,
): Promise<UserObject[]> {
    // TODO: implement...
    return [];
}

/**
 * Returns number of users stored in the system and matching given criteria
 *
 * @param {UserFilters} [filters] - filter by is active criteria
 * @return {Promise<number>} - number of user counted
 */
@profile()
@expose()
public async count(filters?: UserFilters): Promise<number> {
    // TODO: implement...
    return 0;
}

/**
 * Attach new car to a user
 *
 * @param {string} userId - user identifier to add car to
 * @param {string} carId - selected car identifier
 * @param {string} regNumber - car registration number
 * @param {string[]} [selectedFields] - fields to fetch for a modified user object
 * @return {Promise<UserObject | null>} - operation result
 */
@profile()
@expose()
public async addCar(
    userId: string,
    carId: string,
    regNumber: string,
    selectedFields?: string[],
): Promise<UserObject | null> {
    // TODO: implement...
    return null;
}

/**
 * Removes given car from a user
 *
 * @param {string} carId - user car identifier
 * @param {string[]} [selectedFields] - fields to fetch for a modified user object
 * @return {Promise<UserObject | null>} - modified user object
 */
@profile()
@expose()
public async removeCar(
    carId: string,
    selectedFields?: string[],
): Promise<UserObject | null> {
    // TODO: implement...
    return null;
}

/**
 * Returns car object of a given user, fetched by identifier
 *
 * @param {string} userId - user identifier
 * @param {string} carId - car identifier
 * @return {Promise<UserCarObject | null>}
 */
@profile()
@expose()
public async getCar(
    userId: string,
    carId: string,
): Promise<UserCarObject | null> {
    // TODO: implement...
    return null;
}

/**
 * Returns number of cars registered for the user having given id or email
 *
 * @param {string} idOrEmail
 * @return {Promise<number>}
 */
@profile()
@expose()
public async carsCount(idOrEmail: string): Promise<number> {
    // TODO: implement...
    return 0;
}
~~~

What you would need to know here about defining the externally callable
methods is that you need to follow several rules, which are mandatory:

1. If you need to make service method externally callable it MUST
   be wrapped with `@expose()` decorator.
1. Each service you implement MUST have at least one externally
   callable method.
1. It is strictly recommended to define appropriate doc-blocks for
   each externally callable method, following the next simple rules:
   - All param and return value types should be described in TypeScript
     notation.
   - Each param that is optional, must be described as optional in
     dock-block, use '[]' to wrap an optional param, like this:
     `@param {string} [name]`

Following these rules guarantees that you will have appropriately
set descriptions for your service and you will have expectantly working
clients generated for your service.

After interface has been defined as above we can see that our service
does not compile. The reason is that we declared some arguments
and return values of types which TypeScript can not recognize. Those
are: `UserObject`, `UserCarObject` and `UserFilters`.

#### Defining Externally Accessible Service Complex Types

Using the doc-blocks we can describe any complex data structures in
TypeScript notations, but it is not always useful as we might need
to duplicate a lot of code.  So a good way here is to define re-usable
complex types.

Due to some limitations the ONLY correct way to describe complex types
which could be exported remotely is to define them using classes. So the
first rule here is to use classes for describing complex objects. Here
we go:

~~~bash
mkdir ./user/src/types
touch ./user/src/types/UserObject.ts
~~~

Now put the following contents inside the newly created file:

~~~typescript
import { property } from '@imqueue/rpc';
import { UserCarObject } from '.';

/**
 * Serializable user type
 */
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

Second rule - use `@property()` decorator factory whenever you need to
expose a complex type property for remote access. This is required to
describe a type definition.

`@property()` decorator takes property type in TypeScript notation as
the first argument. If the property should be defined as optional
for that type, you can bypass `true` as a second argument.

Types described in a such way on a service will be available on a
client side as interfaces, given an ability to perform type checks by
a TypeScript compiler.

If there is any need it is possible to skip decoration on the type
property and it provides a way to hide part of service-level related
implementation.

Type property may refer to another complex type, as we can see in our
example - cars property referring to an array of `UserCarObject`.

So, let's proceed with other types definitions we missing.

~~~bash
touch ./user/types/UserCarObject.ts
~~~

Put this content inside:

~~~typescript
import { property } from '@imqueue/rpc';

export class UserCarObject {
    @property('string')
    _id: string;

    @property('string')
    carId: string;

    @property('string')
    regNumber: string;
}
~~~

And the same for `UserFilters` type:

~~~bash
touch ./user/types/UserFilters.ts
~~~

~~~typescript
import { property } from '@imqueue/rpc';

export class UserFilters {
    @property('string', true)
    email: string;

    @property('boolean', true)
    isActive: boolean;

    @property('boolean', true)
    isAdmin: boolean;

    @property('string', true)
    firstName?: string;

    @property('string', true)
    lastName?: string;
}
~~~

Now we need to import our types into the service class module:

~~~typescript
import { UserCarObject } from './types/UserCarObject';
import { UserFilters } from './types/UserFilters';
import { UserObject } from './types/UserObject';
~~~

That's it. Now our service should compile properly with no errors.

The last thing here will be to implement logic for service methods, but
let's keep it for your home-work, or you can simply refer the [source
code](https://github.com/imqueue-sandbox/user) available on GitHub.

Go to next chapter - [Creating Auth Service](/tutorial/auth-service).
