// Embed the already-generated (committed) latest-version API docs into the site:
// extract each page's <main class="apidoc"> content, rewrite intra-doc links to
// clean site URLs, wrap it for the apiref.html layout, and emit into
// src/org/api/<pkg>/<version>/. Builds the symbol sidebar from the package page.
//
// Use this when the standalone HTML already exists but the sibling source repos
// aren't at the documented version (can't run the full api-docs.js regeneration).
// Run: node scripts/embed-api-docs.js
const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const LATEST = { core: '3.2.1', rpc: '3.2.1' };
const GROUPS = [
  'Classes', 'Abstract Classes', 'Enumerations', 'Functions',
  'Interfaces', 'Variables', 'Type Aliases', 'Namespaces',
];

function rmrf(p) { fs.rmSync(p, { recursive: true, force: true }); }

for (const [pkg, version] of Object.entries(LATEST)) {
  const srcDir = path.join(ROOT, 'api', pkg, version);
  if (!fs.existsSync(srcDir)) { console.warn(`skip ${pkg}: ${srcDir} missing`); continue; }
  const outDir = path.join(ROOT, 'src', 'org', 'api', pkg, version);
  rmrf(outDir);
  fs.mkdirSync(outDir, { recursive: true });

  const urlFor = (base) => (base === 'index' || base === pkg)
    ? `/api/${pkg}/${version}/`
    : `/api/${pkg}/${version}/${base}/`;
  const rewriteLinks = (html) => html.replace(
    /href="(?:\.\/)?([A-Za-z0-9._-]+)\.html(#[^"]*)?"/g,
    (_m, base, anchor) => `href="${urlFor(base)}${anchor || ''}"`,
  );
  // The api-documenter "Home" crumb links back to the package page; point it at
  // the curated API reference landing (/api/) instead of duplicating the package crumb.
  const fixHome = (html) => html.replace(/href="[^"]*">Home<\/a>/g, 'href="/api/">Home</a>');
  const mainOf = (html) => {
    const m = html.match(/<main class="apidoc">([\s\S]*?)<\/main>/);
    return m ? m[1].trim() : null;
  };
  const titleOf = (html, fallback) => {
    const m = html.match(/<title>([\s\S]*?)<\/title>/);
    return (m ? m[1] : fallback).replace(/\s+/g, ' ').trim();
  };

  // sidebar from the package page (<pkg>.html)
  const pkgHtml = fs.readFileSync(path.join(srcDir, `${pkg}.html`), 'utf8');
  const apiNav = [];
  const sections = pkgHtml.split(/<h2>/).slice(1);
  for (const sec of sections) {
    const gm = sec.match(/^([^<]+)<\/h2>/);
    if (!gm || !GROUPS.includes(gm[1].trim())) continue;
    const items = [];
    const re = /<a href="(?:\.\/)?([A-Za-z0-9._-]+)\.html">([^<]+)<\/a>/g;
    let m;
    while ((m = re.exec(sec))) items.push({ name: m[2], url: urlFor(m[1]) });
    if (items.length) apiNav.push({ group: gm[1].trim(), items });
  }
  if (!apiNav.length) throw new Error(`No sidebar symbols parsed for ${pkg}`);

  let count = 0;
  for (const file of fs.readdirSync(srcDir)) {
    if (!file.endsWith('.html')) continue;
    const html = fs.readFileSync(path.join(srcDir, file), 'utf8');
    const body = mainOf(html);
    if (body == null) { console.warn(`no <main> in ${file}, skipping`); continue; }
    const title = titleOf(html, file.replace(/\.html$/, ''));
    const out = `---\ntitle: ${JSON.stringify(title)}\n---\n{% raw %}\n${fixHome(rewriteLinks(body))}\n{% endraw %}\n`;
    fs.writeFileSync(path.join(outDir, file), out);
    count++;
  }

  // index page from the package page
  const idxBody = mainOf(pkgHtml);
  fs.writeFileSync(
    path.join(outDir, 'index.html'),
    `---\ntitle: ${JSON.stringify(`@imqueue/${pkg} ${version} · API reference`)}\n---\n{% raw %}\n${fixHome(rewriteLinks(idxBody))}\n{% endraw %}\n`,
  );

  fs.writeFileSync(
    path.join(outDir, `${version}.11tydata.json`),
    JSON.stringify({ layout: 'apiref.html', section: 'api', apiPkg: pkg, apiVersion: version, apiNav }, null, 2),
  );

  // retire the standalone latest build (older versions stay under api/)
  rmrf(srcDir);

  console.log(`${pkg}@${version}: embedded ${count} pages + index (${apiNav.reduce((n, g) => n + g.items.length, 0)} sidebar symbols) -> ${path.relative(ROOT, outDir)}`);
}

console.log('Done.');
