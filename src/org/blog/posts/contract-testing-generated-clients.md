---
layout: post.html
permalink: /blog/contract-testing-generated-clients/
templateEngineOverride: md
title: "The contract your services already publish: contract testing for Node.js microservices"
summary: "Contract testing exists because two services can agree on a shape today and disagree on it next Thursday, with nothing in either repository to notice. If your clients are generated, most of that machinery is already built for you — and the part that is left is not the part the tooling advertises. Here is what an @imqueue service publishes about itself, how to pin it in a test that needs no broker, and the one place the contract can quietly disagree with your TypeScript."
description: "Contract testing for Node.js microservices when the client is generated from the service. What an @imqueue service publishes through describe(), how to snapshot that contract in a unit test with no Redis and no running service, why the description is built from JSDoc rather than TypeScript types, and what contract testing still has to cover afterwards."
keywords: "contract testing, consumer driven contracts nodejs, contract testing without pact, pact alternative generated clients, generated client contract, service description snapshot, contract drift typescript, imqueue describe, rpc contract verification, jsdoc runtime types"
date: 2026-09-04
author: serhiy-morenko
illustration: service-contract
topics: [testing, types, clients, dx]
ogType: article
---

The change was three characters long. A question mark, and the two keystrokes of
confidence it takes to add one.

```typescript
public async balance(id: string, currency?: string): Promise<number>
```

Most callers only ever wanted the default currency, so making the argument
optional was tidying, not design. It compiled. The tests passed. It went out on a
Tuesday and nothing happened, which is what you want from tidying.

Eleven days later somebody regenerated the billing client for an unrelated
change, and four repositories stopped building at once.

```
error TS2554: Expected 2 arguments, but got 1.
```

Nobody had touched `balance` in those eleven days. The signature everyone was
calling had never been the signature you wrote — and the gap had been sitting
there, silent and compiling, since the Tuesday.

That is a contract drift bug. It is exactly the family of bug contract testing
was invented for. And the interesting part, the part that took me a while to
accept, is that the usual contract-testing apparatus would not have caught this
one either.

> **The short version.** Every `@imqueue` service publishes a machine-readable
> description of itself — method names, argument names and types, return types,
> and every complex type it can put on the wire. You can get it with a method
> call, and you can get it **with no broker and no Redis running**, which makes a
> contract snapshot a plain unit test. The catch, and the reason to write that
> test at all: the description is parsed from your **JSDoc**, not from your
> TypeScript. Where the two disagree, the JSDoc wins, silently, and your callers
> inherit the disagreement.

> Everything below was run on Node 24.15.0 with `@imqueue/rpc` 3.9.0,
> `@imqueue/core` 3.5.0, TypeScript 5.9.3 and Redis 8.0.5. The description dumps
> and the generated client are real output, not illustrations of it.

## What contract testing is for, and what it costs

Strip away the tooling and consumer-driven contract testing is one idea: the
consumer writes down what it needs, the provider proves it still supplies it,
and both halves live somewhere a build can check them.

The reason it exists is that integration tests are the wrong instrument for the
job. Booting both services proves they agree *right now*, in *this* pairing, on
*this* branch — and it costs you a fleet, a broker and several minutes to learn
it. Contract testing trades that for two cheap tests either side of a written-down
agreement.

What it costs is the writing-down. Somebody maintains the expectations. Somebody
runs a broker to hold them. And the agreement is a second artifact that can rot
against the implementation it describes, which is a familiar shape — it is the
same failure mode as the hand-written client SDK, wearing a different hat.

That is the cost worth checking before you pay it, because a self-describing
service has already paid part of it.

## Your service already publishes a contract

An `@imqueue` service can be asked what it looks like. The method is
[`describe()`](/api/rpc/latest/rpc.imqservice.describe/), and what comes back is
a [`Description`](/api/rpc/latest/rpc.description/): the service's name, every
exposed method with the inheritance chain already flattened, and every complex
type registered in the process.

Here is a small service, written the way the framework wants — `@expose()` on
what is callable, JSDoc carrying the types, `@classType()` and `@property()` on
anything complex enough to cross the wire:

```typescript
@classType()
export class Address {
    @property('string')
    country: string;

    @property('string', true)
    zip?: string;
}

export class BillingService extends IMQService {
    /**
     * Returns the invoice total for a customer.
     *
     * @param {string} customerId - the customer to bill
     * @param {boolean} [includeDrafts] - whether drafts count
     * @returns {Promise<number>}
     */
    @expose()
    public async invoiceTotal(
        customerId: string,
        includeDrafts?: boolean,
    ): Promise<number> {
        // ...
    }
}
```

