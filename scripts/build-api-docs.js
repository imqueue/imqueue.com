// build-api-docs.js — automatic @imqueue API-reference builder.
//
// Which packages are documented, and how they are grouped, lives in
// scripts/lib/api-packages.js — shared with the /api/ landing page and the
// generated Pages Functions, so adding a package is one config entry rather than
// a hand edit in four files.
//
// Policy (per package):
//   * /api/<pkg>/latest/  ALWAYS serves the current MAJOR's newest release.
//     A new minor/patch of the current major just moves /latest/ forward — it
//     is NOT published under its own versioned URL.
//   * Each PAST major keeps exactly ONE archived copy: that major's highest
//     release, at /api/<pkg>/<version>/ (shown under "Older versions") —
//     UNLESS the package is `latestOnly`, which publishes /latest/ and nothing
//     else. Everything except core and rpc is latestOnly; see api-packages.js.
//   * When a new major ships, the outgoing major's highest release becomes its
//     archive entry and /latest/ moves to the new major.
//
// Everything is sourced from the PUBLISHED npm packages (no local source build),
// so this runs anywhere with npm + network. Re-run on every release.
//
//   npm run build-docs                 # rebuild all packages per policy
//   node scripts/build-api-docs.js rpc # just one package
//   npm run build-docs -- --strict-prose  # fail, don't warn, under the summary floor
//
// Outputs: src/org/api/<pkg>/{latest,<archive-ver>}/ pages, src/_data/
// apiVersions.json (consumed by the /api/ landing page), functions/api/<pkg>/
// (one Pages Function per package), and the generated API section of
// src/org/_redirects (retired version URLs 301 to their kept copy).
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { ExtractorConfig, Extractor } = require('@microsoft/api-extractor');
const { apiDescription, summaryParagraph } = require('./lib/api-summary');
const { assertNoLostPages } = require('./lib/api-pages');
const { normalizeModel } = require('./lib/api-model');
const { PACKAGES: PACKAGES_ALL, shipped } = require('./lib/api-packages');
const { generate: genCrosslinks } = require('./gen-api-crosslinks');

const ROOT = process.cwd();
const TMP = path.join(ROOT, '.api-tmp', 'build');
const DOCUMENTER = path.join(ROOT, 'node_modules', '.bin', 'api-documenter');
// `planned` packages are in the taxonomy but have no pages yet — flipping one to
// `shipped` in api-packages.js is what makes a wave land.
const PKG_CONFIG = shipped();
const PKGS = PKG_CONFIG.map(p => p.name);

// summary%: the share of a package's generated pages whose OWN summary section
// yields prose — i.e. pages where summaryParagraph() finds a real sentence between
// the symbol heading and its signature block.
//
// This is the one doc-quality number this build reports, and it is deliberately
// NOT the "prose%" proxy used to survey the packages before this landed. That
// proxy asked whether the page contained any capital-initial line of 40+
// characters anywhere, which counts table rows and Remarks prose. It ranked the
// packages differently enough to matter: measured over the same api-documenter
// output, pg-pubsub is 80% here against 53% by the proxy, async-logger 71% against
// 36%, while opentelemetry drops from 86% to 64%.
//
// This measure is the one worth gating on because it is the same function that
// fills each page's meta description and its /api/search-index.json summary. A
// page counted as failing here is precisely a page whose description falls back to
// "<symbol> — @imqueue/<pkg> <version> API reference" and whose search-index entry
// carries no summary — a stub for both search and agents.
//
// Calibration under THIS metric: core 99% (160/161), rpc 99% (189/190). The
// in-scope packages run 13%–83%, so a floor at the spine's level would reject all
// of them. 40% is set to catch the packages that would ship mostly signature-only
// stubs — type-graphql-dependency (13%), http-protect (31%), pg-cache (39%) — and
// to pass the rest. Warn-only unless --strict-prose.
const SUMMARY_FLOOR = 0.40;

const GROUPS = [
  'Classes', 'Abstract Classes', 'Enumerations', 'Functions',
  'Interfaces', 'Variables', 'Type Aliases', 'Namespaces',
];

