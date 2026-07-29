// Resolve a requested /api/<pkg>/<version>/... URL onto a version tree the site
// actually publishes.
//
// Policy (identical to the one scripts/build-api-docs.js builds pages for):
//   * /api/<pkg>/latest/     serves the current major's newest release
//   * /api/<pkg>/<archive>/  keeps one copy per past major (that major's highest)
//   * every other published version 301s to whichever of those covers it
//
// This used to be an enumeration in src/org/_redirects — one dynamic rule per
// published version, 190 of them. Cloudflare Pages silently drops dynamic
// redirect rules past the 100th, with no build error, so the rules that landed
// last were dead: every rpc 3.x rule, i.e. the current major. Resolving the
// mapping at request time removes the cap, and it also covers versions
// published after the last docs build instead of 404ing them.
//
// Pure and dependency-free so scripts/check-redirects.js can exercise it under
// plain node against every published version.

import { API_VERSIONS } from "./api-versions.js";
import { CORE_REEXPORTS } from "./api-crosslinks.js";

const SEMVER = /^\d+\.\d+\.\d+$/;
const majorOf = (v) => Number(v.split(".")[0]);

/**
 * Decide what to do with one /api/ pathname.
 *
 * @param {string} pathname Request pathname, e.g. "/api/rpc/3.5.1/rpc.imq/".
 * @param {object} [versions] Version map; defaults to the generated one.
 * @returns {string|null} Pathname to 301 to, or null to serve the path as-is.
 */
export function resolveApiRedirect(pathname, versions = API_VERSIONS) {
  const m = /^\/api\/([^/]+)\/([^/]+)(\/.*)?$/.exec(pathname);

  if (!m) {
    return null; // /api/ itself, or /api/<pkg> — nothing versioned to resolve
  }

  const [, pkg, seg, rest = "/"] = m;
  const plan = versions[pkg];

  if (!plan) {
    return null; // unknown package — let it 404 rather than invent a target
  }
  if (seg === "latest" || plan.archives.includes(seg)) {
    return null; // a kept URL: serve it
  }
  if (!SEMVER.test(seg)) {
    return null; // not a version segment (a symbol page under /api/<pkg>/…)
  }

  if (majorOf(seg) === majorOf(plan.latest)) {
    return `/api/${pkg}/latest${rest}`;
  }

  // A past major keeps its highest release; build-api-docs.js archives every
  // major below the current one, so this normally hits. A version from a major
  // we never published falls back to the package root.
  const archive = plan.archives.find((a) => majorOf(a) === majorOf(seg));

  return archive ? `/api/${pkg}/${archive}${rest}` : `/api/${pkg}/latest/`;
}

/**
 * Salvage a /api/rpc/latest/rpc.<symbol>/ URL for a symbol rpc used to document
 * only because it re-exported it from core. Those pages were indexed before the
 * re-exports were stripped from the generated reference, and they now 404.
 *
 * Only consulted after the asset lookup has already 404ed, so a symbol rpc
 * genuinely documents always wins over this.
 *
 * @param {string} pathname Request pathname.
 * @returns {string|null} The core page to 301 to, or null if there is no match.
 */
export function resolveCoreReexport(pathname) {
  const m = /^\/api\/rpc\/latest\/rpc\.([A-Za-z0-9._-]+?)\/?$/.exec(pathname);

  if (!m || !CORE_REEXPORTS.has(m[1].toLowerCase())) {
    return null;
  }

  return `/api/core/latest/core.${m[1].toLowerCase()}/`;
}
