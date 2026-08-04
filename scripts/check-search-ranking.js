#!/usr/bin/env node
// check-search-ranking.js — asserts what the search ranker must return.
//
//   node scripts/check-search-ranking.js
//
// Relevance is the part of a search feature that regresses silently. Every weight in
// src/org/js/search.js was set to fix a specific wrong answer, and each of those is
// one "small improvement" away from coming back — the @imqueue MCP server's ranker
// learned this the hard way, twice. So each case below names the signal it protects
// and the wrong answer that was actually observed before it existed.
//
// The ranker is required directly: it exports itself when there is no `document`,
// which is why it can be checked here instead of through a browser screenshot.
//
// Exits non-zero on any failure; wired into `npm test`.

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, '_site-org');
const ranker = require(path.join(ROOT, 'src', 'org', 'js', 'search.js'));

let failures = 0;
const fail = (msg) => { failures++; console.error(`  FAIL  ${msg}`); };
const pass = (msg) => console.log(`  ok    ${msg}`);

for (const name of ['search-index.json', 'search-text.json']) {
  if (!fs.existsSync(path.join(OUT, name))) {
    console.error(`  FAIL  ${name} was not built — run \`npm run build:org\` first`);
    process.exit(1);
  }
}

ranker.state.t1 = ranker.prepare(JSON.parse(fs.readFileSync(path.join(OUT, 'search-index.json'), 'utf8')));
ranker.state.t2 = ranker.prepareSections(JSON.parse(fs.readFileSync(path.join(OUT, 'search-text.json'), 'utf8')));

const run = (query) => ranker.search(ranker.parseQuery(query));

// ---- top-result cases ------------------------------------------------------
// `url` must be the FIRST result. Anything less than first is not what a reader
// experiences: they read the top row.
const CASES = [
  {
    query: 'watcherCheckDelay',
    url: '/api/core/latest/core.imqoptions.watchercheckdelay/',
    protects: 'an exact identifier beats every prose mention of it',
    regression: 'three prose sections ranked above the page that documents it, because groups were ordered by a fixed list instead of by score',
  },
  {
    query: 'safeDelivery',
    url: '/api/core/latest/core.imqoptions.safedelivery/',
    protects: 'an exact last-segment match beats a longer name containing it',
    regression: 'IMQOptions.safeDeliveryTtl scored 836 and IMQOptions.safeDelivery 708, because the graded title weight (620) had crept up to the whole-string weights',
  },
  {
    query: 'RedisQueue',
    url: '/api/core/latest/core.redisqueue/',
    protects: 'a class outranks its own members',
    regression: 'none yet — this is the case KIND_BONUS exists for',
  },
  {
    query: 'what is imqueue',
    url: '/',
    protects: 'the unordered whole-query match (bagScore) and stopword weighting',
    regression: '"Can I use @imqueue alongside gRPC or NATS?" was first: stopword removal reduced the query to "imqueue", thirty records tied, and the tie-break was URL length',
  },
  {
    query: 'backpressure',
    url: '/blog/backpressure-nodejs-services/',
    protects: 'hyphenation-insensitive matching (squash)',
    regression: 'the article devoted to the topic did not appear at all, because the site writes "back-pressure" and nobody types the hyphen',
  },
  {
    query: 'does @imqueue retry a failed call?',
    url: '/blog/rpc-over-redis-nodejs/#does-imqueue-retry-a-failed-rpc-call',
    protects: 'question-shaped sections are promoted for an interrogative query',
    regression: 'the answer was returned as an ordinary article hit with the Answers group empty, because a prose section for the same heading outscored it and won the dedupe',
  },
  {
    query: 'circuit breaker',
    url: '/blog/rpc-over-redis-nodejs/#is-there-a-circuit-breaker',
    protects: 'a two-word phrase reaches the answer written for it',
    regression: 'the docs had no answer at all until 31a1a54 — this is the query that found the gap',
  },
  {
    query: 'pkg:rpc lock',
    url: '/api/rpc/latest/rpc.lock/',
    protects: 'the pkg: filter, and the decorator outranking its options interface',
    regression: 'none yet',
  },
];

for (const testCase of CASES) {
  const hits = run(testCase.query);
  const top = hits[0];

  if (!top) {
    fail(`"${testCase.query}" returned nothing — ${testCase.protects}`);
    continue;
  }
  if (top.record.u !== testCase.url) {
    fail(
      `"${testCase.query}" ranked ${top.record.u} first, expected ${testCase.url}\n` +
      `        protects: ${testCase.protects}\n` +
      `        top 3: ${hits.slice(0, 3).map((h) => `${Math.round(h.score)} ${h.record.u}`).join(' | ')}`
    );
    continue;
  }
  pass(`"${testCase.query}" -> ${testCase.url}`);
}

