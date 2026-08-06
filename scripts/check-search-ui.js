#!/usr/bin/env node
// check-search-ui.js — asserts that search can actually be reached.
//
//   node scripts/check-search-ui.js
//
// check-search-ranking.js proves the ranker returns the right page. It cannot prove a
// reader is able to ask it anything, and that is a separate way for search to break:
// 179 passing checks shipped a site where a phone had no entry point at all. The nav
// trigger is hidden below 900px (correct — the bar has no room), the drawer carries its
// own copy for that reason, and `.mobile-nav .nav-search` restyled it without ever
// re-declaring `display`. The row rendered 0x0. No header icon, no drawer row, and `/`
// needs a keyboard, so the only way in was typing /search/ by hand.
//
// So each case below names the entry point it protects and the failure it observed.
// Markup is read from the BUILT pages, in both editions, because an include that is
// correct but not rendered protects nobody. The CSS and JS rules are read from source,
// where the invariant lives — the built assets are content-hashed and stale copies of
// previous builds sit alongside current ones.
//
// Exits non-zero on any failure; wired into `npm test`.

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

let failures = 0;
const fail = (msg) => { failures++; console.error(`  FAIL  ${msg}`); };
const pass = (msg) => console.log(`  ok    ${msg}`);

const read = (file) => fs.readFileSync(file, 'utf8');

// ---- markup: both entry points ship, on real pages, in both editions --------
// Source order is header trigger, then the drawer container, then the drawer's own
// trigger — so a `data-search-open` on each side of `data-mobile-nav` is the whole
// assertion, and it needs no HTML parser to make.
const PAGES = [
  ['org', '_site-org/index.html'],
  ['org', '_site-org/docs/index.html'],
  ['com', '_site-com/index.html'],
  ['com', '_site-com/pricing/index.html'],
];

for (const [edition, rel] of PAGES) {
  const file = path.join(ROOT, rel);

  if (!fs.existsSync(file)) {
    fail(`${rel} was not built — run \`npm run build:all\` first`);
    continue;
  }

  const html = read(file);
  const drawer = html.indexOf('data-mobile-nav');

  if (drawer === -1) {
    fail(`${rel}: no [data-mobile-nav] drawer`);
    continue;
  }

  const triggers = [];
  let at = html.indexOf('data-search-open');

  while (at !== -1) {
    triggers.push(at);
    at = html.indexOf('data-search-open', at + 1);
  }

  const inHeader = triggers.filter((i) => i < drawer).length;
  const inDrawer = triggers.filter((i) => i > drawer).length;

  if (!inHeader) fail(`${rel}: the header has no search trigger`);
  if (!inDrawer) {
    fail(
      `${rel}: the mobile drawer has no search trigger — below 900px the header one is ` +
      'hidden, so this is the only way into search on a phone'
    );
  }
  if (inHeader && inDrawer) pass(`${edition}: ${rel} offers search in the header and in the drawer`);

  // The burger toggles the drawer, so it has to say whether the drawer is open. Shipped
  // hard-coded to "false" on org and missing entirely on com.
  const burger = /<button[^>]*\bdata-nav-toggle\b[^>]*>/.exec(html);

  if (!burger) fail(`${rel}: no [data-nav-toggle] burger`);
  else if (!/\baria-expanded=/.test(burger[0])) {
    fail(`${rel}: the burger has no aria-expanded, so the drawer's state is not announced`);
  } else pass(`${edition}: ${rel} burger carries aria-expanded`);
}

// ---- css: the drawer trigger survives the rule that hides the header one ----
const cssFile = path.join(ROOT, 'src', '_shared', 'css', 'search.css');
const css = read(cssFile);

