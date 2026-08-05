// split.js — a fit half and a holdout half, so a tuned number can be caught tuning.
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

'use strict';

/**
 * @param {Map<string, number>|Array<[string, number]>} sizes topic -> query count
 * @returns {Map<string, 'fit'|'holdout'>}
 */
function assign(sizes) {
  const entries = [...(sizes instanceof Map ? sizes.entries() : sizes)]
    // Size descending, then name ascending. The name tie-break is what makes this stable when two
    // topics have the same count — without it the assignment would depend on Map insertion order,
    // i.e. on the order the query file happens to list its queries.
    .sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])));

  const out = new Map();
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
function sizesOf(results, keyOf) {
  const sizes = new Map();

  for (const result of results) {
    const key = keyOf(result);

    sizes.set(key, (sizes.get(key) || 0) + 1);
  }

  return sizes;
}

/**
 * Macro accuracy per half, plus the gap.
 *
 * Macro on each side rather than micro, for the reason measure.js gives: the harvest is skewed and
 * a micro mean over half of it is mostly a report on that half's biggest topic.
 */
function halves(results, keyOf) {
  const side = assign(sizesOf(results, keyOf));
  const out = { fit: [], holdout: [] };

  for (const result of results) {
    out[side.get(keyOf(result))].push(result);
  }

  const macroOf = (list) => {
    const byTopic = new Map();

    for (const result of list) {
      const key = keyOf(result);

      if (!byTopic.has(key)) byTopic.set(key, []);
      byTopic.get(key).push(result);
    }

    const perTopic = [...byTopic.values()]
      .map((rs) => rs.reduce((s, r) => s + r.accuracy, 0) / rs.length);

    return {
      topics: perTopic.length,
      n: list.length,
      accuracy: perTopic.reduce((a, b) => a + b, 0) / (perTopic.length || 1),
    };
  };

  return { side, fit: macroOf(out.fit), holdout: macroOf(out.holdout) };
}

module.exports = { assign, sizesOf, halves };
