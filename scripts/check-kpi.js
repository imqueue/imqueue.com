#!/usr/bin/env node
// check-kpi.js — the search KPI as a BUILD GATE, not a report somebody remembers to read.
//
//   node scripts/check-kpi.js                 everything (needs _site-org)
//   node scripts/check-kpi.js --labels-only   just the label set and the judge; no build needed
//
// WHY THIS EXISTS
//
// `npm test` ran fourteen checks and not one of them touched the gold set, while the only KPI with
// teeth anywhere in the repo was a recall@6 floor inside a script `npm test` does not run, over
// labels that had just been shown to call a verified improvement a significant regression. The
// build gated on the weakest available number and the primary KPI gated on nothing at all.
//
// WHAT IT ASSERTS, and why each one is a thing that has actually gone wrong:
//
//   1. EVERY HARVESTED QUERY IS DECIDED EXACTLY ONCE, AND NOTHING IS INVENTED. The labels are
//      hand-written per-query lists in judged/*.js, so the failure mode is not a bad rule — it is
//      a query silently leaving the measurement, or a query that was never harvested being typed
//      into a list from memory. On its first run this caught 18 queries that do not exist, 27 that
//      had been missed and five judged in two places at once.
//   2. THE LABEL SET IS SELF-CONSISTENT. No query in both gold and quarantine, no target repeated
//      in its own `also`, no duplicates. A KPI that averages over a contradiction is unactionable.
//   3. THE FILE ON DISK IS WHAT judged/ ASSEMBLES TO. gold.json is generated; if it has drifted
//      from the decisions, the measured labels are not the reviewed labels.
//   4. EVERY LABELLED PAGE EXISTS. A page that moves would otherwise score 0 for ever and read as
//      a ranking collapse. Section targets carry a #fragment, so both forms count as present.
//   5. P@1 MACRO CLEARS A COMMITTED FLOOR, and the agent metric clears its own. Not a target — a
//      tripwire, deliberately set below the current value, so an accidental regression fails the
//      build and a deliberate one has to move the floor and say why.
//
// Exits non-zero on any failure.

'use strict';

const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const KPI = path.join(ROOT, 'scripts', 'search-kpi');
const DATA = path.join(KPI, 'data');

const { fingerprint, integrity } = require(path.join(KPI, 'lib', 'labels.js'));

const labelsOnly = process.argv.includes('--labels-only');

let failures = 0;
const fail = (msg) => { failures++; console.error(`  FAIL  ${msg}`); };
const pass = (msg) => console.log(`  ok    ${msg}`);

// THE FLOORS. Set below the measured value on purpose — a floor at the current number turns every
// run into a coin toss on rounding, and a floor far below it catches nothing. Roughly two points of
// slack, which is one standard error of P@1 at this sample size.
const FLOOR = {
  // Measured on labels 12336a824b18 — 985 headline queries (+246 reported as `seo`) judged from page content, 64 of them targeting an
  // anchored section. Each floor sits roughly one standard error below the measured value: a floor at
  // the current number makes every run a coin toss on rounding, and one far below it catches nothing.
  //
  // NOT comparable with the pre-rebuild numbers. The label set more than doubled (517 natural -> 1083),
  // 18 of the 19 agent queries were retargeted from a reference page to the FAQ section that actually
  // answers them, and the aggregation now pools 86 topics into 43 groups.
  p1Macro: 50.5, // measured 52.6
  p1Micro: 59.5, // measured 61.6
  recall6Micro: 88.5, // measured 90.4
  intentRecall6: 100.0, // measured 100.0 — the agent set has no slack to give
  targetUnreachable: 4.5, // measured 3.8, and this one is a CEILING
  // The reference pages that have to stay FINDABLE even where something answers better. 66.7% in the
  // top six (12 of 18), up from 42.3% before — not because ranking changed, but because the labels are
  // now true, so `mustReach` is measuring the reference page against the query that actually needed it.
  reachTop6: 61.0,
  seoP1: 79.0, // measured 81.3 — the 246 MCP-setup keywords, reported apart from the headline
};


const goldFile = path.join(DATA, 'gold.json');
const quarantineFile = path.join(DATA, 'quarantine.json');

if (!fs.existsSync(goldFile)) {
  console.error('scripts/search-kpi/data/gold.json is missing — run `node scripts/search-kpi/build-gold.js`');
  process.exit(1);
}

const gold = JSON.parse(fs.readFileSync(goldFile, 'utf8'));
const quarantine = fs.existsSync(quarantineFile)
  ? JSON.parse(fs.readFileSync(quarantineFile, 'utf8'))
  : null;

console.log('\nevery harvested query is judged exactly once, and nothing is invented');

