---
chapter: 3
title: Auth Service
docLabel: TUTORIAL — CHAPTER 3
lead: "Add an Auth service that talks to the User service to log users in and verify them — your first inter-service communication."
description: "Add an @imqueue Auth service that calls the User service to log in and verify users — your first inter-service communication with typed RPC clients."
keywords: "@imqueue inter-service communication, microservice to microservice call, typed RPC client, authentication microservice, JWT service Node.js, service-to-service RPC"
ogType: article
---

Create a new service named `Auth`, the same way we created the User service in
the [previous chapter](/tutorial/user-service#creating-the-service).

Now define the Auth service's interface:

~~~typescript
/**
 * Logs a user in
 *
 * @param {string} email - user e-mail address
 * @param {string} password - user plain-text password
 * @return {Promise<string | null>} - the issued auth token, or null if authentication failed
 * @throws {Error} - "Password mismatch" or "Blocked"
 */
@profile()
@expose()
public async login(email: string, password: string): Promise<string | null> {
    // TODO: implement...
    return null;
}

/**
 * Logs a user out
 *
 * @param {string} token - the user's JWT auth token
 * @param {string} [verifyEmail] - e-mail to verify against the token (if provided, must match)
 * @return {Promise<boolean>} - operation result
 */
@profile()
@expose()
public async logout(token: string, verifyEmail?: string): Promise<boolean> {
    // TODO: implement...
    return true;
}

/**
 * Verifies whether a token is valid and, if so, returns the associated user
 *
 * @param {string} token - the user's auth token
 * @return {Promise<object | null>} - the associated user, or null
 */
@profile()
@expose()
public async verify(token: string): Promise<object | null> {
    // TODO: implement...
    return null;
}
~~~

So the service does three things:

- sign users in
- sign users out
- verify whether a given auth token is valid

To do this, the Auth service needs to talk to the User service: `login()` has to
check the supplied credentials, and `verify()` returns the verified user object.

> **A word of caution.**
> Think twice before letting one service call another directly. In a system
> where many services talk to each other point-to-point, the overall data flow
> can quickly become hard to reason about. Look for a more predictable way to
> organise communication first, and reach for direct calls only when they're
> genuinely warranted. @imqueue doesn't dictate how you structure service
> communication — that architectural decision is yours to make wisely. We use a
> direct call here specifically so you can get hands-on with the feature and see
> how it works.

### The service client

To call a remote service in the RPC pattern, you need a client. Because every
@imqueue service is self-describing, there are three ways to build one:

- **Dynamically, at runtime.** The client is built while your program runs. The
  remote service must be up, because @imqueue asks it for its interface
  description and generates the client on the fly. This is convenient — you don't
  have to track interface changes yourself — but it has trade-offs: you lose
  version control over your clients, along with compile-time type-checking and
  IDE auto-completion during development. You also have to start services in the
  right order, since a client can't be built while its service is unavailable.
- **Statically, ahead of time.** The @imqueue/cli tool generates client source
  code from a running service. You'll need to regenerate whenever the service's
  interface changes, but in return you get type-checking, IDE auto-completion,
  and the ability to detect and version interface changes. Keeping all generated
  clients in one place makes this the best choice for most applications — and you
  no longer need to worry about service start-up order, since clients can be
  instantiated without their services running.
- **Manually.** For special cases you can write client code yourself, adding
  whatever custom behaviour you need. @imqueue provides the `IMQClient` base
  class to extend. This is advanced usage and outside the scope of this tutorial.

For this chapter, let's integrate the Auth service with the User service using a
**dynamically generated** client for User.

That means we'll initialise a User client asynchronously during the Auth
service's start-up — much as we established the database connection in the
previous chapter. Override the Auth service's `start()` method:

~~~typescript
class Auth extends IMQService {
    private user: any; // a dynamic client gives us no compile-time types!

    /**
     * Performs the required async preparations on service initialization
     */
    public async start() {
        this.user = new (await IMQClient.create('User', { write: false })).UserClient();
        await this.user.start();
        return super.start();
    }

    // ... rest of the service implementation
}
~~~

> **NOTE.** We use a **dynamic** client here to demonstrate building one at
> runtime. The finished Auth service in the sandbox actually ships a
> **statically generated** client for the User service (committed at
> `src/clients/User.ts`) — the approach we cover in
> [chapter 5](/tutorial/api-service#building-the-clients). Both are valid; the
> static one is the better default for real applications.

With the client in place, calling the remote service is straightforward. Here's
how `verify()` might look:

~~~typescript
import jwt from 'jsonwebtoken';

// the signing secret comes from the environment — never hard-code it:
const JWT_KEY = process.env['JWT_KEY'] || '';
// ...
/**
 * Verifies whether a token is valid and, if so, returns the associated user
 *
 * @param {string} token - the user's auth token
 * @return {Promise<object | null>} - the associated user, or null
 */
@profile()
@expose()
public async verify(token: string): Promise<object | null> {
    let jwtData: any;

    try {
        jwtData = jwt.verify(token, JWT_KEY);
    } catch (err) {
        return null;
    }

    return this.user.fetch(jwtData.email);
}
// ...
~~~

Try implementing the rest of the Auth service's methods as homework, or take a
look at [its source code on GitHub](https://github.com/imqueue-sandbox/auth).

Next up: [Domain Services](/tutorial/other-services).
