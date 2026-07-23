---
chapter: 8
title: "Bonus: REST Web App"
docLabel: TUTORIAL — BONUS 2
lead: "Re-point the front-end at the REST gateway without rewriting the UI — every presentational component reused unchanged."
description: "Bonus chapter: the @imqueue tutorial web app re-pointed from GraphQL/Relay to the REST gateway — same UI components, a thin REST data layer swapped in."
keywords: "@imqueue REST web app, replace Relay with REST, react-relay shim, REST data layer React, GraphQL to REST migration front-end, Vite alias react-relay"
ogType: article
---

In the [previous chapter](/tutorial/rest-api) we put a REST/OpenAPI gateway in
front of the fleet. One piece is missing for a complete alternative stack: a
front-end that speaks REST. The tutorial's
[web-app](https://github.com/imqueue-sandbox/web-app) is built on
React/Relay/GraphQL — so we made a REST edition of it:
[web-app-rest](https://github.com/imqueue-sandbox/web-app-rest).

The rule of the game, same as before, is to change as little as possible:
every presentational component is reused **unchanged** from the Relay-based
app — identical look and feel — and only the data layer is replaced.

### The data layer swap

At the bottom sits a thin REST client
([`src/rest/client.js`](https://github.com/imqueue-sandbox/web-app-rest/blob/main/src/rest/client.js)):
a `fetch` wrapper that attaches the auth token from the local store as the
`X-Auth-User` header — the same header contract both gateways share — and
parses JSON responses:

~~~javascript
export const client = {
    get: path => request('GET', path),
    post: (path, body) => request('POST', path, body ?? {}),
    patch: (path, body) => request('PATCH', path, body ?? {}),
    del: path => request('DELETE', path),
};
~~~

On failure it throws a `RestError` carrying the error list from the gateway's
GraphQL-compatible envelope (`[{ message, extensions: { code } }]`). Remember
how the REST gateway deliberately kept that error shape? This is where it pays
off: the unchanged components keep consuming errors exactly the way they did
with Relay.

### Keeping the `react-relay` imports alive

The reused components still contain `import { createFragmentContainer,
graphql } from 'react-relay'` — but this build has no Relay runtime at all.
Instead, Vite aliases the `react-relay` module to a small compatibility shim:

~~~javascript
resolve: {
    alias: {
        'react-relay': fileURLToPath(
            new URL('./src/rest/reactRelayShim.jsx', import.meta.url),
        ),
    },
},
~~~

The [shim](https://github.com/imqueue-sandbox/web-app-rest/blob/main/src/rest/reactRelayShim.jsx)
is pleasantly boring:

- `graphql` becomes a no-op tagged template — the fragment texts inside the
  components turn into inert strings nobody reads;
- `createFragmentContainer` becomes a transparent pass-through: with Relay the
  container read its slice of data off the store, here the parent already
  passes the resolved plain object as the same prop;
- `createRefetchContainer` seeds its data from props and exposes the
  `relay.refetch()` method the time-table component relies on — implemented as
  a `GET /reservations?date=…` call that re-renders the wrapped component with
  the refreshed data.

### Queries become descriptors

Relay's `QueryRenderer` HOC is replaced by a
[`withQuery`](https://github.com/imqueue-sandbox/web-app-rest/blob/main/src/relay/queries/Query.jsx)
data loader with the same public contract (`vars`, `onError`, `onLoading`,
`childProps`), driven by plain descriptor objects. A descriptor exposes an
async `fetch(vars)` that assembles, over REST, the same data shape the GraphQL
query used to return:

~~~javascript
export const AppRootQuery = {
    async fetch(vars = {}) {
        const tasks = [];
        const result = {};

        if (vars.withUser || vars.withUserCars) {
            tasks.push(client.get('/users/me').then(user => {
                result.user = user;
            }));
        }

        if (vars.withOptions) {
            tasks.push(client.get('/options').then(options => {
                result.options = options;
            }));
        }

        if (vars.withReservations) {
            tasks.push(client.get('/reservations').then(res => {
                result.reservations = res.reservations;
            }));
        }

        await Promise.all(tasks);

        return result;
    },
};
~~~

Where one GraphQL query selected several root fields in a single round-trip,
the descriptor issues the equivalent REST calls in parallel and merges the
results — the consuming components can't tell the difference.

### Mutations become plain requests

Each mutation keeps its original module, signature and callback contract, and
simply swaps `commitMutation` for a REST call:

~~~javascript
export function reserve({ carId, type, duration }, success, failure) {
    client
        .post('/reservations', {
            carId,
            type,
            duration: duration.map(item => item.toISOString()),
        })
        .then(payload => success && success(payload))
        .catch(err => failure && failure(err.errors || [err]));
}
~~~

### Reproducing Relay's reactivity

One thing Relay gave us for free was store reactivity: when a mutation
returned updated records, every fragment container reading them re-rendered
automatically. A REST build has no normalized store, so the app reproduces the
behaviour with a tiny invalidation bus
([`src/rest/bus.js`](https://github.com/imqueue-sandbox/web-app-rest/blob/main/src/rest/bus.js)):
mutations that change root-query data call `emitDataChange()`, and the
`withQuery` loader re-fetches **in the background**, updating the data in
place without flashing a loading state. The list just updates — exactly as it
did before.

### Running it

With the fleet and the REST gateway from the
[previous chapter](/tutorial/rest-api) running:

~~~bash
cd ~/imqueue-sandbox
git clone git@github.com:imqueue-sandbox/web-app-rest.git
cd web-app-rest
npm i
npm start
~~~

The dev server listens on port **3001** — deliberately, so it can run
alongside the GraphQL web-app on port 3000. It points at the REST gateway on
`http://localhost:8080/` by default (override with `VITE_WEB_API_URL`).

If you've followed every chapter, you now have two complete stacks running
side by side — GraphQL/Relay at
[http://localhost:3000/](http://localhost:3000/) and REST/OpenAPI at
[http://localhost:3001/](http://localhost:3001/) — with the same pixel-perfect
UI, orchestrating the **same four @imqueue services** over the same message
queue.

### The takeaway

Nothing in an @imqueue fleet ties you to any particular API technology. The
services expose typed, transport-agnostic RPC over the queue; whatever sits in
front of them — GraphQL, REST, or anything else you might need tomorrow — is
a thin, replaceable orchestration shell.

Happy hacking!
