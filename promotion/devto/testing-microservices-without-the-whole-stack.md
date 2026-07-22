---
title: "Testing services that call each other — without booting the whole stack"
published: false
description: "Integration tests that require every service and its infrastructure running are slow, flaky, and painful. Here's a layered approach that tests most of your logic without spinning up the world."
tags: node, typescript, microservices, testing
canonical_url: https://imqueue.org/blog/testing-microservices-without-the-whole-stack/
cover_image: https://imqueue.org/images/blog/testing-microservices-without-the-whole-stack.png
---
The dread of microservice testing is the end-to-end setup: to test one behavior, you boot every service it touches, plus their datastores and the message bus, wait for it all to come up, and hope nothing is flaky today. Those tests are valuable but expensive, and if they're your *only* tests, your feedback loop is measured in minutes. The fix isn't a clever harness — it's testing at the right layers so you rarely need the whole stack.

## Layer 1: a service is just a class

The most underused fact about a well-structured `@imqueue` service is that it's an ordinary TypeScript class. Its exposed methods are normal methods. You can unit-test them directly, with no queue, no transport, no other service running:

```ts
import { UserService } from '../src/UserService.js';

test('get returns null for an unknown id', async () => {
    const svc = new UserService();
    const result = await svc.get('does-not-exist');
    assert.equal(result, null);
});
```

Most of a service's logic lives in these methods. Testing them as plain functions is fast and deterministic, and it covers the majority of your behavior without any infrastructure at all. Keep the exposed methods thin over well-factored internals and this layer does the heavy lifting.

## Layer 2: typed clients are your seams

When a service *calls another service*, you don't want the real callee in a unit test. Because callers depend on a **generated typed client**, that client is a clean seam to substitute. Inject the client (or the specific dependency it provides) rather than reaching for it globally, and in tests you pass a fake that satisfies the same typed interface:

```ts
// Production wiring passes a real generated client; tests pass a fake
// that implements the same typed shape.
const fakeUsers = {
    async get(id: string) { return { id, name: 'Test User' }; },
};

const orders = new OrderService(fakeUsers);
const result = await orders.placeFor('42');
assert.equal(result.status, 'ok');
```

The win of a *typed* client here is that your fake can't drift from the real contract without a compile error — if `UserService.get` changes, both the real client and your fake stop type-checking, and you find out immediately.

## Layer 3: one real service + the queue, when you must

Some things only integration tests can catch: serialization edge cases, actual delivery behavior, timeouts. For those, you don't need the *whole* stack — you need the service under test, the message queue, and typed clients driving it. Stand up just those, run a focused suite, and keep it small. This is where a running queue and a real generated client earn their keep; everything else stayed in layers 1 and 2.

## The principle

Push tests down to the cheapest layer that can catch the bug:

- **Logic** → unit-test the service class directly (no infra).
- **Cross-service contracts** → typed clients as seams, with fakes that can't drift.
- **Wire/delivery behavior** → a minimal integration slice, not the full fleet.

You end up with a fast, reliable majority of tests and a small, deliberate set of heavy ones — instead of one giant, flaky end-to-end suite. To structure services this way from the start, see [Getting Started](https://imqueue.org/get-started/) and the client-generation workflow in the [Tutorial](https://imqueue.org/tutorial/).
