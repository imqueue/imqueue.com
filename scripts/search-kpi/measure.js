#!/usr/bin/env node
// measure.js — THE TRIPWIRE, not the KPI. `npm run kpi` (gold.js) is the KPI.
//
//   node scripts/search-kpi/measure.js                    the artificial set
//   node scripts/search-kpi/measure.js --index DIR        measure a snapshot instead
//   node scripts/search-kpi/measure.js --worst 40         list the worst misses
//   node scripts/search-kpi/measure.js --json FILE        write the full result for diffing
//   node scripts/search-kpi/measure.js --compare FILE     diff against an earlier --json run
//
// WHAT IT MEASURES, AND WHY IT IS NOT A RELEVANCE NUMBER
//
// The artificial set is 10,000 queries generated from the site's OWN titles, headings, `keywords`
// front matter, summaries and prose, so ground truth is free: a query built from page P should
// return P. That also makes it optimistic by construction — every query uses the site's vocabulary,
// which is the one thing a real reader does not have. It cannot measure relevance, so it is not
// asked to. A failure here means a page cannot be found by its own title, which is an INDEXING
// defect, not a weighting one.
//
// It is also why nothing may be tuned against it. Flattening every element weight to one value —
// destroying the URL > keywords > title > header > emphasis > body hierarchy on purpose — moves this
// set and the real one in OPPOSITE directions, because a third of it is generated from prose and so
// raising body weight helps it by construction. A set generated from content rewards whatever scores
// that content.
//
//   micro     mean over every query.
//   macro     mean over generator BUCKETS, each weighted equally.
//   strict    the exact #anchor must match, not just the page.
//   typos     499 one-transposed-key variants, reported apart from all of the above.

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { load, evaluate, summarise, table } = require('./lib/harness.js');
const { halves } = require('./lib/split.js');

const DATA = path.join(__dirname, 'data');

const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);

  return i === -1 ? fallback : process.argv[i + 1];
};

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

// This file used to run a NATURAL set beside the artificial one, and that half is gone rather than
// demoted. Its labels were LISTS of acceptable pages, so a ranker that returned the topic hub above
// the article the hub lists scored a perfect 100: the set read 92% and had nothing left to say.
// Worse than saturated — asked to judge the three 2026-08-07 fixes it called them a SIGNIFICANT
// regression (-2.59 micro, p < 0.05), and resolving that query by query found 67 of the moved
// queries were quarantined negatives that should never have been scored, 31 were gold-set queries
// that got BETTER, 19 were content gaps, and 4 were real. A set that is 96% artefact on the one
// change it was asked to judge does not get to keep a floor. Its 3,367 queries were re-judged from
// page content into the gold set instead; see judged/ and gold.js.
function main() {
  const ranker = load(arg('--index', null));
  const out = { generated: arg('--stamp', ''), sets: {} };

  const section = (title) => `\n${'='.repeat(74)}\n${title}\n${'='.repeat(74)}`;

  // ---- the artificial tripwire --------------------------------------------
  const artificialFile = path.join(DATA, 'artificial-queries.json');

  // Said out loud rather than skipped in silence. This file is gitignored (it is 1.2 MB and
  // regenerates exactly), so on a fresh checkout it is absent — and half a KPI printed
  // without comment reads like the whole one.
  if (!fs.existsSync(artificialFile)) {
    console.log(section('ARTIFICIAL QUERIES: NOT GENERATED'));
    console.log(
      'scripts/search-kpi/data/artificial-queries.json is missing, so nothing was measured.\n' +
      'It is gitignored by design; generate it with:\n\n' +
      '    npm run kpi:search:gen\n'
    );
  }

  if (fs.existsSync(artificialFile)) {
    const data = JSON.parse(fs.readFileSync(artificialFile, 'utf8'));
    const results = evaluate(ranker, data.main);
    const byBucket = macro(results, (r) => r.bucket);
    const strict = evaluate(ranker, data.main, { strict: true });

    console.log(section('ARTIFICIAL QUERIES (generated from the site\'s own content)'));
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

  // ---- worst misses -------------------------------------------------------
  const limit = Number(arg('--worst', 0));

  if (limit && out.sets.artificial) {
    const data = JSON.parse(fs.readFileSync(artificialFile, 'utf8'));

    console.log(section(`WORST ARTIFICIAL MISSES (${limit})`));
    console.log(worst(evaluate(ranker, data.main), limit));
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
    const b = before.sets && before.sets.artificial;
    const a = out.sets.artificial;

    console.log(section(`COMPARED WITH ${compare}`));

    if (!b || !a) {
      console.log('  one of the two runs has no artificial set — nothing to compare');
    } else {
      const delta = a.summary.accuracy - b.summary.accuracy;
      const macroDelta = a.macro - b.macro;

      console.log(
        `  artificial  micro ${b.summary.accuracy.toFixed(1)}% -> ${a.summary.accuracy.toFixed(1)}% ` +
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
