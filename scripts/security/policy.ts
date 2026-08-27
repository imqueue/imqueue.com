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

import type { Rule, Severity } from "./lib.ts";

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
    title: "No X-Content-Type-Options: nosniff",
    severity: "medium",
    cwe: [430, 16],
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
    title: "No Cross-Origin-Opener-Policy",
    severity: "low",
    cwe: [1021],
    owasp: ["A05:2021"],
    standards: ["Mozilla Observatory"],
    nist: "Discovery",
    ptes: "Vulnerability Analysis",
    remediation: "Add Cross-Origin-Opener-Policy: same-origin on /*.",
  },
  {
    id: "headers/corp-missing",
    title: "No Cross-Origin-Resource-Policy",
    severity: "info",
    cwe: [200],
    standards: ["Mozilla Observatory"],
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
    title: "No /.well-known/security.txt",
    severity: "medium",
    cwe: [200],
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
    title: "security.txt is not served as text/plain",
    severity: "low",
    standards: ["RFC 9116 §3"],
    nist: "Discovery",
    ptes: "Intelligence Gathering",
    remediation: "Serve /.well-known/security.txt with Content-Type: text/plain; charset=utf-8.",
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
    title: "Server error discloses a stack trace or internal path",
    severity: "high",
    cwe: [209],
    owasp: ["A05:2021"],
    standards: ["OWASP Testing Guide (WSTG-ERRH-01)"],
    nist: "Attack",
    ptes: "Exploitation",
    remediation: "Return a generic error page; log the detail server-side only.",
  },

  /* active endpoint behaviour ------------------------------------------------ */
  {
    id: "disclosure/verbose-error-500",
    title: "Endpoint returns a 5xx on malformed input",
    severity: "medium",
    cwe: [209, 388],
    owasp: ["A05:2021"],
    standards: ["OWASP Testing Guide (WSTG-ERRH-01)"],
    nist: "Attack",
    ptes: "Exploitation",
    remediation: "Return a 4xx for malformed or invalid input; a 5xx there signals an unhandled path that may leak detail.",
  },
  {
    id: "method/dangerous",
    title: "Dangerous HTTP method is accepted",
    severity: "medium",
    cwe: [650],
    owasp: ["A05:2021"],
    standards: ["OWASP Testing Guide (WSTG-CONF-06)"],
    nist: "Attack",
    ptes: "Exploitation",
    remediation: "Reject TRACE/TRACK/PUT/DELETE/CONNECT unless a route genuinely needs them.",
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
    title: "Endpoint echoes an injection payload back to the caller",
    severity: "medium",
    cwe: [79, 74],
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
  { name: "referrer-policy", missingRule: "headers/referrer-policy-missing" },
  { name: "permissions-policy", missingRule: "headers/permissions-policy-missing" },
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
];

/** The accepted exception matching this finding, if any. */
export function acceptedFor(id: string, target: string): Exception | undefined {
  return ACCEPTED.find((e) => e.id === id && (!e.target || e.target(target)));
}
