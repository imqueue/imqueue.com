#!/usr/bin/env node
// check-redirects.js — guards the two things that broke silently once.
//
//   1. Cloudflare Pages caps _redirects at 100 DYNAMIC rules (any rule using
//      :splat or a :placeholder). Rules past the 100th are dropped with no build
//      error and no warning. src/org/_redirects grew to 190 generated API rules,
//      so 90 were dead — including every rpc 3.x rule, the current major.
//   2. The /api/ version mapping now lives in lib/api-redirects.js instead. This
//      replays the 190 rules that _redirects used to carry (snapshotted in
//      scripts/fixtures/legacy-api-redirects.txt) and asserts the resolver still
//      produces the same target for each, so already-public URLs cannot regress.
//
//   node scripts/check-redirects.js
//
// Exits non-zero on any failure; wired into `npm test`.

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DYNAMIC_LIMIT = 100;
const FIXTURE = path.join(__dirname, 'fixtures', 'legacy-api-redirects.txt');

let failures = 0;

function fail(msg) {
  failures++;
  console.error(`  FAIL  ${msg}`);
}

function pass(msg) {
  console.log(`  ok    ${msg}`);
}

// --- 1. dynamic-rule budget -------------------------------------------------
// A rule is dynamic if its source or target contains a wildcard or placeholder.
function checkDynamicBudget() {
  for (const edition of ['org', 'com']) {
    const file = path.join(ROOT, 'src', edition, '_redirects');

    if (!fs.existsSync(file)) {
      fail(`src/${edition}/_redirects is missing (Eleventy copies it verbatim)`);
      continue;
    }

    const rules = fs.readFileSync(file, 'utf8')
      .split('\n')
      .map(l => l.trim())
      .filter(l => l && !l.startsWith('#'));
    const dynamic = rules.filter(r => r.includes('*') || /:\w+/.test(r));

    if (dynamic.length > DYNAMIC_LIMIT) {
      fail(
        `src/${edition}/_redirects has ${dynamic.length} dynamic rules; ` +
        `Cloudflare Pages silently drops everything past ${DYNAMIC_LIMIT}. ` +
        `Move the mapping into a Pages Function instead of enumerating it.`,
      );
    } else {
      pass(
        `src/${edition}/_redirects: ${dynamic.length}/${DYNAMIC_LIMIT} dynamic ` +
        `rules (${rules.length} total)`,
      );
    }
  }
}