function sh(cmd, cwd) { execSync(cmd, { cwd: cwd || ROOT, stdio: 'inherit' }); }
function shq(cmd, cwd) { return execSync(cmd, { cwd: cwd || ROOT, stdio: ['ignore', 'pipe', 'ignore'] }).toString(); }
function rmrf(p) { fs.rmSync(p, { recursive: true, force: true }); }
function firstHeading(text, fallback) {
  const m = text.match(/^#{1,4}\s+(.+?)\s*$/m);
  return m ? m[1].replace(/[\\`]/g, '').trim() : fallback;
}
// Undo api-documenter's markdown escaping for text rendered outside markdown.
function unescapeMd(text) {
  return text.replace(/\\([\\`*_{}[\]()#+\-.!|<>~])/g, '$1');
}

// api-documenter opens every page at `##`, so the generated reference shipped
// with no <h1> at all — 349 indexable pages whose strongest heading was an h2.
// Promote the first one; the sub-headings ("Methods", "Parameters") stay h2, which
// gives the page a real outline. Anchor ids are derived from heading text, not
// level, so existing #fragment links keep working.
function promoteFirstHeading(text) {
  return text.replace(/^## /m, '# ');
}

// Lift api-documenter's breadcrumb paragraph out of the body and return it as
// data. Two reasons not to just render it as-is: its first crumb is labelled
// "Home" but points at /api/, so no reference page ever linked the site root; and
// as a plain paragraph it carries no breadcrumb semantics, which left every API
// page emitting BreadcrumbList JSON-LD that matched nothing on the page.
//
// It is also the only place a member page's parent symbol is known
// (core.ilogger.info -> core.ilogger), so the trail cannot be reconstructed in the
// layout. apiref.html renders it and head.html emits the matching JSON-LD, both
// from this one array.
function extractTrail(text) {
  const m = /^\[Home\]\([^)]*\)[^\n]*$/m.exec(text);

  if (!m) {
    return { body: text, crumbs: null };
  }

  const items = [...m[0].matchAll(/\[([^\]]+)\]\(([^)]+)\)/g)]
    .map(([, name, url]) => ({ name: unescapeMd(name), url }));
  // items[0] is the mislabelled "Home"; the real root is prepended by the layout.
  const crumbs = [{ name: 'API reference', url: '/api/' }, ...items.slice(1)];
  // Consume the blank line the trail sat on as well, or the removal leaves three
  // consecutive newlines in the committed artifact (and in the .md mirror agents
  // read). One blank line still separates the generator comment from the heading.
  // Strip the newlines the trail line owned. The text before it already ends with
  // the blank line that separated it from the generator comment, so that blank
  // line becomes the separator for the heading and nothing is left doubled.
  const after = text.slice(m.index + m[0].length).replace(/^(?:\r?\n)+/, '');

  return { body: text.slice(0, m.index) + after, crumbs };
}

// --- semver (release versions only) --------------------------------------
function parseVer(v) { return v.split('.').map(Number); }
function cmpVer(a, b) {
  const x = parseVer(a), y = parseVer(b);
  for (let i = 0; i < 3; i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0); }
  return 0;
}
function majorOf(v) { return parseVer(v)[0]; }

// Compute the publish plan for a package from its npm version history.
//
// `latestOnly` (api-packages.js) suppresses the archive derivation entirely.
// Without it every new package would silently generate 2–4 extra copies of
// itself: most have several past majors (pg-cache has 4, sequelize 3), and this
// derivation is unconditional. Two knock-on effects are deliberate:
//
//   * a past-major URL 301s to /latest/ rather than 404ing, via the archive
//     fallback in lib/api-redirects.js
//   * cleanStale() keeps only `latest`, so flipping latestOnly ON for core or rpc
//     later would DELETE the archives they already publish
function planFor(pkg, { latestOnly = false } = {}) {
  const raw = JSON.parse(shq(`npm view @imqueue/${pkg} versions --json`));
  const versions = (Array.isArray(raw) ? raw : [raw])
    .filter(v => !v.includes('-')) // drop pre-releases
    .sort(cmpVer);
  const latest = versions[versions.length - 1];
  const currentMajor = majorOf(latest);
  // Release timestamps, so the sitemap can date an API page by when its version
  // actually shipped. Previously lastmod came from the generated file's mtime, so
  // every rebuild restamped all 350 API URLs with the build date — 85% of every
  // lastmod in the sitemap, which is how a site teaches Google to ignore lastmod.
  const released = JSON.parse(shq(`npm view @imqueue/${pkg} time --json`));

  // highest release of each past major, newest major first
  const byMajor = {};
  for (const v of versions) { const m = majorOf(v); if (!byMajor[m] || cmpVer(v, byMajor[m]) > 0) byMajor[m] = v; }
  const archives = latestOnly
    ? []
    : Object.keys(byMajor).map(Number).filter(m => m < currentMajor)
      .sort((a, b) => b - a).map(m => byMajor[m]);

  return { versions, latest, currentMajor, archives, highestOfMajor: byMajor, released };
}

