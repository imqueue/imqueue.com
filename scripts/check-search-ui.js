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

console.log(
  failures
    ? `\n${failures} search-UI check(s) failed.`
    : '\nAll search-UI checks passed.'
);

if (failures) process.exit(1);
