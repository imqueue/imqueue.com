// scripts/security/policy.ts — the security KNOWLEDGE, declaratively. Three things
// live here and nothing else does:
//
//   1. RULES — the catalogue that maps every finding id to its severity and to the
//      standards it is measured against (CWE / OWASP Top 10 2021 / OWASP Secure
//      Headers Project / RFC 9116 / Mozilla Observatory) and to the fix. Checks
//      never spell these out; they cite `rule("id")`, so the mapping is auditable
//      in one place and cannot drift between two copies.
//   2. The expected policy — which response headers must be present and what a good
//      value looks like, the CSP shape, the RFC 9116 fields, the sensitive paths to
//      probe, the secret patterns to scan for.
//   3. ACCEPTED — the exception ledger. A deliberately-accepted gap (HSTS, today)
//      is recorded here with a reason and a review date; it is reported as an
//      accepted risk and never fails the build. This is the file to edit to accept a
//      risk — in code, reviewed in a diff, not in a snapshot that silently grows.
//
// The tripwire has no separate baseline file: this policy IS the baseline. A new
// gap is a finding the moment a check sees it, and stays one until it is fixed or
// deliberately accepted here.

import type { Rule, ScopeInfo, Severity } from "./lib.ts";

/* ---- the tripwire's failure threshold -------------------------------------- */

// check-security.ts fails the build on any non-accepted finding at or above this.
// low/info are reported but do not block, so an aspirational hardening item does
// not hold up a content deploy.
export const FLOOR: Severity = "medium";

/* ---- rule catalogue -------------------------------------------------------- */

