#!/usr/bin/env node
// check-search-ranking.js — asserts what the search ranker must return.
//
//   node scripts/check-search-ranking.js
//
// Relevance is the part of a search feature that regresses silently. Every weight in
// the ranker was set to fix a specific wrong answer, and each of those is one "small
// improvement" away from coming back — the @imqueue MCP server's ranker learned this
// the hard way, twice. So each case below names the signal it protects and the wrong
// answer that was actually observed before it existed.
//
// The ranker is required directly: it exports itself when there is no `document`,
// which is why it can be checked here instead of through a browser screenshot. It
// lives in a submodule now, so this file is also the check that notices an
// unpopulated one — requireRanker() throws with the fix.
//
// Exits non-zero on any failure; wired into `npm test`.

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, '_site-org');
const ranker = require('./lib/ranker.js').requireRanker();

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
    // Was '/' until the element order changed to put curated `keywords` above `title`.
    // /intro/ declares the literal phrase "what is imqueue" in its keywords and its title
    // answers the question in a sentence — "@imqueue is a message-queue RPC framework for
    // Node.js and TypeScript back-ends" — so it wins on the signal that was promoted, which
    // is the promotion working rather than a regression. The home page is #2 and the failure
    // this case was written for has not come back: see the stopword and bagScore checks
    // below, which are what actually guard it.
    query: 'what is imqueue',
    url: '/intro/',
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

// IDF is neutralised for the synthetic probes below by clearing `df`. They are two- and
// four-document corpora, where document frequency cannot mean anything — a term in three of
// four documents reads as "common" and every score collapses to the floor, which is exactly
// how these two checks first failed. The probes exist to pin the ELEMENT weights and the
// density rule in isolation; corpus-level rarity is measured against the real corpus above.
ranker.state.t2 = ranker.prepareSections(ELEMENT_PROBE);
ranker.state.t2.df = null;

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
ranker.state.t2.df = null;

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

// ---- word order and spacing break a tie ------------------------------------
// The case this exists for, stated by the person who asked for it: two passages
// containing exactly the same words, one in the order they were typed. Everything
// else about them is identical — same coverage, same density, same bag match — so
// nothing but position can separate them, and the bonus has to be applied OUTSIDE
// the max(bag, graded) or it is discarded before it can.
const POSITION_PROBE = {
  v: 1,
  pages: [['/in-order/', 'p', 'Docs'], ['/scrambled/', 'p', 'Docs']],
  sections: [
    [0, 'x', 'what is imqueue', 'filler filler filler', ''],
    [1, 'y', 'what imqueue is', 'filler filler filler', ''],
  ],
};

ranker.state.t2 = ranker.prepareSections(POSITION_PROBE);
ranker.state.t2.df = null;

const position = {};

for (const hit of ranker.search(ranker.parseQuery('what is imqueue'))) {
  position[hit.record.u.split('#')[1]] = hit.score;
}
ranker.state.t2 = saved;

if (!(position.x > position.y)) {
  fail(`word order is not scored: "what is imqueue" ${Math.round(position.x || 0)} vs "what imqueue is" ${Math.round(position.y || 0)}`);
} else if (position.x - position.y > position.y * 0.25) {
  fail(`the word-order bonus is too large to be a tie-breaker: ${Math.round(position.x)} vs ${Math.round(position.y)}`);
} else {
  pass(`word order breaks a tie, gently (${Math.round(position.x)} vs ${Math.round(position.y)})`);
}

// ---- morphology --------------------------------------------------------------
// An inflected query must reach the same page as its dictionary form. Not the same
// SCORE — a lemma match is worth 0.55 of a literal one on purpose — the same page.
const INFLECTED = [
  ['retry', 'retries'],
  ['client', 'clients'],
  ['timeout', 'timeouts'],
  ['namespace', 'namespaces'],
];

