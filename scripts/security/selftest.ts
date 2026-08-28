#!/usr/bin/env node
// scripts/security/selftest.ts — the tests-of-the-tests.
//
// The failure mode a policy-as-baseline tripwire cannot see on its own: a check whose
// regex or comparison silently stops matching. `sink.pass` is recorded on NO emission,
// so a broken check looks exactly like a clean site — green, and wrong. These fixtures
// close that gap: every check function is exercised against a KNOWN-BAD input (it must
// produce its finding) and a CLEAN input (it must not). If a check regresses to always-
// pass, a known-bad fixture goes green here and this file fails, before check:security
// is ever trusted.
//
// Pure and offline: checks are driven through a scripted fake Target, so nothing is
// built, fetched or read from disk. check-security.ts runs this first; it is also its
// own npm script (check:security:selftest).

import { Report, type Finding } from "./lib.ts";
import {
  SECURITY_HEADERS,
  SECRET_PATTERNS,
  PUBLIC_ALLOW,
} from "./policy.ts";
import type { FetchResult, FetchOptions, Target } from "./target.ts";
import {
  checkResponseHeaders,
  checkSecurityTxt,
} from "./static.ts";
import {
  checkCors,
  checkMethods,
  checkOpenRedirect,
  checkInjection,
} from "./active.ts";

/* ---- a scripted fake target ------------------------------------------------ */

interface RouteSpec {
  status?: number;
  headers?: Record<string, string>;
  body?: string;
  location?: string;
}

// Match a request (path + method) to a scripted response. A function route can inspect
// the FetchOptions (method/headers/body), so a check that probes with PUT or an Origin
// header can be driven precisely.
type Route = RouteSpec | ((path: string, opts: FetchOptions) => RouteSpec);

function toResult(url: string, spec: RouteSpec): FetchResult {
  const headers = new Headers(spec.headers ?? {});
  const status = spec.status ?? 200;
  return {
    url,
    status,
    ok: status >= 200 && status < 300,
    headers,
    body: spec.body ?? "",
    location: spec.location ?? headers.get("location"),
    contentType: headers.get("content-type") ?? "",
    timeMs: 0,
  };
}

function fakeTarget(
  routes: Record<string, Route>,
  opts: { kind?: "local" | "remote"; host?: string; fallback?: RouteSpec } = {},
): Target {
  const host = opts.host ?? "imqueue.org";
  const kind = opts.kind ?? "remote";
  return {
    label: `selftest:${kind}`,
    kind,
    origin: kind === "local" ? "http://127.0.0.1:0" : `https://${host}`,
    host,
    fetch: (pathOrUrl: string, o: FetchOptions = {}) => {
      // Normalise an absolute URL (http→https probe) down to a path for matching.
      let key = pathOrUrl;
      try {
        if (pathOrUrl.startsWith("http")) key = new URL(pathOrUrl).pathname;
      } catch {
        /* keep raw */
      }
      const route = routes[key] ?? routes[pathOrUrl];
      const spec = typeof route === "function" ? route(key, o) : route;
      return Promise.resolve(toResult(pathOrUrl, spec ?? opts.fallback ?? { status: 404, body: "not found" }));
    },
    close: () => Promise.resolve(),
  };
}

/* ---- assertions ------------------------------------------------------------ */

interface Case {
  name: string;
  run: () => Promise<void> | void;
}

const failures: string[] = [];
let ran = 0;