// The natural labels no longer come from regex rules — they come from scripts/search-kpi/judged/*.js,
// where each decision is an explicit per-query membership list with the content reason it was made.
// So the thing worth asserting changed: not "do the rules still fire the same way" but "is every
// harvested query accounted for, exactly once, with a target that really exists".
const harvested = JSON.parse(fs.readFileSync(path.join(DATA, 'natural-queries.json'), 'utf8'));
const judgedDir = path.join(KPI, 'judged');
const decided = new Map();
const invented = [];

for (const file of fs.readdirSync(judgedDir).filter((f) => f.endsWith('.js')).sort()) {
  const mod = require(path.join(judgedDir, file));

  for (const [target, topic, list] of mod.positive || []) {
    for (const q of list) {
      if (!decided.has(q)) decided.set(q, []);
      decided.get(q).push(`${file} + ${topic} -> ${target}`);
    }
  }
  for (const [why, list] of mod.negative || []) {
    for (const q of list) {
      if (!decided.has(q)) decided.set(q, []);
      decided.get(q).push(`${file} - ${why}`);
    }
  }
}

const harvestedSet = new Set(harvested);

for (const q of decided.keys()) if (!harvestedSet.has(q)) invented.push(q);

const twice = [...decided.entries()].filter(([, w]) => w.length > 1);
const unjudged = harvested.filter((q) => !decided.has(q));

if (invented.length) {
  fail(`${invented.length} judged quer(ies) are not in the harvest — mistyped: ${invented.slice(0, 5).join(', ')}`);
} else if (twice.length) {
  fail(`${twice.length} quer(ies) judged twice, e.g. "${twice[0][0]}"\n        ${twice[0][1].join('\n        ')}`);
} else if (unjudged.length) {
  fail(`${unjudged.length} harvested quer(ies) have no decision: ${unjudged.slice(0, 5).join(', ')}`);
} else {
  pass(`all ${harvested.length} harvested queries decided exactly once, none invented`);
}

// The other two query populations are covered the same way, and for the same reason. `judged/
// question.js` and `judged/intent.js` are hand-written lists of one case per line, so the failure
// mode is a query going missing from the set — which does not look like a failure, it just makes the
// measurement smaller. These two JSON files are the population of record: question-queries.json is
// the assistant's 115 phrasings, intent-queries.json the 19 calls a real agent made while building
// an app, along with what two rankers returned for each at the time. Asserting coverage is what
// keeps them inputs rather than souvenirs.
const covers = (label, file, judgedFile, exported) => {
  const raw = JSON.parse(fs.readFileSync(path.join(DATA, file), 'utf8'));
  const want = new Set(raw.queries.map((c) => c.query));
  const have = new Set(require(path.join(judgedDir, judgedFile))[exported].map((c) => c[0]));
  const gone = [...want].filter((q) => !have.has(q));
  const extra = [...have].filter((q) => !want.has(q));

  if (gone.length || extra.length) {
    fail(`judged/${judgedFile} does not cover ${file} — ${gone.length} missing, ${extra.length} not in it`
      + (gone.length ? `\n        missing: ${gone.slice(0, 3).join(' | ')}` : '')
      + (extra.length ? `\n        invented: ${extra.slice(0, 3).join(' | ')}` : ''));
  } else {
    pass(`all ${want.size} ${label} queries are judged, none invented`);
  }
};

covers('chat-shaped', 'question-queries.json', 'question.js', 'QUESTION');
covers('agent search_docs', 'intent-queries.json', 'intent.js', 'INTENT');

console.log('\nthe label set is self-consistent');

const problems = integrity(gold, quarantine);

if (problems.length) {
  fail(`${problems.length} integrity problem(s) in the label set:`);
  for (const line of problems.slice(0, 12)) console.error(`        ${line}`);
} else {
  pass(`${gold.queries.length} labels: no duplicates, no gold/quarantine overlap, no self-referencing also`);
}

const stamp = fingerprint(gold.queries);

if (gold.fingerprint !== stamp) {
  fail(`gold.json says its fingerprint is ${gold.fingerprint}, but its own labels hash to ${stamp}`
    + ' — the file was hand-edited without re-stamping');
} else {
  pass(`fingerprint ${stamp} matches the labels in the file`);
}

// The committed file has to be what the rules produce. Re-judging in-process rather than shelling
// out, so this cannot be defeated by a stale build.
console.log('\nthe committed labels are what build-gold.js assembles');

// gold.json is generated. If it has drifted from the decisions in judged/, the measured labels are
// not the reviewed labels.
const rebuilt = execFileSync(process.execPath, [path.join(KPI, 'build-gold.js')], { encoding: 'utf8' });
const rebuiltStamp = (rebuilt.match(/fingerprint ([0-9a-f]{12})/) || [])[1];

