# Security / penetration-test harness

A regression tripwire and full penetration-test runner for the two @imqueue
editions, mapped to the standards a security review is graded against:

- **NIST SP 800-115** — the run and the report are laid out by its four phases
  (Planning, Discovery, Attack, Reporting).
- **PTES** — every finding also names its Penetration Testing Execution Standard
  phase.
- **OWASP** — Top 10 (2021), the OWASP Secure Headers Project, and Testing-Guide
  (WSTG) references.
- **CWE** — every finding carries its CWE id(s).
- **securityheaders.com / Mozilla Observatory** — the exact response-header set both
  grade on, so a local run predicts the live grade.
- **RFC 9116** — the `/.well-known/security.txt` contract.

## Two entry points

```bash
npm run check:security          # the tripwire: both BUILT editions, local, fails on medium+
npm run pentest                 # full report, local (both editions)
npm run pentest -- --target remote   # the LIVE imqueue.org + imqueue.com
npm run pentest -- --target both     # local build AND live sites
npm run pentest -- --edition org     # one edition only
npm run pentest -- --url https://staging.example   # an arbitrary origin (repeatable)
npm run pentest -- --strict          # exit non-zero on findings (for CI)
```

`check:security` runs inside `npm test` (after `check:links`, which builds both
editions) and in `.githooks/pre-commit`, so it runs **on every build** — a commit, a
CI run, a release. It exits non-zero on any non-accepted finding at or above
`policy.FLOOR` (medium). `pentest` is the human-facing report; it writes
`scripts/security/report/latest.md` (+ `.json`, both git-ignored) and, by default,
does not fail — pass `--strict` for that.

### Local vs remote — the same checks, two vantage points

- **local** boots the built edition behind the *real* Pages functions
  (`tests/e2e/server/pages-core.ts`) with the `_headers` layer re-applied, on a
  loopback port. Nothing leaves the machine. This is what the tripwire uses.
- **remote** probes the live edge over HTTPS and reports what Cloudflare actually
  serves — edge headers, TLS/HSTS, redirects, the dynamic `security.txt`. Use it
  after a deploy to confirm the local result reached production.

Every probe is **non-destructive**: no data is modified, no availability (load/DoS)
test is run, and the email endpoints are only ever exercised through the honeypot (so
no mail is sent) or paths that fail validation before the mail provider is reached.

## What it checks

Passive (`static.ts`): the response-header policy (CSP, HSTS, `X-Content-Type-Options`,
`X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`, COOP, CORP, framework
disclosure); CSP shape **and inline-script hash coverage**; RFC 9116 `security.txt`;
HTML hygiene (`rel=noopener`, mixed content, inline handlers, form actions, SRI); a
secret scan of the shipped HTML/JS.

Active (`active.ts`): sensitive-file exposure, HTTP method tampering, CORS reflection,
reflected-XSS / injection echo, malformed- and oversized-body handling, open redirect,
and (remote) the http→https redirect.

## The policy is the baseline

There is no mutable snapshot file. `policy.ts` is the single source of truth:

- **`CATALOGUE`** maps every finding id to its severity, CWE/OWASP/standard refs, and
  fix.
- **`SECURITY_HEADERS`, `CSP_*`, `RFC9116_*`, `SENSITIVE_PATHS`, `SECRET_PATTERNS`,
  `PUBLIC_ALLOW`** are the expected policy.
- **`ACCEPTED`** is the exception ledger — a deliberately-accepted gap is recorded
  here with a reason and a review date, reported as an accepted risk, and never fails
  the build. Edit it in a diff, not by regenerating a snapshot.

To accept a new risk: add an entry to `ACCEPTED`. To tighten the bar: raise a rule's
severity or `FLOOR`.

## Two site changes this harness enforces

- **CSP is build-stamped.** `headers.liquid` emits `Content-Security-Policy: __CSP__`;
  the `eleventy.after` hook (via `scripts/lib/csp.ts`) replaces the placeholder with a
  policy whose `script-src` carries the SHA-256 of every inline script *that build*
  emitted — the constant theme-init plus the GA4/Clarity tags `consent.js` inlines,
  which are present only in a production build. The `headers/csp-inline-unhashed` check
  fails the build if an inline script is ever added without a matching hash.
- **`security.txt` is dynamic** (`lib/security-txt.ts`, served from the root
  middleware), so its `Expires` (now + 90 days) can never go stale.

## HSTS is wired but disabled

`Strict-Transport-Security` is intentionally not emitted — a long `max-age` is
effectively irreversible and commits every subdomain to HTTPS-only. The line to add is
in `src/headers.liquid`; `policy.ACCEPTED` records the absence as an accepted risk
until the owner enables it. Remote mode still reports the live truth either way.
