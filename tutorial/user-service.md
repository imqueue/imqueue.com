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
<h5>Chapter 2. User service</h5>
{:#toc}
* TOC
{:toc}

<h5>Next Chapters</h5>
<div markdown="1">
 - [Chapter 3. Auth service](/tutorial/auth-service)
 - [Chapter 4. Car service](/tutorial/car-service)
 - [Chapter 5. TimeTable service](/tutorial/time-table-service)
 - [Chapter 6. API service. Integration](/tutorial/api-service)
 - [Chapter 7. Testing](/tutorial/testing)
 - [Chapter 8. Deployment](/tutorial/deployment)
</div>

<h5>Previous Chapters</h5>
<div markdown="1">
 - [Chapter 1. Introduction](/tutorial/)
</div>
</div>

<h2>Chapter 2. User service</h2>

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

First of all let's create mongoose database schema for our service as
far as we decided to use MongoDB as data storage engine. It is can be
done in a usual way, @imqueue does not introduce any limits here.

Create file `./user/src/schema.ts` or whatever the path you would like
to have it and put the following content:

~~~typescript
import * as mongoose from 'mongoose';

export const schema = new mongoose.Schema({
    id: mongoose.SchemaTypes.ObjectId,
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

So that's what happened here is that we created mongoose document schema
to store user and his garage of cars in MongoDB. That means that we
defined a data structures we want to operate on our service internally.

Now we need to implement required operations on that data, which can be
called by a remote client, so we are going to implement our public
service methods now.

Open `./user/src/User.ts` file which contains our service class
implementation which we are going to change.

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


