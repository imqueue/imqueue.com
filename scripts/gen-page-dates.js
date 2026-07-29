#!/usr/bin/env node
// gen-page-dates.js — record real publication/modification dates for the
// hand-authored pages, keyed by source path, into src/_data/pageDates.json.
//
//   node scripts/gen-page-dates.js [--check]
//
// Why this exists. head.html used to fill TechArticle.datePublished from
// `page.date`, which Eleventy derives from the file's mtime when no front matter
// supplies one. Cloudflare Pages builds from a fresh clone, so every file's mtime
// is the checkout time — and all 31 docs pages advertised the *deploy* moment as
// their publication date, identical to the millisecond, moving forward on every
// deploy:
//
//   /cli/          "datePublished": "2026-07-29T11:22:24.270Z"
//   /get-started/  "datePublished": "2026-07-29T11:22:24.270Z"
//
// A page whose datePublished changes every few days is a discarded freshness
// signal at best. Reading git here and committing the result keeps the dates true
// and stable regardless of how the build host clones — head.html now emits nothing
// when a page has no entry, which is better than emitting a date that is wrong.
//
// Blog posts are excluded: they carry real `date:` front matter already. The
// generated API reference is excluded too — a symbol page has no editorial date,
// and its version tree is the meaningful "when".

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'src', '_data', 'pageDates.json');
const ROOTS = [path.join('src', 'org'), path.join('src', 'com')];
const PAGE_EXT = new Set(['.md', '.html']);
// Excluded by prefix, relative to ROOT and posix-separated.
const SKIP = [
  'src/org/blog/posts/', // real `date:` front matter
  'src/org/api/',        // generated; no editorial date
];

const posix = (p) => p.split(path.sep).join('/');

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      walk(full, out);
      continue;
    }
    if (!PAGE_EXT.has(path.extname(entry.name))) continue;

    const rel = posix(path.relative(ROOT, full));

    if (!SKIP.some((s) => rel.startsWith(s))) out.push(rel);
  }
  return out;
}

function git(args) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();
}

// `git log --follow --diff-filter=A` gives the commit that introduced the file,
// tracking renames — the closest thing to a publication date the repo holds.
function datesFor(rel) {
  const added = git(['log', '--follow', '--diff-filter=A', '--format=%aI', '--', rel])
    .split('\n')
    .filter(Boolean)
    .pop();
  const modified = git(['log', '-1', '--format=%aI', '--', rel]);

  return added && modified ? { published: added, modified } : null;
}

const files = ROOTS.flatMap((r) => walk(path.join(ROOT, r))).sort();
const dates = {};
let untracked = 0;

for (const rel of files) {
  const d = datesFor(rel);

  if (!d) {
    untracked++;
    continue; // never committed — omit rather than invent
  }
  dates[rel] = d;
}

const json = `${JSON.stringify(dates, null, 2)}\n`;

if (process.argv.includes('--check')) {
  const current = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : '';

  if (current !== json) {
    console.error(
      'src/_data/pageDates.json is stale — run `npm run gen-page-dates` and commit it.',
    );
    process.exit(1);
  }
  console.log(`pageDates.json is up to date (${Object.keys(dates).length} pages)`);
  process.exit(0);
}

fs.writeFileSync(OUT, json);
console.log(
  `wrote ${path.relative(ROOT, OUT)}: ${Object.keys(dates).length} pages` +
  (untracked ? ` (${untracked} uncommitted, omitted)` : ''),
);