// --- re-export stripping (see call site) ---------------------------------
function stripReexports(dir, modulePattern, { skipNodeModules = false } = {}) {
  const RE = new RegExp(
    `^\\s*export\\s*(?:type\\s*)?(?:\\{[^}]*\\}|\\*(?:\\s+as\\s+\\w+)?)\\s*from\\s*['"]${modulePattern}['"];?\\s*$`,
    'gm',
  );
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.isDirectory()) { if (!(skipNodeModules && e.name === 'node_modules')) walk(path.join(d, e.name)); }
      else if (e.name.endsWith('.d.ts')) {
        const p = path.join(d, e.name);
        const src = fs.readFileSync(p, 'utf8');
        if (RE.test(src)) fs.writeFileSync(p, src.replace(RE, ''));
      }
    }
  };
  walk(dir);
}

// Embed api-documenter markdown as native Eleventy pages under the given URL
// segment ('latest' for the current major, or the version for an archive).
// Archived segments are emitted with `noindex: true` (they duplicate /latest/
// for search) and a per-page `latestUrl` pointing at the same symbol under
// /latest/ (falling back to the package root when the symbol no longer exists),
// which drives the "you're viewing archived docs" banner. Returns the set of
// page basenames it wrote (used to resolve archives' latestUrl links).
function embed({ pkg, version, seg, mdDir, latestFiles, released }) {
  const isArchived = seg !== 'latest';
  const isRoot = (b) => b === 'index' || b === pkg;
  const latestUrlFor = (b) =>
    isRoot(b) || !(latestFiles && latestFiles.has(b))
      ? `/api/${pkg}/latest/`
      : `/api/${pkg}/latest/${b}/`;
  const base_ = `/api/${pkg}/${seg}`;
  const urlFor = (file) => {
    const b = file.replace(/\.md$/, '');
    return (b === 'index' || b === pkg) ? `${base_}/` : `${base_}/${b}/`;
  };
  const rewriteLinks = (text) => text
    .replace(/\[Home\]\((?:\.\/)?index\.md\)/g, '[Home](/api/)')
    .replace(/\]\((?:\.\/)?([A-Za-z0-9._-]+)\.md(#[^)]*)?\)/g,
      (_m, name, anchor) => `](${urlFor(name)}${anchor || ''})`);

  const outDir = path.join(ROOT, 'src', 'org', 'api', pkg, seg);
  rmrf(outDir);
  fs.mkdirSync(outDir, { recursive: true });

  const pkgPageMd = fs.readFileSync(path.join(mdDir, `${pkg}.md`), 'utf8');
  const apiNav = [];
  let cur = null;
  for (const line of pkgPageMd.split('\n')) {
    const h = line.match(/^##\s+(.+?)\s*$/);
    if (h) { cur = GROUPS.includes(h[1].trim()) ? { group: h[1].trim(), items: [] } : null; if (cur) apiNav.push(cur); continue; }
    if (cur) {
      const re = /\[([^\]]+)\]\((?:\.\/)?([A-Za-z0-9._-]+)\.md\)/g;
      let m;
      // api-documenter escapes markdown-significant characters in link text, so
      // `DEFAULT_IMQ_OPTIONS` arrives as `DEFAULT\_IMQ\_OPTIONS`. The sidebar
      // renders these labels as plain text, so unescape them.
      while ((m = re.exec(line))) {
        cur.items.push({ name: unescapeMd(m[1]), url: urlFor(m[2]) });
      }
    }
  }
  if (!apiNav.length) throw new Error(`No symbols parsed for ${pkg}@${version} sidebar`);

  // Build the YAML front matter for one embedded page.
  //
  // `description` matters: without it head.html falls back to the site slogan,
  // which made 351 of the 352 indexed API pages share one meta description.
  // apiDescription() lifts the per-symbol summary api-documenter already emits.
  const frontMatter = (title, latestUrl, description, crumbs, unsubmitted) => {
    let fm = `title: ${JSON.stringify(title)}\n`;
    if (description) fm += `description: ${JSON.stringify(description)}\n`;
    if (crumbs) fm += `apiCrumbs: ${JSON.stringify(crumbs)}\n`;
    if (unsubmitted) fm += 'sitemap: false\n';
    if (isArchived) fm += `noindex: true\nlatestUrl: ${JSON.stringify(latestUrl)}\n`;
    return `---\n${fm}---\n\n`;
  };
  // Per-symbol MEMBER pages stay indexable but leave the sitemap. 243 of the 350
  // submitted API URLs were these — a single method or property, ~130 words, and
  // 15 of them documenting inherited EventEmitter methods that Node's own docs
  // will always outrank. At 57% of the sitemap they spent crawl budget on pages
  // that cannot rank and drowned the 73 editorial URLs in the set Google grades.
  // They remain reachable from the sidebar and the breadcrumb, so Google can still
  // find and index them — it just is not asked to.
  //
  // Two dots means a member: core.ilogger.info (member) vs core.ilogger (the
  // interface) vs core.imq_log_args (a top-level const).
  const isMemberPage = (b) => b.split('.').length > 2;
  // Rewrite links first so the lifted trail carries site URLs, not `*.md` paths.
  const prepare = (raw) => {
    const { body, crumbs } = extractTrail(rewriteLinks(raw));
    return { md: promoteFirstHeading(body), crumbs };
  };
  const archivedSuffix = isArchived ? ` v${version} (archived)` : '';

  const basenames = new Set(['index']);
  let count = 0;
  // summary%: pages whose own summary section yields prose. Uses the very same
  // summaryParagraph() that fills the meta description, so a page counted as
  // failing here is exactly a page whose description had to fall back to
  // "<symbol> — @imqueue/<pkg> <version> API reference."
  let withProse = 0;
  for (const file of fs.readdirSync(mdDir)) {
    if (!file.endsWith('.md')) continue;
    // api-documenter's package page is `<pkg>.md`, and it is also what index.md
    // is written from. Emitting both produced two indexable URLs with identical
    // content — /api/<pkg>/<seg>/<pkg>/ competing with /api/<pkg>/<seg>/, each
    // self-canonical and both in the sitemap. rewriteLinks() already points
    // `<pkg>.md` links at the package root, so nothing links to the duplicate.
    if (file === `${pkg}.md`) continue;
    // api-documenter also emits its own index.md for the model root. The package
    // root page is written from `<pkg>.md` further down and overwrites it, so
    // embedding it here was wasted work — and it made summary% unreachable at
    // 100%: the index page was counted twice, once as this (prose-less) model page
    // and once as the real package page, so every package reported one page short.
    if (file === 'index.md') continue;
    const b = file.replace(/\.md$/, '');
    basenames.add(b);
    const raw = fs.readFileSync(path.join(mdDir, file), 'utf8');
    const symbol = firstHeading(raw, b);
    const title = `${symbol} · @imqueue/${pkg}${archivedSuffix}`;
    const desc = apiDescription(raw, { pkg, version, symbol });
    const { md, crumbs } = prepare(raw);
    fs.writeFileSync(path.join(outDir, file),
      frontMatter(title, latestUrlFor(b), desc, crumbs, isMemberPage(b)) + md);
    count++;
    if (summaryParagraph(raw)) withProse++;
  }
  const indexTitle = `@imqueue/${pkg} ${version} · API reference${isArchived ? ' (archived)' : ''}`;
  const indexDesc = apiDescription(pkgPageMd, { pkg, version, symbol: `${pkg} package` });
  const indexPage = prepare(pkgPageMd);
  fs.writeFileSync(path.join(outDir, 'index.md'),
    frontMatter(indexTitle, `/api/${pkg}/latest/`, indexDesc, indexPage.crumbs) + indexPage.md);
  // bareTitle: these titles already end with "· @imqueue/<pkg>", so letting
  // head.html append its "· @imqueue" suffix produced
  // "Foo.bar() method · @imqueue/core · @imqueue" — 11 wasted characters of SERP
  // budget on every page, and the brand twice.
  // apiReleased: npm's publish time for this version, inherited by every page in
  // the tree through the data cascade. src/sitemap.liquid uses it for <lastmod>
  // instead of the file mtime, which restamped all 350 API URLs on every rebuild.
  fs.writeFileSync(path.join(outDir, `${seg}.11tydata.json`),
    JSON.stringify({ layout: 'apiref.html', section: 'api', bareTitle: true, apiPkg: pkg, apiVersion: version, apiVersionPath: seg, apiReleased: released || null, apiNav }, null, 2));

  if (summaryParagraph(pkgPageMd)) withProse++;

  const pages = count + 1; // + the package-root index.md
  console.log(`  embedded ${count} pages -> src/org/api/${pkg}/${seg}/ (${apiNav.reduce((n, g) => n + g.items.length, 0)} symbols)`);
  return { basenames, summary: { pages, withProse } };
}

// Fetch a published version from npm and emit it at the given URL segment.
// Returns { basenames, prose } — see embed().
function generate({ pkg, version, seg, latestFiles, released }) {
  console.log(`\n=== @imqueue/${pkg}@${version}  ->  /api/${pkg}/${seg}/ ===`);
  const work = path.join(TMP, `${pkg}-${version}`);
  rmrf(work);
  fs.mkdirSync(work, { recursive: true });

  sh(`npm pack @imqueue/${pkg}@${version} --pack-destination "${work}" --loglevel=error`);
  const tgz = fs.readdirSync(work).find(f => f.endsWith('.tgz'));
  sh(`tar xzf "${tgz}" -C "${work}"`, work);
  const pkgDir = path.join(work, 'package');
  const pj = require(path.join(pkgDir, 'package.json'));
  const entry = pj.types || pj.typings || 'index.d.ts';

  // Resolve EVERY @imqueue/* dependency for cross-package type references, but
  // never bundle one (each has its own pages; bundling hits an api-extractor
  // defect). Then strip its re-exports, which is what stops a package
  // re-documenting symbols another package owns.
  //
  // This used to be hard-coded to the single `@imqueue/core` case, which handled
  // exactly one in-scope package (`job`). Six others depend on an @imqueue
  // package that is NOT core and so got nothing installed and nothing stripped:
  //
  //   sequelize, tag-cache, dd-trace       -> @imqueue/rpc
  //   pg-cache    -> @imqueue/pg-pubsub, @imqueue/rpc, @imqueue/tag-cache
  //   http-protect            -> @imqueue/net
  //   type-graphql-dependency -> @imqueue/graphql-dependency
  //
  // Worth being precise about what that cost, because it is easy to overstate:
  // those packages still EXTRACT without this (measured — sequelize and dd-trace
  // both produce complete models). What they lose is resolved cross-package types
  // in signatures, and de-duplication: every symbol re-exported from a dependency
  // ships a second page under this package's name, competing with the page the
  // owning package publishes.
  for (const [dep, range] of Object.entries(pj.dependencies || {})) {
    if (!dep.startsWith('@imqueue/')) continue;

    // Best-effort, matching the rest of this script: a dependency that cannot be
    // installed degrades the output (unresolved types, duplicate pages) but must
    // not take the whole build down.
    try {
      sh(`npm install ${dep}@"${range}" --no-save --no-audit --no-fund --ignore-scripts --loglevel=error`, pkgDir);
      stripReexports(pkgDir, dep.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), { skipNodeModules: true });
    } catch {
      console.warn(`  WARN  could not install ${dep}@${range} for ${pkg} — its re-exported symbols will ship duplicate pages`);
    }
  }
  // core re-exports EventEmitter from node:events; api-extractor throws a hard
  // "Unsupported export" on a re-exported EXTERNAL symbol. Strip those re-export
  // lines everywhere (uses as a base class still resolve fine).
  stripReexports(pkgDir, '(?:node:)?events');

  const cfgObj = {
    $schema: 'https://developer.microsoft.com/json-schemas/api-extractor/v7/api-extractor.schema.json',
    projectFolder: pkgDir,
    mainEntryPointFilePath: path.join(pkgDir, entry),
    bundledPackages: [],
    // types: ['node'], not []. With no ambient Node types, api-extractor throws a
    // hard `Unable to follow symbol for "Buffer"` on any package that uses Buffer
    // in its public surface — @imqueue/net does, and could not be documented at
    // all. Measured safe to apply globally: against published core@3.3.0 and
    // rpc@3.5.1 the two settings produce identical models (169 and 202 nodes, 0
    // warnings, no symbol differences), so this does not perturb the pages the
    // site already publishes. @types/node is a declared devDependency for this.
    compiler: { overrideTsconfig: { compilerOptions: { target: 'ESNext', module: 'nodenext', moduleResolution: 'nodenext', skipLibCheck: true, types: ['node'], lib: ['ESNext'] }, include: [entry] } },
    apiReport: { enabled: false },
    docModel: { enabled: true, apiJsonFilePath: path.join(work, `${pkg}.api.json`) },
    dtsRollup: { enabled: false },
    tsdocMetadata: { enabled: false },
    messages: { compilerMessageReporting: { default: { logLevel: 'none' } }, extractorMessageReporting: { default: { logLevel: 'none' } } },
  };
  const cfgPath = path.join(work, 'api-extractor.json');
  fs.writeFileSync(cfgPath, JSON.stringify(cfgObj));
  const ec = ExtractorConfig.prepare({ configObject: ExtractorConfig.loadFile(cfgPath), configObjectFullPath: cfgPath, packageJsonFullPath: path.join(pkgDir, 'package.json') });
  if (!Extractor.invoke(ec, { localBuild: true, showVerboseMessages: false }).succeeded) {
    throw new Error(`API Extractor failed for ${pkg}@${version}`);
  }

  // Normalise the model into a shape api-documenter can represent before it runs:
  // fold a declaration-merged class+interface into one symbol, and give
  // same-name static/instance siblings distinct pages. Without this a legitimate
  // TypeScript pattern silently loses a page — see scripts/lib/api-model.js.
  const model = JSON.parse(fs.readFileSync(path.join(work, `${pkg}.api.json`), 'utf8'));
  for (const note of normalizeModel(model)) {
    console.log(`  model: ${note}`);
  }

  const modelDir = path.join(work, 'model');
  fs.mkdirSync(modelDir, { recursive: true });
  fs.writeFileSync(path.join(modelDir, `${pkg}.api.json`), JSON.stringify(model));
  const mdDir = path.join(work, 'md');
  sh(`"${DOCUMENTER}" markdown --input-folder "${modelDir}" --output-folder "${mdDir}"`);

  // Every symbol in the model must have got its own page. api-documenter builds
  // filenames from lowercased symbol names and silently overwrites on a clash, so
  // a lost page is otherwise invisible — see scripts/lib/api-pages.js. Asserted
  // against the NORMALISED model, which is what api-documenter was given.
  const counts = assertNoLostPages({
    pkg,
    version,
    model,
    emitted: fs.readdirSync(mdDir).filter(f => f.endsWith('.md')),
  });
  console.log(`  ${counts.expected} model symbols -> ${counts.emitted} pages, no collisions`);

  return embed({ pkg, version, seg, mdDir, latestFiles, released });
}

