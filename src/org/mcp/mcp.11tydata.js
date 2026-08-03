// Shared data for every /mcp/ page: the chapter list (sidebar + prev/next) plus
// the layout/section. Unlike /cli/, these pages are authored directly here (no
// wiki sync); each page sets its own `chapter`, `title`, `docLabel` and `lead`
// in front matter. Add/re-order a chapter here and the sidebar + prev/next
// follow automatically.
const chapters = [
  { n: 1, title: "Overview", url: "/mcp/" },
  { n: 2, title: "Add to your AI tool", url: "/mcp/installation/" },
  { n: 3, title: "Tools reference", url: "/mcp/tools/" },
  { n: 4, title: "Agent workflows", url: "/mcp/workflows/" },
  { n: 5, title: "Safety & troubleshooting", url: "/mcp/security/" },
];

module.exports = {
  layout: "mcp.html",
  section: "docs",
  mcpChapters: chapters,

  // Emit the `#mcp` SoftwareApplication node on EVERY page of this section, not
  // just the overview. /mcp/tools/ and /mcp/installation/ carried no #mcp node at
  // all, so the two pages an agent is most likely to land on for tool names and
  // setup declared themselves `about` the RPC framework and said nothing about the
  // server they document.
  mcpApp: true,

  // Reverse mesh: blog topics these pages are about (drives "From the blog").
  relatedTopics: ["dx", "tooling", "clients"],
  eleventyComputed: {
    mcpPrev: (data) => (data.chapter ? chapters[data.chapter - 2] || null : null),
    mcpNext: (data) => (data.chapter ? chapters[data.chapter] || null : null),
  },
};
