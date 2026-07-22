// gen-api-archive.js — regenerate the KEPT archived API versions as native,
// site-styled Eleventy pages (same apiref.html layout + sidebar as /latest/),
// instead of the old standalone TypeDoc HTML.
//
// Unlike api-docs.js (which builds the sibling source repos for the current
// release), this sources each old version's type definitions from its PUBLISHED
// npm package, so it needs no local source checkout or tsc build. Requires
// network access (npm) and the api-extractor/api-documenter devDependencies.
//
//   node scripts/gen-api-archive.js            # all versions in ARCHIVES
//   node scripts/gen-api-archive.js core@2.0.2 # just one
//
// Output: src/org/api/<pkg>/<version>/ at URL /api/<pkg>/<version>/.
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { ExtractorConfig, Extractor } = require('@microsoft/api-extractor');

const ROOT = process.cwd();
const TMP = path.join(ROOT, '.api-tmp', 'archive');
const DOCUMENTER = path.join(ROOT, 'node_modules', '.bin', 'api-documenter');

// Keep only the highest minor/patch of each retired major (see src/org/_redirects).
const ARCHIVES = [
  { pkg: 'core', version: '1.3.15' },
  { pkg: 'core', version: '2.0.2' },
  { pkg: 'rpc', version: '1.2.12' },
  { pkg: 'rpc', version: '2.0.4' },
];

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

// Remove `export { ... } from '<module>'` / `export * from '<module>'` re-export
// lines (for a module matched by `modulePattern`) from .d.ts files under a dir.
// Only re-EXPORTS are removed; imports/uses of the symbols are untouched.
function stripReexports(dir, modulePattern, { skipNodeModules = false } = {}) {
  const RE = new RegExp(
    `^\\s*export\\s*(?:type\\s*)?(?:\\{[^}]*\\}|\\*(?:\\s+as\\s+\\w+)?)\\s*from\\s*['"]${modulePattern}['"];?\\s*$`,
    'gm',
  );
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.isDirectory()) {
        if (skipNodeModules && e.name === 'node_modules') continue;
        walk(path.join(d, e.name));
      } else if (e.name.endsWith('.d.ts')) {
        const p = path.join(d, e.name);
        const src = fs.readFileSync(p, 'utf8');
        if (RE.test(src)) fs.writeFileSync(p, src.replace(RE, ''));
      }
    }
  };
  walk(dir);
}

function embed({ pkg, version, mdDir }) {
  const seg = version; // URL segment is the version for archives
  const base_ = `/api/${pkg}/${seg}`;
  const urlFor = (file) => {
    const b = file.replace(/\.md$/, '');
    if (b === 'index' || b === pkg) return `${base_}/`;
    return `${base_}/${b}/`;
  };
  // Home breadcrumb -> API landing; other intra-doc links -> this version's pages.
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
      while ((m = re.exec(line))) cur.items.push({ name: m[1], url: urlFor(m[2]) });
    }
  }
  if (!apiNav.length) throw new Error(`No symbols parsed for ${pkg}@${version} sidebar`);

  let count = 0;
  for (const file of fs.readdirSync(mdDir)) {
    if (!file.endsWith('.md')) continue;
    const raw = fs.readFileSync(path.join(mdDir, file), 'utf8');
    const title = `${firstHeading(raw, file.replace(/\.md$/, ''))} · @imqueue/${pkg}`;
    const fm = `---\ntitle: ${JSON.stringify(title)}\n---\n\n`;
    fs.writeFileSync(path.join(outDir, file), fm + rewriteLinks(raw));
    count++;
  }

  const idxTitle = `@imqueue/${pkg} ${version} · API reference`;
  fs.writeFileSync(path.join(outDir, 'index.md'),
    `---\ntitle: ${JSON.stringify(idxTitle)}\n---\n\n` + rewriteLinks(pkgPageMd));

  fs.writeFileSync(path.join(outDir, `${seg}.11tydata.json`),
    JSON.stringify({ layout: 'apiref.html', section: 'api', apiPkg: pkg, apiVersion: version, apiVersionPath: seg, apiNav }, null, 2));

  console.log(`  embedded ${count} pages -> src/org/api/${pkg}/${seg}/ (${apiNav.reduce((n, g) => n + g.items.length, 0)} symbols)`);
}

function generate({ pkg, version }) {
  console.log(`\n=== @imqueue/${pkg}@${version} ===`);
  const work = path.join(TMP, `${pkg}-${version}`);
  rmrf(work);
  fs.mkdirSync(work, { recursive: true });

  // 1. fetch the published tarball and unpack
  sh(`npm pack @imqueue/${pkg}@${version} --pack-destination "${work}" --loglevel=error`);
  const tgz = fs.readdirSync(work).find(f => f.endsWith('.tgz'));
  sh(`tar xzf "${tgz}" -C "${work}"`, work);
  const pkgDir = path.join(work, 'package');
  const pj = require(path.join(pkgDir, 'package.json'));
  const entry = pj.types || pj.typings || 'index.d.ts';

  // 2. rpc references @imqueue/core types; install it so those references
  // resolve (used in signatures), but do NOT bundle it — core has its own
  // /api/core/<ver>/ pages, and bundling triggers api-extractor's isExternal
  // conflict on inline import() type nodes.
  if (pj.dependencies && pj.dependencies['@imqueue/core']) {
    sh(`npm install @imqueue/core@"${pj.dependencies['@imqueue/core']}" --no-save --no-audit --no-fund --ignore-scripts --loglevel=error`, pkgDir);
    // core re-exports EventEmitter from node:events; api-extractor throws a hard
    // "Unsupported export" on a re-exported EXTERNAL symbol. Strip those re-export
    // lines everywhere (uses as a base class still resolve fine).
    stripReexports(pkgDir, '(?:node:)?events');
    // Drop rpc's own `export * from '@imqueue/core'` so we don't re-export an
    // external package (would need bundling). rpc's own symbols are unaffected.
    stripReexports(pkgDir, '@imqueue/core', { skipNodeModules: true });
  }
  const bundled = [];

  // 3. API Extractor -> api model json
  const cfgObj = {
    $schema: 'https://developer.microsoft.com/json-schemas/api-extractor/v7/api-extractor.schema.json',
    projectFolder: pkgDir,
    mainEntryPointFilePath: path.join(pkgDir, entry),
    bundledPackages: bundled,
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
  const res = Extractor.invoke(ec, { localBuild: true, showVerboseMessages: false });
  if (!res.succeeded) throw new Error(`API Extractor failed for ${pkg}@${version} (${res.errorCount} errors)`);

  // 4. API Documenter -> markdown
  const modelDir = path.join(work, 'model');
  fs.mkdirSync(modelDir, { recursive: true });
  fs.copyFileSync(path.join(work, `${pkg}.api.json`), path.join(modelDir, `${pkg}.api.json`));
  const mdDir = path.join(work, 'md');
  sh(`"${DOCUMENTER}" markdown --input-folder "${modelDir}" --output-folder "${mdDir}"`);

  // 5. embed as site pages
  embed({ pkg, version, mdDir });
}

function main() {
  const filter = process.argv.slice(2);
  const list = filter.length
    ? ARCHIVES.filter(a => filter.includes(`${a.pkg}@${a.version}`))
    : ARCHIVES;
  if (!list.length) { console.error('No matching versions.'); process.exit(1); }

  rmrf(TMP);
  fs.mkdirSync(TMP, { recursive: true });
  try {
    for (const a of list) generate(a);
  } finally {
    rmrf(TMP);
  }
  console.log('\nDone!');
}

main();
