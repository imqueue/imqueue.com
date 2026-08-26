// stats.ts — is that delta real, or is it the sample?
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

/**
 * mulberry32 — a small, fast, well-distributed 32-bit PRNG.
 *
 * Chosen over an LCG because the low bits of an LCG are notoriously non-random, and the bootstrap
 * uses exactly those to pick an index.
 */
/** Percentile-bootstrap interval on a mean. */
export interface Interval {
  mean: number;
  lo: number;
  hi: number;
  iterations: number;
}

/** Wilcoxon signed-rank result. `tooSmall` means the approximation was not used. */
export interface WilcoxonResult {
  n: number;
  w: number;
  z: number;
  p: number;
  better: number;
  worse: number;
  tooSmall?: boolean;
}

/** McNemar result. `b` lost (hit before, miss after), `c` gained. */
export interface McNemarResult {
  b: number;
  c: number;
  both: number;
  neither: number;
  n: number;
  chi2: number;
  p: number;
  /** True when the exact two-sided binomial was used instead of chi-square. */
  exact: boolean;
}

/** How much resampling to do, and from what seed. */
export interface BootstrapOptions {
  iterations?: number;
  seed?: number;
  /** Confidence level; 0.95 by default. */
  level?: number;
}

/** A point estimate, its interval, its test, and one line a person can act on. */
export interface Verdict {
  ci: Interval;
  test: WilcoxonResult;
  significant: boolean;
  line: string;
}

function rng(seed: number): () => number {
  let a = seed >>> 0;

  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;

    let t = a;

    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);

    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const mean = (values: readonly number[]): number =>
  values.reduce((a, b) => a + b, 0) / (values.length || 1);

/**
 * Percentile bootstrap CI on the mean of paired deltas.
 *
 * @param deltas after - before, one per query, INCLUDING the zeros. Dropping the
 *   unchanged queries would measure "the mean move among queries that moved", which is a
 *   different and much larger number than the mean move.
 */
function bootstrapCI(deltas: readonly number[], options?: BootstrapOptions): Interval {
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
      sum += deltas[(next() * n) | 0] ?? 0;
    }
    means[b] = sum / n;
  }

  const sorted = Array.from(means).sort((a, b) => a - b);
  const tail = (1 - level) / 2;

  return {
    mean: mean(deltas),
    lo: sorted[Math.floor(tail * iterations)] ?? 0,
    hi: sorted[Math.min(iterations - 1, Math.ceil((1 - tail) * iterations) - 1)] ?? 0,
    iterations,
  };
}

