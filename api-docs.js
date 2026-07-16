// api-docs.js — generate @imqueue API docs (core, rpc) as standalone HTML pages.
// Local tool: requires sibling ../core and ../rpc source repos. Run: npm run build-docs
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const MarkdownIt = require('markdown-it');
const { ExtractorConfig, Extractor } = require('@microsoft/api-extractor');

const ROOT = process.cwd();
const TMP = path.join(ROOT, '.api-tmp');
const PKGS = [
  { name: 'core', repo: path.resolve(ROOT, '../core'), config: 'api-extractor.core.json' },
  { name: 'rpc',  repo: path.resolve(ROOT, '../rpc'),  config: 'api-extractor.rpc.json' },
];

const md = new MarkdownIt({ html: true, linkify: false });

function sh(cmd, cwd) {
  console.log(`$ ${cmd}`);
  execSync(cmd, { cwd: cwd || ROOT, stdio: 'inherit' });
}
function rmrf(p) { fs.rmSync(p, { recursive: true, force: true }); }

function firstHeading(text, fallback) {
  const m = text.match(/^#\s+(.+?)\s*$/m);
  return m ? m[1].replace(/[\\`]/g, '').trim() : fallback;
}

function renderPage(mdText, title) {
  const body = md.render(mdText)
    // rewrite intra-doc links: ./foo.md and foo.md#anchor -> .html
    .replace(/href="([^"]+?)\.md(#[^"]*)?"/g, 'href="$1.html$2"');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<link rel="stylesheet" href="/api/assets/apidoc.css">
</head>
<body>
<main class="apidoc">
${body}
</main>
</body>
</html>
`;
}

function main() {
  rmrf(TMP);
  fs.mkdirSync(TMP, { recursive: true });

  for (const pkg of PKGS) {
    const version = require(path.join(pkg.repo, 'package.json')).version;
    console.log(`\n=== @imqueue/${pkg.name}@${version} ===`);

    // 1. build sibling -> fresh .d.ts
    sh('npm run build', pkg.repo);

    // 2. API Extractor via the programmatic API (not `npx api-extractor run`):
    //    passing the sibling's own package.json ensures the model is labeled
    //    @imqueue/<pkg>! instead of imqueue.com! -> .api-tmp/<pkg>.api.json
    const configFilePath = path.join(ROOT, pkg.config);
    const extractorConfig = ExtractorConfig.prepare({
      configObject: ExtractorConfig.loadFile(configFilePath),
      configObjectFullPath: configFilePath,
      packageJsonFullPath: path.join(pkg.repo, 'package.json'),
    });
    const result = Extractor.invoke(extractorConfig, {
      localBuild: true,
      showVerboseMessages: false,
    });
    if (!result.succeeded) {
      throw new Error(`API Extractor failed for ${pkg.name} (${result.errorCount} errors)`);
    }
    const apiJsonFilePath = extractorConfig.apiJsonFilePath;

    // isolate the model in its own input folder for the documenter
    const modelDir = path.join(TMP, `${pkg.name}-model`);
    fs.mkdirSync(modelDir, { recursive: true });
    fs.copyFileSync(
      apiJsonFilePath,
      path.join(modelDir, `${pkg.name}.api.json`),
    );

    // 3. API Documenter -> markdown
    const mdDir = path.join(TMP, `${pkg.name}-md`);
    sh(`npx api-documenter markdown --input-folder "${modelDir}" --output-folder "${mdDir}"`);

    // 4. render markdown -> standalone HTML into api/<pkg>/<version>/
    const outDir = path.join(ROOT, 'api', pkg.name, version);
    rmrf(outDir);
    fs.mkdirSync(outDir, { recursive: true });
    let count = 0;
    for (const file of fs.readdirSync(mdDir)) {
      if (!file.endsWith('.md')) continue;
      const src = fs.readFileSync(path.join(mdDir, file), 'utf8');
      const title = `${firstHeading(src, pkg.name)} | @imqueue/${pkg.name} ${version}`;
      fs.writeFileSync(
        path.join(outDir, file.replace(/\.md$/, '.html')),
        renderPage(src, title),
      );
      count++;
    }
    console.log(`Wrote ${count} pages to ${path.relative(ROOT, outDir)}`);
  }

  rmrf(TMP);
  console.log('\nDone!');
}

main();
