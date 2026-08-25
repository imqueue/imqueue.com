---
layout: post.html
permalink: /blog/runtime-validation-typescript-services/
templateEngineOverride: md
title: "Typed at compile time, unchecked on the wire: runtime validation for TypeScript services"
summary: "Your service method has a signature. The message that arrives has none — it is JSON, and JSON does not remember what it was supposed to be. This is the story of the bug that leaves no stack trace, why your compiler was never in a position to catch it, and how to put a real check at the boundary without slowing anything down."
description: "TypeScript types vanish at the service boundary. What an @imqueue RPC service actually checks before your method runs (the argument count, and nothing else), where wrong-shaped input really comes from, and how to enforce the shape at runtime with @imqueue/validation's Zod-backed decorators — including the four behaviours that catch people out."
keywords: "typescript runtime validation, validate rpc arguments nodejs, zod decorators typescript, runtime type checking typescript services, imqueue validation, validated decorator zod, typescript types erased at runtime, validate service method input, zod object extra properties, tc39 decorators validation"
date: 2026-08-25
author: serhiy-morenko
illustration: runtime-validation
topics: [types, rpc, dx]
ogType: article
---

You get the ticket on a Tuesday. *Some accounts have a blank email address.* Not
many. Not all. No pattern anyone can see.

So you go looking, and this is the part that eats the afternoon: there is nothing
to find. No error. No stack trace. No retry that gave up. The service ran, it
returned normally, and it wrote a row. Everything downstream behaved. The only
evidence that anything went wrong is the row itself.

Eventually you get there, and the answer is disappointing in the way these always are.
The method's signature says it takes a `Credentials` object. What arrived was a
string. It ran anyway.

The uncomfortable bit is that nobody wrote a bug. Your service is correct. The
framework is correct. The caller compiled cleanly. The gap is in the seam between
them — and it is a seam almost everyone assumes is sealed, because
[typed service-to-service communication](/blog/type-safe-service-communication-typescript/)
is supposed to give you compile-time safety across the network.

It does. It just gives it to one side of the call.

> **The short version.** Before your exposed method runs, `@imqueue/rpc` checks
> that the **number** of arguments matches what the method advertises. That is
> the whole runtime check. A string, a number or `null` will all happily land in
> a parameter typed as a class.
> [`@imqueue/validation`](/api/validation/latest/) closes that gap with Zod
> schemas written as decorators on the input class. It is a five-minute change
> and it costs 87 nanoseconds a call — but four of its behaviours will surprise
> you, and one of them fails in a *different file* than the one you got wrong.
> Those four are most of this article.

> Want to reproduce any of it? Everything below was run on Node 24.15.0 against
> Redis 8.0.5, with `@imqueue/core` 3.4.2, `@imqueue/rpc` 3.7.2,
> `@imqueue/validation` 1.1.1 and `zod` 4.4.3. The caller is a bare
> `@imqueue/core` queue writing request packets by hand — which is the whole
> point of the exercise. It is a caller your compiler has never met.

## Your compiler guards one end of the call, and only one end

Here is a service that looks like every service. `Credentials` is registered for
the wire with `@classType()` and `@property()`, the way a complex argument has to
be, and `signIn` is exposed with the JSDoc that carries its types:

~~~typescript
@classType()
class Credentials {
    @property('string')
    email!: string;

    @property('string')
    password!: string;
}

export class AuthService extends IMQService {
    /**
     * Signs a user in
     *
     * @param {Credentials} creds - the credentials to check
     * @return {Promise<string>}
     */
    @expose()
    public async signIn(creds: Credentials): Promise<string> {
        // what is `creds`, really?
    }
}
~~~

That question in the comment turns out to have an interesting answer. Call the
method from a process the compiler never saw, always with one argument, and just
vary what that argument is:

| the caller sends… | …and your method receives |
|---|---|
| `{ email, password }` | an object with both keys — as intended |
| `'ada@example.com'` | a **string**, 15 characters long |
| `42` | a **number** |
| `null` | `null` |
| `{ email, password, isAdmin: true }` | an object with **three** keys |
| *nothing at all* | `IMQ_RPC_INVALID_ARGS_COUNT` |
| *two arguments* | `IMQ_RPC_INVALID_ARGS_COUNT` |