// --- 2. legacy /api/ URLs still resolve the same way ------------------------
async function checkLegacyApiRules() {
  const { resolveApiRedirect } = await import('../lib/api-redirects.js');

  const lines = fs.readFileSync(FIXTURE, 'utf8')
    .split('\n')
    .map(l => l.trim())
    .filter(l => l && !l.startsWith('#'));

  if (!lines.length) {
    fail(`${path.relative(ROOT, FIXTURE)} has no rules to replay`);
    return;
  }

  // Exercise each rule with an empty splat (the version root) and a deep one,
  // since the dead rules were exactly the deep-link case.
  const probes = ['', 'rpc.imq/', 'core.js/nested/'];
  let checked = 0;

  for (const line of lines) {
    const [source, target] = line.split(/\s+/);
    const prefix = source.replace(/\*$/, '');       // /api/core/1.3.0/
    const expectPrefix = target.replace(/:splat$/, ''); // /api/core/1.15.0/

    for (const probe of probes) {
      const got = resolveApiRedirect(prefix + probe);
      const want = expectPrefix + probe;

      if (got !== want) {
        fail(`${prefix + probe} -> ${got === null ? 'served' : got} (want ${want})`);
      }
      checked++;
    }
  }

  if (!failures) {
    pass(`${lines.length} legacy /api/ rules replay unchanged (${checked} probes)`);
  }

  // The kept trees must be served, never redirected — that is what makes the
  // whole generated API reference reachable.
  const { API_VERSIONS } = await import('../lib/api-versions.js');
  let kept = 0;

  for (const [pkg, plan] of Object.entries(API_VERSIONS)) {
    for (const seg of ['latest', ...plan.archives]) {
      for (const probe of ['', 'rpc.imq/', 'index.md']) {
        const url = `/api/${pkg}/${seg}/${probe}`;
        const got = resolveApiRedirect(url);

        if (got !== null) {
          fail(`${url} must be served, but resolves to ${got}`);
        }
        kept++;
      }
    }
  }
  pass(`${kept} kept-tree URLs are served, not redirected`);

  // Paths the resolver must keep its hands off. /api/contact is the commercial
  // Resend endpoint and shares the package-root URL shape, so it is the one that
  // matters here: it must never be mistaken for a documented package.
  for (const url of ['/api/', '/api/contact', '/api/contact/', '/api/unknown/1.0.0/', '/api/unknown/']) {
    if (resolveApiRedirect(url) !== null) {
      fail(`${url} must be left alone, got ${resolveApiRedirect(url)}`);
    }
  }
  pass('non-versioned and unknown-package paths are left alone');

  // The package root of a documented package must reach the current major.
  // /api/core/ and /api/rpc/ hard-404ed until this: nothing links to them, but
  // they are the obvious trim target of a deep API URL and the path an agent
  // guesses from the package name alone.
  for (const pkg of Object.keys(API_VERSIONS)) {
    for (const url of [`/api/${pkg}`, `/api/${pkg}/`]) {
      const got = resolveApiRedirect(url);

      if (got !== `/api/${pkg}/latest/`) {
        fail(`${url} -> ${got === null ? 'served (404s)' : got} (want /api/${pkg}/latest/)`);
      }
      // One hop only.
      if (resolveApiRedirect(`/api/${pkg}/latest/`) !== null) {
        fail(`${url} would chain: /api/${pkg}/latest/ also redirects`);
      }
    }
  }
  pass(`${Object.keys(API_VERSIONS).length * 2} package-root URLs 301 to /latest/ in one hop`);

  // A version newer than the last docs build must still land somewhere useful —
  // the enumeration used to 404 these until the docs were rebuilt.
  const future = resolveApiRedirect('/api/rpc/3.99.0/rpc.imq/');
  if (future !== '/api/rpc/latest/rpc.imq/') {
    fail(`unbuilt current-major version resolved to ${future}`);
  } else {
    pass('versions published after the last docs build resolve to /latest/');
  }

  await checkDupePackagePages();
  await checkCoreReexports();
  await checkRenamedPages();
  await checkRenamedPackages();
  await checkLegacyTypedoc();
}

