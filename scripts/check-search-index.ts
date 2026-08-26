#!/usr/bin/env node
// check-search-index.ts — guards /search-index.json and /search-text.json.
//
//   node scripts/check-search-index.ts
//
// The site's search is only as good as its coverage, and coverage fails silently:
// a page missing from the index is not an error anywhere, it is simply a page
// nobody can find. This repo has already paid for that failure mode once, in
// llms.txt, where a hand-maintained URL allowlist quietly dropped the home page,
// /using-ai-assistants/, /contact/ and /blog/ from the index the MCP server
// searches. The index is derived rather than curated now (see
// scripts/lib/search-corpus.ts), and this asserts the derivation covered
// everything.
//
// Assertions, in order of what they protect:
//
//   1. Every URL in the sitemap has a search record. This is the coverage
//      guarantee: anything a crawler is told to index, a reader can find.
//   2. Every record NOT in the sitemap is a `noindex: true` page. That difference
//      is deliberate — noindex is a directive to search ENGINES, and the two
//      /agents/ recipes it applies to are real pages linked from /agents/ that a
//      reader searching "delayed work" should still find — but it must stay a
//      known, enumerated difference rather than a drift nobody looks at.
//   3. Every record URL resolves to a page that was actually built.
//   4. Every deep link's #anchor exists as an id in that page's HTML. A result
//      that scrolls nowhere is worse than a result pointing at the page top.
//   5. No archived API major is indexed. Those trees are noindex and HTML-only by
//      policy, because an agent or a reader must never be handed a stale API
//      surface.
//   6. Both files stay inside their transfer budget.
//
// Exits non-zero on any failure; wired into `npm test`.

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { requireRanker } from './lib/ranker.ts';
import { FEED_V, ENGINE_V } from './lib/search-corpus.ts';


const ROOT = path.join(import.meta.dirname, '..');
// Which edition's output to check. Both are checked, in two invocations, because the com
// index is now published too — see the eleventy.after hook. Argument rather than a loop so
// a failure names the edition in the npm script that ran it.
const EDITION_DIR = process.argv[2] || '_site-org';
const OUT = path.join(ROOT, EDITION_DIR);

// Same numbers the generator enforces at build time. Duplicated deliberately: the
// generator's copy fails the BUILD, this one fails `npm test` against whatever is
// in _site-org, including a build somebody produced before changing the budget.
const BUDGET_GZ: Record<string, number> =
  { 'search-index.json': 120 * 1024, 'search-text.json': 320 * 1024 };

/** One tier-1 record, in the wire shape the ranker reads. See lib/search-corpus.ts. */
interface Record1 {
  g: number;
  t: string;
  u: string;
  s?: string;
  k?: string;
}

/** A tier-2 section tuple: [pageIndex, anchor, heading, text, emphasis]. */
type SectionTuple = [number, string, string, string, string];

/** A tier-2 page tuple: [url, title, group]. */
type PageTuple = [string, string, string];

/** A feed read off disk, kept as both text (for the size budget) and parsed json. */
interface Feed {
  text: string;
  json: {
    records?: Record1[];
    sections?: SectionTuple[];
    pages?: PageTuple[];
    lemmas?: Record<string, string>;
    v?: number;
    e?: number;
  };
}

let failures = 0;
const fail = (msg: string): void => { failures++; console.error(`  FAIL  ${msg}`); };
const pass = (msg: string): void => console.log(`  ok    ${msg}`);

function read(name: string): Feed {
  const file = path.join(OUT, name);

  if (!fs.existsSync(file)) {
    console.error(`  FAIL  ${name} was not built — run \`npm run build:org\` first`);
    process.exit(1);
  }

  return { text: fs.readFileSync(file, 'utf8'), json: JSON.parse(fs.readFileSync(file, 'utf8')) };
}

const tier1 = read('search-index.json');
const tier2 = read('search-text.json');
const records = tier1.json.records || [];
const sections = tier2.json.sections || [];
const pages = tier2.json.pages || [];

// ---- 1 + 2. coverage against the sitemap ---------------------------------
// The bucket files only. sitemap.xml is an INDEX whose <loc>s are the buckets
// themselves, and treating it as a page list reports /sitemap-blog.xml as a
// missing page.
const sitemapUrls = new Set<string>();

function collectLocs(file: string): void {
  for (const loc of fs.readFileSync(file, 'utf8').match(/<loc>[^<]+<\/loc>/g) || []) {
    const url = loc.slice(5, -6).replace(/^https?:\/\/[^/]+/, '');

    // A <loc> pointing at another sitemap is an INDEX entry, not a page. imqueue.org
    // splits into buckets and its sitemap.xml lists them; imqueue.com is seven pages and
    // has a single flat sitemap. Filtering on the extension covers both shapes without
    // the check needing to know which edition it is looking at.
    if (!url.endsWith('.xml')) {
      sitemapUrls.add(url);
    }
  }
}

