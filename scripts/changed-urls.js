#!/usr/bin/env node
/*
 * changed-urls.js — the site URLs a git diff actually touched.
 *
 *   node scripts/changed-urls.js <edition> <git-range> [--prefix=/api/]
 *
 *   node scripts/changed-urls.js org HEAD~1..HEAD
 *   node scripts/changed-urls.js org HEAD~1..HEAD --prefix=/api/
 *
 * Prints one absolute URL per line, suitable for:
 *
 *   node scripts/indexnow-ping.js org $(node scripts/changed-urls.js org HEAD~1..HEAD)
 *
 * Why this exists. Two jobs regenerate content and push it, and both submitted either
 * everything or nothing:
 *
 *   * refresh-api-docs.yml regenerates the 423 /api/ pages daily and pings nothing,
 *     because `npm run indexnow:org` passes --exclude=/api/. That exclusion is right
 *     for a whole-sitemap submission — 423 URLs of which two changed is a poor use of
 *     a daily quota, and the sitemap's per-page lastmod already carries the change —
 *     but it means a genuinely new release reaches Bing only on the next crawl.
 *   * sync-cli-guide.yml pings the whole sitemap after a CLI release, when at most a
 *     dozen /cli/ pages moved.
 *
 * A diff-scoped submission is the honest middle: exactly the URLs whose content
 * changed, which is what IndexNow is for.
 *
 * The source-path -> URL rule mirrors the `permalink` computed in
 * src/{org,com}/*.11tydata.js. Rather than trust that mirroring, every derived URL is
 * INTERSECTED with the built sitemap, and anything that does not appear there is
 * dropped with a note on stderr. So a mapping mistake shows up as "0 URLs, 3 dropped"
 * rather than as a submission of URLs that do not exist. Build the edition first.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const HOSTS = { com: 'imqueue.com', org: 'imqueue.org' };

const [edition, range, ...rest] = process.argv.slice(2);

if (!edition || !HOSTS[edition] || !range) {
  console.error('usage: changed-urls.js <org|com> <git-range> [--prefix=/api/]');
  process.exit(2);
}

const prefixArg = rest.find((a) => a.startsWith('--prefix='));
const PREFIX = prefixArg ? prefixArg.split('=').slice(1).join('=') : null;
const ORIGIN = `https://${HOSTS[edition]}`;

// Front matter can override the permalink, and a generated API page never does — but
// a hand-authored one might, so read it rather than assume.
function explicitPermalink(file) {
  const full = path.join(ROOT, file);

  if (!fs.existsSync(full)) return null;

  const head = fs.readFileSync(full, 'utf8').slice(0, 2000);
  const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(head);

  if (!fm) return null;

  const m = /^permalink:\s*"?([^"\n]+?)"?\s*$/m.exec(fm[1]);

  return m ? m[1] : null;
}

// The same rule as the eleventyComputed permalink: strip src/<edition>, drop a
// trailing /index, ensure one trailing slash.
function urlFor(file) {
  const explicit = explicitPermalink(file);

  if (explicit) {
    // A .md permalink is a mirror, not a page — the page's own entry covers it.
    if (explicit.endsWith('.md')) return null;
    return explicit.startsWith('/') ? explicit : null;
  }

  let stem = file
    .replace(/^src\/(org|com)/, '')
    .replace(/\.(md|html|liquid)$/, '')
    .replace(/\/index$/, '/');

  if (stem === '') stem = '/';
  if (!stem.endsWith('/')) stem += '/';

  return stem;
}

const changed = execFileSync('git', ['diff', '--name-only', '--diff-filter=ACMR', range], {
  cwd: ROOT,
  encoding: 'utf8',
})
  .split('\n')
  .map((l) => l.trim())
  .filter((l) => l.startsWith(`src/${edition}/`) && /\.(md|html)$/.test(l));

// The built sitemap is the authority on what exists. .org publishes a sitemap INDEX,
// so expand one level — the same thing indexnow-ping.js does, for the same reason.
function sitemapUrls() {
  const dir = path.join(ROOT, `_site-${edition}`);
  const read = (name) => {
    const file = path.join(dir, name);

    return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  };
  const locs = (xml) => [...xml.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/g)].map((m) => m[1]);
  const root = read('sitemap.xml');

  if (!root) {
    console.error(`_site-${edition}/sitemap.xml not found — build the ${edition} edition first.`);
    process.exit(1);
  }

  if (!root.includes('<sitemapindex')) return new Set(locs(root));

  const out = new Set();

  for (const child of locs(root)) {
    for (const url of locs(read(child.replace(ORIGIN, '')))) out.add(url);
  }

  return out;
}

const live = sitemapUrls();
const wanted = [];
const dropped = [];

for (const file of changed) {
  const rel = urlFor(file);

  if (!rel) continue;
  if (PREFIX && !rel.startsWith(PREFIX)) continue;

  const abs = ORIGIN + rel;

  if (live.has(abs)) wanted.push(abs);
  else dropped.push(`${file} -> ${abs}`);
}

const unique = [...new Set(wanted)].sort();

for (const url of unique) console.log(url);

console.error(
  `${unique.length} changed URL(s)${PREFIX ? ` under ${PREFIX}` : ''} in ${range}` +
  (dropped.length ? `; ${dropped.length} derived URL(s) not in the sitemap, dropped:` : ''),
);
for (const d of dropped.slice(0, 10)) console.error(`  ${d}`);
