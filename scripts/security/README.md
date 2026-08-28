# Security / penetration-test harness

A regression tripwire and full penetration-test runner for the two @imqueue
editions, mapped to the standards a security review is graded against:

- **NIST SP 800-115** — the run and the report are laid out by its four phases
  (Planning, Discovery, Attack, Reporting), and the report opens with an explicit
  Planning/scope statement (see `SCOPE` in `policy.ts`).
- **PTES** — the report's structure is NIST's; every finding is additionally
  **annotated with its PTES phase** (a per-finding cross-reference, not a second
  layout).
- **OWASP** — Top 10 (2021), the OWASP Secure Headers Project, Testing-Guide (WSTG)
  references, and the API Security Top 10 (for the email-endpoint rate-limiting item).
- **CWE** — every finding carries its CWE id(s).
- **securityheaders.com / Mozilla Observatory** — it verifies the response-header
  surface those graders inspect (it does **not** compute a letter grade; HSTS is
  deliberately deferred and `style-src` keeps `'unsafe-inline'`, so the live grade is
  intentionally not an A+).
- **RFC 9116** — the `/.well-known/security.txt` contract, validated field by field.

## Two entry points

```bash
npm run check:security          # the tripwire: both BUILT editions, local, fails on medium+
npm run check:security:selftest # the tests-of-the-tests (no build needed)
npm run pentest                 # full report, local (both editions)
npm run pentest -- --target remote   # the LIVE imqueue.org + imqueue.com
npm run pentest -- --target both     # local build AND live sites
npm run pentest -- --edition org     # one edition only
npm run pentest -- --url https://staging.example   # an arbitrary origin (repeatable)
npm run pentest -- --strict          # exit non-zero on findings (for CI)
```

`check:security` runs inside `npm test` (after `check:links`, which builds both
editions) and in `.githooks/pre-commit`, so it runs **on every build** — a commit, a
CI run, a release. It first runs the self-tests (below), then exits non-zero on any
non-accepted finding at or above `policy.FLOOR` (medium). `pentest` is the human-facing
report; it writes `scripts/security/report/latest.md` (+ `.json`, both git-ignored)
and, by default, does not fail — pass `--strict` for that.

### Local vs remote — the same checks, two vantage points

- **local** boots the built edition behind the *real* Pages functions
  (`tests/e2e/server/pages-core.ts`) with the `_headers` layer re-applied, on a
  loopback port. Nothing leaves the machine. This is what the tripwire uses.
- **remote** probes the live edge over HTTPS and reports what Cloudflare actually
  serves — edge headers, TLS minimum version, http→https redirect, host-header
  handling, the DNS email-auth posture (SPF/DMARC), and the dynamic `security.txt`.
  Use it after a deploy to confirm the local result reached production.