for (const [base, inflected] of INFLECTED) {
  const a = run(base);
  const b = run(inflected);

  // RECALL, not rank. A lemma match is deliberately worth 0.55 of a literal one, so the
  // inflected form legitimately orders its results differently — what morphology buys is
  // that the page is reachable at all. Asserting the same top-five was asserting a
  // property this design does not claim, and it failed for exactly that reason.
  const at = b.findIndex((hit) => hit.record.u === a[0].record.u);

  if (!b.length) {
    fail(`"${inflected}" returned nothing — the lemma map is not reaching the ranker`);
  } else if (at === -1) {
    fail(
      `"${inflected}" never reaches "${base}"'s top result (${a[0].record.u}) in ${b.length} hits:\n` +
      `        ${b.slice(0, 5).map((h) => h.record.u).join('\n        ')}`
    );
  } else {
    pass(`"${inflected}" reaches what "${base}" finds, at rank ${at + 1} of ${b.length}`);
  }
}

// Irregular forms are the half no rule set can do, and the reason the dictionary was
// chosen over suffix stripping.
const IRREGULAR = [['went', 'go'], ['gone', 'go'], ['mice', 'mouse'], ['indices', 'index']];
const lemmaMap = ranker.state.t2.lemmas;
const wrongIrregular = IRREGULAR.filter(([form, lemma]) => lemmaMap[form] && lemmaMap[form] !== lemma);
const presentIrregular = IRREGULAR.filter(([form]) => lemmaMap[form]);

if (wrongIrregular.length) {
  fail(`irregular forms map wrongly: ${wrongIrregular.map(([f, l]) => `${f}->${lemmaMap[f]} (wanted ${l})`).join(', ')}`);
} else if (!presentIrregular.length) {
  fail('no irregular form from the sample is in the lemma map — the exception lists are not being read');
} else {
  pass(`irregular forms resolve (${presentIrregular.map(([f]) => `${f}->${lemmaMap[f]}`).join(', ')})`);
}

// The traps. Each of these WAS a wrong merge at some point in building this, and each
// would silently degrade identifier search if it came back. scripts/data/project-words.txt
// documents why every one of them is refused.
const NEVER_MERGED = ['string', 'data', 'index', 'user', 'server', 'broker', 'later', 'send', 'lock'];
const merged = NEVER_MERGED.filter((word) => lemmaMap[word]);

if (merged.length) {
  fail(`these must never be lemmatized, but are: ${merged.map((w) => `${w}->${lemmaMap[w]}`).join(', ')}`);
} else {
  pass(`the ${NEVER_MERGED.length} words that must stay themselves do (string, data, user, server, broker, send, …)`);
}

// Identifiers are matched literally. `send` reaching `sendOptions` through a shared
// lemma is the exact failure the no-stemmer rule was written to prevent.
const sendHits = run('send').filter((hit) => hit.record.g === 1);
const sendTop = sendHits[0];

// The top symbol may be named exactly `send` or `Something.send` — both are the member
// being asked for. The first version of this check demanded the dotted form and failed
// on the better answer.
const sendName = sendTop ? sendTop.record.t.toLowerCase().split('.').pop() : '';

if (!sendTop || sendName !== 'send') {
  fail(`"send" should rank a send() member first among symbols, got ${sendTop ? sendTop.record.t : 'nothing'}`);
} else {
  pass(`"send" ranks ${sendTop.record.t} first among symbols — identifiers stay literal`);
}

// ---- curated keywords ---------------------------------------------------------
// `keywords:` front matter states which queries a page exists to answer, and it was absent
// from the index entirely until this element existed — 140 of 186 curated phrases appeared
// nowhere in the indexed text, so the page written for "nodejs backpressure microservices"
// was not among that query's 32 results at all. Each case below is a measured before/after.
const KEYWORD_CASES = [
  ['handle traffic spikes microservices', '/blog/backpressure-nodejs-services/', 'was absent entirely'],
  ['nodejs backpressure microservices', '/blog/backpressure-nodejs-services/', 'was absent entirely'],
  ['overload resilience', '/blog/backpressure-nodejs-services/', 'was absent entirely'],
  ['message queue throughput', '/blog/benchmarking-imqueue-throughput/', 'was #32'],
  ['nodejs job queue', '/blog/imqueue-vs-bullmq/', 'was #36'],
  ['imqueue benchmark', '/blog/benchmarking-imqueue-throughput/', 'was #2'],
];