And here is what it says about itself:

```json
{
  "service": {
    "name": "BillingService",
    "methods": {
      "invoiceTotal": {
        "description": "Returns the invoice total for a customer.",
        "arguments": [
          { "name": "customerId",    "tsType": "string",  "isOptional": false },
          { "name": "includeDrafts", "tsType": "boolean", "isOptional": true  }
        ],
        "returns": { "tsType": "Promise<number>" }
      }
    }
  },
  "types": {
    "Address": {
      "properties": {
        "country": { "type": "string", "isOptional": false },
        "zip":     { "type": "string", "isOptional": true  }
      },
      "inherits": ""
    }
  }
}
```

That is a contract. Not a contract-shaped thing you maintain beside the code — a
contract *derived from* the code, by the same machinery that generates every
client. There is no version of it that is stale, because there is no second copy.

Two details in the reference are worth knowing before you build on it.
`Description` is [declared as a class but never
instantiated](/api/rpc/latest/rpc.description/) — a service returns a plain
object literal and a client receives its JSON round-trip, so `instanceof` will
always disappoint you. And `describe()` is *itself* an exposed method, so it
shows up in its own method list, and a remote caller gets a `Promise<Description>`
where a local call gets the object directly.

## The contract is built from your JSDoc, not from your types

This is the part I would put on a poster.

The description is parsed out of JSDoc comments. Your TypeScript annotations are
not consulted. The reference says so in the small print of
[`ArgDescription.isOptional`](/api/rpc/latest/rpc.argdescription.isoptional/) —
optionality comes from writing `[name]` in the JSDoc, and *"a TypeScript `?` or a
default value alone does not set this"* — and again on
[`PropertyDescription.isOptional`](/api/rpc/latest/rpc.propertydescription.isoptional/),
which is *"never inferred from a TypeScript `?` modifier"*.

Read as documentation that is a footnote. Watch it happen and it is something
else. Take the method from the opening — TypeScript-optional, JSDoc silent about
it:

```typescript
/**
 * @param {string} id - customer
 * @param {string} currency - currency
 * @returns {Promise<number>}
 */
@expose()
public async balance(id: string, currency?: string): Promise<number> {
```

The published contract:

```
balance: id:string, currency:string  ->  Promise<number>
```

`currency` is **required**. And here is the line the generator writes into the
client that every caller imports:

```typescript
public async balance(
    id: string,
    currency: string,          // <- the ? is gone
    imqMetadata?: IMQMetadata,
    imqDelay?: IMQDelay,
): Promise<number> {
```

Nothing warned anybody. The service happily accepts the call without `currency`,
because at runtime the framework counts arguments rather than checking them. The
service and its own generated client now disagree about the method's arity, and
the disagreement only becomes visible on the day someone regenerates — which is
why it surfaced eleven days late and four repositories wide.

The same trap is set on complex types. `zip?: string` decorated with
`@property('string')` and no second argument publishes as required, and the
generated interface duly says `zip: string`.

There is a smaller, meaner version of this. The brackets that mark an argument
optional go around the **name**, not the type. Write them around the type by
mistake:

```typescript
@param {[boolean]} includeDrafts - whether drafts count
```

and nothing fails. The argument is published with `tsType` set to the literal
string `"[boolean]"`, `isOptional` still `false`, and a client generated from it
emits `[boolean]` into the signature as though that were a type. A typo in a
comment became a type in four repositories.

None of this is catchable by the compiler. The compiler was never looking at the
comment.

## A contract test that needs no broker

Here is the payoff, and it is smaller than you would expect.

`describe()` is synchronous, and it does not touch the transport. You can
construct the service and ask it what it looks like with nothing else running —
no Redis, no `start()`, no fleet:

```typescript
import { BillingService } from '../src/BillingService.js';

test('the published contract has not changed', () => {
    const svc = new BillingService({ logger: silent });

    assert.snapshot(svc.describe());   // your snapshot tool of choice
});
```

That test runs in milliseconds, in the same suite as everything else, and it
fails the moment any of the following happens without you meaning it:

- a method stops being exposed, or starts being exposed
- an argument is renamed, reordered, added or removed
- a documented type changes
- an argument's optionality changes — *including* the JSDoc-versus-TypeScript
  disagreement above, which is the whole point
- a complex type gains, loses or renames a property

