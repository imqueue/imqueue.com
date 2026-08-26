// Map src/org/** to the site root: src/org/index.html -> "/",
// src/org/tutorial/index.md -> "/tutorial/", src/org/get-started.md -> "/get-started/".
// An explicit `permalink:` in a page's front matter still wins.
import type { EleventyData } from '../../scripts/lib/eleventy.ts';

export default {
  eleventyComputed: {
    permalink: (data: EleventyData) => {
      // A `draft: true` page must not be reachable in a production build.
      // src/org/blog/posts/case-study-template.md is `draft: true` and was serving a
      // 200 at /blog/case-study-template/ with "[COMPANY / PROJECT]" in its H1. The
      // exclusions around it were thorough — absent from the sitemap, llms.txt,
      // llms-full.txt and the mirrors, `noindex, follow`, no inbound links — so
      // exposure was limited to a crawler that ignores meta robots on a guessed URL.
      // Limited is not zero, and a placeholder page is the one thing on this site that
      // must never be quoted.
      //
      // Still built under `eleventy --serve`/`--watch`, because a draft you cannot
      // preview is a draft nobody finishes. ELEVENTY_RUN_MODE is "serve", "watch" or
      // "build"; only the last one is a deploy.
      if (data.draft && process.env.ELEVENTY_RUN_MODE === "build") return false;

      if (data.permalink) return data.permalink;
      let stem = data.page.filePathStem.replace(/^\/(org|com)/, "");
      stem = stem.replace(/\/index$/, "/");
      if (stem === "") stem = "/";
      if (!stem.endsWith("/")) stem += "/";
      return stem;
    },

    // Does this page have a plain-markdown mirror at `<url>index.md`? head.html
    // emits <link rel="alternate" type="text/markdown"> from it and
    // mirror-link.html renders the visible link; functions/_middleware.ts sends the
    // matching `Link:` header from the SAME function, which is the point of
    // computing it here rather than restating the condition in Liquid.
    //
    // Async so the ESM lib can be shared with the Cloudflare Worker; Node caches
    // the module, so this costs one import for the whole build.
    //
    // Reading `data.permalink` is what tells Eleventy's computed-data graph to
    // resolve the permalink above first — `page.url` is not reliably populated at
    // this point, and using it silently yielded false for every page.
    hasMirror: async (data: EleventyData) => {
      const { hasMarkdownMirror } = await import("../../lib/markdown-link.ts");
      // Reading `data.permalink` is what tells Eleventy's computed-data graph to
      // resolve the permalink above first, which is why it is read at all here.
      //
      // But it is not always a URL. src/org/blog/index.html sets permalink to a
      // Liquid TEMPLATE — "/blog/{% if pagination.pageNumber > 0 %}page/…" — which
      // Eleventy renders per paginated page. Passing that string through gave
      // hasMirror: false for /blog/, whose hand-written mirror does exist, while
      // /blog/page/2/ was correctly false for a different reason. So an unrendered
      // template falls through to page.url, which by this point is resolved.
      const pl = data.permalink;
      const templated = typeof pl === "string" && (pl.includes("{%") || pl.includes("{{"));
      const url = typeof pl === "string" && !templated ? pl : data.page.url;

      return hasMarkdownMirror(url, { draft: data.draft, mirror: data.mirror });
    },
  },
};