// --- 2e. a renamed package's old URLs reach the new ones, in one hop ----------
// Nothing else in this file covers a package RENAME: the legacy fixture holds only
// core and rpc rules, and every other assertion iterates API_VERSIONS — which a
// retired slug leaves the moment the rename lands. So the suite would go on
// printing all-green over 300 dead URLs.
//
// Two traps this exists to catch, both of which look fine at the package root:
//
//   * api-documenter puts the package name in the page BASENAME as well as the
//     directory, so a splat-style rule sends every symbol page to a 404 while
//     /api/<old>/ itself redirects correctly.
//   * the basename rewrite has to be anchored. Eleven sequelize pages carry the
//     name twice (sequelize.sequelize.define, sequelize.queryinterface.sequelize),
//     and a global replace turns them into pg-sequelize.pg-sequelize.define.
async function checkRenamedPackages() {
  const { resolveApiRedirect, resolveRenamedPackage } =
    await import('../lib/api-redirects.js');
  const { API_VERSIONS } = await import('../lib/api-versions.js');
  const { RENAMED_PACKAGES: MAP } = await import('../lib/api-renamed.js');
  const { RENAMED_PACKAGES: CONFIG } = require('./lib/api-packages');

  // The runtime map is generated; a stale commit of it is a silent regression,
  // since the resolver reads the generated copy and nothing else would notice.
  const generated = [...MAP].map(([from, to]) => `${from}=>${to}`).sort();
  const configured = CONFIG.map(r => `${r.from}=>${r.to}`).sort();

  if (JSON.stringify(generated) !== JSON.stringify(configured)) {
    fail(
      'lib/api-renamed.js is out of step with RENAMED_PACKAGES in ' +
      `scripts/lib/api-packages.js (generated: ${generated.join(', ') || 'none'}; ` +
      `configured: ${configured.join(', ') || 'none'}) — run npm run build-docs`,
    );
  } else {
    pass(`lib/api-renamed.js matches the config (${generated.length} rename(s))`);
  }

  let pending = 0;

  for (const [from, to] of MAP) {
    // Before the cutover the old slug is still the live package and the new one
    // has no pages, so the resolver is deliberately inert. Assert THAT instead:
    // an active redirect here would be pointing at a 404.
    if (!API_VERSIONS[to]) {
      pending++;

      if (resolveRenamedPackage(`/api/${from}/latest/`) !== null) {
        fail(`${from} -> ${to} redirects before ${to} has any published docs`);
      }

      continue;
    }

    const mustBeMounted = path.join(ROOT, 'functions', 'api', from, '[[path]].js');

    // Functions are evaluated ahead of _redirects, so no mount means the resolver
    // never runs for these paths, however correct it is. check:links cannot see
    // this — it knows nothing about functions/.
    if (!fs.existsSync(mustBeMounted)) {
      fail(`functions/api/${from}/[[path]].js is missing — /api/${from}/* would 404`);
    } else {
      pass(`functions/api/${from}/ is mounted so its URLs reach the resolver`);
    }

    const dir = path.join(ROOT, 'src', 'org', 'api', from);

    if (fs.existsSync(dir)) {
      fail(`src/org/api/${from}/ still exists — it keeps building pages under the retired name`);
    }

    // One hop, and onto a page that is actually on disk.
    const cases = [
      `/api/${from}`,
      `/api/${from}/`,
      `/api/${from}/latest/`,
      `/api/${from}/latest/${from}/`,
      `/api/${from}/1.0.0/`,
    ];

    for (const page of pagesOf(to)) {
      cases.push(`/api/${from}/latest/${from}.${page}/`);
      cases.push(`/api/${from}/3.0.0/${from}.${page}/`);
    }

    for (const from_ of cases) {
      const target = resolveApiRedirect(from_);

      if (!target) {
        fail(`${from_} does not redirect`);
        continue;
      }
      if (resolveApiRedirect(target)) {
        fail(`${from_} -> ${target} needs a second hop`);
      }
      if (!existsOnDisk(target)) {
        fail(`${from_} -> ${target}, which is not a page on disk`);
      }
    }

    pass(`${from} -> ${to}: ${cases.length} URL(s) resolve in one hop to a real page`);
  }

  if (pending) {
    pass(`${pending} rename(s) staged but not cut over yet — resolver inert, as intended`);
  }
}

/** Symbol page basenames published for a package, without the `<pkg>.` prefix. */
function pagesOf(pkg) {
  const dir = path.join(ROOT, 'src', 'org', 'api', pkg, 'latest');

  if (!fs.existsSync(dir)) {
    return [];
  }

  return fs.readdirSync(dir)
    .filter(f => f.startsWith(`${pkg}.`) && f.endsWith('.md'))
    .map(f => f.slice(pkg.length + 1, -3));
}

/** Whether a /api/… pathname has a source page behind it. */
function existsOnDisk(pathname) {
  const m = /^\/api\/([^/]+)\/([^/]+)\/(.+?)?\/?$/.exec(pathname);

  if (!m) {
    return false;
  }

  const [, pkg, seg, page] = m;
  const base = path.join(ROOT, 'src', 'org', 'api', pkg, seg);

  return page
    ? fs.existsSync(path.join(base, `${page}.md`))
    : fs.existsSync(path.join(base, 'index.md'));
}

