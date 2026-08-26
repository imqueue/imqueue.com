// labels.ts — the label set as DATA: how it is identified, how it is written, and what makes it
// invalid. Shared by the judge that produces it, the runner that measures against it, and the
// check that gates the build on it, because all three had started to disagree about what a label
// set even is.
//
// THREE PROBLEMS THIS FILE EXISTS TO CLOSE
//
// 1. A LABEL SET COULD NOT BE IDENTIFIED. gold.json said only `built: "2026-08-06"`, so
//    `--compare` against a stored baseline joined on query text and silently skipped anything it
//    could not find. Shrink the set, retarget forty queries, move two topics — every one of those
//    makes the comparison look MORE stable, not less. That happened mid-session: two queries
//    changed topic under a running comparison and nothing said so. `fingerprint()` makes the label
//    set name itself, and the runner refuses a mismatch instead of averaging over one.
//
// 2. THE DATA WAS NOT DETERMINISTIC. `built` came from `new Date()`, so re-running the judge with
//    no rule change produced a diff. For data whose entire value is auditability that is
//    backwards. The stamp is now derived from the labels themselves.
//
// 3. THE DIFFS WERE UNREVIEWABLE. 121 KB of minified JSON on one line means a real relabelling and
//    a no-op look identical in review. `writeCollection()` puts exactly one query per line, so a
//    label change is a one-line diff and a rule that quietly moved 300 queries is 300 lines.

import fs from 'node:fs';
import crypto from 'node:crypto';

/**
 * One judged label: a query, the page that answers it, and how it is scored.
 *
 * Every optional field is genuinely absent on most rows — `mustReach` on the 18
 * intent queries that name a symbol, `peer` on the 14 commercial ones — and the
 * fingerprint below folds each of them in under a fixed default, so a row that
 * gains one is a changed label set rather than a silent re-scoring.
 */
export interface Label {
  query: string;
  /** The page or anchored section judged to be the correct #1. */
  target: string;
  /** Other pages that also count as correct. */
  also?: readonly string[];
  topic: string;
  /** Which query file it came from: natural, seo, question, intent or peer. */
  src?: string;
  /** Scored against the peer edition's feed rather than this one's. */
  peer?: boolean;
  confidence?: string;
  /** An API reference page that must stay reachable from this query. */
  mustReach?: string | null;
  /** A coarse label for reporting; not scored. */
  kind?: string;
}

/** A query with no answer on this site, and the judged reason. */
export interface Quarantined {
  query: string;
  why: string;
}

/** data/gold.json, as the runners read it back. */
export interface GoldSet {
  fingerprint?: string;
  queries: Label[];
}

/** data/quarantine.json, as the runners read it back. */
export interface QuarantineSet {
  contentGap?: Quarantined[];
  negative?: Quarantined[];
}

/**
 * A stable name for a set of labels, over the fields that DECIDE a score.
 *
 * `also` is sorted before hashing because its order carries no meaning, and a reordering must not
 * read as a changed label set. Everything else that can move a number is in: retarget a query,
 * move it between topics, flip its confidence or its peer flag, add or drop a query, and the
 * fingerprint changes.
 */
function fingerprint(queries: readonly Label[]): string {
  const lines = queries.map((c) => [
    c.query,
    c.target,
    [...(c.also || [])].sort().join(','),
    c.topic,
    c.src || '',
    c.peer ? 'peer' : '',
    c.confidence || 'high',
    c.mustReach || '',
  ].join('\t'));

  return crypto.createHash('sha256').update(lines.sort().join('\n')).digest('hex').slice(0, 12);
}

/**
 * Write a JSON file whose array members sit one per line.
 *
 * Not cosmetic. The label set is the one artefact in this harness that a person has to be able to
 * read a diff of, and `JSON.stringify(x, null, 0)` makes that impossible while
 * `JSON.stringify(x, null, 2)` turns 647 queries into 5,000 lines. One line per record is the
 * shape that answers "what changed" in a single `git diff`.
 */
function writeCollection(
  file: string,
  meta: Record<string, unknown>,
  arrays: Record<string, readonly unknown[]>,
): void {
  const indent = (value: unknown): string =>
    JSON.stringify(value, null, 1).split('\n').join('\n ');
  const parts = Object.entries(meta).map(([key, value]) => ` ${JSON.stringify(key)}: ${indent(value)}`);

  for (const [key, rows] of Object.entries(arrays)) {
    const lines = rows.map((row) => `  ${JSON.stringify(row)}`).join(',\n');

    parts.push(` ${JSON.stringify(key)}: [\n${lines}\n ]`);
  }

  fs.writeFileSync(file, `{\n${parts.join(',\n')}\n}\n`);
}

/**
 * Everything that makes a label set self-contradictory, as a list of one-line problems.
 *
 * These are not hypothetical checks written for completeness — each one is a mistake that a
 * hand-written label set makes, and a KPI that averages over any of them reports a number nobody
 * can act on. A query in both gold and quarantine is being scored and excluded at once; a `target`
 * repeated in `also` earns partial credit for being the best answer; the same query twice is a
 * double vote for whichever page it names.
 *
 * @returns empty when the set is sound.
 */
function integrity(gold: GoldSet, quarantine?: QuarantineSet | null): string[] {
  const problems: string[] = [];
  const seen = new Map<string, Label>();

  for (const c of gold.queries) {
    if (!c.query || typeof c.query !== 'string') {
      problems.push(`missing or non-string query: ${JSON.stringify(c).slice(0, 120)}`);
      continue;
    }

    if (seen.has(c.query)) problems.push(`duplicate query in gold: "${c.query}"`);
    seen.set(c.query, c);

    if (!c.target) problems.push(`no target: "${c.query}"`);
    if (!c.topic) problems.push(`no topic: "${c.query}"`);

    const also = c.also || [];

    if (also.includes(c.target)) problems.push(`target repeated in also: "${c.query}"`);
    if (new Set(also).size !== also.length) problems.push(`duplicate also entry: "${c.query}"`);
  }

  if (quarantine) {
    const gaps = new Set((quarantine.contentGap || []).map((q) => q.query));

    for (const item of quarantine.negative || []) {
      if (seen.has(item.query)) problems.push(`in gold AND quarantined negative: "${item.query}"`);
      if (gaps.has(item.query)) problems.push(`in both quarantine buckets: "${item.query}"`);
    }

    for (const item of quarantine.contentGap || []) {
      if (seen.has(item.query)) problems.push(`in gold AND quarantined as a gap: "${item.query}"`);
    }
  }

  return problems;
}

/** Sort key for the query list, so the file order is a fact about the labels, not about the rules. */
const bySortKey = (a: { query: string; src?: string }, b: { query: string; src?: string }): number =>
  String(a.query).localeCompare(String(b.query), 'en')
  || String(a.src).localeCompare(String(b.src), 'en');

export { fingerprint, writeCollection, integrity, bySortKey };
