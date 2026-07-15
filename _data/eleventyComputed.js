module.exports = {
  // Reproduce Jekyll's flat output: get-started.md -> /get-started.html.
  // Respect any explicit front-matter permalink (e.g. sitemap.xml).
  permalink: (data) => {
    if (data.permalink && data.permalink !== true) {
      return data.permalink;
    }
    return `${data.page.filePathStem}.html`;
  },
};