// One entry per finding id. `standards` is free-form provenance printed verbatim in
// the report; `cwe`/`owasp` are the structured cross-references.
const CATALOGUE: Rule[] = [
  /* headers — OWASP Secure Headers Project / Mozilla Observatory ------------- */
  {
    id: "headers/csp-missing",
    title: "No Content-Security-Policy",
    severity: "high",
    cwe: [1021, 79],
    owasp: ["A05:2021"],
    standards: ["OWASP Secure Headers Project", "Mozilla Observatory"],
    nist: "Discovery",
    ptes: "Vulnerability Analysis",
    remediation:
      "Emit a Content-Security-Policy on /* that pins script-src to 'self' plus the hashes of the inline scripts actually built (see scripts/lib/csp.ts).",
  },
  {
    id: "headers/csp-weak",
    title: "Content-Security-Policy is missing a hardening directive",
    severity: "medium",
    cwe: [79, 1021],
    owasp: ["A05:2021"],
    standards: ["OWASP Secure Headers Project", "Mozilla Observatory"],
    nist: "Discovery",
    ptes: "Vulnerability Analysis",
    remediation:
      "Add the missing directive. object-src 'none', base-uri 'self', frame-ancestors and form-action are all expected.",
  },
  {
    id: "headers/csp-unsafe-script",
    title: "Content-Security-Policy allows unsafe script execution",
    severity: "high",
    cwe: [79],
    owasp: ["A05:2021"],
    standards: ["OWASP Secure Headers Project"],
    nist: "Discovery",
    ptes: "Vulnerability Analysis",
    remediation:
      "Remove 'unsafe-inline' / 'unsafe-eval' from script-src; allow inline scripts by hash or nonce instead.",
  },
  {
    id: "headers/csp-inline-unhashed",
    title: "Built inline script has no hash in the CSP — it will be blocked, or the CSP leans on 'unsafe-inline'",
    severity: "high",
    cwe: [79],
    owasp: ["A05:2021"],
    standards: ["OWASP Secure Headers Project"],
    nist: "Discovery",
    ptes: "Vulnerability Analysis",
    remediation:
      "Regenerate the CSP hash list from the build output (scripts/lib/csp.ts runs in build:*), or the new inline script will break under the enforcing policy.",
  },
  {
    id: "headers/csp-style-unsafe-inline",
    // style-src carries 'unsafe-inline' because ~1,900 pages ship inline style
    // attributes; removing it would break every one, and style injection is a far
    // smaller risk than script injection (which takes no such shortcut). Recorded in
    // policy.ACCEPTED so the trade-off is auditable in the ledger rather than silent.
    title: "CSP style-src allows 'unsafe-inline'",
    severity: "low",
    cwe: [79],
    owasp: ["A05:2021"],
    standards: ["OWASP Secure Headers Project", "Mozilla Observatory"],
    nist: "Discovery",
    ptes: "Vulnerability Analysis",
    remediation:
      "Prefer hashed/nonce'd styles over 'unsafe-inline' in style-src. Accepted here: the site relies on inline style attributes across ~1,900 pages and style injection is low-risk relative to script.",
  },
  {
    id: "headers/hsts-missing",
    title: "No Strict-Transport-Security",
    severity: "medium",
    cwe: [319],
    owasp: ["A05:2021", "A02:2021"],
    standards: ["OWASP Secure Headers Project", "Mozilla Observatory"],
    nist: "Discovery",
    ptes: "Vulnerability Analysis",
    remediation:
      "Add Strict-Transport-Security: max-age=31536000; includeSubDomains once every subdomain is confirmed HTTPS-only.",
  },
  {
    id: "headers/xcto-missing",
    // CWE-693 (Protection Mechanism Failure) is the accurate class: a missing nosniff
    // is the absence of a protection, not a wrong-handler deployment (CWE-430) or the
    // deprecated CWE-16 (Configuration category, not a weakness).
    title: "No X-Content-Type-Options: nosniff",
    severity: "medium",
    cwe: [693],
    owasp: ["A05:2021"],
    standards: ["OWASP Secure Headers Project", "Mozilla Observatory"],
    nist: "Discovery",
    ptes: "Vulnerability Analysis",
    remediation: "Add X-Content-Type-Options: nosniff on /*.",
  },
  {
    id: "headers/xfo-missing",
    title: "No X-Frame-Options",
    severity: "medium",
    cwe: [1021],
    owasp: ["A05:2021"],
    standards: ["OWASP Secure Headers Project"],
    nist: "Discovery",
    ptes: "Vulnerability Analysis",
    remediation: "Add X-Frame-Options: SAMEORIGIN (and CSP frame-ancestors) on /*.",
  },
  {
    id: "headers/frame-ancestors-missing",
    title: "CSP has no frame-ancestors (clickjacking defence-in-depth)",
    severity: "low",
    cwe: [1021],
    owasp: ["A05:2021"],
    standards: ["OWASP Secure Headers Project"],
    nist: "Discovery",
    ptes: "Vulnerability Analysis",
    remediation: "Add frame-ancestors 'self' (or 'none') to the CSP — the modern successor to X-Frame-Options.",
  },
  {
    id: "headers/referrer-policy-missing",
    title: "No Referrer-Policy",
    severity: "low",
    cwe: [200],
    owasp: ["A01:2021"],
    standards: ["OWASP Secure Headers Project", "Mozilla Observatory"],
    nist: "Discovery",
    ptes: "Vulnerability Analysis",
    remediation: "Add Referrer-Policy: strict-origin-when-cross-origin (or no-referrer) on /*.",
  },
  {
    id: "headers/permissions-policy-missing",
    title: "No Permissions-Policy",
    severity: "low",
    cwe: [668],
    owasp: ["A05:2021"],
    standards: ["OWASP Secure Headers Project", "Mozilla Observatory"],
    nist: "Discovery",
    ptes: "Vulnerability Analysis",
    remediation:
      "Add a restrictive Permissions-Policy on /* disabling the powerful features the site does not use (camera, microphone, geolocation, …).",
  },
  {
    id: "headers/coop-missing",
    // CWE-668 (Exposure of Resource to Wrong Sphere): COOP isolates the browsing
    // context so a cross-origin opener cannot reach it. Not CWE-1021 (clickjacking),
    // which is X-Frame-Options / frame-ancestors. Cited to the OWASP Secure Headers
    // Project — COOP is not in Mozilla Observatory's scored set.
    title: "No Cross-Origin-Opener-Policy",
    severity: "low",
    cwe: [668],
    owasp: ["A05:2021"],
    standards: ["OWASP Secure Headers Project"],
    nist: "Discovery",
    ptes: "Vulnerability Analysis",
    remediation: "Add Cross-Origin-Opener-Policy: same-origin on /*.",
  },
  {
    id: "headers/corp-missing",
    title: "No Cross-Origin-Resource-Policy",
    severity: "info",
    cwe: [668],
    // CORP is not scored by Mozilla Observatory either; the OWASP Secure Headers
    // Project is the correct provenance.
    standards: ["OWASP Secure Headers Project"],
    nist: "Discovery",
    ptes: "Vulnerability Analysis",
    remediation: "Add Cross-Origin-Resource-Policy: same-origin on /* (or same-site if cross-subdomain assets are needed).",
  },
  {
    id: "headers/server-version-leak",
    title: "Server / framework version disclosed in a response header",
    severity: "low",
    cwe: [200],
    owasp: ["A05:2021"],
    standards: ["OWASP Testing Guide (WSTG-INFO-02)"],
    nist: "Discovery",
    ptes: "Intelligence Gathering",
    remediation: "Strip version detail from Server / X-Powered-By where controllable.",
  },
  {
    id: "headers/powered-by",
    title: "X-Powered-By reveals the stack",
    severity: "low",
    cwe: [200],
    owasp: ["A05:2021"],
    standards: ["OWASP Testing Guide (WSTG-INFO-02)"],
    nist: "Discovery",
    ptes: "Intelligence Gathering",
    remediation: "Remove the X-Powered-By header.",
  },
  {
    id: "headers/cache-sensitive",
    title: "Dynamic/JSON response is cacheable",
    severity: "low",
    cwe: [525],
    owasp: ["A05:2021"],
    standards: ["OWASP Testing Guide (WSTG-ATHN-06)"],
    nist: "Discovery",
    ptes: "Vulnerability Analysis",
    remediation: "Set Cache-Control: no-store on API/JSON responses that reflect a request.",
  },

  /* RFC 9116 — security.txt -------------------------------------------------- */
  {
    id: "rfc9116/missing",
    // No CWE: a missing security.txt is a conformance gap with RFC 9116, not an
    // information-disclosure weakness (CWE-200, which was the reverse of the problem).
    title: "No /.well-known/security.txt",
    severity: "medium",
    standards: ["RFC 9116"],
    nist: "Discovery",
    ptes: "Intelligence Gathering",
    remediation:
      "Publish /.well-known/security.txt with at least Contact and Expires (RFC 9116 §2.5.3, §2.5.5).",
  },
  {
    id: "rfc9116/invalid",
    title: "security.txt is present but non-conformant",
    severity: "medium",
    standards: ["RFC 9116"],
    nist: "Discovery",
    ptes: "Intelligence Gathering",
    remediation: "Fix the field(s) named in the evidence so the file parses per RFC 9116.",
  },
  {
    id: "rfc9116/expires-soon",
    title: "security.txt Expires is near or in the past",
    severity: "low",
    standards: ["RFC 9116 §2.5.5"],
    nist: "Discovery",
    ptes: "Intelligence Gathering",
    remediation: "Roll the Expires date forward (RFC 9116 recommends < 1 year out, and it must be in the future).",
  },
  {
    id: "rfc9116/served-type",
    title: "security.txt is not served as text/plain; charset=utf-8",
    severity: "low",
    standards: ["RFC 9116 §3"],
    nist: "Discovery",
    ptes: "Intelligence Gathering",
    remediation: "Serve /.well-known/security.txt with Content-Type: text/plain; charset=utf-8.",
  },
  {
    id: "rfc9116/expires-far",
    // RFC 9116 §2.5.5 RECOMMENDS (SHOULD) an Expires under a year out — a should, not
    // a must. Reported low and kept apart from rfc9116/invalid, which is reserved for
    // MUST/format failures.
    title: "security.txt Expires is more than a year in the future",
    severity: "low",
    standards: ["RFC 9116 §2.5.5"],
    nist: "Discovery",
    ptes: "Intelligence Gathering",
    remediation: "RFC 9116 recommends Expires be less than a year out; shorten it so the file signals active maintenance.",
  },
  {
    id: "rfc9116/unsigned",
    // RFC 9116 §2.3 RECOMMENDS (SHOULD) a detached OpenPGP signature at
    // /.well-known/security.txt.sig. Absent by deliberate choice here (a dynamic,
    // per-request edge endpoint), recorded in ACCEPTED. Info only.
    title: "security.txt is not digitally signed (no Signature / .sig)",
    severity: "info",
    standards: ["RFC 9116 §2.3"],
    nist: "Discovery",
    ptes: "Intelligence Gathering",
    remediation: "Optionally publish a detached OpenPGP signature (Signature field + /.well-known/security.txt.sig), or accept the absence for a dynamically-generated file.",
  },

  /* HTML hygiene ------------------------------------------------------------- */
  {
    id: "html/noopener",
    title: "target=_blank link without rel=noopener",
    severity: "low",
    cwe: [1022],
    owasp: ["A01:2021"],
    standards: ["OWASP Testing Guide"],
    nist: "Discovery",
    ptes: "Vulnerability Analysis",
    remediation: "Add rel=\"noopener\" (or noopener noreferrer) to every target=_blank anchor.",
  },
  {
    id: "html/sri-missing",
    title: "Cross-origin script/style without Subresource Integrity",
    severity: "medium",
    cwe: [353, 494],
    owasp: ["A08:2021"],
    standards: ["OWASP Secure Headers Project", "SRI (W3C)"],
    nist: "Discovery",
    ptes: "Vulnerability Analysis",
    remediation: "Add an integrity= (and crossorigin=) attribute to every cross-origin <script>/<link rel=stylesheet>.",
  },
  {
    id: "html/mixed-content",
    title: "Insecure (http://) subresource on an https page",
    severity: "high",
    cwe: [319],
    owasp: ["A02:2021"],
    standards: ["Mozilla Observatory"],
    nist: "Discovery",
    ptes: "Vulnerability Analysis",
    remediation: "Reference every script/style/img/font/media over https (or a protocol-relative path served over https).",
  },
  {
    id: "html/inline-handler",
    title: "Inline event handler / javascript: URI (blocked by a strict CSP)",
    severity: "medium",
    cwe: [79],
    owasp: ["A03:2021"],
    standards: ["OWASP Secure Headers Project"],
    nist: "Discovery",
    ptes: "Vulnerability Analysis",
    remediation: "Move inline on*= handlers and javascript: URIs into the bundled scripts so the enforcing CSP does not have to allow them.",
  },
  {
    id: "html/secret-in-source",
    title: "Possible secret / credential in shipped source",
    severity: "high",
    cwe: [200, 798],
    owasp: ["A05:2021", "A07:2021"],
    standards: ["OWASP Testing Guide (WSTG-CONF-04)"],
    nist: "Discovery",
    ptes: "Intelligence Gathering",
    remediation:
      "Remove the value from the build output and rotate it. Secrets belong in Pages env bindings, never in HTML/JS. Public ids (GA4/Clarity) belong in policy.ts PUBLIC_ALLOW.",
  },
  {
    id: "html/form-insecure-action",
    title: "Form submits over http:// or to an unexpected host",
    severity: "high",
    cwe: [319],
    owasp: ["A02:2021"],
    standards: ["OWASP Testing Guide (WSTG-CLNT)"],
    nist: "Discovery",
    ptes: "Vulnerability Analysis",
    remediation: "Point every form action at a same-origin https endpoint.",
  },

  {
    id: "privacy/consent-not-gated",
    // The site is cookieless by default: GA4 and Clarity ship PARKED as
    // `type="text/plain"` and are turned into real scripts by js/consent.js only after
    // a visitor consents. This rule fires if a build ever ships one of those loaders as
    // a live, executing tag — i.e. analytics that run before consent. The most
    // realistic privacy regression on an otherwise no-tracking site.
    title: "Analytics loader is not consent-gated (executes before consent)",
    severity: "medium",
    cwe: [359],
    owasp: ["A01:2021"],
    standards: ["GDPR/ePrivacy (consent before non-essential tracking)"],
    nist: "Discovery",
    ptes: "Vulnerability Analysis",
    remediation:
      "Ship GA4/Clarity parked as <script type=\"text/plain\" data-consent> and activate them only from js/consent.js after consent — never as a live <script src> or executing inline script.",
  },

  /* exposure / information disclosure ---------------------------------------- */
  {
    id: "exposure/sensitive-file",
    title: "Sensitive file is publicly served",
    severity: "high",
    cwe: [538, 200],
    owasp: ["A05:2021"],
    standards: ["OWASP Testing Guide (WSTG-CONF-05)"],
    nist: "Attack",
    ptes: "Vulnerability Analysis",
    remediation: "Remove the file from the deployed output, or block the path. It should not be reachable.",
  },
  {
    id: "exposure/source-map",
    title: "JavaScript source map is publicly served",
    severity: "medium",
    cwe: [540],
    owasp: ["A05:2021"],
    standards: ["OWASP Testing Guide"],
    nist: "Attack",
    ptes: "Intelligence Gathering",
    remediation: "Do not ship .map files to production, or block their path.",
  },
  {
    id: "exposure/directory-listing",
    title: "Directory listing is enabled",
    severity: "medium",
    cwe: [548],
    owasp: ["A05:2021"],
    standards: ["OWASP Testing Guide (WSTG-CONF-04)"],
    nist: "Attack",
    ptes: "Intelligence Gathering",
    remediation: "Disable directory indexes; serve a 404 for directories with no index.",
  },
  {
    id: "disclosure/stack-trace",
    // PTES: observing a leaked trace is Vulnerability Analysis, not Exploitation —
    // nothing is exploited, the disclosure is simply detected.
    title: "Server error discloses a stack trace or internal path",
    severity: "high",
    cwe: [209],
    owasp: ["A05:2021"],
    standards: ["OWASP Testing Guide (WSTG-ERRH-01)"],
    nist: "Attack",
    ptes: "Vulnerability Analysis",
    remediation: "Return a generic error page; log the detail server-side only.",
  },

  /* active endpoint behaviour ------------------------------------------------ */
  {
    id: "disclosure/verbose-error-500",
    // CWE-209 (Generation of Error Message Containing Sensitive Information). CWE-388
    // (7PK · Error Handling) is a category pillar, not a mappable weakness — dropped.
    // PTES: detecting the bad status is Vulnerability Analysis, not Exploitation.
    title: "Endpoint returns a 5xx on malformed input",
    severity: "medium",
    cwe: [209],
    owasp: ["A05:2021"],
    standards: ["OWASP Testing Guide (WSTG-ERRH-01)"],
    nist: "Attack",
    ptes: "Vulnerability Analysis",
    remediation: "Return a 4xx for malformed or invalid input; a 5xx there signals an unhandled path that may leak detail.",
  },
  {
    id: "method/dangerous",
    // CWE-749 (Exposed Dangerous Method or Function) is the accurate class. CWE-650
    // (Trusting HTTP Permission Methods on the Server Side) is specifically about
    // relying on GET/POST for access control, which is not what this probe finds.
    // PTES: enumerating accepted methods is Vulnerability Analysis, not Exploitation.
    title: "Dangerous HTTP method is accepted",
    severity: "medium",
    cwe: [749],
    owasp: ["A05:2021"],
    standards: ["OWASP Testing Guide (WSTG-CONF-06)"],
    nist: "Attack",
    ptes: "Vulnerability Analysis",
    remediation: "Reject TRACE/TRACK/PUT/DELETE/CONNECT unless a route genuinely needs them.",
  },
  {
    id: "disclosure/agent-analytics-reflection",
    // The edge adds an x-agent-analytics response header derived from the request UA
    // and Referer, but only as CLASSIFIED enum tokens (kind/crawler/surface/ai). This
    // fires only if a crafted UA/Referer is ever reflected verbatim into that header —
    // i.e. header injection / echo. Current impl verified to emit enums only.
    title: "x-agent-analytics header reflects raw request input",
    severity: "info",
    cwe: [116],
    owasp: ["A03:2021"],
    standards: ["OWASP Testing Guide (WSTG-INPV)"],
    nist: "Attack",
    ptes: "Vulnerability Analysis",
    remediation: "Emit only classified enum values into x-agent-analytics; never copy the raw User-Agent or Referer into a response header.",
  },
  {
    id: "cors/permissive",
    title: "Dangerous CORS policy (Origin reflected, or wildcard with credentials)",
    severity: "high",
    cwe: [942],
    owasp: ["A05:2021"],
    standards: ["OWASP Testing Guide (WSTG-CLNT-07)"],
    nist: "Attack",
    ptes: "Exploitation",
    remediation:
      "Do not reflect arbitrary Origins, and never combine Access-Control-Allow-Origin: * with Allow-Credentials: true.",
  },
  {
    id: "cors/wildcard",
    title: "Access-Control-Allow-Origin: * on all responses",
    severity: "low",
    cwe: [942],
    owasp: ["A05:2021"],
    standards: ["OWASP Testing Guide (WSTG-CLNT-07)"],
    nist: "Attack",
    ptes: "Vulnerability Analysis",
    remediation:
      "Confirm the wildcard is intended. It is low-risk on public, cookieless content, but a zone-level ACAO: * also exposes the /api/* JSON responses cross-origin — scope it to where CORS is actually needed (a Cloudflare Response Header Transform rule), or drop it.",
  },
  {
    id: "input/xss-reflected",
    title: "Request input is reflected unescaped (reflected XSS)",
    severity: "critical",
    cwe: [79],
    owasp: ["A03:2021"],
    standards: ["OWASP Testing Guide (WSTG-INPV-01)"],
    nist: "Attack",
    ptes: "Exploitation",
    remediation: "HTML-escape every request-derived value before it reaches a response body.",
  },
  {
    id: "input/injection-echo",
    // CWE-79 (XSS) is the reachable weakness when a value is echoed into a response.
    // CWE-74 (Injection) is the parent pillar, not a leaf mapping — dropped.
    title: "Endpoint echoes an injection payload back to the caller",
    severity: "medium",
    cwe: [79],
    owasp: ["A03:2021"],
    standards: ["OWASP Testing Guide (WSTG-INPV)"],
    nist: "Attack",
    ptes: "Exploitation",
    remediation: "Do not echo submitted values; return fixed messages and escape anything that must be shown.",
  },
  {
    id: "input/oversized-accepted",
    title: "Endpoint accepts an oversized body without limit",
    severity: "low",
    cwe: [400, 770],
    owasp: ["A05:2021"],
    standards: ["OWASP Testing Guide (WSTG-BUSL-09)"],
    nist: "Attack",
    ptes: "Exploitation",
    remediation: "Cap request body size and reject early; rate-limit the endpoint (a Cloudflare WAF rate rule for the email endpoints).",
  },
  {
    id: "abuse/no-rate-limit",
    // The one genuinely live gap for these sites: the two email endpoints have no
    // anti-automation control the harness can confirm. Rate-limiting is an edge/WAF
    // control (a Cloudflare rate rule or Turnstile), not observable non-destructively
    // from here — so this is TRACKED as an accepted risk (policy.ACCEPTED) and surfaced
    // in every report, rather than living only inside another rule's remediation prose.
    title: "Email endpoints have no harness-verifiable rate-limiting / anti-automation",
    severity: "medium",
    cwe: [770, 799],
    owasp: ["A04:2021"],
    standards: ["OWASP API Security Top 10 (API4:2023)", "OWASP Testing Guide (WSTG-BUSL-09)"],
    nist: "Attack",
    ptes: "Vulnerability Analysis",
    remediation:
      "Front POST /api/contact and POST /api/message with a Cloudflare WAF rate-limiting rule (or Turnstile). This is an owner-side dashboard action; the harness cannot send a burst non-destructively, so the control is tracked in policy.ACCEPTED until confirmed.",
  },
  {
    id: "input/attachment-unvalidated",
    // The message endpoint accepts base64 attachments. It has real defenses (extension
    // + MIME allow-list, base64 charset check, per-file and total size caps, filename
    // slash-stripping). This rule fires if an abusive attachment (bad type, bad base64,
    // malformed list) is ever accepted (2xx) or crashes the endpoint (5xx) instead of a
    // clean 4xx. Local only — a valid attachment would reach the mail path.
    title: "Attachment with a bad type / encoding is not cleanly rejected",
    severity: "low",
    cwe: [434, 20],
    owasp: ["A04:2021"],
    standards: ["OWASP Testing Guide (WSTG-BUSL-09)"],
    nist: "Attack",
    ptes: "Exploitation",
    remediation: "Reject attachments failing the extension/MIME allow-list, base64 shape or size caps with a 4xx before any further processing.",
  },
  {
    id: "input/mail-header-injection",
    // Defense-in-depth. No live vuln today — the endpoints reach Resend as JSON field
    // VALUES (never raw SMTP), and isEmail() rejects any address containing whitespace,
    // so a CR/LF cannot become a new header. This rule fires only if a CR/LF payload is
    // ever reflected into a header-shaped position in the response.
    title: "Endpoint may be vulnerable to email header (CRLF) injection",
    severity: "medium",
    cwe: [93],
    owasp: ["A03:2021"],
    standards: ["OWASP Testing Guide (WSTG-INPV-16)"],
    nist: "Attack",
    ptes: "Exploitation",
    remediation: "Reject CR/LF in any field used to build an email header; send values as JSON to the mail API, never as raw SMTP.",
  },
  {
    id: "redirect/open",
    title: "Open redirect — Location is attacker-controlled",
    severity: "high",
    cwe: [601],
    owasp: ["A01:2021"],
    standards: ["OWASP Testing Guide (WSTG-CLNT-04)"],
    nist: "Attack",
    ptes: "Exploitation",
    remediation: "Only redirect to a fixed allow-list of same-origin paths; never build Location from the request.",
  },
  {
    id: "transport/no-https-redirect",
    title: "http:// is not redirected to https://",
    severity: "high",
    cwe: [319],
    owasp: ["A02:2021"],
    standards: ["Mozilla Observatory"],
    nist: "Attack",
    ptes: "Vulnerability Analysis",
    remediation: "Force a 301 from http to https at the edge.",
  },
  {
    id: "transport/weak-tls",
    // Remote-only. TLS version/cipher is an edge-level (Cloudflare) control, not
    // observable locally. A handshake that succeeds at TLS 1.0/1.1 is the finding.
    title: "Edge negotiates a deprecated TLS version (1.0 / 1.1)",
    severity: "medium",
    cwe: [326, 327],
    owasp: ["A02:2021"],
    standards: ["OWASP Testing Guide (WSTG-CRYP-01)", "Mozilla Observatory"],
    nist: "Attack",
    ptes: "Vulnerability Analysis",
    remediation: "Set the Cloudflare zone minimum TLS version to 1.2 (dashboard → SSL/TLS → Edge Certificates).",
  },
  {
    id: "host-header/injection",
    // Remote-only. No live exposure expected: security.txt/canonical are pinned to a
    // fixed editionDomain, not derived from an attacker-controlled Host. Fires only if
    // a crafted Host / X-Forwarded-Host reaches an absolute URL or a redirect Location.
    title: "Response reflects an attacker-controlled Host / X-Forwarded-Host",
    severity: "medium",
    cwe: [644],
    owasp: ["A03:2021"],
    standards: ["OWASP Testing Guide (WSTG-INPV-16)"],
    nist: "Attack",
    ptes: "Exploitation",
    remediation: "Derive absolute URLs and redirect targets from a fixed allow-list, never from the request Host / X-Forwarded-* headers.",
  },
  {
    id: "dns/email-auth-missing",
    // Remote-only DNS posture. Email is the site's core function, so a missing SPF or
    // DMARC record is worth flagging — it lets the domain be spoofed in From:.
    title: "Domain is missing an SPF or DMARC record",
    severity: "low",
    cwe: [290],
    owasp: ["A07:2021"],
    standards: ["RFC 7208 (SPF)", "RFC 7489 (DMARC)"],
    nist: "Discovery",
    ptes: "Intelligence Gathering",
    remediation: "Publish an SPF TXT record and a _dmarc TXT record (and DKIM for the sending service) so the domain cannot be spoofed.",
  },
];

