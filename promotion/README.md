# promotion/

Zero-budget promotion assets for @imqueue. Working material — **not part of the
site build** (Eleventy's input is `src/`, so nothing here is published
automatically). See the full plan in the project memory / SEO-GEO notes.

## Contents

- **`devto/`** — the 19 live blog posts as dev.to / Hashnode-ready markdown.
  Regenerate with `npm run gen-syndication` (script:
  [`scripts/gen-syndication.js`](../scripts/gen-syndication.js)). Each file has
  `canonical_url` back to imqueue.org (so syndication credits the original, no
  duplicate-content penalty), a `cover_image`, up-to-4 dev.to tags, and all links
  rewritten to absolute URLs. `published: false` uploads them as drafts — review,
  then flip to publish. Cadence: 2–3/week; lead with the problem/solution posts.

- **`stackoverflow-qa.md`** — self-answer Q&A drafts mapping to the blog topics.
  Read the rules block at the top: disclose affiliation (every draft already
  does), keep answers standalone, don't mass-post, and prefer answering existing
  questions over creating new ones.

- **`github-release-notes.md`** — release-note drafts for core/rpc/cli grounded in
  real commits between tags, plus a reusable template. Release pages are indexed
  and LLM-ingested, so they're free discoverability.

## Distribution order (highest leverage first)

1. Verify/submit sitemaps in Google Search Console + Bing Webmaster, then
   `npm run indexnow:com` / `indexnow:org` after a deploy.
2. Syndicate posts to dev.to/Hashnode (canonical set), submit the benchmark post
   to Node Weekly / JavaScript Weekly.
3. Post the StackOverflow answers over a few weeks.
4. Publish the GitHub releases with real notes.
5. Awesome-list PRs, AlternativeTo/StackShare/LibHunt, Wikidata (need accounts).
