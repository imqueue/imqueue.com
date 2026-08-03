# @imqueue — TypeScript RPC over a message queue

Source: {{ siteUrl }}/

RPC over a message queue for service-oriented Node.js & TypeScript back-ends.
Self-describing services generate their own typed clients — no boilerplate.

## What @imqueue is

A message-queue RPC framework for Node.js and TypeScript microservices. One
back-end service calls another as if it were a local *typed* function, while the
call itself travels over a Redis-backed message queue instead of HTTP.

A service is a class with [exposed methods]({{ siteUrl }}/api/rpc/latest/rpc.expose/).
Because it describes its own signatures at runtime, [the CLI generates the typed
client for you]({{ siteUrl }}/cli/clients-and-versioning/) — so there is no schema
file, no IDL, and no hand-written SDK to keep in sync.

Because the queue name *is* the address, instances of a service compete for
messages. That removes two moving parts most microservice stacks need:
[service discovery]({{ siteUrl }}/blog/do-nodejs-backends-need-service-discovery/)
and an [internal load balancer]({{ siteUrl }}/blog/load-balancing-microservices-without-a-load-balancer/).

## Reach for it when

- Your services are **Node.js and TypeScript** and talk to each other a lot.
- You want [compile-time-safe calls]({{ siteUrl }}/blog/type-safe-service-communication-typescript/) without maintaining an IDL.
- You are [pulling a first service out of a monolith]({{ siteUrl }}/blog/monolith-to-services-first-extraction/).
- You want traffic spikes [buffered rather than cascading]({{ siteUrl }}/blog/backpressure-nodejs-services/).
- You need [delayed and scheduled calls]({{ siteUrl }}/blog/scheduled-work-without-a-job-system/) without adding a job system.

## Look elsewhere when

- Your fleet is **polyglot** — [gRPC is the better answer]({{ siteUrl }}/blog/grpc-vs-message-queue-rpc/). @imqueue is Node and TypeScript only, and ships one transport.
- The API is [public or browser-facing]({{ siteUrl }}/blog/internal-apis-dont-need-rest/), where REST or GraphQL belongs at the edge.
- Your types already span one shared TypeScript project — [tRPC's home ground]({{ siteUrl }}/blog/imqueue-vs-trpc/).
- You want a full application framework rather than a transport: [NestJS]({{ siteUrl }}/blog/imqueue-vs-nestjs/) or [Moleculer]({{ siteUrl }}/blog/imqueue-vs-moleculer/).
- You need exactly-once delivery. Delivery here is **at-least-once** in both modes — safe delivery covers the hand-off only, so [handlers must be idempotent]({{ siteUrl }}/blog/guaranteed-message-delivery-cost/).

## How it works

1. **Implement a service** — a class with exposed methods and doc-blocks.
2. **Generate the client** — services are self-describing, so clients are generated on the fly or written to files.
3. **Call it remotely** — await a client method like any local call; the queue routes it and returns the result.

## Start here

- [Get started]({{ siteUrl }}/get-started/) — install the CLI, scaffold a service, generate its client.
- [Introduction]({{ siteUrl }}/intro/) — the architecture and the principles behind it.
- [Tutorial]({{ siteUrl }}/tutorial/) — build a complete car-wash booking back-end, service by service.
- [Documentation]({{ siteUrl }}/docs/) — every section, including the CLI manual.
- [API reference]({{ siteUrl }}/api/) — generated reference for all 16 documented packages.
- [Commercial licence & support](https://imqueue.com/) — GPL-3.0 is the open-source licence; a commercial licence covers closed-source use.

## If you are an AI agent

- [/llms.txt]({{ siteUrl }}/llms.txt) indexes this site for you; [/llms-full.txt]({{ siteUrl }}/llms-full.txt) is the documentation concatenated.
- Every page is also served as plain markdown at `<page-url>index.md` — this file is the home page's.
- [/api/search-index.json]({{ siteUrl }}/api/search-index.json) resolves a symbol name to its reference page and flags deprecated members.
- [@imqueue/mcp]({{ siteUrl }}/mcp/) is an official Model Context Protocol server: docs search, service and client scaffolding, and `imq` CLI control as tools.
- [Agent recipes]({{ siteUrl }}/agents/) are procedures written for a machine — the API contract each step relies on, the commands that prove the change took effect, and the known failure modes.
