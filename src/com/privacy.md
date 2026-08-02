---
layout: docs.html
title: "Privacy policy"
lead: "What imqueue.com does with the details you send through the licensing enquiry form, what the site's analytics collect, who else can see any of it, and how to have it deleted."
description: "Privacy policy for imqueue.com: how commercial licensing enquiries are handled, which analytics and email providers are involved, retention periods, and your rights."
keywords: "imqueue privacy policy, imqueue.com privacy, commercial licence enquiry data, imqueue contact form privacy"
---

**Last updated: 2 August 2026**

This policy covers **imqueue.com** — the commercial licensing and support site for
@imqueue. The open-source documentation site and the hosted MCP endpoint are
covered separately at
[imqueue.org/privacy/](https://imqueue.org/privacy/).

Both are run by the @imqueue maintainers —
**[Mykhailo Stadnyk](https://github.com/Mikhus)**, creator of @imqueue and the
person responsible for this site and for answering what you send through it,
with **[Serhiy Morenko](https://github.com/SerhiyGreench)**. "We" below means
them. Questions about this policy, or a request about your data, go to
[support@imqueue.com](mailto:support@imqueue.com).

[[toc]]

## The short version

- The only personal data we ask for is what you type into the **licensing enquiry
  form** — and it goes straight to our mailbox so we can reply.
- There is **no account, no login, and no payment taken on this website**.
- We do not sell data, we do not run advertising, and we do not use anything
  collected here to train machine-learning models.
- The site carries **third-party analytics**, one of which records page
  interaction. [How to opt out](#cookies-and-how-to-refuse-them).

## The licensing enquiry form

The form on the [pricing page](/pricing/) is how you start a conversation about a
commercial license or support. When you submit it we receive:

| Field | Required |
|---|---|
| Type of use — business or personal | yes |
| Your name | yes |
| Your email address | yes |
| Company | required for business use |
| Number of developers | optional |
| Phone number | optional |
| How you found us | optional |
| The page you submitted from | added automatically |

The form also contains one hidden field that is invisible to you. It is a spam
trap: automated submissions fill it in, humans never do, and anything that fills it
is silently discarded.

**What happens to it.** The submission is emailed to
[support@imqueue.com](mailto:support@imqueue.com) through our email provider
(Resend), with your address set as the reply-to so we can answer you directly. We
store it in **no database** — there is no CRM behind this form and no marketing
list. It lives in our mailbox, as ordinary business correspondence, for as long as
the relationship or our record-keeping obligations require.

**Why we may process it.** To take the steps you asked for by contacting us
(pre-contractual communication), and thereafter our legitimate interest in keeping a
record of business correspondence.

**What we will not do with it.** No newsletter, no drip campaign, no sharing or
selling to anyone. If you only want a price, you get a reply about a price.

You can skip the form entirely and email
[support@imqueue.com](mailto:support@imqueue.com) instead — same mailbox, same
handling.

## Visiting the site

Serving a page means our hosting provider (Cloudflare) sees the request: your IP
address, user agent, the URL, a timestamp and the response status. That is inherent
to how the web works, and it is used to deliver the page, cache it, and absorb
abuse. We do not build profiles from it.

The pages also load two analytics services:

- **Google Analytics 4** — aggregate audience measurement: which pages are read,
  which links bring people here, roughly which country and browser.
- **Microsoft Clarity** — usage analytics with heatmaps and **session replay**: it
  records clicks, scrolling and mouse movement so pages that confuse readers can be
  found and fixed. Clarity **masks text typed into form fields by default and we
  have not turned that off**, so what you enter into the enquiry form is not part of
  a recording. The same Clarity project covers both imqueue.com and imqueue.org.

Both run on every visit and set cookies; neither is needed to read the site or to
use the form. See [cookies](#cookies-and-how-to-refuse-them) to switch them off.

## No payments on this site

We take no card details, bank details or any other payment data through this
website. Pricing is agreed in conversation and invoiced separately — so there is no
payment processor in the picture here, and nothing for us to store.

## Who else sees your data

We use these providers. We have no other recipients: no data brokers, no
advertising networks, no resale of any kind.

| Provider | What they do | What they see |
|---|---|---|
| [Cloudflare](https://www.cloudflare.com/privacypolicy/) | Hosting, CDN and edge functions | Request metadata — IP address, user agent, URL, timestamp, response status |
| [Resend](https://resend.com/legal/privacy-policy) | Delivers the enquiry form to our mailbox | Everything you type into the form, plus your email address as reply-to |
| [Google Analytics 4](https://policies.google.com/privacy) | Aggregate audience measurement | Page views, referrer, approximate location, device and browser, cookie id |
| [Microsoft Clarity](https://privacy.microsoft.com/privacystatement) | Usage analytics, heatmaps and session replay | Clicks, scrolls, mouse movement and a recording of page interaction |

All of them are US-headquartered and may process data outside your country; each
relies on its own transfer safeguards, described in the policy linked above.

## Cookies and how to refuse them

We set no cookies of our own. The only cookies on imqueue.com come from the two
analytics services:

| Cookie | Set by | Purpose |
|---|---|---|
| `_ga`, `_ga_*` | Google Analytics | Distinguishes visitors and sessions for aggregate counts |
| `_clck`, `_clsk` | Microsoft Clarity | Ties page interactions together into one recorded session |

To refuse them: block cookies for this site in your browser, install the
[Google Analytics opt-out add-on](https://tools.google.com/dlpage/gaoptout), block
`clarity.ms`, or use any tracker blocker — all of which already stop both. The site
and the enquiry form work normally either way.

## How long we keep things

| What | Kept for |
|---|---|
| Enquiry-form emails | As long as the enquiry or relationship needs, then as business correspondence |
| Resend delivery logs | Per Resend's own retention |
| Cloudflare request logs | Short-lived, per our hosting plan's retention |
| Google Analytics data | Per the property's retention setting, aggregated thereafter |
| Microsoft Clarity recordings | Per Clarity's own retention (a small number of months) |

## Your rights

If you are in the UK, EU/EEA or another region with comparable law, you have the
right to **access** the personal data we hold about you, to have it **corrected** or
**erased**, to **restrict** or **object to** its processing, to **portability**, and
to **withdraw consent** where processing relies on it. You can also **complain to
your data-protection supervisory authority**.

To exercise any of these, email
[support@imqueue.com](mailto:support@imqueue.com) — for a form submission, saying
roughly when you sent it is enough for us to find and delete it. For analytics data
held by Google or Microsoft, the opt-outs above stop collection at source and their
own privacy dashboards handle deletion.

## Children

This site is aimed at businesses evaluating a developer framework. It is not
directed at children and we do not knowingly collect data from anyone under 16.

## Changes to this policy

If we change what we process, we update this page and the *Last updated* date above.
This page is version-controlled, so the
[commit history](https://github.com/imqueue) shows exactly what changed and when.

## Contact

[support@imqueue.com](mailto:support@imqueue.com).

Related: [Terms of use](/terms/) · [Support](/support/) ·
[Licensing](/license/) ·
[imqueue.org privacy policy](https://imqueue.org/privacy/)
