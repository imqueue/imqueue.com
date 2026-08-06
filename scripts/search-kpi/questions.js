#!/usr/bin/env node
// questions.js — the third KPI set: chat-shaped questions.
//
//   node scripts/search-kpi/questions.js [--dir _site-org] [--worst 20] [--ref <commit>] [--json]
//
// WHY A THIRD SET EXISTS, and it is not a nice-to-have. The other two cover two query
// shapes and both were blind to a third:
//
//   * artificial-queries.json  — identifiers and identifier fragments, generated from
//                                the index. What an agent sends when it knows a name.
//   * natural-queries.json     — Google autocomplete completions. Keyword-shaped, 2–5
//                                words, no question words: `nodejs rpc framework`.
//   * question-queries.json    — THIS. "how do I make a method callable from another
//                                service?" — a whole spoken question, which is what a
//                                developer types at an assistant and therefore what an
//                                assistant sends to search_docs.
//
// The gap was not theoretical. The site ranker measured recall@6 99.5% on the agent-shaped
// set and unchanged on the natural set, and on this shape it scored 65.8% against the
// 73.3% of the ranker it replaced — a regression neither existing set could see. It
// surfaced only because @imqueue/mcp's smoke test happens to hard-code two such questions.
//
// The failure mode it measures: a long question is mostly words the corpus shares
// ("how", "do", "I", "a", "service", "imqueue"), so the ONE discriminating word has to
// carry it. When it does not, question-shaped records win on the question TEMPLATE:
// `rpc.expose` scored 1020 and ranked #1 for `expose`, and 88 and #108 for "How do I
// expose a method on an @imqueue service?".
//
// HOW THE LABELS ARE TRUSTWORTHY, which is the whole difficulty with a generated set:
//
//  1. Written from the PAGE INVENTORY, never from a ranker's output — the same rule
//     judge-natural.js states for the natural set. A label derived from what the ranker
//     returned would make the metric agree with the ranker by construction.
//  2. Validated. Every `expect` URL must exist in the built index, and questions.js
//     FAILS if one does not. A renamed page is then a loud error rather than a quiet
//     zero that reads as a ranking regression.
//  3. Committed, unlike artificial-queries.json. That set is regenerated exactly from
//     the index plus a fixed seed, so committing it would duplicate its input. An
//     assistant's phrasings cannot be reproduced from a seed, so the file IS the record.
//  4. Macro-averaged by topic. 17 topics, and `cli` alone has 16 queries — without the
//     macro, improving one area could carry the number while the rest rotted.
//
// A LIMIT worth knowing: the harness scores `!hit.external`, so a question whose real
// answer is on imqueue.com cannot score here and none are included. The commercial half
// is asserted instead by scripts/check-search-ranking.js, which is the right shape for it
// — three named queries that must reach the commercial edition, not an average.

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const { load, baseline, evaluate, summarise, table, accuracyFor } = require('./lib/harness');
const { halves } = require('./lib/split.js');
const { verdict } = require('./lib/stats.js');

const ROOT = path.join(__dirname, '..', '..');
const FILE = path.join(__dirname, 'data', 'question-queries.json');

const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);

  return i === -1 ? fallback : process.argv[i + 1];
};

const DIR = arg('--dir', path.join(ROOT, '_site-org'));
const WORST = Number(arg('--worst', 20));
const REF = arg('--ref', null);

/**
 * Every expected page must exist. Without this the set decays silently: a renamed page
 * scores 0 for ever and reads as a ranker that got worse.
 */
function validate(queries, ranker) {
  const known = new Set();

  for (const record of ranker.state.t1.records) {
    known.add(String(record.u).split('#')[0]);
  }
  // Pages carry their own records, but a page that exists ONLY as prose sections (no
  // page record) is still a legitimate target, so accept the section index's pages too.
  for (const page of ranker.state.t2.pages) {
    known.add(String(page[0]).split('#')[0]);
  }

  const bad = [];

  for (const c of queries) {
    for (const url of c.expect) {
      if (!known.has(url)) bad.push(`${url}   (expected by "${c.query}")`);
    }
  }

  if (bad.length) {
    console.error(`FAIL  ${bad.length} expected page(s) are not in the index:\n`);
    for (const line of bad) console.error(`  ${line}`);
    console.error(
      '\nEither the page moved — update data/question-queries.json — or the index was built\n'
      + 'from a stale tree. This is a hard failure on purpose: an unresolvable label scores 0\n'
      + 'for ever and looks exactly like a ranking regression.',
    );
    process.exit(1);
  }
}

/** Equal weight per topic, so no single area can carry the score. */
function macro(results) {
  const byTopic = new Map();

  for (const r of results) {
    if (!byTopic.has(r.label)) byTopic.set(r.label, []);
    byTopic.get(r.label).push(r);
  }

  const rows = [...byTopic.entries()]
    .map(([label, rs]) => ({
      label,
      n: rs.length,
      accuracy: rs.reduce((s, r) => s + r.accuracy, 0) / rs.length,
      top6: (rs.filter((r) => r.position >= 1 && r.position <= 6).length / rs.length) * 100,
    }))
    .sort((a, b) => a.accuracy - b.accuracy);

  return {
    topics: rows.length,
    accuracy: rows.reduce((s, r) => s + r.accuracy, 0) / rows.length,
    top6: rows.reduce((s, r) => s + r.top6, 0) / rows.length,
    rows,
  };
}

