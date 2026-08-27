// lib/security-txt.ts — the dynamic /.well-known/security.txt handler (RFC 9116).
//
// WHY DYNAMIC, not a static file. RFC 9116 requires an `Expires` field and treats
// the file as stale past it. A static file freezes whatever date was written and
// needs a manual edit before every expiry. This site runs an edge runtime
// (Cloudflare Pages Functions), so the file is served from functions/_middleware.ts
// instead, and `Expires` is computed PER REQUEST as now + VALIDITY_DAYS. It can
// therefore never go stale, whatever the deploy cadence, with zero maintenance.
//
// Kept self-contained and side-effect-free: the only thing baked in is the contact
// address, which is public by design (RFC 9116 files are meant to be read by anyone)
// and per-edition — imqueue.org and imqueue.com each answer with their own domain,
// derived from the request host so one function serves both Pages projects.
//
// Exercised locally by the same middleware the pentest harness routes through
// (scripts/security/*), and asserted on every build by the rfc9116/* checks — so the
// live handler, not a static preview, is what the tests measure.

/** The well-known location every researcher and scanner checks (RFC 9116 §3). */
export const SECURITY_TXT_PATH = "/.well-known/security.txt";

// 90 days: comfortably fresh, short enough to signal the file is maintained, and —
// because it is recomputed on every request — never actually reached.
const VALIDITY_DAYS = 90;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The edition domain for a request host: strips a `www.` prefix and pins anything
 * that is not imqueue.com to imqueue.org (the docs edition, and the target the
 * parked-domain redirect already sends everything else to).
 */
function editionDomain(host: string): "imqueue.org" | "imqueue.com" {
  return host.replace(/^www\./i, "").toLowerCase() === "imqueue.com"
    ? "imqueue.com"
    : "imqueue.org";
}

/**
 * Build the RFC 9116 response for the given request host. Pure — no I/O, cannot
 * throw on any string input — so the middleware can call it on the hot path without
 * risking the "never throw" guarantee the rest of that file depends on.
 */
export function securityTxt(host: string): Response {
  const domain = editionDomain(host);

  // Full ISO-8601 UTC, per RFC 9116's example. `now` is the request time on the
  // edge, so every fetch gets a fresh 90-day horizon.
  const expires = new Date(Date.now() + VALIDITY_DAYS * DAY_MS).toISOString();

  // Contact is REQUIRED and must be an inbox that is actually monitored — the whole
  // point of the file is being reachable. security@<domain> is expected to alias to
  // the maintainers' security channel (see SECURITY.md).
  const body =
    [
      "# Security policy for @imqueue — see https://www.rfc-editor.org/rfc/rfc9116",
      "# Please report vulnerabilities privately. Do not open a public issue or PR.",
      `Contact: mailto:security@${domain}`,
      `Expires: ${expires}`,
      "Preferred-Languages: en",
      `Canonical: https://${domain}${SECURITY_TXT_PATH}`,
      "Policy: https://github.com/imqueue/imqueue.com/security/policy",
    ].join("\n") + "\n";

  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      // Belt and braces: the file is text/plain and must be read as such, never
      // sniffed into something executable.
      "X-Content-Type-Options": "nosniff",
      // A short cache is harmless against a 90-day validity window and keeps the
      // edge from recomputing on every hit while still letting a change propagate
      // within a day.
      "Cache-Control": "public, max-age=86400",
    },
  });
}