// --- 2b. the retired duplicate package page 301s onto the package root -------
// api-documenter emits the package page as both `<pkg>.md` and `index.md`, so
// /api/<pkg>/<seg>/<pkg>/ used to exist alongside /api/<pkg>/<seg>/ with
// byte-identical content, both self-canonical and both in the sitemap. Dropping
// the duplicate was right, but it left six live, indexable, sitemap-listed URLs
// hard-404ing. They must 301, in one hop, and the source file must stay gone.
async function checkDupePackagePages() {
  const { resolveApiRedirect } = await import('../lib/api-redirects.js');
  const { API_VERSIONS } = await import('../lib/api-versions.js');
  let checked = 0;

  for (const [pkg, plan] of Object.entries(API_VERSIONS)) {
    for (const seg of ['latest', ...plan.archives]) {
      const want = `/api/${pkg}/${seg}/`;

      for (const url of [`${want}${pkg}/`, `${want}${pkg}`]) {
        const got = resolveApiRedirect(url);

        if (got !== want) {
          fail(`${url} -> ${got === null ? 'served (404s)' : got} (want ${want})`);
        }
        // One hop: the target itself must be served, not redirected again.
        if (resolveApiRedirect(want) !== null) {
          fail(`${url} would chain: ${want} also redirects`);
        }
        checked++;
      }

      // If api-documenter's duplicate ever comes back, the redirect above would
      // shadow a real page instead of salvaging a dead one.
      const dupe = path.join(ROOT, 'src', 'org', 'api', pkg, seg, `${pkg}.md`);
      if (fs.existsSync(dupe)) {
        fail(`${path.relative(ROOT, dupe)} is back; it is now unreachable by design`);
      }
    }
  }

  // A retired version must reach the root in one hop, not via /latest/<pkg>/.
  for (const [pkg, plan] of Object.entries(API_VERSIONS)) {
    const retired = `${plan.latest.split('.')[0]}.0.0`;
    const got = resolveApiRedirect(`/api/${pkg}/${retired}/${pkg}/`);

    if (got !== `/api/${pkg}/latest/`) {
      fail(`/api/${pkg}/${retired}/${pkg}/ -> ${got} (want /api/${pkg}/latest/)`);
    }
    checked++;
  }

  pass(`${checked} duplicate package-page URLs 301 onto the package root in one hop`);
}

// --- 3. stripped core re-exports land on a page that exists -----------------
// These 301s only fire after a 404, so the risk is not shadowing a real page —
// it is redirecting into another 404, which is worse for crawling than the 404.
async function checkCoreReexports() {
  const { resolveCoreReexport } = await import('../lib/api-redirects.js');
  const { CORE_REEXPORTS } = await import('../lib/api-crosslinks.js');
  const coreDir = path.join(ROOT, 'src', 'org', 'api', 'core', 'latest');
  const rpcDir = path.join(ROOT, 'src', 'org', 'api', 'rpc', 'latest');
  let broken = 0;
  let shadowed = 0;

  for (const sym of CORE_REEXPORTS) {
    const target = resolveCoreReexport(`/api/rpc/latest/rpc.${sym}/`);

    if (!target) {
      fail(`rpc.${sym} is listed as a re-export but does not resolve`);
      broken++;
      continue;
    }
    if (!fs.existsSync(path.join(coreDir, `core.${sym}.md`))) {
      fail(`rpc.${sym} would 301 to a page that does not exist: ${target}`);
      broken++;
    }
    // Must never claim a symbol rpc documents itself.
    if (fs.existsSync(path.join(rpcDir, `rpc.${sym}.md`))) {
      fail(`rpc.${sym} exists under rpc/latest but is listed as a re-export`);
      shadowed++;
    }
  }

  if (!broken && !shadowed) {
    pass(
      `${CORE_REEXPORTS.size} stripped core re-exports 301 onto a core page ` +
      `that exists, and none shadow a real rpc page`,
    );
  }

  // Symbols rpc genuinely documents must be served, not salvaged.
  for (const real of ['rpc.imq', 'rpc.imqrpcerror', 'rpc.expose']) {
    if (!fs.existsSync(path.join(rpcDir, `${real}.md`))) {
      continue; // not in this build; nothing to assert
    }
    if (resolveCoreReexport(`/api/rpc/latest/${real}/`) !== null) {
      fail(`${real} is a real rpc page but the re-export salvage claims it`);
    }
  }
  pass('real rpc symbol pages are not claimed by the re-export salvage');
}

