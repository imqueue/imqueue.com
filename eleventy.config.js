const yaml = require("js-yaml");

module.exports = function (eleventyConfig) {
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
