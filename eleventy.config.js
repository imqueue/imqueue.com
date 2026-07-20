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

  // Build only the active edition's pages.
  eleventyConfig.ignores.add(isCom ? "src/org/**" : "src/com/**");

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

  // imqueue.com: 301 legacy content paths to their new home on imqueue.org.
  if (isCom) {
    eleventyConfig.addPassthroughCopy({ "src/com/_redirects": "_redirects" });
  }

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
