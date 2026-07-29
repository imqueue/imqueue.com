// build-api-docs.js — automatic @imqueue API-reference builder.
//
// Policy (per package):
//   * /api/<pkg>/latest/  ALWAYS serves the current MAJOR's newest release.
//     A new minor/patch of the current major just moves /latest/ forward — it
//     is NOT published under its own versioned URL.
//   * Each PAST major keeps exactly ONE archived copy: that major's highest
//     release, at /api/<pkg>/<version>/ (shown under "Older versions").
//   * When a new major ships, the outgoing major's highest release becomes its
//     archive entry and /latest/ moves to the new major.
//
// Everything is sourced from the PUBLISHED npm packages (no local source build),
// so this runs anywhere with npm + network. Re-run on every release.
//
//   npm run build-docs                 # rebuild all packages per policy
//   node scripts/build-api-docs.js rpc # just one package
//
// Outputs: src/org/api/<pkg>/{latest,<archive-ver>}/ pages, src/_data/
// apiVersions.json (consumed by the /api/ landing page), and the generated API
// section of src/org/_redirects (retired version URLs 301 to their kept copy).
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { ExtractorConfig, Extractor } = require('@microsoft/api-extractor');
const { apiDescription } = require('./lib/api-summary');
const { generate: genCrosslinks } = require('./gen-api-crosslinks');

const ROOT = process.cwd();
const TMP = path.join(ROOT, '.api-tmp', 'build');
const DOCUMENTER = path.join(ROOT, 'node_modules', '.bin', 'api-documenter');
const PKGS = ['core', 'rpc'];

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

// --- semver (release versions only) --------------------------------------
function parseVer(v) { return v.split('.').map(Number); }
function cmpVer(a, b) {
  const x = parseVer(a), y = parseVer(b);
  for (let i = 0; i < 3; i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0); }
  return 0;
}
function majorOf(v) { return parseVer(v)[0]; }

