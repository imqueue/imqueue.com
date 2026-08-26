#!/usr/bin/env node
// gold.ts — the KPI, measured against the gold set: one expected #1 page per query.
//
//   node scripts/search-kpi/gold.ts                    the report
//   node scripts/search-kpi/gold.ts --index DIR        measure a snapshot instead of _site-org
//   node scripts/search-kpi/gold.ts --source question  one query shape only
//   node scripts/search-kpi/gold.ts --worst 40         list the worst misses
//   node scripts/search-kpi/gold.ts --topic delivery   drill into one topic
//   node scripts/search-kpi/gold.ts --gains 2,3,5      is the nDCG gain ratio load-bearing?
//   node scripts/search-kpi/gold.ts --json FILE        write the full result
//   node scripts/search-kpi/gold.ts --compare FILE     diff against an earlier --json run
//   node scripts/search-kpi/gold.ts --ref SHA          diff the working tree against a ranker commit
//
// HOW THIS IS MEASURED, AND WHY THESE NUMBERS
//
// Every case names ONE page that should be #1 (`target`) and, sometimes, pages that answer
// defensibly but are not the best answer (`also`). That single change is what lets the report
// separate four different things that the old KPI reported as one:
//
//   P@1        the target is #1. THE HEADLINE. A site search has exactly one job at position 1,
//              and this is the only number that asks whether it did it. An `also` page at #1
//              scores zero here — deliberately.
//   MRR@target reciprocal rank of the target. Moves smoothly, so it is the number to tune on:
//              #4 -> #2 is a large move here and nearly invisible in P@1.
//   recall@6   any acceptable page inside the first six. The AGENT metric — search_docs returns
//              six results and an agent reads all of them, so membership is the whole question
//              and rank inside the set is noise.
//   nDCG@10    graded: the target is worth 3, an `also` page 1, log-discounted by position. This
//              is the one that can say "not the best answer, but not a miss either".
//
// A DELTA IS NOT A RESULT UNTIL IT IS TESTED, and for three months this runner printed deltas and
// nothing else. Both comparison paths (`--ref` and `--compare`) now report the PAIRED tests from
// lib/stats.ts, because the unpaired reading of P@1 is far too weak to resolve the moves being
// decided on: at n = 647 and p ~ 0.57 its standard error is 1.95 points, so a two-point move is
// one standard error. The same move read as a paired disagreement — McNemar on which queries
// gained and which lost — is significant at p < 1e-11. Same data, ~40x the power.
//
// MACRO IS THE HEADLINE AGGREGATION, OVER GROUPS RATHER THAN RAW TOPICS. The gold set is uneven by
// construction — 44 queries about how services talk to each other, 1 about boilerplate — because
// that is how the demand is shaped, not because the site cares 44 times more. A plain mean lets
// one topic carry the score. But a plain mean over 56 topics has the opposite disease: 14 of them
// hold fewer than five queries, and one query flipping inside an n=2 topic moves the macro mean by
// 0.89 points on its own. That is not a subtle bias; it is why a change that moved 55 queries once
// read as macro-neutral here. So topics below MIN_TOPIC are pooled into one `misc` group for the
// headline, they keep their own identity in the diagnostic tables, and the macro mean is printed
// with a cluster-bootstrap confidence interval so its real precision is visible.
//
// RESTRAINT IS REPORTED, NOT SCORED INTO THE HEADLINE. quarantine.json's `negative` bucket is
// 2,700 queries this site should not pretend to answer. What the ranker returns for them is worth
// knowing — an empty result set is the honest answer — but it is a different question from
// relevance and mixing the two would let a ranker that returns nothing look excellent.

import fs from 'node:fs';
import path from 'node:path';
import {
  load, baseline, provenance, evaluate, summarise, median,
  type Provenance, type ScoredResult, type Summary,
} from './lib/harness.ts';
import { halves } from './lib/split.ts';
import {
  verdict, mcnemarLine, macroCI, rng, type Interval,
} from './lib/stats.ts';
import {
  fingerprint, type GoldSet, type Label, type Quarantined, type QuarantineSet,
} from './lib/labels.ts';
import type { RankerEngine } from '../lib/ranker.ts';

const DATA = path.join(import.meta.dirname, 'data');

// A topic needs enough queries that no single one of them dominates its mean. At five, one query
// is 20% of its topic and 0.47 points of the macro headline; below five it is a coin toss wearing
// a subject name. Five rather than eight because eight pools 98 of 647 queries into `misc` and
// costs real subject resolution, while five pools 33 and removes every n<=4 topic — which is where
// all the observed instability came from.
const MIN_TOPIC = 5;