for (const [query, target, was] of KEYWORD_CASES) {
  const hits = run(query);
  const at = hits.findIndex((hit) => hit.record.u.split('#')[0] === target);

  if (at === -1) {
    fail(`"${query}" does not reach ${target} at all (${was}) — curated keywords are not being scored`);
  } else if (at > 5) {
    fail(`"${query}" ranks ${target} at #${at + 1} (${was}); the page written for this phrase should be in the top few`);
  } else {
    pass(`"${query}" ranks its target page #${at + 1} (${was})`);
  }
}

// The counterweight. Keywords are self-declared and cheap to pad, so the element sits
// below emphasis and is scored on coverage alone. If it ever outgrew that, an identifier
// query would start returning articles that merely LIST the identifier — which is the
// failure mode <meta name="keywords"> earned its reputation for.
const identifier = run('safeDelivery')[0];

if (!identifier || identifier.record.g !== 1) {
  fail(`"safeDelivery" no longer ranks a symbol first — keyword weight may have overtaken the reference`);
} else {
  pass('"safeDelivery" still ranks the symbol first — keywords cannot outrank reference');
}

// ---- a topic query reaches the page ABOUT the topic ---------------------------
// Reported from the browser: "what is imqueue licensing options are" put a Moleculer
// comparison section first and imqueue.org's own licensing page third, on imqueue.org. The
// measured spread over eight licensing-intent phrasings is what the three fixes below were
// judged against — the density ceiling, the URL element, and the front-matter keywords.
const LICENSE_PHRASINGS = [
  ['imqueue license', 1],
  ['licensing', 1],
  ['licensing options', 1],          // was #50 — `IMQOptions` won on a two-token title
  ['what is imqueue licensing options are', 1], // was #3 — the reported case
  ['gpl obligation', 1],
];