// Pull out the @media block that hides .nav-search, by matching braces from its `{`.
function mediaBlockHiding() {
  const re = /@media[^{]*\(max-width:[^{]*\{/g;
  let m;

  while ((m = re.exec(css))) {
    let depth = 1;
    let i = m.index + m[0].length;

    while (i < css.length && depth > 0) {
      if (css[i] === '{') depth++;
      else if (css[i] === '}') depth--;
      i++;
    }

    const body = css.slice(m.index + m[0].length, i - 1);

    if (/(^|[^.\w-])\.nav-search\s*\{[^}]*display\s*:\s*none/.test(body)) {
      return { condition: m[0].replace(/\s*\{$/, ''), body };
    }
  }

  return null;
}

const block = mediaBlockHiding();

if (!block) {
  fail('css/search.css: no @media rule hides .nav-search — has the breakpoint moved?');
} else {
  const restore = /\.mobile-nav\s+\.nav-search\s*\{[^}]*display\s*:\s*([\w-]+)/.exec(block.body);

  if (!restore) {
    fail(
      `css/search.css: ${block.condition} hides .nav-search but never re-declares display ` +
      'for `.mobile-nav .nav-search` — that is exactly the bug that made the drawer row 0x0'
    );
  } else if (restore[1] === 'none') {
    fail(`css/search.css: ${block.condition} sets the drawer trigger to display:none`);
  } else {
    pass(`css: ${block.condition} hides the header trigger and keeps the drawer one (${restore[1]})`);
  }
}

// ---- js: the drawer closes when it should, and says so ----------------------
const jsFile = path.join(ROOT, 'src', '_shared', 'js', 'site.js');
const js = read(jsFile);

const JS_CASES = [
  [
    /aria-expanded['"]\s*,\s*String\(/,
    'site.js writes aria-expanded when the drawer moves',
    'site.js never sets aria-expanded — the burger shipped stuck at "false" while the drawer opened',
  ],
  [
    /\[data-mobile-nav\][^'"]*\[data-search-open\]/,
    'site.js closes the drawer when its search trigger is tapped',
    'site.js only closes the drawer on `a` taps, so opening search left the drawer sitting ' +
    'open behind the dialog and still open after it was dismissed',
  ],
  // Deliberately not "a resize listener exists": site.js has another one for the TOC, so
  // that version of this check passed even with the drawer's handler deleted outright.
  // The listener has to be the one that closes the drawer.
  [
    /addEventListener\(\s*['"]resize['"][\s\S]{0,400}?setDrawer\(\s*false\s*\)/,
    'site.js closes the drawer on resize, so it is not stranded past the breakpoint',
    'no resize handler closes the drawer — it kept its `open` class when the viewport ' +
    'widened, staying expanded over the desktop nav with no burger left to close it',
  ],
];

for (const [re, ok, why] of JS_CASES) {
  if (re.test(js)) pass(`js: ${ok}`);
  else fail(`js/site.js: ${why}`);
}

// ---- what search reports ----------------------------------------------------
// The measurement is the only route to improving relevance with real readers instead of
// hand-written ground truth (scripts/search-kpi/), so it is worth a few cases of its own.
// Read as TEXT, not required: these cases assert on source strings, which is the only way to
// check a constant that never leaves the IIFE. From the submodule — see scripts/lib/ranker.js,
// and check its presence first so a plain clone gets the instruction rather than an ENOENT.
//
// The UI half specifically. Every case below is about what the site REPORTS — the settle window,
// the click watchers, the flush on close — and all of it lives in search.js; ranker.js is the
// engine and has no analytics in it at all. Point this at the engine and all six cases fail with
// "nothing reports which result was chosen", which reads as a regression rather than as a check
// looking in the wrong file.
const rankerLib = require('./lib/ranker.js');

if (!rankerLib.exists()) {
  console.error(rankerLib.MISSING);
  process.exit(1);
}

const searchJs = read(rankerLib.UI_FILE);

// A settle window is the difference between "queries people asked" and a report full of
// their own prefixes. Asserted as a NUMBER, not a mention: `var SETTLE = 0` would satisfy
// any regex looking for the name while restoring exactly the behaviour it guards against.
const settle = /var SETTLE = (\d+)/.exec(searchJs);

if (!settle) {
  fail('js/search.js: no SETTLE window — the dialog searches on every keystroke, so the ' +
    'report fills with "ide", "idem", "idemp" instead of what anybody typed');
} else if (Number(settle[1]) < 500) {
  fail(`js/search.js: SETTLE is ${settle[1]}ms, short enough that ordinary typing pauses ` +
    'still report prefixes');
} else {
  pass(`search: reporting waits ${settle[1]}ms for the query to settle`);
}

const SEARCH_CASES = [
  [
    /queueReport\(q, hits\.length/,
    'the dialog reports through the settle path',
    'the dialog calls report() directly again, which sends one event per render — a ' +
    'query typed at normal speed arrives as a dozen prefixes of itself',
  ],
  [
    /"search_select"[\s\S]{0,300}?position:/,
    'a taken result is reported with its position',
    'nothing reports WHICH result was chosen, so the data says what was asked and ' +
    'never whether the ranking was right — the one signal worth collecting',
  ],
  [
    /watchClicks\(el\.results\)/,
    'dialog results are watched for clicks',
    'clicks in the dialog are not reported',
  ],
  [
    /watchClicks\(pageEl\(pageHost, "results"\)\)/,
    '/search/ results are watched for clicks',
    'clicks on the /search/ page are not reported — that is where shared links land',
  ],
  [
    /addEventListener\("close"[\s\S]{0,400}?flushReport\(\)/,
    'closing the dialog flushes an abandoned query',
    'a query typed and abandoned without a click is never reported, which is exactly ' +
    'the outcome that means search failed',
  ],
];

for (const [re, ok, why] of SEARCH_CASES) {
  if (re.test(searchJs)) pass(`search: ${ok}`);
  else fail(`js/search.js: ${why}`);
}

// ---- the blog's scoped box runs THIS ranker ---------------------------------
// It used to be a third search implementation: an inline script matching
// `haystack.indexOf(query)` over title + summary + topics from /blog/search-index.json.
// That is a phrase test, so "redis queue" found nothing — no title or summary has those
// two words adjacent — and post bodies were not in that feed, so "idempotency" and
// "retries" found nothing either. 7 of 14 ordinary queries returned nothing.
const blogPage = path.join(ROOT, '_site-org', 'blog', 'index.html');

if (!fs.existsSync(blogPage)) {
  fail('_site-org/blog/index.html was not built — run `npm run build:org` first');
} else {
  const blogHtml = read(blogPage);

  if (!/data-search-scope="Article"/.test(blogHtml)) {
    fail(
      '_site-org/blog/index.html: the sidebar box has no [data-search-scope="Article"], so ' +
      'js/search.js never binds it and "Search posts" is an inert input'
    );
  } else pass('blog: the sidebar box is bound to the shared ranker, scoped to Article');

  // The old implementation, by its own fingerprints. Either would mean it came back.
  if (/blog-search-(?:input|results|note)/.test(blogHtml) || /\.indexOf\(q\)/.test(blogHtml)) {
    fail(
      '_site-org/blog/index.html: the inline naive matcher is back — that is a second ' +
      'ranker on the same site, and it is a phrase test that cannot answer "redis queue"'
    );
  } else pass('blog: no inline matcher — one ranker, one place a fix lands');

  if (!/data-search-dates="\/blog\/search-index\.json"/.test(blogHtml)) {
    fail('_site-org/blog/index.html: no [data-search-dates], so whole-post hits lose their date');
  } else pass('blog: post dates still come from the published feed');
}

const SCOPE_CASES = [
  // Both tiers. Tier 1 alone is titles, summaries and keywords — i.e. very nearly the
  // behaviour this replaced, and the reason "idempotency" returned nothing.
  [
    /Promise\.all\(\[loadTier1\(\), loadTier2\(\)\]\)\.then\(draw\)/,
    'a scoped box loads both tiers, so post bodies are searched',
    'the scoped box no longer loads tier 2 — body text is unsearchable again, which is ' +
    'exactly the defect that made "idempotency" and "retries" return nothing',
  ],
  // Scope by filtering RESULTS. Indexing a subset would compute df over 29 pages instead
  // of 86, so every idf would differ and the ranking would leave what the KPI measures.
  [
    /!hit\.external && urls\[hit\.record\.u\.split\("#"\)\[0\]\]/,
    'scoping filters results by page kind, and excludes the peer edition',
    'the scope filter changed shape — if it stops excluding hit.external, imqueue.com ' +
    'pages appear under "Search posts"; if it stops keying on the page URL, answer ' +
    'records leak in, because their record.k is the parent TITLE and not a kind',
  ],
  [
    /if \(el\.status\) \{/,
    'a failed index fetch cannot throw from inside its own catch',
    'load()\'s catch writes el.status unguarded again. `el` is only populated by build(), ' +
    'and both /search/ and the scoped box load indexes before any dialog exists — so a ' +
    'network error became an unhandled TypeError and swallowed the warning',
  ],
];

for (const [re, ok, why] of SCOPE_CASES) {
  if (re.test(searchJs)) pass(`scope: ${ok}`);
  else fail(`js/search.js: ${why}`);
}

console.log(
  failures
    ? `\n${failures} search-UI check(s) failed.`
    : '\nAll search-UI checks passed.'
);

if (failures) process.exit(1);
