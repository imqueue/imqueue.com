// harness.ts — run the real ranker over a labelled query set and score it.
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

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

import { requireRanker, RANKER_DIR, type RankerEngine } from '../../lib/ranker.ts';

// For the one load a static import cannot express: `rankerFile` is an absolute
// path decided at run time, pointing at a snapshot of the engine extracted from
// another commit. Synchronous on purpose — every caller here is.
const require = createRequire(import.meta.url);

/**
 * One query to score, and what would count as a correct answer.
 *
 * Two shapes in one type, and the difference is load-bearing. A LEGACY case
 * carries `expect` — any of these pages is right, all equally. A GOLD case
 * carries `target` (the one page that should be #1) plus optional `also`
 * (acceptable, worth a third as much). expectationsFor() below normalises the
 * two; nothing downstream needs to know which it was reading.
 */
export interface TestCase {
  query: string;
  /** Legacy shape: any of these is correct. */
  expect?: string | string[];
  /** Gold shape: the one page that should lead. */
  target?: string;
  /** Gold shape: pages that are acceptable but not best. */
  also?: readonly string[];
  /** Explicit per-URL gains, when a label set grades them. */
  grades?: Record<string, number> | null;
  /** A page that must stay FINDABLE even where it is not the best answer. */
  mustReach?: string | null;
  /** Score against the peer edition's feed rather than this one's. */
  peer?: boolean;
  topic?: string;
  src?: string;
  /** Carried through from a gold Label; reported, never scored. */
  confidence?: string;
  /** Carried through from a gold Label; reported, never scored. */
  kind?: string;
}

/** What evaluate() adds to each case. The case's own fields are spread in beside these. */
export interface ScoredResult extends TestCase {
  /** Rank of the first ACCEPTABLE hit, bounded at `limit`; 0 when absent. */
  position: number;
  /** Rank of the NAMED BEST page, bounded at `limit`; 0 when absent. */
  targetPosition: number;
  /** Rank of the named best page, UNBOUNDED; 0 means never returned at all. */
  targetRank: number;
  /** Rank of `mustReach`, unbounded; 0 when it never came back. */
  mustReachRank: number;
  accuracy: number;
  ndcg: number;
  returned: number;
  top?: string | null;
  topScore?: number;
  merged?: number;
  /** Set only when the ranker threw on this query. */
  error?: string;
}

/** Which commit of the ranker, and of this repo, produced a set of numbers. */
export interface Provenance {
  ranker: { sha: string; dirty: boolean } | null;
  site: { sha: string; dirty: boolean } | null;
}

/** Every aggregate summarise() computes. `total: 0` is the empty case. */
export interface Summary {
  total: number;
  accuracy?: number;
  ndcg?: number;
  p1?: number;
  top1?: number;
  top3?: number;
  top5?: number;
  top6?: number;
  top10?: number;
  absent?: number;
  targetTop10?: number;
  targetBuried?: number;
  targetDeep?: number;
  targetUnreachable?: number;
  targetMedianRank?: number | null;
  mrr?: number;
  targetMrr?: number;
  medianRank?: number | null;
  zeroResults?: number;
}

/** Knobs evaluate() accepts. */
export interface EvaluateOptions {
  /** Compare full URLs including #fragment, rather than page paths. */
  strict?: boolean;
  /** Scoring window; the SCAN is unbounded regardless. Default 50. */
  limit?: number;
  /** Gain credited to a `target` hit. Default 3. */
  targetGain?: number;
}

const ROOT = path.join(import.meta.dirname, '..', '..', '..');

