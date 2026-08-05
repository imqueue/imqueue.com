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

@imqueue is an open-source project, not a company — there is no legal entity behind
these sites, and so no company name or registration number to give you.
**[Mykhailo Stadnyk](https://github.com/Mikhus)**, its creator and owner, runs them and
is the **data controller** for everything described here; he is the person to ask about
any of it. **[Serhiy Morenko](https://github.com/SerhiyGreench)** is the project's most
active maintainer. "We" below means them.

Questions about this policy, or a request about your data, go to
[support@imqueue.com](mailto:support@imqueue.com) and reach him directly. He is resident
in the **Slovak Republic**; a postal address is available on request but is not published
here, because without a company it would be a private home address.

[[toc]]

## The short version

- There is **no account, no login and no payment** anywhere on imqueue.org or
  mcp.imqueue.org. We never ask you who you are.
- We do not sell data, we do not run advertising, and we do not use anything
  collected here to train machine-learning models.
- The website offers **third-party analytics**, one of which records how pages are
  used — but **nothing loads until you accept it**. Decline, or simply ignore the
  bar, and no analytics script runs and no cookie is set.
  [How that works](#cookies-and-how-to-refuse-them).
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

On top of that the pages *offer* two analytics services — neither of which runs
unless you have accepted them:

- **Google Analytics 4** — aggregate audience measurement: which pages are read,
  which links bring people here, roughly which country and which browser. It also
  receives **what you type into the site's search box**, with the number of results
  it returned, because a search that finds nothing is how we learn which page is
  missing. The search itself runs entirely in your browser — the whole index is
  downloaded and queried locally, so the query is never *needed* on a server; the
  measurement is the only thing that leaves your machine, and it does not leave it
  at all unless you have accepted analytics.
- **Microsoft Clarity** — usage analytics with heatmaps and **session replay**: it
  records clicks, scrolling and mouse movement so a page that confuses readers can be
  found and fixed. Clarity **masks text typed into form fields by default and we have
  not turned that off**, so what you write in the [contact form](#the-contact-form) is
  not part of a recording — and it never loads at all unless you tick session replay.

Neither is required to read the site, and neither is loaded until you say yes —
see [cookies](#cookies-and-how-to-refuse-them).

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

### The contact form

The form on [/contact/](/contact/) is the one place on imqueue.org where you type
anything about yourself. When you submit it we receive:

| Field | Required |
|---|---|
| Your name | yes |
| Your email address | yes |
| Subject | yes |
| Message | yes |
| Attachments — up to 3 files, 5 MB total | optional |
| The page you submitted from | added automatically |

It also carries one hidden field you never see. It is a spam trap: automated
submissions fill it in, humans do not, and anything that fills it is silently
discarded.

**What happens to it.** The message is emailed to
[support@imqueue.com](mailto:support@imqueue.com) through our email provider
(Resend), with your address as the reply-to so we can answer you. Attachments travel
with it. We store it in **no database** — there is no ticketing system, no CRM and no
mailing list behind this form. It lives in our mailbox for as long as answering you,
and any follow-up, needs.

**Why we may process it.** Because you asked us to answer you. Nothing you send here
is used for anything else, and you will never be added to a list.

Please don't paste credentials, connection strings or customer data into it — the same
advice as for tool inputs above, for the same reason. Attachments are limited to
images, text files and PDFs.

### Emailing us or opening an issue

If you email [support@imqueue.com](mailto:support@imqueue.com) directly, or open a
GitHub issue, we process what you send in order to answer it. GitHub issues are
**public** — anything you paste into one is visible to everyone, so send anything
sensitive by email instead. Security reports have [their own private
channel](https://github.com/imqueue/mcp/security/policy).

## Who else sees your data

We use these providers. We have no other recipients: no data brokers, no
advertising networks, no resale of any kind.

| Provider | What they do | What they see |
|---|---|---|
| [Cloudflare](https://www.cloudflare.com/privacypolicy/) | Hosting, CDN and edge functions | Request metadata — IP address, user agent, URL, timestamp, response status |
| [Resend](https://resend.com/legal/privacy-policy) | Delivers the contact form to our mailbox | Everything you type into it, any attachments, and your address as reply-to |
| [Google Analytics 4](https://policies.google.com/privacy) | Aggregate audience measurement — **only if you allow it** | Page views, referrer, approximate location, device and browser, cookie id |
| [Microsoft Clarity](https://privacy.microsoft.com/privacystatement) | Session replay and heatmaps — **only if you allow it** | Clicks, scrolls, pointer movement and a recording of page interaction |

All of them are US-headquartered and may process data outside your country; each
relies on its own transfer safeguards, described in the policy linked above.

## Cookies and how to refuse them

**Nothing non-essential is set before you agree.** On your first visit a bar at the
bottom of the page asks, with two equally-weighted buttons:

- **Allow all** — both scripts load and set the cookies below.
- **Decline all** — nothing loads and nothing is set. That is also what happens if you
  ignore the bar entirely, close the tab, or browse with JavaScript disabled: the tags
  are written into the page in a form the browser will not execute, and only your
  acceptance converts them into real scripts.
- **Customise** — the two are separate consents and you can allow either on its own:

  | Choice | What it turns on |
  |---|---|
  | Usage analytics | Google Analytics — which pages get read, counted in aggregate |
  | Session replay | Microsoft Clarity — a recording of your clicks, scrolling and pointer movement |

  Ticking usage analytics does **not** start session replay. Each has its own tag and
  its own cookies, and withdrawing one leaves the other alone.

The choice is remembered in your browser's `localStorage` under `imqueue-consent`,
not in a cookie, so a declining visit leaves this site with **no cookies at all**.
You are asked once; **"Cookie settings"** in the footer of every page reopens the bar
whenever you want to change your mind. Withdrawing consent expires the first-party
analytics cookies immediately and reloads the page so nothing keeps running.

We set no cookies of our own — no preference cookie, no session cookie, nothing that
identifies you between visits. Everything below belongs to the analytics services
and appears only after you accept:

| Cookie | Set by | Purpose |
|---|---|---|
| `_ga`, `_ga_*` | Google Analytics | Distinguishes visitors and sessions for aggregate counts |
| `_clck`, `_clsk` | Microsoft Clarity | Ties page interactions together into one recorded session |

Belt and braces, if you would rather not rely on us:

- **Block them in your browser.** Every current browser can block third-party
  cookies or all cookies for a site; the site works fine without them.
- **Google Analytics opt-out** — install the
  [official opt-out add-on](https://tools.google.com/dlpage/gaoptout), which stops
  GA4 on every site.
- **Microsoft Clarity** — block `clarity.ms` in your browser or a content blocker,
  and see the
  [Microsoft privacy statement](https://privacy.microsoft.com/privacystatement)
  for their own controls. Clarity can also set cookies on its own domain, which our
  withdrawal cleanup cannot reach — a browser-side block or clear does.
- **Any tracker blocker** (uBlock Origin, Privacy Badger, Brave's shields,
  Safari's protections) already stops both.

Declining changes nothing about what the site serves you. There is no reduced
version of these docs, no repeated nagging, and no feature behind a yes.

## How long we keep things

| What | Kept for |
|---|---|
| Cloudflare request logs and MCP invocation logs | Short-lived, per our hosting plan's retention; not copied out |
| Google Analytics data | Per the property's retention setting, aggregated thereafter |
| Microsoft Clarity recordings | Per Clarity's own retention (a small number of months) |
| Agent-traffic events | Indefinitely, but they identify a crawler family — never a person |
| Contact-form messages and attachments | As long as answering you and any follow-up needs |
| Resend delivery logs | Per Resend's own retention |
| Emails you send us | As long as needed to answer, then as ordinary business correspondence |
| MCP tool inputs | Not retained |

## Your rights

If you are in the UK, EU/EEA or another region with comparable law, you have the
right to **access** the personal data we hold about you, to have it **corrected**
or **erased**, to **restrict** or **object to** its processing, to
**portability**, and to **withdraw consent** where processing relies on it. You
can also **complain to a data-protection supervisory authority** — either the one for
where you live, or ours: the Slovak
[Úrad na ochranu osobných údajov](https://dataprotection.gov.sk/), since the controller
is resident in the Slovak Republic.

In practice there is usually very little to act on: without accounts we hold no
profile of you, and the honest answer to a deletion request will often be that we
never had anything under your name. Where we do — an email thread, for example —
write to [support@imqueue.com](mailto:support@imqueue.com) and we will act on it.
For analytics data held by Google or Microsoft, the opt-outs above stop collection
at source, and their own privacy dashboards handle deletion.

**Withdrawing consent** takes one click: **"Cookie settings"** in the footer, then
Decline. It is as easy to take back as it was to give, and refusing costs you
nothing.

Our legal bases are: **your consent** for the analytics described above (freely
given, and withdrawable at any time from the footer); **legitimate interest** in
operating and securing a free documentation site and service, which covers the
hosting logs and the crawler-family counters that carry no personal data; and —
for anything you send us — **your request** that we respond to it.

### If you are in California

We do not sell your personal information, and we do not share it for cross-context
behavioural advertising — under the CCPA/CPRA definitions of those words, neither
happens here, so there is no "Do Not Sell or Share My Personal Information" process
to run. There is no advertising on this site, no ad network, no data broker, and no
profiling.

You still have the right to know what is collected and why (this page), to request
deletion or correction, to limit the use of sensitive personal information (we
collect none), and not to be discriminated against for exercising any of it — the
site behaves identically whether you accept or decline. Declining the analytics bar,
or sending a browser Global Privacy Control signal that your tracker blocker
enforces, achieves the opt-out. To exercise anything else, email
[support@imqueue.com](mailto:support@imqueue.com); we will verify a request only to
the extent of matching it to whatever we actually hold, which is usually nothing.

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