const BY_ID = new Map(CATALOGUE.map((r) => [r.id, r]));

/** Look up a rule; throws on an unknown id so a typo fails at first run, not silently. */
export function rule(id: string): Rule {
  const r = BY_ID.get(id);

  if (!r) throw new Error(`security: unknown rule id "${id}" — add it to policy.ts CATALOGUE`);

  return r;
}

/* ---- expected response headers (the /* scope) ------------------------------ */

export interface HeaderPolicy {
  /** lower-case header name */
  name: string;
  /** ruleId emitted when it is absent */
  missingRule: string;
  /** optional: validate a present value; return an evidence string if it is wrong, else null */
  validate?: (value: string) => string | null;
}

// The headers every HTML response must carry. CSP and HSTS are handled separately
// (CSP by the hash-aware validator, HSTS by the exception ledger), so they are not
// in this simple present/absent list.
export const SECURITY_HEADERS: HeaderPolicy[] = [
  {
    name: "x-content-type-options",
    missingRule: "headers/xcto-missing",
    validate: (v) => (v.trim().toLowerCase() === "nosniff" ? null : `value is "${v}", expected "nosniff"`),
  },
  {
    name: "x-frame-options",
    missingRule: "headers/xfo-missing",
    validate: (v) =>
      /^(deny|sameorigin)$/i.test(v.trim()) ? null : `value is "${v}", expected DENY or SAMEORIGIN`,
  },
  {
    name: "referrer-policy",
    missingRule: "headers/referrer-policy-missing",
    // Present-but-leaky is worse than a clear absence: reject the values that send a
    // full URL cross-origin. The privacy-preserving set is what the site actually ships.
    validate: (v) => {
      const ok = new Set([
        "no-referrer",
        "no-referrer-when-downgrade",
        "same-origin",
        "strict-origin",
        "strict-origin-when-cross-origin",
        "origin",
        "origin-when-cross-origin",
      ]);
      // A Referrer-Policy may be a comma-separated fallback list; the last token the
      // browser understands wins, so require every token to be an allowed one.
      const tokens = v.split(",").map((t) => t.trim().toLowerCase()).filter(Boolean);
      const leaky = tokens.filter((t) => !ok.has(t) || t === "unsafe-url");
      return leaky.length ? `value "${v}" contains a non-private token (${leaky.join(", ")})` : null;
    },
  },
  {
    name: "permissions-policy",
    missingRule: "headers/permissions-policy-missing",
    // Presence is not enough: a policy that grants a powerful feature to `*` is no
    // protection. Flag a wildcard allow-list on the features this site never uses.
    validate: (v) => {
      const overbroad: string[] = [];
      for (const m of v.matchAll(/([a-z-]+)\s*=\s*(\*|\([^)]*\*[^)]*\))/gi)) {
        const feature = (m[1] ?? "").toLowerCase();
        if (["camera", "microphone", "geolocation", "payment", "usb", "midi", "magnetometer", "gyroscope", "accelerometer"].includes(feature)) {
          overbroad.push(feature);
        }
      }
      return overbroad.length ? `powerful feature(s) allowed too broadly: ${overbroad.join(", ")}` : null;
    },
  },
  { name: "cross-origin-opener-policy", missingRule: "headers/coop-missing" },
  { name: "cross-origin-resource-policy", missingRule: "headers/corp-missing" },
];

