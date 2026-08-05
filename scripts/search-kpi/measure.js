#!/usr/bin/env node
// measure.js — the KPI. Runs both query sets through the real ranker and prints the numbers.
//
//   node scripts/search-kpi/measure.js                    both sets, summary
//   node scripts/search-kpi/measure.js --index DIR        measure a snapshot instead
//   node scripts/search-kpi/measure.js --worst 40         list the worst misses
//   node scripts/search-kpi/measure.js --json FILE        write the full result for diffing
//   node scripts/search-kpi/measure.js --compare FILE     diff against an earlier --json run
//
// THREE AVERAGES, AND WHY THE HEADLINE IS THE MACRO ONE
//
// The natural set is skewed: Google returns far more completions for "mcp server" than for
// "back-pressure", so a third of the harvest is about MCP. A plain mean over queries
// therefore mostly reports how well MCP pages rank, and a change that helped MCP alone
// would look like a site-wide win.
//
//   micro     mean over every query. What a visitor experiences, given this query mix.
//   macro     mean over TOPICS, each weighted equally. What the site does across subjects,
//             and the number to watch when tuning, because it cannot be gamed by the one
//             topic that happens to dominate the sample.
//   balanced  micro over a set capped at CAP queries per topic. A cross-check on macro.
//
// A regression that shows in micro but not macro is a change to one popular topic. One that
// shows in macro but not micro is a change to the long tail. Both are worth knowing.

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { load, evaluate, summarise, table, median } = require('./lib/harness.js');
const { halves } = require('./lib/split.js');

const DATA = path.join(__dirname, 'data');
const CAP = 40;

const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);

  return i === -1 ? fallback : process.argv[i + 1];
};

const has = (name) => process.argv.includes(name);

function macro(results, keyOf) {
  const groups = new Map();

  for (const result of results) {
    const key = keyOf(result);

    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(result);
  }

  const rows = [...groups.entries()].map(([key, list]) => ({
    key,
    n: list.length,
    accuracy: list.reduce((a, r) => a + r.accuracy, 0) / list.length,
    top1: (list.filter((r) => r.position === 1).length / list.length) * 100,
    absent: (list.filter((r) => r.position === 0).length / list.length) * 100,
  }));

  return {
    rows: rows.sort((a, b) => a.accuracy - b.accuracy),
    accuracy: rows.reduce((a, r) => a + r.accuracy, 0) / rows.length,
    topics: rows.length,
  };
}

function balanced(results, keyOf, cap) {
  const seen = new Map();

  return results.filter((result) => {
    const key = keyOf(result);
    const n = (seen.get(key) || 0) + 1;

    seen.set(key, n);

    return n <= cap;
  });
}

/**
 * The fit/holdout line. Printed by default, not behind a flag, because a training score that
 * looks like a measurement is the failure this exists to prevent — and a flag nobody passes
 * prevents nothing. See lib/split.js for why the cut is by topic.
 */
function splitLine(results, keyOf) {
  const { fit, holdout } = halves(results, keyOf);
  const gap = fit.accuracy - holdout.accuracy;

  return `\nfit / holdout (macro, split by topic — every constant was tuned against the whole set)\n`
    + `  fit      ${fit.accuracy.toFixed(1)}%  (${fit.topics} topics, n = ${fit.n})\n`
    + `  holdout  ${holdout.accuracy.toFixed(1)}%  (${holdout.topics} topics, n = ${holdout.n})\n`
    + `  gap      ${gap >= 0 ? '+' : ''}${gap.toFixed(1)} pts`
    + `${Math.abs(gap) > 5 ? '   ← large; suspect fitting to the sets' : ''}`;
}

function topicTable(label, rows, limit) {
  const lines = [`${label}`];

  for (const row of rows.slice(0, limit)) {
    lines.push(
      `  ${row.accuracy.toFixed(1).padStart(6)}%  #1 ${row.top1.toFixed(0).padStart(3)}%  ` +
      `absent ${row.absent.toFixed(0).padStart(3)}%  n=${String(row.n).padStart(4)}  ${row.key}`
    );
  }

  return lines.join('\n');
}

function worst(results, limit) {
  const lines = [];
  const misses = results
    .filter((r) => r.position !== 1)
    .sort((a, b) => a.accuracy - b.accuracy || String(a.query).localeCompare(String(b.query)));

  for (const result of misses.slice(0, limit)) {
    const expect = (Array.isArray(result.expect) ? result.expect : [result.expect]).join(' | ');

    lines.push(
      `  ${String(result.position || '—').padStart(3)}  "${result.query}"\n` +
      `        wanted ${expect}\n` +
      `        got    ${result.top || '(nothing)'}`
    );
  }

  return lines.join('\n');
}

