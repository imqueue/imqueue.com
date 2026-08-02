const yaml = require("js-yaml");
const syntaxHighlight = require("@11ty/eleventy-plugin-syntaxhighlight");

// ---- Edition switch -------------------------------------------------------
// One repo, two editions. Pick with EDITION=com|org (default: org).
//   EDITION=org  -> imqueue.org, "Terminal" skin, output _site-org
//   EDITION=com  -> imqueue.com, "Flux" skin,     output _site-com
const { buildAssetManifest } = require("./scripts/lib/asset-manifest.js");

const EDITION = (process.env.EDITION || "org").toLowerCase();
const isCom = EDITION === "com";
const SKIN = isCom ? "flux" : "terminal";
const SITE_URL = isCom ? "https://imqueue.com" : "https://imqueue.org";
const OTHER_URL = isCom ? "https://imqueue.org" : "https://imqueue.com";
const OUTPUT = isCom ? "_site-com" : "_site-org";

// Computed once at config time (sync fs reads) so the hashed names are available
// both to addPassthroughCopy and to the `asset` filter.
const ASSETS = buildAssetManifest(__dirname, EDITION);

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
  // Page front matter can override `ogType`, `ogImage` and `description`; these
  // are the site-wide fallbacks head.html reaches for.
  //
  // There is no `siteKeywords` any more: it only ever fed <meta name="keywords">,
  // which Google has ignored since 2009. Per-page `keywords` front matter is
  // still read — post.html puts it in BlogPosting.keywords, which is a real
  // schema.org property.
  eleventyConfig.addGlobalData("siteImage", `${SITE_URL}/images/og-${EDITION}.png`);
  eleventyConfig.addGlobalData("siteLocale", "en_US");
  eleventyConfig.addGlobalData("themeColor", isCom ? "#0c0a17" : "#0a0e0d");
  eleventyConfig.addGlobalData("twitterHandle", "@imqueue");

  // ---- analytics (per edition, from the environment) -----------------------
  // These ids used to be hardcoded here, both editions sharing one GA4 property,
  // and the pair was wrong: the id in this file belongs to the property named
  // imqueue.com, so imqueue.org's traffic was recorded there while the property
  // named imqueue.org received nothing from the page. A repo cannot tell you which
  // property owns an id, which is exactly why they do not belong in a repo.
  //
  // Each Pages project now supplies its own, so the deployment is the single source
  // of truth and the two sites cannot silently share a property again:
  //
  //   GA4_MEASUREMENT_ID     G-… for THIS edition's property
  //   CLARITY_PROJECT_ID     Clarity project id for this edition
  //
  // Suffixed forms win when present (GA4_MEASUREMENT_ID_ORG / _COM), which is what
  // makes a local `npm run build:all` able to give each edition its own id in one
  // process. Unset means the tag is not emitted at all — so a local build, a fork
  // and a preview deploy send nothing to production analytics. That is a feature:
  // the previous arrangement had every `npm run serve:org` reporting as real traffic.
  // null, never "" — Liquid treats an empty string as TRUTHY, so `{% if analytics.ga4 %}`
  // in head.html would happily emit a tag with no id. Only nil and false are falsy there.
  const envId = (name) =>
    process.env[`${name}_${EDITION.toUpperCase()}`] || process.env[name] || null;

  const ANALYTICS = {
    ga4: envId("GA4_MEASUREMENT_ID"),
    clarity: envId("CLARITY_PROJECT_ID"),
  };

  const ANALYTICS_ENV = { ga4: "GA4_MEASUREMENT_ID", clarity: "CLARITY_PROJECT_ID" };
  const missing = Object.keys(ANALYTICS).filter((k) => !ANALYTICS[k]);

  // On Cloudflare (CF_PAGES=1) a missing id is a FAILED DEPLOY, not a warning. Losing
  // analytics silently is what this whole change is about: the ids were wrong for
  // weeks, and then present-but-unreadable, and in both cases the site served happily
  // while collecting nothing. A build that stops is noticed in minutes.
  //
  // The most likely cause is worth stating in the log, because the dashboard makes it
  // look configured: an ENCRYPTED Pages variable is not available at build time. Per
  // Cloudflare's docs, plaintext variables are exposed "at runtime and build-time"
  // while secrets are only readable "programmatically on context.env" — so an
  // encrypted id can never reach this file. These ids are public (they ship in page
  // source); store them as plaintext. Also check the scope is Production, not Preview.
  if (missing.length && process.env.CF_PAGES) {
    throw new Error(
      `[analytics] ${missing.map((k) => ANALYTICS_ENV[k]).join(" and ")} not readable `
      + `during the ${EDITION} build.\n`
      + "  * Encrypted Pages variables are runtime-only — store these as PLAINTEXT.\n"
      + "  * Check the scope is Production, and that they are on the right project.\n"
      + "  * Suffixed forms also work: "
      + missing.map((k) => `${ANALYTICS_ENV[k]}_${EDITION.toUpperCase()}`).join(", "),
    );
  }

  for (const key of missing) {
    console.log(
      `[analytics] ${key} tag not emitted for ${EDITION} — ${ANALYTICS_ENV[key]} is unset`,
    );
  }

  eleventyConfig.addGlobalData("analytics", ANALYTICS);

  // Full ISO 8601 for structured data and OG article timestamps. Schema.org and
  // Open Graph both want an unambiguous instant; the date-only "%Y-%m-%d" that
  // used to be emitted leaves the time zone to the consumer's guess.
  eleventyConfig.addFilter("isoDate", (value) => {
    const d = value instanceof Date ? value : new Date(value);
    return Number.isNaN(d.getTime()) ? "" : d.toISOString();
  });

  // Build only the active edition's pages.
  eleventyConfig.ignores.add(isCom ? "src/org/**" : "src/com/**");

  // Markdown content pages (docs/tutorial/cli/get-started) — used to emit
  // per-page ".md" mirrors, which is what AI agents read: the @imqueue MCP
  // server's get_doc fetches "<page-url>index.md".
  //
  // The generated API reference is included, but only its /latest/ pages plus
  // the /api/ landing page. Archived majors are left out deliberately: they are
  // already noindex, and an agent should never be handed a stale API surface.
  const API_MIRRORED = /^\/api\/$|^\/api\/[^/]+\/latest\//;
  eleventyConfig.addCollection("contentMd", (api) =>
    api.getAll().filter((item) => {
      const url = item.url || "";

      if (!item.inputPath.endsWith(".md") || item.data.draft) {
        return false;
      }

      return url.includes("/api/") ? API_MIRRORED.test(url) : true;
    })
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

  // Blog topic hubs (.org only). Posts already declare `topics:`, but nothing
  // turned that into pages, so the blog had no taxonomy: no intermediate pages
  // to pass link equity through, and 18 of 26 posts sat 3+ clicks from the home
  // page because /blog/ only surfaced the newest 8.
  //
  // A topic needs MIN_TOPIC_POSTS posts to get a hub. Below that a hub is one
  // link on a near-empty page, which is index bloat rather than a taxonomy.
  const MIN_TOPIC_POSTS = 3;
  eleventyConfig.addCollection("blogTopics", (api) => {
    const meta = require("./src/_data/blogTopics.json");
    const byTopic = new Map();

    for (const post of api
      .getFilteredByGlob("src/org/blog/posts/*.md")
      .filter((p) => !p.data.draft)
      .sort((a, b) => b.date - a.date)) {
      for (const slug of post.data.topics || []) {
        if (!byTopic.has(slug)) byTopic.set(slug, []);
        byTopic.get(slug).push(post);
      }
    }

    return [...byTopic.entries()]
      .filter(([slug, posts]) =>
        posts.length >= MIN_TOPIC_POSTS && meta[slug] && meta[slug].title)
      .map(([slug, posts]) => ({
        slug,
        posts,
        label: meta[slug].label,
        title: meta[slug].title,
        description: meta[slug].description,
      }))
      .sort((a, b) => b.posts.length - a.posts.length || a.slug.localeCompare(b.slug));
  });

  // ---- agent-facing markdown ----------------------------------------------
  // api-documenter emits HTML tables inside its markdown, plus `<!-- -->`
  // spacers and HTML-escaped angle brackets. That renders correctly as HTML but
  // is pure overhead for anything reading the ".md" mirror, so flatten it to
  // real markdown there. Hand-written pages are passed through untouched.
  const API_DOC_MARKER =
    "<!-- Do not edit this file. It is automatically generated by API Documenter. -->";

  // Only `<!-- -->` is markup inside a cell. A generic <...> strip would eat
  // literal placeholders that belong to the prose — `<prefix>:<name>`, `<T>`
  // and `<channel>` all appear in cells.
  const cell = (html) =>
    html
      .replace(/<!-- -->/g, "")
      .replace(/\s+/g, " ")
      .replace(/(?<!\\)\|/g, "\\|") // api-documenter pre-escapes union pipes
      .trim();

  const tableToMarkdown = (table) => {
    const head = [...table.matchAll(/<th>([\s\S]*?)<\/th>/g)].map((m) =>
      cell(m[1])
    );

    if (!head.length) {
      return table; // unrecognised shape — leave it alone
    }

    const rows = [...table.matchAll(/<tr>\s*<td>([\s\S]*?)<\/tr>/g)].map((m) =>
      m[1].split(/<\/td>\s*<td>/).map((c) => cell(c.replace(/<\/td>\s*$/, "")))
    );

    return `\n${[
      `| ${head.join(" | ")} |`,
      `| ${head.map(() => "---").join(" | ")} |`,
      ...rows.map((r) => `| ${r.join(" | ")} |`),
    ].join("\n")}\n`;
  };

  eleventyConfig.addFilter("agentMarkdown", (content) => {
    let out = String(content == null ? "" : content);
    const generated = out.includes(API_DOC_MARKER);

    out = out.replace(/<table>[\s\S]*?<\/table>/g, tableToMarkdown);

    if (generated) {
      out = out
        .split(API_DOC_MARKER)
        .join("") // an instruction to repo contributors, not to readers
        .replace(/<!-- -->/g, "")
        .replace(/&gt;/g, ">")
        .replace(/&lt;/g, "<")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&amp;/g, "&"); // last, so &amp;gt; does not become >
    }

    return out.replace(/\n{3,}/g, "\n\n").trim();
  });

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

  // Reverse mesh: given a list of topics (declared by a docs/tutorial/cli area),
  // return the blog posts sharing the most topics, newest first. Drafts excluded.
  // Unlike `related` it does NOT backfill — a docs page only links posts that are
  // genuinely on-topic (empty result -> the "From the blog" block is omitted).
  eleventyConfig.addFilter("postsByTopics", (posts, topics, limit) => {
    const want = new Set(topics || []);
    if (!want.size) return [];
    return (posts || [])
      .filter((p) => !p.data.draft)
      .map((p) => ({ p, score: (p.data.topics || []).filter((t) => want.has(t)).length }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score || b.p.date - a.p.date)
      .slice(0, limit || 4)
      .map((x) => x.p);
  });

  // Static assets: shared first, then the active edition's theme css (same /css dir).
  eleventyConfig.addPassthroughCopy({ "src/_shared/fonts": "fonts" });

  // CSS + JS are emitted under content-hashed filenames and referenced through the
  // `asset` filter, which is what lets /css/* and /js/* be cached immutably (see
  // scripts/lib/asset-manifest.js for the deploy bug this fixes, and
  // src/headers.liquid for the matching Cache-Control). Only hashed names are
  // written — no unhashed copy — so a wildcard immutable header cannot ever apply
  // to a mutable URL.
  for (const [from, to] of ASSETS.copies) {
    eleventyConfig.addPassthroughCopy({ [from]: to });
  }
  eleventyConfig.addGlobalData("assetManifest", ASSETS.manifest);

  // Resolve a logical asset URL ("/css/base.css") to its hashed one. Throws on an
  // unknown path rather than passing it through: a silent miss would emit a 404ing
  // stylesheet that renders as an unstyled page, and the link checker only sees
  // what the templates actually wrote.
  eleventyConfig.addFilter("asset", function (url) {
    const hashed = ASSETS.manifest[url];

    if (!hashed) {
      throw new Error(
        `asset filter: no hashed build of "${url}". ` +
          `Known: ${Object.keys(ASSETS.manifest).join(", ")}`,
      );
    }
    return hashed;
  });

  eleventyConfig.addPassthroughCopy({ "images": "images" });
  eleventyConfig.addPassthroughCopy({ [`src/${EDITION}/favicon.svg`]: "favicon.svg" });
  eleventyConfig.addPassthroughCopy({ [`src/${EDITION}/favicon.ico`]: "favicon.ico" });
  // robots.txt + sitemap.xml are generated per edition (see src/robots.liquid,
  // src/sitemap.liquid) so each domain advertises its own sitemap URL.

  // Per-edition _redirects (Cloudflare Pages). imqueue.com 301s legacy content
  // paths to imqueue.org; imqueue.org 301s retired versioned API URLs to /latest/.
  eleventyConfig.addPassthroughCopy({ [`src/${EDITION}/_redirects`]: "_redirects" });

  // API reference (current + kept archives) is now generated as native Eleventy
  // pages under src/org/api/**; the old standalone TypeDoc HTML passthrough is
  // gone. Regenerate with `npm run build-docs` (latest) / `gen-api-archive` (old).

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
