#!/usr/bin/env node
// check-sitemap.js — guards the sitemap against the ways it has silently broken.
//
//   node scripts/check-sitemap.js
//
// .org publishes a sitemap index with three children (pages / blog / api). That
// split exists so GSC coverage can be read per bucket, which makes the sitemap a
// measurement instrument — and a measurement instrument that quietly drifts is
// worse than none. The failures this catches, all of which have happened here or
// were one edit away:
//
//   * a URL listed in two children (double-submitted, and the bucket counts lie)
//   * a URL with no built file (a 404 advertised to Google)
//   * a noindex page in the sitemap (contradictory signals — this shipped once)
//   * an empty child sitemap (GSC reports it as an error)
//   * an indexable page missing from the sitemap entirely
//
// Exits non-zero on any failure; wired into `npm test`.

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const EDITIONS = { org: 'https://imqueue.org', com: 'https://imqueue.com' };

let failures = 0;
const fail = (msg) => { failures++; console.error(`  FAIL  ${msg}`); };
const pass = (msg) => console.log(`  ok    ${msg}`);

const locsIn = (xml) => [...xml.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/g)].map((m) => m[1]);

// Mirrors the `sitemap: false` rule in scripts/build-api-docs.js: a per-symbol
// MEMBER page (two dots — core.ilogger.info) stays indexable but is not submitted.
// Restated here on purpose — if the two ever disagree, this check is what says so.
function isApiMemberPage(url) {
  const seg = url.replace(/\/$/, '').split('/').pop();

  return url.includes('/api/') && seg.split('.').length > 2;
}

// Every built page, with whether it is indexable, keyed by site-absolute URL.
function builtPages(dir) {
  const pages = new Map();

  (function walk(d) {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, entry.name);

      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (entry.name !== 'index.html') continue;

      const rel = path.relative(dir, path.dirname(full)).split(path.sep).join('/');
      const url = rel === '' ? '/' : `/${rel}/`;
      const html = fs.readFileSync(full, 'utf8');

      pages.set(url, { noindex: /<meta name="robots" content="noindex/.test(html) });
    }
  }(dir));

  return pages;
}

