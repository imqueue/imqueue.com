# imqueue.org / imqueue.com

The @imqueue websites. One Eleventy project builds **two editions** from the same
source tree:

| Edition | Domain | Skin | Output | What it is |
|---|---|---|---|---|
| `org` (default) | [imqueue.org](https://imqueue.org/) | Terminal | `_site-org/` | Open-source docs, tutorial, CLI & MCP manuals, generated API reference, blog |
| `com` | [imqueue.com](https://imqueue.com/) | Flux | `_site-com/` | Commercial licensing, pricing, support |

`EDITION` picks one. Shared templates live in `src/_shared/`; each edition's own
pages live in `src/org/` and `src/com/`, and Eleventy ignores the other one.

## Local development

**Clone with submodules.** The search ranker is its own repo
([imqueue/search-ranker](https://github.com/imqueue/search-ranker)), pinned here at
`vendor/search-ranker` and pinned identically by the `@imqueue/mcp` server, so the site
and the MCP tool cannot answer the same query differently. A plain `git clone` leaves that
directory empty and the build stops with the fix in the message — deliberately, because the
alternative is a site that builds cleanly and ships no `search.js` at all.

```bash
git clone --recurse-submodules https://github.com/imqueue/imqueue.com.git
# already cloned?
git submodule update --init
```

```bash
npm install
npm run serve:org   # imqueue.org — http://localhost:8080
npm run serve:com   # imqueue.com — http://localhost:8081
```

To change the ranker, edit `vendor/search-ranker/search.js`, measure with
`npm run kpi:compare` (never by the summary alone — read the per-query deltas), then commit
**inside the submodule** and commit the moved pointer here. `scripts/search-kpi/README.md`
has the numbers and the rejected experiments.

## Build

```bash
npm run build:all    # both editions -> _site-org/ and _site-com/
npm run edition:org  # or just one, on its own
npm run build:org    # what Cloudflare runs: this edition, plus the peer's search index
```

## Checks

```bash
npm test            # check:redirects + check:dates + check:links + check:sitemap
```

- **`check:redirects`** guards the Cloudflare rule budget and replays every
  historical `/api/` URL through `lib/api-redirects.js`. Cloudflare Pages silently
  drops `_redirects` rules past the **100th dynamic rule**, so the `/api/` version
  mapping deliberately does *not* live there — see below. Note it exercises
  `lib/api-redirects.js` under plain node and knows nothing about `functions/`, so
  it cannot catch a Pages **routing** regression — only a policy one.
- **`check:dates`** asserts `src/_data/pageDates.json` covers every hand-authored
  page and that no publication date has drifted. Run it explicitly after adding
  pages: at pre-commit the new files are staged but uncommitted, so they look
  untracked and the hook passes regardless.
- **`check:links`** builds both editions and validates internal links.
- **`check:sitemap`** validates the sitemap index and its children.

`npm test` is offline. One check sits outside it for that reason:

```bash
npm run check:api-versions   # is /api/<pkg>/latest/ behind npm? (needs the registry)
```

It compares `src/_data/apiVersions.json` against every documented package's highest
published release and names the stale ones. It is not in `npm test` because the gate
also runs at pre-commit and on pull requests: 16 registry lookups there would let an
unreachable npm block an unrelated commit, and would go red the moment a package is
published — precisely when someone is mid-release. Staleness is a scheduled question,
and `.github/workflows/refresh-api-docs.yml` is what schedules it.

## Deployment

Two **Cloudflare Pages** projects build from `master`, one per edition, differing
only in the `EDITION` env var and output directory. There is no deploy workflow in
this repo; Pages builds on push.

### Analytics ids come from the environment

No measurement id lives in this repo. Each Pages project supplies its own:

| variable | what it is |
|---|---|
| `GA4_MEASUREMENT_ID` | `G-…` for **that project's** GA4 property |
| `CLARITY_PROJECT_ID` | Clarity project id for that edition |
| `GA4_MP_MEASUREMENT_ID` / `GA4_MP_API_SECRET` | server-side agent analytics — see below |

`GA4_MEASUREMENT_ID_ORG` / `_COM` override the plain names when set, which is how a
local `npm run build:all` can give each edition its own id in one process.

**Unset means the tag is not emitted at all.** So `npm run serve:*`, forks and preview
deploys send nothing to production analytics — which the previous arrangement did not
manage: the ids were hardcoded, so every local build reported as real traffic.

They were hardcoded until 2026-08-02, and the pair was wrong in a way a repo cannot
detect: the id in `eleventy.config.js` belonged to the property named **imqueue.com**,
so imqueue.org's traffic was recorded there while the property named imqueue.org
received none of it. Which property owns an id is knowable only in GA4 — Admin → Data
streams → the stream → Measurement ID.

Per-edition `_redirects` and `_headers` are generated into each build
(`src/<edition>/_redirects`, `src/headers.liquid`).

### Pages Functions

`functions/` is shared by both Pages projects:

- `functions/_middleware.js` — 301s `imqueue.net` and `www.imqueue.net` onto
  imqueue.org. Both are custom domains on the imqueue-org project, so without this
  they serve the docs site on a second hostname rather than pointing at it. Because
  this directory is shared, a root middleware runs in front of **every** request to
  both sites, so it is written to fail open: any internal error falls through to
  `next()`, degrading to "no redirect" rather than "site down". A Cloudflare Redirect
  Rule is the better mechanism and should replace it — see the header comment.
- `functions/api/contact.js` — the commercial lead form (imqueue.com `/pricing/`).
- `functions/api/message.js` — the general contact form (`/contact/`, **both**
  editions), with optional attachments. Kept separate from `contact.js` because that
  one has different fields, a different subject line and no attachments; one endpoint
  serving both would mean a request shape where half the fields are conditional on the
  other half.

  Both mail endpoints need **`RESEND_API_KEY`** on the Pages project they run on.
  Because `functions/` is shared, `/api/message` exists on **both** hostnames, so the
  key has to be on both projects — `imqueue-org` as well as `imqueue-com`. Without it
  the endpoint returns 500 and the form shows its "email us directly" fallback, which
  is the intended failure but is invisible until someone tries to send something.
  Optional overrides: `CONTACT_TO` (default `support@imqueue.com`) and `CONTACT_FROM`
  (default `@imqueue <noreply@imqueue.com>`; its domain must be verified in Resend —
  which is why the org site sends as imqueue.com and needs no second verification).
- The root middleware also carries **agent analytics** (`lib/agent-analytics.js`) —
  see below. It is the only place in the stack that sees requests for `/llms.txt` and
  the `.md` mirrors, because those run no JavaScript.
- `functions/api/<pkg>/[[path]].js` — **generated**, one per documented package
  (see `scripts/lib/api-packages.js`); resolves retired API version URLs onto the
  version trees that are actually published, using `lib/api-redirects.js`. Mounted
  per package rather than as one `/api/[[path]]` catch-all so it cannot shadow the
  contact endpoint: `[[path]]` is an *optional* catch-all and does match a bare
  segment, so a dynamic segment directly under `/api/` would sit on top of
  `/api/contact`. On imqueue.com it 301s `/api/` traffic to imqueue.org, because
  Functions run ahead of `_redirects`.

## Legal pages

`/privacy/`, `/terms/` and `/support/` on .org, `/privacy/` and `/terms/` on .com. They
exist because both AI-assistant app directories require public privacy, terms and support
URLs matching the publisher, and Anthropic treats a missing or incomplete privacy policy
as an immediate rejection.

Written per edition rather than shared, because the data flows differ — .com has the
licensing lead form, .org has the hosted MCP endpoint and the agent-traffic counters — and
a policy describing a form its site does not have is the exact inaccuracy a reviewer
looks for. Plain markdown with **no Liquid**: `src/md-mirror.liquid` publishes each page's
raw source as the agent-facing `.md` mirror, so template syntax would ship verbatim.

**Four pages name the data controller** — `src/{org,com}/privacy.md` and
`src/{org,com}/terms.md`. Today that is Mykhailo Stadnyk as a natural person, resident in
the Slovak Republic, and they say in as many words that no legal entity is behind the
sites. **If @imqueue is ever transferred to a company, all four need updating together**:
the controller's identity, the "not a company" statement, the governing-law clause and
`/terms/`'s "Who you are contracting with". Nothing enforces that, which is why it is
written down here.

No postal address is published: without a company it would be a private home address.
The .com terms say it forms part of the licence agreement and is available on request.

## Agent analytics (server-side GA4)

GA4's tag is JavaScript, so it never fires for `/llms.txt`, `/llms-full.txt`, the
`<page-url>index.md` mirrors or `/api/search-index.json` — and crawlers run no JS
even on the HTML pages. Measured 2026-08-01: Cloudflare's edge saw **4.77k requests
in 24h** while GA4 reported **347 sessions in 28 days**. The audience this site is
built for was the one not being measured.

`lib/agent-analytics.js`, called from the root middleware, sends those requests to
GA4 over the Measurement Protocol, so the reporting already exists for them: which
sections agents read, which crawler, which status, over time. Cloudflare's AI Crawl
Control shows the same traffic but keeps 24 hours and reports per crawler brand.

Setup, all free:

1. **Create a second GA4 property** — *not* the one in `head.html`. Crawler hits in
   the main property would wreck the metrics that describe humans.
2. Add a web data stream, copy its **Measurement ID** (`G-…`), then
   **Measurement Protocol API secrets → Create** and copy the secret.
3. On **both** Pages projects → Settings → Environment variables, set
   `GA4_MP_MEASUREMENT_ID` and `GA4_MP_API_SECRET` (encrypt the secret). With either
   missing the module does nothing at all, which is also what keeps forks and preview
   deploys silent.
4. **Verify delivery** — `npm test` proves the logic offline and can prove nothing about
   a real property, so this is a separate, opt-in step:

   ```bash
   export GA4_MP_MEASUREMENT_ID='G-…' GA4_MP_API_SECRET='…'
   npm run probe:agent-analytics     # GA4_MP_DEBUG=1 to validate instead of send
   ```

   It sends three events through `lib/agent-analytics.js` itself — including a 404 — so
   a pass means the module, the credential and the property agree. GA4 answers 204 to
   valid and invalid hits alike, so the proof is **Realtime**, not the exit code. The
   probe refuses to run against the property `eleventy.config.js` reports to, and never
   prints the secret.

5. **Validate the deployment** — nothing to switch on. Every request to the agent
   surface answers with a header saying what the middleware decided:

   ```bash
   curl -sI -A 'GPTBot/1.2' https://imqueue.org/llms.txt | grep -i x-agent-analytics
   # x-agent-analytics: sent crawler=GPTBot surface=llms.txt status=200 edition=org
   # ... or: off reason=not-configured   <- the variables are not reaching the deployment
   ```

   This answers the one question GA4's reports cannot: whether the site is *sending*.
   "Never sent", "sent and rejected" and "sent to a property you aren't looking at" all
   look identical in the UI, and this separates the first from the other two.

   Only `/llms.txt`, `.md` mirrors and the symbol index carry it. Attaching a header
   means rebuilding the response, and the middleware fronts every page, stylesheet and
   image on both sites — those skip it entirely. HTML is also already measured for the
   people who read it, by gtag.

   `GA4_MP_DEBUG=1` is a separate, temporary thing: it routes sends to GA4's validation
   endpoint and logs the verdict to the project's function logs. **Unset it once
   confirmed** — that endpoint reports but records nothing.
5. Optional, for slicing: Admin → Custom definitions → register `crawler`,
   `operator`, `surface`, `status` and `edition` as **event-scoped custom
   dimensions**. Events are sent as `page_view` with `page_location`, so the built-in
   Pages reports work without registering anything.

Three invariants, all guarded by `npm run check:agent-analytics`:

- **The crawler's user-agent is never forwarded.** GA4 discards traffic it identifies
  as a bot, and the Measurement Protocol only knows the UA if you send it — doing so
  would silently discard the whole dataset. The crawler travels as a parameter.
- **Requests gtag already measures are skipped**, so the second property does not
  become a worse copy of the first.
- **`client_id` is derived from the crawler family**, never from an IP or
  fingerprint. A "user" there means a crawler.

## Generated content

```bash
npm run build-docs                  # regenerate the API reference from npm
npm run gen-og / gen-og-blog        # social cards
npm run gen-favicons
npm run sync-cli-guide              # pull the CLI manual from the cli wiki
```

`npm run build-docs` publishes `/api/<pkg>/latest/` for each package's current
major, plus one archived copy of each past major **for `core` and `rpc` only** —
every other package is `latestOnly` and publishes `/latest/` and nothing else. It
also writes `src/_data/apiVersions.json`, `lib/api-versions.js`,
`lib/api-crosslinks.js` and the per-package Functions under `functions/api/`.

Which packages are documented, their group, tags and blurb all live in
**`scripts/lib/api-packages.js`** — the one place to edit. A package with
`status: 'planned'` is in the taxonomy but is not generated and is not linked from
`/api/`; flipping it to `'shipped'` and re-running is what lands a rollout wave.

It reads the **published npm packages**, so it needs network access and can be run
from anywhere — publish first, generate second. Re-running it after a release is
**automated**: `.github/workflows/refresh-api-docs.yml` compares the site against npm
daily, rebuilds only the packages that moved, runs `npm test` and commits. A package
repo can also ping it (`repository_dispatch: package-released`) to skip the wait. Doing
it by hand still works and is the same three commands as §Checks above; naming a
package rebuilds just that one in ~4s, because a partial build merges into the shared
outputs instead of rewriting them. Two guards run as part of it: a
page-name collision assertion (api-documenter builds filenames from lowercased
symbol names and silently overwrites on a clash) and a `prose%` report per package
against a floor — warn-only unless `--strict-prose`.