It is a snapshot test, so it will also fail when you change something on purpose.
That is not a defect, that is the feature: the diff in the pull request is the
contract change, stated in full, in the review where somebody can object to it.

### The failure mode this catches that nothing else does

There is one `tsconfig.json` flag that deletes your entire contract.

`@imqueue` reads types out of JSDoc, which means the comments have to survive
compilation. Set `removeComments: true` — a reasonable-looking production
optimisation, and one somebody adds while tuning a build — and this is what the
service publishes:

```
invoiceTotal: customerId:any, includeDrafts:any  ->  any
balance:      id:any, currency:any               ->  any
```

Every argument. Every return value. The service still starts. It still answers.
Every client generated from it is typed `any` end to end, and every call site
that was protected by those types silently is not any more.

The site's FAQ covers
[why `removeComments` must be `false`](/api/faq/#why-must-removecomments-be-false-in-a-project-that-uses-imqueue),
so the rule is written down. A snapshot of the description is the thing that
*enforces* it, in the build, on the day the flag lands rather than the week the
bug reports start.

## The other half already lives in git

The generated client is not a build artifact. It is
[a file you commit](/cli/clients-and-versioning/):

```bash
imq client generate BillingService ./src/clients -o
```

The CLI guide is blunt about why, and it is worth quoting the reasoning rather
than paraphrasing it: the committed client *is* the checked-in contract, so
changing a method signature and regenerating makes the change appear as **a diff
in the pull request that causes it**. The reviewer reads the contract change
instead of inferring it.

That covers a surprising amount of what a contract broker is for. The provider's
published interface is versioned, reviewable, and attached to the change that
caused it. There is no separate schema to keep in step, because the schema is
generated from the implementation.

One thing to get right: the name is the **queue** name, which `IMQService`
defaults to its own class name. It is `BillingService`, not `billing`, and not
the project directory you pass to `imq ctl -s`. Get it wrong and generation sits
there waiting for a queue nobody is listening on until it times out.

And resist the urge to generate in CI. It needs a running service and a broker to
introspect, so you would be booting the world on every build to produce a file
that was deterministic anyway. Regenerate locally as part of the change that
alters the interface, and commit it alongside.

## So what is actually left to test?

If the provider's contract is generated, snapshotted and reviewed, and the
consumer's copy of it is committed and type-checked, what has contract testing
still got to do?

Two things. They are the two the tooling talks about least.

**The consumer's half of the agreement.** The provider's description says what
exists. It says nothing about who is using what. A method you believe is dead may
have one caller left in a repository you have not opened this quarter; the
description will let you delete it without a murmur. This is the genuinely
consumer-driven part, and generated clients do not give it to you — knowing your
callers still does, whether that is a registry, a grep across repositories, or
the honest version where you ask.

**Behaviour.** This is the big one, and it is where I would spend the effort.

A description pins *shape*. It has nothing to say about meaning. Change
`invoiceTotal` to return cents instead of dollars and the contract is unmoved:
still `Promise<number>`, still one required `customerId`, still a clean snapshot,
still a clean regenerate, still a clean review. Every caller keeps compiling and
every invoice is off by two orders of magnitude.

Start returning `null` instead of `0` for an unknown customer. Same story.
Tighten a validation rule so an input that used to be accepted now throws — the
shape is identical and the caller is broken.

These are the failures worth a real test, and they are ordinary tests: call the
method, assert what it *means*. Which is the good news, because that is
[layer one of the testing approach](/blog/testing-microservices-without-the-whole-stack/)
you were already going to write — a service is an ordinary class, and its exposed
methods are ordinary methods.

The reframing I would offer is this. Contract testing, in a generated-client
world, is not a tool you install. It is two habits: **snapshot the shape**,
because it is nearly free and it catches the silent drift; and **assert the
meaning**, because nothing else will.

## Two traps in the description itself

Before you build a suite on this, two behaviours that will otherwise cost you an
afternoon.

**The description is cached process-wide.** It is
[built once per service name and cached for the lifetime of the
process](/api/rpc/latest/rpc.imqservice.describe/). Methods attached after the
first call are not reflected. In a test suite that constructs several services in
one process this matters, and it has a sharp edge: the cache key is the service
`name`, while the method list is resolved from the concrete class name. Construct
two differently-classed services under the same `name` in one process and they
share a single description — the second one gets the first one's contract.

**`describe` is in its own output.** It is exposed like any other method, so it
appears in the method list of every service. Filter it out of your snapshot or
accept it as a constant; either is fine, as long as you are not surprised by it
the first time.

## Where this leaves the layers

The layered approach still holds, and this slots into it cleanly:

- **Logic** — unit-test the service class directly. No infrastructure.
- **Shape** — snapshot `describe()`. No infrastructure either, which is the part
  worth noticing.
- **Meaning** — ordinary assertions on exposed methods, at the same layer as the
  logic tests.
- **Wire and delivery** — a minimal integration slice with a real broker, kept
  small and deliberate.

The honeycomb-versus-pyramid argument is mostly an argument about where the
middle layer goes. Generated clients answer it by making the shape layer so cheap
that it stops being a layer at all — it is one assertion in the suite you already
have, and the ceremony that usually surrounds it is machinery for recovering
something your services were publishing all along.

## FAQ

### What is contract testing in microservices?

Contract testing checks that two services still agree on the interface between
them without running both at once. The consumer records what it needs, the
provider proves it still offers it, and each side verifies against the recorded
agreement in its own build. It exists because end-to-end integration tests are a
slow and flaky way to learn that a signature changed.

### Do I need Pact if my clients are generated from the service?

Usually not for the shape half. A generated client is produced from the
provider's own description, and it is committed to the repository, so the
interface is already versioned and reviewable — a signature change shows up as a
diff in the pull request that caused it. What a generated client does not give
you is knowledge of which consumers use which methods, or any check on behaviour.
Decide based on which of those you actually lack.

### How do I write a contract test for an @imqueue service?

Construct the service and snapshot
[`describe()`](/api/rpc/latest/rpc.imqservice.describe/). It is synchronous and
needs no broker, no Redis and no `start()`, so it belongs in your ordinary unit
suite. The snapshot fails on any change to exposed methods, argument names,
types, optionality or registered complex types — and passing it means reviewing
the diff, which is where a contract change ought to be discussed.

### Why does my generated client require an argument my service marked optional?

Because the contract is parsed from JSDoc, not from TypeScript. An argument is
optional only if the JSDoc writes brackets around its **name** — `@param {string}
[currency]`. A TypeScript `?` or a default value
[does not set it](/api/rpc/latest/rpc.argdescription.isoptional/). The same rule
applies to complex types, where optionality comes from the second argument to
[`@property()`](/api/rpc/latest/rpc.property/) and is never inferred from `?`.

### Why did every type in my generated client become `any`?

Almost certainly `removeComments: true` in your TypeScript configuration. JSDoc
is the runtime type source, so stripping comments strips the contract: every
argument and every return value publishes as `any`, the service keeps running,
and nothing fails. See
[why removeComments must be false](/api/faq/#why-must-removecomments-be-false-in-a-project-that-uses-imqueue).

### Should I generate clients in CI instead of committing them?

No. Generation introspects a running service, so CI would have to start the
service and a broker on every build to produce a file that is deterministic
anyway. Committing it is cheaper and keeps the property that matters — the diff.
Regenerate locally with `imq client generate <QueueName> <path> -o` as part of
the change that alters the interface.

### What does contract testing not catch?

Meaning. A description pins the shape of a call, not what the values mean. A
method that starts returning cents instead of dollars, or `null` instead of a
zero, or that tightens a validation rule, keeps exactly the same contract while
breaking every caller. Those need ordinary behavioural assertions on the exposed
method.

### How do I test a service without running the whole stack?

Push each test to the cheapest layer that can catch its bug: unit-test the
service class for logic, snapshot `describe()` for shape, assert on exposed
methods for meaning, and keep a small deliberate integration slice for delivery
and serialisation. The
[layered approach](/blog/testing-microservices-without-the-whole-stack/) covers
the pattern in full.

## Reference

[`IMQService.describe()`](/api/rpc/latest/rpc.imqservice.describe/) ·
[`Description`](/api/rpc/latest/rpc.description/) ·
[`MethodDescription`](/api/rpc/latest/rpc.methoddescription/) ·
[`ArgDescription`](/api/rpc/latest/rpc.argdescription/) ·
[`PropertyDescription`](/api/rpc/latest/rpc.propertydescription/) ·
[`IMQClient.describe()`](/api/rpc/latest/rpc.imqclient.describe/) ·
[`imq client generate`](/cli/clients-and-versioning/) ·
[FAQ: why must removeComments be false?](/api/faq/#why-must-removecomments-be-false-in-a-project-that-uses-imqueue) ·
[FAQ: how do I generate a typed client for a running service?](/api/faq/#how-do-i-generate-a-typed-client-for-a-running-service)