Five of those seven ran your method body. And look closely at the two that
didn't: they were not rejected for being the wrong *type*. They were rejected for
being the wrong *number*. `@imqueue/rpc` counts the arguments against the
method's exposed description and refuses a mismatch with
[`IMQ_RPC_INVALID_ARGS_COUNT`](/api/rpc/latest/rpc.imqrpcerror.code/) before
dispatch — and that is the last check anything performs.

The `@classType()` and `@property()` decorators you dutifully wrote are not a
runtime schema, either. Their job is to make the type appear in the *generated
client*, on the calling side. They protect the caller from sending nonsense.
They do not protect you from receiving it.

~~~mermaid
sequenceDiagram
    participant C as Caller
    participant S as Service
    participant M as Method body
    C->>S: { method, args: [ ... ] }
    alt args.length mismatches the exposed description
        S--xC: IMQ_RPC_INVALID_ARGS_COUNT
    else the count matches
        Note over S: no type check — the annotations were erased
        S->>M: apply(args)
        Note over M: runs on whatever arrived
    end
~~~

An `@imqueue` service dispatches on the argument *count* in the exposed
description, and the TypeScript annotation that would have told it more was
erased at compile time — so arity really is the only gate between the wire and
your method body.

None of this is a design mistake. A transport that re-derived every argument's
type on every call would bill you for it on every call, forever, including the
99.9% of calls where the caller was perfectly well behaved. The framework makes
the fast choice and leaves the decision to you. It just helps to know the
decision exists.

## The bad payload almost never comes from an attacker

This is where people's intuition goes wrong, and it makes them dismiss the whole
problem. Your service queue lives inside your own network. If somebody hostile is
already writing to it, argument shapes are not your biggest concern today.

The realistic causes are all much more boring, which is exactly why they are
expensive:

**A stale generated client.** Clients are generated from a running service and
then live in the caller's repo, quietly, for weeks. Somebody changes the service.
The caller doesn't regenerate — or regenerates a day later, or forgets which of
eleven repos still holds a copy. That window is what
[versioning discipline](/blog/versioning-microservices-without-breaking-callers/)
exists to manage, and validation is what turns a mismatch *inside* that window
from a haunting into an error message.

**A parameter you forgot to document.** `@imqueue/rpc` reads types from JSDoc,
because standard TC39 decorators deliberately carry no runtime type metadata.
Miss a `@param` and it is published as `any` — so the generated client compiles
beautifully while forwarding whatever the caller happened to be holding.

**A JSON round trip somewhere upstream.** The value came out of an HTTP body, a
webhook, a `jsonb` column, another queue. Somebody assigned a `JSON.parse()`
result to a typed variable, TypeScript took them at their word, and the lie
travelled.

**A caller that was never TypeScript**, or one an agent wrote against your docs
instead of against your client.

Notice what all four have in common. In every single one, the compiler was
satisfied. That is the thing worth internalising about compile-time safety: **it
cannot warn you when it is wrong, because by the time it is wrong it has already
stopped being involved.**

## Put the rules where the shape already lives

[`@imqueue/validation`](/api/validation/latest/) doesn't ask you to maintain a
schema off to the side, where it can drift. The rules go on the input class,
right next to the `@property()` decorators that are already there:

~~~typescript
import { z } from 'zod';
import { validatable, validate, validated } from '@imqueue/validation';
import { classType, expose, IMQService, property } from '@imqueue/rpc';

@classType()
@validatable()
class Credentials {
    @property('string')
    @validate(z.string().email())
    email!: string;

    @property('string')
    @validate(z.string().min(8))
    password!: string;
}

export class AuthService extends IMQService {
    /**
     * Signs a user in
     *
     * @param {Credentials} creds - the credentials to check
     * @return {Promise<string>}
     */
    @expose()
    @validated(Credentials)
    public async signIn(creds: Credentials): Promise<string> {
        // creds is known-good here
    }
}
~~~