// Remove version dirs under src/org/api/<pkg>/ that the current plan doesn't keep.
function cleanStale(pkg, keepSegs) {
  const dir = path.join(ROOT, 'src', 'org', 'api', pkg);
  if (!fs.existsSync(dir)) return;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory() && !keepSegs.includes(e.name)) {
      rmrf(path.join(dir, e.name));
      console.log(`  removed stale src/org/api/${pkg}/${e.name}/`);
    }
  }
}

// Retired version URLs used to be enumerated here as one `_redirects` rule per
// published version. Cloudflare Pages silently caps _redirects at 100 DYNAMIC
// rules — anything using :splat — and drops the rest with no build error. The
// list had reached 190, emitted core-then-rpc and ascending, so the rules that
// landed last were dead: every rpc 3.x rule, i.e. the current major. Retired
// /api/rpc/3.x/ URLs hard-404ed.
//
// The mapping now lives in lib/api-redirects.js and runs in the Pages Functions
// at functions/api/{core,rpc}/[[path]].js, which has no rule cap and also covers
// versions published after the last docs build. All this file emits is the
// version map those functions import, plus a _redirects that documents where the
// rules went. scripts/check-redirects.js guards both ends.
function writeRedirects() {
  const file = path.join(ROOT, 'src', 'org', '_redirects');
  fs.writeFileSync(file, `# imqueue.org — Cloudflare Pages redirects.
#
# Intentionally empty of /api/ rules.
#
# Retired API version URLs (/api/<pkg>/<version>/... -> the kept copy) are
# resolved at request time by the Pages Functions in functions/api/core/ and
# functions/api/rpc/, using the policy in lib/api-redirects.js.
#
# Do NOT re-add them here. Cloudflare Pages silently drops dynamic redirect
# rules past the 100th, and there are ~190 published versions — the newest, most
# valuable rules are the ones that get dropped. scripts/check-redirects.js fails
# the build if this file ever exceeds the cap.
`);
  console.log('\nWrote src/org/_redirects (API mapping lives in functions/api/)');
}