/** One row of the per-topic diagnostic table. */
interface TopicRow {
  key: string;
  n: number;
  p1: number;
  mrr: number;
  top6: number;
  ndcg: number;
  /** Share whose target is beyond rank 50 or never returned at all. */
  unreachable: number;
  /** True when the topic was too small to stand alone and was pooled into `misc`. */
  folded: boolean;
}

/** The per-topic rows plus the macro headline computed over POOLED groups. */
interface MacroReport {
  rows: TopicRow[];
  groupRows: TopicRow[];
  topics: number;
  groups: number;
  folded: number;
  pooledSize: number;
  p1: number;
  mrr: number;
  top6: number;
  ndcg: number;
  p1CI: Interval;
}

/** One scored set: its results, its per-topic view, and its micro summary. */
interface SetReport {
  results: ScoredResult[];
  byTopic: MacroReport;
  micro: Summary;
  label: string;
}

/** What the ranker returned for a query it should have nothing for. */
interface RestraintReport {
  n: number;
  failed: number;
  empty: number;
  medianTopScore: number | null;
  p90TopScore: number | null;
}

/** One query's target rank before and after, for the paired tests. */
interface Pair {
  query: string;
  was: number;
  now: number;
}

/**
 * One query as a --json run records it. Abbreviated keys, because a stored run
 * of 1231 queries is read as a diff.
 *
 * Note `t` and `p` are NOT interchangeable: `t` is where the NAMED BEST page
 * landed and is what every paired test reads; `p` is the first acceptable hit.
 * Reading the wrong one silently scores a different question.
 */
interface StoredResult {
  q: string;
  /** Target position. */
  t: number;
  /** Target rank, unbounded. */
  r?: number;
  /** Position of the first acceptable hit. */
  p?: number;
  /** Topic. */
  l?: string;
  /** The target it was scored against, so label drift is detectable. */
  g?: string;
}

/**
 * A stored --json run, read back for comparison. Every field is optional
 * because older baselines predate several of them — `fingerprint` and
 * `provenance` most notably, and labelDrift() below says so out loud rather
 * than comparing across label sets it cannot verify.
 */
interface StoredRun {
  fingerprint?: string;
  provenance?: Provenance;
  minTopic?: number;
  source?: string | null;
  macro?: { p1?: number; mrr?: number; top6?: number; ndcg?: number;
    groups?: number; topics?: number };
  micro?: Summary;
  bySrc?: Record<string, Summary>;
  results?: StoredResult[];
}

function arg(name: string): string | null;
function arg(name: string, fallback: string): string;
function arg(name: string, fallback: string | null = null): string | null {
  const i = process.argv.indexOf(name);

  return i === -1 ? fallback : process.argv[i + 1] ?? fallback;
}
const flag = (name: string): boolean => process.argv.includes(name);

const pct = (v: number | null | undefined): string =>
  (v === null || v === undefined ? '   —  ' : `${v.toFixed(1)}%`);
const signed = (v: number): string => `${v >= 0 ? '+' : ''}${v.toFixed(1)}`;
const section = (title: string): string =>
  `\n${'='.repeat(78)}\n${title}\n${'='.repeat(78)}`;

/**
 * Per-topic rows for diagnostics, plus the macro headline over POOLED groups.
 *
 * Two different aggregations from one pass, because they answer different questions: the rows are
 * "which subject is weak", which wants every topic named however small, and the headline is "how
 * is the site doing across subjects", which needs each contributing group to be a stable estimate.
 */
function macro(results: readonly ScoredResult[], minTopic: number): MacroReport {
  const groups = new Map<string, ScoredResult[]>();
  const topics = new Map<string, ScoredResult[]>();

  for (const result of results) {
    const key = result.topic ?? '';
    const list = topics.get(key) ?? [];

    list.push(result);
    topics.set(key, list);
  }

  const pooled = `misc (n<${minTopic})`;
  let folded = 0;

  for (const [topic, list] of topics) {
    const key = list.length >= minTopic ? topic : pooled;

    if (key === pooled) folded++;

    const group = groups.get(key) ?? [];

    group.push(...list);
    groups.set(key, group);
  }

  // Every field is optional on Summary only because summarise() short-circuits an
  // EMPTY set to `{ total: 0 }`; a group here always holds at least one result.
  const row = ([key, list]: [string, ScoredResult[]]): TopicRow => {
    const s = summarise(list);

    return {
      key,
      n: list.length,
      p1: s.p1 ?? 0,
      mrr: s.targetMrr ?? 0,
      top6: s.top6 ?? 0,
      ndcg: s.ndcg ?? 0,
      unreachable: (s.targetUnreachable ?? 0) + (s.targetDeep ?? 0),
      folded: list.length < minTopic,
    };
  };

  const rows = [...topics.entries()].map(row);
  const groupRows = [...groups.entries()].map(row);
  const mean = (field: 'p1' | 'mrr' | 'top6' | 'ndcg'): number =>
    groupRows.reduce((a, r) => a + r[field], 0) / groupRows.length;

  return {
    rows: rows.sort((a, b) => a.p1 - b.p1 || a.mrr - b.mrr),
    groupRows,
    topics: topics.size,
    groups: groups.size,
    folded,
    pooledSize: groups.get(pooled)?.length ?? 0,
    p1: mean('p1'),
    mrr: mean('mrr'),
    top6: mean('top6'),
    ndcg: mean('ndcg'),
    // Resampling the GROUPS, not the queries: the macro mean's uncertainty is uncertainty about
    // which subjects the site is measured on, and a query-level bootstrap would report an interval
    // several times narrower than the number's real stability.
    p1CI: macroCI(groupRows.map((r) => r.p1)),
  };
}

