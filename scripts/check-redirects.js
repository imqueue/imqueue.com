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
