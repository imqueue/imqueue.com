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

    // Does this page have a plain-markdown mirror at `<url>index.md`? head.html
    // emits <link rel="alternate" type="text/markdown"> from it and
    // mirror-link.html renders the visible link; functions/_middleware.js sends the
    // matching `Link:` header from the SAME function, which is the point of
    // computing it here rather than restating the condition in Liquid.
    //
    // Async so the ESM lib can be shared with the Cloudflare Worker; Node caches
    // the module, so this costs one import for the whole build.
    //
    // Reading `data.permalink` is what tells Eleventy's computed-data graph to
    // resolve the permalink above first — `page.url` is not reliably populated at
    // this point, and using it silently yielded false for every page.
    hasMirror: async (data) => {
      const { hasMarkdownMirror } = await import("../../lib/markdown-link.js");
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