/* ---- CSP expectations ------------------------------------------------------ */

// Directives the CSP must contain. Absence of any -> headers/csp-weak.
export const CSP_REQUIRED_DIRECTIVES = [
  "default-src",
  "script-src",
  "object-src",
  "base-uri",
  "frame-ancestors",
  "form-action",
] as const;

// script-src must not contain these tokens (they defeat the point of the policy).
export const CSP_FORBIDDEN_SCRIPT_TOKENS = ["'unsafe-inline'", "'unsafe-eval'"];

/* ---- RFC 9116 -------------------------------------------------------------- */

export const RFC9116_PATH = "/.well-known/security.txt";
// Fields that MUST appear (RFC 9116 §2.5). Expires and Contact are required by the RFC.
export const RFC9116_REQUIRED_FIELDS = ["contact", "expires"] as const;
// Warn when Expires is within this many days (a stale file reads as neglected).
export const RFC9116_EXPIRES_WARN_DAYS = 30;

/* ---- exposure probing ------------------------------------------------------ */

// Paths an attacker checks first. Any that returns a 200 with real content is a
// finding — most should 404. Kept deliberately broad; the check tolerates 404/redirect.
export const SENSITIVE_PATHS: string[] = [
  "/.git/config",
  "/.git/HEAD",
  "/.env",
  "/.env.local",
  "/.env.production",
  "/.npmrc",
  "/package.json",
  "/package-lock.json",
  "/tsconfig.json",
  "/eleventy.config.mts",
  "/wrangler.toml",
  "/functions/_middleware.ts",
  "/_headers",
  "/_redirects",
  "/.DS_Store",
  "/.gitignore",
  "/node_modules/",
  "/src/",
  "/scripts/",
  "/.well-known/", // should not list
  "/CHANGELOG.md",
  "/.vscode/settings.json",
  "/.idea/workspace.xml",
];