function main() {
  const ranker = load(arg('--index', null));
  const out = { generated: arg('--stamp', ''), sets: {} };

  const section = (title) => `\n${'='.repeat(74)}\n${title}\n${'='.repeat(74)}`;

  // ---- step 1: natural ----------------------------------------------------
  const judgedFile = path.join(DATA, 'natural-judged.json');

  if (fs.existsSync(judgedFile)) {
    const data = JSON.parse(fs.readFileSync(judgedFile, 'utf8'));
    const results = evaluate(ranker, data.judged);
    const byTopic = macro(results, (r) => r.label);
    const balancedResults = balanced(results, (r) => r.label, CAP);

    console.log(section('STEP 1 — NATURAL QUERIES (Google autocomplete, judged by hand-written topic rules)'));
    console.log(
      `harvested ${data.judged.length + data.unmapped.length + data.outOfScope.length}, ` +
      `scored ${data.judged.length}, ` +
      `${data.unmapped.length} on-topic-but-unmapped, ${data.outOfScope.length} out of scope\n`
    );
    console.log(table('micro (every query)', summarise(results)));
    console.log(`\nmacro (${byTopic.topics} topics, equal weight)`);
    console.log(`  accuracy (KPI)   ${byTopic.accuracy.toFixed(1)}%`);
    console.log(`\nbalanced (max ${CAP} per topic, n = ${balancedResults.length})`);
    console.log(`  accuracy (KPI)   ${summarise(balancedResults).accuracy.toFixed(1)}%`);
    console.log(splitLine(results, (r) => r.label));
    console.log(`\n${topicTable('weakest topics', byTopic.rows, 15)}`);
    console.log(`\n${topicTable('strongest topics', [...byTopic.rows].reverse(), 8)}`);

    out.sets.natural = {
      summary: summarise(results),
      macro: byTopic.accuracy,
      balanced: summarise(balancedResults).accuracy,
      topics: byTopic.rows,
      results: results.map((r) => ({ q: r.query, p: r.position, l: r.label })),
    };
  }

  // ---- step 2: artificial -------------------------------------------------
  const artificialFile = path.join(DATA, 'artificial-queries.json');

  // Said out loud rather than skipped in silence. This file is gitignored (it is 1.2 MB and
  // regenerates exactly), so on a fresh checkout it is absent — and half a KPI printed
  // without comment reads like the whole one.
  if (!fs.existsSync(artificialFile)) {
    console.log(section('STEP 2 — ARTIFICIAL QUERIES: NOT GENERATED'));
    console.log(
      'scripts/search-kpi/data/artificial-queries.json is missing, so only the natural set\n' +
      'above was measured. It is gitignored by design; generate it with:\n\n' +
      '    npm run kpi:search:gen\n'
    );
  }

  if (fs.existsSync(artificialFile)) {
    const data = JSON.parse(fs.readFileSync(artificialFile, 'utf8'));
    const results = evaluate(ranker, data.main);
    const byBucket = macro(results, (r) => r.bucket);
    const strict = evaluate(ranker, data.main, { strict: true });

    console.log(section('STEP 2 — ARTIFICIAL QUERIES (generated from the site\'s own content)'));
    console.log(table('micro (every query)', summarise(results)));
    console.log(`\nmacro (${byBucket.topics} buckets, equal weight)`);
    console.log(`  accuracy (KPI)   ${byBucket.accuracy.toFixed(1)}%`);
    console.log(
      '\nstrict (the exact #anchor must match, not just the page) — the gap between this and\n' +
      'micro above is queries answered by the right page but the wrong section of it'
    );
    console.log(`  accuracy         ${summarise(strict).accuracy.toFixed(1)}%`);
    // Split by TARGET PAGE, not by generator bucket. A bucket is a query SHAPE — title-salient,
    // body-salient — and half the queries live in 7 of the 31 buckets, so a bucket split produces
    // two halves made of different shapes and reports their difference as a fitting gap: it read
    // +5.6 points on a ranker nobody had tuned against this set at all.
    //
    // The page is the right unit for the same reason the topic is for the natural set: queries
    // generated from one page are near-duplicates of each other, and near-duplicates on both
    // sides of a split make the holdout agree with the fit by construction.
    console.log(splitLine(results, (r) => String(
      Array.isArray(r.expect) ? r.expect[0] : r.expect,
    ).split('#')[0]));
    console.log(`\n${topicTable('by generator bucket', byBucket.rows, 30)}`);

    const typoResults = evaluate(ranker, data.typos);

    console.log(
      '\ntypo bucket — reported apart from every number above, because the ranker has no fuzzy\n' +
      'matching at all. This is the size of that gap, not a relevance measurement.'
    );
    console.log(table('  typos (one transposed key)', summarise(typoResults)));

    out.sets.artificial = {
      summary: summarise(results),
      macro: byBucket.accuracy,
      strict: summarise(strict).accuracy,
      buckets: byBucket.rows,
      typos: summarise(typoResults),
      results: results.map((r) => ({ q: r.query, p: r.position, l: r.bucket })),
    };
  }

  // ---- headline -----------------------------------------------------------
  if (out.sets.natural && out.sets.artificial) {
    const n = out.sets.natural;
    const a = out.sets.artificial;

    console.log(section('NATURAL vs ARTIFICIAL'));
    console.log('                       natural      artificial     gap');
    const row = (label, x, y) => console.log(
      `  ${label.padEnd(20)} ${`${x.toFixed(1)}%`.padStart(7)}      ` +
      `${`${y.toFixed(1)}%`.padStart(7)}   ${`${(y - x).toFixed(1)}`.padStart(7)} pts`
    );

    row('accuracy (micro)', n.summary.accuracy, a.summary.accuracy);
    row('accuracy (macro)', n.macro, a.macro);
    row('#1 exactly', n.summary.top1, a.summary.top1);
    row('in top 3', n.summary.top3, a.summary.top3);
    row('never found', n.summary.absent, a.summary.absent);
    row('empty result set', n.summary.zeroResults, a.summary.zeroResults);
  }

  // ---- worst misses -------------------------------------------------------
  const limit = Number(arg('--worst', 0));

  if (limit) {
    if (out.sets.natural) {
      const data = JSON.parse(fs.readFileSync(judgedFile, 'utf8'));

      console.log(section(`WORST NATURAL MISSES (${limit})`));
      console.log(worst(evaluate(ranker, data.judged), limit));
    }
    if (out.sets.artificial) {
      const data = JSON.parse(fs.readFileSync(artificialFile, 'utf8'));

      console.log(section(`WORST ARTIFICIAL MISSES (${limit})`));
      console.log(worst(evaluate(ranker, data.main), limit));
    }
  }

  // ---- persistence & comparison ------------------------------------------
  const jsonOut = arg('--json', null);

  if (jsonOut) {
    fs.writeFileSync(jsonOut, `${JSON.stringify(out)}\n`);
    console.log(`\n[kpi] wrote ${jsonOut}`);
  }

  const compare = arg('--compare', null);

  if (compare && fs.existsSync(compare)) {
    const before = JSON.parse(fs.readFileSync(compare, 'utf8'));

    console.log(section(`COMPARED WITH ${compare}`));

    for (const set of ['natural', 'artificial']) {
      if (!before.sets[set] || !out.sets[set]) continue;

      const b = before.sets[set];
      const a = out.sets[set];
      const delta = a.summary.accuracy - b.summary.accuracy;
      const macroDelta = a.macro - b.macro;

      console.log(
        `  ${set.padEnd(11)} micro ${b.summary.accuracy.toFixed(1)}% -> ${a.summary.accuracy.toFixed(1)}% ` +
        `(${delta >= 0 ? '+' : ''}${delta.toFixed(1)})   ` +
        `macro ${b.macro.toFixed(1)}% -> ${a.macro.toFixed(1)}% ` +
        `(${macroDelta >= 0 ? '+' : ''}${macroDelta.toFixed(1)})`
      );

      // Per-query movement is the useful part: an unchanged average can hide fifty queries
      // getting better and fifty getting worse, which is not a stable ranker.
      const positions = new Map(b.results.map((r) => [r.q, r.p]));
      let improved = 0;
      let worsened = 0;

      for (const result of a.results) {
        const was = positions.get(result.q);

        if (was === undefined) continue;

        const wasScore = was >= 1 && was <= 10 ? 100 - 10 * (was - 1) : 0;
        const nowScore = result.p >= 1 && result.p <= 10 ? 100 - 10 * (result.p - 1) : 0;

        if (nowScore > wasScore) improved++;
        else if (nowScore < wasScore) worsened++;
      }

      console.log(`              ${improved} queries improved, ${worsened} got worse`);
    }
  }
}

main();
