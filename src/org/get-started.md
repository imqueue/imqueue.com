---
layout: docs.html
section: docs
title: "Get started: Node.js microservices in minutes"
docLabel: GET STARTED
lead: "The shortest path from an empty terminal to a running @imqueue service and a generated client. For a deeper, worked example see the Tutorial; the full technical reference lives in the API docs."
description: "Install @imqueue and ship your first Node & TypeScript service in minutes — the shortest quickstart for building message-queue RPC microservices."
keywords: "@imqueue getting started, imqueue quickstart, install imqueue, first Node.js service, TypeScript microservice tutorial, npm @imqueue/cli, message queue RPC setup"
relatedTopics: [rpc, architecture, dx, clients]
---

[[toc]]

## Prerequisites

Before you begin, make sure the following are installed and available on your
system:

- [Node.js](https://nodejs.org/en/) **22.12 or newer** — we recommend
  installing it through [NVM](https://github.com/nvm-sh/nvm#installing-and-updating).
- [Redis](https://redis.io/download) — version 3.2 or newer. @imqueue uses
  Redis as its message-queue transport.
- [Git](https://git-scm.com/downloads) — the command-line client.

## 1. Install the CLI

Install the @imqueue command-line tool globally. It scaffolds services and
generates clients for you, so you write features instead of boilerplate:

~~~bash
npm i -g @imqueue/cli
~~~

On first run the installer offers to collect some initial configuration. You can
fill it in now, or press `Ctrl+C` to skip and configure it later (or not at all
— it is optional).

## 2. Configure (optional)

`@imqueue/cli` works without any configuration. Defining a global configuration
once is only worthwhile on larger projects with many services, where it saves
you from repeating the same options on every command.

To create or re-create the configuration at any time, run:

~~~bash
imq config init
~~~

For the full setup details — requirements, upgrading and shell completions — see
the [Installation](/cli/installation/) & [Configuration](/cli/configuration/)
chapters of the CLI User Guide.

## 3. Enable shell completions

Turning on completions for the `imq` command makes the CLI far more pleasant to
use. Run:

~~~bash
imq completions on
~~~

and follow the prompts. `bash` and `zsh` are supported.

## 4. Everyday usage

The CLI exists to remove the boilerplate of building `@imqueue`-based back-end
services. It does two main jobs for you:

1. Scaffold services from ready-made templates.
2. Generate client code for calling those services.

### 4.1 Create a service

Scaffold a new service into a fresh directory:

~~~bash
mkdir user-service
cd user-service
imq service create
~~~

Then open `src/UserService.ts` and implement the methods your service needs to
expose. A complete, working service looks like this:

~~~typescript
// src/UserService.ts
import { IMQService, expose, profile } from '@imqueue/rpc';
import { UserObject } from './types/UserObject.js';

export class UserService extends IMQService {
    private users: UserObject[] = [
        Object.assign(new UserObject(), {
            id: '42',
            email: 'jane@example.com',
            firstName: 'Jane',
            lastName: 'Doe',
            isActive: true,
        }),
    ];

    /**
     * Returns a user by identifier, or null when there is no such user
     *
     * @param {string} id - user identifier
     * @return {Promise<UserObject | null>} - the matching user
     */
    @profile()
    @expose()
    public async get(id: string): Promise<UserObject | null> {
        return this.users.find(user => user.id === id) || null;
    }

    /**
     * Returns how many users are active
     *
     * @return {Promise<number>} - the number of active users
     */
    @profile()
    @expose()
    public async countActive(): Promise<number> {
        return this.users.filter(user => user.isActive).length;
    }
}
~~~

Three things in there are the whole contract, and getting any of them wrong is
the usual reason a generated client comes out empty:

- **`extends IMQService`** — that is what makes the class a service and gives it
  `start()`, `destroy()` and `this.logger`.
- **`@expose()`** on every method that should be callable remotely. A method
  without it is a normal method and stays private to the service.
- **A doc-block on each exposed method.** The client generator reads it, so the
  parameter and return descriptions above become the documentation your callers
  see in their IDE.

`@profile()` is optional and independent — it measures and logs execution time
for the method it decorates. Reach for it on the parts of the system you most
want to keep an eye on.

Every value crossing the queue is JSON, so **a complex type must be declared as a
class** with `@classType()` on the class and `@property()` on each exposed field.
That is what lets both the service and the generated client agree on its shape:

~~~typescript
// src/types/UserObject.ts
import { classType, property } from '@imqueue/rpc';

/**
 * Serializable user type
 */
@classType()
export class UserObject {
    @property('string')
    id: string;

    @property('string')
    email: string;

    @property('string')
    firstName: string;

    @property('string')
    lastName: string;

    @property('boolean')
    isActive: boolean;

    // Optional — pass true as the second argument
    @property('string', true)
    nickname?: string;
}
~~~

`@property()`'s first argument is the type in TypeScript notation, and it may
name another complex type (`'UserCarObject'`) or an array of one
(`'UserCarObject[]'`). Types declared this way arrive on the client side as
TypeScript interfaces. Returning a plain object literal instead works at runtime
but describes nothing, so the generated client types the field as `any`.

### 4.2 Run the service

Make sure a Redis server is running on the default port, then start the service
in watch mode:

~~~bash
npm run dev
~~~

### 4.3 Generate a client

Every @imqueue service is self-describing, so a fully typed client can be
generated directly from a running service:

~~~mermaid
flowchart LR
    A["UserService.ts with @expose() + JSDoc"] -->|"npm run dev"| B["running service on queue UserService"]
    B -->|"describes itself over the queue"| C["imq client generate UserService ./src/clients"]
    C --> D["src/clients/UserService.ts exporting UserClient"]
    D -->|"tsc"| E["caller: await client.get('42'), fully typed"]
~~~

The JSDoc-annotated `@expose()`d methods are @imqueue's only contract, so there is
no schema file to keep in step — but generation does need the service *running*.

Leave `npm run dev` running in the first terminal, and in a second one:

~~~bash
imq client generate UserService ./src/clients
~~~

The service must be **up**, with Redis reachable — generation works by asking the
running service to describe itself, so there is no schema file and no IDL to keep
in sync. It writes `src/clients/UserService.ts` (and its compiled `.js`),
exporting a client class named after the service with a trailing `Service`
replaced by `Client` — so `UserService` gives you `UserClient`.

Now call it. This is a complete, runnable consumer:

~~~typescript
// consumer.ts — in the service root, next to package.json
import { UserClient } from './src/clients/UserService.js';

const client = new UserClient();

await client.start();

try {
    // Fully typed: `user` is UserObject | null, and `user.firstName` completes
    // in the IDE. No hand-written client, no service discovery, no HTTP.
    const user = await client.get('42');

    console.log(user?.firstName, await client.countActive());
} finally {
    // Closes the client's Redis channels. Without it the process will not exit.
    await client.destroy();
}
~~~

`npm run dev` runs the service's own entry point, not this file, so compile and
run it directly — the same way the Tutorial runs its `debug.ts`:

~~~bash
npm run build && node consumer.js
~~~

~~~
Jane 1
~~~

Two things worth knowing before you scale this up:

- **The queue name is the address.** Start a second copy of `UserService` and the
  two instances compete for messages on the same queue, so calls are shared
  between them. That is why there is no service registry and no internal load
  balancer to run — see
  [service discovery](/blog/do-nodejs-backends-need-service-discovery/) and
  [load balancing](/blog/load-balancing-microservices-without-a-load-balancer/).
- **Regenerate the client when the service's interface changes.** The generated
  file is a build artefact, not something to edit; `-o` overwrites it without
  prompting. See
  [Clients & versioning](/cli/clients-and-versioning/).

<div class="callout">
  <p><strong>That's it — you've built and called your first @imqueue service.</strong></p>
  <p><strong>Ready for more?</strong> Work through the <a href="/tutorial/">Tutorial</a> for a complete example application, or dive into the <a href="/api/">API reference</a>.</p>
</div>
