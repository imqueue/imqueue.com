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
`vendor/search-ranker` and pinned separately by the `@imqueue/mcp` server, so that the site
and the MCP tool do not answer the same query differently. A plain `git clone` leaves that
directory empty and the build stops with the fix in the message — deliberately, because the
alternative is a site that builds cleanly and ships no `search.js` at all.

**The ranker has a build now.** It is TypeScript, and the two files this site serves —
`dist/ranker.js` and `dist/search.js` — are produced by `npm run build` inside the submodule
rather than committed to it. `npm run build:all` does that for you (see `npm run ranker:build`),
so the sequence below is unchanged; a checkout with `src/` and no `dist/` is now its own
failure state with its own instruction, distinct from an unpopulated submodule.

This used to say the two pins were *identical*, as though something checked. Nothing did,
and they drifted for a fortnight in August 2026 — harmlessly, because the divergent commit
was in `search.js`, the half `@imqueue/mcp` never copies. What has to match is the engine's
behaviour, so the engine now carries `ENGINE_V` (in `src/ranker/constants.ts`): this site
stamps it into every feed as `e`, `check:ranker-engine` compares the pin against that repo's
master, and
`.github/workflows/repin-ranker.yml` takes a repin automatically when the number held still
and opens an issue when it moved.

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

To change the ranker, edit `vendor/search-ranker/src/ranker/` (the engine) or
`vendor/search-ranker/src/ui/` (imqueue's search UI), rebuild it with `npm run ranker:build`,
measure with `npm run kpi:compare` (never by the summary alone — read the per-query deltas),
then commit **inside the submodule** and commit the moved pointer here. `scripts/search-kpi/README.md`
has the numbers and the rejected experiments.

## Build

```bash
npm run build:all    # both editions -> _site-org/ and _site-com/
npm run edition:org  # or just one, on its own
npm run build:org    # what Cloudflare runs: this edition, plus the peer's search index
```

## Checks

```bash
npm test            # 15 offline checks, listed below
npm run test:e2e    # 172 browser tests against the built site — see tests/e2e/README.md
npm run verify      # both suites, diffed against a saved baseline — see AGENTS.md
```

`npm test` runs, in order: `check:redirects`, `check:agent-analytics`,
`check:dates`, `check:package-status`, `check:links`, `check:sitemap`,
`check:llms`, `check:search-ranker`, `check:search-index`,
`check:search-ranking`, `check:kpi`, `check:search-ui`, `check:jsonld`,
`check:mermaid`, `check:email-literals`. The list in `package.json` is the
authority; the notes below cover the ones with a trap in them.

Every check reads the **built** site, so `npm run build:all` first — and stop any
`eleventy --serve` watcher before you trust a result, because it rebuilds the
output concurrently and can make `check:links`/`check:sitemap` lie in either
direction.

- **`check:redirects`** guards the Cloudflare rule budget and replays every
  historical `/api/` URL through `lib/api-redirects.ts`. Cloudflare Pages silently
  drops `_redirects` rules past the **100th dynamic rule**, so the `/api/` version
  mapping deliberately does *not* live there — see below. Note it exercises
  `lib/api-redirects.ts` under plain node and knows nothing about `functions/`, so
  it cannot catch a Pages **routing** regression — only a policy one.
- **`check:dates`** asserts `src/_data/pageDates.json` covers every hand-authored
  page and that no publication date has drifted. Run it explicitly after adding
  pages: at pre-commit the new files are staged but uncommitted, so they look
  untracked and the hook passes regardless.
- **`check:links`** builds both editions and validates internal links (~1900
  pages). It is the slow one, and the reason a commit here takes a while: the
  pre-commit hook runs it.
- **`check:sitemap`** validates the sitemap index and its children, and asserts
  that every indexable page has the markdown mirror agents are promised.
- **`check:kpi`** is a **gate, not a report**. Its floors sit one standard error
  below the measured value, so a small ranking change can trip it legitimately.
  Never choose a target by looking at what the ranker currently does —
  `scripts/search-kpi/README.md` has the method.
- **`npm run test:e2e`** is the browser half, and it is separate on purpose: it
  covers what only a browser can see (search, consent, forms, the phone drawer)
  and deliberately does not duplicate the checks above. It runs the real Pages
  Functions in front of the built site, so the `/api/` redirect policy and the
  agent-facing headers are exercised as deployed, not as configured.

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
detect: the id in `eleventy.config.mts` belonged to the property named **imqueue.com**,
so imqueue.org's traffic was recorded there while the property named imqueue.org
received none of it. Which property owns an id is knowable only in GA4 — Admin → Data
streams → the stream → Measurement ID.

Per-edition `_redirects` and `_headers` are generated into each build
(`src/<edition>/_redirects`, `src/headers.liquid`).

### Pages Functions

`functions/` is shared by both Pages projects:

- `functions/_middleware.ts` — 301s `imqueue.net` and `www.imqueue.net` onto
  imqueue.org. Both are custom domains on the imqueue-org project, so without this
  they serve the docs site on a second hostname rather than pointing at it. Because
  this directory is shared, a root middleware runs in front of **every** request to
  both sites, so it is written to fail open: any internal error falls through to
  `next()`, degrading to "no redirect" rather than "site down". A Cloudflare Redirect
  Rule is the better mechanism and should replace it — see the header comment.
- `functions/api/contact.ts` — the commercial lead form (imqueue.com `/pricing/`).
- `functions/api/message.ts` — the general contact form (`/contact/`, **both**
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
- The root middleware also carries **agent analytics** (`lib/agent-analytics.ts`) —
  see below. It is the only place in the stack that sees requests for `/llms.txt` and
  the `.md` mirrors, because those run no JavaScript.
- `functions/api/<pkg>/[[path]].ts` — **generated**, one per documented package
  (see `scripts/lib/api-packages.ts`); resolves retired API version URLs onto the
  version trees that are actually published, using `lib/api-redirects.ts`. Mounted
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

`lib/agent-analytics.ts`, called from the root middleware, sends those requests to
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

   It sends three events through `lib/agent-analytics.ts` itself — including a 404 — so
   a pass means the module, the credential and the property agree. GA4 answers 204 to
   valid and invalid hits alike, so the proof is **Realtime**, not the exit code. The
   probe refuses to run against the property `eleventy.config.mts` reports to, and never
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
also writes `src/_data/apiVersions.json`, `lib/api-versions.ts`,
`lib/api-crosslinks.ts` and the per-package Functions under `functions/api/`.

Which packages are documented, their group, tags and blurb all live in
**`scripts/lib/api-packages.ts`** — the one place to edit. A package with
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
