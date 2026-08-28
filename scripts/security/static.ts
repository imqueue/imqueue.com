// scripts/security/static.ts — the passive half of the assessment: everything that
// can be judged by reading a response or a built artefact without attacking it.
// Response-header grading (the securityheaders.com / Mozilla Observatory surface),
// CSP shape and inline-script hash coverage, RFC 9116 security.txt, HTML hygiene
// (noopener / mixed content / inline handlers / form actions / SRI), and a secret
// scan of the shipped HTML and JS.

import { readFileSync } from "node:fs";
import path from "node:path";

import type { Report, Sink } from "./lib.ts";
import {
  rule,
  SECURITY_HEADERS,
  CSP_REQUIRED_DIRECTIVES,
  CSP_FORBIDDEN_SCRIPT_TOKENS,
  RFC9116_PATH,
  RFC9116_REQUIRED_FIELDS,
  RFC9116_EXPIRES_WARN_DAYS,
  SECRET_PATTERNS,
  PUBLIC_ALLOW,
} from "./policy.ts";
import { cspHashesForSite } from "../lib/csp.ts";
import { listHtmlUrls, getHtml, discoverForms, discoverExternalOrigins } from "./discovery.ts";
import { walkSite, type Target } from "./target.ts";

/* ---- helpers --------------------------------------------------------------- */

interface Occurrence {
  loc: string;
  detail?: string;
}

/** Emit one finding per rule for a batch of occurrences (never one-per-page), or pass. */
function aggregate(sink: Sink, ruleId: string, occ: Occurrence[]): void {
  if (!occ.length) {
    sink.pass(ruleId);
    return;
  }

  const sample = occ
    .slice(0, 5)
    .map((o) => (o.detail ? `${o.loc} (${o.detail})` : o.loc))
    .join("; ");

  sink.add(rule(ruleId), {
    evidence: `${occ.length} occurrence(s); e.g. ${sample}`,
  });
}

/** Parse a CSP header value into directive -> sources[]. */
function parseCsp(value: string): Map<string, string[]> {
  const map = new Map<string, string[]>();

  for (const part of value.split(";")) {
    const tokens = part.trim().split(/\s+/).filter(Boolean);
    const name = tokens[0];
    if (!name) continue;
    map.set(name.toLowerCase(), tokens.slice(1));
  }

  return map;
}

/* ---- response headers ------------------------------------------------------ */

export async function checkResponseHeaders(target: Target, sink: Sink): Promise<void> {
  const res = await target.fetch("/");
  const h = res.headers;

  // Simple present/valid headers.
  for (const policy of SECURITY_HEADERS) {
    const value = h.get(policy.name);

    if (value === null) {
      sink.add(rule(policy.missingRule), { location: "/" });
    } else if (policy.validate) {
      const bad = policy.validate(value);
      if (bad) sink.add(rule(policy.missingRule), { location: "/", evidence: bad });
      else sink.pass(policy.missingRule);
    } else {
      sink.pass(policy.missingRule);
    }
  }

  // HSTS — its own rule so the exception ledger (policy.ACCEPTED) can accept it.
  if (h.get("strict-transport-security") === null) {
    sink.add(rule("headers/hsts-missing"), { location: "/" });
  } else {
    sink.pass("headers/hsts-missing");
  }

  // CSP presence + shape.
  const csp = h.get("content-security-policy");

  if (!csp || csp.includes("__CSP__")) {
    sink.add(rule("headers/csp-missing"), {
      location: "/",
      evidence: csp ? "CSP placeholder was not stamped at build time" : undefined,
    });
  } else {
    const directives = parseCsp(csp);

    for (const req of CSP_REQUIRED_DIRECTIVES) {
      if (!directives.has(req)) {
        sink.add(rule("headers/csp-weak"), { location: "/", evidence: `missing directive: ${req}` });
      }
    }

    const scriptSrc = directives.get("script-src") ?? directives.get("default-src") ?? [];
    for (const bad of CSP_FORBIDDEN_SCRIPT_TOKENS) {
      if (scriptSrc.includes(bad)) {
        sink.add(rule("headers/csp-unsafe-script"), { location: "/", evidence: `script-src contains ${bad}` });
      }
    }

    if (!directives.has("frame-ancestors")) {
      sink.add(rule("headers/frame-ancestors-missing"), { location: "/" });
    }

    // style-src 'unsafe-inline' — a deliberate, ledger-accepted trade-off (the site
    // ships inline style attributes across ~1,900 pages). Reported so it is visible
    // and auditable rather than silent; policy.ACCEPTED keeps it from failing.
    const styleSrc = directives.get("style-src") ?? directives.get("default-src") ?? [];
    if (styleSrc.includes("'unsafe-inline'")) {
      sink.add(rule("headers/csp-style-unsafe-inline"), {
        location: "/",
        evidence: "style-src contains 'unsafe-inline'",
      });
    } else {
      sink.pass("headers/csp-style-unsafe-inline");
    }

    // A well-formed, non-unsafe CSP with all required directives passes.
    if (
      CSP_REQUIRED_DIRECTIVES.every((d) => directives.has(d)) &&
      !CSP_FORBIDDEN_SCRIPT_TOKENS.some((t) => scriptSrc.includes(t))
    ) {
      sink.pass("headers/csp-missing");
    }
  }

  // Framework/version disclosure.
  const poweredBy = h.get("x-powered-by");
  if (poweredBy) sink.add(rule("headers/powered-by"), { location: "/", evidence: `X-Powered-By: ${poweredBy}` });
  else sink.pass("headers/powered-by");

  const server = h.get("server");
  if (server && /\d/.test(server)) {
    sink.add(rule("headers/server-version-leak"), { location: "/", evidence: `Server: ${server}` });
  } else {
    sink.pass("headers/server-version-leak");
  }
}

