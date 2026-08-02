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
import { RENAMED_API_PAGES } from "./api-renames.js";
import { RENAMED_PACKAGES } from "./api-renamed.js";

const SEMVER = /^\d+\.\d+\.\d+$/;
const majorOf = (v) => Number(v.split(".")[0]);

/**
 * Resolve a URL under a package's retired slug onto the same page under its
 * current one.
 *
 * Two halves have to move, which is why this cannot be a _redirects rule.
 * api-documenter names every page `<pkg>.<symbol>.md`, so the package name is in
 * the BASENAME as well as the directory: `/api/sequelize/* ->
 * /api/pg-sequelize/:splat` would send 198 of sequelize's 199 URLs to a page that
 * does not exist, while the package root — the one a smoke test checks — looked
 * fine.
 *
 * The basename rewrite is anchored at position 0 deliberately. Eleven sequelize
 * pages carry the package name twice (`sequelize.sequelize.define`,
 * `sequelize.queryinterface.sequelize`, …), and a global replace would produce
 * `pg-sequelize.pg-sequelize.define` — a 404 on the Sequelize class's own pages,
 * which are the most linked ones there are.
 *
 * Old version segments collapse to /latest/ rather than mapping across. A retired
 * name's version history stopped where it stopped and the new package continues
 * it, so there is no correspondence to preserve — and collapsing keeps it to ONE
 * hop, which matters for URLs that already take one to reach imqueue.org.
 *
 * @param {string} pathname Request pathname.
 * @param {object} [versions] Version map; defaults to the generated one.
 * @returns {string|null} Pathname to 301 to, or null if this is not a retired slug.
 */
export function resolveRenamedPackage(pathname, versions = API_VERSIONS) {
  const m = /^\/api\/([^/]+)(\/.*)?$/.exec(pathname);

  if (!m) {
    return null;
  }

  const [, from, rest = ""] = m;
  const to = RENAMED_PACKAGES.get(from);

  // Inert until the renamed package's reference has actually been generated. The
  // config flip, the npm publish and the docs rebuild are three separate steps,
  // and in the window between them a 301 would land on a 404 — strictly worse
  // than serving the old tree that is still on disk. Once `to` appears in the
  // version map the old trees are gone and this takes over.
  if (!to || !versions[to]) {
    return null;
  }

  const segs = rest.split("/").filter(Boolean);
  const page = segs.length > 1 ? segs[segs.length - 1] : "";

  // `/api/<from>/<seg>/<from>/` is api-documenter's duplicate package page; it
  // collapses onto the package root rather than becoming `<to>/latest/<from>/`.
  if (!page || page === from) {
    return `/api/${to}/latest/`;
  }

  const basename = page.startsWith(`${from}.`)
    ? `${to}${page.slice(from.length)}`
    : page;

  return `/api/${to}/latest/${basename}/`;
}

/**
 * Decide what to do with one /api/ pathname.
 *
 * @param {string} pathname Request pathname, e.g. "/api/rpc/3.5.1/rpc.imq/".
 * @param {object} [versions] Version map; defaults to the generated one.
 * @returns {string|null} Pathname to 301 to, or null to serve the path as-is.
 */
export function resolveApiRedirect(pathname, versions = API_VERSIONS) {
  // First, before anything reads the version map: a retired slug is not in it, so
  // every check below would fall through to null and hand the request a 404.
  const renamed = resolveRenamedPackage(pathname, versions);

  if (renamed) {
    return renamed;
  }

  // /api/<pkg> and /api/<pkg>/ carry no version segment, and the generated
  // reference only ever publishes /api/<pkg>/<version>/, so both used to hard
  // 404. They are exactly what a reader trims a deep URL down to, and what an
  // agent guesses when it knows the package but not the version scheme, so send
  // them to the current major. Unknown names (notably /api/contact, the
  // commercial contact endpoint) still resolve to null and are left alone.
  const root = /^\/api\/([^/]+)\/?$/.exec(pathname);

  if (root) {
    return versions[root[1]] ? `/api/${root[1]}/latest/` : null;
  }

  const m = /^\/api\/([^/]+)\/([^/]+)(\/.*)?$/.exec(pathname);

  if (!m) {
    return null; // /api/ itself — nothing versioned to resolve
  }

  const [, pkg, seg, rest = "/"] = m;
  const plan = versions[pkg];

  if (!plan) {
    return null; // unknown package — let it 404 rather than invent a target
  }

  // api-documenter emits the package page twice: as `<pkg>.md` and again as the
  // source of `index.md`, byte-identical. build-api-docs.js now skips the former,
  // but /api/<pkg>/<seg>/<pkg>/ was live, indexable and in the sitemap until then,
  // so it has to 301 onto the package root instead of 404ing. Collapsed here
  // rather than after version resolution so a retired version reaches the root in
  // one hop: /api/core/3.2.1/core/ -> /api/core/latest/, not via /latest/core/.
  const isDupePkgPage = rest === `/${pkg}/` || rest === `/${pkg}`;
  const tail = isDupePkgPage ? "/" : rest;

  if (seg === "latest" || plan.archives.includes(seg)) {
    return isDupePkgPage ? `/api/${pkg}/${seg}/` : null; // otherwise a kept URL: serve it
  }
  if (!SEMVER.test(seg)) {
    return null; // not a version segment (a symbol page under /api/<pkg>/…)
  }

  if (majorOf(seg) === majorOf(plan.latest)) {
    return `/api/${pkg}/latest${tail}`;
  }

  // A past major keeps its highest release; build-api-docs.js archives every
  // major below the current one, so this normally hits. A version from a major
  // we never published falls back to the package root.
  const archive = plan.archives.find((a) => majorOf(a) === majorOf(seg));

  return archive ? `/api/${pkg}/${archive}${tail}` : `/api/${pkg}/latest/`;
}

