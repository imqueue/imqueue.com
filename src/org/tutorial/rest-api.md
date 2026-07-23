---
chapter: 7
title: "Bonus: REST API"
docLabel: TUTORIAL — BONUS 1
lead: "Swap the GraphQL gateway for a REST/OpenAPI one — same fleet, same typed clients, a different front door."
description: "Bonus chapter: rebuild the @imqueue tutorial API gateway as a REST/OpenAPI service with Swagger UI — same back-end fleet, same RPC clients, different transport."
keywords: "@imqueue REST API, REST API gateway, OpenAPI microservices Node.js, Swagger UI express, REST vs GraphQL gateway, orchestrate microservices REST, TypeScript REST gateway"
ogType: article
---

In [chapter 5](/tutorial/api-service) we put a GraphQL endpoint in front of our
services and noted, in passing, that the exact technology stack of the API
layer isn't important. This bonus chapter proves that claim: we rebuild the
same gateway as a **REST/OpenAPI** service — without touching a single line of
the back-end fleet. In the [next bonus chapter](/tutorial/rest-web-app) we'll
re-point the web application at it, too.

The finished service is on GitHub:
[api-rest](https://github.com/imqueue-sandbox/api-rest).

### One fleet, any front door

Recall the architecture: the services communicate over a Redis message queue
using @imqueue RPC, and the API service is just another consumer of that
fleet — it holds a set of typed clients and orchestrates calls to them. What
the gateway speaks to the outside world is entirely its own business. GraphQL,
REST, gRPC, WebSockets — the fleet neither knows nor cares.

So the plan is simple: keep the orchestration, replace the transport.

### What stays the same

Everything that touches @imqueue, literally. The four services — user, auth,
car and time-table — run unmodified. The gateway uses the same statically
generated clients (built with `imq client generate`, exactly as in
[chapter 5](/tutorial/api-service#building-the-clients)), and its start-up
context is the same code you've already seen:

~~~typescript
private static async bootstrapContext(): Promise<void> {
    Application.context = {
        user: new user.UserClient(clientOptions),
        auth: new auth.AuthClient(clientOptions),
        car: new car.CarClient(clientOptions),
        timeTable: new timeTable.TimeTableClient(clientOptions),
    };

    await Application.context.user.start();
    await Application.context.auth.start();
    await Application.context.car.start();
    await Application.context.timeTable.start();
}
~~~

This is the point of the whole exercise: the @imqueue integration is a handful
of client instantiations, so it survives an API-style change untouched.

### What changes

The transport layer. Instead of graphql-yoga serving a schema, the
gateway is a plain Express 5 application: `helmet`, `cors`, `compression` and
a JSON body parser, followed by an authentication middleware, a REST router
and a terminal error handler.

Where GraphQL gave us an introspectable schema and the GraphiQL playground,
REST has its own well-established equivalents: the gateway builds an
**OpenAPI 3 document** describing every route and schema (see
[`src/openapi.ts`](https://github.com/imqueue-sandbox/api-rest/blob/main/src/openapi.ts)),
serves it at `/openapi.json`, and renders an interactive **Swagger UI** at the
service root — the REST analogue of GraphiQL.

The resulting surface looks like this:

| Method | Path | Description |
|---|---|---|
| POST | `/auth/login` | Log in, returns `{ token, user }` |
| POST | `/auth/logout` | Invalidate a token |
| GET | `/users/me` | Current user (with cars) |
| GET | `/users` | List users (non-admins capped at 100) |
| GET | `/users/{idOrEmail}` | Get a user by id or email |
| POST | `/users` | Register (create) a user |
| PATCH | `/users/{id}` | Update the authenticated user |
| POST | `/users/{idOrEmail}/cars` | Attach a car (`me` for self) |
| DELETE | `/users/{idOrEmail}/cars/{carId}` | Remove a car |
| GET | `/brands` | Car manufacturer names |
| GET | `/cars?brand=` | Catalog cars for a brand |
| GET | `/cars/{id}` | Catalog car by id |
| GET | `/options` | Time-table options |
| GET | `/reservations?date=` | Reservations for a date |
| GET | `/reservations/{id}` | Reservation by id |
| POST | `/reservations` | Make a reservation |
| DELETE | `/reservations/{id}` | Cancel a reservation |

### From resolvers to an orchestrator

In the GraphQL gateway the orchestration logic lived inside resolvers and
mutations. Here it is collected into a single
[`Orchestrator`](https://github.com/imqueue-sandbox/api-rest/blob/main/src/orchestrator.ts)
class of transport-agnostic methods that talk to the fleet and return plain
DTOs, while the
[routes](https://github.com/imqueue-sandbox/api-rest/blob/main/src/routes.ts)
stay one-liners:

~~~typescript
router.get(
    '/reservations',
    asyncHandler(async (req, res) => {
        const date =
            typeof req.query.date === 'string' ? req.query.date : undefined;

        res.json({
            reservations: await Orchestrator.reservations(ctx(res), date),
        });
    }),
);
~~~

And the orchestrator method behind it is the same @imqueue client call you
would have written in a resolver:

~~~typescript
public static async reservations(
    context: Context,
    date?: string,
): Promise<ReservationDTO[]> {
    const list = await context.timeTable.list(
        date ? new Date(date).toISOString() : undefined,
        [...RESERVATION_FIELDS],
    );

    return Promise.all(
        (list as any[]).map(r => Orchestrator.toReservationDTO(context, r)),
    );
}
~~~

One interesting difference hides in those field lists. In GraphQL, each query
declared exactly which fields it wanted, and the gateway forwarded that
selection to the services. REST has no per-request field selection, so the
gateway pins a fixed field set per DTO (`USER_FIELDS`, `CAR_FIELDS`,
`RESERVATION_FIELDS`) — and still passes it down through the @imqueue clients,
so the services keep returning only what the gateway actually needs.

### Authentication

The GraphQL gateway resolved the authenticated user from the `X-Auth-User`
header; the REST gateway keeps the exact same contract, moved into an Express
middleware that verifies the JWT via the auth service and attaches a
per-request context:

~~~typescript
export function authMiddleware(base: Context) {
    return async (req: Request, res: Response, next: NextFunction) => {
        const token = (req.header('x-auth-user') || '').trim();
        const authUser = await resolveAuthUser(base.auth, token);

        res.locals.context = { ...base, authUser } as Context;
        next();
    };
}
~~~

The authorization rules — active user, owner-or-admin, admin-only flags —
are ported one-to-one from the GraphQL validators into small assertion
helpers the orchestrator calls explicitly.

### Errors

Failures are emitted in a GraphQL-compatible envelope:

~~~json
{
    "errors": [
        { "message": "Unauthorized", "extensions": { "code": "AUTH_ERROR" } }
    ]
}
~~~

…with a proper HTTP status on top (401 for auth failures, 404 for missing
resources, 409 for a duplicate e-mail, 400 otherwise). Keeping the error shape
identical across both gateways is a deliberate choice: a single front-end
error-mapping routine works against either one — which pays off in the next
chapter.

### Running it

With the fleet running as described in [chapter 6](/tutorial/deployment),
add the REST gateway alongside:

~~~bash
cd ~/imqueue-sandbox
git clone git@github.com:imqueue-sandbox/api-rest.git
cd api-rest
npm i
npm run dev
~~~

The gateway listens on `API_REST_PORT` (default **8080**) and connects to the
fleet over the Redis queue configured by `IMQ_REDIS`. Open
[http://localhost:8080/](http://localhost:8080/) for the Swagger UI and try
the endpoints interactively — log in via `POST /auth/login`, then paste the
returned token into the `X-Auth-User` authorization field.

Note that nothing stops you from running **both** gateways at once: GraphQL on
port 8888 and REST on port 8080, orchestrating the same services over the same
queue, at the same time. That's the adaptability we set out to demonstrate.

Next up: [Bonus: REST Web App](/tutorial/rest-web-app).
