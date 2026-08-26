// The shapes every judged/*.ts module publishes.
//
// One declaration rather than eleven, because these tuples are the KPI's raw
// evidence and their positional meaning is the whole contract: `[query, target,
// also, topic]` and `[target, topic, queries]` differ only in what sits at index
// 0, and a file that got them the wrong way round would still parse, still
// assemble, and quietly measure the ranker against nonsense.
//
// Named tuple members so an editor shows `target` rather than `[1]`, and
// `readonly` throughout because build-gold.ts only ever reads them — a label set
// that a run can mutate is a label set that cannot be compared across runs.

/** A query with a hand-judged answer. `[query, target, also, topic]`. */
export type JudgedQuery = readonly [
  query: string,
  target: string,
  /** Other pages that would also be a correct answer. */
  also: readonly string[],
  topic: string,
];

/**
 * The intent set adds a fifth slot: the API reference page the answer names,
 * which must stay reachable from the query and is reported separately from P@1.
 * Null where the query names no symbol.
 */
export type IntentQuery = readonly [
  query: string,
  target: string,
  also: readonly string[],
  topic: string,
  mustReach: string | null,
];

/** A page and the harvested queries judged to belong to it. */
export type PositiveJudgement = readonly [
  target: string,
  topic: string,
  queries: readonly string[],
];

/** Queries this site has no answer for, and the reason — which sorts the bucket. */
export type NegativeJudgement = readonly [
  why: string,
  queries: readonly string[],
];

/** What a harvest-derived judged module publishes. */
export interface JudgedModule {
  positive?: readonly PositiveJudgement[];
  negative?: readonly NegativeJudgement[];
}
