---
layout: docs.html
title: License
docLabel: LICENSE
lead: "@imqueue is free and open source under the GNU GPL-3.0. A commercial license is available for teams that cannot meet GPL's copyleft terms — for example, shipping @imqueue inside a closed-source product."
description: "@imqueue licensing explained: the whole framework is GPL-3.0 open source, with a commercial license available for closed-source and proprietary use."
keywords: "@imqueue license, imqueue GPL-3.0, GPL commercial license, dual license Node.js framework, closed-source license, copyleft, imqueue commercial licensing"
relatedTopics: [architecture]
---

[[toc]]

## Open source under GPL-3.0

Every @imqueue package — [@imqueue/core](https://www.npmjs.com/package/@imqueue/core),
[@imqueue/rpc](https://www.npmjs.com/package/@imqueue/rpc),
[@imqueue/cli](https://www.npmjs.com/package/@imqueue/cli) and the rest of the
[GitHub org](https://github.com/imqueue) — is published under the
[GNU General Public License, version 3.0](https://www.gnu.org/licenses/gpl-3.0.txt)
(GPL-3.0).

GPL-3.0 is a free-software, copyleft license. It grants you broad rights:

- **Use** the software for any purpose, **including commercially**.
- **Study** how it works and adapt it to your needs.
- **Modify** it and **distribute** your modified versions.

There is no fee, no sign-up and no usage cap for open-source use. Install it from
npm and build.

## The copyleft condition

GPL-3.0's freedoms come with one central obligation: **copyleft**. When you
*distribute* (convey) a work that is based on, incorporates or links @imqueue,
that combined work must also be licensed under GPL-3.0, and you must make its
complete corresponding **source code** available under the same terms.

In practice this means:

- Building an **open-source** project on @imqueue and releasing it under GPL-3.0
  (or a GPL-compatible license) is exactly what the license is for. Nothing extra
  to do.
- **Shipping a closed-source or proprietary product** that includes @imqueue —
  and *not* releasing that product's source under GPL-3.0 — is **not** permitted
  by the open-source license. That is where a commercial license comes in.

## When you need a commercial license

Consider a [commercial license](https://imqueue.com/license/) if any of the
following apply:

- You distribute a **proprietary / closed-source** application or appliance that
  embeds or links @imqueue and you cannot release its source under GPL-3.0.
- Your organization's policy or a customer contract **prohibits GPL / copyleft**
  dependencies in shipped products.
- You want a commercial relationship with **warranty terms, an SLA or priority
  support** behind the framework.

The commercial license removes the copyleft obligation for your product and is
offered per the terms and tiers on
**[imqueue.com/license](https://imqueue.com/license/)** and
**[imqueue.com/pricing](https://imqueue.com/pricing/)**. For anything specific to
your use case, reach us at **[support@imqueue.com](mailto:support@imqueue.com)**.

## Frequently asked

**Can I use @imqueue to build an internal or SaaS back end without a commercial
license?**
Yes. @imqueue is GPL-3.0 (not AGPL). Running it on your own servers to power a
service you operate is not *distribution*, so the copyleft source-sharing
obligation is not triggered by SaaS/back-end use. You are free to use the
open-source packages for this. A commercial license is still available if you
want warranty or support terms.

**Do I owe anything for local development, evaluation or open-source projects?**
No. Use the open-source packages freely; if your own project is GPL-compatible,
you are fully covered by GPL-3.0.

**Which packages does this cover?**
All of them — the entire @imqueue framework is GPL-3.0, and a single commercial
license covers your commercial use across the framework.

---

*This page is a plain-language summary, not legal advice. The
[full GPL-3.0 text](https://www.gnu.org/licenses/gpl-3.0.txt) and the
[GNU GPL FAQ](https://www.gnu.org/licenses/gpl-faq.html) are the authoritative
sources; consult a lawyer for your specific situation.*
