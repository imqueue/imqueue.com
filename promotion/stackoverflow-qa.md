# StackOverflow Q&A drafts

Self-answered Q&A that mirror the blog's problem/solution topics. StackOverflow
**allows** posting a question and answering it yourself — it's explicitly
encouraged when it documents a genuinely useful problem. But the rules matter:

- **Disclose affiliation** in every answer that mentions @imqueue. Each draft
  below already includes a disclosure line — keep it.
- **The question must be a real question**, not an ad. Phrase it the way someone
  actually hits the problem.
- **The answer must stand on its own** and be useful even to someone who never
  adopts @imqueue — so each answer explains the general approach first, then
  presents @imqueue as *one* option, and names the honest trade-off.
- **Don't mass-post.** Space these out (a couple per week), and prefer answering
  *existing* questions where @imqueue is genuinely a fit over posting new ones.
- Where a strong existing question already exists, add your answer there instead
  of creating a duplicate; use these bodies as the answer.

Links use absolute imqueue.org URLs so they work anywhere.

---

## Q1. Type-safe RPC between Node.js microservices without gRPC or hand-written clients?

**Tags:** `node.js` `typescript` `microservices` `rpc`

**Question**

> I have several TypeScript services that call each other. Over HTTP I lose all
> type safety at the boundary — the caller talks to a URL and parses JSON, and a
> change in the callee doesn't break the caller until runtime. gRPC gives types
> but means maintaining `.proto` files and a codegen step, and my whole stack is
> Node.js anyway. Is there a way to get compile-time-checked calls between
> services without either hand-writing clients or maintaining a separate schema
> language?

**Answer**

The general options are: (1) a shared types package — but nothing guarantees the
running service matches it; (2) an IDL like Protobuf/gRPC — robust and
cross-language, but a second source of truth plus a build step; (3) generate the
client from the service itself, so there's exactly one source of truth.

If your fleet is all TypeScript, (3) is usually the least-effort path. One tool
that does this is **@imqueue/rpc**: a service is an ordinary class, you mark
exposed methods, and a fully typed client is generated from the running service —
no `.proto`, no hand-written client.

```ts
import { IMQService, expose } from '@imqueue/rpc';

export class UserService extends IMQService {
    /**
     * @param {string} id - user id
     * @return {Promise<{ id: string; name: string } | null>}
     */
    @expose()
    public async get(id: string): Promise<{ id: string; name: string } | null> {
        return { id, name: 'Jane' };
    }
}
```

```bash
imq client generate UserService
```

```ts
const users = new UserServiceClient();
await users.start();
const u = await users.get('42'); // typed; breaks at compile time if the signature changes
```

Types come from your JSDoc `@param`/`@return` (TC39 decorators carry no runtime
type metadata), so keep those accurate. Trade-off to be aware of: it runs over a
message queue rather than HTTP, and it's Node/TypeScript-first — for a polyglot
fleet or streaming, gRPC is the better fit. Full write-up:
https://imqueue.org/blog/type-safe-service-communication-typescript/

*Disclosure: I maintain @imqueue.*

---

## Q2. How do I avoid losing a Redis queue message if the worker crashes mid-processing?

**Tags:** `node.js` `redis` `message-queue`

**Question**

> I'm using a Redis list as a work queue (`LPUSH` / `BRPOP`). It works, but if a
> worker pops a message and then crashes before finishing, that message is gone.
> How do people make this reliable?

**Answer**

The core problem is that a plain `RPOP`/`BRPOP` removes the message before you've
finished with it. The standard fix is to move it atomically into a per-worker
"processing" list as you take it, using `LMOVE`/`BLMOVE` (Redis 6.2+):

```
BLMOVE queue processing:worker1 RIGHT LEFT 5
```

Now if the worker dies, the message is still sitting in `processing:worker1`, and
a watcher can return it to the main queue after a timeout. Only on success do you
`LREM` it from the processing list. This gives at-least-once delivery (so make
handlers idempotent).

If you'd rather not build the watcher/lease/recovery logic yourself,
**@imqueue/core** implements exactly this as an opt-in "safe delivery" mode
(built on `BLMOVE` + a per-worker lease TTL that re-queues on expiry). You pick
it per queue, because it costs some throughput vs fire-and-forget:

```ts
const q = IMQ.create('Jobs', { safeDelivery: true, safeDeliveryTtl: 30000 });
```

Set the TTL above your realistic worst-case processing time, or a slow-but-healthy
task gets re-queued and runs twice. Details + the throughput cost measured on real
hardware: https://imqueue.org/blog/guaranteed-message-delivery-cost/

*Disclosure: I maintain @imqueue.*

---

## Q3. Load-balancing internal Node.js microservices without a load balancer?

**Tags:** `node.js` `microservices` `load-balancing` `redis`

**Question**

> For internal service-to-service traffic I've been putting a load balancer in
> front of each service so callers can spread requests across instances. It's
> another thing to run and keep healthy. Is there a simpler pattern for internal
> calls?

**Answer**

