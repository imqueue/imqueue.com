// The site's heading-id rule, in one place.
//
// It lives here rather than inline in eleventy.config.mts because there are now
// THREE consumers that must agree byte-for-byte, not two: markdown-it-anchor
// (which writes the `id` attributes), markdown-it-table-of-contents (which
// writes the "On this page" hrefs), and the search index, whose prose results
// deep-link to `<page-url>#<slug>`. A second implementation anywhere means
// search results that land on the top of the page instead of the section — the
// same class of silent breakage the comment below was written about.
//
// markdown-it-anchor's DEFAULT slugify is
// `encodeURIComponent(String(s).trim().toLowerCase().replace(/\s+/g, '-'))`,
// which percent-encodes every character that is not URL-safe instead of
// removing it. That produced 132 distinct ids across 72 built pages that no
// human or model would ever reconstruct:
//
//   "Data & events"                -> data-%26-events
//   "@classType() is now required" -> %40classtype()-is-now-required…
//   "FilterInput.$eq property"     -> filterinput.%24eq-property
//   "Can you use them together?"   -> can-you-use-them-together%3F
//
// Fragment citations are how an answer engine points at the specific paragraph
// it used, and a model constructing one from a heading it can see produces the
// conventional slug, not the percent-encoded one — so every deep citation into
// this site landed on the top of the page instead of the section, and the
// "On this page" sidebar shipped unreadable hrefs.
//
// Runs of anything that is not [a-z0-9] collapse to a single hyphen, which is
// the shape of every hand-written anchor already in this repo. It is not
// byte-identical to GitHub's rule (GitHub deletes the punctuation instead of
// collapsing it, so "Data & events" becomes `data--events` with two hyphens) —
// single-hyphen is both more guessable and what our own prose already uses.
//
// The empty-result fallback matters for a heading that is entirely punctuation
// or non-Latin: an id of "" is invalid HTML and unlinkable. markdown-it-anchor
// de-duplicates whatever comes back out of here, so two headings collapsing to
// the same slug get `-1`, `-2` rather than colliding — and so does
// search-corpus.ts, for the same reason and with the same suffixes.

// `unknown` rather than `string`: markdown-it-anchor calls its slugify with
// whatever the heading token holds, and the String() below is the same coercion
// its own default performs. Narrowing the parameter would delete that coercion's
// reason to exist.
export function slugify(s: unknown): string {
  const slug = String(s)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return slug || "section";
}