// The version map the Pages Functions import. Same data as
// src/_data/apiVersions.json, but as an ES module: a Function cannot read
// Eleventy's data directory at request time.
function writeVersionModule(apiVersions) {
  const body = Object.entries(apiVersions)
    .map(([pkg, p]) => `  ${JSON.stringify(pkg)}: { "latest": ${JSON.stringify(p.latest)}, "archives": ${JSON.stringify(p.archives)} }`)
    .join(',\n');
  const file = path.join(ROOT, 'lib', 'api-versions.js');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `// GENERATED by scripts/build-api-docs.js — do not edit by hand.
//
// The same data as src/_data/apiVersions.json, emitted as an ES module because
// the Cloudflare Pages Functions under functions/api/ cannot read Eleventy's
// data directory at request time — they need a plain import.
export const API_VERSIONS = {
${body}
};
`);
  console.log(`Wrote lib/api-versions.js`);
}

// One Cloudflare Pages Function per package, GENERATED from api-packages.js.
//
// Deliberately still one mount per package rather than a single
// functions/api/[pkg]/[[path]].js. `[[path]]` is an OPTIONAL catch-all, so
// functions/api/[pkg]/[[path]].js compiles to /api/:pkg/* and DOES match a bare
// single segment — proven live: GET /api/core, with nothing after `core`, 301s to
// /api/core/latest/, which can only come from functions/api/core/[[path]].js. A
// dynamic segment directly under /api/ would therefore sit on top of /api/contact
// and rely on Pages route specificity, which lib/api-handler.js records as holding
// "by convention" only. Generating the mounts removes the copy-paste cost — the
// only real objection to the per-package layout — without taking that risk.
//
// Note check:redirects CANNOT catch a regression here: it runs
// lib/api-redirects.js under plain node and has zero references to functions/.
function writeFunctions() {
  const dir = path.join(ROOT, 'functions', 'api');

  for (const pkg of PKGS) {
    const out = path.join(dir, pkg);
    fs.mkdirSync(out, { recursive: true });
    fs.writeFileSync(path.join(out, '[[path]].js'),
      `// GENERATED by scripts/build-api-docs.js — do not edit by hand.
// Cloudflare Pages Function — /api/${pkg}/*
// Resolves retired @imqueue/${pkg} version URLs onto the kept version trees.
// See lib/api-redirects.js for the policy and why this is not in _redirects.
import { handleApiRequest } from "../../../lib/api-handler.js";

export const onRequest = handleApiRequest;
`);
  }

  // Retire the mount of a package that is no longer shipped. Scoped to names this
  // config knows about, so functions/api/contact.js and anything hand-authored is
  // never a candidate.
  for (const p of PACKAGES_ALL) {
    if (PKGS.includes(p.name)) continue;

    const stale = path.join(dir, p.name);

    if (fs.existsSync(stale)) {
      rmrf(stale);
      console.log(`  removed stale functions/api/${p.name}/`);
    }
  }

  console.log(`Wrote ${PKGS.length} Pages Function(s): ${PKGS.map(p => `functions/api/${p}/`).join(', ')}`);
}

