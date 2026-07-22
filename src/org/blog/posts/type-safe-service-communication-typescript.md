---
layout: post.html
permalink: /blog/type-safe-service-communication-typescript/
templateEngineOverride: md
title: "Type-safe service-to-service communication in TypeScript"
summary: "End-to-end types across service boundaries are easy inside one process and hard the moment you cross a network. Here's how to keep them without hand-writing clients or maintaining a schema language."
description: "How to get compile-time-safe communication between TypeScript microservices without hand-written clients or a separate IDL, using self-describing @imqueue services."
keywords: "type-safe microservices, TypeScript RPC, typed service communication, generated clients, imqueue, end-to-end types, self-describing services"
date: 2026-07-15
author: dan-ivanov
illustration: types
topics: [types, rpc, dx]
ogType: article
---

Inside a single TypeScript program, calling a function is safe: if you change its signature, every caller stops compiling until you fix it. That feedback loop is one of the best things about the language. The moment a call crosses a network boundary, that safety usually evaporates — the caller is now talking to a string URL and parsing a JSON blob, and the compiler has no idea what shape to expect.

There are a few common ways teams try to get the safety back. They all work; they all cost something.

## The usual approaches

**Shared type packages.** Publish an `@types/user-service` package and import it in the caller. This gives you types, but nothing guarantees the running service actually matches the published types — they drift, and the drift is invisible until production. You're maintaining the types by hand, twice.

**A schema language / IDL.** Define the contract in Protobuf or similar, generate code for both sides. This is robust and cross-language, but it adds a schema to author and version, a code-generation step to your build, and a second source of truth that has to agree with your implementation.

**OpenAPI generators.** Describe your HTTP API, generate a client. Good for public APIs; for internal calls it's a lot of ceremony, and the generated clients are only as accurate as the hand-written annotations behind them.

Notice the common thread: in each case *you* maintain the contract as a separate artifact from the code that implements it.

## Let the code be the contract

`@imqueue` takes a different stance: the service implementation **is** the contract. You write an ordinary class, document its methods with JSDoc (which you should be doing anyway), and mark the ones you want to expose:

```ts
import { IMQService, expose, classType, property } from '@imqueue/rpc';

@classType()
class User {
    @property('string')
    id: string;

    @property('string')
    name: string;

    @property('string', true)
    email?: string; // optional
}

export class UserService extends IMQService {
    /**
     * Persists a user and returns the saved record
     * @param {User} user - the user to save
     * @return {Promise<User>}
     */
    @expose()
    public async save(user: User): Promise<User> {
        return user;
    }
}
```

From that, the framework builds a description of the service — its methods, their parameter and return types, and any complex types — and **generates a typed client** from the running service:

```ts
const users = new UserServiceClient();
await users.start();
const saved = await users.save({ id: '1', name: 'Ada' }); // fully typed
```

The client isn't a hand-maintained mirror of the service; it's produced from the service itself. Regenerate it after a change and every caller that no longer matches fails to compile — exactly like an in-process function call, but between independently deployed services.

## Two details that matter

**JSDoc carries the types.** `@imqueue/rpc` uses standard TC39 decorators, which deliberately carry no runtime type metadata. So the framework reads types from your JSDoc `@param`/`@return` tags. Keep them accurate — an undocumented parameter falls back to `any` in the generated client. The upside is that your documentation and your wire contract can't drift apart, because they're the same thing.

**Complex types need registration.** Any object type you pass across the boundary must be a class annotated with `@classType()`, with each field marked by `@property()`. That's what lets those types show up, fully formed, in the generated client.

## The payoff

You get end-to-end types across service boundaries with **no separate schema, no published type package to keep in sync, and no client to hand-write** — the three things that usually rot. The trade-off is that this is a Node.js/TypeScript-native approach; it's not trying to be a polyglot IDL. If your services are TypeScript and you want them to feel like typed function calls, that's the whole point.

See [Getting Started](/get-started/) to try it, or the [API reference](/api/) for the full decorator and client-generation surface.