function headline(label: string, micro: Summary, byTopic: MacroReport): string {
  const ci = byTopic.p1CI;

  return [
    `${label}   (n = ${micro.total}, ${byTopic.groups} macro groups from ${byTopic.topics} topics)`,
    '                        macro      micro',
    `  P@1  (target is #1)  ${pct(byTopic.p1).padStart(7)}    ${pct(micro.p1).padStart(7)}`
    + `      95% CI [${ci.lo.toFixed(1)}, ${ci.hi.toFixed(1)}]`,
    `  MRR@target           ${pct(byTopic.mrr).padStart(7)}    ${pct(micro.targetMrr).padStart(7)}`,
    `  recall@6  (agent)    ${pct(byTopic.top6).padStart(7)}    ${pct(micro.top6).padStart(7)}`,
    `  nDCG@10  (graded)    ${pct(byTopic.ndcg).padStart(7)}    ${pct(micro.ndcg).padStart(7)}`,
    '',
    `  any acceptable #1    ${pct(micro.top1)}`,
    `  in top 3             ${pct(micro.top3)}`,
    `  in top 10            ${pct(micro.top10)}`,
    `  median rank          ${micro.medianRank === null ? '—' : micro.medianRank}`,
    `  empty result set     ${pct(micro.zeroResults)}`,
    '',
    '  WHERE THE TARGET IS   (four exclusive buckets over the named best page)',
    `    top 10             ${pct(micro.targetTop10)}`,
    `    buried 11-50       ${pct(micro.targetBuried)}     ranking defect`,
    `    deep 51+           ${pct(micro.targetDeep)}     ranking defect, a large one`,
    `    never returned     ${pct(micro.targetUnreachable)}     INDEXING defect — tuning cannot fix it`,
    `    median target rank ${micro.targetMedianRank === null ? '—' : micro.targetMedianRank}`,
  ].join('\n');
}

function topicTable(rows: readonly TopicRow[], limit: number): string {
  return rows.slice(0, limit).map((row) => (
    `  P@1 ${row.p1.toFixed(0).padStart(3)}%  MRR ${row.mrr.toFixed(0).padStart(3)}%  `
    + `r@6 ${row.top6.toFixed(0).padStart(3)}%  lost ${row.unreachable.toFixed(0).padStart(3)}%  `
    + `n=${String(row.n).padStart(3)}${row.folded ? '*' : ' '} ${row.key}`
  )).join('\n');
}

function worst(results: readonly ScoredResult[], limit: number): string {
  const misses = results
    .filter((r) => r.targetPosition !== 1)
    .sort((a, b) => {
      const rank = (x: ScoredResult): number => (x.targetRank || Number.MAX_SAFE_INTEGER);

      return rank(b) - rank(a) || String(a.query).localeCompare(String(b.query));
    });

  return misses.slice(0, limit).map((r) => [
    `  target ${String(r.targetRank || 'never').padStart(5)}  `
    + `first-ok ${String(r.position || '—').padStart(3)}  "${r.query}"`,
    `        wanted ${r.target}`,
    `        got    ${r.top || '(nothing)'}`,
  ].join('\n')).join('\n');
}

