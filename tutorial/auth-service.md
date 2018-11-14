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
<h5>Chapter 3. Auth Service. Inter-Service Communication</h5>
{:#toc}
* TOC
{:toc}

<h5>Next Chapters</h5>
<div markdown="1">
 - [Chapter 4. Other Services](/tutorial/other-services)
 - [Chapter 5. API. Integration](/tutorial/api-service)
 - [Chapter 6. Deployment](/tutorial/deployment)
</div>

<h5>Previous Chapters</h5>
<div markdown="1">
 - [Chapter 1. Introduction](/tutorial/)
 - [Chapter 2. User Service. Creating First Service](/tutorial/user-service)
</div>
</div>

<h2>Chapter 3. Auth Service. Inter-Service Communication</h2>

Create new service named Auth the same way as we did for User service
in a [previous chapter](/user-service#creating-the-service).

Now let's define an interface for Auth service, like this:

~~~typescript
/**
 * Logs user in
 *
 * @param {string} email - user email address
 * @param {string} password - user password hash
 * @return {Promise<string | null>} - issued user auth token or null if auth failed
 * @throws {Error} - "Password mismatch" or "Blocked"
 */
@profile()
@expose()
public async login(email: string, password: string): Promise<string | null> {
    // TODO: implement...
    return null;
}

/**
 * Logs user out
 *
 * @param {string} token - jwt auth user token
 * @param {string} [verifyEmail] - email to verify from a given token (if provided - must match)
 * @return {Promise<boolean>} - operation result
 */
@profile()
@expose()
public async logout(token: string, verifyEmail?: string): Promise<boolean> {
    // TODO: implement...
    return true;
}

/**
 * Verifies if user token is valid, and if so - returns an associated user
 * object
 *
 * @param {string} token
 * @return {Promise<object | null>}
 */
@profile()
@expose()
public async verify(token: string): Promise<object | null> {
    // TODO: implement...
    return null;
}
~~~

So our service will do only 3 main jobs:

- signs users in
- signs users out
- verifies if given auth token is valid or not

What we might need here is to organize communication between Auth and
User services to perform such operations as `login()` and `verify()`,
because for login we need to check if a given user credentials valid,
for verification we would like to return verified user object.

> **NOTICE!**
> We recommend to think twice before you decide to implement
> inter-service communication in a way one service directly communicate
> to another service. If your system will have many services which
> communicate directly to other services you may fall into situation
> when it is very hard to understand data-flow in your system.
> Try to get a clue if there any other, more predictable way to organize
> communication and use direct service calls only when it really matters.
> By the way, @imqueue does not dictate you how to organize your
> services communication, so it is up to you to make architectural
> decision for your system wisely.
> In this example we specially design it in a way to give an ability
> to touch this functionality with your hands and get you insights
> about how it works.

### The Service Client

To call a remote service within RPC pattern you usually need a client.
All @imqueue services are self-describable and there are several ways
to build a client for a remote service.

- **Build client dynamically**. This is the way when client is build-up
  during the program code execution. In this case the remote service
  should be up and running, as far as to build a client @imqueue will
  request remote service for it's interface description and generate
  a client from that description on-the-fly. Such a method is pretty good
  when you want to avoid a need to take care about service interface
  changes, but has several disadvantages, like you are loosing a version
  control over your clients, type checking and IDE auto-complete
  functionality during development process. Yet another one
  disappointment is that you need to follow the correct order of
  service executions as far as you can not build the client when
  service is not running (or not callable).
- **Build client statically**. This way provides an ability to generate
  client code for a remote service using @imqueue/cli command line tool.
  But any time remote service interface changes you will need to
  re-generate clients to match with a new version. Anyway, this method
  is good when you need to detect and version changes in a service and
  gives an ability to TypeScript compiler to perform type-checks in your
  code, as well as enables auto-complete functionality in your IDE
  during development. When you build up your application architecture
  in away that all clients are located at one place - this method would
  be definitely the best choice. Yet another one advantage is that you
  don't need to take care about the order of service launch as your
  clients can be instantiated without a need to call services they
  relate to.
- **Build it manually**. For some particular reason you may need to
  implement your own clients with some extra functionality specific
  to your case. Hence you can write the client code yourself. @imqueue
  provides a base class `IMQClient` which is enough to extends and you
  are ready to go with an implementation. This case is an advanced usage
  of IMQ and is out of this tutorial topic.

So, let's assume we decided to integrate our Auth service with remote
User service using dynamically generated client for User.

That means we want to inject asynchronously in Auth service startup
process and initialize a User client. We did something similar in a
previous chapter when integrating database connection establishment.

Going the same way, override `start()` method of Auth service like this:

~~~typescript
class Auth extends IMQService {
    private user: any; // dynamic client does not give us type checks!

    /**
     * Performs all required async preparations
     * on service initialization
     */
    public async start() {
        this.user = new (await IMQClient.create('User', { write: false })).UserClient();
        await this.user.start();
        return super.start();
    }

    // ... rest of service implementation
}
~~~

Here is an example, how easily we can call a remote service now by
implementing `verify()` method:

~~~typescript
import * as jwt from 'jsonwebtoken';
// ...
/**
 * Verifies if user token is valid, and if so - returns an associated user
 * object
 *
 * @param {string} token
 * @return {Promise<object | null>}
 */
@profile()
@expose()
public async verify(token: string): Promise<object | null> {
    let jwtData: any;

    try {
        jwtData = jwt.verify(token, 'some_secret_seed');
    } catch (err) {
        return null;
    }

    return this.user.fetch(jwtData.email);
}
// ...
~~~


Now you can try to implement all interface methods of Auth service as
your home work, or just take a look at
[its code on GitHub](https://github.com/imqueue-sandbox/auth).

Go to next chapter - [Implementing Other Services](/tutorial/other-services).
