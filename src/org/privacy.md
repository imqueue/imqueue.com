---
layout: docs.html
title: "Privacy policy"
docLabel: PRIVACY
lead: "What imqueue.org and the hosted MCP endpoint at mcp.imqueue.org process, who else can see it, how long it is kept, and how to ask us to delete it. There are no accounts here and nothing to sign up for."
description: "Privacy policy for imqueue.org and the hosted @imqueue MCP server: what data is processed, the analytics and hosting providers involved, retention, and your rights."
keywords: "imqueue privacy policy, mcp.imqueue.org privacy, MCP server data handling, imqueue.org cookies, imqueue analytics"
---

**Last updated: 2 August 2026**

This policy covers the website **imqueue.org** and the hosted Model Context
Protocol endpoint **mcp.imqueue.org**. Commercial licensing and support run on a
separate site with its own policy — see
[imqueue.com/privacy/](https://imqueue.com/privacy/).

Both are run by the @imqueue maintainers —
**[Mykhailo Stadnyk](https://github.com/Mikhus)**, creator of @imqueue and the
person responsible for these sites and the hosted endpoint, with
**[Serhiy Morenko](https://github.com/SerhiyGreench)**. "We" below means them.
Questions about this policy, or a request about your data, go to
[support@imqueue.com](mailto:support@imqueue.com).

[[toc]]

## The short version

- There is **no account, no login and no payment** anywhere on imqueue.org or
  mcp.imqueue.org. We never ask you who you are.
- We do not sell data, we do not run advertising, and we do not use anything
  collected here to train machine-learning models.
- The website carries **third-party analytics**, one of which records how pages
  are used, including a replay of interactions on the page. [How to opt
  out](#cookies-and-how-to-refuse-them).
- The **hosted MCP endpoint stores nothing**. It receives your tool inputs,
  answers, and forgets. Our hosting provider keeps short-lived request logs.
- The `@imqueue/*` packages you install from npm contain **no analytics or
  telemetry code**.

## What we process and why

### Visiting the website

Serving a page means our hosting provider (Cloudflare) sees the request: your IP
address, user agent, the URL, a timestamp and the response status. That is
inherent to how the web works, and it is used to deliver the page, to cache it,
and to absorb abuse and denial-of-service traffic. We do not build profiles from
it and we have no access to a per-visitor log of it.

On top of that the pages load two analytics services:

- **Google Analytics 4** — aggregate audience measurement: which pages are read,
  which links bring people here, roughly which country and which browser.
- **Microsoft Clarity** — usage analytics with heatmaps and **session replay**: it
  records clicks, scrolling and mouse movement so a page that confuses readers can
  be found and fixed. Clarity masks text input by default, and there are no forms
  on imqueue.org to type into.

Both run on every visit and set cookies; neither is required to read the site.
See [cookies](#cookies-and-how-to-refuse-them) to switch them off.

### Automated and AI-agent traffic

imqueue.org publishes machine-readable documentation — `/llms.txt`, the per-page
`index.md` mirrors and `/api/search-index.json` — which crawlers and AI agents
fetch without running any JavaScript, so the browser analytics above never see
them. We count those requests **on the server instead**, and deliberately without
identifying anyone: the event carries the crawler family (for example `GPTBot`,
`ClaudeBot`), which surface was fetched and the response status.

**No IP address and no fingerprint is sent, stored or hashed** — the identifier is
derived from the crawler family alone, so every request from every GPTBot instance
worldwide looks like the same visitor. You can see exactly what is happening for
any request you make:

```bash
curl -sI -A 'GPTBot/1.2' https://imqueue.org/llms.txt | grep x-agent-analytics
```

### Using the hosted MCP server

`mcp.imqueue.org` is a public, unauthenticated MCP endpoint. It runs the
documentation-search and code-scaffolding tools of [`@imqueue/mcp`](/mcp/) at the
edge.

**What it receives** is whatever your AI client sends as tool input: a search
query, a documentation URL to fetch, or the service and method names you ask it to
scaffold. **What it does with it**: answers the call. Each request is handled by a
fresh, stateless instance — there are no sessions, no database and no storage
attached to it, so nothing you send is retained by us, and nothing is used to train
anything.

Our hosting provider records an invocation log for each request (timing, URL,
status and any diagnostic output) with the retention that applies to our plan; we
do not copy it anywhere else. Because that log exists, and because your prompt
reaches a third party the moment your AI client calls any remote tool, **do not put
secrets, credentials or personal data into tool inputs**. If that matters for your
work, run the server locally instead — `npx -y @imqueue/mcp` keeps everything on
your own machine and fetches only public documentation pages. See the [safety
model](/mcp/security/).

### The npm packages

The published `@imqueue/*` packages contain no analytics or telemetry. Nothing
phones home. The local MCP server's only outbound network access is to
`imqueue.org` for documentation, and its `get_doc` tool is locked to that host in
code.

npm itself records package downloads; that is npm's processing under
[their privacy policy](https://docs.npmjs.com/policies/privacy), not ours, and we
only ever see the aggregate counters they publish.

### Contacting us

If you email [support@imqueue.com](mailto:support@imqueue.com), or open a GitHub
issue, we process what you send in order to answer it. GitHub issues are
**public** — anything you paste into one is visible to everyone, so send anything
sensitive by email instead. Security reports have [their own private
channel](https://github.com/imqueue/mcp/security/policy).

The donate button in the footer links to PayPal. We receive no data from it beyond
what PayPal shows us about a donation; if you use it, PayPal's own policy governs
that payment.

## Who else sees your data

We use these providers. We have no other recipients: no data brokers, no
advertising networks, no resale of any kind.

| Provider | What they do | What they see |
|---|---|---|
| [Cloudflare](https://www.cloudflare.com/privacypolicy/) | Hosting, CDN and edge functions | Request metadata — IP address, user agent, URL, timestamp, response status |
| [Google Analytics 4](https://policies.google.com/privacy) | Aggregate audience measurement | Page views, referrer, approximate location, device and browser, cookie id |
| [Microsoft Clarity](https://privacy.microsoft.com/privacystatement) | Usage analytics, heatmaps and session replay | Clicks, scrolls, mouse movement and a recording of page interaction |

All of them are US-headquartered and may process data outside your country; each
relies on its own transfer safeguards, described in the policy linked above.

## Cookies and how to refuse them

We set no cookies of our own — no preference cookie, no session cookie, nothing
that identifies you between visits. The only cookies on imqueue.org come from the
two analytics services:

| Cookie | Set by | Purpose |
|---|---|---|
| `_ga`, `_ga_*` | Google Analytics | Distinguishes visitors and sessions for aggregate counts |
| `_clck`, `_clsk` | Microsoft Clarity | Ties page interactions together into one recorded session |

To refuse them:

- **Block them in your browser.** Every current browser can block third-party
  cookies or all cookies for a site; the site works fine without them.
- **Google Analytics opt-out** — install the
  [official opt-out add-on](https://tools.google.com/dlpage/gaoptout), which stops
  GA4 on every site.
- **Microsoft Clarity** — block `clarity.ms` in your browser or a content blocker,
  and see the
  [Microsoft privacy statement](https://privacy.microsoft.com/privacystatement)
  for their own controls.
- **Any tracker blocker** (uBlock Origin, Privacy Badger, Brave's shields,
  Safari's protections) already stops both.

Blocking analytics changes nothing about what the site serves you.

## How long we keep things

| What | Kept for |
|---|---|
| Cloudflare request logs and MCP invocation logs | Short-lived, per our hosting plan's retention; not copied out |
| Google Analytics data | Per the property's retention setting, aggregated thereafter |
| Microsoft Clarity recordings | Per Clarity's own retention (a small number of months) |
| Agent-traffic events | Indefinitely, but they identify a crawler family — never a person |
| Emails you send us | As long as needed to answer, then as ordinary business correspondence |
| MCP tool inputs | Not retained |

## Your rights

If you are in the UK, EU/EEA or another region with comparable law, you have the
right to **access** the personal data we hold about you, to have it **corrected**
or **erased**, to **restrict** or **object to** its processing, to
**portability**, and to **withdraw consent** where processing relies on it. You
can also **complain to your data-protection supervisory authority**.

In practice there is usually very little to act on: without accounts we hold no
profile of you, and the honest answer to a deletion request will often be that we
never had anything under your name. Where we do — an email thread, for example —
write to [support@imqueue.com](mailto:support@imqueue.com) and we will act on it.
For analytics data held by Google or Microsoft, the opt-outs above stop collection
at source, and their own privacy dashboards handle deletion.

Our legal basis for the processing described here is our **legitimate interest** in
operating, securing and improving a free documentation site and service, and — for
anything you send us — **your request** that we respond to it.

## Children

Nothing here is directed at children, and we do not knowingly collect data from
anyone under 16. This is developer documentation for a server-side framework.

## Changes to this policy

If we change what we process, we update this page and the *Last updated* date
above. This page is version-controlled like everything else, so the
[site's commit history](https://github.com/imqueue) shows exactly what changed and
when.

## Contact

Questions about this policy, or about anything on this page:
[support@imqueue.com](mailto:support@imqueue.com).

Related: [Terms of use](/terms/) · [Support](/support/) ·
[MCP safety model](/mcp/security/) ·
[imqueue.com privacy policy](https://imqueue.com/privacy/)