const buckets = fs.readdirSync(OUT).filter((name) => /^sitemap-.+\.xml$/.test(name));

for (const name of buckets) {
  collectLocs(path.join(OUT, name));
}
if (!sitemapUrls.size && fs.existsSync(path.join(OUT, 'sitemap.xml'))) {
  collectLocs(path.join(OUT, 'sitemap.xml'));
}

if (!sitemapUrls.size) {
  fail(`no sitemap URLs found in ${EDITION_DIR} — cannot verify coverage`);
}

const docUrls = new Set(records.filter((r) => r.g === 0).map((r) => r.u));
const apiUrls = new Set(records.filter((r) => r.g === 1).map((r) => r.u));
const indexed = new Set([...docUrls, ...apiUrls]);

// The generated reference is indexed from /api/search-index.json, which covers
// every symbol of the current major — a superset of what the sitemap lists.
const missing = [...sitemapUrls].filter((u) => !indexed.has(u));

if (missing.length) {
  fail(`${missing.length} sitemap URL(s) have no search record, so they cannot be found on this site:\n        ${missing.slice(0, 12).join('\n        ')}`);
} else {
  pass(`all ${sitemapUrls.size} sitemap URLs are searchable`);
}

function isNoindex(url: string): boolean {
  const html = path.join(OUT, url.replace(/^\//, ''), 'index.html');

  return fs.existsSync(html) && /<meta\s+name="robots"\s+content="[^"]*noindex/i.test(fs.readFileSync(html, 'utf8'));
}

const unlisted = [...docUrls].filter((u) => !sitemapUrls.has(u));
const unexplained = unlisted.filter((u) => !isNoindex(u));

if (unexplained.length) {
  fail(`indexed page(s) absent from the sitemap and NOT marked noindex — one of the two is wrong:\n        ${unexplained.join('\n        ')}`);
} else {
  pass(`the ${unlisted.length} indexed page(s) outside the sitemap are all noindex, as intended`);
}

// ---- 3. every record points at a built page ------------------------------
const broken: string[] = [];

for (const record of records) {
  const target = path.join(OUT, (record.u.split('#')[0] ?? '').replace(/^\//, ''), 'index.html');

  if (!fs.existsSync(target)) {
    broken.push(record.u);
  }
}
for (const page of pages) {
  if (!fs.existsSync(path.join(OUT, page[0].replace(/^\//, ''), 'index.html'))) {
    broken.push(page[0]);
  }
}

if (broken.length) {
  fail(`${broken.length} record URL(s) do not resolve to a built page:\n        ${[...new Set(broken)].slice(0, 12).join('\n        ')}`);
} else {
  pass(`all ${records.length} records and ${pages.length} pages resolve to built HTML`);
}

// ---- 4. anchors exist ----------------------------------------------------
// Deep links are the whole point of indexing at section granularity, and the
// anchors are minted independently of markdown-it-anchor (from the same slugify —
// see scripts/lib/md-slug.ts — but on the mirror's text rather than the HTML's).
// A divergence between the two is exactly what this catches.
const idsByPage = new Map<string, Set<string>>();

function idsOf(url: string): Set<string> {
  const cached = idsByPage.get(url);

  if (cached) {
    return cached;
  }

  const html = path.join(OUT, url.replace(/^\//, ''), 'index.html');
  const ids = new Set<string>();

  if (fs.existsSync(html)) {
    for (const match of fs.readFileSync(html, 'utf8').matchAll(/\sid="([^"]+)"/g)) {
      ids.add(match[1] ?? '');
    }
  }
  idsByPage.set(url, ids);

  return ids;
}

const deepLinks = [
  ...records.filter((r) => r.u.includes('#')).map((r) => r.u),
  ...sections.filter((s) => s[1]).map((s) => `${pages[s[0]]?.[0]}#${s[1]}`),
];
const danglingAnchors = deepLinks.filter((link) => {
  const [url = '', anchor = ''] = link.split('#');

  return !idsOf(url).has(anchor);
});

if (danglingAnchors.length) {
  fail(`${danglingAnchors.length} of ${deepLinks.length} deep link(s) point at an anchor that is not in the page:\n        ${[...new Set(danglingAnchors)].slice(0, 12).join('\n        ')}`);
} else {
  pass(`all ${deepLinks.length} deep links land on a real heading id`);
}

// ---- 5. current major only ----------------------------------------------
const stale = [...apiUrls].filter((u) => !/^\/api\/[^/]+\/latest\//.test(u));

if (stale.length) {
  fail(`${stale.length} API record(s) are not from a /latest/ tree — archived majors must never be searchable:\n        ${stale.slice(0, 8).join('\n        ')}`);
} else {
  pass(`all ${apiUrls.size} API records are from the current major`);
}

// ---- shape ---------------------------------------------------------------
const malformed = records.filter((r) => !r.t || !r.u || typeof r.g !== 'number');

if (malformed.length) {
  fail(`${malformed.length} record(s) have no title, no url or no group`);
} else {
  pass('every record has a title, a url and a group');
}

const outOfRange = sections.filter((s) => !pages[s[0]] || !s[3]);

if (outOfRange.length) {
  fail(`${outOfRange.length} section(s) reference a missing page or carry no text`);
} else {
  pass(`all ${sections.length} sections resolve to a page and carry text`);
}

// ---- the lemma map ------------------------------------------------------
// Morphology is invisible when it silently stops working: every query keeps returning
// results, just fewer of them. This asserts the map is present and populated; which
// words map where is scripts/check-search-ranking.ts's job.
const lemmas = tier2.json.lemmas;

if (!lemmas || typeof lemmas !== "object") {
  fail("search-text.json has no lemma map — inflected queries will silently lose recall");
} else if (Object.keys(lemmas).length < Math.min(200, sections.length * 2)) {
  // Scaled to the corpus, not a flat number: imqueue.com is seven pages and 296 lemmas is
  // right for it, while the same 296 on imqueue.org would mean the map had mostly failed.
  fail(`the lemma map has only ${Object.keys(lemmas).length} entries for ${sections.length} sections — too few to be working`);
} else {
  pass(`the lemma map carries ${Object.keys(lemmas).length} inflected forms`);
}

// ---- 6. budget ----------------------------------------------------------
const FEEDS: ReadonlyArray<readonly [string, Feed]> =
  [['search-index.json', tier1], ['search-text.json', tier2]];

for (const [name, source] of FEEDS) {
  const gz = zlib.gzipSync(Buffer.from(source.text), { level: 9 }).length;
  const budget = BUDGET_GZ[name] ?? 0;

  if (gz > budget) {
    fail(`${name} is ${(gz / 1024).toFixed(1)} KB gzipped, over its ${(budget / 1024).toFixed(0)} KB budget`);
  } else {
    pass(`${name} is ${(gz / 1024).toFixed(1)} KB gzipped, within budget`);
  }
}

// ---- the peer index, when both editions were built -----------------------
// Cross-site search reads the OTHER edition from this origin (scripts/copy-peer-index.ts).
// Absent is legal — a single-edition build cannot produce it, and the client degrades to
// same-site search — but a peer file that is present and malformed would break silently.
for (const name of ['search-peer-index.json', 'search-peer-text.json']) {
  const file = path.join(OUT, name);

  if (!fs.existsSync(file)) {
    pass(`${name} absent — cross-site search inactive for this build (expected unless both editions were built)`);
    continue;
  }
  try {
    const peer = JSON.parse(fs.readFileSync(file, 'utf8'));
    const size = peer.records ? peer.records.length : (peer.sections || []).length;

    if (!size) {
      fail(`${name} parses but is empty`);
    } else {
      pass(`${name} carries ${size} peer entries`);
    }
  } catch (e) {
    fail(`${name} does not parse: ${e instanceof Error ? e.message : String(e)}`);
  }
}

// ---- the ranker and the feeds agree about the shape ----------------------------
// Two independent declarations, compared here on purpose. The ranker lives in its own repository
// and is pinned here as a submodule, while the feeds it reads are fetched LIVE — so a pinned
// ranker reads today's feeds. Move a tuple position without moving the version and every score
// is computed off the wrong field, with nothing to report: no exception, no empty result, just
// quietly wrong answers. Failing the build is the only place this is cheap to catch.
{
  const ranker = requireRanker();

  if (ranker.FEED_V !== FEED_V) {
    fail(`the ranker reads feed v${ranker.FEED_V} but the corpus writes v${FEED_V} `
      + '— bump both, or one of them is reading the wrong shape');
  } else {
    const feeds = ['search-index.json', 'search-text.json', 'search-sections.json'];
    const wrong = feeds.filter((name) => {
      const file = path.join(OUT, name);

      return fs.existsSync(file) && JSON.parse(fs.readFileSync(file, 'utf8')).v !== FEED_V;
    });

    if (wrong.length) {
      fail(`${wrong.join(', ')} carry a version other than v${FEED_V} as built`);
    } else {
      pass(`ranker and all ${feeds.length} feeds agree on feed v${FEED_V}`);
    }
  }

  // ---- and the feeds say WHICH ENGINE built them ------------------------------
  // FEED_V answers "can this ranker parse these feeds". It has been 1 through every
  // scoring change ever made, so it cannot answer the question that actually bites:
  // is the engine reading these feeds the engine that was measured against them.
  // @imqueue/mcp pins the same submodule, deploys on its own schedule, and fetches
  // these feeds live — so it can answer a query differently from this site's own
  // search box, silently, with FEED_V agreeing throughout. It compares `e` at
  // runtime; this asserts `e` is actually there and is this build's engine.
  //
  // Additive: an older ranker ignores the key, which is why it ships without a
  // FEED_V bump. See the note in scripts/lib/search-corpus.ts.

  const engineFeeds = ['search-index.json', 'search-text.json', 'search-sections.json'];
  const unstamped = engineFeeds.filter((name) => {
    const file = path.join(OUT, name);

    return fs.existsSync(file) && JSON.parse(fs.readFileSync(file, 'utf8')).e !== ENGINE_V;
  });

  if (typeof ENGINE_V !== 'number') {
    fail('the vendored ranker declares no ENGINE_V — the pin predates it, or the export was dropped');
  } else if (unstamped.length) {
    fail(`${unstamped.join(', ')} do not carry e:${ENGINE_V} — @imqueue/mcp cannot tell whether `
      + 'its pinned engine matches the one that built these feeds');
  } else {
    pass(`all ${engineFeeds.length} feeds are stamped with engine v${ENGINE_V}`);
  }
}

// ---- the section range map addresses the mirrors correctly ---------------------
// A range is line numbers into <page>/index.md, which is the most brittle way to reference
// text there is: the numbers are right or they silently hand back the wrong section. Nothing
// downstream can detect that, so it is asserted here, against the real files, every build.
{
  const rangesFile = path.join(OUT, 'search-sections.json');

  if (!fs.existsSync(rangesFile)) {
    fail('search-sections.json was not written');
  } else {
    // url -> anchor -> [startLine, endLine) into that page's markdown mirror.
    const map = JSON.parse(fs.readFileSync(rangesFile, 'utf8')).pages as
      Record<string, Record<string, [number, number]>>;
    let checked = 0;
    let noMirror = 0;
    let notHeading = 0;
    let unbalanced = 0;
    let empty = 0;

    for (const [url, anchors] of Object.entries(map)) {
      const mirror = path.join(OUT, url, 'index.md');

      if (!fs.existsSync(mirror)) {
        noMirror++;
        continue;
      }

      const lines = fs.readFileSync(mirror, 'utf8').split('\n');

      for (const [anchor, range] of Object.entries(anchors)) {
        const [start, end] = range;

        checked++;

        // The first line of a slice must be the heading the anchor names, or the range is
        // off by however many lines the mirror's header block happens to occupy.
        if (!/^#{2,3}\s+/.test(lines[start] ?? '')) {
          notHeading++;
          continue;
        }

        if (end <= start) {
          empty++;
          continue;
        }

        // An odd number of fence markers means the slice opens a code block it never closes,
        // which is what a regex-based slicer would eventually produce. Ranges from the parsed
        // walk should never be able to.
        const slice = lines.slice(start, end).join('\n');

        if ((slice.match(/^\s{0,3}(?:```+|~~~+)/gm) || []).length % 2 !== 0) {
          unbalanced++;
        }
      }
    }

    for (const [n, what] of [
      [noMirror, 'page(s) in the range map have no markdown mirror'],
      [notHeading, 'range(s) do not start on the heading their anchor names'],
      [empty, 'range(s) are empty or inverted'],
      [unbalanced, 'range(s) slice an unbalanced code fence'],
    ]) {
      if (n) fail(`${n} ${what}`);
    }

    if (!noMirror && !notHeading && !empty && !unbalanced) {
      pass(`${checked} section range(s) start on their own heading and close every fence`);
    }

    // Every anchor the search index links to should be sliceable, or get_doc has to fall back
    // to the whole page for a section the index just pointed at.
    const missing = sections.filter((s) => {
      const url = pages[s[0]]?.[0] ?? '';

      return s[1] && map[url] && !map[url][s[1]];
    });

    if (missing.length) {
      const first = missing[0];

      fail(`${missing.length} indexed anchor(s) have no range, e.g. ${pages[first?.[0] ?? 0]?.[0]}#${first?.[1]}`);
    } else {
      pass('every indexed anchor resolves to a range');
    }
  }
}

const counts = { docs: docUrls.size, api: apiUrls.size, answers: records.filter((r) => r.g === 2).length };

console.log(`        ${EDITION_DIR}: ${counts.docs} pages, ${counts.api} symbols, ${counts.answers} answers, ${sections.length} sections`);

if (failures) {
  console.error(`\n${failures} search index check(s) failed.`);
  process.exit(1);
}
console.log(`\nAll search index checks passed for ${EDITION_DIR}.`);
