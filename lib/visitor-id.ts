// visitor-id.ts — a stable, non-reversible visitor identifier derived at the edge.
//
// WHAT IT IS FOR. Counting unique visitors needs an identifier, and an identifier normally
// means a cookie — which is what drags the whole consent apparatus in, because ePrivacy
// Art. 5(3) governs storing things on someone's device. This derives the identifier from
// what the request already carries instead. Nothing is written to the device, so Art. 5(3)
// never engages: no banner, and the count covers every visitor rather than the fraction
// who accept one. Same construction Plausible and Fathom use.
//
// WHAT IT IS NOT. Pseudonymisation, not anonymisation. A hashed IP is still personal data
// under GDPR (Breyer, CJEU C-582/14) and the processing still needs a lawful basis —
// legitimate interest, Art. 6(1)(f), which is available here precisely because we are
// outside the storage rule. It has to be disclosed in /privacy/.
//
// THE SALT IS THE WHOLE THING. Without it the inputs are an IPv4 address (4.3e9 values) and
// a user-agent (a few thousand realistic strings): ~2e13 combinations, which one GPU
// exhausts in under an hour — less once the country narrows the address range, and the
// country is in the same dataset. A hash like that is a reversible encoding of the visitor's
// address, so every stored id would BE an IP written in hex: none of hashing's protection,
// all of an IP's exposure, plus a term of Google's that forbids sending them personal data.
// A secret in the input removes the thing to brute-force against. It is one random string in
// an encrypted env var, and it has no effect whatsoever on the resulting counts.
//
// NO ROTATION, DELIBERATELY. Rotating the salt daily would cap each id's life at 24 hours —
// the safest arrangement, and it makes "unique visitors this month" unanswerable, because
// what you get instead is a sum of daily uniques. The owner chose true uniques over any
// range (2026-08-03), so the id persists for as long as a visitor keeps the same address and
// browser build. That persistence is the part a regulator would look at. It is the price of
// the metric, not an oversight, and rotation is one more value in the digest if it changes.
//
// ACCURACY. IP + user-agent is an estimate. A NAT — an office, a mobile carrier — collapses
// several people into one id, and one person moving from wifi to mobile data becomes two.

/**
 * Inputs to {@link visitorId}.
 *
 * All three admit null and undefined on purpose. Every one of them is a header
 * read or an unset binding at the call site, and the guard in the body — "no
 * salt, no id" — is this module's documented behaviour rather than defensive
 * padding. Typing them as required strings would make that guard unreachable by
 * type and force a cast at every caller, which is the wrong direction: the
 * absent case is normal here, not exceptional.
 */
export interface VisitorIdArgs {
  /** Client address (Cloudflare's `cf-connecting-ip`). */
  ip: string | null | undefined;
  /** Client user-agent; separates visitors behind one NAT. */
  userAgent?: string | null | undefined;
  /** Secret from `VISITOR_SALT`. Without it, `null`. */
  salt: string | null | undefined;
}

/**
 * Stable pseudonymous id for one visitor, or null when it cannot or should not be made.
 *
 * Returns null with no salt configured. That is deliberate: the caller then counts no
 * humans at all rather than falling back to a weaker identifier, so a missing secret costs
 * data and never protection.
 *
 * The raw address is never returned and never logged — it goes into the digest and is
 * dropped with the stack frame.
 *
 * @returns 32 hex characters, or null.
 */
export async function visitorId({ ip, userAgent, salt }: VisitorIdArgs): Promise<string | null> {
  if (!salt || !ip) {
    return null;
  }

  // Newline-separated so the fields cannot run together: unseparated, the pairs
  // ("1.2.3.4", "5Mozilla") and ("1.2.3.45", "Mozilla") would hash identically.
  const input = new TextEncoder().encode(`${ip}\n${userAgent || ""}\n${salt}`);

  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", input));

  // 128 of the 256 bits: far past collision-free at any traffic this site will see, and
  // sending Google twice the identifier it needs is twice the thing to explain.
  let hex = "";

  // subarray rather than an index loop: under `noUncheckedIndexedAccess` a
  // `digest[i]` is `number | undefined`, and iterating the slice is both the
  // honest expression of "the first 16 bytes" and free of the assertion.
  for (const byte of digest.subarray(0, 16)) {
    hex += byte.toString(16).padStart(2, "0");
  }

  return hex;
}
