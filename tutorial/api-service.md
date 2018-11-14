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
            web application using @imqueue.
        </p>
        <p>
         For those who prefer to learn by example.
        </p>
        <p class="shortline"></p>
        <div class="spacing"></div>
    </div>
</div>
<div class="large-3 columns right panel radius toc" markdown="1">
<h4>Table Of Contents</h4>
<h5>Chapter 5. API Service. Integration</h5>
{:#toc}
* TOC
{:toc}

<h5>Next Chapters</h5>
<div markdown="1">
 - [Chapter 6. Deployment](/tutorial/deployment)
</div>

<h5>Previous Chapters</h5>
<div markdown="1">
 - [Chapter 1. Introduction](/tutorial/)
 - [Chapter 2. User service](/tutorial/user-service)
 - [Chapter 3. Auth service. Inter-Service Communication](/tutorial/auth-service)
 - [Chapter 4. Other services](/tutorial/other-services)
</div>
</div>

<h2>Chapter 5. API Service. Integration</h2>

So, here is one of the most interesting parts of our system. API service
is suggested to expose an external HTTP based interface and orchestrate
the access to underlying backend services we have already built.

This is combined ideally with such a tool as GraphQL, which could act as
an orchestrator for underlying services, that's why we are considering to
choose it.

In this tutorial we do not aim to discuss anything about GraphQL, but
we want to focus on @imqueue integrations. So, if you are not familiar
with GraphQL, consider to learn it using [corresponding](https://graphql.org/learn/)
[resources](https://www.graphql.com/tutorials/), or just skip this part
and refer to [existing source code](https://github.com/imqueue-sandbox/api)
of API service we built for you on GitHub.

### Initializing the Service

Despite the fact that API Service differs by its structure and
implementation of what @imqueue usual service is, we can re-use
@imqueue/cli to initialize it:

~~~bash
cd ~/my-tutorial-app
imq service create api ./api
~~~

It will install all required dependencies to work with @imqueue. By the
way, we do not need it to be a classic @imqueue service rather than we
need to build it as GraphQL server over HTTP, so we just need to add
required dependencies and re-work start script.

~~~bash
npm i --save express express-graphql graphql graphql-relay \
    graph-fields-list graphql-validity \
    body-parser compression helmet core-js
npm i --save-dev @types/body-parser @types/compression \
    @types/core-js @types/express @types/express-graphql \
    @types/graphql @types/graphql-relay @types/helmet
~~~

> **NOTE!** It is not principle which stack of technologies you are
> choosing at this point to build-up API service. You may consider to
> choose Apollo GraphQL server instead, or any other solution you may
> prefer. We just give the official Facebook's stack over express
> with manually selected set of add-ons, but this way is not mandatory.

Now simply remove `./api/src/Api.ts` service file as we don't need it,
and remove everything from `./api/index.ts`. So, we keep all npm scripts
from @imqueue boilerplate, they should work OK for us, but we will
change the contents of a service - now it should launch HTTP server using
express with configured end-point serving GraphQL requests.

We will not focus on this - you can rather implement it yourself if you
have enough experience, or just refer to
[source code](https://github.com/imqueue-sandbox/api) we built for you
on GitHub. Take a closer look at
[`index.ts`](https://github.com/imqueue-sandbox/api/blob/master/index.ts) and
[`src/Application.ts`](https://github.com/imqueue-sandbox/api/blob/master/src/Application.ts)
implementation.

The essence of @imqueue integration is hidden inside `bootstrapContext()`
method of Application class. Here we instantiating all @imqueue/rpc clients
using which we are going to orchestrate requests to underlying services.
And starting up all that clients as a part of API service start-up
process.

Then an execution context is bypassed to a GraphQL layer, which will take
care to bypass it to all resolvers inside GraphQL schema, so we would
be able to access all our services whenever we need it.

~~~typescript
import { clientOptions } from '../config';
import { user, auth, car, timeTable } from './clients';

class Application {
    /// ...
    /**
     * Initializes runtime context for graphql application
     *
     * @return {any} - initialized context
     */
    private static async bootstrapContext(): Promise<any> {
        const context: any = {
            user: new user.UserClient(clientOptions),
            auth: new auth.AuthClient(clientOptions),
            car: new car.CarClient(clientOptions),
            timeTable: new timeTable.TimeTableClient(clientOptions),
        };

        await context.user.start();
        await context.auth.start();
        await context.car.start();
        await context.timeTable.start();

        return context;
    }
    /// ...
}
~~~

As we already know from [chapter 3](/tutorial/auth-service#the-service-client)
clients are required part of @imqueue/rpc and they provide RPC way for
calling a remote services. In that chapter we learn how to use
dynamically built clients. Now we will focus on building client code
statically.

### Building The Clients

Building static clients code is a good way to deal with @imqueue services
as far as it provides several meaningful advantages:

- You do not need to take care about the order of services launch (as
  far as you do not need to have service running to build a client for
  it).
- You have a pre-built code which is accessible by your IDE and could
  help you understand the service interface during development,
  including such great opportunities, like auto-complete functionality
  inside your IDE.
- You have a way to version your implementations and consider managing
  compatibilities between different versions of your code.

And the last point is that due to the fact that all clients are located in one place
(especially in case we don't care about dynamically built client on
auth service) - there would be no code duplication we need to maintain.
In other case we could imagine the systems, where the same service client
can be generated and used on different network points. Thus, in such a
case there would be a need to organize management of client updates. Our
case is simple, so you may think on that problem outside of topics in
this tutorial.

Practically to generate a client code you just need to launch a single
command. But before executing it you have to make sure the service, which
you want to build client for, is up and running.

~~~bash
imq client generate User ./api/src/clients
imq client generate Auth ./api/src/clients
imq client generate Car ./api/src/clients
imq client generate TimeTable ./api/src/clients
~~~

You may also consider to add that commands as an npm script, so you
will be able to simplify clients (re-)generation with a single command
execution, like:

~~~bash
npm run rebuild-clients
~~~

or something similar.

### Querying The Services

So, finally, while building a GraphQL schema we are ready to query our
services. For example, consider we want to query a list of car brands:

~~~typescript
import {
    GraphQLResolveInfo,
    GraphQLList,
    GraphQLSchema,
    GraphQLObjectType,
    GraphQLString,
} from 'graphql';
import { user, car, timeTable, auth } from '../clients';

interface Context {
    user: user.UserClient;
    car: car.CarClient;
    timeTable: timeTable.TimeTableClient;
    auth: auth.AuthClient;
}

export const schema = new GraphQLSchema({
    query: new GraphQLObjectType({
    name: 'Query',
        fields: {
            brands: {
                description: 'Fetches list of car brands',
                type: new GraphQLList(GraphQLString),
                async resolve(
                     source: any,
                     args: any,
                     context: Context,
                     info: GraphQLResolveInfo,
                ): Promise<string[]> {
                     try {
                         return await context.car.brands();
                     } catch (err) {
                         console.warn('Fetch brands error:', err);
                         return [];
                     }
                },
            },
        },
    });
});
~~~

Hence, as far as context is build-up during the startup of API service
and GraphQL given the access to it in any possible resolver, we are able
to call remote services and fetch the required data whenever we need it
in a simple way.

So, as seen from that example, on a client side there is no too much work
to do. All you need is just build-and-use. All implementation is done
at one place which is service implementation.

This pattern gives you a way to do a "normal" programming, dealing with
your services as with standard objects having methods, so you can
imperatively create complex combinations of services calls inside
GraphQl resolvers.

Full example of API Service implementation is available
[here](https://github.com/imqueue-sandbox/api).

Go to the next chapter - [Deployment](/tutorial/deployment)