for (const [edition, origin] of Object.entries(EDITIONS)) {
  const dir = path.join(ROOT, `_site-${edition}`);
  const indexFile = path.join(dir, 'sitemap.xml');

  console.log(`\n${edition}:`);

  if (!fs.existsSync(indexFile)) {
    fail(`_site-${edition}/sitemap.xml is missing — build the ${edition} edition first`);
    continue;
  }

  const rootXml = fs.readFileSync(indexFile, 'utf8');
  const isIndex = rootXml.includes('<sitemapindex');
  // bucket name -> URLs. A flat sitemap is modelled as a single unnamed bucket so
  // the assertions below do not need to care which shape the edition uses.
  const buckets = new Map();

  if (isIndex) {
    for (const child of locsIn(rootXml)) {
      const name = path.basename(new URL(child).pathname);
      const childFile = path.join(dir, name);

      if (!child.startsWith(origin)) {
        fail(`sitemap index references a foreign origin: ${child}`);
        continue;
      }
      if (!fs.existsSync(childFile)) {
        fail(`sitemap index references ${name}, which was not built`);
        continue;
      }

      const urls = locsIn(fs.readFileSync(childFile, 'utf8'));

      if (!urls.length) {
        fail(`${name} is empty — GSC reports empty sitemaps as an error`);
      }
      buckets.set(name, urls);
    }
    pass(`sitemap index lists ${buckets.size} child sitemap(s), all built and non-empty`);
  } else {
    buckets.set('sitemap.xml', locsIn(rootXml));
    pass('flat sitemap (no index)');
  }

  const all = [...buckets.values()].flat();
  const seen = new Map();

  for (const [name, urls] of buckets) {
    for (const u of urls) {
      if (seen.has(u)) {
        fail(`${u} appears in both ${seen.get(u)} and ${name}`);
      }
      seen.set(u, name);
    }
  }
  if (!failures) pass(`${all.length} URLs, no duplicates across buckets`);

  const pages = builtPages(dir);
  let missing = 0;
  let noindexed = 0;
  let malformed = 0;

  for (const u of all) {
    if (!u.startsWith(origin)) {
      fail(`${u} is not on ${origin}`);
      continue;
    }

    const rel = u.slice(origin.length);

    if (!rel.endsWith('/') && !rel.endsWith('.html')) {
      fail(`${u} is neither trailing-slashed nor an .html file`);
      malformed++;
    }

    const page = pages.get(rel);

    if (!page) {
      fail(`${u} is in the sitemap but no file was built for it`);
      missing++;
    } else if (page.noindex) {
      fail(`${u} is noindex but advertised in the sitemap`);
      noindexed++;
    }
  }
  if (!missing && !noindexed && !malformed) {
    pass('every listed URL is built, indexable and canonically shaped');
  }

  // The other direction: an indexable page that nothing submits.
  const listed = new Set(all.map((u) => u.slice(origin.length)));
  const unlisted = [...pages.entries()]
    .filter(([url, p]) => !p.noindex && !listed.has(url) && !isApiMemberPage(url))
    // Pagination pages are deliberately unsubmitted; /blog/ is the entry point.
    .filter(([url]) => !/\/page\/\d+\/$/.test(url))
    .map(([url]) => url);

  if (unlisted.length) {
    for (const u of unlisted.slice(0, 10)) {
      fail(`${u} is indexable but in no sitemap`);
    }
    if (unlisted.length > 10) {
      console.error(`  FAIL  …and ${unlisted.length - 10} more indexable pages in no sitemap`);
    }
  } else {
    pass('every indexable page is submitted (API member pages excluded by design)');
  }

  // Markdown-mirror coverage. src/org/agents/index.md promises agents that "every
  // page has a plain-markdown mirror at `<page-url>index.md`", using-ai-assistants.md
  // repeats it for "any docs page", and the MCP server's `get_doc` fetches exactly
  // that URL for whatever page it is handed.
  //
  // Until 2026-08-01 the site broke that on 19 pages — the home page, /docs/,
  // /intro/, /blog/, 12 topic hubs and 3 author pages — because src/md-mirror.liquid
  // only mirrors pages with a MARKDOWN source (`contentMd` requires
  // inputPath.endsWith('.md')) and those are HTML/Liquid templates. Nothing failed;
  // agents following the documented convention just got 404s on the entry-point
  // pages they try first, and `get_doc` could not return the docs home at all.
  // src/org/mirrors/ closes it, and this assertion stops the next HTML-templated
  // page reopening it.
  //
  // Only .org makes the promise — imqueue.com's llms.txt does not mention mirrors,
  // and its four pages have none.
  if (edition === 'org') {
    const unmirrored = [...pages.entries()]
      .filter(([, p]) => !p.noindex)
      // Archived API majors are noindex (already filtered) and deliberately
      // unmirrored; /latest/ trees, including member pages, are mirrored. Keep
      // this in step with API_MIRRORED in eleventy.config.js.
      .filter(([url]) => !url.startsWith('/api/') || /^\/api\/$|^\/api\/[^/]+\/latest\//.test(url))
      // Paginated /blog/page/N/ has no mirror on purpose: /blog/index.md lists
      // every article, which is what an agent wants — one fetch, whole index.
      .filter(([url]) => !/\/page\/\d+\/$/.test(url))
      .map(([url]) => url)
      .filter((url) => !fs.existsSync(path.join(dir, url.slice(1), 'index.md')));

    if (unmirrored.length) {
      for (const u of unmirrored.slice(0, 10)) {
        fail(`${u} has no ${u}index.md — /agents/ promises one for every page`);
      }
      if (unmirrored.length > 10) {
        console.error(`  FAIL  …and ${unmirrored.length - 10} more pages with no markdown mirror`);
      }
      console.error('        Add a template under src/org/mirrors/ — see its README.txt.');
    } else {
      pass('every indexable page has the markdown mirror agents are promised');
    }
  }

  for (const [name, urls] of buckets) {
    console.log(`        ${name}: ${urls.length} URLs`);
  }
}

if (failures) {
  console.error(`\n${failures} sitemap check(s) failed.`);
  process.exit(1);
}
console.log('\nAll sitemap checks passed.');
