# Blog backlog — problem/solution posts (proposed)

Top-of-funnel, problem/solution angle (not comparisons). Each targets a search a
developer runs when they *have the problem but haven't heard of @imqueue yet* —
the post leads with the problem, then introduces the framework as one answer.
Kept on the local `blog-draft` branch. **All 10 below are now written** into
`src/org/blog/posts/` (drafted 2026-07; review before publishing). The
"also-ran" ideas at the bottom remain unwritten suggestions.

Guidance applied to all: keep the transport framing generic ("message queue"),
don't position @imqueue as tied to a single broker, no product-vs-product
comparisons.

---

1. **Stop hand-writing and hand-maintaining microservice clients**
   - Target keywords: "generate typed api client typescript", "stop writing api clients", "sdk maintenance microservices"
   - Pain: every service needs a client/SDK, and they rot out of sync with the service.
   - Angle: the cost of hand-maintained clients (drift, duplicated types, release coupling) → self-describing services + generated typed clients regenerated on change.
   - Hook: `imq client generate`, compile-time breakage when a signature changes.

2. **Load balancing internal microservices without running a load balancer**
   - Target keywords: "microservice load balancing nodejs", "load balance internal services", "load balancing without load balancer"
   - Pain: teams stand up and operate LBs/ingress just so internal services can share traffic.
   - Angle: competing-consumers pattern — N instances read the same queue, work self-balances, nothing to operate in the request path.

3. **Do Node.js back-ends really need service discovery?**
   - Target keywords: "nodejs service discovery alternative", "do i need consul", "service discovery overkill"
   - Pain: Consul/etcd/DNS-SD setup and operation for modest fleets.
   - Angle: when discovery is genuinely needed vs when "the queue name is the address" removes the problem entirely.

4. **Cutting boilerplate out of Node.js microservices**
   - Target keywords: "reduce microservice boilerplate nodejs", "microservice scaffolding typescript"
   - Pain: repetitive scaffolding, wiring, and client code per service.
   - Angle: what boilerplate actually accretes in a service repo → scaffolding + generated clients + conventions that remove it. Show a before/after file count.

5. **Back-pressure for Node.js services (and why HTTP makes it hard)**
   - Target keywords: "nodejs backpressure microservices", "handle traffic spikes microservices", "overload cascading failure"
   - Pain: a slow/downstream service takes callers down with it under load.
   - Angle: how a queue absorbs spikes instead of dropping connections; where guaranteed delivery fits; the trade-offs to watch (unbounded growth, TTLs).

6. **Guaranteed message delivery: what it costs and when you need it**
   - Target keywords: "guaranteed message delivery nodejs", "at-least-once delivery", "reliable messaging"
   - Pain: "will I lose messages if a worker dies?" and fear of the performance cost.
   - Angle: unreliable vs safe delivery, the roughly-halved-throughput trade, and a decision guide per workload. (Grounded in the real delivery-mode behavior.)

7. **Testing services that call each other — without booting the whole stack**
   - Target keywords: "test microservices nodejs", "mock service calls typescript", "integration test microservices"
   - Pain: end-to-end tests need every service + infra running; slow and flaky.
   - Angle: strategies for testing across service boundaries — typed clients as seams, testing a service in isolation, when to use a real queue vs a fake.

8. **Versioning microservices without breaking every caller**
   - Target keywords: "microservice versioning nodejs", "breaking change microservices", "coordinate service releases"
   - Pain: a signature change silently breaks callers; coordinating releases is manual and scary.
   - Angle: regenerate-client workflow surfaces breakage at compile time; coordinated version bumps across a fleet; additive-change discipline.

9. **From monolith to services: a low-risk first extraction for Node.js teams**
   - Target keywords: "monolith to microservices nodejs", "extract first microservice", "strangler fig nodejs"
   - Pain: big-bang rewrites are risky; teams don't know where to start.
   - Angle: extract one bounded capability behind a typed service call, keep the rest in place, iterate. A concrete step-by-step.

10. **Internal APIs don't need to be REST**
    - Target keywords: "internal api rpc", "rest for internal services", "service to service calls nodejs"
    - Pain: REST ceremony (routes, verbs, status codes, serializers) for calls that are really just "run this function over there."
    - Angle: for *internal* traffic, function-call semantics beat resource semantics; what you gain (types, less mapping) and what REST is still better at (public/edge APIs). (Concept post, not a product comparison.)

---

## Also-ran ideas (if you want more later)
- Delayed & scheduled work without adding a separate job system
- Graceful shutdown and zero-drop deploys for queue-based services
- Structured logging and request tracing across service calls
- Typed events (not just request/response) between services
- Running a local multi-service fleet on one laptop for development