/* ---- CSP inline-script coverage (local only) ------------------------------- */

// Prove the enforcing CSP allows every inline script the build actually emitted —
// the check that keeps an added-and-unhashed inline script from shipping and being
// blocked in production. Needs the built HTML and the built _headers, so local only.
export async function checkCspInlineCoverage(target: Target, sink: Sink): Promise<void> {
  if (target.kind !== "local" || !target.siteDir) return;

  const res = await target.fetch("/");
  const csp = res.headers.get("content-security-policy") ?? "";
  const scriptSrc = parseCsp(csp).get("script-src") ?? [];
  const required = cspHashesForSite(target.siteDir); // 'sha256-…' tokens
  const missing = required.filter((hash) => !scriptSrc.includes(hash));

  if (missing.length) {
    sink.add(rule("headers/csp-inline-unhashed"), {
      location: target.siteDir,
      evidence: `${missing.length} inline script hash(es) not in script-src: ${missing.slice(0, 3).join(", ")}`,
    });
  } else {
    sink.pass("headers/csp-inline-unhashed");
  }
}

/* ---- header set on a Function response (not just the static /) -------------- */

// checkResponseHeaders grades `/`, a static HTML document. The dynamic security.txt is
// the one Function GET the harness can hit non-destructively, so grade IT too — proving
// a Function response is not shipped bare (E5). It is served text/plain, so the header
// that matters is X-Content-Type-Options: nosniff (a CSP governs document/script
// loading and is meaningless on a plain-text body, so it is deliberately NOT asserted
// here — the /* CSP is graded on the HTML surface by checkResponseHeaders). The
// security.txt handler sets nosniff itself, so this survives even where the edge does
// not apply the /* _headers set to a Function response.
export async function checkFunctionHeaders(target: Target, sink: Sink): Promise<void> {
  const res = await target.fetch(RFC9116_PATH);
  if (res.status !== 200) {
    // The security.txt check reports the absence; nothing to grade here.
    sink.skip("headers/xcto-missing@function", `security.txt returned ${res.status}; no Function response to grade`);
    return;
  }

  if ((res.headers.get("x-content-type-options") ?? "").trim().toLowerCase() !== "nosniff") {
    sink.add(rule("headers/xcto-missing"), {
      location: RFC9116_PATH,
      evidence: "Function response is missing X-Content-Type-Options: nosniff",
    });
  } else {
    sink.pass("headers/xcto-missing");
  }
}

/* ---- consent gating of analytics (privacy) --------------------------------- */