// Restraint: what comes back for the queries this site has no business answering. Reported as
// a distribution rather than a score, because "how confident was it about a wrong answer" is the
// interesting part and no single number carries it.
//
// SEEDED SHUFFLE, not a stride. The sample used to be `i % step === 0` over an alphabetically
// clustered list, and the negative bucket has ~330 consecutive entries beginning "molecular" — so
// a stride sample reported the ranker's behaviour on chemistry strings and called it restraint.
// The shuffle is seeded so the sample is still identical between runs, which is the property the
// stride was presumably chosen for.
function restraint(
  ranker: RankerEngine,
  negatives: readonly Quarantined[],
  sample: number,
): RestraintReport {
  const pool = [...negatives];
  const next = rng(0x9e3779b9);

  for (let i = pool.length - 1; i > 0; i--) {
    const j = (next() * (i + 1)) | 0;

    [pool[i], pool[j]] = [pool[j] as Quarantined, pool[i] as Quarantined];
  }

  const taken = pool.slice(0, sample);
  const scores: number[] = [];
  let empty = 0;
  let failed = 0;

  for (const item of taken) {
    let hits: Array<{ score: number }>;

    // One throwing query used to take the whole report down after the headline had printed, which
    // is the worst possible failure for a tool whose output is read top to bottom.
    try {
      hits = ranker.search(ranker.parseQuery(item.query));
    } catch {
      failed++;
      continue;
    }

    if (!hits.length) {
      empty++;
      scores.push(0);
      continue;
    }

    scores.push(Math.round(hits[0]?.score ?? 0));
  }

  const scored = scores.filter((s) => s > 0).sort((a, b) => a - b);

  return {
    n: taken.length,
    failed,
    empty: (empty / taken.length) * 100,
    medianTopScore: median(scored),
    p90TopScore: scored[Math.floor(scored.length * 0.9)] ?? null,
  };
}

function report(
  ranker: RankerEngine,
  cases: readonly Label[],
  label: string,
  minTopic: number,
): SetReport {
  const results = evaluate(ranker, cases);

  return {
    results, byTopic: macro(results, minTopic), micro: summarise(results), label,
  };
}

/**
 * The paired verdict on two runs of the same queries — the part that was missing.
 *
 * P@1 is binary per query, so its test is McNemar over the disagreements. MRR@target is continuous,
 * so its test is the paired bootstrap CI plus Wilcoxon that compare.ts has always used. Both read
 * the SAME pairing, which is the whole source of the sensitivity: the queries where nothing moved
 * carry no information and are correctly ignored by the first test and correctly retained by the
 * second.
 */
function paired(pairs: readonly Pair[]): { p1: string; mrr: string; n: number } {
  const rr = (position: number): number => (position >= 1 ? 100 / position : 0);

  return {
    p1: mcnemarLine(pairs.map((p): [boolean, boolean] => [p.was === 1, p.now === 1]), 'P@1        '),
    mrr: `MRR@target ${verdict(pairs.map((p) => rr(p.now) - rr(p.was))).line}`,
    n: pairs.length,
  };
}

function pairsFrom(
  before: ReadonlyArray<{ query: string; targetPosition: number }>,
  after: readonly ScoredResult[],
): { pairs: Pair[]; skipped: string[] } {
  const was = new Map<string, number>(before.map((r) => [r.query, r.targetPosition]));
  const pairs: Pair[] = [];
  const skipped: string[] = [];

  for (const r of after) {
    const previous = was.get(r.query);

    if (previous === undefined) {
      skipped.push(r.query);
      continue;
    }

    pairs.push({ query: r.query, was: previous, now: r.targetPosition });
  }

  return { pairs, skipped };
}

/**
 * Refuse to compare across a changed label set unless told to.
 *
 * A stored run and a fresh run are only comparable if they scored the same labels. Joining on query
 * text and skipping the misses — which is what this did — makes every kind of label change read as
 * an improvement in stability, because the queries that moved are exactly the ones that drop out.
 */
function labelDrift(before: StoredRun, gold: GoldSet, allow: boolean): boolean {
  const stored = before.fingerprint;
  const current = fingerprint(gold.queries);

  if (!stored) {
    console.log('\n  NOTE  the stored run predates label fingerprinting, so this comparison\n'
      + '        cannot verify that the two runs scored the same labels.');

    return true;
  }

  if (stored === current) return true;

  const wasTarget = new Map<string, string | undefined>(
    (before.results || []).map((r) => [r.q, r.g]),
  );
  const now = new Map<string, string>(gold.queries.map((c) => [c.query, c.target]));
  const added = [...now.keys()].filter((q) => !wasTarget.has(q));
  const removed = [...wasTarget.keys()].filter((q) => !now.has(q));
  const retargeted = [...now.entries()].filter(([q, t]) => wasTarget.has(q) && wasTarget.get(q) && wasTarget.get(q) !== t);

  console.error(`\n  LABEL SET CHANGED   stored ${stored}  ->  current ${current}`);
  console.error(`  ${added.length} added, ${removed.length} removed, ${retargeted.length} retargeted`);

  for (const q of added.slice(0, 8)) console.error(`    + ${q}`);
  for (const q of removed.slice(0, 8)) console.error(`    - ${q}`);
  for (const [q, t] of retargeted.slice(0, 8)) console.error(`    ~ ${q}\n        -> ${t} (was ${wasTarget.get(q)})`);

  if (allow) {
    console.error('\n  --allow-label-drift given: comparing anyway, on the intersection only.');

    return true;
  }

  console.error('\n  Refusing to compare: a delta across two different label sets is not a result.\n'
    + '  Re-baseline (`npm run kpi -- --json data/gold-baseline.json`) or pass --allow-label-drift.');

  return false;
}