> **The local gate is blind to the edge.** `check:security` is local-only and cannot
> see zone-level behaviour: a re-injected `Access-Control-Allow-Origin` (Transform
> Rule), TLS/HSTS, WAF/rate-limits, the CDN cache, and the Pages-owned `/_headers`,
> `/_redirects` and `/robots.txt` (404'd locally). Those checks are recorded as **not
> exercised** in a local run (§6 of the report lists each with the reason) and only
> actually fire in a manual `pentest --target remote` run, which gates nothing. Run
> the remote pass after a deploy.

Every probe is **non-destructive**: no data is modified, no availability (load/DoS)
test is run, and the email endpoints are only ever exercised through the honeypot (so
no mail is sent) or paths that fail validation before the mail provider is reached.
Because it cannot send a burst without becoming the DoS it forbids, the harness does
**not** verify email-endpoint rate-limiting — that control is tracked as an accepted
risk (see below).

## What it checks

Passive (`static.ts`): the response-header policy (CSP, HSTS, `X-Content-Type-Options`,
`X-Frame-Options`, `Referrer-Policy` **and its value**, `Permissions-Policy` **and its
value**, COOP, CORP, framework disclosure); CSP shape, `style-src` `'unsafe-inline'`,
**and inline-script hash coverage**; the security-header set on a **Function response**
(the dynamic `security.txt`), not only on `/`; RFC 9116 `security.txt` (served type +
charset, required fields, Contact URI, Canonical, single Expires, RFC-3339 shape,
Expires near/far, signature); HTML hygiene (`rel=noopener`, mixed content, inline
handlers — code samples excluded, form actions, SRI); consent-gating of the GA4/Clarity
loaders; a secret scan of the shipped HTML **and the same-origin JS/JSON**.

Active (`active.ts`): sensitive-file exposure, directory listing, HTTP method tampering
(across every discovered `/api` route), CORS reflection, reflected-XSS / injection echo,
email header (CR/LF) injection, malformed- and oversized-body handling, attachment
abuse, open redirect (across every discovered `/api/<pkg>/` route), and — **remote
only** — the http→https redirect (apex, a deep path, and www), the TLS minimum version,
host-header injection, and the SPF/DMARC posture.

The one genuinely live gap for these sites — **no harness-verifiable rate-limiting on
the two email endpoints** (`abuse/no-rate-limit`) — is surfaced on every run and folded
into the accepted-risk ledger, because the control is a Cloudflare edge rule the harness
cannot confirm without sending a burst.

## The policy is the baseline

There is no mutable snapshot file. `policy.ts` is the single source of truth:

- **`CATALOGUE`** maps every finding id to its severity, CWE/OWASP/standard refs, and
  fix.
- **`SECURITY_HEADERS`, `CSP_*`, `RFC9116_*`, `SENSITIVE_PATHS`, `SECRET_PATTERNS`,
  `PUBLIC_ALLOW`** are the expected policy.
- **`SCOPE`** is the Planning-phase scope statement (in/out of scope, rules of
  engagement, assumptions, known limitations) rendered as §2 of the report.
- **`ACCEPTED`** is the exception ledger — a deliberately-accepted gap is recorded
  here with a reason and a review date, reported as an accepted risk, and never fails
  the build. A review date in the past is **warned** about (never silently permanent).
  Edit it in a diff, not by regenerating a snapshot.

To accept a new risk: add an entry to `ACCEPTED`. To tighten the bar: raise a rule's
severity or `FLOOR`.

## Tests-of-the-tests (`selftest.ts`)

A policy-as-baseline tripwire has one blind spot: a check whose regex silently stops
matching records a `pass` and looks exactly like a clean site. `selftest.ts` drives
every check function through a scripted fake target with a **known-bad** input (it must
produce its finding) and a **clean** input (it must not). It runs first inside
`check:security`, so a check that has regressed to always-pass fails there before the
run is trusted. It needs no build and no network.

## Coverage honesty

The report separates **checks exercised & passed** from **checks not exercised in this
mode**. A probe that is honeypot-shadowed, un-sendable from a browser client, or
edge-only (TLS, host-header, DNS, http→https) is recorded as *not exercised* with a
reason — never folded into the passing count. §6 of the report lists every skip.

## Scope boundaries and what is deliberately out

- **`mcp.imqueue.org`** is a **separate deployment and repository** (the MCP server),
  not built from this repo. It is out of scope; probe it explicitly with
  `pentest -- --url https://mcp.imqueue.org` if wanted.
- **Dependency / supply-chain CVEs (OWASP A06/A08)** are **Dependabot's** job, not this
  harness's — and note that npm `overrides` can leave a Dependabot alert open while
  `npm audit` reads clean, so an audit gate here would be misleading. Runtime
  third-party loaders (GA4/Clarity) are versionless by design (SRI-incompatible); the
  consent-gate check ensures they do not execute before consent.
- **Logging / monitoring / detection (OWASP A09)** is out of scope: an automated run
  has no access to the edge logs.
- **Email-auth DNS (SPF/DMARC)** is checked in **remote** mode only (it needs public
  DNS); it does not gate a local build.

## Two site changes this harness enforces

- **CSP is build-stamped.** `headers.liquid` emits `Content-Security-Policy: __CSP__`;
  the `eleventy.after` hook (via `scripts/lib/csp.ts`) replaces the placeholder with a
  policy whose `script-src` carries the SHA-256 of every inline script *that build*
  emitted — the constant theme-init plus the GA4/Clarity tags `consent.js` inlines,
  which are present only in a production build. The `headers/csp-inline-unhashed` check
  fails the build if an inline script is ever added without a matching hash.
- **`security.txt` is dynamic** (`lib/security-txt.ts`, served from the root
  middleware), so its `Expires` (now + 90 days) can never go stale. It answers GET/HEAD
  only (405 otherwise).

## HSTS is wired but disabled

`Strict-Transport-Security` is intentionally not emitted — a long `max-age` is
effectively irreversible and commits every subdomain to HTTPS-only. The line to add is
in `src/headers.liquid`; `policy.ACCEPTED` records the absence as an accepted risk
until the owner enables it. Remote mode still reports the live truth either way.
