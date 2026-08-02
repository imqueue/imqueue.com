---
layout: docs.html
title: "Support"
docLabel: SUPPORT
lead: "How to get help with @imqueue: where to ask, which repository to file an issue in, how to report a security problem privately, and what to expect for a response."
description: "Support for @imqueue — community help through GitHub issues and email, private security reporting, and SLA-backed commercial support for production teams."
keywords: "imqueue support, imqueue help, report imqueue bug, imqueue github issues, MCP server support, imqueue security report"
---

**Free community support** is available to everyone through the channels below.
Teams that need guaranteed response times can add
[commercial support](https://imqueue.com/support/) on top.

[[toc]]

## Start with the documentation

Most questions are answered on this site:

- **[Get started](/get-started/)** — install and run your first service.
- **[Tutorial](/tutorial/)** — build a working service and a typed client end to end.
- **[CLI manual](/cli/)** — every `imq` command and flag.
- **[API reference](/api/)** — every exported symbol of every documented package.
- **[MCP server](/mcp/)** — let your AI coding assistant read these docs directly.

Using an AI assistant? Point it at **[imqueue.org/llms.txt](/llms.txt)** or connect
the [MCP server](/mcp/installation/) and it can search all of the above for you.

## Ask a question or report a bug

Everything is on GitHub under the
**[@imqueue organization](https://github.com/imqueue)**, and issues are the right
place for both questions and bugs. **File in the repository of the package you are
using** — that is where the people who maintain it are looking:

| If it concerns | File it in |
|---|---|
| Typed RPC, services, `@expose()`, generated clients | [imqueue/rpc](https://github.com/imqueue/rpc/issues) |
| The Redis-backed queue engine | [imqueue/core](https://github.com/imqueue/core/issues) |
| The `imq` CLI, scaffolding, fleet control | [imqueue/cli](https://github.com/imqueue/cli/issues) |
| The MCP server, hosted or local | [imqueue/mcp](https://github.com/imqueue/mcp/issues) |
| Any other package | its own repository — the `repository` field in its `package.json` |
| A documentation page | the repository of the package the page documents |

A good report gets a faster answer. Please include:

- the **package and version** (`npm ls @imqueue/rpc`), plus your **Node.js version**;
- what you expected and what happened instead, with the **actual error and stack**;
- the **smallest** code that reproduces it.

Prefer email? [support@imqueue.com](mailto:support@imqueue.com) reaches the
maintainers directly. Note that GitHub issues are public — do not paste
credentials, internal hostnames or customer data into one.

## Reporting a security vulnerability

**Please do not open a public issue for a security problem.** Use either private
channel:

- **GitHub** — *Security → Report a vulnerability* on the affected repository, which
  opens a private advisory (for example,
  [imqueue/mcp](https://github.com/imqueue/mcp/security/policy)).
- **Email** — [support@imqueue.com](mailto:support@imqueue.com) with the affected
  package and version, the impact, and steps to reproduce.

We aim to acknowledge a report within a few business days and will coordinate a fix
and a disclosure timeline with you.

## The hosted MCP endpoint

For problems with **`mcp.imqueue.org`** specifically — a tool returning an error, a
client failing to connect, the endpoint being unreachable — open an issue in
[imqueue/mcp](https://github.com/imqueue/mcp/issues) with the tool name, the
arguments you sent and the response you got.

It is a free, best-effort service with no uptime commitment. If a build depends on
it, install the server locally instead — that is the supported configuration:

```bash
npx -y @imqueue/mcp
```

See [installation](/mcp/installation/) for your client's config, and the [safety
model](/mcp/security/) for what each mode can and cannot touch.

## What to expect

Community support is **best-effort**, from maintainers who also write the code.
There is no SLA and no guaranteed response time: most issues get a first reply
within a few days, and a reproducible bug report is far more likely to get a quick
one than a question we cannot reproduce.

If that is not enough for your situation — production-critical systems, procurement
that needs an accountable vendor, a migration you want reviewed —
**[commercial support](https://imqueue.com/support/)** adds guaranteed response
times, a private channel to the maintainers, prioritized fixes and indemnification.

## Contributing

Fixes are welcome, and a pull request is often the fastest route to a resolved
issue. See [Contributing](/contributing/) for how to propose one and for the
contribution terms.

Related: [Privacy policy](/privacy/) · [Terms of use](/terms/) ·
[License](/license/) · [Commercial support](https://imqueue.com/support/)
