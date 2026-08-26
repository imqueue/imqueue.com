// markdown-link.ts — where a page's plain-markdown mirror is, and who is told.
//
// Three consumers, ONE rule:
//
//   * src/{org,com}/*.11tydata.ts  -> `hasMirror` computed data, which head.html
//     turns into <link rel="alternate" type="text/markdown"> and
//     mirror-link.html turns into the visible "read as markdown" link.
//   * functions/_middleware.ts     -> the `Link: …; rel="alternate"` header.
//   * scripts/check-agent-analytics.ts -> asserts the cases below.
//
// The first two used to be two hand-written copies of the same condition in two
// languages. They are one function now, imported by both, which is why this file
// exists at all rather than the logic living where it is used.
//
// The rule itself is the NEGATION of check-sitemap.ts's mirror-coverage
// exclusions, and that assertion is the invariant it depends on: every indexable
// page has a mirror EXCEPT archived API majors and paginated /blog/page/N/. If that
// assertion is ever relaxed, this goes stale — hence the cross-reference in both
// files.
//
// On leverage, honestly: no major crawler is documented to follow either the head
// link or the header, so both are cheap future-proofing. Cloudflare's own docs ship
// both at the same URL shape this site serves, which is the argument for parity
// rather than for effect. The half of this with a real mechanism is the VISIBLE
// link, because that one enters the ordinary crawlable link graph. What the mirror
// buys today is token efficiency: 25,538 B of HTML vs 2,641 B of markdown on

// Paths with no mirror, on purpose.
const NO_MIRROR: readonly RegExp[] = [
  // Paginated blog listings: /blog/index.md already lists every article, which is
  // what an agent wants — one fetch, the whole index.
  /\/page\/\d+\/$/,
  // Archived API majors are noindex and unmirrored; only /api/ itself, the
  // hand-written /api/faq/ and the /latest/ trees have mirrors. Reads as "under
  // /api/, not /api/ itself, not /api/faq/, and not inside a /latest/ tree".
  /^\/api\/(?!$)(?!faq\/$)(?!.*\/latest\/)/,
];

/** Front-matter flags that suppress a mirror. */
export interface MirrorFlags {
  /**
   * Excludes, because the contentMd collection in eleventy.config.mts skips
   * drafts, so no mirror is emitted for them.
   */
  draft?: boolean;
  /** The per-page opt-out. */
  mirror?: boolean;
}

/**
 * Does this page have a `<url>index.md` mirror?
 *
 * `noindex` deliberately does NOT exclude. check-sitemap.ts does not *require* a
 * mirror for a noindex page, which is not the same as a noindex page not having
 * one — /agents/delayed-scheduled-work/ and /agents/isolated-imq-environments/
 * are noindex on purpose and both have mirrors, and an earlier version of this
 * rule left exactly those two undeclared. The pages that genuinely have no
 * mirror are covered by NO_MIRROR above, by URL, which is the honest test.
 *
 * @param pathname root-relative, directory-shaped ("/cli/installation/")
 */
export function hasMarkdownMirror(pathname: string, flags: MirrorFlags = {}): boolean {
  const path = String(pathname || "");

  // Only directory-shaped URLs: `<url>index.md` is meaningless for /llms.txt or
  // /favicon.svg.
  if (!path.startsWith("/") || !path.endsWith("/")) return false;
  if (flags.mirror === false || flags.draft) return false;

  return !NO_MIRROR.some((skip) => skip.test(path));
}

/** Arguments to {@link markdownLink}. */
export interface MarkdownLinkArgs {
  url: URL;
  status: number;
  response: { headers: { get: (name: string) => string | null } };
}

/**
 * The `Link:` header value for a response, or null when there should be none.
 *
 * Deliberately conservative: 200 text/html only. A header advertising a mirror on
 * a 404 is worse than no header.
 */
export function markdownLink({ url, status, response }: MarkdownLinkArgs): string | null {
  if (status !== 200) return null;

  const type = response && response.headers ? response.headers.get("content-type") : "";

  if (!String(type || "").includes("text/html")) return null;
  if (!hasMarkdownMirror(url.pathname)) return null;

  return `<${url.origin}${url.pathname}index.md>; rel="alternate"; type="text/markdown"`;
}
