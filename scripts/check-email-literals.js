#!/usr/bin/env node
// check-email-literals.js — no email-shaped literal inside an inline SVG.
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
// The setting was DISABLED on both zones on 2026-08-25, so none of this is
// currently happening. This check remains for one reason: it is a per-zone
// dashboard toggle, a new zone starts with it ON, and the failure it causes in an
// inline SVG is both silent and catastrophic.
//
// Silent, because nothing about it reproduces locally — `npm run build` and
// `eleventy --serve` emit the file intact and only the deployed response differs,
// so a green `npm test` and a browser check on localhost are both clean.
// Catastrophic, because an <a> injected into <text> content is not positioned SVG
// text: the anchor reflows and displaces every element after it in the group.
// src/_shared/_includes/blog-art/runtime-validation.svg shipped with
// `"ada@ex.com"` in a label and took the whole hero illustration apart on
// production while rendering perfectly on a dev server.
//
// So this gates the one case that cannot be caught any other way: an email-shaped
// literal in an inline SVG. Prose and code samples are NOT gated — they degrade to
// "[email protected]", which is ugly rather than broken, and some of them cannot
// be written any other way (`git@github.com:imqueue-sandbox/api.git` in the
// tutorial's clone commands is a real SSH URL). The live half — whether the toggle
// is actually off — is scripts/check-geo-live.js, which this cannot see.
//
// The fix here is always the same one line: do not put a literal address in a
// drawing. Use a placeholder or a non-address string. The one address that SHOULD
// survive is support@imqueue.com in the Organization JSON-LD, which the edge
// cannot reach — see scripts/check-jsonld.js.
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
// no dot-separated tail after a bare word before the @), but something like
// `foo@imqueue.com/rpc` in a label could, so strip scopes first.
const SCOPE = /@imqueue\/[a-z-]+/g;

// The site's own contact address is allowed to appear. It has no business being
// in a drawing either, but if it ever is, that is the one address the site
// publishes on purpose — see the Organization node in scripts/check-jsonld.js.
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

// Inline SVGs are included into the page verbatim, so the rewrite lands inside
// the SVG DOM — where it is a layout break, not a text substitution.
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

if (failures) {
  console.error(`\n${failures} email-literal check(s) failed. `
    + 'An address in a drawing does not survive an edge that obfuscates email.');
  process.exit(1);
}
console.log('\nAll email-literal checks passed.');
