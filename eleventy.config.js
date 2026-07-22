const yaml = require("js-yaml");
const syntaxHighlight = require("@11ty/eleventy-plugin-syntaxhighlight");

// ---- Edition switch -------------------------------------------------------
// One repo, two editions. Pick with EDITION=com|org (default: org).
//   EDITION=org  -> imqueue.org, "Terminal" skin, output _site-org
//   EDITION=com  -> imqueue.com, "Flux" skin,     output _site-com
const EDITION = (process.env.EDITION || "org").toLowerCase();
const isCom = EDITION === "com";
const SKIN = isCom ? "flux" : "terminal";
const SITE_URL = isCom ? "https://imqueue.com" : "https://imqueue.org";
const OTHER_URL = isCom ? "https://imqueue.org" : "https://imqueue.com";
const OUTPUT = isCom ? "_site-com" : "_site-org";

module.exports = function (eleventyConfig) {
  const markdownIt = require("markdown-it");
  const mdAnchor = require("markdown-it-anchor");
  const mdToc = require("markdown-it-table-of-contents");
  const mdAttrs = require("markdown-it-attrs");

  const md = markdownIt({ html: true, linkify: false, typographer: false })
    .use(mdAttrs)
    .use(mdAnchor, { permalink: false, tabIndex: false })
    .use(mdToc, {
      includeLevel: [2, 3],
      containerHeaderHtml: undefined,
      markerPattern: /^\[\[toc\]\]/im,
    });

  eleventyConfig.setLibrary("md", md);
  eleventyConfig.addPlugin(syntaxHighlight);

  // Standard LiquidJS: quoted/variable partials + comma-separated include args.
  eleventyConfig.setLiquidOptions({
    dynamicPartials: true,
    jekyllInclude: false,
    strictFilters: false,
  });

  eleventyConfig.addDataExtension("yml", (contents) => yaml.load(contents));

  // Edition-wide values available in every template.
  eleventyConfig.addGlobalData("edition", EDITION);
  eleventyConfig.addGlobalData("skin", SKIN);
  eleventyConfig.addGlobalData("siteUrl", SITE_URL);
  eleventyConfig.addGlobalData("otherUrl", OTHER_URL);
  eleventyConfig.addGlobalData("siteName", "@imqueue");

  // ---- SEO defaults (per edition) -----------------------------------------
  // Page front matter can override `keywords`, `ogType`, `ogImage` and
  // `description`; these are the site-wide fallbacks head.html reaches for.
  const ORG_KEYWORDS = [
    "@imqueue", "imqueue", "Node.js message queue", "TypeScript RPC",
    "message queue RPC", "RPC over Redis", "Redis message queue",
    "microservices framework", "Node.js microservices",
    "TypeScript microservices", "service-oriented architecture", "SOA",
    "inter-service communication", "self-describing services",
    "typed RPC framework", "distributed systems", "message broker",
    "scalable back-end services", "GraphQL microservices",
  ].join(", ");
  const COM_KEYWORDS = [
    "@imqueue commercial license", "imqueue license",
    "GPL-3.0 commercial license", "dual license", "closed-source license",
    "commercial support", "SLA support", "Node.js microservices support",
    "TypeScript RPC framework", "message queue RPC", "enterprise microservices",
    "commercial license Node.js framework",
  ].join(", ");
  eleventyConfig.addGlobalData("siteKeywords", isCom ? COM_KEYWORDS : ORG_KEYWORDS);
  eleventyConfig.addGlobalData("siteImage", `${SITE_URL}/images/og-${EDITION}.png`);
  eleventyConfig.addGlobalData("siteLocale", "en_US");
  eleventyConfig.addGlobalData("themeColor", isCom ? "#0c0a17" : "#0a0e0d");
  eleventyConfig.addGlobalData("twitterHandle", "@imqueue");

  // Build only the active edition's pages.
  eleventyConfig.ignores.add(isCom ? "src/org/**" : "src/com/**");

  // Markdown content pages (docs/tutorial/cli/get-started) — used to emit
  // per-page ".md" mirrors and the concatenated llms-full.txt. Excludes the
  // generated API reference, which is HTML-only and too large/thin to mirror.
  eleventyConfig.addCollection("contentMd", (api) =>
    api.getAll().filter(
      (item) =>
        item.inputPath.endsWith(".md") &&
        !(item.url || "").includes("/api/") &&
        !item.data.draft
    )
  );

  // Blog posts (.org only) — src/org/blog/posts/*.md, newest→oldest by date.
  // Drafts (front matter `draft: true`) build to their URL but are kept out of
  // the index listing.
  eleventyConfig.addCollection("posts", (api) =>
    api
      .getFilteredByGlob("src/org/blog/posts/*.md")
      .filter((item) => !item.data.draft)
      .sort((a, b) => b.date - a.date)
  );

  // Posts written by a given author slug (newest first).
  eleventyConfig.addFilter("byAuthor", (posts, slug) =>
    (posts || []).filter((p) => p.data.author === slug)
  );

  // Look up a single author record by slug from the authors data list.
  eleventyConfig.addFilter("authorBySlug", (authors, slug) =>
    (authors || []).find((a) => a.slug === slug)
  );

  // Related posts: others sharing the most `topics` with the current one,
  // newest first as the tie-breaker; falls back to filling with recent posts.
  eleventyConfig.addFilter("related", (posts, currentUrl, topics, limit) => {
    const want = new Set(topics || []);
    const others = (posts || []).filter((p) => p.url !== currentUrl);
    const scored = others
      .map((p) => ({
        p,
        score: (p.data.topics || []).filter((t) => want.has(t)).length,
      }))
      .sort((a, b) => b.score - a.score || b.p.date - a.p.date);
    const n = limit || 5;
    const picked = scored.filter((x) => x.score > 0).slice(0, n).map((x) => x.p);
    if (picked.length < n) {
      for (const x of scored) {
        if (picked.length >= n) break;
        if (!picked.includes(x.p)) picked.push(x.p);
      }
    }
    return picked;
  });

  // Static assets: shared first, then the active edition's theme css (same /css dir).
  eleventyConfig.addPassthroughCopy({ "src/_shared/fonts": "fonts" });
  eleventyConfig.addPassthroughCopy({ "src/_shared/css": "css" });
  eleventyConfig.addPassthroughCopy({ "src/_shared/js": "js" });
  eleventyConfig.addPassthroughCopy({ [`src/${EDITION}/css`]: "css" });
  eleventyConfig.addPassthroughCopy({ [`src/${EDITION}/js`]: "js" });
  eleventyConfig.addPassthroughCopy({ "images": "images" });
  eleventyConfig.addPassthroughCopy({ [`src/${EDITION}/favicon.svg`]: "favicon.svg" });
  eleventyConfig.addPassthroughCopy({ [`src/${EDITION}/favicon.ico`]: "favicon.ico" });
  // robots.txt + sitemap.xml are generated per edition (see src/robots.liquid,
  // src/sitemap.liquid) so each domain advertises its own sitemap URL.

  // Per-edition _redirects (Cloudflare Pages). imqueue.com 301s legacy content
  // paths to imqueue.org; imqueue.org 301s retired versioned API URLs to /latest/.
  eleventyConfig.addPassthroughCopy({ [`src/${EDITION}/_redirects`]: "_redirects" });

  // Generated API reference docs (api-documenter output) — .org only.
  if (!isCom) {
    eleventyConfig.addPassthroughCopy({ "api/core": "api/core" });
    eleventyConfig.addPassthroughCopy({ "api/rpc": "api/rpc" });
    eleventyConfig.addPassthroughCopy({ "api/assets": "api/assets" });
  }

  return {
    dir: {
      input: "src",
      output: OUTPUT,
      includes: "_shared/_includes",
      layouts: "_shared/_includes",
      data: "_data",
    },
    markdownTemplateEngine: "liquid",
    htmlTemplateEngine: "liquid",
  };
};
