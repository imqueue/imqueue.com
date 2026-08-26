// Shared data for every tutorial chapter: the chapter list (for the sidebar and
// prev/next nav) plus the layout/section. Each chapter page sets its own
// `chapter` number, `title`, `docLabel` and `lead` in front matter.
import type { EleventyData } from '../../../scripts/lib/eleventy.ts';

const chapters = [
  { n: 1, title: "Introduction", url: "/tutorial/" },
  { n: 2, title: "User Service", url: "/tutorial/user-service/" },
  { n: 3, title: "Auth Service", url: "/tutorial/auth-service/" },
  { n: 4, title: "Domain Services", url: "/tutorial/other-services/" },
  { n: 5, title: "API Integration", url: "/tutorial/api-service/" },
  { n: 6, title: "Deployment", url: "/tutorial/deployment/" },
  { n: 7, title: "Bonus: REST API", url: "/tutorial/rest-api/" },
  { n: 8, title: "Bonus: REST Web App", url: "/tutorial/rest-web-app/" },
];

export default {
  layout: "tutorial.html",
  section: "tutorial",
  tutorialChapters: chapters,
  // Reverse mesh: blog topics this area is about (drives "From the blog").
  relatedTopics: ["architecture", "rpc", "testing", "clients", "migration"],
  eleventyComputed: {
    tutPrev: (data: EleventyData) => (data.chapter ? chapters[data.chapter - 2] || null : null),
    tutNext: (data: EleventyData) => (data.chapter ? chapters[data.chapter] || null : null),
  },
};