// ---- the pkg: filter really filters ----------------------------------------
const scoped = run('pkg:rpc lock').filter((hit) => hit.record.g === 1);
const foreign = scoped.filter((hit) => hit.record.p !== '@imqueue/rpc');

if (foreign.length) {
  fail(`pkg:rpc returned ${foreign.length} symbol(s) from another package, e.g. ${foreign[0].record.p}`);
} else {
  pass(`pkg:rpc returned only @imqueue/rpc symbols (${scoped.length})`);
}

// ---- stopwords are searchable, and weak ------------------------------------
// Both halves matter. Dropping stopwords broke "what is imqueue"; keeping them at
// full weight made "does @imqueue retry a failed call?" match 170 sections on the
// words "does" and "a".
const bare = run('the');
const content = run('circuit breaker');

if (!bare.length) {
  fail('"the" returned nothing — stopwords must remain searchable, just weak');
} else if (bare[0].score >= content[0].score) {
  fail(`"the" scored ${Math.round(bare[0].score)}, not below "circuit breaker" at ${Math.round(content[0].score)} — stopwords are not being de-weighted`);
} else {
  pass(`"the" is searchable (${bare.length} hits) and scores below a content query (${Math.round(bare[0].score)} < ${Math.round(content[0].score)})`);
}

// ---- element weights are ordered title > header > emphasis > body ----------
// A synthetic corpus, so this asserts the MODEL rather than today's content: the
// same term, in one element each, must score in that order. Without it the weights
// are four numbers nobody is checking.
// One page per probe section on purpose: three sections of one page would hit the
// two-results-per-page cap and the third would vanish, which looks exactly like a
// scoring failure. That is how this check first "failed".
const ELEMENT_PROBE = {
  v: 1,
  pages: [
    ['/probe-heading/', 'unrelated page', 'Docs'],
    ['/probe-emphasis/', 'unrelated page', 'Docs'],
    ['/probe-body/', 'unrelated page', 'Docs'],
    ['/probe-pagetitle/', 'widget', 'Docs'],
  ],
  sections: [
    [0, 'a', 'widget heading here', 'filler filler filler filler filler', ''],
    [1, 'b', 'plain heading here', 'filler filler filler filler filler', 'widget'],
    [2, 'c', 'plain heading here', 'filler widget filler filler filler', ''],
    [3, 'd', 'plain heading here', 'filler filler filler filler filler', ''],
  ],
};

const saved = ranker.state.t2;

ranker.state.t2 = ranker.prepareSections(ELEMENT_PROBE);

const probe = {};

for (const hit of ranker.search(ranker.parseQuery('widget'))) {
  probe[hit.record.u.split('#')[1] || 'page'] = hit.score;
}
ranker.state.t2 = saved;

// heading > emphasis > body, and a heading match beats a page-title-only match.
// The exact position of the page-title-only case relative to `body` is deliberately
// NOT asserted: for a section result the page title is context, not the section's
// own name, and pinning that pair would be pinning an accident rather than a rule.
const ordered = probe.a > probe.b && probe.b > probe.c && probe.a > (probe.d || 0) && probe.d > 0;

if (!ordered) {
  fail(
    'element weights are out of order — expected heading > emphasis > body, and heading > page-title-only, got ' +
    `heading ${Math.round(probe.a || 0)}, emphasis ${Math.round(probe.b || 0)}, ` +
    `body ${Math.round(probe.c || 0)}, page title ${Math.round(probe.d || 0)}`
  );
} else {
  pass(
    'heading > emphasis > body, all above nothing ' +
    `(${Math.round(probe.a)} > ${Math.round(probe.b)} > ${Math.round(probe.c)}; page title ${Math.round(probe.d)})`
  );
}

// ---- density counts, within one element ------------------------------------
const DENSITY_PROBE = {
  v: 1,
  pages: [['/probe/', 'unrelated page', 'Docs']],
  sections: [
    [0, 'dense', 'plain heading', 'widget widget widget filler filler', ''],
    [0, 'sparse', 'plain heading', ('filler ').repeat(60) + 'widget', ''],
  ],
};

ranker.state.t2 = ranker.prepareSections(DENSITY_PROBE);

const density = {};

for (const hit of ranker.search(ranker.parseQuery('widget'))) {
  density[hit.record.u.split('#')[1]] = hit.score;
}
ranker.state.t2 = saved;

if (!(density.dense > density.sparse)) {
  fail(`keyword density is not counted: dense ${Math.round(density.dense || 0)} vs sparse ${Math.round(density.sparse || 0)}`);
} else {
  pass(`density counts within an element (${Math.round(density.dense)} > ${Math.round(density.sparse)})`);
}

if (failures) {
  console.error(`\n${failures} search ranking check(s) failed.`);
  process.exit(1);
}
console.log('\nAll search ranking checks passed.');
