// scripts/security/headers.ts — the `_headers` layer Cloudflare applies at the edge,
// modelled so the local target can reproduce it and the checks can read every
// response the same way whether it came from localhost or from the live edge.
//
// On Pages, _headers is not part of the Function response — it is applied AFTER, by
// the edge. pages-core.ts therefore does not touch it (staying faithful to what a
// Function actually sees), and this module puts it back for the local target so that
// `curl -I localhost/...` and `curl -I https://imqueue.org/...` carry the same
// security headers. That is what lets one set of header checks grade both.

import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

/** One `_headers` rule: a path pattern and the header lines under it. */
export interface HeaderRule {
  pattern: string;
  /** [name, value] pairs; name kept as written, matched case-insensitively later. */
  headers: [string, string][];
  /** Header names to strip (`! Name` syntax). */
  unset: string[];
}

/**
 * Parse a Cloudflare `_headers` file. Format: a line beginning with `/` (or a full
 * URL) opens a rule; the indented `Name: value` lines beneath it are its headers,
 * and `! Name` removes one. `#` lines and blanks are comments/separators.
 */
export function parseHeaders(text: string): HeaderRule[] {
  const rules: HeaderRule[] = [];
  let current: HeaderRule | null = null;

  for (const raw of text.split("\n")) {
    const line = raw.replace(/\r$/, "");

    if (!line.trim() || line.trim().startsWith("#")) continue;

    // A rule opener is unindented and starts with `/` or a scheme.
    const isOpener = /^\S/.test(line) && (line.startsWith("/") || /^https?:\/\//.test(line));

    if (isOpener) {
      current = { pattern: line.trim(), headers: [], unset: [] };
      rules.push(current);
      continue;
    }

    if (!current) continue; // a header line before any pattern — ignore

    const trimmed = line.trim();

    if (trimmed.startsWith("!")) {
      current.unset.push(trimmed.slice(1).trim().toLowerCase());
      continue;
    }

    const idx = trimmed.indexOf(":");

    if (idx === -1) continue;

    current.headers.push([trimmed.slice(0, idx).trim(), trimmed.slice(idx + 1).trim()]);
  }

  return rules;
}

/** Read and parse the `_headers` at the root of a built edition directory. */
export function readHeadersFile(siteDir: string): HeaderRule[] {
  const file = path.join(siteDir, "_headers");

  return existsSync(file) ? parseHeaders(readFileSync(file, "utf8")) : [];
}

/**
 * Does a `_headers` pattern match a pathname? Cloudflare patterns are path globs:
 * `*` matches any run of characters and `:name` matches a single segment. Only the
 * path is considered (the host part of a full-URL pattern is ignored here — both
 * editions serve their own file).
 */
function patternMatches(pattern: string, pathname: string): boolean {
  // Strip a scheme+host if present, leaving the path glob.
  const p = pattern.replace(/^https?:\/\/[^/]+/, "") || "/";
  const re = new RegExp(
    "^" +
      p
        .replace(/[.+^${}()|[\]\\]/g, "\\$&") // escape regex metachars (not * or :)
        .replace(/\*/g, ".*")
        .replace(/:[A-Za-z0-9_]+/g, "[^/]+") +
      "$",
  );

  return re.test(pathname);
}

/**
 * The effective headers for a pathname: every matching rule applied in file order,
 * a later declaration of the same header overriding an earlier one, and `! Name`
 * removing it. Names are normalised to lower-case, matching how the checks read
 * them off a `Headers` object.
 */
export function effectiveHeaders(rules: HeaderRule[], pathname: string): Map<string, string> {
  const out = new Map<string, string>();

  for (const rule of rules) {
    if (!patternMatches(rule.pattern, pathname)) continue;

    for (const [name, value] of rule.headers) out.set(name.toLowerCase(), value);
    for (const name of rule.unset) out.delete(name);
  }

  return out;
}

/**
 * Return a new Response with the `_headers` for this URL merged onto it, reproducing
 * the edge for the local target. Existing headers set by the Function are kept unless
 * a rule overrides the same name (which is Cloudflare's behaviour for _headers vs
 * Function-set headers on Pages).
 */
export function applyHeaders(response: Response, url: URL, rules: HeaderRule[]): Response {
  const eff = effectiveHeaders(rules, url.pathname);

  if (eff.size === 0) return response;

  const merged = new Response(response.body, response);

  for (const [name, value] of eff) merged.headers.set(name, value);

  return merged;
}
