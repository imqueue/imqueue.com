// split.ts — a fit half and a holdout half, so a tuned number can be caught tuning.
//
// Every constant in the ranker was chosen by sweeping it against these query sets and keeping the
// value with the best macro. That is fitting, and it means every headline number this harness has
// ever printed is a TRAINING score. There is nothing wrong with fitting — it is how the weights
// got good — but a training score cannot answer the one question that matters after twenty such
// sweeps: is the ranker better, or is it shaped to these queries?
//
// So each set is cut in two and both halves are reported. A change that gains on the fit half and
// loses on the holdout half is overfitting, and it is invisible without this.
//
// SPLIT BY TOPIC, NOT BY QUERY, and that is the whole design. Queries within a topic are near
// duplicates — the natural harvest expands each seed a–z, so "imqueue rpc" and "imqueue rpc
// example" sit in the same topic and are answered by the same page. Splitting by query would put
// near-twins on both sides, the holdout would agree with the fit by construction, and the split
// would certify overfitting instead of detecting it.
//
// Deterministic, and NOT random: the assignment is a pure function of the topic names and their
// sizes, so the two halves never move between runs and a result cannot be re-rolled until it
// looks better. Largest-first bin packing, which balances query counts across two very uneven
// topic size distributions (`cli` has 16 questions of 115; natural's biggest topic has hundreds).

import type { ScoredResult } from './harness.ts';

/** Which half of the split a topic landed in. */
export type Side = 'fit' | 'holdout';

/** The macro score of one half, and how much of the set it holds. */
export interface HalfScore {
  topics: number;
  n: number;
  /** This project's linear position score. Read by the legacy runners. */
  accuracy: number;
  /** The gold set's headline. Read by gold.ts. */
  p1: number;
}

/** The two halves and the assignment that produced them. */
export interface Halves {
  side: Map<string, Side>;
  fit: HalfScore;
  holdout: HalfScore;
}

/**
 * @param sizes topic -> query count
 */
function assign(sizes: Map<string, number> | Array<[string, number]>): Map<string, Side> {
  const entries = [...(sizes instanceof Map ? sizes.entries() : sizes)]
    // Size descending, then name ascending. The name tie-break is what makes this stable when two
    // topics have the same count — without it the assignment would depend on Map insertion order,
    // i.e. on the order the query file happens to list its queries.
    .sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])));

  const out = new Map<string, Side>();
  let fit = 0;
  let holdout = 0;

  for (const [topic, n] of entries) {
    if (fit <= holdout) {
      out.set(topic, 'fit');
      fit += n;
    } else {
      out.set(topic, 'holdout');
      holdout += n;
    }
  }

  return out;
}

/** Topic sizes straight from a set of scored results. */
function sizesOf(
  results: readonly ScoredResult[],
  keyOf: (r: ScoredResult) => string,
): Map<string, number> {
  const sizes = new Map<string, number>();

  for (const result of results) {
    const key = keyOf(result);

    sizes.set(key, (sizes.get(key) || 0) + 1);
  }

  return sizes;
}

/**
 * Macro score per half, plus the gap.
 *
 * Macro on each side rather than micro, for the reason measure.ts gives: the harvest is skewed and
 * a micro mean over half of it is mostly a report on that half's biggest topic.
 *
 * BOTH metrics are returned, and which one the caller reads matters. `accuracy` is this project's
 * linear position score and was the only thing computed here for months — which meant the one
 * guard against overfitting was measuring a metric the headline no longer used. The gold set's
 * headline is P@1, so an overfitting check that reports `accuracy` can call a fit/holdout gap
 * clean while P@1 diverges. `p1` is now computed alongside it and is what gold.ts reads; the
 * legacy runners keep reading `accuracy` and are unaffected.
 */
function halves(
  results: readonly ScoredResult[],
  keyOf: (r: ScoredResult) => string,
): Halves {
  const side = assign(sizesOf(results, keyOf));
  const out: Record<Side, ScoredResult[]> = { fit: [], holdout: [] };

  for (const result of results) {
    // Every topic present in `results` was assigned above, from sizes derived
    // from those same results — so a miss would mean the two disagree about the
    // key, not that a topic is legitimately unassigned.
    out[side.get(keyOf(result)) ?? 'fit'].push(result);
  }

  const macroOf = (list: readonly ScoredResult[]): HalfScore => {
    const byTopic = new Map<string, ScoredResult[]>();

    for (const result of list) {
      const key = keyOf(result);
      const group = byTopic.get(key) ?? [];

      group.push(result);
      byTopic.set(key, group);
    }

    const perTopic = (score: (r: ScoredResult) => number): number[] => [...byTopic.values()]
      .map((rs) => rs.reduce((s, r) => s + score(r), 0) / rs.length);
    const mean = (values: readonly number[]): number =>
      values.reduce((a, b) => a + b, 0) / (values.length || 1);

    return {
      topics: byTopic.size,
      n: list.length,
      accuracy: mean(perTopic((r) => r.accuracy)),
      p1: mean(perTopic((r) => (r.targetPosition === 1 ? 100 : 0))),
    };
  };

  return { side, fit: macroOf(out.fit), holdout: macroOf(out.holdout) };
}

export { assign, sizesOf, halves };
