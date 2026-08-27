// scripts/lib/csp.ts — the Content-Security-Policy, derived from the build.
//
// The one hard problem with an ENFORCING CSP on this site is its inline scripts:
//
//   * the no-FOUC theme init in head.html (constant), and
//   * the GA4 config + Clarity loader, which head.html PARKS as
//     `type="text/plain"` and js/consent.js rebuilds as real inline scripts once a
//     visitor consents — so they execute, and a strict script-src must allow them.
//
// A hardcoded hash list would be wrong the moment an id or a byte changes, and — the
// trap this site is built to avoid — the parked analytics tags are ABSENT from a
// dev/serve build and PRESENT (with the fallback ids in eleventy.config.mts) in a
// production build. So the hashes are computed FROM THE BUILT OUTPUT instead: whatever
// inline scripts a build actually emitted, their hashes are what the CSP allows.
// eleventy.config.mts stamps this into each edition's _headers after every build, and
// scripts/security (the pentest tripwire) recomputes the same set to prove the header
// still covers every inline script — so a new inline script that nobody hashed fails
// the build instead of silently breaking under the enforcing policy in production.

import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync, existsSync, writeFileSync } from "node:fs";
import path from "node:path";

/** The placeholder headers.liquid emits; the after-build hook swaps in the real value. */
export const CSP_PLACEHOLDER = "__CSP__";

/** SHA-256, base64 — the digest form a CSP hash-source uses. */
export function sha256base64(text: string): string {
  return createHash("sha256").update(Buffer.from(text, "utf8")).digest("base64");
}

/**
 * The inline scripts in one HTML document that a strict script-src must account for,
 * as their exact hashable bodies:
 *
 *   1. inline executable <script> with no src (the theme init), and
 *   2. parked <script type="text/plain" data-consent> with NO data-src — consent.js
 *      turns these into inline scripts via `.text = textContent`, so they execute.
 *
 * Excluded: application/ld+json (data, never executed) and parked tags WITH data-src
 * (they become external <script src>, covered by the host allow-list, not a hash).
 * Script element content is raw text with no entity decoding, so the substring here
 * is byte-identical to what the browser hashes.
 */
export function extractInlineScripts(html: string): string[] {
  const bodies: string[] = [];

  for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    const attrs = m[1] ?? "";
    const body = m[2] ?? "";
    const type = /\btype\s*=\s*["']([^"']*)["']/i.exec(attrs)?.[1]?.toLowerCase() ?? "";
    const hasSrc = /\bsrc\s*=/i.test(attrs);
    const hasDataSrc = /\bdata-src\s*=/i.test(attrs);

    if (hasSrc) continue; // external — host allow-list, not a hash
    if (type === "application/ld+json") continue; // data, not executed

    if (type === "text/plain") {
      // A parked tag. It executes only if consent.js will inline it — i.e. it has no
      // data-src (a data-src tag becomes an external load instead).
      if (!hasDataSrc) bodies.push(body);
      continue;
    }

    // No type, or an executable JS type: an ordinary inline script.
    if (type === "" || /^(text|application)\/(java|ecma)script$/.test(type) || type === "module") {
      bodies.push(body);
    }
  }

  return bodies;
}

/** Recursively list *.html under a directory. Self-contained so the build hook needs no other module. */
function walkHtml(dir: string): string[] {
  const out: string[] = [];

  const walk = (d: string): void => {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const abs = path.join(d, entry.name);
      if (entry.isDirectory()) walk(abs);
      else if (entry.name.endsWith(".html")) out.push(abs);
    }
  };

  if (existsSync(dir) && statSync(dir).isDirectory()) walk(dir);

  return out;
}

/** The unique `'sha256-…'` script-source tokens for every inline script the build emitted. */
export function cspHashesForSite(siteDir: string): string[] {
  const seen = new Set<string>();

  for (const file of walkHtml(siteDir)) {
    for (const body of extractInlineScripts(readFileSync(file, "utf8"))) {
      seen.add(`'sha256-${sha256base64(body)}'`);
    }
  }

  return [...seen].sort();
}

/** Whether the built output loads GA4 and/or Clarity, so the CSP allows exactly what it must. */
export function detectAnalytics(siteDir: string): { ga: boolean; clarity: boolean } {
  let ga = false;
  let clarity = false;

  for (const file of walkHtml(siteDir)) {
    const html = readFileSync(file, "utf8");
    if (!ga && html.includes("googletagmanager.com")) ga = true;
    if (!clarity && html.includes("clarity.ms")) clarity = true;
    if (ga && clarity) break;
  }

  return { ga, clarity };
}

/**
 * Assemble the CSP for a built edition. Static directives plus the build-derived
 * script hashes, plus the analytics origins only when that edition actually loads
 * them. No upgrade-insecure-requests: the tutorials link to http://localhost:PORT
 * examples and it would rewrite them. style-src keeps 'unsafe-inline' because 1,900+
 * pages carry inline style attributes — style injection is a far smaller risk than
 * breaking every one, and scripts, which matter, take no such shortcut.
 */
export function buildCspForSite(siteDir: string): string {
  const hashes = cspHashesForSite(siteDir);
  const { ga, clarity } = detectAnalytics(siteDir);

  const scriptSrc = ["'self'", ...hashes];
  const connectSrc = ["'self'"];
  const imgSrc = ["'self'", "data:"];

  if (ga) {
    scriptSrc.push("https://www.googletagmanager.com");
    connectSrc.push(
      "https://www.googletagmanager.com",
      "https://*.google-analytics.com",
      "https://*.analytics.google.com",
    );
    imgSrc.push("https://www.googletagmanager.com", "https://*.google-analytics.com");
  }

  if (clarity) {
    scriptSrc.push("https://www.clarity.ms");
    connectSrc.push("https://*.clarity.ms", "https://c.bing.com");
    imgSrc.push("https://*.clarity.ms");
  }

  return [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'self'",
    "frame-src 'none'",
    "form-action 'self'",
    `script-src ${scriptSrc.join(" ")}`,
    "style-src 'self' 'unsafe-inline'",
    `img-src ${imgSrc.join(" ")}`,
    "font-src 'self'",
    `connect-src ${connectSrc.join(" ")}`,
    "media-src 'self'",
    "manifest-src 'self'",
  ].join("; ");
}

/**
 * Replace the CSP placeholder in a built edition's _headers with the computed policy.
 * Returns true if it stamped, false if there was nothing to do (no placeholder — e.g.
 * a build predating this change). Idempotent: stamping an already-stamped file is a
 * no-op because the placeholder is gone.
 */
export function stampCsp(siteDir: string): boolean {
  const headersFile = path.join(siteDir, "_headers");

  if (!existsSync(headersFile)) return false;

  const text = readFileSync(headersFile, "utf8");

  if (!text.includes(CSP_PLACEHOLDER)) return false;

  const csp = buildCspForSite(siteDir);

  writeFileSync(headersFile, text.split(CSP_PLACEHOLDER).join(csp));

  return true;
}
