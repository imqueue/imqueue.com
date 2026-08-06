// Emits /search-frontmatter.json — every page's curated `description` and `keywords`,
// keyed by URL, for scripts/lib/search-corpus.js to fold into the search index.
//
// A BUILD INTERMEDIATE, not a published feed: the generator reads it and deletes it, so
// it never reaches the deployed site. That is deliberate — it duplicates data already
// public in llms.txt and in each page's meta description, and one more machine-readable
// index of the same facts is a maintenance surface with no consumer.
//
// WHY IT HAS TO EXIST AT ALL
//
// The search corpus is built from the markdown MIRRORS (see search-corpus.js for why),
// and the mirrors carry `# Title` plus a Source/Published/Author block and nothing else.
// Front matter is not in them by design. So the two most deliberately curated relevance
// signals on the site were absent from its own search:
//
//   * `description` — the corpus used each page's first paragraph as its summary instead
//   * `keywords`    — unused entirely. 186 curated phrases across 29 posts, 140 of which
//                     appear nowhere in the indexed text, so the page written for
//                     "nodejs backpressure microservices" did not appear in that query's
//                     32 results at all
//
// WHY A TEMPLATE AND NOT A FRONT-MATTER PARSE
//
// The generator runs post-build over `_site-*`, and mapping a source file back to its URL
// means re-deriving permalink resolution — which Eleventy owns, and which this repo has
// already been bitten by duplicating (see the two `search-index.11ty.js` headers). Asking
// Eleventy for `item.url` cannot drift from what Eleventy actually published.
//
// `/api/` is excluded: those descriptions are generated from the source's own doc comments
// by scripts/lib/api-summary.js, and /api/search-index.json already carries them.

module.exports = class SearchFrontmatter {
  data() {
    return {
      permalink: "/search-frontmatter.json",
      eleventyExcludeFromCollections: true,
    };
  }

  render(data) {
    const pages = {};

    for (const item of data.collections.all || []) {
      const url = item.url || "";

      // `/api/faq/` is the exception: hand-authored prose with a curated
      // description and keyword list of its own, not a generated summary.
      if (!url || (url.startsWith("/api/") && url !== "/api/faq/")) {
        continue;
      }

      const description = item.data.description || "";
      // `summary` is the blog's longer form; a post has both, and the longer one names
      // more of what the post actually answers.
      const summary = item.data.summary || "";
      const keywords = item.data.keywords || "";

      if (!description && !keywords && !summary) {
        continue;
      }

      pages[url] = {
        d: String(summary || description).replace(/\s+/g, " ").trim(),
        k: String(keywords).replace(/\s+/g, " ").trim(),
      };
    }

    return JSON.stringify(pages);
  }
};
