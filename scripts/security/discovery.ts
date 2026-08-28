// scripts/security/discovery.ts — the NIST "Discovery" / PTES "Intelligence
// Gathering" phase: work out the attack surface from the artefacts rather than a
// hard-coded list, so a newly generated API package, a new form or a new endpoint
// is scanned automatically instead of waiting for someone to remember to add it.
//
// Everything here is read-only. It answers three questions for the checks that
// follow: which endpoints exist, which HTML documents to inspect, and which forms
// and external origins those documents contain.

import { readdirSync, existsSync } from "node:fs";
import path from "node:path";

import { REPO_ROOT } from "../../tests/e2e/server/pages-core.ts";
import { SECURITY_TXT_PATH } from "../../lib/security-txt.ts";
import { walkSite, readSiteFile, type Target, type FetchResult } from "./target.ts";

/** A form found in built HTML. */
export interface FormInfo {
  page: string;
  action: string;
  method: string;
  fieldCount: number;
}

/** The enumerated attack surface. */
export interface Surface {
  /** Endpoint paths worth probing actively. */
  endpoints: string[];
  /** /api/<pkg>/ package slugs with a Function mounted. */
  apiPackages: string[];
  /** Forms discovered in the sampled HTML. */
  forms: FormInfo[];
  /** External origins any sampled page references (host list). */
  externalOrigins: string[];
}

/**
 * Endpoints from the repo's functions/ tree — independent of the target, because
 * the deployed routes are exactly what the generator wrote. Each /api/<pkg>/ dir is
 * a mounted catch-all; contact.ts / message.ts are the two form endpoints; rpc is a
 * package dir. The dynamic security.txt is added explicitly (it lives in the
 * middleware, not a route file).
 */
export function discoverFunctions(): { endpoints: string[]; apiPackages: string[] } {
  const apiDir = path.join(REPO_ROOT, "functions", "api");
  const endpoints: string[] = [SECURITY_TXT_PATH];
  const apiPackages: string[] = [];

  if (existsSync(apiDir)) {
    for (const entry of readdirSync(apiDir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        apiPackages.push(entry.name);
        // A bare "/api/<pkg>" (no trailing content) 301s to /latest/ via the
        // shared handler — worth probing for the redirect behaviour.
        endpoints.push(`/api/${entry.name}/`);
      } else if (/\.(ts|js)$/.test(entry.name) && !entry.name.startsWith("_")) {
        endpoints.push(`/api/${entry.name.replace(/\.(ts|js)$/, "")}`);
      }
    }
  }

  return { endpoints: [...new Set(endpoints)], apiPackages };
}

/**
 * Assemble the full enumerated attack surface for the report's Discovery inventory:
 * endpoints + /api packages from the functions tree, and forms + external origins from
 * a bounded sample of the site's HTML (pages likely to carry a form are always
 * included, so the two email forms are never missed). Read-only; a sample, not a full
 * crawl, because the inventory only needs to name the surface, not exhaust it.
 */
export async function discoverSurface(target: Target, sampleLimit = 40): Promise<Surface> {
  const { endpoints, apiPackages } = discoverFunctions();

  const all = await listHtmlUrls(target);
  const likelyForm = all.filter((u) => /contact|message|support/i.test(u));
  const sample = [...new Set([...likelyForm, ...all])].slice(0, Math.max(sampleLimit, likelyForm.length));

  const forms: FormInfo[] = [];
  const origins = new Set<string>();

  for (const url of sample) {
    const html = await getHtml(target, url);
    if (!html) continue;
    for (const f of discoverForms(html, url)) forms.push(f);
    for (const host of discoverExternalOrigins(html)) origins.add(host);
  }

  return { endpoints, apiPackages, forms, externalOrigins: [...origins].sort() };
}

/* ---- HTML documents to inspect --------------------------------------------- */

/** For local: every built .html file (as a repo-relative site path). For remote: a sample. */
export async function listHtmlUrls(target: Target, remoteSampleLimit = 25): Promise<string[]> {
  if (target.kind === "local" && target.siteDir) {
    return walkSite(target.siteDir).filter((f) => f.endsWith(".html"));
  }

  // Remote: seed with the home page, then pull a sample from the sitemap so the
  // hygiene checks see real content pages, not just the root.
  const urls = new Set<string>(["/"]);

  try {
    const sitemap = await target.fetch("/sitemap.xml");

    if (sitemap.status === 200) {
      const locs = [...sitemap.body.matchAll(/<loc>([^<]+)<\/loc>/g)]
        .map((m) => m[1])
        .filter((x): x is string => Boolean(x));
      for (const loc of locs) {
        try {
          urls.add(new URL(loc).pathname);
        } catch {
          /* skip a malformed loc */
        }
        if (urls.size >= remoteSampleLimit) break;
      }
    }
  } catch {
    /* no sitemap reachable — the home page alone still gets scanned */
  }

  return [...urls];
}

/** Fetch/read one HTML document's text. Local reads the file; remote fetches it. */
export async function getHtml(target: Target, url: string): Promise<string | null> {
  if (target.kind === "local" && target.siteDir) {
    return readSiteFile(target.siteDir, url);
  }

  const res: FetchResult = await target.fetch(url);

  return res.status === 200 && res.contentType.includes("html") ? res.body : null;
}

/* ---- form + origin extraction ---------------------------------------------- */

export function discoverForms(html: string, page: string): FormInfo[] {
  const forms: FormInfo[] = [];

  for (const m of html.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/gi)) {
    const attrs = m[1] ?? "";
    const inner = m[2] ?? "";
    const action = /\baction\s*=\s*["']([^"']*)["']/i.exec(attrs)?.[1] ?? "";
    const method = (/\bmethod\s*=\s*["']([^"']*)["']/i.exec(attrs)?.[1] ?? "get").toUpperCase();
    const fieldCount = [...inner.matchAll(/<(input|textarea|select)\b/gi)].length;

    forms.push({ page, action, method, fieldCount });
  }

  return forms;
}

export function discoverExternalOrigins(html: string): string[] {
  const hosts = new Set<string>();

  // Only resource-bearing attributes, so a link in prose is not mistaken for a
  // loaded subresource.
  for (const m of html.matchAll(/\b(?:src|href|data-src)\s*=\s*["'](https?:\/\/[^"']+)["']/gi)) {
    const raw = m[1];
    if (!raw) continue;
    try {
      hosts.add(new URL(raw).host);
    } catch {
      /* skip */
    }
  }

  return [...hosts];
}
