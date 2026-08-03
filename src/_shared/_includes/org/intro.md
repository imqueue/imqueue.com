{%- comment -%}
Kept in step with src/org/intro/index.html BY HAND — this is one of the three
authored mirrors the README warns about. Both now lead with site.definition, so
neither can reintroduce the 2018 "An Inter-Communication Messaging Queue framework
for SOA back-ends." phrasing that used to be the site's most-repeated definition.
{%- endcomment -%}
# {{ site.definitionShort }}

Source: {{ siteUrl }}/intro/

Services describe themselves at runtime, so their typed clients are generated, not
written. The name is short for **I**nter-Communication **M**essaging **Queue** — @imqueue,
imqueue and IMQ all refer to this framework. It is built with Node.js and
TypeScript for service-oriented back-ends (microservices being a special case of
SOA), works well behind an API layer such as GraphQL or a REST gateway, and lets you
write only the functionality while @imqueue handles the low-level messaging.

## @imqueue at a glance

{% include "at-a-glance.md" %}

## Key capabilities

- **@imqueue/core** — messaging queue as the base communication protocol between services. [Reference]({{ siteUrl }}/api/core/latest/)
- **@imqueue/rpc** — an RPC-like programming interface over the messaging queue. [Reference]({{ siteUrl }}/api/rpc/latest/)
- **@imqueue/cli** — a rapid application development command line interface. [Manual]({{ siteUrl }}/cli/)

Thirteen more packages cover caching, observability, API composition, background
work and hardening — all with generated references under [/api/]({{ siteUrl }}/api/).

## Key principles

- **Reliable.** Safe-delivery messaging re-queues a message a dying worker never
  started, rather than losing it with the process. The guarantee covers that
  hand-off: delivery is
  [at-least-once]({{ siteUrl }}/api/core/latest/core.imqoptions.safedelivery/), so
  handlers should be idempotent.
- **Scalable.** Cluster the backend engine, fork across a machine's cores, and scale
  horizontally across servers — throughput grows with the workers you add, and
  [what that looks like on one rig is measured here]({{ siteUrl }}/blog/benchmarking-imqueue-throughput/).
- **Simple (KISS).** Low entry for JS/TypeScript developers — minutes to your first
  service. No hidden knowledge, a clean JSON-based protocol, and familiar patterns
  (Messaging Queue and RPC).
- **Self-describing.** Every service describes itself, so clients are generated
  dynamically on the fly or pre-generated to files. You focus only on the service.

## How it works

### A centralized broker

IMQ implements a messaging queue over a broker (Redis today, adapters are
pluggable) that routes messages between services and their clients. All messages
flow through a single point, so monitoring and debugging use the tooling the broker
already gives you.

No service discovery to implement — instances compete for their messages. If one is
busy or down, another consumes the message and delivers the response anyway.
Load-balancing happens naturally, with good distribution across nodes.

### Service & client model

From a development point of view a service is as simple as a class with exposed
methods. A client is a local representation of that remote service's interface.

Call a client method and it takes care of delivering the message to the queue,
invoking the matching service method, and returning the result. At development level
it simply looks like remote procedure calls — and clients are generated for you, so
you focus only on the service.

## Next

- [Get started in a few minutes]({{ siteUrl }}/get-started/)
- [Tutorial]({{ siteUrl }}/tutorial/) — a complete example application
- [Documentation]({{ siteUrl }}/docs/) — every section