async function check(name: string, fn: () => Promise<void> | void): Promise<void> {
  ran += 1;
  try {
    await fn();
  } catch (err) {
    failures.push(`${name}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

const ids = (findings: Finding[]): string[] => findings.map((f) => f.id);

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

/** Run one check against a target and return the findings it produced. */
async function findingsFrom(
  fn: (t: Target, sink: ReturnType<Report["on"]>) => Promise<void>,
  target: Target,
): Promise<Finding[]> {
  const report = new Report();
  await fn(target, report.on(target.label));
  return report.findings;
}

/* ---- a headers set that should fully pass ---------------------------------- */

const CLEAN_CSP =
  "default-src 'self'; script-src 'self' 'sha256-abc'; object-src 'none'; base-uri 'self'; " +
  "frame-ancestors 'self'; form-action 'self'; style-src 'self'";

const CLEAN_HEADERS: Record<string, string> = {
  "content-type": "text/html; charset=utf-8",
  "x-content-type-options": "nosniff",
  "x-frame-options": "SAMEORIGIN",
  "referrer-policy": "strict-origin-when-cross-origin",
  "permissions-policy": "camera=(), microphone=(), geolocation=()",
  "cross-origin-opener-policy": "same-origin",
  "cross-origin-resource-policy": "same-origin",
  "strict-transport-security": "max-age=31536000; includeSubDomains",
  "content-security-policy": CLEAN_CSP,
};

/* ---- the cases ------------------------------------------------------------- */

const CASES: Case[] = [
  /* header value validators (pure) --------------------------------------- */
  {
    name: "Referrer-Policy validator: rejects unsafe-url, accepts a private value",
    run() {
      const rp = SECURITY_HEADERS.find((h) => h.name === "referrer-policy");
      assert(!!rp?.validate, "referrer-policy has no validate()");
      assert(rp!.validate!("strict-origin-when-cross-origin") === null, "clean referrer-policy should pass");
      assert(rp!.validate!("unsafe-url") !== null, "unsafe-url referrer-policy must be flagged");
    },
  },
  {
    name: "Permissions-Policy validator: flags a wildcard on a powerful feature",
    run() {
      const pp = SECURITY_HEADERS.find((h) => h.name === "permissions-policy");
      assert(!!pp?.validate, "permissions-policy has no validate()");
      assert(pp!.validate!("camera=(), microphone=()") === null, "restrictive permissions-policy should pass");
      assert(pp!.validate!("camera=*") !== null, "camera=* must be flagged");
    },
  },
  {
    name: "X-Content-Type-Options validator: only nosniff passes",
    run() {
      const x = SECURITY_HEADERS.find((h) => h.name === "x-content-type-options");
      assert(x!.validate!("nosniff") === null, "nosniff should pass");
      assert(x!.validate!("sniff") !== null, "a wrong X-CTO value must be flagged");
    },
  },

  /* checkResponseHeaders -------------------------------------------------- */
  {
    name: "checkResponseHeaders: a fully-hardened response yields no findings",
    async run() {
      const t = fakeTarget({ "/": { headers: CLEAN_HEADERS } });
      const f = await findingsFrom(checkResponseHeaders, t);
      assert(f.length === 0, `clean headers produced findings: ${ids(f).join(", ")}`);
    },
  },
  {
    name: "checkResponseHeaders: a bare response flags the missing headers",
    async run() {
      const t = fakeTarget({ "/": { headers: { "content-type": "text/html" } } });
      const got = ids(await findingsFrom(checkResponseHeaders, t));
      for (const want of ["headers/xcto-missing", "headers/xfo-missing", "headers/csp-missing", "headers/hsts-missing"]) {
        assert(got.includes(want), `missing-headers case did not flag ${want} (got: ${got.join(", ")})`);
      }
    },
  },
  {
    name: "checkResponseHeaders: 'unsafe-inline' in script-src is caught",
    async run() {
      const bad = { ...CLEAN_HEADERS, "content-security-policy": CLEAN_CSP.replace("script-src 'self' 'sha256-abc'", "script-src 'self' 'unsafe-inline'") };
      const got = ids(await findingsFrom(checkResponseHeaders, fakeTarget({ "/": { headers: bad } })));
      assert(got.includes("headers/csp-unsafe-script"), `unsafe-inline script-src not caught (got: ${got.join(", ")})`);
    },
  },
  {
    name: "checkResponseHeaders: 'unsafe-inline' in style-src is reported",
    async run() {
      const bad = { ...CLEAN_HEADERS, "content-security-policy": CLEAN_CSP.replace("style-src 'self'", "style-src 'self' 'unsafe-inline'") };
      const got = ids(await findingsFrom(checkResponseHeaders, fakeTarget({ "/": { headers: bad } })));
      assert(got.includes("headers/csp-style-unsafe-inline"), `style-src unsafe-inline not reported (got: ${got.join(", ")})`);
    },
  },

  /* checkSecurityTxt ------------------------------------------------------ */
  {
    name: "checkSecurityTxt: a conformant file passes",
    async run() {
      const future = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString().replace(/\.\d+Z$/, "Z");
      const body =
        `Contact: mailto:security@imqueue.org\nExpires: ${future}\n` +
        `Preferred-Languages: en\nCanonical: https://imqueue.org/.well-known/security.txt\n`;
      const t = fakeTarget({
        "/.well-known/security.txt": { headers: { "content-type": "text/plain; charset=utf-8" }, body },
        "/.well-known/security.txt.sig": { status: 404 },
      });
      const got = ids(await findingsFrom(checkSecurityTxt, t));
      // Only the info-level rfc9116/unsigned is expected (no .sig), nothing worse.
      const worse = got.filter((id) => id !== "rfc9116/unsigned");
      assert(worse.length === 0, `conformant security.txt produced: ${got.join(", ")}`);
    },
  },
  {
    name: "checkSecurityTxt: missing Expires and a non-URI Contact are flagged",
    async run() {
      const body = `Contact: security@imqueue.org\nPreferred-Languages: en\n`; // no scheme, no Expires
      const t = fakeTarget({
        "/.well-known/security.txt": { headers: { "content-type": "text/plain; charset=utf-8" }, body },
        "/.well-known/security.txt.sig": { status: 404 },
      });
      const got = ids(await findingsFrom(checkSecurityTxt, t));
      assert(got.includes("rfc9116/invalid"), `missing Expires / non-URI Contact not flagged (got: ${got.join(", ")})`);
    },
  },
  {
    name: "checkSecurityTxt: an Expires over a year out is 'expires-far', not 'invalid'",
    async run() {
      const far = new Date(Date.now() + 500 * 24 * 60 * 60 * 1000).toISOString().replace(/\.\d+Z$/, "Z");
      const body = `Contact: mailto:security@imqueue.org\nExpires: ${far}\nCanonical: https://imqueue.org/.well-known/security.txt\n`;
      const t = fakeTarget({
        "/.well-known/security.txt": { headers: { "content-type": "text/plain; charset=utf-8" }, body },
        "/.well-known/security.txt.sig": { status: 404 },
      });
      const got = ids(await findingsFrom(checkSecurityTxt, t));
      assert(got.includes("rfc9116/expires-far"), `far Expires not routed to expires-far (got: ${got.join(", ")})`);
      assert(!got.includes("rfc9116/invalid"), `far Expires wrongly flagged invalid (got: ${got.join(", ")})`);
    },
  },
  {
    name: "checkSecurityTxt: a 404 is rfc9116/missing",
    async run() {
      const t = fakeTarget({ "/.well-known/security.txt": { status: 404 } });
      const got = ids(await findingsFrom(checkSecurityTxt, t));
      assert(got.includes("rfc9116/missing"), `absent security.txt not flagged (got: ${got.join(", ")})`);
    },
  },

  /* checkCors ------------------------------------------------------------- */
  {
    name: "checkCors: a reflected Origin is 'permissive'",
    async run() {
      const t = fakeTarget({
        "/": { headers: { "access-control-allow-origin": "https://scanner.example" } },
        "/api/message": { headers: { "access-control-allow-origin": "https://scanner.example" } },
      });
      const got = ids(await findingsFrom(checkCors, t));
      assert(got.includes("cors/permissive"), `reflected Origin not flagged (got: ${got.join(", ")})`);
    },
  },
  {
    name: "checkCors: a bare wildcard is 'wildcard', not 'permissive'",
    async run() {
      const t = fakeTarget({
        "/": { headers: { "access-control-allow-origin": "*" } },
        "/api/message": { headers: { "access-control-allow-origin": "*" } },
      });
      const got = ids(await findingsFrom(checkCors, t));
      assert(got.includes("cors/wildcard"), `wildcard ACAO not flagged (got: ${got.join(", ")})`);
      assert(!got.includes("cors/permissive"), `bare wildcard wrongly escalated to permissive`);
    },
  },
  {
    name: "checkCors: no ACAO header yields no finding",
    async run() {
      const t = fakeTarget({ "/": {}, "/api/message": {} });
      const got = ids(await findingsFrom(checkCors, t));
      assert(!got.includes("cors/permissive") && !got.includes("cors/wildcard"), `no-CORS case produced a finding: ${got.join(", ")}`);
    },
  },

  /* checkMethods ---------------------------------------------------------- */
  {
    name: "checkMethods: a 2xx on PUT is flagged",
    async run() {
      const t = fakeTarget(
        { "/api/message": (_p, o) => (o.method === "PUT" ? { status: 200, body: "ok" } : { status: 405 }) },
        { fallback: { status: 405 } },
      );
      const got = ids(await findingsFrom(checkMethods, t));
      assert(got.includes("method/dangerous"), `accepted PUT not flagged (got: ${got.join(", ")})`);
    },
  },
  {
    name: "checkMethods: 405 on every dangerous method yields no finding",
    async run() {
      const t = fakeTarget({}, { fallback: { status: 405 } });
      const got = ids(await findingsFrom(checkMethods, t));
      assert(!got.includes("method/dangerous"), `all-405 case produced method/dangerous: ${got.join(", ")}`);
    },
  },

  /* checkOpenRedirect ----------------------------------------------------- */
  {
    name: "checkOpenRedirect: a marker in the Location HOST is flagged",
    async run() {
      const t = fakeTarget({}, { fallback: { status: 302, headers: { location: "https://scanner-open-redirect.example/" } } });
      const got = ids(await findingsFrom(checkOpenRedirect, t));
      assert(got.includes("redirect/open"), `open redirect (marker as host) not flagged (got: ${got.join(", ")})`);
    },
  },
  {
    name: "checkOpenRedirect: a marker only in the PATH is safe",
    async run() {
      // The legitimate imqueue.com→org hop keeps the marker in the path, not the host.
      const t = fakeTarget({}, { fallback: { status: 301, headers: { location: "https://imqueue.org/api/scanner-open-redirect.example" } } });
      const got = ids(await findingsFrom(checkOpenRedirect, t));
      assert(!got.includes("redirect/open"), `marker-in-path wrongly flagged as open redirect`);
    },
  },

  /* checkInjection -------------------------------------------------------- */
  {
    name: "checkInjection: an XSS payload reflected verbatim is caught",
    async run() {
      const t = fakeTarget(
        {},
        { fallback: { status: 200, body: "<html><body><script>alert(1)</script></body></html>" } },
      );
      const got = ids(await findingsFrom(checkInjection, t));
      assert(got.includes("input/xss-reflected"), `reflected XSS not caught (got: ${got.join(", ")})`);
    },
  },

  /* secret patterns ------------------------------------------------------- */
  {
    name: "SECRET_PATTERNS: each pattern matches a representative secret",
    run() {
      // These fixtures are ASSEMBLED from fragments at runtime, never written as one
      // literal, so GitHub push-protection (which scans the source bytes for exactly
      // the shapes below) does not flag this test file — while the assembled value
      // still exercises each regex. `f` is filler in the pattern's own charset.
      const f = (n: number): string => "a".repeat(n);
      const samples: Record<string, string> = {
        "AWS access key id": "AK" + "IA" + "A".repeat(16),
        "Google API key": "AI" + "za" + f(35),
        "Slack token": "xo" + "xb" + "-" + f(12),
        "GitHub token": "gh" + "p_" + f(36),
        "Stripe secret key": "sk" + "_live_" + f(24),
        "Resend API key": "re" + "_" + f(20),
        "generic PEM private key": "-----BEGIN " + "PRIVATE KEY-----",
      };
      for (const { label, re } of SECRET_PATTERNS) {
        const sample = samples[label];
        if (!sample) continue; // the generic bearer pattern is contextual; covered below
        assert(re.test(sample), `pattern "${label}" no longer matches its sample`);
      }
      const bearer = SECRET_PATTERNS.find((p) => p.label === "generic bearer secret");
      assert(!!bearer && bearer.re.test("api" + '_key: "' + f(20) + '"'), "generic bearer pattern regressed");
    },
  },
  {
    name: "PUBLIC_ALLOW: the shipped public ids are subtracted from secret hits",
    run() {
      // A GA4 id matches nothing in SECRET_PATTERNS, but the allow-list is what keeps a
      // future pattern from turning a public id into a finding. Assert the list is real.
      assert(PUBLIC_ALLOW.length > 0, "PUBLIC_ALLOW is empty");
      assert(PUBLIC_ALLOW.some((id) => id.startsWith("G-")), "PUBLIC_ALLOW lost its GA4 ids");
    },
  },
];

/* ---- runner ---------------------------------------------------------------- */

export interface SelfTestResult {
  ran: number;
  failed: number;
  failures: string[];
}

export async function runSelfTests(): Promise<SelfTestResult> {
  for (const c of CASES) await check(c.name, c.run);
  return { ran, failed: failures.length, failures };
}

// Run standalone: `node scripts/security/selftest.ts` (and via check:security:selftest).
if (import.meta.url === `file://${process.argv[1]}`) {
  runSelfTests().then((r) => {
    if (r.failed) {
      console.error(`security self-tests FAILED — ${r.failed}/${r.ran} case(s):`);
      for (const f of r.failures) console.error(`  ✗ ${f}`);
      process.exit(1);
    }
    console.log(`security self-tests passed — ${r.ran} case(s).`);
  });
}
