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

/* ---- RFC 9116 security.txt ------------------------------------------------- */

export async function checkSecurityTxt(target: Target, sink: Sink): Promise<void> {
  const res = await target.fetch(RFC9116_PATH);

  if (res.status !== 200) {
    sink.add(rule("rfc9116/missing"), { location: RFC9116_PATH, evidence: `status ${res.status}` });
    return;
  }

  if (!res.contentType.toLowerCase().includes("text/plain")) {
    sink.add(rule("rfc9116/served-type"), {
      location: RFC9116_PATH,
      evidence: `Content-Type: ${res.contentType || "(none)"}`,
    });
  } else {
    sink.pass("rfc9116/served-type");
  }

  // Parse fields (case-insensitive keys, one per line).
  const fields = new Map<string, string[]>();
  for (const line of res.body.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const idx = t.indexOf(":");
    if (idx === -1) continue;
    const key = t.slice(0, idx).trim().toLowerCase();
    const val = t.slice(idx + 1).trim();
    fields.set(key, [...(fields.get(key) ?? []), val]);
  }

  const missingFields = RFC9116_REQUIRED_FIELDS.filter((f) => !fields.has(f));
  if (missingFields.length) {
    sink.add(rule("rfc9116/invalid"), {
      location: RFC9116_PATH,
      evidence: `missing required field(s): ${missingFields.join(", ")}`,
    });
  } else {
    sink.pass("rfc9116/invalid");
  }

  // Expires must parse, be in the future, and (RFC 9116) be under a year out.
  const expiresRaw = fields.get("expires")?.[0];
  if (expiresRaw) {
    const expires = new Date(expiresRaw);
    const now = Date.now();

    if (Number.isNaN(expires.getTime())) {
      sink.add(rule("rfc9116/invalid"), { location: RFC9116_PATH, evidence: `Expires is not a valid date: "${expiresRaw}"` });
    } else if (expires.getTime() <= now) {
      sink.add(rule("rfc9116/expires-soon"), { location: RFC9116_PATH, evidence: `Expires is in the past: ${expiresRaw}` });
    } else {
      const daysOut = (expires.getTime() - now) / (24 * 60 * 60 * 1000);
      if (daysOut > 366) {
        sink.add(rule("rfc9116/invalid"), { location: RFC9116_PATH, evidence: `Expires is more than a year out (${Math.round(daysOut)} days)` });
      } else if (daysOut < RFC9116_EXPIRES_WARN_DAYS) {
        sink.add(rule("rfc9116/expires-soon"), { location: RFC9116_PATH, evidence: `Expires is only ${Math.round(daysOut)} days out` });
      } else {
        sink.pass("rfc9116/expires-soon");
      }
    }
  }
}

/* ---- HTML hygiene ---------------------------------------------------------- */

const EVENT_HANDLER_RE =
  /\son(?:abort|blur|change|click|contextmenu|copy|cut|dblclick|drag|drop|error|focus|input|keydown|keypress|keyup|load|mousedown|mouseenter|mouseleave|mousemove|mouseout|mouseover|mouseup|paste|reset|resize|scroll|select|submit|toggle|wheel)\s*=/i;

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

    // Inline event handlers / javascript: URIs.
    if (EVENT_HANDLER_RE.test(html)) inlineHandler.push({ loc: url, detail: "inline on*= handler" });
    if (/\b(?:href|src)\s*=\s*["']javascript:/i.test(html)) inlineHandler.push({ loc: url, detail: "javascript: URI" });

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
    for (const url of await listHtmlUrls(target)) {
      const html = await getHtml(target, url);
      if (html) texts.push({ loc: url, text: html });
    }
  }

  const hits: Occurrence[] = [];

  for (const { loc, text } of texts) {
    for (const { label, re } of SECRET_PATTERNS) {
      const m = re.exec(text);
      if (m && !PUBLIC_ALLOW.some((pub) => m[0].includes(pub))) {
        hits.push({ loc, detail: label });
      }
    }
  }

  aggregate(sink, "html/secret-in-source", hits.length ? hits : []);
}

/* ---- entry ----------------------------------------------------------------- */

export async function runStaticChecks(target: Target, sink: Sink, report: Report): Promise<void> {
  await checkResponseHeaders(target, sink);
  await checkCspInlineCoverage(target, sink);
  await checkSecurityTxt(target, sink);
  await checkHtmlHygiene(target, sink);
  await checkSecrets(target, sink);

  report.note(`${target.label}: static analysis complete`);
}