// Report symbols that more than one package documents.
//
// This is a REPORT, not a gate, and the distinction took a wrong turn to find.
// The obvious assumption is that a shared name means de-duplication failed —
// stripping a dependency's re-exports (see generate()) is what stops a package
// re-documenting symbols another package owns, so a leftover looks like a bug.
//
// Measured, it is the opposite. Every shared name in the current set is an
// INDEPENDENT declaration that happens to reuse a name:
//
//   AnyJson    core: boolean|number|string|null|undefined|JsonArray|JsonObject
//              pg-pubsub: boolean|number|string|null|JsonArray|JsonMap
//   ILogger    pg-cache declares its own in src/env.ts rather than depending on core
//
// Those are different types, in different packages, at different URLs. Each one
// needs its own page — suppressing either would document a type the package does
// not have. So failing the build here would block a wave over correct output.
//
// What the report is for: a signature that is byte-IDENTICAL across two packages
// is the shape a genuinely unstripped re-export takes, and that is worth looking
// at. A differing signature is just a reused name. Both are listed, separately,
// because "pg-cache copied ILogger instead of importing it" is useful to know
// even though it is not a docs bug.
function checkCrossPackageDupes() {
  const owners = new Map();

  for (const pkg of PKGS) {
    const dir = path.join(ROOT, 'src', 'org', 'api', pkg, 'latest');

    if (!fs.existsSync(dir)) continue;

    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith('.md') || f === 'index.md') continue;
      if (!f.startsWith(`${pkg}.`)) continue;

      const sym = f.slice(pkg.length + 1).replace(/\.md$/, '');
      const md = fs.readFileSync(path.join(dir, f), 'utf8');
      // api-documenter emits CRLF, so \r?\n — anchoring on \n alone made every
      // signature read as empty, which reported all of them as identical.
      const sig = (/```typescript\r?\n([\s\S]*?)```/.exec(md) || [, ''])[1]
        .replace(/\r/g, '').trim();

      if (!owners.has(sym)) owners.set(sym, []);
      owners.get(sym).push({ pkg, sig });
    }
  }

  const shared = [...owners].filter(([, list]) => list.length > 1);

  if (!shared.length) {
    console.log(`\nNo symbol names shared across packages (${owners.size} symbols, ${PKGS.length} package(s)).`);
    return;
  }

  const identical = shared.filter(([, l]) => new Set(l.map(x => x.sig)).size === 1);
  const distinct = shared.filter(([, l]) => new Set(l.map(x => x.sig)).size > 1);

  console.log(`\n${shared.length} symbol name(s) documented by more than one package:`);

  for (const [sym, list] of distinct) {
    console.log(`  differing  ${sym.padEnd(26)} ${list.map(x => x.pkg).join(', ')}`);
  }
  for (const [sym, list] of identical) {
    console.log(`  IDENTICAL  ${sym.padEnd(26)} ${list.map(x => x.pkg).join(', ')}`);
  }

  if (distinct.length) {
    console.log(
      `  ${distinct.length} have different signatures — separate types that reuse a name.\n` +
      '  Correct as-is: each package documents the type it actually exports.',
    );
  }
  if (identical.length) {
    console.log(
      `  ${identical.length} are byte-identical. Check whether one is an unstripped re-export\n` +
      '  from a dependency (see the @imqueue/* install in generate()); if it is a\n' +
      '  hand-copied declaration, that is the package\'s call, not this build\'s.',
    );
  }
}

