// pages.ts — the slice of the Cloudflare Pages Functions runtime this repo uses.
//
// Deliberately a local structural type rather than @cloudflare/workers-types.
// That package declares Workers' own `Response`, `Request` and `fetch` as globals,
// which collide with the Node ones every script in scripts/ relies on; keeping it
// out means one tsconfig instead of two, and the four members below are the entire
// surface these handlers touch. If a handler ever needs more of the runtime, add
// it here — the collision is the reason, not an oversight.

/** The `context` argument every Pages Function receives. */
export interface PagesContext {
  request: Request;
  /** Invoke the next handler in the chain — the static asset lookup, usually. */
  next: () => Promise<Response>;
  /** Bindings and secrets from the Pages project (VISITOR_SALT, GA4 ids, …). */
  env: Record<string, string | undefined>;
  /**
   * Keep work alive past the response; used for fire-and-forget analytics.
   *
   * Not optional. The runtime always supplies it, both fabricated contexts in
   * this repo supply it (scripts/check-agent-analytics.ts and the e2e Pages
   * harness), and marking it optional would only buy a `?.` at the one call
   * site — which would turn "measurement is not running" into a silent no-op
   * instead of a type error.
   */
  waitUntil: (promise: Promise<unknown>) => void;
  data?: Record<string, unknown>;
}

/** A Pages Function entry point. */
export type PagesFunction = (context: PagesContext) => Promise<Response> | Response;
