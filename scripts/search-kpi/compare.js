// compare.js — the working tree's ranker against another commit's, query by query.
//
//   node scripts/search-kpi/compare.js [--ref HEAD] [--dir _site-org] [--worst 40]
//
// `--ref` is a commit in the ranker's own repository (the vendor/search-ranker submodule), so
// `HEAD` means the pinned ranker and the working tree means your unstaged edits to it.
//
// WHY, and it is the whole reason this file exists: an aggregate can hold still while the results
// churn underneath it, and it has hidden a real regression twice.
//
//   * A change that read -0.2 on natural macro turned out to be three named queries moving, one of
//     them out of the top ten. The macro alone looked like rounding.
//   * A change that read 0.0 on natural — genuinely unmoved — was simultaneously dropping 13
//     artificial queries, two of them from #1 to #11 and #10 to #24. It was reverted on the
//     strength of this list, and nothing in measure.js's output would have objected.
//
// So: never judge a ranker change by the summary. Read who won and who lost.
//
// Both rankers are loaded in ONE process over ONE prepared corpus, so the only variable is the
// code. The baseline comes out of git rather than a hand-kept copy, which means it cannot drift
// from what it claims to be.
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const { load, baseline, page, accuracyFor, ndcgFor } = require('./lib/harness');
const { verdict } = require('./lib/stats.js');

const ROOT = path.join(__dirname, '..', '..');

// `--ref` names a commit in the RANKER's repository, not this one. The ranker is a submodule
// (github.com/imqueue/search-ranker), so its history is not in this repo's history at all and
// `git show HEAD:...` here would resolve to whatever this repo's HEAD says — which for a
// submodule path is the pinned SHA, not a file. Extraction therefore runs with cwd = the
// submodule, and `HEAD` means "the ranker commit currently checked out".
//
// It is harness.baseline() that does it, not a copy here: this file grew its own extractor and
// so did two others, which is what harness.baseline() was factored out to end, and the copy
// here outlived the factoring. It also only knew the name `search.js` — so after the engine was
// split out on 2026-08-06 it could no longer read a modern ref at all.

const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);

  return i === -1 ? fallback : process.argv[i + 1];
};

const REF = arg('--ref', 'HEAD');
const DIR = arg('--dir', path.join(ROOT, '_site-org'));
const WORST = Number(arg('--worst', 40));

function rankOf(ranker, query, expect) {
  let hits;

  try {
    hits = ranker.search(ranker.parseQuery(query));
  } catch {
    return 0;
  }

  for (let i = 0; i < hits.length; i++) {
    if (!hits[i].external && expect.includes(page(hits[i].record.u))) {
      return i + 1;
    }
  }

  return 0; // absent
}