/* ---- secret scanning ------------------------------------------------------- */

// Patterns that look like a leaked credential in shipped HTML/JS. Each has a label.
export const SECRET_PATTERNS: { label: string; re: RegExp }[] = [
  { label: "AWS access key id", re: /\bAKIA[0-9A-Z]{16}\b/ },
  { label: "Google API key", re: /\bAIza[0-9A-Za-z\-_]{35}\b/ },
  { label: "Slack token", re: /\bxox[baprs]-[0-9A-Za-z-]{10,}\b/ },
  { label: "GitHub token", re: /\bghp_[0-9A-Za-z]{36}\b/ },
  { label: "Stripe secret key", re: /\bsk_live_[0-9A-Za-z]{24,}\b/ },
  { label: "Resend API key", re: /\bre_[0-9A-Za-z]{20,}\b/ },
  { label: "generic PEM private key", re: /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/ },
  { label: "generic bearer secret", re: /\b(?:api[_-]?key|secret|password|token)\s*[:=]\s*["'][0-9A-Za-z\-_]{16,}["']/i },
];

// Public identifiers that MATCH a secret pattern but are meant to ship — the GA4
// measurement ids and the Clarity project id are in every page's source on purpose.
// Anything here is subtracted from secret hits before they become findings.
export const PUBLIC_ALLOW: string[] = [
  "G-CZ1JYCB5TK",
  "G-EQTNPY721G",
  "josp89y34k",
];

/* ---- accepted-exception ledger --------------------------------------------- */

export interface Exception {
  /** ruleId to accept. */
  id: string;
  /** Optional target predicate — accept only where this matches the target label. */
  target?: (target: string) => boolean;
  reason: string;
  since?: string;
  review?: string;
}

// The ONLY deliberately-accepted gaps. Edit here, in a diff, to accept a risk.
export const ACCEPTED: Exception[] = [
  {
    id: "headers/hsts-missing",
    reason:
      "HSTS deferred by the site owner: a long max-age is effectively irreversible and commits every subdomain (mcp.imqueue.org included) to HTTPS-only. To be enabled once that is confirmed. Remote mode still reports the live truth.",
    since: "2026-08-27",
    review: "2026-11-01",
  },
  {
    id: "abuse/no-rate-limit",
    reason:
      "Anti-automation on the two email endpoints is an owner-side edge control (a Cloudflare WAF rate-limiting rule or Turnstile) that the harness cannot verify non-destructively — sending a burst is exactly the DoS the assessment forbids. Tracked as an accepted risk and surfaced in every report so it is visible, not buried in another rule's remediation. Review confirms the WAF rule/Turnstile is in place.",
    since: "2026-08-28",
    review: "2026-11-01",
  },
  {
    id: "headers/csp-style-unsafe-inline",
    reason:
      "style-src keeps 'unsafe-inline': ~1,900 pages ship inline style attributes, so removing it would break the site, and style injection is low-risk relative to script (script-src takes no such shortcut — it is hash-pinned). Documented trade-off, not an oversight.",
    since: "2026-08-28",
  },
  {
    id: "rfc9116/unsigned",
    reason:
      "security.txt is generated per request at the edge (lib/security-txt.ts), so a static detached OpenPGP signature would not match. RFC 9116 §2.3 makes signing a SHOULD, not a MUST; the file is served over TLS from the canonical origin. Deliberately unsigned.",
    since: "2026-08-28",
  },
];

/* ---- Planning-phase scope (NIST SP 800-115 §3.1 / PTES Pre-engagement) ------ */

// Coded once so the deliverable carries an explicit scope and rules of engagement,
// rather than leaving them implicit. Rendered as §2 of the pentest report.
export const SCOPE: ScopeInfo = {
  inScope: [
    "imqueue.org (docs edition) and imqueue.com (commercial edition) — the two Cloudflare Pages projects built from this repository.",
    "The www.* aliases of both, and the built static output plus the Pages Functions in functions/ (contact, message, the /api/<pkg>/ redirect proxies, the dynamic /.well-known/security.txt).",
  ],
  outOfScope: [
    "mcp.imqueue.org — a separate deployment and repository (the MCP server), not built here. Probe it only with an explicit --url.",
    "imqueue.net — parked, 301s to the canonical site.",
    "Third-party services themselves (Resend, Google Analytics, Microsoft Clarity, @fontsource) — only how this site loads and is exposed to them is in scope.",
    "Availability / load / DoS testing, and any destructive action.",
  ],
  rulesOfEngagement: [
    "Non-destructive only: no data is modified and no mail is ever sent — the email endpoints are exercised solely through the honeypot (remote) or the config-error path (local).",
    "Local mode boots the built editions behind the real Pages handler and never leaves the machine.",
    "Remote mode makes plain HTTPS requests to the live edge and reports what it serves; it sends no burst and mutates nothing.",
    "Authorization: the operator runs this only against origins they own or are permitted to test.",
  ],
  assumptions: [
    "The deployed routes match functions/ in this checkout (the redirect proxies are generated from it).",
    "Public identifiers that resemble secrets (GA4 measurement ids, the Clarity project id) are listed in PUBLIC_ALLOW and are meant to ship.",
  ],
  limitations: [
    "The gating run (check:security) is LOCAL and cannot see edge-only behaviour: zone-level Transform Rules (a re-injected Access-Control-Allow-Origin), TLS/HSTS, WAF/rate-limits, the CDN cache, and the Pages-owned /_headers, /_redirects and /robots.txt. Those are only observed in a manual `pentest --target remote` run, which gates nothing.",
    "No logging/monitoring/detection review is performed — an automated run has no access to the edge logs (OWASP A09 is out of scope for this reason).",
    "Rate-limiting on the email endpoints (abuse/no-rate-limit) is an edge control the harness cannot confirm; it is tracked in the accepted-risk ledger.",
  ],
};

/** The accepted exception matching this finding, if any. */
export function acceptedFor(id: string, target: string): Exception | undefined {
  return ACCEPTED.find((e) => e.id === id && (!e.target || e.target(target)));
}