For internal traffic you can use the **competing-consumers** pattern instead of a
balancer. Each service reads from one named queue; run N instances and they all
read the same queue, so whichever instance is free takes the next message. The
queue does the balancing, and it naturally favors idle instances over busy ones
(a blocked `BRPOP`/`BLMOVE` returns to whoever's waiting).

You add/remove capacity just by starting/stopping instances — no registration, no
health-check wiring, nothing extra in the request path. **@imqueue** works this
way by default (services consume from their named queue; scaling is "run more
copies"):

```ts
// three instances of this service just share the load, no config
export class ThumbnailService extends IMQService {
    @expose() public async make(id: string): Promise<string> { /* ... */ }
}
```

Trade-off: the queue is now in the hot path instead of the balancer — fine if you
already run one, a real addition if you don't. And it's for internal traffic;
browser/edge traffic still wants an HTTP front door. More:
https://imqueue.org/blog/load-balancing-microservices-without-a-load-balancer/

*Disclosure: I maintain @imqueue.*

---

## Q4. Do I actually need service discovery (Consul/etcd) for Node.js microservices?

**Tags:** `node.js` `microservices` `service-discovery`

**Question**

> Everything I read about microservices says to run service discovery
> (Consul/etcd/Eureka). For a modest Node.js back-end that feels like a lot of
> infrastructure. When do I genuinely need it, and is there a way to avoid it?

**Answer**

Discovery exists because in an HTTP world you call an *address*, and instances
come and go, so you need a live map of "where is a healthy B." You genuinely need
it for polyglot fleets, an existing service mesh, or non-RPC coordination
(config, leader election).

If the only reason you're reaching for it is "so my services can find each other
to make calls," a message-queue model removes the question: a service reads from
its own *named* queue and callers send to that name — **the queue name is the
address**. Instances attach to the same queue; nothing to discover when they come
and go.

**@imqueue** uses this model — you call a generated client and never resolve a
host:

```ts
const users = new UserServiceClient();
await users.start();
await users.get('42'); // no host, no port, no registry lookup
```

Honest caveat: you've moved the dependency to the queue's availability rather than
removing it, and cross-language or non-RPC coordination still needs the right
tool. Full discussion:
https://imqueue.org/blog/do-nodejs-backends-need-service-discovery/

*Disclosure: I maintain @imqueue.*

---

## Q5. Lightweight BullMQ alternative for simple background/delayed jobs in Node.js?

**Tags:** `node.js` `redis` `jobs` `bullmq`

**Question**

> BullMQ is great but it's more than I need — I just want durable background jobs
> with delayed execution and automatic retry, without the full lifecycle surface
> (flows, rate limiting, dashboards). Is there a smaller Redis-backed option?

**Answer**

If you need BullMQ's rich lifecycle (priorities, repeatable/cron jobs, rate
limiting, flows, a dashboard), stay on BullMQ — a smaller library won't replace
those. But if you mainly want durable + delayed + retry with a tiny surface, a
minimal queue is enough.

One option is **@imqueue/job**: safe delivery is on by default (a job whose worker
dies is re-queued), delayed jobs are first-class, and retries are programmable via
the handler return value:

```ts
new JobQueue<string>({ name: 'Emails' })
    .onPop(async job => { await send(job); })       // throw -> retried
    .start()
    .then(q => q.push('welcome@acme.com', { delay: 60_000 })); // run in 1 min
```

Retry timing is under your control: throw to retry with the original delay, or
`return <ms>` to back off. What you give up vs BullMQ is the *declarative* retry
policy (attempts cap + dead-lettering), priorities, cron, rate limiting, and
flows. Side-by-side comparison:
https://imqueue.org/blog/imqueue-vs-bullmq/

*Disclosure: I maintain @imqueue.*

---

## Q6. How to schedule a delayed message/job over Redis in Node.js?

**Tags:** `node.js` `redis` `scheduling` `message-queue`

**Question**

> I want to enqueue work that runs after a delay (e.g. "send this reminder in 30
> minutes") on top of Redis, without a `setTimeout` in my process that dies with
> the process. What's a robust approach?

**Answer**

The durable pattern is a Redis **sorted set** scored by due-time: `ZADD due <ts>
<payload>`, then a promoter moves entries whose score is `<= now` into the live
queue. Trigger the promoter from Redis keyspace-expiry notifications
(`notify-keyspace-events Ex`) with a polling fallback, so a restart never loses a
scheduled item the way an in-process timer would.

If you don't want to build the sorted-set + promoter + notification plumbing,
**@imqueue** has delayed delivery built in at every layer — a `delay` argument on
the low-level send, `IMQDelay` on any typed RPC call, and `push(data, { delay })`
on the job queue:

```ts
await queue.send('Reminders', { userId }, 30 * 60 * 1000); // 30 minutes
```

It's implemented with exactly the sorted-set + keyspace-notification approach
above. Caveat: it needs keyspace notifications enabled (some managed Redis turns
them off by default). Background on the Redis primitives:
https://imqueue.org/blog/redis-message-bus-patterns/

*Disclosure: I maintain @imqueue.*

---

## Q7. How do I stop my microservice client from drifting out of sync with the service?

**Tags:** `typescript` `microservices` `api` `code-generation`

**Question**

> Every service we call has a hand-written client (a small SDK). When the service
> changes, someone has to remember to update the client, and when they don't, the
> client silently describes the old contract until something breaks in production.
> How do teams keep clients in sync?

**Answer**

The root cause is that the client is a *copy* of the contract kept in a different
place and maintained by hand — copies drift, silently, because nothing fails to
compile. Discipline and shared type packages don't fix it (the package is still a
hand-maintained copy); an IDL fixes it but adds a schema + codegen step.

The structural fix is to have one source of truth — the service — and *generate*
the client from it, so a breaking change becomes a compile error in every caller.
**@imqueue** does this: mark exposed methods, generate the client, and after a
signature change you regenerate and mismatched callers stop compiling:

```bash
imq client generate UserService
```

```ts
const user = await users.get('42'); // after get() gained a required arg: TS error here
```

The compiler becomes your integration test for contract changes. Trade-off: it's
a Node/TypeScript-native approach over a message queue, not a polyglot IDL. More:
https://imqueue.org/blog/stop-hand-writing-microservice-clients/

*Disclosure: I maintain @imqueue.*