if (rebuiltStamp !== stamp) {
  fail(`re-assembling produces ${rebuiltStamp}, but gold.json holds ${stamp}`
    + ' — run `node scripts/search-kpi/build-gold.js` and review the diff');
} else {
  pass('re-assembling from judged/ reproduces the committed label set exactly');
}

if (labelsOnly) {
  console.log(`\n${failures ? `${failures} failure(s)` : 'all label checks passed'}\n`);
  process.exit(failures ? 1 : 0);
}

// ---- everything below needs a built index ---------------------------------
const { load, evaluate, summarise } = require(path.join(KPI, 'lib', 'harness.js'));

console.log('\nevery labelled page is in the built index');

const ranker = load(null);
const known = new Set();

// A record is addressable both by its own url and by the page it sits on, because a section record
// carries a #fragment and a label may legitimately name either. Stripping the fragment here was
// harmless while every target was a whole page; it silently rejects every anchored target.
const remember = (url) => { known.add(String(url)); known.add(String(url).split('#')[0]); };
for (const record of ranker.state.t1.records) remember(record.u);
for (const record of (ranker.state.x1 ? ranker.state.x1.records : [])) {
  remember(record.u);
}

const missing = new Set();

for (const testCase of gold.queries) {
  for (const url of [testCase.target, ...(testCase.also || [])]) {
    if (!known.has(url)) missing.add(url);
  }
}

if (missing.size) {
  fail(`${missing.size} labelled page(s) are not in the index: ${[...missing].slice(0, 8).join(', ')}`);
} else {
  pass(`${known.size} indexed pages cover every target and every also`);
}

console.log('\nthe KPI clears its floors');

// Score the headline set. `seo` is measured by gold.js and reported there; it reads ~19 points
// above everything else, so folding 246 of it into the floors would let the site's real weak spots
// regress behind one page that always wins.
const scored = gold.queries.filter((c) => c.src !== 'seo');
const results = evaluate(ranker, scored);
const micro = summarise(results);

// Macro over pooled groups, the same way gold.js reports it — a floor on a different aggregation
// than the headline would be a floor on a number nobody reads.
const MIN_TOPIC = 5;
const byTopic = new Map();

for (const result of results) {
  if (!byTopic.has(result.topic)) byTopic.set(result.topic, []);
  byTopic.get(result.topic).push(result);
}

const groups = new Map();

for (const [topic, list] of byTopic) {
  const key = list.length >= MIN_TOPIC ? topic : 'misc';

  if (!groups.has(key)) groups.set(key, []);
  groups.get(key).push(...list);
}

const groupP1 = [...groups.values()].map((list) => summarise(list).p1);
const p1Macro = groupP1.reduce((a, b) => a + b, 0) / groupP1.length;

const floor = (label, value, min) => {
  if (value + 1e-9 < min) {
    fail(`${label} ${value.toFixed(1)}% is below the committed floor ${min.toFixed(1)}%`);
  } else {
    pass(`${label} ${value.toFixed(1)}%  (floor ${min.toFixed(1)}%)`);
  }
};

floor('P@1 macro', p1Macro, FLOOR.p1Macro);
floor('P@1 micro', micro.p1, FLOOR.p1Micro);
floor('recall@6 micro', micro.top6, FLOOR.recall6Micro);

const intent = summarise(results.filter((r) => r.src === 'intent'));

floor('intent recall@6', intent.top6, FLOOR.intentRecall6);

const seo = summarise(evaluate(ranker, gold.queries.filter((c) => c.src === 'seo')));

floor('seo P@1 (held out of the headline, still gated)', seo.p1, FLOOR.seoP1);

const reach = results.filter((r) => r.mustReach);

if (reach.length) {
  const inSix = reach.filter((r) => r.mustReachRank >= 1 && r.mustReachRank <= 6).length;

  floor('reference page in top 6', (inSix / reach.length) * 100, FLOOR.reachTop6);
}

if (micro.targetUnreachable > FLOOR.targetUnreachable + 1e-9) {
  fail(`${micro.targetUnreachable.toFixed(1)}% of targets are never returned at all, above the `
    + `${FLOOR.targetUnreachable.toFixed(1)}% ceiling — that is an indexing regression, not a ranking one`);
} else {
  pass(`targets never returned ${micro.targetUnreachable.toFixed(1)}%  (ceiling ${FLOOR.targetUnreachable.toFixed(1)}%)`);
}

if (failures) {
  console.error(`\n${failures} KPI check(s) failed.`);
  console.error('A floor is a tripwire, not a target: if the change is deliberate, move the floor in');
  console.error('scripts/check-kpi.js and say why in the commit message.\n');
  process.exit(1);
}

console.log(`\nall KPI checks passed — ${gold.queries.length} labels, ${groups.size} macro groups\n`);