function main() {
  const baselineFile = baseline(REF);
  // Order matters only in that both must see the same corpus; load() prepares it per ranker, so
  // neither can be measured against a corpus the other did not have.
  const before = load(DIR, baselineFile);
  const after = load(DIR);

  const readJson = (file) => {
    const at = path.join(__dirname, 'data', file);

    return fs.existsSync(at) ? JSON.parse(fs.readFileSync(at, 'utf8')) : null;
  };
  const setOf = (file, key) => {
    const data = readJson(file);

    return data ? data[key] : null;
  };
  // FIRST, because it is the high-importance set: 19 queries really sent to search_docs while
  // building an app, where a miss means an agent invented an API rather than scrolled. It is also
  // the smallest set, so it will call almost everything unmeasured — read the moves, not the
  // average. `intent.js` is the full report; this is the regression check.
  const HIGH = new Set(['intent']);
  const sets = {
    intent: setOf('intent-queries.json', 'queries'),
    natural: setOf('natural-judged.json', 'judged'),
    artificial: setOf('artificial-queries.json', 'main'),
    // The chat-shaped set was measured only by questions.js --ref, so a comparison run reported
    // two of the three populations. It is the one that caught a real regression the other two
    // could not see, which makes leaving it out of the default comparison the wrong default.
    question: setOf('question-queries.json', 'queries'),
  };

  let dirty = false;
  let highDirty = false;

  for (const [name, cases] of Object.entries(sets)) {
    if (!cases) {
      console.log(`\n=== ${name}: SET NOT PRESENT, not measured ===`);
      continue;
    }

    const better = [];
    const worse = [];
    // Per-query deltas, INCLUDING the zeros — see lib/stats.js. `byTopic` carries the same deltas
    // grouped, because the headline number is a macro average and a claim about a macro has to be
    // tested over topics rather than over queries.
    const deltas = [];
    const ndcgDeltas = [];
    const byTopic = new Map();

    for (const testCase of cases) {
      const expect = (Array.isArray(testCase.expect) ? testCase.expect : [testCase.expect])
        .map(page);
      const b = rankOf(before, testCase.query, expect);
      const a = rankOf(after, testCase.query, expect);
      const delta = accuracyFor(a) - accuracyFor(b);
      const topic = testCase.label || testCase.bucket || '(none)';

      deltas.push(delta);
      ndcgDeltas.push((ndcgFor(a, 1, 1) - ndcgFor(b, 1, 1)) * 100);

      if (!byTopic.has(topic)) byTopic.set(topic, []);
      byTopic.get(topic).push(delta);

      if (delta > 0) better.push({ ...testCase, b, a });
      if (delta < 0) worse.push({ ...testCase, b, a });
    }

    // One number per topic, so each topic weighs the same as every other — the macro definition.
    const topicDeltas = [...byTopic.values()]
      .map((list) => list.reduce((x, y) => x + y, 0) / list.length);

    const micro = verdict(deltas);
    const macro = verdict(topicDeltas);

    const flag = HIGH.has(name) ? '  [HIGH IMPORTANCE]' : '';

    console.log(`\n=== ${name} (n = ${cases.length}, ${byTopic.size} topics) vs ${REF} ===${flag}`);
    console.log(`  accuracy micro   ${micro.line}`);
    console.log(`  accuracy macro   ${macro.line}`);
    console.log(`  nDCG@10 micro    ${verdict(ndcgDeltas).line}`);

    // The honest reading, spelled out because "unmeasured" is the result most likely to be
    // misread as "safe". It means this set cannot tell, not that nothing happened.
    if (!micro.significant && !macro.significant && (better.length || worse.length)) {
      console.log(`  → ${better.length + worse.length} queries moved and neither average clears `
        + 'zero: this change is UNMEASURED on this set, not neutral.');
    }

    if (!worse.length) {
      continue;
    }

    dirty = true;
    if (HIGH.has(name)) highDirty = true;

    console.log(`\n  WORSE (before -> after, 0 = absent from the result set):`);

    worse
      .sort((x, y) => (accuracyFor(y.b) - accuracyFor(y.a)) - (accuracyFor(x.b) - accuracyFor(x.a)))
      .slice(0, WORST)
      .forEach((w) => console.log(`    ${String(w.b).padStart(3)} -> ${String(w.a).padStart(3)}  `
        + `${w.query.slice(0, 52).padEnd(52)} [${w.label || w.bucket}]`));

    if (worse.length > WORST) {
      console.log(`    … and ${worse.length - WORST} more (pass --worst N)`);
    }
  }

  // Not an exit failure: a change that trades some queries for more of others can still be right,
  // and only a person can decide that. This is a flag, not a verdict.
  if (highDirty) {
    console.log('\nA HIGH IMPORTANCE query got worse. On the intent set that is an agent losing the');
    console.log('page it needed to avoid inventing an API — a stronger objection than the same move');
    console.log('on any other set. Run `npm run kpi:intent` for the full picture before keeping it.');
  } else if (dirty) {
    console.log('\nSome queries got worse. Read them before keeping the change.');
  } else {
    console.log('\nNo query got worse.');
  }
}

main();
