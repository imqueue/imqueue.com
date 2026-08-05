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
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const { load, page, accuracyFor } = require('./lib/harness');

const ROOT = path.join(__dirname, '..', '..');
const { RANKER_DIR } = require('../lib/ranker.js');

// `--ref` names a commit in the RANKER's repository, not this one. The ranker is a submodule
// (github.com/imqueue/search-ranker), so its history is not in this repo's history at all and
// `git show HEAD:...` here would resolve to whatever this repo's HEAD says — which for a
// submodule path is the pinned SHA, not a file. Every git call below therefore runs with
// cwd = the submodule, and `HEAD` means "the ranker commit currently checked out".

const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);

  return i === -1 ? fallback : process.argv[i + 1];
};

const REF = arg('--ref', 'HEAD');
const DIR = arg('--dir', path.join(ROOT, '_site-org'));
const WORST = Number(arg('--worst', 40));

function baselineRanker() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kpi-baseline-'));
  const file = path.join(dir, 'search.js');
  let source;

  // maxBuffer: the ranker is ~100 kB and execFileSync's default is 1 MB, so this is comfortable —
  // but it is the kind of limit that fails only after the file has grown, so it is stated.
  try {
    source = execFileSync('git', ['show', `${REF}:search.js`], {
      cwd: RANKER_DIR,
      encoding: 'utf8',
      maxBuffer: 8 * 1024 * 1024,
      // execFileSync sends the child's stderr to ours unless stdio says otherwise, so without
      // this git's own message prints BEFORE the handler below explains it — twice, out of order.
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) {
    // Both plausible causes name the same fix, and git's own message names neither: a submodule
    // checked out with `--init` but never fetched has no HEAD to show, and `git show` run against
    // a directory that is not a repository at all says only "does not exist in 'HEAD'".
    console.error(`Cannot read ranker ref \`${REF}\` from ${RANKER_DIR}\n`);
    console.error(`  git: ${String(error.stderr || error.message).trim()}\n`);
    console.error('`--ref` names a commit in the ranker submodule, not in this repo. If the\n'
      + 'submodule is not fully checked out:\n\n    git submodule update --init\n');
    process.exit(1);
  }

  fs.writeFileSync(file, source);

  return file;
}

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
  const baselineFile = baselineRanker();
  // Order matters only in that both must see the same corpus; load() prepares it per ranker, so
  // neither can be measured against a corpus the other did not have.
  const before = load(DIR, baselineFile);
  const after = load(DIR);

  const readJson = (file) => JSON.parse(fs.readFileSync(path.join(__dirname, 'data', file), 'utf8'));
  const sets = {
    natural: readJson('natural-judged.json').judged,
    artificial: readJson('artificial-queries.json').main,
  };

  let dirty = false;

  for (const [name, cases] of Object.entries(sets)) {
    const better = [];
    const worse = [];

    for (const testCase of cases) {
      const expect = (Array.isArray(testCase.expect) ? testCase.expect : [testCase.expect])
        .map(page);
      const b = rankOf(before, testCase.query, expect);
      const a = rankOf(after, testCase.query, expect);

      if (accuracyFor(a) > accuracyFor(b)) better.push({ ...testCase, b, a });
      if (accuracyFor(a) < accuracyFor(b)) worse.push({ ...testCase, b, a });
    }

    console.log(`\n=== ${name} (n = ${cases.length}) vs ${REF} ===`);
    console.log(`better: ${better.length}   worse: ${worse.length}   `
      + `unchanged: ${cases.length - better.length - worse.length}`);

    if (!worse.length) {
      continue;
    }

    dirty = true;

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
  if (dirty) {
    console.log('\nSome queries got worse. Read them before keeping the change.');
  } else {
    console.log('\nNo query got worse.');
  }
}

main();