/**
 * Salvage a TypeDoc-era URL from when the reference was published on imqueue.com.
 *
 * Those builds laid symbols out as `<version>/classes/<Name>.html`; the generated
 * reference uses `<version>/<pkg>.<name>/`. The archived version trees still contain
 * that era's symbols, so the mapping stays WITHIN THE SAME VERSION and the target is
 * guaranteed to exist — no 301 into a 404, which is the trap that made retargeting
 * legacy deep links at /latest/ a bad idea.
 *
 * Confirmed live, not hypothetical: GSC reports these as 404s on the .com property
 * (it follows the .com -> .org hop and records the final status), and GA4 Realtime
 * shows crawlers fetching /api/rpc/2.0.4/classes/… and /api/rpc/2.1.0/classes/… now.
 *
 *   /api/rpc/2.1.0/classes/IMQClient.html  -> /api/rpc/2.1.0/rpc.imqclient/
 *   /api/core/1.15.0/interfaces/IMQ.html   -> /api/core/1.15.0/core.imq/
 *   /api/rpc/2.1.0/globals.html            -> /api/rpc/2.1.0/
 *   /api/rpc/2.1.0/modules/_index_.html    -> /api/rpc/2.1.0/
 *
 * `modules/` and `globals.html` are TypeDoc navigation, not symbols, so they land on
 * the version index rather than guessing a page. Everything else is left alone: an
 * invented target is worse than the 404 it replaces.
 *
 * @param {string} pathname Request pathname.
 * @returns {string|null} The page to 301 to, or null if there is no match.
 */
export function resolveLegacyTypedoc(pathname) {
  const nav = /^\/api\/([^/]+)\/([^/]+)\/(?:globals|modules)\.html$/.exec(pathname);

  if (nav) {
    return `/api/${nav[1]}/${nav[2]}/`;
  }

  const m =
    /^\/api\/([^/]+)\/([^/]+)\/(classes|interfaces|enums|modules)\/([^/]+)\.html$/
      .exec(pathname);

  if (!m) {
    return null;
  }

  const [, pkg, seg, kind, name] = m;

  // A module page documents a file, not an exported symbol — there is no
  // <pkg>.<module> page to send it to.
  if (kind === "modules") {
    return `/api/${pkg}/${seg}/`;
  }

  return `/api/${pkg}/${seg}/${pkg}.${name.toLowerCase()}/`;
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

/**
 * Salvage a page whose URL moved when the generator stripped an api-extractor
 * collision suffix from the symbol's name.
 *
 * `ClassDecorator_2` was never a name @imqueue/pg-cache exports — it recorded a
 * clash with TypeScript's own global — but it was published and submitted in
 * sitemap-api.xml, so the URL has to keep resolving.
 *
 * Driven by the generated map rather than a pattern: 301ing every `_N` URL onto
 * its base would also catch pg-pubsub's genuine `on_1`…`on_9` overload pages,
 * which are real and must keep 200ing. Only consulted after the asset lookup has
 * 404ed, so a live page always wins.
 *
 * @param {string} pathname Request pathname.
 * @returns {string|null} The page to 301 to, or null if there is no match.
 */
export function resolveRenamedApiPage(pathname) {
  const m = /^\/api\/(.+?)\/?$/.exec(pathname);
  const to = m && RENAMED_API_PAGES.get(m[1].toLowerCase());

  return to ? `/api/${to}/` : null;
}