// --- 4. de-suffixed pages keep their old URL resolving -----------------------
// Same risk as (3) — a 301 into another 404 — plus one of its own: the salvage
// must not claim pg-pubsub's `on_1`…`on_9`, which are genuine overload pages and
// have to keep serving a 200.
async function checkRenamedPages() {
  const { resolveRenamedApiPage } = await import('../lib/api-redirects.js');
  const { RENAMED_API_PAGES } = await import('../lib/api-renames.js');
  const pageFor = (slug) => path.join(ROOT, 'src', 'org', 'api', `${slug}.md`);
  let broken = 0;

  for (const [from, to] of RENAMED_API_PAGES) {
    const target = resolveRenamedApiPage(`/api/${from}/`);

    if (target !== `/api/${to}/`) {
      fail(`${from} does not resolve to its new URL (got ${target})`);
      broken++;
      continue;
    }
    if (!fs.existsSync(pageFor(to))) {
      fail(`${from} would 301 to a page that does not exist: ${target}`);
      broken++;
    }
    // The whole point of the rename: the suffixed page must be gone, or the
    // redirect would be shadowing a live page rather than salvaging a dead URL.
    if (fs.existsSync(pageFor(from))) {
      fail(`${from} still exists on disk but is listed as renamed`);
      broken++;
    }
  }

  if (!broken) {
    pass(
      `${RENAMED_API_PAGES.size} de-suffixed page(s) 301 onto a page that ` +
      'exists, and none shadow a live page',
    );
  }

  // Genuine overload pages share the `_N` shape and must never be salvaged.
  let claimed = 0;

  for (const dir of fs.existsSync(path.join(ROOT, 'src', 'org', 'api'))
    ? fs.readdirSync(path.join(ROOT, 'src', 'org', 'api'), { recursive: true })
    : []) {
    const file = String(dir);

    if (!file.endsWith('.md') || !/_\d+\.md$/.test(file)) continue;

    const slug = file.replace(/\.md$/, '').split(path.sep).join('/');

    if (resolveRenamedApiPage(`/api/${slug}/`) !== null) {
      fail(`${slug} is a live page but the rename salvage claims it`);
      claimed++;
    }
  }
  if (!claimed) {
    pass('live overload pages (on_1 … on_9) are not claimed by the rename salvage');
  }
}