// The site is cookieless unless a visitor opts in: GA4 and Clarity ship PARKED as
// `type="text/plain"` and js/consent.js activates them only after consent. Assert the
// built output actually parks them — a live <script src> to either host, or an
// executable inline loader, would mean tracking before consent. If a build carries no
// analytics at all (a dev/serve build), there is nothing to gate: skip, don't pass.
const ANALYTICS_HOSTS = /googletagmanager\.com|google-analytics\.com|clarity\.ms/i;

export async function checkConsentGate(target: Target, sink: Sink): Promise<void> {
  const urls = await listHtmlUrls(target);
  const violations: Occurrence[] = [];
  let sawAnalytics = false;

  for (const url of urls) {
    const html = await getHtml(target, url);
    if (!html) continue;

    for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
      const attrs = m[1] ?? "";
      const body = m[2] ?? "";
      const refsAnalytics = ANALYTICS_HOSTS.test(attrs) || ANALYTICS_HOSTS.test(body);
      if (!refsAnalytics) continue;
      sawAnalytics = true;

      const type = /\btype\s*=\s*["']([^"']*)["']/i.exec(attrs)?.[1]?.toLowerCase() ?? "";
      const parked = type === "text/plain"; // consent.js only ever activates text/plain tags

      if (!parked) {
        violations.push({ loc: url, detail: `live analytics tag (type="${type || "(none)"}")` });
      }
    }
  }

  if (!sawAnalytics) {
    sink.skip("privacy/consent-not-gated", "no GA4/Clarity loaders in this build (dev/serve build carries none)");
    return;
  }

  aggregate(sink, "privacy/consent-not-gated", violations);
}

/* ---- RFC 9116 security.txt ------------------------------------------------- */

// RFC 3339 date-time (what RFC 9116 §2.5.5 requires for Expires). Deliberately strict
// on shape before handing the string to Date(), whose parser is lenient enough to
// accept things the RFC does not.
const RFC3339_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

// A Contact value must be a URI (mailto:/tel:/https:) per RFC 9116 §2.5.3.
const CONTACT_SCHEME_RE = /^(mailto:|tel:|https?:\/\/)/i;