Three decorators, one job each.
[`@validate()`](/api/validation/latest/validation.validate/) attaches a Zod schema
to one field. [`@validatable()`](/api/validation/latest/validation.validatable/)
seals that class's fields into a registry.
[`@validated()`](/api/validation/latest/validation.validated/) takes one
validator per argument and runs them before your method body gets a turn. Whether
you put `@expose()` above or below `@validated()` makes no difference — I checked
both ways, both reject.

Run those same seven calls again and the string, the number and the `null` are
all turned away, along with a perfectly well-formed object whose `email` is not
actually an email address. Zod is the package's only runtime dependency, so
anything Zod can express is available to you — including using another
`@validatable()` class as the validator for a nested object, which
[`schemaOf()`](/api/validation/latest/validation.schemaof/) resolves for you.

That is the good news, and it is most of the value. Now the four things that will
bite you, roughly in the order they tend to.

## Forget `@validatable()` and a completely different file starts failing

Take this one seriously, because the symptom shows up somewhere you have no
reason to look.

Ideally a class's field validators would hang off `Symbol.metadata`, the way TC39
decorators intend. In practice esbuild and tsx do not populate it reliably, so
field decorators write into a shared module-level buffer and the class decorator
claims what's in it. That works because field decorators always run before their
own class decorator, and class bodies evaluate in order.

It also means **nothing empties the buffer when a class body simply ends.**

So write this — and it is an easy thing to write, because the missing decorator
looks like nothing is missing:

~~~typescript
// Forgot @validatable()
class Address {
    @validate(z.string().min(2))
    city!: string;
}

// The next class that does seal
@validatable()
class Credentials {
    @validate(z.string().email())
    email!: string;
}
~~~

`Address` now validates nothing whatsoever. Its `city` rule was left in the
buffer, and `Credentials` — a class you wrote correctly, that has never heard of
an address — picks it up on the way past:

~~~
schemaOf(Address)      -> null
Credentials fields     -> [ 'city', 'email' ]
parse({ email: 'ada@example.com' })
                       -> rejected: city: invalid_type
~~~

Read that last line as the bug report you are going to receive. *Sign-in is
rejecting valid credentials because of a missing `city`.* There is no `city` in
`Credentials`. There is no `city` anywhere near the sign-in code. The class that
actually has the mistake is the one silently doing nothing, and the distance
between the two is however many lines of file separate them.

The rule that avoids all of it is one line long: **seal every class that carries
`@validate()` fields.** Make it a review reflex, the same way you'd flag a
missing `await`.

One related trap while you're here: sealing covers the fields declared in *that
class body* and nothing else. `schemaOf()` doesn't walk the prototype chain, so
an undecorated subclass of a sealed parent gets `null`, and so does a subclass
that carries its own `@validatable()` but declares no fields. Inherited rules are
not, in fact, inherited.

## It checks the value; it doesn't tidy it up

Your method body receives exactly what the caller sent — never what Zod handed
back. That's deliberate, and it is completely fine until you write a schema that
does more than check. Then it quietly stops meaning what you think it means:

~~~typescript
@validatable()
class Order {
    @validate(z.coerce.number().int().positive())
    quantity!: number;

    @validate(z.string().trim().min(1))
    sku!: string;

    @validate(z.string().default('EUR'))
    currency!: string;
}
~~~

A caller sends `{ quantity: '3', sku: '  ABC  ' }`. Every field passes. And:

| what you wrote | what it did | what your method actually sees |
|---|---|---|
| `z.coerce.number()` | accepted `'3'` | the **string** `'3'` |
| `z.string().trim()` | accepted `'  ABC  '` | `'  ABC  '`, still untrimmed |
| `z.string().default('EUR')` | accepted the field being absent | no `currency` at all |

Three schemas that look like they normalise your input, and not one of them
changed a thing. The `.default()` line is the meanest of them: it doesn't fill
anything in, it just quietly makes the field optional — so `currency` is
declared, validated, and still `undefined` where you use it. That's the sort of
detail that ends up in a database.

