// Map src/org/** to the site root: src/org/index.html -> "/",
// src/org/tutorial/index.md -> "/tutorial/", src/org/get-started.md -> "/get-started/".
// An explicit `permalink:` in a page's front matter still wins.
module.exports = {
  eleventyComputed: {
    permalink: (data) => {
      if (data.permalink) return data.permalink;
      let stem = data.page.filePathStem.replace(/^\/(org|com)/, "");
      stem = stem.replace(/\/index$/, "/");
      if (stem === "") stem = "/";
      if (!stem.endsWith("/")) stem += "/";
      return stem;
    },
  },
};