// summary%, per package, against SUMMARY_FLOOR.
function reportSummaryCoverage(coverage, strict) {
  console.log('\nDoc-block coverage (summary%: pages whose own summary section has prose)');

  let breached = 0;

  for (const [pkg, m] of Object.entries(coverage)) {
    const pct = m.pages ? m.withProse / m.pages : 0;
    const under = pct < SUMMARY_FLOOR;

    if (under) breached++;
    console.log(
      `  ${under ? 'LOW ' : 'ok  '}  ${pkg.padEnd(38)} ` +
      `${String(Math.round(pct * 100)).padStart(3)}%  (${m.withProse}/${m.pages} pages)`,
    );
  }

  if (!breached) return;

  const msg =
    `${breached} package(s) below the ${Math.round(SUMMARY_FLOOR * 100)}% summary floor. ` +
    'Those pages ship as signature-only stubs — no meta description of their own ' +
    'and no search-index summary: bad for search, and worse for an agent that gets ' +
    'a type with no explanation. Improve the doc-blocks and RELEASE them — this ' +
    'generator reads the published tarball, so an unreleased fix does not appear.';

  if (strict) {
    console.error(`\nFAIL  ${msg}`);
    process.exitCode = 1;
  } else {
    console.warn(`\nWARN  ${msg}\n      (--strict-prose makes this fail)`);
  }
}

