// stats.js — is that delta real, or is it the sample?
//
// The harness has been asked to resolve differences it cannot. Decisions have been taken on
// natural-macro moves of 0.1–0.5 points, and the README already records a change that moved the
// mean by +0.0 while 260 queries churned underneath it. "19 better / 7 worse" is a better signal
// than the mean, but it is still not an answer: 19 vs 7 out of 2,281 is a coin that came up heads
// 19 times out of 26, and whether that is luck depends on how big the moves were.
//
// So every comparison reports two things about the SAME per-query deltas:
//
//   * a paired bootstrap 95% CI on the mean delta — the range the true mean plausibly sits in.
//     If it straddles zero, the change is unmeasured, whatever the point estimate says.
//   * a Wilcoxon signed-rank p-value — the standard paired non-parametric test. Non-parametric
//     because the per-query metric is bounded, discrete and wildly non-normal (most deltas are
//     exactly 0, the rest jump in steps of 10), which is precisely where a t-test misbehaves.
//
// PAIRED is the load-bearing word. The two rankers are measured on the same queries, so the
// variance that matters is the variance of the DIFFERENCES, not of either mean. Comparing two
// independent confidence intervals on the means would be a much weaker test and would call almost
// everything a tie.
//
// Everything here is deterministic: the bootstrap draws from a seeded PRNG, never Math.random, so
// re-running a comparison cannot produce a different verdict from the same numbers. A measurement
// tool that disagrees with itself is worse than no measurement.

'use strict';

/**
 * mulberry32 — a small, fast, well-distributed 32-bit PRNG.
 *
 * Chosen over an LCG because the low bits of an LCG are notoriously non-random, and the bootstrap
 * uses exactly those to pick an index.
 */
function rng(seed) {
  let a = seed >>> 0;

  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;

    let t = a;

    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);

    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const mean = (values) => values.reduce((a, b) => a + b, 0) / (values.length || 1);

/**
 * Percentile bootstrap CI on the mean of paired deltas.
 *
 * @param {number[]} deltas after - before, one per query, INCLUDING the zeros. Dropping the
 *   unchanged queries would measure "the mean move among queries that moved", which is a
 *   different and much larger number than the mean move.
 * @returns {{mean: number, lo: number, hi: number, iterations: number}}
 */
function bootstrapCI(deltas, options) {
  const iterations = (options && options.iterations) || 2000;
  const seed = (options && options.seed) || 0x5eed;
  const level = (options && options.level) || 0.95;
  const n = deltas.length;

  if (!n) {
    return { mean: 0, lo: 0, hi: 0, iterations: 0 };
  }

  const next = rng(seed);
  const means = new Float64Array(iterations);

  for (let b = 0; b < iterations; b++) {
    let sum = 0;

    for (let i = 0; i < n; i++) {
      sum += deltas[(next() * n) | 0];
    }
    means[b] = sum / n;
  }

  const sorted = Array.from(means).sort((a, b) => a - b);
  const tail = (1 - level) / 2;

  return {
    mean: mean(deltas),
    lo: sorted[Math.floor(tail * iterations)],
    hi: sorted[Math.min(iterations - 1, Math.ceil((1 - tail) * iterations) - 1)],
    iterations,
  };
}

// Two-sided normal tail, via the Abramowitz & Stegun 7.1.26 erf approximation (|error| < 1.5e-7 —
// far below anything that changes a verdict here).
function normalTwoSided(z) {
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const erf = 1 - t * Math.exp(-x * x) * (
    0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429)))
  );

  return Math.max(0, Math.min(1, 1 - erf));
}

/**
 * Wilcoxon signed-rank test on paired deltas, normal approximation with tie correction.
 *
 * Zero deltas are DROPPED, which is the standard (Wilcoxon) treatment and is what makes the test
 * about the queries that moved. The bootstrap above keeps them, so the two answer different
 * questions on purpose: "did anything change" and "how big was the average change".
 *
 * @returns {{n: number, w: number, z: number, p: number, better: number, worse: number}}
 */
function wilcoxon(deltas) {
  const nonZero = deltas.filter((d) => d !== 0);
  const n = nonZero.length;
  const better = nonZero.filter((d) => d > 0).length;
  const worse = n - better;

  if (n < 6) {
    // The normal approximation is not usable this small, and an exact test for a handful of
    // queries would still say "cannot tell". Reported as such rather than as a number.
    return { n, w: 0, z: 0, p: 1, better, worse, tooSmall: true };
  }

  const byMagnitude = nonZero
    .map((d, i) => ({ d, abs: Math.abs(d), i }))
    .sort((a, b) => a.abs - b.abs || a.i - b.i);

  // Average ranks within each group of equal magnitude — without this, a set of deltas that are
  // mostly ±10 (which is exactly what a position metric produces) gets a variance that is far too
  // large and the test never rejects.
  let ties = 0;
  let at = 0;

  while (at < n) {
    let end = at;

    while (end + 1 < n && byMagnitude[end + 1].abs === byMagnitude[at].abs) {
      end++;
    }

    const rank = (at + end) / 2 + 1;
    const group = end - at + 1;

    for (let k = at; k <= end; k++) {
      byMagnitude[k].rank = rank;
    }
    ties += group * group * group - group;
    at = end + 1;
  }

  let w = 0;

  for (const entry of byMagnitude) {
    if (entry.d > 0) {
      w += entry.rank;
    }
  }

  const expected = (n * (n + 1)) / 4;
  const variance = (n * (n + 1) * (2 * n + 1)) / 24 - ties / 48;

  if (variance <= 0) {
    return { n, w, z: 0, p: 1, better, worse, tooSmall: true };
  }

  // Continuity correction, toward the null.
  const diff = w - expected;
  const z = (diff - Math.sign(diff) * 0.5) / Math.sqrt(variance);

  return { n, w, z, p: normalTwoSided(z), better, worse };
}

/**
 * One line a person can act on: the point estimate, the interval, and whether it clears zero.
 *
 * The verdict wording is deliberate. "unmeasured" is not "no change" — it means this harness
 * cannot tell, which is a fact about the sample size and the query set, not about the ranker.
 */
function verdict(deltas, options) {
  const ci = bootstrapCI(deltas, options);
  const test = wilcoxon(deltas);
  const clears = (ci.lo > 0 && ci.hi > 0) || (ci.lo < 0 && ci.hi < 0);
  const sign = ci.mean >= 0 ? '+' : '';

  return {
    ci,
    test,
    significant: clears && test.p < 0.05,
    line: `${sign}${ci.mean.toFixed(2)}  95% CI [${ci.lo.toFixed(2)}, ${ci.hi.toFixed(2)}]  `
      + `p ${test.tooSmall ? '—' : test.p < 0.0001 ? '< 0.0001' : test.p.toFixed(4)}  `
      + `(${test.better} better / ${test.worse} worse of ${deltas.length})  `
      + `${clears && test.p < 0.05 ? 'SIGNIFICANT' : 'unmeasured'}`,
  };
}

module.exports = { bootstrapCI, wilcoxon, verdict, rng, normalTwoSided };
