// Shared data for every @imqueue/cli manual page: the chapter list (for the
// sidebar and prev/next nav) plus the layout/section. The chapter order, URLs
// and labels are derived from the editorial manifest so adding/re-ordering a
// chapter there updates the sidebar automatically. Each page's own `chapter`
// number/title/lead/docLabel come from its (generated) front matter.
const { pages } = require("../../../scripts/cli-wiki-manifest.js");

const chapters = pages.map((p, i) => ({ n: i + 1, title: p.nav, url: p.url }));

module.exports = {
  layout: "cli.html",
  section: "docs",
  cliChapters: chapters,
  eleventyComputed: {
    cliPrev: (data) => (data.chapter ? chapters[data.chapter - 2] || null : null),
    cliNext: (data) => (data.chapter ? chapters[data.chapter] || null : null),
  },
};