// Two-sided normal tail, via the Abramowitz & Stegun 7.1.26 erf approximation (|error| < 1.5e-7 —
// far below anything that changes a verdict here).
function normalTwoSided(z: number): number {
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
 */
function wilcoxon(deltas: readonly number[]): WilcoxonResult {
  const nonZero = deltas.filter((d) => d !== 0);
  const n = nonZero.length;
  const better = nonZero.filter((d) => d > 0).length;
  const worse = n - better;

  if (n < 6) {
    // The normal approximation is not usable this small, and an exact test for a handful of
    // queries would still say "cannot tell". Reported as such rather than as a number.
    return { n, w: 0, z: 0, p: 1, better, worse, tooSmall: true };
  }

  // `rank` is filled in by the tie-averaging pass below, one group at a time,
  // which is why it starts absent rather than at 0 — a rank of 0 is a real value
  // this algorithm never assigns.
  const byMagnitude: Array<{ d: number; abs: number; i: number; rank?: number }> = nonZero
    .map((d, i) => ({ d, abs: Math.abs(d), i }))
    .sort((a, b) => a.abs - b.abs || a.i - b.i);

  // Average ranks within each group of equal magnitude — without this, a set of deltas that are
  // mostly ±10 (which is exactly what a position metric produces) gets a variance that is far too
  // large and the test never rejects.
  let ties = 0;
  let at = 0;

  while (at < n) {
    let end = at;

    while (end + 1 < n && byMagnitude[end + 1]?.abs === byMagnitude[at]?.abs) {
      end++;
    }

    const rank = (at + end) / 2 + 1;
    const group = end - at + 1;

    for (let k = at; k <= end; k++) {
      const entry = byMagnitude[k];

      if (entry) entry.rank = rank;
    }
    ties += group * group * group - group;
    at = end + 1;
  }

  let w = 0;

  for (const entry of byMagnitude) {
    if (entry.d > 0) {
      w += entry.rank ?? 0;
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
 * McNemar's test — the right test for a BINARY paired outcome, which is what P@1 is.
 *
 * The bootstrap and Wilcoxon above both operate on a continuous per-query delta, so neither fits
 * the headline metric: P@1 is a yes/no per query, and its delta is one of exactly three values
 * (-1, 0, +1). McNemar throws away the agreements — the queries the target led both before and
 * after carry no information about whether the change helped — and asks only whether the two
 * DISAGREEMENT counts are balanced. That is the whole reason this is so much more sensitive than
 * comparing two independent proportions: at n = 647 and p ≈ 0.57 the unpaired standard error of
 * P@1 is 1.95 points, so a 2-point move is one standard error and unfalsifiable, while the same
 * move as 93 gains against 16 losses is p < 1e-11. Same data, two orders of magnitude of power,
 * and for three months the harness used the weaker reading by not testing at all.
 *
 * @param pairs [wasHit, isHit] per query, INCLUDING the agreements.
 */
function mcnemar(pairs: ReadonlyArray<readonly [boolean, boolean]>): McNemarResult {
  let b = 0;
  let c = 0;
  let both = 0;
  let neither = 0;

  for (const [was, is] of pairs) {
    if (was && !is) b++;
    else if (!was && is) c++;
    else if (was && is) both++;
    else neither++;
  }

  const discordant = b + c;

  if (!discordant) {
    return { b, c, both, neither, n: pairs.length, chi2: 0, p: 1, exact: true };
  }

  // Below ~25 disagreements the chi-square approximation is optimistic, so use the exact
  // two-sided binomial instead. Not a nicety: a set with n = 19 (the intent source) can only ever
  // land here, and the approximation would report a p-value it has no right to.
  if (discordant < 25) {
    let tail = 0;

    for (let k = 0; k <= Math.min(b, c); k++) {
      let logC = 0;

      for (let i = 0; i < k; i++) logC += Math.log(discordant - i) - Math.log(i + 1);
      tail += Math.exp(logC - discordant * Math.LN2);
    }

    return {
      b, c, both, neither, n: pairs.length, chi2: 0, p: Math.min(1, 2 * tail), exact: true,
    };
  }

  // Edwards' continuity correction — toward the null, matching wilcoxon() above.
  const chi2 = ((Math.abs(b - c) - 1) ** 2) / discordant;

  return {
    b, c, both, neither, n: pairs.length, chi2, p: normalTwoSided(Math.sqrt(chi2)), exact: false,
  };
}

/** One actionable line for a binary paired outcome, phrased like verdict() below. */
function mcnemarLine(pairs: ReadonlyArray<readonly [boolean, boolean]>, label: string): string {
  const m = mcnemar(pairs);
  const net = m.c - m.b;
  const sign = net >= 0 ? '+' : '';

  return `${label} ${sign}${net} net  (${m.c} gained / ${m.b} lost, `
    + `${m.both + m.neither} unchanged)  `
    + `${m.exact ? 'exact binomial' : `chi2 ${m.chi2.toFixed(1)}`} `
    + `p ${m.p < 0.0001 ? '< 0.0001' : m.p.toFixed(4)}  `
    + `${m.p < 0.05 ? 'SIGNIFICANT' : 'unmeasured'}`;
}

/**
 * Cluster bootstrap on a MACRO mean: resample the GROUPS, not the queries.
 *
 * The macro headline is a mean over topics, and its noise comes from the topics, not from the
 * queries inside them — 11 of 56 topics hold three queries or fewer, so one query flipping in an
 * n=2 topic moves the macro mean by 0.89 points on its own. Resampling queries would report a
 * confidence interval far narrower than the number's real stability. Resampling topics reports
 * what the macro mean would do if the site's subject mix had been drawn differently, which is the
 * question a topic-weighted average is asking.
 *
 * @param perGroup one value per group (already averaged within the group).
 */
function macroCI(perGroup: readonly number[], options?: BootstrapOptions): Interval {
  return bootstrapCI(perGroup, { seed: 0x901d, ...(options || {}) });
}

/**
 * One line a person can act on: the point estimate, the interval, and whether it clears zero.
 *
 * The verdict wording is deliberate. "unmeasured" is not "no change" — it means this harness
 * cannot tell, which is a fact about the sample size and the query set, not about the ranker.
 */
function verdict(deltas: readonly number[], options?: BootstrapOptions): Verdict {
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

export {
  bootstrapCI, wilcoxon, verdict, rng, normalTwoSided, mcnemar, mcnemarLine, macroCI,
};