None of this is a defect. `@validated()` is a guard, not a parser, and a guard
that rewrote your arguments would be a much worse thing to debug. But it does
mean a transforming schema is making a promise the guard never agreed to keep.
**Where you need the converted value, parse it yourself in the body** —
`schemaOf(Order)!.parse(order)` gives you the transformed object.

## Fields you never declared still land in your method

An assembled schema is a plain `z.object()`, and a plain `z.object()` shrugs at
properties it doesn't know about. On a normal `parse()` those extra keys get
stripped from the *result* — but `@validated()` discards the result, so the
stripping happens somewhere nobody can see it and the original object arrives
intact, extras and all.

Send `{ email, password, isAdmin: true }` at a method guarded by
`@validated(Credentials)` and `isAdmin` walks straight in.

Most of the time that's harmless — your method reads the fields it knows about
and ignores the rest. It stops being harmless the moment something downstream
spreads that object into a database write, a patch payload, or anything else
where keys become fields. If that's your situation, take the schema and tighten
it on purpose:

~~~typescript
const strict = (schemaOf(Credentials) as z.ZodObject).catchall(z.never());

strict.parse({ email, password, isAdmin: true });
// ZodError: unrecognized_keys
~~~

The decorators can't express this on their own — there's no strict mode to switch
on — so it belongs in the body, or in a small shared helper for the handful of
methods that need it.

## Your caller can't tell "you sent junk" from "we fell over"

Locally, a failure is Zod's own `ZodError`, unwrapped. `instanceof ZodError`
holds, `err.issues` is the array you expect, and you can branch on it.

Across the queue, none of that survives. `@imqueue/rpc` turns anything a method
throws into its own error payload, and a `ZodError` carries no `code` of its own,
so what reaches your caller is:

~~~
code:    IMQ_RPC_CALL_ERROR
message: [ { "origin": "string", "code": "invalid_format",
             "format": "email", "pattern": "/^(?!\\.)…/",
             "path": [ "email" ],
             "message": "Invalid email address" } ]
~~~

