// compare.ts — the ARTIFICIAL TRIPWIRE, working tree against another ranker commit, query by query.
//
//   node scripts/search-kpi/compare.ts [--ref HEAD] [--dir _site-org] [--worst 40]
//
// `--ref` is a commit in the ranker's own repository (the vendor/search-ranker submodule), so
// `HEAD` means the pinned ranker and the working tree means your unstaged edits to it.
//
// THE DIVISION OF LABOUR, because there are two comparison paths and picking the wrong one wastes a
// measurement:
//
//   gold.ts --ref SHA    the KPI. 985 labels judged from page content, P@1, McNemar. Read this one
//                        to decide whether a ranker change is an improvement.
//   compare.ts --ref SHA this file. 10,000 queries generated from the site's own titles, so it
//                        cannot say anything about relevance — only whether a page stopped being
//                        findable by its own name. A tripwire, at a sample size the gold set will
//                        never have.
//
// WHY IT IS PER-QUERY, and it is the whole reason this file exists: an aggregate can hold still
// while the results churn underneath it, and it has hidden a real regression twice.
//
//   * A change that read -0.2 on macro turned out to be three named queries moving, one of them out
//     of the top ten. The macro alone looked like rounding.
//   * A change that read 0.0 — genuinely unmoved on the relevance sets — was simultaneously dropping
//     13 artificial queries, two of them from #1 to #11 and #10 to #24. It was reverted on the
//     strength of this list, and nothing in measure.ts's summary would have objected.
//
// So: never judge a ranker change by the summary. Read who won and who lost.
//
// Both rankers are loaded in ONE process over ONE prepared corpus, so the only variable is the
// code. The baseline comes out of git rather than a hand-kept copy, which means it cannot drift
// from what it claims to be.
//
// This file used to score four sets. Three are gone: the natural and legacy-intent labels were
// list-valued (`expect` as a list of acceptable pages), which is exactly the defect that made them
// unable to see a real regression, and all three populations were re-judged from page content into
// the gold set — where gold.ts scores them against ONE expected #1 with a paired test. Comparing
// them here as well would have meant reporting the superseded labels beside the current ones.
import fs from 'node:fs';
import path from 'node:path';

import { load, baseline, page, accuracyFor, ndcgFor } from './lib/harness.ts';
import type { RankerEngine } from '../lib/ranker.ts';
import { verdict } from './lib/stats.ts';

const ROOT = path.join(import.meta.dirname, '..', '..');

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

/** One case of the artificial set: a query, its generator bucket, and what should lead. */
interface ArtificialCase {
  query: string;
  expect: string | string[];
  bucket?: string;
}

const arg = (name: string, fallback: string): string => {
  const i = process.argv.indexOf(name);

  return i === -1 ? fallback : process.argv[i + 1] ?? fallback;
};

const REF = arg('--ref', 'HEAD');
const DIR = arg('--dir', path.join(ROOT, '_site-org'));
const WORST = Number(arg('--worst', '40'));

function rankOf(ranker: RankerEngine, query: string, expect: readonly string[]): number {
  let hits: Array<{ external?: boolean; record: { u: string } }>;

  try {
    hits = ranker.search(ranker.parseQuery(query));
  } catch {
    return 0;
  }

  for (let i = 0; i < hits.length; i++) {
    const hit = hits[i];

    if (hit && !hit.external && expect.includes(page(hit.record.u))) {
      return i + 1;
    }
  }

  return 0; // absent
}