function main() {
  if (!fs.existsSync(FILE)) {
    console.error(`${path.relative(ROOT, FILE)} is missing.`);
    process.exit(1);
  }

  const data = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  const ranker = load(DIR);

  validate(data.queries, ranker);

  const results = evaluate(ranker, data.queries);
  const micro = summarise(results);
  const byTopic = macro(results);

  console.log(`\nQUESTION SET — chat-shaped questions (n = ${data.queries.length}, `
    + `${byTopic.topics} topics, built ${data.built})\n`);
  console.log(table('micro (every query)', micro));
  console.log(`\nmacro (equal weight per topic)`);
  console.log(`  accuracy         ${byTopic.accuracy.toFixed(1)}%`);
  console.log(`  recall@6         ${byTopic.top6.toFixed(1)}%`);

  // 115 questions over 18 topics is the smallest of the three sets, so the halves are small and
  // the gap is noisy. Printed anyway: this is the set whose labels were written most recently and
  // therefore the one most exposed to having been written around what the ranker already did.
  const { fit, holdout } = halves(results, (r) => r.label);

  console.log('\nfit / holdout (macro, split by topic)');
  console.log(`  fit      ${fit.accuracy.toFixed(1)}%  (${fit.topics} topics, n = ${fit.n})`);
  console.log(`  holdout  ${holdout.accuracy.toFixed(1)}%  (${holdout.topics} topics, n = ${holdout.n})`);

  console.log('\n  weakest topics');
  for (const row of byTopic.rows.slice(0, 8)) {
    console.log(`    ${row.label.padEnd(20)} n=${String(row.n).padStart(2)}  `
      + `acc ${row.accuracy.toFixed(1).padStart(5)}%  recall@6 ${row.top6.toFixed(0).padStart(3)}%`);
  }

  if (REF) {
    const before = evaluate(load(DIR, baseline(REF)), data.queries);
    const beforeBy = new Map(before.map((r) => [r.query, r]));
    let better = 0;
    let worse = 0;
    const moved = [];

    for (const r of results) {
      const b = beforeBy.get(r.query);

      if (!b) continue;
      if (r.accuracy > b.accuracy) better++;
      if (r.accuracy < b.accuracy) worse++;
      if (r.accuracy !== b.accuracy) moved.push({ q: r.query, from: b.position, to: r.position });
    }

    const beforeMacro = macro(before);
    // Per-query and per-topic deltas, tested. 115 questions is a small set and it will call most
    // real improvements unmeasured — which is the truth about a set this size, and better than a
    // point estimate that reads as a result.
    const deltas = [];
    const byTopicDelta = new Map();

    for (const r of results) {
      const b = beforeBy.get(r.query);

      if (!b) continue;

      const delta = r.accuracy - b.accuracy;

      deltas.push(delta);

      if (!byTopicDelta.has(r.label)) byTopicDelta.set(r.label, []);
      byTopicDelta.get(r.label).push(delta);
    }

    const topicDeltas = [...byTopicDelta.values()]
      .map((list) => list.reduce((x, y) => x + y, 0) / list.length);

    console.log(`\nvs ${REF}`);
    console.log(`  macro accuracy   ${beforeMacro.accuracy.toFixed(1)}% -> ${byTopic.accuracy.toFixed(1)}%`);
    console.log(`  recall@6         ${beforeMacro.top6.toFixed(1)}% -> ${byTopic.top6.toFixed(1)}%`);
    console.log(`  per query        ${better} better, ${worse} worse, ${results.length - better - worse} unchanged`);
    console.log(`  micro delta      ${verdict(deltas).line}`);
    console.log(`  macro delta      ${verdict(topicDeltas).line}`);

    // Never judge by the aggregate — the lesson compare.js exists for.
    for (const m of moved.slice(0, WORST)) {
      const dir = accuracyFor(m.to) > accuracyFor(m.from) ? 'BETTER' : 'WORSE ';
      console.log(`    ${dir}  ${String(m.from || '-').padStart(3)} -> ${String(m.to || '-').padStart(3)}  ${m.q}`);
    }
  }

  const missing = results.filter((r) => r.position === 0);

  if (missing.length) {
    console.log(`\n  ABSENT from the first 50 (${missing.length}/${results.length})`);
    for (const r of missing.slice(0, WORST)) {
      console.log(`    ${r.query}`);
      console.log(`        wanted ${r.expect.join(' | ')}`);
      console.log(`        got    ${r.top || '(nothing)'}`);
    }
  }

  const worst = results
    .filter((r) => r.position > 6)
    .sort((a, b) => b.position - a.position)
    .slice(0, WORST);

  if (worst.length) {
    console.log(`\n  OUTSIDE THE TOP 6 (${results.filter((r) => r.position > 6).length}/${results.length})`);
    for (const r of worst) {
      console.log(`    #${String(r.position).padStart(3)}  ${r.query}`);
      console.log(`          got #1 ${r.top}`);
    }
  }

  if (process.argv.includes('--json')) {
    console.log(JSON.stringify({ micro, macro: byTopic, results }, null, 2));
  }

  console.log('');
}

main();