The issue list does survive — as a **string**. But the code is the generic one,
[the rejected value isn't an `Error` instance](/api/rpc/latest/rpc.imqrpcerror/),
and `instanceof ZodError` will never be true on the calling side. Which leaves
your caller with two failures that look identical: *you sent me something
invalid* and *I fell over*. One of those is worth retrying. The other will fail
forever, and a retry loop that can't tell the difference will keep trying anyway.

You can fix that, and the fix is not `@validated()`. The decorator wraps your
method, so its throw happens *outside* the body — no `try` you write inside can
catch it. What the framework does honour is a `code` property on a thrown error:
put one there and it is used verbatim instead of `IMQ_RPC_CALL_ERROR`. So for the
methods where callers need to tell the two apart, skip the decorator and parse in
the body:

~~~typescript
@expose()
public async signIn(creds: Credentials): Promise<string> {
    try {
        schemaOf(Credentials)!.parse(creds);
    } catch (err) {
        throw Object.assign(new Error(err.message), {
            code: 'IMQ_RPC_VALIDATION_ERROR',
        });
    }
    // ...
}
~~~

Over the queue the caller now gets `code: IMQ_RPC_VALIDATION_ERROR` with the same
issue list attached — something a retry policy can actually make a decision
about, instead of matching on message text and hoping.

## Yes, but what does it cost

Everyone asks, so: not enough to think about.

On the two-field `Credentials` schema above, in-process, over 300,000 calls after
warm-up, a plain method call takes **32 ns** and the same call through
`@validated(Credentials)` takes **119 ns**. Call it 87 nanoseconds of tax.

For scale, that same method invoked over the queue against Redis on the same
machine — the friendliest round trip that will ever exist, no network in
between — has a median latency of **40 µs**. The check is about two thousandths
of the cheapest possible journey the argument already made to reach you. Measured
over RPC, the guarded and unguarded methods come in at 39 µs and 40 µs: the
difference doesn't survive the noise.

Schemas are assembled once on first call and memoised after, so that figure is
steady state, with no first-call surprise hiding behind it.

## Three things about the argument list that will catch you once

`@validated()` maps validators to arguments strictly by position, left to right,
and that has three consequences worth knowing before you rely on them:

- **`null` or `undefined` skips that position.** `@validated(z.string(), null, z.number())` leaves the second argument completely unchecked — which is useful, and looks exactly like a typo.
- **Anything past the end of your list is unchecked.** One validator guards argument one and nothing else, no matter how many arguments follow it.
- **A validator at a position the caller omitted still runs — against `undefined`** — and fails unless the schema is optional. An optional parameter needs an optional schema, not an absent one.

## Where this stops helping

It validates input. Only input. Return values travel back unchecked, so a service
handing you the wrong shape is still something you find out about the hard way.

It is not authorization. A perfectly well-formed `Credentials` is still an
anonymous one. Validation answers *is this the right shape*, never *is this
caller allowed*.

And it is not protection at the edge. This check runs after a message has been
queued, delivered and dispatched — the right place for correctness, the wrong
place for volume. Traffic you want to stop before it costs you anything belongs
out in front of the HTTP service that fronts your fleet, where
[`@imqueue/http-protect`](/api/http-protect/latest/) lives, or further out still.

What it does do is close the one gap that end-to-end types leave wide open, and
it's the gap that produces the worst afternoons: every layer satisfied, nothing
thrown, nothing logged, and your method quietly running on a value that was never
what its signature said it was.

Add four decorators. Get the Tuesday back.

## FAQ

### Do I need to validate every exposed method?

No, and pretending otherwise is how this becomes busywork nobody maintains. Put a
guard where the cost of bad input is real: anything that writes, anything that
charges money, anything whose caller lives in a repo you don't control. A
read-only lookup that would just return nothing for a nonsense argument is fine
as it is.

The useful heuristic is not "is this method important" but "if the wrong shape
got here, how long would it take me to find out". The methods where the answer is
*Tuesday* are the ones to guard first.

### Can I use `@imqueue/validation` outside an `@imqueue` service?

Yes. Its only runtime dependency is `zod`, and the decorators know nothing about
RPC — they work on any class and any method. You need Node 22.12 or newer and
standard TC39 decorators, which means `experimentalDecorators` off and no
`reflect-metadata` anywhere.

That makes it a reasonable choice for an HTTP handler or a CLI entry point too,
anywhere you'd rather keep the rules on the type than in a schema file that
drifts away from it.

### Why decorators rather than just parsing with Zod inside the method?

Because the rules end up next to the shape they describe, where the next person
to edit the class will actually see them — and because a sealed class doubles as
a validator for any other class that nests it, so you describe each shape once.

Parsing in the body is still the right call in two specific cases, both covered
above: when you need the *transformed* value, and when you want the failure to
reach your caller with a code of its own rather than as `IMQ_RPC_CALL_ERROR`.

### What happens if I forget `@validatable()` on a class?

Two things break at once, and neither one where you're looking. The class you
forgot validates nothing at all, and its field rules attach themselves to the
next class that *is* sealed — which then starts rejecting perfectly good input
over a property it doesn't even declare.

It is the single most confusing failure in this package, which is why it has its
own section above. Seal every class that carries `@validate()` fields and it
cannot happen.

## Reference

[`validate()`](/api/validation/latest/validation.validate/) ·
[`validatable()`](/api/validation/latest/validation.validatable/) ·
[`validated()`](/api/validation/latest/validation.validated/) ·
[`schemaOf()`](/api/validation/latest/validation.schemaof/) ·
[`Validator`](/api/validation/latest/validation.validator/) ·
[`IMQRPCError.code`](/api/rpc/latest/rpc.imqrpcerror.code/) ·
[`classType()`](/api/rpc/latest/rpc.classtype/) ·
[`property()`](/api/rpc/latest/rpc.property/) ·
[FAQ: how do I validate method arguments with decorators before the method runs?](/api/faq/#how-do-i-validate-method-arguments-with-decorators-before-the-method-runs)