// `rankerFile` measures a DIFFERENT copy of the ranker — a snapshot from another commit — which
// is what compare.ts uses to diff two versions in one process. Left undefined it measures the
// working tree.
function load(dir?: string, rankerFile?: string): RankerEngine {
  const indexDir = dir || path.join(ROOT, '_site-org');
  const ranker: RankerEngine = rankerFile
    ? require(rankerFile) as RankerEngine
    : requireRanker();

  const read = (name: string, optional?: boolean): unknown => {
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

/**
 * Extract a past ranker from the submodule's history and return the file path, ready to hand
 * to `load()` as `rankerFile`. That is the whole shape of a before/after run: two `load()`
 * calls in one process, one of them reading a commit.
 *
 * It lives here rather than in each runner because three scripts had grown their own copy —
 * the same duplication `scripts/lib/ranker.ts` exists to prevent for the path itself. The ref
 * names a commit in the RANKER's history, which is not this repo's history, so `git show` has
 * to run inside the submodule; getting that wrong reports "unknown revision" for a commit that
 * plainly exists, which is why the error message says so out loud.
 */
/**
 * WHICH RANKER AND WHICH CONTENT produced a set of numbers, for storing in a --json run.
 *
 * The label fingerprint already pins which QUERIES were scored and pins nothing about the code that
 * scored them, so a stored baseline could be compared against months later with no way to identify
 * what the `before` actually was. Two commits answer that: the ranker submodule's, and this repo's.
 *
 * Deliberately NOT a timestamp. A date from `new Date()` made a no-op re-run produce a diff, which
 * is why gold.json carries none either — and a commit sha only moves when the thing it names moves,
 * so it cannot churn.
 *
 * `dirty` is the field that matters most, and it counts untracked files too: a baseline frozen from
 * an uncommitted tree is not reproducible by anyone else, and comparing against one silently is how
 * a delta gets attributed to the wrong change. Freeze from a clean tree.
 *
 * `ignore` exists for one specific case: WRITING the baseline dirties the tree, so a re-freeze would
 * otherwise record `dirty: true` about its own output file and raise an alarm about nothing. The
 * output of a measurement cannot be part of that measurement's provenance. Callers pass the path
 * they are about to write. False alarms train people to ignore the real ones.
 */
function provenance(ignore?: string | (string | undefined)[]): Provenance {
  const skip = (Array.isArray(ignore) ? ignore : [ignore])
    .filter((p): p is string => Boolean(p))
    .map((p) => path.relative(ROOT, path.resolve(p)));

  const at = (cwd: string, ignoring: string[]): { sha: string; dirty: boolean } | null => {
    const git = (args: string[]): string => execFileSync('git', args, {
      cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
    });

    try {
      // Porcelain v1 lines are `XY <path>`: two status columns, one space, then the path — so the
      // path starts at index 3 and NOT at the first non-space character. An unstaged modification
      // reads " M path", with a leading space, which is why this must not be trimmed before slicing:
      // trimming the whole output ate that space on the FIRST line only, slice(3) then ate a
      // character of the path, and the exclusion below silently never matched. A rename reads
      // "old -> new"; the destination is the part that has to match.
      const changed = git(['status', '--porcelain']).split('\n').filter(Boolean)
        .map((line) => line.slice(3))
        .map((file) => (file.includes(' -> ') ? file.split(' -> ')[1] ?? file : file))
        .filter((file) => !ignoring.includes(file));

      return { sha: git(['rev-parse', '--short', 'HEAD']).trim(), dirty: changed.length > 0 };
    } catch {
      // Not a repository, or git is unavailable. Recorded as unknown rather than guessed, because a
      // provenance field that is sometimes a lie is worse than one that is sometimes absent.
      return null;
    }
  };

  return { ranker: at(RANKER_DIR, []), site: at(ROOT, skip) };
}

function baseline(ref: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kpi-baseline-'));

  const show = (name: string): string => execFileSync('git', ['show', `${ref}:${name}`], {
    cwd: RANKER_DIR,
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  // ranker.js FIRST, then search.js — the engine was split out of the single file on 2026-08-06,
  // so which name holds the scorer depends on how old the ref is. Both names are tried rather
  // than one chosen from a date because a comparison across the split is exactly the comparison
  // worth being able to run: the split had to move all four sets by zero, and proving that means
  // measuring a two-file working tree against a one-file commit. Under Node the UI half is not
  // needed either way — it exports nothing and requires a DOM.
  let file;

  try {
    file = path.join(dir, 'ranker.js');
    fs.writeFileSync(file, show('ranker.js'));
  } catch {
    try {
      file = path.join(dir, 'search.js');
      fs.writeFileSync(file, show('search.js'));
    } catch (error) {
      // Both plausible causes name the same fix, and git's own message names neither: a submodule
      // checked out with `--init` but never fetched has no HEAD to show, and `git show` run against
      // a directory that is not a repository at all says only "does not exist in 'HEAD'".
      console.error(`Cannot read ranker ref \`${ref}\` from ${RANKER_DIR}\n`);
      // execFileSync attaches the child's stderr to the error it throws; the plain
      // message says only that the command failed, and git's own words are the
      // half that names the fix.
      const detail = error instanceof Error
        ? String((error as Error & { stderr?: unknown }).stderr || error.message)
        : String(error);

      console.error(`  git: ${detail.trim()}\n`);
      console.error('Neither ranker.js nor search.js exists at that ref.\n');
      console.error('`--ref` names a commit in the ranker submodule, not in this repo. If the\n'
        + 'submodule is not fully checked out:\n\n    git submodule update --init\n');
      process.exit(1);
    }
  }

  return file;
}

const page = (url: unknown): string => String(url).split('#')[0] ?? '';

// max(0, 100 - 10*(position-1)); absent scores 0.
function accuracyFor(position: number): number {
  return position >= 1 && position <= 10 ? 100 - 10 * (position - 1) : 0;
}

// nDCG@10, reported ALONGSIDE the accuracy above rather than instead of it.
//
// The linear −10-per-position metric is this project's own invention and it says something true —
// "nobody scrolls to the eleventh row" — but it discounts positions 5 to 10 far more harshly than
// any reader behaves, and it cannot express a partially-right answer. nDCG is the field's standard
// and its log discount is the shape click distributions actually follow, so the two together say
// more than either: a change that moves a query from #4 to #2 barely registers in accuracy terms
// (+20 of 100) and is a large nDCG move, while #1 to #2 is the reverse.
//
// SINGLE RELEVANT DOCUMENT per query, deliberately. `expect` lists ALTERNATIVES — "the topic index
// or the article it lists, either is right" — so the ideal ranking has one relevant document at
// position 1, not three. Summing gains over the alternatives, as textbook DCG would, would credit a
// ranker for returning three spellings of the same answer and would make a query with more
// acceptable answers score higher for the same reader experience.
//
// `grades` is honoured when a query carries one ({url: gain}), so a graded label set can be
// introduced later without touching this. Absent, every listed URL is worth the same.
const NDCG_K = 10;

function ndcgFor(position: number, gain: number, maxGain: number): number {
  if (!position || position > NDCG_K) {
    return 0;
  }

  const ideal = maxGain || 1;

  return ((gain || 1) / ideal) / Math.log2(position + 1);
}

// One case = one query plus the URL(s) that would be a correct top result. `expect` may be
// a string or an array: several pages can be equally right (a topic index and the article
// it lists), and pretending otherwise would score a good answer as a miss.
//
// A case may instead carry `target` plus optional `also` — the gold set's shape, where one page
// is named as the page that should be #1 and the rest are merely acceptable. Then `position` is
// still the first acceptable hit (so recall and MRR read as before) and `targetPosition` is
// where the named best answer landed, which is what P@1 is measured on. Grades follow from the
// same fields, so nDCG credits an `also` hit at a third of a `target` hit rather than equally.
const TARGET_GAIN = 3;

function expectationsFor(
  testCase: TestCase,
  targetGain?: number,
): { expect: string[]; grades: Record<string, number> | null; target: string | null } {
  if (!testCase.target) {
    return {
      expect: Array.isArray(testCase.expect) ? testCase.expect : [testCase.expect ?? ''],
      grades: testCase.grades || null,
      target: null,
    };
  }

  const also = testCase.also || [];
  const grades: Record<string, number> = { [testCase.target]: targetGain || TARGET_GAIN };

  for (const url of also) {
    if (!(url in grades)) grades[url] = 1;
  }

  return { expect: [testCase.target, ...also], grades, target: testCase.target };
}

// THE SCORING WINDOW AND THE DIAGNOSTIC WINDOW ARE DIFFERENT, AND THAT MATTERS.
//
// Everything scored — accuracy, nDCG, recall@6, MRR — is bounded at `limit` (50), because that is
// what the numbers have always meant and a comparison against a stored baseline has to stay
// comparable. But the SCAN is unbounded, and the target's true rank is kept beside the bounded
// one, because the bounded reading cannot tell three very different failures apart:
//
//   target at #23   the page is reachable and the ranker mis-ordered it. A ranking defect.
//   target at #180  the page is retrievable but effectively invisible. Still a ranking defect,
//                   and a much larger one.
//   target absent   the query does not match the page at all. An INDEXING defect — no amount of
//                   weight tuning will fix it, and it needs different work.
//
// Reported as one "never found" figure, those three were 1.5% and looked like a rounding error.
// Separated, 7.6% of the set has its best page outside the top ten.
function evaluate(
  ranker: RankerEngine,
  cases: readonly TestCase[],
  options?: EvaluateOptions,
): ScoredResult[] {
  const strict = Boolean(options && options.strict);
  const limit = (options && options.limit) || 50;
  const targetGain = (options && options.targetGain) || TARGET_GAIN;
  const results: ScoredResult[] = [];

  for (const testCase of cases) {
    const spec = expectationsFor(testCase, targetGain);
    const expected = spec.expect.map((url) => (strict ? url : page(url)));
    const wanted = spec.target && !strict ? page(spec.target) : spec.target;

    let hits: Array<{ external?: boolean; score: number; record: { u: string } }>;

    try {
      hits = ranker.search(ranker.parseQuery(testCase.query));
    } catch (error) {
      results.push({
        ...testCase,
        position: 0,
        targetPosition: 0,
        targetRank: 0,
        // 0 means "never came back", which is exactly what a query the ranker
        // threw on produced. Set here rather than left absent so every caller
        // can compare it as a number.
        mustReachRank: 0,
        accuracy: 0,
        ndcg: 0,
        returned: 0,
        error: error instanceof Error ? error.message : String(error),
      });
      continue;
    }

    const maxGain = spec.grades
      ? Math.max(...Object.values(spec.grades).map(Number))
      : 1;

    // THE EDITION HAS TO MATCH, BOTH WAYS ROUND, AND THE RANK IS COUNTED INSIDE ITS OWN EDITION.
    //
    // A peer hit — imqueue.com through the PEER tiers — counts only for a case that asked for one,
    // or every .org query could be answered by the commercial site. A case that DID ask for one is
    // not satisfied by a local hit either: /license/, /support/, /contact/, /terms/, /privacy/ and
    // / exist on BOTH editions, so matching on path alone would let imqueue.org answer "do I need a
    // commercial license" and score it correct.
    //
    // And the position has to be counted within the matching edition, because the ranker sorts
    // "local before peer, unconditionally" — a commercial page can never outrank a local one in the
    // merged list, and /search/ renders the two as separate groups anyway. Scored against the
    // merged list, all 13 commercial cases read P@1 0% and would look like a ranking failure to
    // fix; they were in fact measuring a design decision. Within its own group the question becomes
    // answerable: when the reader looks at the commercial results, is the right one first?
    //
    // For the 647 local cases this is a no-op — external hits already sort last — which is the
    // property that makes it safe to apply to everything rather than only to peer cases.
    const candidates = hits.filter((h) => Boolean(h.external) === Boolean(testCase.peer));

    // `mustReach` is a page that has to be FINDABLE even when it is not the best answer — on the
    // intent cases it is the API reference page the build needed, which the FAQ legitimately
    // outranks. Tracked separately from `target` on purpose: the first version of those labels put
    // this requirement INTO `target`, which made 14 correct results score as misses and made P@1
    // read 5.3% on a set that was working. Two requirements, two numbers.
    const mustReach = testCase.mustReach && !strict ? page(testCase.mustReach) : testCase.mustReach;

    let rank = 0;
    let targetRank = 0;
    let mustReachRank = 0;
    let ndcg = 0;

    for (let i = 0; i < candidates.length; i++) {
      const found = candidates[i]?.record.u ?? '';
      const url = strict ? found : page(found);

      if (mustReach && !mustReachRank && url === mustReach) mustReachRank = i + 1;
      if (!expected.includes(url)) continue;

      const gain = spec.grades ? Number(spec.grades[url]) || 1 : 1;

      if (!rank) rank = i + 1;
      if (wanted && !targetRank && url === wanted) targetRank = i + 1;

      // The BEST contribution wins, not the first hit's. With graded labels the first acceptable
      // hit is not necessarily the most valuable one: an `also` page at #1 and the target at #2
      // would otherwise score below the target at #2 on its own, which says the extra good answer
      // made the ranking worse.
      // ndcgFor() returns 0 beyond rank 10, so an unbounded scan cannot leak gain into nDCG.
      ndcg = Math.max(ndcg, ndcgFor(i + 1, gain, maxGain));
    }

    const position = rank && rank <= limit ? rank : 0;
    const bounded = targetRank && targetRank <= limit ? targetRank : 0;

    results.push({
      ...testCase,
      position,
      // Without a named target, "did the expected page lead" is the same question as "was the
      // first acceptable hit at #1", so the two agree and every existing runner is unaffected.
      targetPosition: wanted ? bounded : position,
      // The UNBOUNDED rank of the named best page: 0 means the ranker never returns it at all.
      targetRank: wanted ? targetRank : rank,
      mustReachRank,
      accuracy: accuracyFor(position),
      ndcg: ndcg * 100,
      // All three read the CANDIDATE list, so "what came back on top" is what came back on top of
      // the edition being scored. Identical to the merged list for every local case.
      returned: candidates.length,
      top: candidates[0]?.record.u ?? null,
      topScore: candidates[0] ? Math.round(candidates[0].score) : 0,
      merged: hits.length,
    });
  }

  return results;
}

function summarise(results: readonly ScoredResult[]): Summary {
  const total = results.length;

  if (!total) return { total: 0 };

  const sum = (fn: (r: ScoredResult) => number): number =>
    results.reduce((acc, r) => acc + fn(r), 0);
  const count = (fn: (r: ScoredResult) => boolean): number => results.filter(fn).length;

  const histogram: Record<string, number> = {};

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
    ndcg: sum((r) => r.ndcg || 0) / total,
    // P@1 — the share of queries whose NAMED BEST page is #1. On a set with no named target this
    // equals top1; on the gold set it is stricter, because an acceptable-but-second-best page at
    // position 1 counts here as a miss. It is the headline: "which page should lead" is the only
    // question a site search has to get right.
    p1: (count((r) => r.targetPosition === 1) / total) * 100,
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
    // WHERE THE NAMED BEST PAGE ACTUALLY IS, in four exclusive buckets that sum to 100%. The one
    // number these replace ("never found", 1.5%) was measured on the first ACCEPTABLE hit, so a
    // query whose second-best page ranked #2 and whose best page ranked #400 counted as found.
    // These four are all measured on the target, and the last two name different kinds of work:
    // buried and deep are ranking defects, unreachable is an indexing defect.
    targetTop10: (count((r) => r.targetRank >= 1 && r.targetRank <= 10) / total) * 100,
    targetBuried: (count((r) => r.targetRank > 10 && r.targetRank <= 50) / total) * 100,
    targetDeep: (count((r) => r.targetRank > 50) / total) * 100,
    targetUnreachable: (count((r) => !r.targetRank) / total) * 100,
    targetMedianRank: median(results.filter((r) => r.targetRank > 0).map((r) => r.targetRank)),
    mrr: mrr * 100,
    // MRR over the NAMED BEST page rather than the first acceptable one. Same reason as p1: this
    // is the number that moves when the target climbs from #4 to #2, and the one to tune on.
    targetMrr: (sum((r) => (r.targetPosition ? 1 / r.targetPosition : 0)) / total) * 100,
    medianRank: median(ranked.map((r) => r.position)),
    zeroResults: (count((r) => r.returned === 0) / total) * 100,
  };
}

function median(values: readonly number[]): number | null {
  if (!values.length) return null;

  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);

  return sorted.length % 2
    ? sorted[mid] ?? null
    : ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
}

const pct = (value: number | null | undefined): string =>
  (value === null || value === undefined ? '   —  ' : `${value.toFixed(1)}%`);

function table(label: string, summary: Summary): string {
  const lines = [
    `${label}  (n = ${summary.total})`,
    `  accuracy (KPI)   ${pct(summary.accuracy)}`,
    `  nDCG@10          ${pct(summary.ndcg)}`,
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

export {
  load, baseline, provenance, evaluate, summarise, table, accuracyFor, ndcgFor, page, median,
};
