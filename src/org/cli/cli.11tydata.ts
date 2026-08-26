// Shared data for every @imqueue/cli manual page: the chapter list (for the
// sidebar and prev/next nav) plus the layout/section. The chapter order, URLs
// and labels are derived from the editorial manifest so adding/re-ordering a
// chapter there updates the sidebar automatically. Each page's own `chapter`
// number/title/lead/docLabel come from its (generated) front matter.
import type { EleventyData } from '../../../scripts/lib/eleventy.ts';

import { pages } from "../../../scripts/cli-wiki-manifest.ts";

const chapters = pages.map((p, i) => ({ n: i + 1, title: p.nav, url: p.url }));

export default {
  layout: "cli.html",
  section: "docs",
  cliChapters: chapters,
  // Reverse mesh: blog topics this area is about (drives "From the blog").
  relatedTopics: ["clients", "dx", "tooling", "versioning", "types"],
  eleventyComputed: {
    cliPrev: (data: EleventyData) => (data.chapter ? chapters[data.chapter - 2] || null : null),
    cliNext: (data: EleventyData) => (data.chapter ? chapters[data.chapter] || null : null),
  },
};
