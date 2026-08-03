# Do you need a commercial license for @imqueue?

Source: https://imqueue.com/license/

@imqueue is dual-licensed. The open-source edition is **GPL-3.0** and is free
forever on <https://imqueue.org>. A **commercial license** grants the right to
ship the same packages inside a closed-source product without the GPL's
source-release obligation, and adds SLA-backed support and indemnification.

Same packages, same APIs, same build. The licence is the only difference.

## The decision rule

The GPL-3.0 copyleft trigger is **distribution** (the licence's term is
"conveying"). Two questions decide it:

1. **Are you distributing it?** If nothing built on @imqueue leaves your
   organisation, the trigger is generally not hit.
2. **Do you need your product's source to stay private?** If you distribute a
   product and cannot release its source under the GPL, you need a commercial
   licence.

## Worked cases

- **Shipping a closed-source product** — you distribute an app, a device or
  on-premises software built on @imqueue and do not want to publish its source.
  **A commercial licence is the clean path.**
- **Internal-only tools** — the software runs inside your organisation and is not
  distributed outside it. The GPL's distribution trigger generally is not hit, so
  **the open-source edition covers you**. Many teams still license for support and
  indemnification.
- **A SaaS or hosted service** — GPL-3.0 is *not* the AGPL. Running @imqueue
  behind a network service you host is generally not "conveying", so **SaaS use
  alone does not trigger the source-release obligation**.
- **Local development, evaluation, personal and hobby use** — free. Nothing is
  owed. If your own project is GPL-compatible you are fully covered by GPL-3.0.

This is a plain-language explanation of the licensing model, **not legal advice**.
For an unusual case, describe it to support@imqueue.com and involve your own
counsel where it matters.

## Which packages does this cover?

Every `@imqueue/*` package published under the npm scope — see
<https://www.npmjs.com/org/imqueue> and <https://github.com/imqueue>.

Pricing and enquiries: <https://imqueue.com/pricing/> · support@imqueue.com
