---
chapter: 5
title: API Integration
docLabel: TUTORIAL — CHAPTER 5
lead: "Put a GraphQL API in front of your services — @imqueue works beautifully with GraphQL."
description: "Put a GraphQL API in front of your @imqueue services — orchestrate typed microservice calls behind a single GraphQL endpoint for your front-end."
keywords: "@imqueue GraphQL, GraphQL API gateway, GraphQL microservices Node.js, orchestrate microservices, GraphQL endpoint TypeScript, API layer for microservices"
ogType: article
---

This is one of the most interesting parts of the system. The API service exposes
an external, HTTP-based interface and orchestrates access to the back-end
services we've already built.

GraphQL is an ideal fit for this role — it acts as an orchestrator over the
underlying services — which is why we've chosen it here.

This tutorial won't teach GraphQL itself; we'll focus on the @imqueue
integration. If you're new to GraphQL, learn it from the
[official](https://graphql.org/learn/) [resources](https://www.graphql.com/tutorials/)
first, or skip this part and refer to the
[finished source code](https://github.com/imqueue-sandbox/api) of the API
service we built for you on GitHub.

### Initializing the service

Although the API service differs in structure from a typical @imqueue service,
we can still use @imqueue/cli to scaffold it:

~~~bash
cd ~/my-tutorial-app
imq service create api ./api
~~~

This installs everything needed to work with @imqueue. Since we want a GraphQL
server over HTTP rather than a classic @imqueue service, we'll add a few more
dependencies and rework the start script:

~~~bash
npm i --save express cors graphql graphql-yoga graphql-relay \
    graphql-fields-list compression helmet reflect-metadata
npm i --save-dev @types/express @types/cors @types/compression @types/node
~~~

> **NOTE.** The exact technology stack here isn't important. You could use Apollo
> Server instead, or any other solution you prefer. We've picked graphql-yoga
> over Express with a hand-selected set of add-ons, but this is in no way
> mandatory.

Now remove `./api/src/Api.ts` (we don't need it). The root `./api/index.ts`
becomes a thin bootstrap that runs the `Application` class, and `./api/src/`
holds the GraphQL application. We keep all the npm scripts from the @imqueue
boilerplate — they work fine for us — but we change what the service does:
instead of a classic service, it now starts an HTTP server (Express) with a
graphql-yoga endpoint that serves GraphQL requests.

We won't walk through that setup in detail — implement it yourself if you're
comfortable, or refer to the
[source code](https://github.com/imqueue-sandbox/api) on GitHub. Take a closer
look at
[`index.ts`](https://github.com/imqueue-sandbox/api/blob/master/index.ts) and
[`src/Application.ts`](https://github.com/imqueue-sandbox/api/blob/master/src/Application.ts).

The heart of the @imqueue integration lives in the `bootstrapContext()` method
of the `Application` class. There we instantiate all the @imqueue/rpc clients
used to orchestrate requests to the underlying services, and start them as part
of the API service's start-up.

The resulting execution context is then handed to the GraphQL layer, which passes
it down to every resolver in the schema — so any resolver can reach our services
whenever it needs to.

~~~typescript
import { clientOptions } from '../config.js';
import { user, auth, car, timeTable } from './clients/index.js';

class Application {
    // ...
    /**
     * Initializes the runtime context for the GraphQL application
     *
     * @return {Promise<any>} - the initialized context
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
    // ...
}
~~~

As we saw in [chapter 3](/tutorial/auth-service#the-service-client), clients are
a core part of @imqueue/rpc — they provide the RPC mechanism for calling remote
services. There we used a dynamically built client; here we'll build client code
statically.

### Building the clients

Generating static client code is a good way to work with @imqueue services,
because it offers several concrete advantages:

- You don't have to worry about service start-up order — you don't need a service
  running to build its client.
- You get pre-built code that your IDE can read, so you can explore each
  service's interface during development, with auto-completion.
- You can version your client code and manage compatibility between versions.

There's one more benefit: with all clients kept in a single place, there's no
duplicated client code to maintain. (In larger systems the same client might be
generated and used at several network locations, which then requires managing
client updates — but our case is simple, so we'll leave that problem aside.)

Generating client code takes a single command per service. Before running it,
make sure the target service is up and running:

~~~bash
imq client generate User ./api/src/clients
imq client generate Auth ./api/src/clients
imq client generate Car ./api/src/clients
imq client generate TimeTable ./api/src/clients
~~~

You may want to wrap these in an npm script so you can regenerate all clients
with a single command, for example:

~~~bash
npm run rebuild-clients
~~~

### Querying the services

Finally, when building the GraphQL schema, we're ready to query our services.
For example, to fetch the list of car brands:

~~~typescript
import {
    GraphQLResolveInfo,
    GraphQLList,
    GraphQLSchema,
    GraphQLObjectType,
    GraphQLString,
} from 'graphql';
import { user, car, timeTable, auth } from '../clients/index.js';

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
                description: 'Fetches the list of car brands',
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
    }),
});
~~~

Because the context is built during the API service's start-up and GraphQL
exposes it to every resolver, we can call remote services and fetch whatever data
we need, right where we need it.

As the example shows, there's very little to do on the client side — just build
and use. All the real implementation lives in one place: the service itself.

This lets you write "normal" code, treating your services as ordinary objects
with methods, and compose complex combinations of service calls imperatively
inside your GraphQL resolvers.

The full API service implementation is available
[here](https://github.com/imqueue-sandbox/api).

Next up: [Deployment](/tutorial/deployment).
