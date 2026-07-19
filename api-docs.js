// api-docs.js — generate @imqueue API docs (core, rpc) for the LATEST version as
// native Eleventy pages embedded in the site (nav/footer/theme/prose), rendered
// through the apiref.html layout with a symbol sidebar.
// Local tool: requires sibling ../core and ../rpc source repos. Run: npm run build-docs
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { ExtractorConfig, Extractor } = require('@microsoft/api-extractor');

const ROOT = process.cwd();
const TMP = path.join(ROOT, '.api-tmp');
const PKGS = [
  { name: 'core', repo: path.resolve(ROOT, '../core'), config: 'api-extractor.core.json' },
  { name: 'rpc',  repo: path.resolve(ROOT, '../rpc'),  config: 'api-extractor.rpc.json' },
];

// api-documenter section headings that list top-level symbols (for the sidebar).
const GROUPS = [
  'Classes', 'Abstract Classes', 'Enumerations', 'Functions',
  'Interfaces', 'Variables', 'Type Aliases', 'Namespaces',
];

function sh(cmd, cwd) {
  console.log(`$ ${cmd}`);
  execSync(cmd, { cwd: cwd || ROOT, stdio: 'inherit' });
}
function rmrf(p) { fs.rmSync(p, { recursive: true, force: true }); }

function firstHeading(text, fallback) {
  const m = text.match(/^#{1,4}\s+(.+?)\s*$/m);
  return m ? m[1].replace(/[\\`]/g, '').trim() : fallback;
}

function main() {
  rmrf(TMP);
  fs.mkdirSync(TMP, { recursive: true });

  try {
    for (const pkg of PKGS) {
      const version = require(path.join(pkg.repo, 'package.json')).version;
      console.log(`\n=== @imqueue/${pkg.name}@${version} ===`);

      // clean-URL for a documenter file (dropping the .md); the package's own
      // page and index both map to the version root.
      const urlFor = (file) => {
        const base = file.replace(/\.md$/, '');
        if (base === 'index' || base === pkg.name) return `/api/${pkg.name}/${version}/`;
        return `/api/${pkg.name}/${version}/${base}/`;
      };
      // rewrite intra-doc markdown links: [x](./foo.md#a) -> [x](/api/<pkg>/<ver>/foo/#a)
      const rewriteLinks = (text) => text.replace(
        /\]\((?:\.\/)?([A-Za-z0-9._-]+)\.md(#[^)]*)?\)/g,
        (_m, name, anchor) => `](${urlFor(name)}${anchor || ''})`,
      );

      // 1. build sibling -> fresh .d.ts
      sh('npm run build', pkg.repo);

      // 2. API Extractor (programmatic) -> .api-tmp/<pkg>.api.json labeled @imqueue/<pkg>!
      const configFilePath = path.join(ROOT, pkg.config);
      const extractorConfig = ExtractorConfig.prepare({
        configObject: ExtractorConfig.loadFile(configFilePath),
        configObjectFullPath: configFilePath,
        packageJsonFullPath: path.join(pkg.repo, 'package.json'),
      });
      const result = Extractor.invoke(extractorConfig, { localBuild: true, showVerboseMessages: false });
      if (!result.succeeded) {
        throw new Error(`API Extractor failed for ${pkg.name} (${result.errorCount} errors)`);
      }

      const modelDir = path.join(TMP, `${pkg.name}-model`);
      fs.mkdirSync(modelDir, { recursive: true });
      fs.copyFileSync(extractorConfig.apiJsonFilePath, path.join(modelDir, `${pkg.name}.api.json`));

      // 3. API Documenter -> markdown
      const mdDir = path.join(TMP, `${pkg.name}-md`);
      sh(`npx api-documenter markdown --input-folder "${modelDir}" --output-folder "${mdDir}"`);

      // 4. Emit markdown into the Eleventy source as native pages.
      const outDir = path.join(ROOT, 'src', 'org', 'api', pkg.name, version);
      rmrf(outDir);
      fs.mkdirSync(outDir, { recursive: true });

      const pkgPageFile = `${pkg.name}.md`;
      const pkgPageMd = fs.readFileSync(path.join(mdDir, pkgPageFile), 'utf8');

      // build the symbol sidebar from the package page's grouped tables
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
      if (!apiNav.length) throw new Error(`No symbols parsed for ${pkg.name} sidebar`);

      let count = 0;
      for (const file of fs.readdirSync(mdDir)) {
        if (!file.endsWith('.md')) continue;
        const raw = fs.readFileSync(path.join(mdDir, file), 'utf8');
        const title = `${firstHeading(raw, file.replace(/\.md$/, ''))} · @imqueue/${pkg.name}`;
        const fm = `---\ntitle: ${JSON.stringify(title)}\n---\n\n`;
        fs.writeFileSync(path.join(outDir, file), fm + rewriteLinks(raw));
        count++;
      }

      // open the package page directly at the version root
      const idxTitle = `@imqueue/${pkg.name} ${version} · API reference`;
      fs.writeFileSync(
        path.join(outDir, 'index.md'),
        `---\ntitle: ${JSON.stringify(idxTitle)}\n---\n\n` + rewriteLinks(pkgPageMd),
      );

      // directory data: layout + section + sidebar for every page in this version
      fs.writeFileSync(
        path.join(outDir, `${version}.11tydata.json`),
        JSON.stringify({ layout: 'apiref.html', section: 'api', apiPkg: pkg.name, apiVersion: version, apiNav }, null, 2),
      );

      // retire the old standalone latest build (older versions stay under api/)
      rmrf(path.join(ROOT, 'api', pkg.name, version));

      console.log(`Wrote ${count} pages + index to ${path.relative(ROOT, outDir)} (${apiNav.reduce((n, g) => n + g.items.length, 0)} symbols in sidebar)`);
    }
  } finally {
    rmrf(TMP);
  }

  console.log('\nDone!');
}

main();
