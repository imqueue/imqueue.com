#!/usr/bin/env node
// intent.js — the fourth KPI set, and the one flagged HIGH IMPORTANCE.
//
//   node scripts/search-kpi/intent.js [--dir _site-org] [--ref <commit>] [--worst 20] [--json]
//                                     [--no-gate]
//
// WHAT MAKES IT DIFFERENT FROM THE OTHER THREE: its queries were not written to be a test.
// Each of the nineteen was really sent to `search_docs` while building a working @imqueue
// application — a car-wash fleet wired across 14 of the 17 packages — in the order it was
// sent, because the next line of code could not be written without the answer. The other
// three sets are, honestly, three ways of guessing what someone would type:
//
//   * natural-queries.json     — Google autocomplete completions. Keyword-shaped.
//   * artificial-queries.json  — identifiers generated from the index.
//   * question-queries.json    — chat-shaped questions, written by an assistant AFTER it had
//                                read the corpus. That is the flaw this set does not have:
//                                a phrasing invented by something that already knows the
//                                answer's vocabulary is not the phrasing of someone who
//                                does not.
//
// WHY IT IS HIGH IMPORTANCE, and it is not that the queries are prettier. The framework's own
// MCP instruction #1 is "Call search_docs before writing or changing @imqueue code… Never
// infer an API name or signature; the docs win over recall." An agent obeying that asks by
// DESCRIBING what it needs, because it does not yet know the name. When the description
// misses, the agent does not retry — it infers, and the inference compiles. In the build this
// set came from, seven of the fourteen packages were wired from guesses: `new Logger()` and a
// `ttl` key that do not exist in any signature. So a miss here is not a worse search
// experience, it is wrong code in someone's repository, and no other set measures it.
//
// THE DEFECT IT ISOLATES, stated as the build log states it:
//
//     Describing a symbol instead of naming it buries the symbol under prose.
//
//     expose                                               -> rpc.expose  #1
//     expose a service method so it can be called remotely -> rpc.expose  ABSENT from top 6
//
// Both rankers of 2026-08-05 answered 13 of 19 and failed on disjoint sets: the published one
// is reference-first and misses concepts, the site one is prose-first and misses signatures.
// `kind` (reference vs guide) and `attempt` (1, or 2 for a retry that had to name the package)
// are reported separately below, because the aggregate hides exactly that trade.
//
// THE GATE. `floor.recall6` in the data file is the value measured when the set was committed,
// and this script exits non-zero below it. A "high importance" label with no consequence is
// decoration; `--no-gate` is there for exploring a change, not for the suite.
//
// It runs LAST in `npm run kpi:search` on purpose: chained with `&&`, a gate failure here would
// otherwise suppress the other three sets' output, and the number that explains a regression is
// usually in one of them.

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const { load, baseline, evaluate, summarise, table, accuracyFor } = require('./lib/harness');
const { verdict } = require('./lib/stats.js');

const ROOT = path.join(__dirname, '..', '..');
const FILE = path.join(__dirname, 'data', 'intent-queries.json');

const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);

  return i === -1 ? fallback : process.argv[i + 1];
};

const DIR = arg('--dir', path.join(ROOT, '_site-org'));
const WORST = Number(arg('--worst', 20));
const REF = arg('--ref', null);
const GATE = !process.argv.includes('--no-gate');

/**
 * Every expected page must exist, or the label is unresolvable and scores 0 for ever —
 * indistinguishable from a ranking regression. Same rule as questions.js, same hard failure.
 */
function validate(queries, ranker) {
  const known = new Set();

  for (const record of ranker.state.t1.records) {
    known.add(String(record.u).split('#')[0]);
  }
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
    console.error('\nEither the page moved — update data/intent-queries.json — or the index was\n'
      + 'built from a stale tree.');
    process.exit(1);
  }
}

/** Equal weight per topic. 13 topics over 19 queries, so this is noisy — printed, not headline. */
function groupBy(results, keyOf) {
  const map = new Map();

  for (const r of results) {
    const key = String(keyOf(r));

    if (!map.has(key)) map.set(key, []);
    map.get(key).push(r);
  }

  return [...map.entries()]
    .map(([key, rs]) => ({
      key,
      n: rs.length,
      accuracy: rs.reduce((s, r) => s + r.accuracy, 0) / rs.length,
      top6: (rs.filter((r) => r.position >= 1 && r.position <= 6).length / rs.length) * 100,
      absent: rs.filter((r) => r.position === 0).length,
    }))
    .sort((a, b) => a.accuracy - b.accuracy);
}

const macroOf = (rows) => ({
  groups: rows.length,
  accuracy: rows.reduce((s, r) => s + r.accuracy, 0) / rows.length,
  top6: rows.reduce((s, r) => s + r.top6, 0) / rows.length,
});