function main() {
  const argv = process.argv.slice(2);
  const strictProse = argv.includes('--strict-prose');
  const only = argv.filter(a => !a.startsWith('--'));
  const pkgs = only.length ? PKGS.filter(p => only.includes(p)) : PKGS;

  const unknown = only.filter(p => !PKGS.includes(p));
  if (unknown.length) {
    throw new Error(
      `Not a shipped package: ${unknown.join(', ')}. Shipped: ${PKGS.join(', ')}. ` +
      'Add it to scripts/lib/api-packages.js, or flip its status to "shipped".',
    );
  }

  rmrf(TMP);
  fs.mkdirSync(TMP, { recursive: true });
  const apiVersions = {};
  const coverage = {};
  try {
    for (const pkg of pkgs) {
      const cfg = PKG_CONFIG.find(p => p.name === pkg);
      const plan = planFor(pkg, { latestOnly: cfg.latestOnly });
      console.log(
        `\n##### @imqueue/${pkg}: latest ${plan.latest} (major ${plan.currentMajor}), ` +
        `archives [${plan.archives.join(', ') || 'none'}]` +
        `${cfg.latestOnly ? ' (latestOnly)' : ''}`,
      );
      const result = generate({
        pkg, version: plan.latest, seg: 'latest', released: plan.released[plan.latest],
      });
      coverage[pkg] = result.summary;
      for (const v of plan.archives) {
        generate({ pkg, version: v, seg: v, latestFiles: result.basenames, released: plan.released[v] });
      }
      cleanStale(pkg, ['latest', ...plan.archives]);
      apiVersions[pkg] = { latest: plan.latest, archives: plan.archives };
    }
  } finally {
    rmrf(TMP);
  }

  // Only rewrite shared outputs for a full build (partial builds would drop the
  // other packages' data / redirects / Functions).
  if (pkgs.length === PKGS.length) {
    fs.writeFileSync(path.join(ROOT, 'src', '_data', 'apiVersions.json'), JSON.stringify(apiVersions, null, 2) + '\n');
    console.log(`\nWrote src/_data/apiVersions.json: ${JSON.stringify(apiVersions)}`);
    writeVersionModule(apiVersions);
    writeRedirects();
    writeFunctions();
    // Both depend on every package's pages being on disk, so they run last.
    genCrosslinks();
    checkCrossPackageDupes();
  } else {
    console.log('\nPartial build — left src/_data/apiVersions.json, lib/api-versions.js, src/org/_redirects and functions/api/ untouched.');
  }

  reportSummaryCoverage(coverage, strictProse);
  console.log('\nDone!');
}

main();