function main(): void {
  const goldFile = path.join(DATA, 'gold.json');
  const quarantineFile = path.join(DATA, 'quarantine.json');

  if (!fs.existsSync(goldFile)) {
    console.error(`${goldFile} is missing — run \`node scripts/search-kpi/build-gold.ts\` first`);
    process.exit(1);
  }

  const gold = JSON.parse(fs.readFileSync(goldFile, 'utf8')) as GoldSet;
  const minTopic = Number(arg('--min-topic', String(MIN_TOPIC)));
  const ranker = load(arg('--index') ?? undefined);

  // Every target has to exist in the built index. A page that moved would otherwise score 0 for
  // ever and read as a ranking collapse, which is the one failure mode a hand-written label set
  // is guaranteed to hit eventually.
  const known = new Set<string>();

  // A record is addressable both by its own url and by the page it sits on, because a section record
  // carries a #fragment and a label may legitimately name either. Stripping the fragment here was
  // harmless while every target was a whole page; it silently rejects every anchored target.
  const remember = (url: unknown): void => {
    known.add(String(url));
    known.add(String(url).split('#')[0] ?? '');
  };

  // `state` is the ranker's own mutable scratch space and its type is deliberately
  // open in RankerEngine — pinning it here would be a second copy of the engine's
  // internals. All this needs from it is the url of each prepared record.
  const prepared = ranker.state as {
    t1?: { records?: Array<{ u: string }> };
    x1?: { records?: Array<{ u: string }> } | null;
  };

  for (const record of prepared.t1?.records ?? []) remember(record.u);
  for (const record of prepared.x1?.records ?? []) remember(record.u);

  const missing: string[] = [];

  for (const testCase of gold.queries) {
    for (const url of [testCase.target, ...(testCase.also || [])]) {
      if (!known.has(url)) missing.push(`${url}   (${testCase.query})`);
    }
  }

  if (missing.length) {
    console.error(`\n[gold] ${missing.length} labelled page(s) are not in the built index:\n`);
    for (const line of [...new Set(missing)].slice(0, 40)) console.error(`  ${line}`);
    console.error('\nEither the page moved and the label needs updating, or the build is stale.');
    process.exit(1);
  }

  const source = arg('--source');
  // The `seo` set is reported, never folded into the headline — 246 keyword-harvest queries all
  // naming one page would otherwise decide micro-P@1 for the whole site.
  const scored = gold.queries.filter((c) => c.src !== 'seo');
  const selected = source ? gold.queries.filter((c) => c.src === source) : scored;

  if (!selected.length) {
    console.error(`[gold] no queries with src "${source}"`);
    process.exit(1);
  }

  const all = report(ranker, selected, source ? `GOLD SET — ${source} only` : 'GOLD SET (everything)', minTopic);
  const sources = [...new Set(gold.queries.map((c) => c.src))];
  const bySrc: Record<string, SetReport> = {};

  for (const src of sources) {
    // Deliberately over gold.queries, not `selected`: `seo` is excluded from the headline but it is
    // still measured and still printed. Held out of the average is not the same as unmeasured.
    const pool = source ? selected : gold.queries;
    const subset = pool.filter((c) => c.src === src);

    if (subset.length) bySrc[src ?? ''] = report(ranker, subset, src ?? '', minTopic);
  }

  console.log(section('KPI — GOLD SET, ONE EXPECTED #1 PER QUERY'));
  console.log(
    `${scored.length} headline queries (+ ${gold.queries.length - scored.length} reported `
    + `separately as \`seo\`), judged one at a time against the page inventory. `
    + `Labels ${fingerprint(gold.queries)}.\n`,
  );
  console.log(headline(all.label, all.micro, all.byTopic));

  console.log(section('BY SOURCE — the query shapes measure different things'));
  console.log('                        n     P@1    MRR   r@6   nDCG   lost');

  for (const [src, r] of Object.entries(bySrc)) {
    console.log(
      `  ${src.padEnd(20)} ${String(r.micro.total).padStart(4)}  `
      + `${pct(r.micro.p1).padStart(6)} ${pct(r.micro.targetMrr).padStart(6)} `
      + `${pct(r.micro.top6).padStart(6)} ${pct(r.micro.ndcg).padStart(6)} `
      + `${pct((r.micro.targetDeep ?? 0) + (r.micro.targetUnreachable ?? 0)).padStart(6)}`,
    );
  }

  console.log(
    '\n  natural   keyword queries people really type into Google around this subject\n'
    + '  seo       MCP-setup keywords, all answered by one page — measured and printed above, but\n'
    + '            held OUT of the headline so 246 of them cannot decide micro-P@1 for the site\n'
    + '  question  chat-shaped phrasings a developer would put to an assistant\n'
    + '  intent    the 19 search_docs calls an agent actually made while building an app\n'
    + '  peer      imqueue.com, reachable only through the peer tiers — the commercial half',
  );

  // ---- reachability, the requirement that is NOT "be the best answer" -----
  const reach = all.results.filter((r) => r.mustReach);

  if (reach.length) {
    const inSix = reach.filter((r) => r.mustReachRank >= 1 && r.mustReachRank <= 6).length;
    const found = reach.filter((r) => r.mustReachRank >= 1).length;
    const missed = reach.filter((r) => !(r.mustReachRank >= 1 && r.mustReachRank <= 6));

    console.log(section('REACHABILITY — the reference page, whether or not it is the best answer'));
    console.log(
      `${reach.length} cases name a page that has to be FINDABLE even though something else answers\n`
      + 'better — on the agent queries, the API reference page the build actually needed. This is a\n'
      + 'second requirement, and it gets a second number instead of being forced into P@1.\n',
    );
    console.log(`  in the top 6         ${pct((inSix / reach.length) * 100)}  (${inSix}/${reach.length})`);
    console.log(`  returned at all      ${pct((found / reach.length) * 100)}`);

    for (const r of missed) {
      console.log(`    #${String(r.mustReachRank || '—').padStart(3)}  ${r.mustReach}\n          for "${r.query}"`);
    }
  }

  // ---- the two label regimes ----------------------------------------------
  // A case with no `also` asserts that nothing else is acceptable; a case with `also` asserts a
  // second tier. Averaged together their nDCG means two things at once, so both are printed.
  const exclusive = all.results.filter((r) => !(r.also || []).length);
  const graded = all.results.filter((r) => (r.also || []).length);

  if (exclusive.length && graded.length) {
    const e = summarise(exclusive);
    const g = summarise(graded);

    console.log(section('LABEL REGIME — nDCG means two things unless you split it'));
    console.log(`  target only, nothing else acceptable   n=${String(e.total).padStart(3)}  `
      + `P@1 ${pct(e.p1)}  nDCG ${pct(e.ndcg)}`);
    console.log(`  target plus a second "also" tier       n=${String(g.total).padStart(3)}  `
      + `P@1 ${pct(g.p1)}  nDCG ${pct(g.ndcg)}`);
    console.log('\n  The first group cannot score partial credit at all, so a shift in the mix\n'
      + '  between them moves nDCG without any ranking having changed.');
  }

  // ---- confidence ---------------------------------------------------------
  const low = all.results.filter((r) => r.confidence && r.confidence !== 'high');

  if (low.length) {
    const high = summarise(all.results.filter((r) => !r.confidence || r.confidence === 'high'));
    const highMacro = macro(all.results.filter((r) => !r.confidence || r.confidence === 'high'), minTopic);

    console.log(section('CONFIDENCE — the headline without the judgement calls'));
    console.log(`  ${low.length} of ${all.results.length} labels are marked low confidence: a defensible`);
    console.log('  second reading exists (usually "the topic hub or the article it lists").');
    console.log(`\n  high confidence only   P@1 ${pct(highMacro.p1)} macro / ${pct(high.p1)} micro  (n = ${high.total})`);
    console.log(`  everything             P@1 ${pct(all.byTopic.p1)} macro / ${pct(all.micro.p1)} micro`);
  }

  // The fit/holdout line, kept from measure.ts: a training score that looks like a measurement is
  // the failure this exists to prevent, and the split is by topic because near-duplicate queries
  // on both sides make the holdout agree with the fit by construction.
  //
  // READ ON P@1, not on the legacy linear accuracy. The one guard against overfitting was
  // measuring a metric the headline had stopped using, so a P@1 divergence between the halves
  // could not have shown up here at all.
  const { fit, holdout } = halves(all.results, (r) => (
    all.byTopic.groupRows.some((g) => g.key === r.topic) ? r.topic ?? '' : `misc (n<${minTopic})`
  ));
  const gap = fit.p1 - holdout.p1;

  console.log(section('FIT / HOLDOUT (P@1 macro, split by macro group)'));
  console.log(`  fit      ${fit.p1.toFixed(1)}%  (${fit.topics} groups, n = ${fit.n})`);
  console.log(`  holdout  ${holdout.p1.toFixed(1)}%  (${holdout.topics} groups, n = ${holdout.n})`);
  console.log(
    `  gap      ${signed(gap)} pts`
    + `${Math.abs(gap) > 8 ? '   <- large; suspect fitting to the set' : ''}`,
  );
  console.log(`  (legacy linear accuracy, for continuity: fit ${fit.accuracy.toFixed(1)}%, `
    + `holdout ${holdout.accuracy.toFixed(1)}%)`);

  console.log(section('WEAKEST TOPICS   (* pooled into misc for the macro headline)'));
  console.log(topicTable(all.byTopic.rows, 18));
  console.log(section('STRONGEST TOPICS'));
  console.log(topicTable([...all.byTopic.rows].reverse(), 8));

  // ---- is the gain ratio load-bearing? ------------------------------------
  const gains = arg('--gains');

  if (gains) {
    console.log(section('GAIN RATIO SWEEP — does the choice of target=3 decide anything?'));
    console.log('  target gain    nDCG@10 macro   weakest 5 topics (nDCG order)');

    for (const gain of gains.split(',').map(Number)) {
      const swept = macro(evaluate(ranker, selected, { targetGain: gain }), minTopic);
      const order = [...swept.rows].sort((a, b) => a.ndcg - b.ndcg).slice(0, 5).map((r) => r.key);

      console.log(`  ${String(gain).padStart(11)}    ${pct(swept.ndcg).padStart(13)}   ${order.join(', ')}`);
    }

    console.log('\n  If the weakest-topic order is stable across gains, the 3:1 ratio is a\n'
      + '  presentation choice and not a hidden parameter of the KPI.');
  }

  // ---- restraint ----------------------------------------------------------
  if (fs.existsSync(quarantineFile)) {
    const quarantine = JSON.parse(fs.readFileSync(quarantineFile, 'utf8')) as QuarantineSet;
    const negatives = quarantine.negative ?? [];
    const r = restraint(ranker, negatives, Number(arg('--restraint', '400')));

    console.log(section('RESTRAINT — the negative bucket, reported not scored'));
    console.log(
      `${negatives.length} quarantined queries this site has no answer for `
      + `(${(quarantine.contentGap ?? []).length} more are content gaps, excluded from both).\n`,
    );
    console.log(`  sampled              ${r.n}  (seeded shuffle)`);
    console.log(`  empty result set     ${pct(r.empty)}`);
    console.log(`  median top score     ${r.medianTopScore === null ? '—' : r.medianTopScore}`);
    console.log(`  90th pct top score   ${r.p90TopScore === null ? '—' : r.p90TopScore}`);

    if (r.failed) console.log(`  THREW                ${r.failed}  <- the ranker crashed on these`);

    console.log(
      '\n  For scale, the median top score on the gold set is '
      + `${median(all.results.map((x) => x.topScore ?? 0))}. A negative-bucket score close to that`
      + '\n  means the ranker cannot tell the two apart, which is what a confidence floor would fix.',
    );
  }

  // ---- worst misses -------------------------------------------------------
  const limit = Number(arg('--worst', '0'));

  if (limit) {
    console.log(section(`WORST MISSES (${limit}) — target not at #1, furthest first`));
    console.log(worst(all.results, limit));
  }

  const topic = arg('--topic');

  if (topic) {
    const subset = all.results.filter((r) => (r.topic ?? '').includes(topic));

    console.log(section(`TOPIC "${topic}" — ${subset.length} queries`));

    for (const r of subset.sort((a, b) => (a.targetRank || 1e9) - (b.targetRank || 1e9))) {
      console.log(
        `  ${String(r.targetRank || '—').padStart(5)}  ${r.query}\n`
        + `         want ${r.target}\n         got  ${r.top || '(nothing)'}`,
      );
    }
  }

  // ---- a second ranker, in the same process -------------------------------
  const ref = arg('--ref');

  if (ref) {
    const before = report(load(arg('--index') ?? undefined, baseline(ref)), selected, ref, minTopic);

    console.log(section(`AGAINST RANKER ${ref}`));
    console.log('                        before     after      delta');

    const row = (name: string, a = 0, b = 0): void => console.log(
      `  ${name.padEnd(20)} ${pct(a).padStart(7)}   ${pct(b).padStart(7)}   ${signed(b - a).padStart(6)} pts`,
    );

    row('P@1 (macro)', before.byTopic.p1, all.byTopic.p1);
    row('MRR@target (macro)', before.byTopic.mrr, all.byTopic.mrr);
    row('recall@6 (macro)', before.byTopic.top6, all.byTopic.top6);
    row('nDCG@10 (macro)', before.byTopic.ndcg, all.byTopic.ndcg);
    row('P@1 (micro)', before.micro.p1, all.micro.p1);
    row('target unreachable', before.micro.targetUnreachable, all.micro.targetUnreachable);

    const { pairs } = pairsFrom(before.results, all.results);
    const test = paired(pairs);

    console.log(`\n  PAIRED, on the same ${test.n} queries:`);
    console.log(`    ${test.p1}`);
    console.log(`    ${test.mrr}`);
  }

  // ---- persistence --------------------------------------------------------
  const jsonOut = arg('--json');

  if (jsonOut) {
    fs.writeFileSync(jsonOut, `${JSON.stringify({
      fingerprint: fingerprint(gold.queries),
      // Which ranker and which content produced these numbers — see harness.provenance(). The
      // fingerprint above pins the QUERIES; without this a baseline read months from now says what
      // moved and not what it moved from. `jsonOut` is excluded from the dirty check because writing
      // this file is what dirties the tree, and a run cannot be evidence against itself.
      provenance: provenance(jsonOut),
      minTopic,
      source: source || null,
      macro: {
        p1: all.byTopic.p1,
        mrr: all.byTopic.mrr,
        top6: all.byTopic.top6,
        ndcg: all.byTopic.ndcg,
        groups: all.byTopic.groups,
        topics: all.byTopic.topics,
      },
      micro: all.micro,
      bySrc: Object.fromEntries(Object.entries(bySrc).map(([k, v]) => [k, v.micro])),
      // `g` is the target. Stored so a later run can say WHICH labels moved rather than only that
      // the fingerprint differs.
      results: all.results.map((r) => ({
        q: r.query, t: r.targetPosition, r: r.targetRank, p: r.position, l: r.topic, g: r.target,
      })),
    }, null, 1)}\n`);
    console.log(`\n[gold] wrote ${jsonOut}`);
  }

  const compare = arg('--compare');

  if (compare && fs.existsSync(compare)) {
    const before = JSON.parse(fs.readFileSync(compare, 'utf8')) as StoredRun;

    console.log(section(`COMPARED WITH ${compare}`));

    if (!labelDrift(before, gold, flag('--allow-label-drift'))) {
      process.exitCode = 1;

      return;
    }

    const row = (name: string, a = 0, b = 0): void => console.log(
      `  ${name.padEnd(20)} ${pct(a).padStart(7)}   ${pct(b).padStart(7)}   ${signed(b - a).padStart(6)} pts`,
    );

    // Say what the `before` WAS, not just what it scored. A stored baseline is the thing every
    // future delta is measured from, so an unidentifiable one quietly turns "this change gained 2
    // points" into a claim about an unknown amount of accumulated work.
    const now = provenance();
    const stamp = (p: { sha: string; dirty: boolean } | null | undefined): string =>
      (p ? `${p.sha}${p.dirty ? ' (DIRTY)' : ''}` : 'unknown');

    if (before.provenance) {
      const moved = (
        a: { sha: string; dirty: boolean } | null | undefined,
        b: { sha: string; dirty: boolean } | null | undefined,
      ): string => (stamp(a) === stamp(b) ? '' : `  ->  ${stamp(b)}`);

      console.log(`  ranker   ${stamp(before.provenance.ranker)}${moved(before.provenance.ranker, now.ranker)}`);
      console.log(`  content  ${stamp(before.provenance.site)}${moved(before.provenance.site, now.site)}\n`);

      if ((before.provenance.ranker && before.provenance.ranker.dirty)
        || (before.provenance.site && before.provenance.site.dirty)) {
        console.log('  NOTE  the stored run was frozen from an UNCOMMITTED tree, so nobody can'
          + '\n        reproduce it. Re-freeze from a clean tree before trusting a delta against it.\n');
      }
    } else {
      console.log('  NOTE  the stored run predates provenance recording, so which ranker and which'
        + '\n        content produced it is unknown. Re-freeze to fix that.\n');
    }

    console.log('                        before     after      delta');
    row('P@1 (macro)', before.macro?.p1, all.byTopic.p1);
    row('MRR@target (macro)', before.macro?.mrr, all.byTopic.mrr);
    row('P@1 (micro)', before.micro?.p1, all.micro.p1);

    if (before.minTopic !== minTopic) {
      console.log(`\n  NOTE  the stored run pooled at n<${before.minTopic}, this one at n<${minTopic};`
        + '\n        the macro figures are not comparable. The micro and paired figures are.');
    }

    // `r.q`, not `r.query` — the persisted form is abbreviated (see the --json writer above), and
    // reading the wrong key silently keyed every entry on `undefined`, so the churn counts printed
    // "0 improved, 0 got worse" for a change that moved 60 queries.
    const { pairs, skipped } = pairsFrom(
      (before.results ?? []).map((r) => ({ query: r.q, targetPosition: r.t })),
      all.results,
    );
    const test = paired(pairs);

    console.log(`\n  PAIRED, on the same ${test.n} queries:`);
    console.log(`    ${test.p1}`);
    console.log(`    ${test.mrr}`);

    if (skipped.length) {
      console.log(`\n  ${skipped.length} queries are new since the stored run and are not in the test.`);
    }
  }
}

main();