function breakdown(title, rows) {
  console.log(`\n${title}`);
  for (const row of rows) {
    console.log(`  ${row.key.padEnd(20)} n=${String(row.n).padStart(2)}  `
      + `acc ${row.accuracy.toFixed(1).padStart(5)}%  recall@6 ${row.top6.toFixed(0).padStart(3)}%  `
      + `absent ${row.absent}`);
  }
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
  const byTopic = groupBy(results, (r) => r.label);
  const macro = macroOf(byTopic);

  console.log(`\n${'='.repeat(78)}`);
  console.log(`INTENT SET — HIGH IMPORTANCE   (n = ${data.queries.length}, ${byTopic.length} topics, `
    + `captured ${data.built})`);
  console.log(`${'='.repeat(78)}`);
  console.log('Real search_docs calls from building an app. A miss here is not a worse search');
  console.log('result — it is an agent inferring an API that does not exist, and compiling.\n');
  console.log(table('micro (every query)', micro));
  console.log(`\nmacro (equal weight per topic — ${byTopic.length} topics over ${results.length} `
    + 'queries, so noisy by construction)');
  console.log(`  accuracy         ${macro.accuracy.toFixed(1)}%`);
  console.log(`  recall@6         ${macro.top6.toFixed(1)}%`);

  // The two splits that carry the finding.
  breakdown('by page type the query needs', groupBy(results, (r) => r.kind));
  breakdown('by attempt (2 = a retry that named the package or class)',
    groupBy(results, (r) => `attempt ${r.attempt}`));

  // Retry pairs, side by side. Four cases where describing failed and naming worked; if the
  // ranker is fixed, the named attempt stops being better than the described one.
  const byQuery = new Map(results.map((r) => [r.query, r]));
  const pairs = results.filter((r) => r.retryOf && byQuery.has(r.retryOf));

  if (pairs.length) {
    console.log('\nretry pairs — described intent, then the same need with a name attached');
    for (const named of pairs) {
      const described = byQuery.get(named.retryOf);
      const shape = named.position && described.position && named.position >= described.position
        ? 'ok  ' : 'GAP ';

      console.log(`  ${shape} #${String(described.position || '-').padStart(3)} described  `
        + `-> #${String(named.position || '-').padStart(3)} named   ${named.query}`);
    }
  }

  breakdown('by topic', byTopic);

  if (REF) {
    const before = evaluate(load(DIR, baseline(REF)), data.queries);
    const beforeBy = new Map(before.map((r) => [r.query, r]));
    const deltas = [];
    const moved = [];

    for (const r of results) {
      const b = beforeBy.get(r.query);

      if (!b) continue;

      deltas.push(r.accuracy - b.accuracy);
      if (r.accuracy !== b.accuracy) moved.push({ q: r.query, from: b.position, to: r.position });
    }

    const beforeMicro = summarise(before);
    const beforeMacro = macroOf(groupBy(before, (r) => r.label));

    console.log(`\nvs ${REF}`);
    console.log(`  accuracy micro   ${beforeMicro.accuracy.toFixed(1)}% -> ${micro.accuracy.toFixed(1)}%`);
    console.log(`  accuracy macro   ${beforeMacro.accuracy.toFixed(1)}% -> ${macro.accuracy.toFixed(1)}%`);
    console.log(`  recall@6         ${beforeMicro.top6.toFixed(1)}% -> ${micro.top6.toFixed(1)}%`);
    console.log(`  never found      ${beforeMicro.absent.toFixed(1)}% -> ${micro.absent.toFixed(1)}%`);
    console.log(`  nDCG@10          ${beforeMicro.ndcg.toFixed(1)}% -> ${micro.ndcg.toFixed(1)}%`);
    // 19 queries will call almost anything unmeasured, which is the truth about a set this
    // size. It is here so the number is never read as a tested result when it is not one.
    console.log(`  per query        ${verdict(deltas).line}`);

    for (const m of moved) {
      const dir = accuracyFor(m.to) > accuracyFor(m.from) ? 'BETTER' : 'WORSE ';

      console.log(`    ${dir}  ${String(m.from || '-').padStart(3)} -> ${String(m.to || '-').padStart(3)}  ${m.q}`);
    }
  }

  const missing = results.filter((r) => r.position === 0);

  if (missing.length) {
    console.log(`\nABSENT from the first 50 (${missing.length}/${results.length}) — these are the`);
    console.log('queries an agent answered by inventing an API:');
    for (const r of missing.slice(0, WORST)) {
      console.log(`  ${r.query}`);
      console.log(`      wanted ${r.expect.join(' | ')}`);
      console.log(`      got #1 ${r.top || '(nothing)'}`);
    }
  }

  const outside = results.filter((r) => r.position > 6).sort((a, b) => b.position - a.position);

  if (outside.length) {
    console.log(`\nOUTSIDE THE TOP 6 (${outside.length}/${results.length}) — search_docs returns six,`);
    console.log('so these are invisible to an agent too:');
    for (const r of outside.slice(0, WORST)) {
      console.log(`  #${String(r.position).padStart(3)}  ${r.query}`);
      console.log(`        got #1 ${r.top}`);
    }
  }

  if (process.argv.includes('--json')) {
    console.log(JSON.stringify({ micro, macro, byTopic, results }, null, 2));
  }

  const floor = data.floor && Number(data.floor.recall6);

  if (GATE && floor && micro.top6 + 1e-9 < floor) {
    console.error(`\nFAIL  recall@6 ${micro.top6.toFixed(1)}% is below the committed floor `
      + `${floor.toFixed(1)}% for a HIGH IMPORTANCE set.`);
    console.error('      Read the ABSENT list above before deciding this is acceptable. To keep the');
    console.error('      change deliberately, move the floor in data/intent-queries.json and say why.');
    process.exit(1);
  }

  console.log('');
}

main();
