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
  // /search/ has no editorial date. Its content is a query result — there is no
  // moment at which it was written or last revised, and a "last updated" stamp
  // taken from the day the template changed would be a claim about nothing. Same
  // reasoning as the generated API trees below, and head.html already emits no
  // date for a page with no entry, so this needs no other change.
  'src/search.html',
];

// The GENERATED API version trees — no editorial date, and their sitemap lastmod
// comes from the npm release date instead (apiReleased).
//
// Matched by SHAPE, not by package name. This used to be two literal prefixes
// ('src/org/api/core/', 'src/org/api/rpc/'), which silently stopped working the
// moment a third package was documented: its pages fell through to datesFor(),
// and `check:dates` exited 1 on every wave. That failure is nastier than it
// sounds — at pre-commit the generated files are staged but uncommitted, so
// datesFor() returns null, they are omitted as "untracked", and the hook PASSES.
// The build then fails in CI, after the commit is already made.
//
// Anything one level below src/org/api/ is a package tree; src/org/api/index.md
// sits directly in it, is hand-authored, and does belong here.
const API_VERSION_TREE = /^src\/org\/api\/[^/]+\//;

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

    if (SKIP.some((s) => rel.startsWith(s)) || API_VERSION_TREE.test(rel)) continue;

    out.push(rel);
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

// --check deliberately does NOT demand byte equality. `modified` comes from
// `git log -1`, so it goes stale the moment a page is committed — gating on it
// would mean every commit that touches a page blocks the *next* commit through
// the pre-commit hook, with no way to break the cycle in one step.
//
// What actually matters is enforced:
//   * coverage — a page missing from the file emits no date at all, silently
//   * `published` — the value we promise is stable and true; it comes from the
//     first-add commit and must not drift
// `modified` drift is reported and left alone; a dateModified that lags by a few
// commits is honest, and regenerating is a chore, not a correctness gate.
if (process.argv.includes('--check')) {
  const committed = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : {};
  const missing = Object.keys(dates).filter((k) => !committed[k]);
  const drifted = Object.keys(dates).filter(
    (k) => committed[k] && committed[k].published !== dates[k].published,
  );
  const orphaned = Object.keys(committed).filter((k) => !dates[k]);
  const staleMod = Object.keys(dates).filter(
    (k) => committed[k] && committed[k].modified !== dates[k].modified,
  );

  for (const k of missing) console.error(`  FAIL  ${k} has no entry — it would render with no date`);
  for (const k of drifted) {
    console.error(
      `  FAIL  ${k} publication date changed: ` +
      `${committed[k].published} -> ${dates[k].published}`,
    );
  }

  if (missing.length || drifted.length) {
    console.error('\nRun `npm run gen-page-dates` and commit src/_data/pageDates.json.');
    process.exit(1);
  }

  console.log(
    `pageDates.json covers all ${Object.keys(dates).length} pages, publication dates stable` +
    (staleMod.length ? `; ${staleMod.length} dateModified value(s) behind HEAD` : '') +
    (orphaned.length ? `; ${orphaned.length} entr(ies) for pages that no longer exist` : ''),
  );
  process.exit(0);
}

// --fix-modified rewrites ONLY the `modified` values, leaving `published` and the
// key set exactly as committed.
//
// The drift this repairs is real but narrow: it affects the ~50 hand-authored pages
// only (blog posts use front matter, the 423 API pages use `apiReleased`), and it was
// last corrected by hand — commit f56a330, "re-date the pages whose source had moved
// past their dateModified". A human noticing a stale date is not a process.
//
// A separate mode rather than folding it into the plain run for one reason: the plain
// run also ADDS pages and can change `published` for a file whose history changed
// (a rename, a squash), and the weekly job that consumes this must be able to open a
// diff that is only dates. If it also introduced a new page, review would be
// "probably fine" rather than "obviously fine".
//
// Deliberately NOT wired into --check as a failure. The comment above --check
// explains why: `modified` goes stale the moment a page is committed, so gating on it
// makes every commit block the next one through the pre-commit hook.
if (process.argv.includes('--fix-modified')) {
  if (!fs.existsSync(OUT)) {
    console.error(`${path.relative(ROOT, OUT)} does not exist — run without --fix-modified first.`);
    process.exit(1);
  }

  const committed = JSON.parse(fs.readFileSync(OUT, 'utf8'));
  const moved = [];

  for (const [key, entry] of Object.entries(committed)) {
    const fresh = dates[key];

    if (!fresh || fresh.modified === entry.modified) continue;
    moved.push({ key, from: entry.modified, to: fresh.modified });
    entry.modified = fresh.modified;
  }

  if (!moved.length) {
    console.log('no dateModified drift — nothing to fix.');
    process.exit(0);
  }

  fs.writeFileSync(OUT, `${JSON.stringify(committed, null, 2)}\n`);
  for (const m of moved) console.log(`  ${m.key}: ${m.from} -> ${m.to}`);
  console.log(
    `\nrewrote ${moved.length} dateModified value(s) in ${path.relative(ROOT, OUT)}. ` +
    'published dates and the key set are untouched.',
  );
  process.exit(0);
}

fs.writeFileSync(OUT, json);
console.log(
  `wrote ${path.relative(ROOT, OUT)}: ${Object.keys(dates).length} pages` +
  (untracked ? ` (${untracked} uncommitted, omitted)` : ''),
);
