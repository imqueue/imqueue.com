#!/usr/bin/env node
// check-email-literals.js — no email-shaped literal in content the edge rewrites.
//
//   node scripts/check-email-literals.js
//
// Cloudflare Email Obfuscation runs on every HTML response from both zones and
// rewrites anything that looks like an address into
//
//   <a href="/cdn-cgi/l/email-protection" class="__cf_email__"
//      data-cfemail="...">[email&#160;protected]</a>
//
// plus a script that swaps the real text back in. It does not care where in the
// document the address is, and it does not skip <pre> or <code>. Nothing about
// this reproduces locally: `npm run build` and `eleventy --serve` emit the file
// intact, and the rewrite only exists on the deployed response — so the ONLY way
// this gets caught before a reader sees it is here.
//
// Two severities, because the damage is not the same:
//
//   1. INSIDE AN INLINE SVG this is a hard visual break, not a cosmetic one. An
//      <a> element injected into <text> content is not positioned SVG text: the
//      anchor reflows, and every element after it in the group is displaced.
//      src/_shared/_includes/blog-art/runtime-validation.svg shipped with
//      `"ada@ex.com"` in a label on 2026-08-25 and took the whole hero
//      illustration apart on production while rendering perfectly on localhost.
//
//   2. IN PAGE PROSE OR A CODE SAMPLE it is "only" wrong content — a sample that
//      reads `.push('[email protected]')` teaches the reader nothing and looks
//      broken. imqueue-vs-bullmq.md had shipped two of these unnoticed.
//
// Only the first FAILS the build. The second reports and does not, for one
// reason: as of 2026-08-25 the site already ships 23 of them, and some cannot be
// fixed in content at all — `git@github.com:imqueue-sandbox/api.git` in the
// tutorial's clone commands is a real SSH URL, publishing as
// `[email protected]:imqueue-sandbox/api.git`, and there is no way to write
// that URL without the address. Those need an edge-side decision (scope or
// disable Email Obfuscation for the docs paths), not a rewrite. Failing the
// build on them today would only mean turning this check off.
//
// So: the catastrophic class is gated, the cosmetic class is counted and stays
// visible until the edge decision is made. The one address that SHOULD survive
// is support@imqueue.com in the Organization JSON-LD, which the edge cannot
// reach — see scripts/check-jsonld.js.
//
// Exits non-zero on an SVG hit; wired into `npm test`.

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'src');

// Deliberately looser than a correct address grammar. This has to match what
// Cloudflare matches, and over-matching here costs an author one rewrite while
// under-matching costs a broken page nobody sees until it is live.
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+/g;

// Package scopes are not addresses. `@imqueue/rpc` cannot match EMAIL (there is
// no dot-separated tail after a bare word before the @), but a scoped name in
// running prose like `foo@imqueue.com/rpc` could, so strip scopes first.
const SCOPE = /@imqueue\/[a-z-]+/g;

// The site's own contact address is allowed to appear: the edge rewrites it in
// HTML and that is understood and worked around, not a defect.
const ALLOWED = new Set(['support@imqueue.com']);

let failures = 0;
const fail = (msg) => { failures++; console.error(`  FAIL  ${msg}`); };

function walk(dir, exts, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, exts, out);
    else if (exts.some((e) => entry.name.endsWith(e))) out.push(full);
  }
  return out;
}

function hits(file) {
  const found = [];
  const lines = fs.readFileSync(file, 'utf8').split('\n');

  lines.forEach((line, i) => {
    for (const m of line.replace(SCOPE, '').matchAll(EMAIL)) {
      if (!ALLOWED.has(m[0])) found.push({ line: i + 1, text: m[0] });
    }
  });

  return found;
}

// 1. Inline SVGs. These are included into the page verbatim, so the rewrite
//    lands inside the SVG DOM.
const svgs = walk(SRC, ['.svg']);
let svgHits = 0;

for (const file of svgs) {
  for (const h of hits(file)) {
    svgHits++;
    fail(`${path.relative(ROOT, file)}:${h.line} inline SVG carries "${h.text}" — `
      + 'the edge will inject an <a> into it and displace the whole drawing');
  }
}
if (!svgHits) console.log(`  ok    ${svgs.length} inline SVG(s) carry no email-shaped literal`);

// 2. Authored page content. The generated API reference is excluded: it mirrors
//    package JSDoc, is not hand-edited here, and its one address is the allowed
//    contact line in every file header.
const pages = walk(SRC, ['.md', '.html'])
  .filter((f) => !path.relative(ROOT, f).split(path.sep).includes('api'));
const pageHits = [];

for (const file of pages) {
  for (const h of hits(file)) {
    pageHits.push(`${path.relative(ROOT, file)}:${h.line}  ${h.text}`);
  }
}

if (!pageHits.length) {
  console.log(`  ok    ${pages.length} authored page(s) carry no email-shaped literal`);
} else {
  console.log(`  note  ${pageHits.length} authored page(s) publish an address as `
    + '"[email protected]" — pending the edge decision, not gating:');
  for (const line of pageHits) console.log(`          ${line}`);
}

if (failures) {
  console.error(`\n${failures} email-literal check(s) failed. `
    + 'Use an id or a placeholder; a literal address does not survive the edge.');
  process.exit(1);
}
console.log('\nAll email-literal checks passed.');