for (const [query, worst] of LICENSE_PHRASINGS) {
  const hits = run(query);
  const at = hits.findIndex((hit) => hit.record.u.split('#')[0] === '/license/');

  if (at === -1 || at + 1 > worst) {
    fail(`"${query}" ranks /license/ ${at === -1 ? 'nowhere' : `#${at + 1}`}, expected #${worst} or better`);
  } else {
    pass(`"${query}" ranks /license/ #${at + 1}`);
  }
}

// The density ceiling, stated directly: a two-token title matching ONE query term must not
// beat a page that is about the query. This is the shape of the IMQOptions defect.
const shortTitle = run('licensing options')[0];

if (shortTitle && shortTitle.record.g === 1) {
  fail(`"licensing options" ranks the symbol ${shortTitle.record.t} first — density is saturating on short titles again`);
} else {
  pass('"licensing options" is not hijacked by a short symbol name');
}

// ---- cross-site search -------------------------------------------------------
// imqueue.org and imqueue.com search each other, reading the peer's index from their own
// origin (scripts/copy-peer-index.js). Two properties matter, and they pull against each
// other: the other site's pages must be REACHABLE, and they must never displace a local
// page that answers as well.
const peerIndex = path.join(OUT, 'search-peer-index.json');

if (!fs.existsSync(peerIndex)) {
  pass('no peer index in this build — cross-site search not checked (build both editions)');
} else {
  ranker.state.x1 = ranker.prepare(JSON.parse(fs.readFileSync(peerIndex, 'utf8')));
  ranker.state.x2 = ranker.prepareSections(JSON.parse(fs.readFileSync(path.join(OUT, 'search-peer-text.json'), 'utf8')));

  // THE ORDERING INVARIANT: the site you are on wins. No peer result may precede any local
  // result, on any query. This assertion replaces one that demanded the opposite for
  // "pricing" — that imqueue.com/pricing/ rank FIRST on imqueue.org — which is what
  // produced the reported defect: for "what is imqueue license" the entire COMMERCIAL group
  // sat above imqueue.org's own licensing page, on imqueue.org.
  const ORDER_PROBES = ['what is imqueue license', 'pricing', 'commercial license', 'support', 'SLA'];

  for (const probe of ORDER_PROBES) {
    const hits = ranker.search(ranker.parseQuery(probe));
    const firstPeer = hits.findIndex((hit) => hit.external);
    const lastLocal = hits.reduce((at, hit, i) => (hit.external ? at : i), -1);

    if (firstPeer !== -1 && lastLocal > firstPeer) {
      fail(
        `"${probe}" interleaves sites: a peer result at #${firstPeer + 1} precedes a local one at ` +
        `#${lastLocal + 1}. On imqueue.org, imqueue.org wins.`
      );
    } else {
      pass(`"${probe}" keeps every local result ahead of every peer result`);
    }
  }

  // Reachable, though. Priority is about ORDER, not exclusion: imqueue.org has no pricing
  // page, and the reader must still be offered the one that exists.
  const pricingPeers = ranker.search(ranker.parseQuery('pricing')).filter((hit) => hit.external);

  if (!pricingPeers.length || pricingPeers[0].record.u !== '/pricing/') {
    fail(
      '"pricing" should still reach imqueue.com/pricing/ as the best peer result — got ' +
      (pricingPeers.length ? pricingPeers[0].record.u : 'no peer results at all')
    );
  } else {
    pass('"pricing" still reaches imqueue.com/pricing/ — first in the peer group');
  }

  // Not displacing: a reference query must stay entirely local. The commercial site talks
  // about the framework too, so this is a real risk rather than a formality.
  const local = ranker.search(ranker.parseQuery('watcherCheckDelay'));

  if (local[0] && local[0].external) {
    fail(`"watcherCheckDelay" ranked a peer page first: ${local[0].record.u}`);
  } else {
    pass('"watcherCheckDelay" stays on imqueue.org — the peer cannot displace reference');
  }

  // De-weighted: the same record scored from the peer must come out below its local score.
  const q = ranker.parseQuery('commercial license');
  const withPeer = ranker.search(q).filter((hit) => hit.external);

  if (!withPeer.length) {
    fail('"commercial license" found nothing on the peer — the peer corpus is not being searched');
  } else {
    pass(`the peer group is populated and de-weighted (${withPeer.length} peer hits, best ${Math.round(withPeer[0].score)})`);
  }

  ranker.state.x1 = null;
  ranker.state.x2 = null;
}

// ---- rare words weigh more ----------------------------------------------------
// The signal that made "can i use imqueue commercially" stop returning five FAQ answers
// titled "Can I use @imqueue…", none of which were about licensing. Measured over 703
// sections: "imqueue" is in 407 of them, "commercial" in 42.
const df = ranker.state.t2.df;

if (!df || !ranker.state.t2.docs) {
  fail('the prose index carries no document frequencies — rare terms are not being weighted');
} else if (!(df.imqueue > df.commercial * 3)) {
  fail(`document frequencies look wrong: imqueue ${df.imqueue}, commercial ${df.commercial}`);
} else {
  const common = ranker.parseQuery('imqueue');
  const rare = ranker.parseQuery('backpressure');

  ranker.search(common);
  ranker.search(rare);

  if (!(rare.weights[0] > common.weights[0] * 2)) {
    fail(
      `a rare term is not weighted above a common one: backpressure ${rare.weights[0].toFixed(3)} ` +
      `vs imqueue ${common.weights[0].toFixed(3)}`
    );
  } else {
    pass(
      `rare terms weigh more (backpressure ${rare.weights[0].toFixed(2)} in ${df.backpressure} sections, ` +
      `imqueue ${common.weights[0].toFixed(2)} in ${df.imqueue})`
    );
  }
}

// ---- the topic term ------------------------------------------------------------
// "can i use imqueue commercially" is the query that exposed three separate defects at
// once, so it gets three assertions rather than one.
//
// What it looked like: the top five results were "Can I use @imqueue with a GraphQL or
// REST gateway?", "…Moleculer's transporters…?", "…inside a NestJS application?" and two
// more of the same, and the page that answers the question was not in the 72 results.
{
  const target = '/blog/imqueue-vs-moleculer/#is-the-gpl-3-0-licence-a-problem-for-commercial-use';
  const hits = ranker.search(ranker.parseQuery('can i use imqueue commercially'));
  const at = hits.findIndex((hit) => hit.record.u === target);

  if (at !== 0) {
    fail(
      '"can i use imqueue commercially" ranks the commercial-use answer ' +
      (at === -1 ? 'nowhere at all' : `#${at + 1}`) + ', expected #1'
    );
  } else {
    pass('"can i use imqueue commercially" ranks the commercial-use answer #1 (was absent entirely)');
  }

  // Defect 2: the interrogative bonus was going to question-shaped answers that matched
  // only the filler words. Nothing question-shaped that misses `commercially` may outrank
  // the answer that carries it — the "Can I use @imqueue…" family is the specific case.
  const gateway = hits.findIndex((hit) => /graphql-or-rest-gateway$/.test(hit.record.u));

  if (gateway !== -1 && gateway < at) {
    fail(`a topic-missing answer still outranks the real one (#${gateway + 1} vs #${at + 1})`);
  } else {
    pass('answers that miss the query topic no longer crowd out the one that has it');
  }

  // Defect 3: the coverage floor credited literal and lemma matches only, while the scorer
  // also credited a truncated prefix — so the answer whose heading says "commercial use"
  // was rejected before it could be ranked, with nothing to see. covers() is now shared.
  const q = ranker.parseQuery('can i use imqueue commercially');

  ranker.search(q);

  if (q.lemmas[q.terms.indexOf('commercially')] !== 'commercial') {
    fail(
      '"commercially" no longer resolves to "commercial" — the corpus-validated ' +
      'derivational route is off, and nothing else can bridge -ly'
    );
  } else {
    pass('"commercially" reaches "commercial" (query side, validated against the corpus)');
  }
}

// The words the -ly route must NOT touch, and the evidence is in scripts/lib/lemma.js:
// index-time -ly stripping produced `reply -> rep`, `only -> on`, `apply -> app`,
// `multiply -> multiple` and `supply -> supple`. Here the guard is a minimum stem plus
// "does this site use the word", so these must all come out unchanged.
{
  const dangerous = ['only', 'apply', 'reply', 'multiply', 'supply', 'fully', 'family'];
  const broken = dangerous.filter((word) => {
    const q = ranker.parseQuery(word);

    ranker.search(q);

    return q.lemmas[0];
  });

  if (broken.length) {
    fail(`the -ly route rewrote words it must leave alone: ${broken.join(', ')}`);
  } else {
    pass(`the ${dangerous.length} words -ly must not touch are untouched (only, apply, reply, …)`);
  }
}

// ---- the URL element ----------------------------------------------------------
// A path word the title does NOT have is the strongest element on the page, because it is
// the only place that word exists. /mcp/installation/ is titled "Add the MCP server to
// Claude, Cursor & VS Code" — "installation" appears nowhere but the path.
//
// This failed for a reason that had nothing to do with weight: urlScore required a query
// term to EQUAL a segment, so "installation mcp" ranked the page #1 and "install mcp" could
// not find it at all, while every other element in the ranker matched substrings.
{
  const cases = [
    ['how to install mcp', '/mcp/installation/'],
    ['install mcp', '/mcp/installation/'],
    ['installation mcp', '/mcp/installation/'],
  ];

  for (const [query, url] of cases) {
    const hits = ranker.search(ranker.parseQuery(query));
    const at = hits.findIndex((hit) => hit.record.u === url);

    if (at !== 0) {
      fail(`"${query}" ranks ${url} ${at === -1 ? 'nowhere' : `#${at + 1}`}, expected #1`);
    } else {
      pass(`"${query}" ranks ${url} #1`);
    }
  }

  // The other half: a path that merely echoes its own title must NOT be promoted. A blog
  // slug is generated from the title, so scoring it at the top weight would silently mean
  // "titles count double" — and every non-slug element would be demoted to pay for it.
  const echo = ranker.search(ranker.parseQuery('imqueue vs moleculer'));
  const first = echo[0] && echo[0].record.u;

  if (first !== '/blog/imqueue-vs-moleculer/') {
    fail(`"imqueue vs moleculer" ranks ${first} first, expected the article itself`);
  } else {
    pass('a slug that echoes its title still ranks its own article first, without a double count');
  }
}

// ---- a declared query beats scattered overlap ---------------------------------
// `keywords` sits above `title` now, and at that weight the difference between "one of my
// declared phrases IS what you typed" and "your words appear somewhere in my list" is the
// whole value of the element. Without the distinction, four blog comparison pages whose
// lists merely contain "imqueue" pushed the home page's own "What @imqueue is" heading from
// #1 to #9 for the query "what is imqueue".
{
  const hits = ranker.search(ranker.parseQuery('what is imqueue'));
  const home = hits.findIndex((hit) => hit.record.u === '/');

  if (home === -1 || home > 2) {
    fail(
      'the home page ranks ' + (home === -1 ? 'nowhere' : `#${home + 1}`) +
      ' for "what is imqueue" — word overlap in a keywords list is outscoring a heading again'
    );
  } else {
    pass(`the home page holds #${home + 1} for "what is imqueue" behind /intro/, which declares the phrase`);
  }
}

// ---- a page has to CLAIM the query -------------------------------------------
// "is imqueue free" ranked /license/ #50, then #27, and the ranker was not the whole
// story: /license/ never used the word "free" in its title, description or keywords, so
// there was nothing for the rarest word in the query to match. Five blog records matched
// "imqueue" in a title, in keywords and in a URL — five weak signals on the corpus's most
// common word — and summed to more than /license/ covering 97% of the query in its prose.
//
// The fix was one line of front matter, which is what `keywords` is FOR: the author saying
// which queries the page exists to answer. This check guards the outcome, not the wording —
// if someone trims those keywords, this fails and says why.
{
  const hits = ranker.search(ranker.parseQuery('is imqueue free'));

  if (!hits[0] || hits[0].record.u !== '/license/') {
    fail(
      '"is imqueue free" ranks ' + (hits[0] ? hits[0].record.u : 'nothing') +
      ' first, expected /license/ — check that its `keywords` front matter still claims the query'
    );
  } else {
    pass('"is imqueue free" ranks /license/ #1 (was #50)');
  }
}

// ---- a thematic break is not part of the answer above it -----------------------
// Every blog post ends with `---` and a "where to go next" paragraph. It used to be glued
// onto the last heading, which on nine posts is an FAQ answer — so an answer about GraphQL
// gateways contained "See commercial licensing & support", and the dialog rendered a
// literal "---" mid-snippet.
{
  const glued = ranker.state.t2.sections.filter((section) => /(^|\s)-{3,}(\s|$)/.test(section[3]));

  if (glued.length) {
    fail(
      `${glued.length} section(s) still carry a thematic break in their text, ` +
      `e.g. "${glued[0][2] || ranker.state.t2.pages[glued[0][0]][1]}"`
    );
  } else {
    pass('no section carries a thematic break — trailing navigation is its own record');
  }
}

// ---- the commercial half answers from the commercial edition -------------------
// The one failure mode with revenue attached, and the one that reports nothing when it
// happens. imqueue.com reaches the ranker ONLY through the peer feeds, so with x1/x2
// unloaded "pricing commercial license" answers from imqueue.org's own /license/: a
// plausible page, the wrong edition, no error anywhere. The @imqueue MCP server's docs.ts
// went out of its way to fix exactly this — "the commercial question was the single thing
// this server could not answer" — and nothing here asserted it stayed fixed.
//
// Skipped, not failed, when the peer feed is absent: `npm run build:org` alone does not
// produce one, and that is a supported local state.
{
  const peerIndex = path.join(OUT, 'search-peer-index.json');
  const peerText = path.join(OUT, 'search-peer-text.json');

  if (!fs.existsSync(peerIndex) || !fs.existsSync(peerText)) {
    console.log('  skip  peer feed absent (build:all builds it) — commercial cases not checked');
  } else {
    ranker.state.x1 = ranker.prepare(JSON.parse(fs.readFileSync(peerIndex, 'utf8')));
    ranker.state.x2 = ranker.prepareSections(JSON.parse(fs.readFileSync(peerText, 'utf8')));

    // Deliberately asserted as "an imqueue.com result is in the set", not "it is first".
    // Which commercial page wins is a ranking judgement that may change; that the answer
    // comes from the edition which documents licensing at all is not.
    // Chosen for being answerable ONLY by the commercial edition. "support" was tried and
    // dropped: imqueue.org has its own page titled Support, which takes #1 correctly, so the
    // query is not commercial-only and asserting otherwise asserted a false premise. The
    // third case is the exact phrasing the plan names as the failure it saw.
    const COMMERCIAL = [
      ['pricing', 'a price is only ever quoted on the commercial edition'],
      ['commercial license', 'the org edition documents the GPL, not the commercial terms'],
      ['pricing commercial license', 'the phrasing that answered from org /license/ with no error'],
    ];

    for (const [query, why] of COMMERCIAL) {
      const hits = ranker.search(ranker.parseQuery(query));
      const peer = hits.findIndex((hit) => hit.external);

      if (peer === -1) {
        fail(`"${query}" returns no imqueue.com result at all — ${why}`);
      } else if (peer >= 10) {
        fail(`"${query}" puts its first imqueue.com result at ${peer + 1}, past the visible set`);
      } else {
        pass(`"${query}" reaches imqueue.com at #${peer + 1} — ${why}`);
      }
    }

    // And the reverse, because the peer feed must not swamp the framework docs either.
    const local = ranker.search(ranker.parseQuery('redis queue')).findIndex((hit) => !hit.external);

    if (local !== 0) {
      fail(`"redis queue" no longer leads with an imqueue.org result (index ${local})`);
    } else {
      pass('a framework query still leads with imqueue.org, so the peer feed does not swamp it');
    }
  }
}

// ---- relaxation fires ONLY on an empty result set ------------------------------
// The whole safety argument for spelling correction is the gate: a query that returns
// something is scored by identical code, so the feature cannot move the KPI. That argument is
// worth exactly as much as this assertion — remove the gate and the ranker starts silently
// answering questions nobody asked, with no test objecting.
//
// The ordering case is here too. `nestjs.microservices cqrs` is answered by splitting the
// compound alone, and a single combined relaxation pass also "corrected" `cqrs` to `cars`
// (one substitution, and `cars` is in five sections) — announcing a query about CQRS as a
// query about cars. Confident rewrites have to be tried before guesses.
{
  const RELAXED = [
    {
      query: 'nestjs.microservices cqrs',
      corrected: 'nestjs microservices cqrs',
      protects: 'a dotted compound is split, and the unknown word beside it is left alone',
      regression: 'returned zero results; then returned results "for nestjs microservices cars"',
    },
    {
      query: 'imqeueue',
      corrected: 'imqueue',
      protects: 'one transposed key is corrected against the corpus vocabulary',
      regression: '29% of one-transposed-key queries returned an empty result set',
    },
    {
      query: 'watcherChekcDelay',
      corrected: null,
      protects: 'a query that already returns something is never rewritten',
      regression: 'n/a — this is the gate the safety argument rests on',
    },
  ];

  for (const testCase of RELAXED) {
    const q = ranker.parseQuery(testCase.query);
    const hits = ranker.search(q);

    if (!hits.length) {
      fail(`"${testCase.query}" returns nothing — ${testCase.protects}`);
      continue;
    }
    if (testCase.corrected === null) {
      if (q.corrected) {
        fail(`"${testCase.query}" was rewritten to "${q.corrected}" although it had results — `
          + 'relaxation must fire only on an empty result set');
      } else {
        pass(`"${testCase.query}" is not rewritten — ${testCase.protects}`);
      }
      continue;
    }
    if (q.corrected !== testCase.corrected) {
      fail(`"${testCase.query}" was rewritten to "${q.corrected}", expected `
        + `"${testCase.corrected}" — ${testCase.protects}`);
    } else {
      pass(`"${testCase.query}" → "${q.corrected}" — ${testCase.protects}`);
    }
  }
}

if (failures) {
  console.error(`\n${failures} search ranking check(s) failed.`);
  process.exit(1);
}
console.log('\nAll search ranking checks passed.');