// Compute the publish plan for a package from its npm version history.
function planFor(pkg) {
  const raw = JSON.parse(shq(`npm view @imqueue/${pkg} versions --json`));
  const versions = (Array.isArray(raw) ? raw : [raw])
    .filter(v => !v.includes('-')) // drop pre-releases
    .sort(cmpVer);
  const latest = versions[versions.length - 1];
  const currentMajor = majorOf(latest);

  // highest release of each past major, newest major first
  const byMajor = {};
  for (const v of versions) { const m = majorOf(v); if (!byMajor[m] || cmpVer(v, byMajor[m]) > 0) byMajor[m] = v; }
  const archives = Object.keys(byMajor).map(Number).filter(m => m < currentMajor)
    .sort((a, b) => b - a).map(m => byMajor[m]);

  return { versions, latest, currentMajor, archives, highestOfMajor: byMajor };
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
function embed({ pkg, version, seg, mdDir, latestFiles }) {
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
  const frontMatter = (title, latestUrl, description) => {
    let fm = `title: ${JSON.stringify(title)}\n`;
    if (description) fm += `description: ${JSON.stringify(description)}\n`;
    if (isArchived) fm += `noindex: true\nlatestUrl: ${JSON.stringify(latestUrl)}\n`;
    return `---\n${fm}---\n\n`;
  };
  const archivedSuffix = isArchived ? ` v${version} (archived)` : '';

  const basenames = new Set(['index']);
  let count = 0;
  for (const file of fs.readdirSync(mdDir)) {
    if (!file.endsWith('.md')) continue;
    // api-documenter's package page is `<pkg>.md`, and it is also what index.md
    // is written from. Emitting both produced two indexable URLs with identical
    // content — /api/<pkg>/<seg>/<pkg>/ competing with /api/<pkg>/<seg>/, each
    // self-canonical and both in the sitemap. rewriteLinks() already points
    // `<pkg>.md` links at the package root, so nothing links to the duplicate.
    if (file === `${pkg}.md`) continue;
    const b = file.replace(/\.md$/, '');
    basenames.add(b);
    const raw = fs.readFileSync(path.join(mdDir, file), 'utf8');
    const symbol = firstHeading(raw, b);
    const title = `${symbol} · @imqueue/${pkg}${archivedSuffix}`;
    const desc = apiDescription(raw, { pkg, version, symbol });
    fs.writeFileSync(path.join(outDir, file),
      frontMatter(title, latestUrlFor(b), desc) + rewriteLinks(raw));
    count++;
  }
  const indexTitle = `@imqueue/${pkg} ${version} · API reference${isArchived ? ' (archived)' : ''}`;
  const indexDesc = apiDescription(pkgPageMd, { pkg, version, symbol: `${pkg} package` });
  fs.writeFileSync(path.join(outDir, 'index.md'),
    frontMatter(indexTitle, `/api/${pkg}/latest/`, indexDesc) + rewriteLinks(pkgPageMd));
  // bareTitle: these titles already end with "· @imqueue/<pkg>", so letting
  // head.html append its "· @imqueue" suffix produced
  // "Foo.bar() method · @imqueue/core · @imqueue" — 11 wasted characters of SERP
  // budget on every page, and the brand twice.
  fs.writeFileSync(path.join(outDir, `${seg}.11tydata.json`),
    JSON.stringify({ layout: 'apiref.html', section: 'api', bareTitle: true, apiPkg: pkg, apiVersion: version, apiVersionPath: seg, apiNav }, null, 2));

  console.log(`  embedded ${count} pages -> src/org/api/${pkg}/${seg}/ (${apiNav.reduce((n, g) => n + g.items.length, 0)} symbols)`);
  return basenames;
}

// Fetch a published version from npm and emit it at the given URL segment.
// Returns the set of page basenames written (see embed()).
function generate({ pkg, version, seg, latestFiles }) {
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

  // Resolve @imqueue/core for rpc's cross-package type references, but never
  // bundle it (core has its own pages; bundling hits an api-extractor defect).
  if (pj.dependencies && pj.dependencies['@imqueue/core']) {
    sh(`npm install @imqueue/core@"${pj.dependencies['@imqueue/core']}" --no-save --no-audit --no-fund --ignore-scripts --loglevel=error`, pkgDir);
    stripReexports(pkgDir, '@imqueue/core', { skipNodeModules: true });
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
    compiler: { overrideTsconfig: { compilerOptions: { target: 'ESNext', module: 'nodenext', moduleResolution: 'nodenext', skipLibCheck: true, types: [], lib: ['ESNext'] }, include: [entry] } },
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

  const modelDir = path.join(work, 'model');
  fs.mkdirSync(modelDir, { recursive: true });
  fs.copyFileSync(path.join(work, `${pkg}.api.json`), path.join(modelDir, `${pkg}.api.json`));
  const mdDir = path.join(work, 'md');
  sh(`"${DOCUMENTER}" markdown --input-folder "${modelDir}" --output-folder "${mdDir}"`);

  return embed({ pkg, version, seg, mdDir, latestFiles });
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

function main() {
  const only = process.argv.slice(2);
  const pkgs = only.length ? PKGS.filter(p => only.includes(p)) : PKGS;

  rmrf(TMP);
  fs.mkdirSync(TMP, { recursive: true });
  const apiVersions = {};
  try {
    for (const pkg of pkgs) {
      const plan = planFor(pkg);
      console.log(`\n##### @imqueue/${pkg}: latest ${plan.latest} (major ${plan.currentMajor}), archives [${plan.archives.join(', ') || 'none'}]`);
      const latestFiles = generate({ pkg, version: plan.latest, seg: 'latest' });
      for (const v of plan.archives) generate({ pkg, version: v, seg: v, latestFiles });
      cleanStale(pkg, ['latest', ...plan.archives]);
      apiVersions[pkg] = { latest: plan.latest, archives: plan.archives };
    }
  } finally {
    rmrf(TMP);
  }

  // Only rewrite shared outputs for a full build (partial builds would drop the
  // other package's data / redirects).
  if (pkgs.length === PKGS.length) {
    fs.writeFileSync(path.join(ROOT, 'src', '_data', 'apiVersions.json'), JSON.stringify(apiVersions, null, 2) + '\n');
    console.log(`\nWrote src/_data/apiVersions.json: ${JSON.stringify(apiVersions)}`);
    writeVersionModule(apiVersions);
    writeRedirects();
    // Depends on both packages' pages being on disk, so it runs last.
    genCrosslinks();
  } else {
    console.log('\nPartial build — left src/_data/apiVersions.json, lib/api-versions.js and src/org/_redirects untouched.');
  }
  console.log('\nDone!');
}

main();