export async function checkSecurityTxt(target: Target, sink: Sink): Promise<void> {
  const res = await target.fetch(RFC9116_PATH);

  if (res.status !== 200) {
    sink.add(rule("rfc9116/missing"), { location: RFC9116_PATH, evidence: `status ${res.status}` });
    return;
  }

  // R8: text/plain AND charset=utf-8 (RFC 9116 §3 gives utf-8 as the media type param).
  const ct = res.contentType.toLowerCase();
  if (!ct.includes("text/plain") || !ct.includes("charset=utf-8")) {
    sink.add(rule("rfc9116/served-type"), {
      location: RFC9116_PATH,
      evidence: `Content-Type: ${res.contentType || "(none)"} (want text/plain; charset=utf-8)`,
    });
  } else {
    sink.pass("rfc9116/served-type");
  }

  // Parse fields (case-insensitive keys, one per line). Collect malformed lines and
  // empty values so R6 can flag them.
  const fields = new Map<string, string[]>();
  const malformed: string[] = [];
  const emptyValued: string[] = [];
  for (const line of res.body.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const idx = t.indexOf(":");
    if (idx === -1) {
      malformed.push(t.slice(0, 40)); // R6: a non-comment line with no colon
      continue;
    }
    const key = t.slice(0, idx).trim().toLowerCase();
    const val = t.slice(idx + 1).trim();
    if (!val) {
      emptyValued.push(key); // R6: present key, empty value — treated as missing below
      continue;
    }
    fields.set(key, [...(fields.get(key) ?? []), val]);
  }

  // Accumulate every conformance defect into one rfc9116/invalid finding so a single
  // file does not spray the report; expires severity is routed to its own rules.
  const invalid: string[] = [];

  // R6: required field present-but-empty counts as missing.
  const missingFields = RFC9116_REQUIRED_FIELDS.filter((f) => !fields.has(f));
  if (missingFields.length) invalid.push(`missing required field(s): ${missingFields.join(", ")}`);
  if (emptyValued.length) invalid.push(`empty value(s) for: ${[...new Set(emptyValued)].join(", ")}`);
  if (malformed.length) invalid.push(`line(s) without a "key: value" shape: ${malformed.join(" | ")}`);

  // R1: every Contact value must be a URI (mailto:/tel:/https:).
  for (const c of fields.get("contact") ?? []) {
    if (!CONTACT_SCHEME_RE.test(c)) invalid.push(`Contact is not a URI: "${c}"`);
  }

  // R4/R5: at most one Expires, Canonical is fine to repeat, Preferred-Languages once.
  if ((fields.get("expires")?.length ?? 0) > 1) invalid.push("more than one Expires field");
  if ((fields.get("preferred-languages")?.length ?? 0) > 1) invalid.push("more than one Preferred-Languages field");

  // R2: Canonical must parse; on remote it must be https and match host+path.
  for (const canon of fields.get("canonical") ?? []) {
    let u: URL | null = null;
    try {
      u = new URL(canon);
    } catch {
      invalid.push(`Canonical is not a valid URL: "${canon}"`);
      continue;
    }
    if (u.protocol !== "https:") invalid.push(`Canonical is not https: "${canon}"`);
    // Host comparison only makes sense against a real edge; skip on the loopback
    // local target (it answers on 127.0.0.1 but the file names the edition host).
    if (target.kind === "remote") {
      if (u.host !== target.host) invalid.push(`Canonical host ${u.host} != ${target.host}`);
      if (u.pathname !== RFC9116_PATH) invalid.push(`Canonical path ${u.pathname} != ${RFC9116_PATH}`);
    }
  }

  // Expires: R7 strict RFC-3339 shape, then future / near / far (R3).
  const expiresRaw = fields.get("expires")?.[0];
  if (expiresRaw) {
    const expires = new Date(expiresRaw);
    const now = Date.now();

    if (!RFC3339_RE.test(expiresRaw) || Number.isNaN(expires.getTime())) {
      invalid.push(`Expires is not an RFC 3339 date-time: "${expiresRaw}"`);
    } else if (expires.getTime() <= now) {
      sink.add(rule("rfc9116/expires-soon"), { location: RFC9116_PATH, evidence: `Expires is in the past: ${expiresRaw}` });
    } else {
      const daysOut = (expires.getTime() - now) / (24 * 60 * 60 * 1000);
      if (daysOut > 366) {
        // R3: >1 year is a SHOULD, so it is its own low rule, not rfc9116/invalid.
        sink.add(rule("rfc9116/expires-far"), { location: RFC9116_PATH, evidence: `Expires is more than a year out (${Math.round(daysOut)} days)` });
      } else if (daysOut < RFC9116_EXPIRES_WARN_DAYS) {
        sink.add(rule("rfc9116/expires-soon"), { location: RFC9116_PATH, evidence: `Expires is only ${Math.round(daysOut)} days out` });
      } else {
        sink.pass("rfc9116/expires-soon");
      }
    }
  }

  if (invalid.length) {
    sink.add(rule("rfc9116/invalid"), { location: RFC9116_PATH, evidence: invalid.join("; ") });
  } else {
    sink.pass("rfc9116/invalid");
  }

  // R9: signing is a SHOULD; its absence is a deliberate, ledger-accepted decision
  // for a per-request dynamic endpoint. Reported (info) so the decision stays visible.
  const signed = fields.has("signature") || (await target.fetch(`${RFC9116_PATH}.sig`)).status === 200;
  if (signed) {
    sink.pass("rfc9116/unsigned");
  } else {
    sink.add(rule("rfc9116/unsigned"), { location: RFC9116_PATH, evidence: "no Signature field and no .sig alongside" });
  }
}

/* ---- HTML hygiene ---------------------------------------------------------- */

const EVENT_HANDLER_RE =
  /\son(?:abort|blur|change|click|contextmenu|copy|cut|dblclick|drag|drop|error|focus|input|keydown|keypress|keyup|load|mousedown|mouseenter|mouseleave|mousemove|mouseout|mouseover|mouseup|paste|reset|resize|scroll|select|submit|toggle|wheel)\s*=/i;

