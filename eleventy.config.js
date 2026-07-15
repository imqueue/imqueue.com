const yaml = require("js-yaml");
const syntaxHighlight = require("@11ty/eleventy-plugin-syntaxhighlight");

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

  // Jekyll-compatible Liquid: allow unquoted {% include foo.html %}.
  eleventyConfig.setLiquidOptions({
    jekyllInclude: true,
    dynamicPartials: false,
    strictFilters: false,
  });

  // Eleventy's global data directory only parses .json/.js by default;
  // the site's _data/*.yml files (site, nav, whys, slides) need this to load.
  eleventyConfig.addDataExtension("yml", (contents) => yaml.load(contents));

  // Static assets copied verbatim (never run through the template engine).
  // api/ is copied by extension so the lone api/index.md stays a template.
  eleventyConfig.addPassthroughCopy("api/**/*.html");
  eleventyConfig.addPassthroughCopy("api/**/*.css");
  eleventyConfig.addPassthroughCopy("api/**/*.js");
  eleventyConfig.addPassthroughCopy("api/**/*.map");
  eleventyConfig.addPassthroughCopy("api/**/*.png");
  eleventyConfig.addPassthroughCopy("api/**/*.svg");
  eleventyConfig.addPassthroughCopy("css");
  eleventyConfig.addPassthroughCopy("js");
  eleventyConfig.addPassthroughCopy("fonts");
  eleventyConfig.addPassthroughCopy("images");
  eleventyConfig.addPassthroughCopy("favicon.ico");
  eleventyConfig.addPassthroughCopy("CNAME");
  eleventyConfig.addPassthroughCopy("TODO.txt");
  eleventyConfig.addPassthroughCopy("robots.txt");
  eleventyConfig.addPassthroughCopy(".nojekyll");

  return {
    dir: {
      input: ".",
      output: "_site",
      includes: "_includes",
      layouts: "_layouts",
      data: "_data",
    },
    markdownTemplateEngine: "liquid",
    htmlTemplateEngine: "liquid",
  };
};
