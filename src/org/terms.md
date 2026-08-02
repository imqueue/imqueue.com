---
layout: docs.html
title: "Terms of use"
docLabel: TERMS
lead: "The terms for using this website and the hosted MCP endpoint at mcp.imqueue.org. These cover the site and the service — the software itself is licensed separately under GPL-3.0."
description: "Terms of use for imqueue.org and the hosted @imqueue MCP server: acceptable use, availability, no warranty, and how these terms relate to the GPL-3.0 software license."
keywords: "imqueue terms of use, mcp.imqueue.org terms, MCP server acceptable use, imqueue.org terms and conditions"
---

**Last updated: 2 August 2026**

These terms apply to the website **imqueue.org** and the hosted Model Context
Protocol endpoint **mcp.imqueue.org**. @imqueue is an open-source project rather than a
company: both are run by **[Mykhailo Stadnyk](https://github.com/Mikhus)**, its creator
and owner, with **[Serhiy Morenko](https://github.com/SerhiyGreench)** as its most active
maintainer ("we", "us"). By using either, you accept these terms. If you do not, please
do not use them — everything here is optional and free.

[[toc]]

## What these terms are not

**They are not the software license.** The `@imqueue/*` packages are open source
under **GPL-3.0**, and your rights to the code come from that license alone —
nothing on this page adds to it or takes anything away. See
[the licensing page](/license/), or
[imqueue.com](https://imqueue.com/license/) if you need a commercial license for
closed-source distribution.

They are also not a support contract. Community help is best-effort — see
[Support](/support/).

## Using the website

The documentation is here to be read, quoted and linked to. You may quote it with
attribution, and you are welcome to point AI coding agents at the machine-readable
feeds we publish for exactly that purpose (`/llms.txt`, the per-page `index.md`
mirrors, `/api/search-index.json`). Wholesale republication of the documentation as
your own is not permitted.

Text, images and site design are © their authors, all rights reserved except as
stated above. Code samples in the documentation are yours to use freely, in any
project, under any license.

## Using the hosted MCP endpoint

`mcp.imqueue.org` is offered free, with no account and no authentication, as a
convenience for trying the [`@imqueue/mcp`](/mcp/) server without installing
anything. In return we ask for reasonable behaviour:

- **Use it at a human pace.** It is sized for interactive use by AI coding agents,
  not for bulk scraping, load generation or as a backend for your own product.
- **Do not attack it** — no attempts to overload it, to break out of it, to probe
  for vulnerabilities without [reporting them
  properly](https://github.com/imqueue/mcp/security/policy), or to use it as a step
  in attacking anyone else.
- **Do not send secrets.** Tool inputs travel over the public internet to a
  third-party edge platform and appear in short-lived hosting logs. See the
  [privacy policy](/privacy/#using-the-hosted-mcp-server) and the
  [safety model](/mcp/security/).

We may rate-limit, block or withdraw access at any time to keep the service
healthy, and we may change or remove the tools it offers. If you need guarantees,
run the server locally — that is the supported way to depend on it:

```bash
npx -y @imqueue/mcp
```

## What the tools produce

The scaffolding tools generate **illustrative code** from a template. It is a
starting point, not audited production code: read it, test it, and take
responsibility for anything you ship. The documentation-search tools return
whatever our documentation currently says; documentation can lag behind a release,
and the authoritative answer is always the package source.

You own whatever you build. We claim no rights over the code these tools generate
for you.

## Availability

Both the site and the endpoint are provided **as-is and as-available**, with no
uptime commitment, no SLA and no promise that either will continue to exist. We run
them on a best-effort basis and may take them down, move them or change them
without notice. A commercial agreement is the way to get guarantees — see
[imqueue.com](https://imqueue.com/support/).

## No warranty

To the fullest extent permitted by law, the site, the endpoint and everything they
return are provided **without warranty of any kind**, express or implied, including
merchantability, fitness for a particular purpose, accuracy and non-infringement.

## Limitation of liability

To the fullest extent permitted by law, we are not liable for any indirect,
incidental, special, consequential or exemplary damages, nor for lost profits, lost
data, or business interruption, arising from your use of the site or the endpoint —
including from code produced by the scaffolding tools or decisions made on the
strength of the documentation. Nothing here excludes liability that cannot lawfully
be excluded.

## Third-party links and services

We link to GitHub, npm, PayPal and other services we do not control. Their terms
and privacy policies govern your use of them, not these.

## Changes

We may update these terms; the *Last updated* date above moves when we do, and the
[commit history](https://github.com/imqueue) shows exactly what changed. Continuing
to use the site or the endpoint after a change means you accept it.

## Governing law

These terms are governed by the laws of the **Slovak Republic**, where the person who
runs these sites is resident, and the Slovak courts have jurisdiction over any dispute
arising from them — without prejudice to any mandatory consumer protections available to
you where you live, which nothing here can take away.

## Contact

[support@imqueue.com](mailto:support@imqueue.com).

Related: [Privacy policy](/privacy/) · [Support](/support/) ·
[License](/license/) · [imqueue.com terms](https://imqueue.com/terms/)
