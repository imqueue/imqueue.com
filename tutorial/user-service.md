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
problem. This feature is available out-of-the-box with@imqueue services,
so whenever you need to have some specific configuration set on your
dev machine for the service - just create `.env` file in the service
root directory and put all required variables you may want to read from
the environment. Those files will be never committed, so it is safe for
production runs.

### Adding Dependencies

No differs from what we usually do, just use `npm install`. For this
service our choice of data storage was MongoDB, so we can consider to
use `mongoose` package to work with it. That's what we need:

~~~bash
npm i --save mongoose
npm i --save-dev @types/mongoose
~~~

### Writing The Code