function main() {
  const file = path.join(import.meta.dirname, 'data', 'artificial-queries.json');

  // Said out loud rather than skipped in silence. The file is gitignored — it is 1.2 MB and
  // regenerates exactly from the index plus a fixed seed — so on a fresh checkout it is absent,
  // and a comparison that quietly measured nothing would read like one that found nothing.
  if (!fs.existsSync(file)) {
    console.log('scripts/search-kpi/data/artificial-queries.json is missing, so NOTHING was');
    console.log('compared. It is gitignored by design; generate it with `npm run kpi:search:gen`.');
    process.exit(1);
  }

  const data = JSON.parse(fs.readFileSync(file, 'utf8')) as
    { main: ArtificialCase[]; typos: ArtificialCase[] };
  const baselineFile = baseline(REF);
  // Order matters only in that both must see the same corpus; load() prepares it per ranker, so
  // neither can be measured against a corpus the other did not have.
  const before = load(DIR, baselineFile);
  const after = load(DIR);

  // The typo bucket is compared as its own population, never folded in. The ranker has no fuzzy
  // matching, so its 499 one-transposed-key variants are answered by the relaxation pass or not at
  // all — a spelling change moves them for a reason unrelated to weighting.
  const sets: Array<[string, ArtificialCase[]]> =
    [['artificial', data.main], ['typos', data.typos]];

  for (const [name, cases] of sets) {
    const better: Array<ArtificialCase & { b: number; a: number }> = [];
    const worse: Array<ArtificialCase & { b: number; a: number }> = [];
    // Per-query deltas, INCLUDING the zeros — see lib/stats.ts. `byBucket` carries the same deltas
    // grouped, because the set's macro is a mean over generator buckets and a claim about a macro
    // has to be tested over buckets rather than over queries.
    const deltas: number[] = [];
    const ndcgDeltas: number[] = [];
    const byBucket = new Map<string, number[]>();

    for (const testCase of cases) {
      const expect = (Array.isArray(testCase.expect) ? testCase.expect : [testCase.expect])
        .map(page);
      const b = rankOf(before, testCase.query, expect);
      const a = rankOf(after, testCase.query, expect);
      const delta = accuracyFor(a) - accuracyFor(b);
      const bucket = testCase.bucket || '(none)';

      deltas.push(delta);
      ndcgDeltas.push((ndcgFor(a, 1, 1) - ndcgFor(b, 1, 1)) * 100);

      const inBucket = byBucket.get(bucket) ?? [];

      inBucket.push(delta);
      byBucket.set(bucket, inBucket);

      if (delta > 0) better.push({ ...testCase, b, a });
      if (delta < 0) worse.push({ ...testCase, b, a });
    }

    // One number per bucket, so each bucket weighs the same as every other — the macro definition.
    const bucketDeltas = [...byBucket.values()]
      .map((list) => list.reduce((x: number, y: number) => x + y, 0) / list.length);

    const micro = verdict(deltas);
    const macro = verdict(bucketDeltas);

    const buckets = `${byBucket.size} bucket${byBucket.size === 1 ? '' : 's'}`;

    console.log(`\n=== ${name} (n = ${cases.length}, ${buckets}) vs ${REF} ===`);
    console.log(`  accuracy micro   ${micro.line}`);
    // A macro over one bucket IS the micro, and printing it produces a zero-width CI and a p-value
    // over a sample of one — which reads as a result rather than as the tautology it is.
    if (byBucket.size > 1) console.log(`  accuracy macro   ${macro.line}`);
    console.log(`  nDCG@10 micro    ${verdict(ndcgDeltas).line}`);

    // The honest reading, spelled out because "unmeasured" is the result most likely to be
    // misread as "safe". It means this set cannot tell, not that nothing happened.
    if (!micro.significant && (byBucket.size === 1 || !macro.significant)
      && (better.length || worse.length)) {
      console.log(`  → ${better.length + worse.length} queries moved and neither average clears `
        + 'zero: this change is UNMEASURED on this set, not neutral.');
    }

    if (!worse.length) {
      console.log('  no query got worse.');
      continue;
    }

    console.log('\n  WORSE (before -> after, 0 = absent from the result set):');

    worse
      .sort((x, y) => (accuracyFor(y.b) - accuracyFor(y.a)) - (accuracyFor(x.b) - accuracyFor(x.a)))
      .slice(0, WORST)
      .forEach((w) => console.log(`    ${String(w.b).padStart(3)} -> ${String(w.a).padStart(3)}  `
        + `${w.query.slice(0, 52).padEnd(52)} [${w.bucket}]`));

    if (worse.length > WORST) {
      console.log(`    … and ${worse.length - WORST} more (pass --worst N)`);
    }
  }

  // Not an exit failure, and deliberately no verdict: a page losing its own title is a strong
  // signal, but this set cannot say whether the change was worth it. `npm run kpi` decides that.
  console.log('\nThis set cannot tell you whether the change is an improvement — it shares the');
  console.log('site\'s vocabulary by construction. Read `npm run kpi` for that, and read the list');
  console.log('above for pages that stopped being findable by their own name.');
}

main();
