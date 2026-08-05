// harness.js — run the real ranker over a labelled query set and score it.
//
// The ranker is required directly (it exports itself when there is no `document`), so this
// measures the shipped code path, not a reimplementation of it. Indexes come from
// _site-org by default; pass a directory to measure a snapshot instead, which is what makes
// a before/after comparison meaningful while a watcher is rebuilding the tree.
//
// SCORING
//
// Position 1 = 100%, and every position below it costs 10 points, so position 11 and
// "not returned at all" both score 0. That is the user-visible truth: nobody scrolls to
// the eleventh row of a site search.
//
// Position is taken from the FLAT merged list that search() returns — what /search/ renders
// as "Everything". The dialog additionally splits results into Answers/Docs/API groups, so a
// hit at flat position 4 can be the first row of its own group there. Flat position is the
// pessimistic reading and the one that stays comparable across changes to grouping.

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..', '..');

// `rankerFile` measures a DIFFERENT copy of the ranker — a snapshot from another commit — which
// is what compare.js uses to diff two versions in one process. Left undefined it measures the
// working tree.
function load(dir, rankerFile) {
  const indexDir = dir || path.join(ROOT, '_site-org');
  const ranker = rankerFile
    ? require(rankerFile)
    : require(path.join(ROOT, 'scripts', 'lib', 'ranker.js')).requireRanker();

  const read = (name, optional) => {
    const file = path.join(indexDir, name);

    if (!fs.existsSync(file)) {
      if (optional) {
        return null;
      }

      throw new Error(`${file} is missing — run \`npm run build:org\` first`);
    }

    return JSON.parse(fs.readFileSync(file, 'utf8'));
  };

  ranker.state.t1 = ranker.prepare(read('search-index.json'));
  ranker.state.t2 = ranker.prepareSections(read('search-text.json'));

  // The PEER tiers, which this harness ignored for its first three months — and that omission is
  // the plan's own biggest risk, not a detail. imqueue.com reaches the ranker only through these,
  // so without them `pricing commercial license` scores against imqueue.org's `/license/` alone:
  // a plausible answer, from the wrong edition, with nothing anywhere reporting a problem. The
  // one question with revenue attached was the half being measured least.
  //
  // Optional, because a local `npm run build:org` produces no peer feed and that is a supported
  // state — evaluate() already scores an `external` hit as a miss, so a measurement without them
  // is pessimistic rather than wrong.
  const peerIndex = read('search-peer-index.json', true);
  const peerText = read('search-peer-text.json', true);

  ranker.state.x1 = peerIndex ? ranker.prepare(peerIndex) : null;
  ranker.state.x2 = peerText ? ranker.prepareSections(peerText) : null;

  return ranker;
}

const page = (url) => String(url).split('#')[0];

// max(0, 100 - 10*(position-1)); absent scores 0.
function accuracyFor(position) {
  return position >= 1 && position <= 10 ? 100 - 10 * (position - 1) : 0;
}

// One case = one query plus the URL(s) that would be a correct top result. `expect` may be
// a string or an array: several pages can be equally right (a topic index and the article
// it lists), and pretending otherwise would score a good answer as a miss.
function evaluate(ranker, cases, options) {
  const strict = Boolean(options && options.strict);
  const limit = (options && options.limit) || 50;
  const results = [];

  for (const testCase of cases) {
    const expected = (Array.isArray(testCase.expect) ? testCase.expect : [testCase.expect])
      .map((url) => (strict ? url : page(url)));

    let hits;

    try {
      hits = ranker.search(ranker.parseQuery(testCase.query)).slice(0, limit);
    } catch (error) {
      results.push({ ...testCase, position: 0, accuracy: 0, error: String(error.message) });
      continue;
    }

    let position = 0;

    for (let i = 0; i < hits.length; i++) {
      const url = strict ? hits[i].record.u : page(hits[i].record.u);

      if (!hits[i].external && expected.includes(url)) {
        position = i + 1;
        break;
      }
    }

    results.push({
      ...testCase,
      position,
      accuracy: accuracyFor(position),
      returned: hits.length,
      top: hits.length ? hits[0].record.u : null,
      topScore: hits.length ? Math.round(hits[0].score) : 0,
    });
  }

  return results;
}

function summarise(results) {
  const total = results.length;

  if (!total) return { total: 0 };

  const sum = (fn) => results.reduce((acc, r) => acc + fn(r), 0);
  const count = (fn) => results.filter(fn).length;

  const histogram = {};

  for (const result of results) {
    const bucket = result.position === 0 ? 'absent'
      : result.position <= 10 ? String(result.position)
        : '11+';

    histogram[bucket] = (histogram[bucket] || 0) + 1;
  }

  const ranked = results.filter((r) => r.position > 0);
  const mrr = sum((r) => (r.position ? 1 / r.position : 0)) / total;

  return {
    total,
    accuracy: sum((r) => r.accuracy) / total,
    top1: (count((r) => r.position === 1) / total) * 100,
    top3: (count((r) => r.position >= 1 && r.position <= 3) / total) * 100,
    top5: (count((r) => r.position >= 1 && r.position <= 5) / total) * 100,
    // recall@6 — the AGENT metric, and deliberately not position-decayed. search_docs returns six
    // results and an agent reads all six, so whether the page is in the set is the whole question
    // and its rank inside the set is noise. For a human the opposite holds, which is why accuracy
    // above exists too. Same runs, two readers.
    top6: (count((r) => r.position >= 1 && r.position <= 6) / total) * 100,
    top10: (count((r) => r.position >= 1 && r.position <= 10) / total) * 100,
    absent: (count((r) => r.position === 0) / total) * 100,
    mrr: mrr * 100,
    medianRank: median(ranked.map((r) => r.position)),
    zeroResults: (count((r) => r.returned === 0) / total) * 100,
  };
}

function median(values) {
  if (!values.length) return null;

  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);

  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

const pct = (value) => (value === null || value === undefined ? '   —  ' : `${value.toFixed(1)}%`);

function table(label, summary) {
  const lines = [
    `${label}  (n = ${summary.total})`,
    `  accuracy (KPI)   ${pct(summary.accuracy)}`,
    `  #1 exactly       ${pct(summary.top1)}`,
    `  in top 3         ${pct(summary.top3)}`,
    `  in top 5         ${pct(summary.top5)}`,
    `  recall@6         ${pct(summary.top6)}`,
    `  in top 10        ${pct(summary.top10)}`,
    `  never found      ${pct(summary.absent)}`,
    `  MRR              ${pct(summary.mrr)}`,
    `  median rank      ${summary.medianRank === null ? '—' : summary.medianRank}`,
    `  empty result set ${pct(summary.zeroResults)}`,
  ];

  return lines.join('\n');
}

module.exports = { load, evaluate, summarise, table, accuracyFor, page, median };
