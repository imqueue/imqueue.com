---
chapter: 8
title: "Bonus: React front-end on a REST gateway"
docLabel: TUTORIAL — BONUS 2
lead: "A second front-end, native to REST — no Relay, no shims, no compromises. Same fleet, same features, a client that is idiomatic for the protocol it speaks."
description: "Bonus chapter: a REST front-end for the @imqueue tutorial fleet — its own store model built from fetch and React hooks, standing next to the GraphQL/Relay app."
keywords: "@imqueue REST web app, REST data layer React hooks, fetch store model React, GraphQL vs REST front-end, React TypeScript REST client, transport-agnostic microservices"
ogType: article
---

In the [previous chapter](/tutorial/rest-api) we put a REST/OpenAPI gateway in
front of the fleet. One piece is missing for a complete alternative stack: a
front-end that speaks REST. The tutorial's
[web-app](https://github.com/imqueue-sandbox/web-app) is built on
React/Relay/GraphQL — so alongside it lives a REST edition:
[web-app-rest](https://github.com/imqueue-sandbox/web-app-rest).

It is worth being precise about what "edition" means here, because the obvious
approach is a trap. You *can* keep the Relay components untouched and alias
`react-relay` to a compatibility shim that fakes fragment containers over REST
responses. That works — and it proves the wrong thing. It shows that a REST
gateway can be made to imitate Relay's data-fetching model, when the claim we
actually want to demonstrate is that the fleet does not care which model you
bring.

So `web-app-rest` carries no Relay at all: no `react-relay`, no
`relay-runtime`, no `graphql` tags, no alias in the Vite config. It has its own
store model, built from `fetch` and React hooks, and its components are typed
against the REST DTOs the gateway actually returns. Both apps are React 19 +
TypeScript with function components throughout; they share a look and a feature
set, not a data layer and not a type model.

## The client

At the bottom sits a small `fetch` wrapper
([`src/store/client.ts`](https://github.com/imqueue-sandbox/web-app-rest/blob/main/src/store/client.ts)):
it prefixes the gateway URL, attaches the auth token from the local store as
the `X-Auth-User` header — the same header contract both gateways share — and
parses JSON responses:

~~~typescript
export const client = {
    get: <T = unknown>(path: string) => request<T>('GET', path),
    post: <T = unknown>(path: string, body?: unknown) =>
        request<T>('POST', path, body ?? {}),
    patch: <T = unknown>(path: string, body?: unknown) =>
        request<T>('PATCH', path, body ?? {}),
    del: <T = unknown>(path: string) => request<T>('DELETE', path),
};
~~~

On failure it rejects with a `RestError` carrying the error list from the
gateway's envelope (`[{ message, extensions: { code } }]`). Remember how the
REST gateway deliberately kept that error shape? This is where it pays off:
both front-ends map gateway error codes onto form fields with the same small
routine, because the payload they receive is the same.

## Queries are hooks

There is no `QueryRenderer` and no data-loading HOC — just hooks, one per thing
the app reads
([`src/store/queries.ts`](https://github.com/imqueue-sandbox/web-app-rest/blob/main/src/store/queries.ts)):

~~~typescript
export function useAppRoot(vars: AppRootVars): QueryState<AppRootData>
export function useCarBrands(): QueryState<string[]>
export function useCarModels(brand?: string): QueryState<Car[]>
export function useReservations(date?: Date): QueryState<Reservation[]>
~~~

Each returns `{ data, loading, error, reload }`, so a component says what it
needs and renders the three states plainly:

~~~typescript
const { data, loading, error } = useAppRoot(vars);
~~~

Where the GraphQL app selects several root fields in one round-trip, the REST
hook issues the equivalent requests in parallel and merges them. The `vars` are
the same flags the GraphQL query used, so a route still asks for exactly the
data it displays:

~~~typescript
const load = useMemo<Loader<AppRootData>>(
    () => async () => {
        const tasks: Promise<void>[] = [];
        const result: AppRootData = {};

        if (withUser || withUserCars) {
            tasks.push(client.get<User>('/users/me').then(user => {
                result.user = user;
            }));
        }

        if (withOptions) {
            tasks.push(client.get<Options>('/options').then(options => {
                result.options = options;
            }));
        }

        if (withReservations) {
            tasks.push(client
                .get<{ reservations: Reservation[] }>('/reservations')
                .then(res => {
                    result.reservations = res.reservations;
                }));
        }

        await Promise.all(tasks);

        return result;
    },
    [withUser, withUserCars, withOptions, withReservations],
);

return useQuery(load, true);
~~~

All four hooks are built on one internal `useQuery` engine, which is where the
unglamorous but essential parts live: a request whose inputs have since changed
is discarded rather than allowed to overwrite newer data, and a hook with
nothing to fetch — no brand picked yet, no date selected — issues no request at
all instead of asking the gateway for nothing.

## Mutations are hooks too

Each operation is a module exporting a hook that returns the commit function
and an in-flight flag — the flag being what disables the submit button while
the request is out:

~~~typescript
export function useReserve(): [
    (reservation: ReserveInput, options?: ReserveOptions) => void,
    boolean,
] {
    const [isInFlight, setInFlight] = useInFlight();
    const reserve = useCallback(async (
        { carId, type, duration }: ReserveInput,
        { success, failure }: ReserveOptions = {},
    ) => {
        setInFlight(true);

        try {
            const payload = await client.post<ReservePayload>('/reservations', {
                carId,
                type,
                duration: duration.map(item => item.toISOString()),
            });

            success && success(payload);
        } catch (err) {
            logger.error('reserveMutation:request', err);
            failure && failure(toErrorList(err));
        } finally {
            setInFlight(false);
        }
    }, [setInFlight]);

    return [reserve, isInFlight];
}
~~~

## Reactivity without a normalized store

One thing Relay gives you for free is store reactivity: when a mutation returns
updated records, everything reading them re-renders. A `fetch`-based app has no
normalized cache, so this one earns the same effect with an invalidation bus
([`src/store/bus.ts`](https://github.com/imqueue-sandbox/web-app-rest/blob/main/src/store/bus.ts))
— about twenty lines around a `Set` of listeners:

~~~typescript
export function onDataChange(handler: DataChangeHandler): Unsubscribe
export function emitDataChange(): void
~~~

The mutations that change the current user (`updateUser`, `addCar`,
`removeCar`) announce it, and the hooks marked *live* reload **in the
background** — no loading flag raised, the last good data left on screen until
the new data arrives. The list just updates, exactly as it did with Relay. The
catalog hooks are not live, because car makes and models do not change under
the user.

This is the honest trade to look at closely. Relay's store buys you automatic,
fine-grained invalidation and costs you a compiler, generated artifacts and a
fragment discipline. The bus buys you a re-fetch of whole queries for a handful
of lines and no build step. Which is the better deal depends entirely on the
app — and that judgement is yours to make per client, which is the whole point
of keeping it out of the services.

## Running it

With the fleet and the REST gateway from the
[previous chapter](/tutorial/rest-api) running:

~~~bash
cd ~/imqueue-sandbox
git clone git@github.com:imqueue-sandbox/web-app-rest.git
cd web-app-rest
npm i
npm start
~~~

The dev server listens on port **3001** — deliberately, so it can run alongside
the GraphQL web-app on port 3000. It points at the REST gateway on
`http://localhost:8080/` by default (override with `VITE_WEB_API_URL`).

If you've followed every chapter, you now have two complete stacks running side
by side — GraphQL/Relay at [http://localhost:3000/](http://localhost:3000/) and
REST/OpenAPI at [http://localhost:3001/](http://localhost:3001/) — with the
same features, orchestrating the **same four @imqueue services** over the same
message queue. Each app's title bar carries a protocol badge, `GraphQL` or
`REST`, so you always know which one you are looking at.

Try it: register a customer in one, then log into the other. Add a car on
:3000 and watch it appear in the garage on :3001. Book a washing slot over
REST and cancel it over GraphQL. There is one fleet behind both, and it never
learns which protocol asked.

## The takeaway

Nothing in an @imqueue fleet ties you to any particular API technology. The
services expose typed, transport-agnostic RPC over the queue; whatever sits in
front of them — GraphQL, REST, or anything else you might need tomorrow — is a
thin, replaceable orchestration shell. And because that shell is thin, each
client is free to be *good* at the protocol it speaks rather than pretending to
speak another one.

Happy hacking!
