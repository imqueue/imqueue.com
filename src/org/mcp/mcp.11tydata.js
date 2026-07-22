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
  // Reverse mesh: blog topics these pages are about (drives "From the blog").
  relatedTopics: ["dx", "tooling", "clients"],
  eleventyComputed: {
    mcpPrev: (data) => (data.chapter ? chapters[data.chapter - 2] || null : null),
    mcpNext: (data) => (data.chapter ? chapters[data.chapter] || null : null),
  },
};