// Escaped/quoted markup inside these regions is documentation, not a live inline
// handler — a tutorial showing `<button onclick="…">` in a <code> block is not a CSP
// violation. Strip them (and HTML comments) before the inline-handler / javascript:
// tests so those tests fire only on real, executable markup (E6). Only REMOVES text,
// so it can never introduce a new match.
function stripNonExecutable(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<pre\b[^>]*>[\s\S]*?<\/pre>/gi, " ")
    .replace(/<code\b[^>]*>[\s\S]*?<\/code>/gi, " ")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<textarea\b[^>]*>[\s\S]*?<\/textarea>/gi, " ");
}

export async function checkHtmlHygiene(target: Target, sink: Sink): Promise<void> {
  const urls = await listHtmlUrls(target);

  const noopener: Occurrence[] = [];
  const mixed: Occurrence[] = [];
  const inlineHandler: Occurrence[] = [];
  const insecureForm: Occurrence[] = [];
  const sri: Occurrence[] = [];
  const allForms: { page: string; action: string; method: string }[] = [];
  const origins = new Set<string>();

  for (const url of urls) {
    const html = await getHtml(target, url);
    if (!html) continue;

    // target=_blank without rel=noopener
    for (const m of html.matchAll(/<a\b[^>]*\btarget\s*=\s*["']_blank["'][^>]*>/gi)) {
      const rel = /\brel\s*=\s*["']([^"']*)["']/i.exec(m[0])?.[1]?.toLowerCase() ?? "";
      if (!/\bnoopener\b|\bnoreferrer\b/.test(rel)) {
        noopener.push({ loc: url, detail: m[0].slice(0, 80) });
      }
    }

    // Insecure subresources on script/link/img/media/iframe. `\s(?:src|data)`, not
    // `\bsrc`, so a parked `data-src` (the consent-gated analytics loader) is not
    // mistaken for a loaded `src`.
    for (const m of html.matchAll(
      /<(script|img|source|video|audio|iframe|embed|object)\b[^>]*\s(?:src|data)\s*=\s*["']http:\/\/[^"']+/gi,
    )) {
      mixed.push({ loc: url, detail: m[0].slice(0, 80) });
    }
    for (const m of html.matchAll(/<link\b[^>]*\bhref\s*=\s*["']http:\/\/[^"']+/gi)) {
      const rel = /\brel\s*=\s*["']([^"']*)["']/i.exec(m[0])?.[1]?.toLowerCase() ?? "";
      if (/stylesheet|preload|prefetch|icon|manifest/.test(rel)) mixed.push({ loc: url, detail: m[0].slice(0, 80) });
    }

    // Inline event handlers / javascript: URIs — tested on the executable markup only
    // (code samples, comments and script/style bodies stripped), so a documentation
    // page showing a handler is not mistaken for one the page actually runs.
    const executable = stripNonExecutable(html);
    if (EVENT_HANDLER_RE.test(executable)) inlineHandler.push({ loc: url, detail: "inline on*= handler" });
    if (/\b(?:href|src)\s*=\s*["']javascript:/i.test(executable)) inlineHandler.push({ loc: url, detail: "javascript: URI" });

    // Cross-origin script/style without SRI. Only real, LOADED, cross-origin
    // subresources count: `\ssrc` excludes the parked `data-src` analytics loader,
    // a `type="text/plain"` tag is not executed, and Google/Clarity loaders are
    // versionless (SRI-incompatible by design), so a same-origin or parked tag is
    // never flagged. The site self-hosts its real scripts with relative paths, so
    // this correctly finds nothing unless a genuine cross-origin <script src> lands.
    for (const m of html.matchAll(/<script\b([^>]*)\ssrc\s*=\s*["'](https?:\/\/[^"']+)["']([^>]*)>/gi)) {
      const tag = m[0];
      const src = m[2] ?? "";
      if (/\btype\s*=\s*["']text\/plain/i.test(tag)) continue;
      if (/\bintegrity\s*=/i.test(tag)) continue;
      try {
        if (new URL(src).host === target.host) continue; // same-origin: SRI not required
      } catch {
        continue;
      }
      sri.push({ loc: url, detail: src });
    }
    for (const m of html.matchAll(/<link\b[^>]*\srel\s*=\s*["']stylesheet["'][^>]*>/gi)) {
      const href = /\shref\s*=\s*["'](https?:\/\/[^"']+)["']/i.exec(m[0])?.[1];
      if (!href || /\bintegrity\s*=/i.test(m[0])) continue;
      try {
        if (new URL(href).host === target.host) continue;
      } catch {
        continue;
      }
      sri.push({ loc: url, detail: href });
    }

    // Forms.
    for (const f of discoverForms(html, url)) {
      allForms.push({ page: url, action: f.action, method: f.method });
      if (/^http:\/\//i.test(f.action)) {
        insecureForm.push({ loc: url, detail: `action=${f.action}` });
      } else if (/^https?:\/\//i.test(f.action)) {
        // Absolute action to another host is worth flagging.
        try {
          const host = new URL(f.action).host;
          if (host !== target.host) insecureForm.push({ loc: url, detail: `action host ${host}` });
        } catch {
          /* skip */
        }
      }
    }

    for (const host of discoverExternalOrigins(html)) origins.add(host);
  }

  aggregate(sink, "html/noopener", noopener);
  aggregate(sink, "html/mixed-content", mixed);
  aggregate(sink, "html/inline-handler", inlineHandler);
  aggregate(sink, "html/form-insecure-action", insecureForm);
  aggregate(sink, "html/sri-missing", sri);

  sink.pass("html/hygiene-scan");
}

/* ---- secret scan ----------------------------------------------------------- */

export async function checkSecrets(target: Target, sink: Sink): Promise<void> {
  const texts: { loc: string; text: string }[] = [];

  if (target.kind === "local" && target.siteDir) {
    for (const rel of walkSite(target.siteDir)) {
      if (!/\.(html|js|json|txt|md|xml|css)$/.test(rel)) continue;
      try {
        texts.push({ loc: rel, text: readFileSync(path.join(target.siteDir, rel.slice(1)), "utf8") });
      } catch {
        /* skip unreadable */
      }
    }
  } else {
    // Remote: the shipped HTML, plus the same-origin .js/.json it references — a
    // leaked key is far likelier to sit in a bundle than in the page. Fetch a bounded
    // set of linked scripts/data so the remote scan is not HTML-only.
    const scriptSrcs = new Set<string>();
    for (const url of await listHtmlUrls(target)) {
      const html = await getHtml(target, url);
      if (!html) continue;
      texts.push({ loc: url, text: html });
      for (const m of html.matchAll(/\b(?:src|href)\s*=\s*["']([^"']+\.(?:js|json))["']/gi)) {
        const raw = m[1];
        if (!raw) continue;
        try {
          const u = new URL(raw, target.origin);
          if (u.host === target.host) scriptSrcs.add(u.pathname + u.search);
        } catch {
          /* skip */
        }
      }
    }
    const REMOTE_ASSET_LIMIT = 40;
    let fetched = 0;
    for (const src of scriptSrcs) {
      if (fetched >= REMOTE_ASSET_LIMIT) break;
      const res = await target.fetch(src);
      if (res.status === 200 && res.body) {
        texts.push({ loc: src, text: res.body });
        fetched += 1;
      }
    }
  }

  const hits: Occurrence[] = [];

  for (const { loc, text } of texts) {
    for (const { label, re } of SECRET_PATTERNS) {
      // matchAll (with a global flag) so more than one distinct hit per pattern per
      // file is seen — the first match being an allow-listed public id must not hide a
      // real secret later in the same file.
      const g = re.global ? re : new RegExp(re.source, re.flags + "g");
      for (const m of text.matchAll(g)) {
        if (!PUBLIC_ALLOW.some((pub) => m[0].includes(pub))) {
          hits.push({ loc, detail: label });
          break; // one occurrence per (file, pattern) is enough evidence; avoid spam
        }
      }
    }
  }

  aggregate(sink, "html/secret-in-source", hits);
}

/* ---- entry ----------------------------------------------------------------- */

export async function runStaticChecks(target: Target, sink: Sink, report: Report): Promise<void> {
  await checkResponseHeaders(target, sink);
  await checkFunctionHeaders(target, sink);
  await checkCspInlineCoverage(target, sink);
  await checkSecurityTxt(target, sink);
  await checkHtmlHygiene(target, sink);
  await checkConsentGate(target, sink);
  await checkSecrets(target, sink);

  report.note(`${target.label}: static analysis complete`);
}