// --- 5. TypeDoc-era URLs land on a page that exists -------------------------
// From when the reference was published on imqueue.com as
// <version>/classes/<Name>.html. GSC reports them as 404s on the .com property and
// GA4 shows crawlers still fetching them, so they are live inbound links, not
// history. Like the other salvages these only fire after a 404, so the risk is
// redirecting into a second 404 — which is worse for crawling than the first one.
//
// Asserted against the pages actually on disk, and only within the SAME version:
// an archived tree contains its own era's symbols, which is what makes the mapping
// safe where retargeting at /latest/ would not be.
async function checkLegacyTypedoc() {
  const { resolveLegacyTypedoc } = await import('../lib/api-redirects.js');
  const apiRoot = path.join(ROOT, 'src', 'org', 'api');
  let checked = 0;
  let broken = 0;
  let trees = 0;

  for (const pkg of fs.readdirSync(apiRoot)) {
    const pkgDir = path.join(apiRoot, pkg);

    if (!fs.statSync(pkgDir).isDirectory()) {
      continue;
    }

    for (const seg of fs.readdirSync(pkgDir)) {
      const dir = path.join(pkgDir, seg);

      if (!/^\d+\.\d+\.\d+$/.test(seg) || !fs.statSync(dir).isDirectory()) {
        continue; // archived version trees only — /latest/ never had TypeDoc URLs
      }
      trees++;

      // Top-level symbol pages only: a member page (core.ilogger.info) had no
      // TypeDoc equivalent, and neither did index.md.
      const symbols = fs.readdirSync(dir)
        .filter((f) => f.endsWith('.md') && f.startsWith(`${pkg}.`))
        .map((f) => f.slice(pkg.length + 1, -3))
        .filter((s) => !s.includes('.'));

      for (const sym of symbols) {
        for (const kind of ['classes', 'interfaces', 'enums']) {
          const target = resolveLegacyTypedoc(`/api/${pkg}/${seg}/${kind}/${sym}.html`);
          const want = `/api/${pkg}/${seg}/${pkg}.${sym}/`;

          checked++;

          if (target !== want) {
            fail(`/api/${pkg}/${seg}/${kind}/${sym}.html resolved to ${target}, want ${want}`);
            broken++;
          } else if (!fs.existsSync(path.join(dir, `${pkg}.${sym}.md`))) {
            fail(`${target} does not exist — the salvage would 301 into a 404`);
            broken++;
          }
        }
      }

      // TypeDoc navigation has no symbol equivalent; both land on the version index.
      for (const nav of ['globals.html', 'modules.html', 'modules/_index_.html']) {
        if (resolveLegacyTypedoc(`/api/${pkg}/${seg}/${nav}`) !== `/api/${pkg}/${seg}/`) {
          fail(`/api/${pkg}/${seg}/${nav} must land on the version index`);
          broken++;
        }
      }
    }
  }

  if (!broken) {
    pass(
      `${checked} TypeDoc-era URLs across ${trees} archived trees 301 onto a page `
      + 'that exists, in the same version',
    );
  }

  // The case the loop above CANNOT see, and which shipped a 301-into-404 until the
  // generated map existed: a legacy URL for a symbol that tree never documented.
  // /api/rpc/2.1.0/interfaces/IMQOptions.html is real — IMQOptions is core's symbol,
  // not rpc's — and it must land on the version index, not on rpc.imqoptions.
  const { ARCHIVED_PAGES } = await import('../lib/api-legacy-pages.js');
  let invented = 0;

  for (const [pkg, seg] of [['rpc', '2.1.0'], ['core', '1.15.0']]) {
    if (!fs.existsSync(path.join(ROOT, 'src', 'org', 'api', pkg, seg))) continue;

    for (const ghost of ['NoSuchSymbol', 'IMQOptions', 'Totally_Made_Up']) {
      if (ARCHIVED_PAGES.has(`${pkg}/${seg}/${pkg}.${ghost.toLowerCase()}`)) continue;

      const got = resolveLegacyTypedoc(`/api/${pkg}/${seg}/interfaces/${ghost}.html`);

      if (got !== `/api/${pkg}/${seg}/`) {
        fail(`${pkg}/${seg} has no page for ${ghost}, so it must land on the version index, got ${got}`);
        invented++;
      }
    }
  }

  if (!invented) {
    pass('a symbol the tree never documented lands on the version index, not a 404');
  }

  // The map is generated from the tree, so drift means someone edited one of them.
  const onDisk = new Set();

  for (const pkg of fs.readdirSync(path.join(ROOT, 'src', 'org', 'api'))) {
    const pkgDir = path.join(ROOT, 'src', 'org', 'api', pkg);

    if (!fs.statSync(pkgDir).isDirectory()) continue;

    for (const seg of fs.readdirSync(pkgDir)) {
      const dir = path.join(pkgDir, seg);

      if (!/^\d+\.\d+\.\d+$/.test(seg) || !fs.statSync(dir).isDirectory()) continue;

      for (const f of fs.readdirSync(dir)) {
        if (f.endsWith('.md') && f !== 'index.md') onDisk.add(`${pkg}/${seg}/${f.slice(0, -3)}`);
      }
    }
  }

  const missing = [...onDisk].filter((p) => !ARCHIVED_PAGES.has(p));
  const stale = [...ARCHIVED_PAGES].filter((p) => !onDisk.has(p));

  if (missing.length || stale.length) {
    fail(
      `lib/api-legacy-pages.js is out of step with the tree: ${missing.length} page(s) `
      + `missing, ${stale.length} stale. Re-run \`npm run build-docs\`.`,
    );
  } else {
    pass(`lib/api-legacy-pages.js matches the tree (${ARCHIVED_PAGES.size} archived pages)`);
  }

  // It must claim nothing that is live or that belongs to another handler.
  for (const live of [
    '/api/', '/api/contact', '/api/core/latest/', '/api/rpc/latest/rpc.imq/',
    '/api/rpc/2.1.0/rpc.imqclient/', '/api/core/1.15.0/',
  ]) {
    if (resolveLegacyTypedoc(live) !== null) {
      fail(`the TypeDoc salvage must not claim ${live}`);
    }
  }
  pass('live URLs and /api/contact are not claimed by the TypeDoc salvage');
}


(async () => {
  console.log('Cloudflare redirect checks');
  checkDynamicBudget();
  await checkLegacyApiRules();

  if (failures) {
    console.error(`\n${failures} check(s) failed.`);
    process.exit(1);
  }
  console.log('\nAll redirect checks passed.');
})();
