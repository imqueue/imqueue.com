// Emits /status.json — every published @imqueue package's version, licence, Node
// floor and release date, as data.
//
// The reason this file exists rather than the /status/ page being enough: an agent
// evaluating @imqueue could not read npmjs.com (bot detection on an unattended
// fetch — see scripts/external-allowlist.txt, which has said so about our own link
// checker for months) and fell back to search snippets cached from the 1.x era. It
// then reported ISC and Node 8 as fact. imqueue.org, by contrast, it could read
// perfectly. So the fix is not to unblock npm, it is to serve the same facts from
// a host that answers.
//
// A feed and not just the page because parsing a rendered table to learn a version
// number is exactly the tax that makes an agent give up and guess. Same reasoning
// as /api/search-index.json and /blog/search-index.json, and it is advertised in
// llms.txt beside them.
//
// The data is src/_data/packageStatus.json, written by scripts/gen-package-status.js
// from the npm registry and refreshed daily by refresh-api-docs.yml. Nothing is
// computed here beyond absolutising the two site-relative URLs — an agent that
// fetched this feed has no base to resolve `/api/core/latest/` against, and a
// relative URL in a machine feed is a URL that gets guessed at.
//
// ORG ONLY, and for free: eleventy.config.js:173 ignores src/org/** in the com
// build. The commercial edition has four pages and no package reference; a second
// copy of a file whose whole value is that there is one copy would be a liability.

module.exports = class PackageStatusFeed {
  data() {
    return {
      permalink: "/status.json",
      eleventyExcludeFromCollections: true,
    };
  }

  render(data) {
    const site = data.siteUrl.replace(/\/$/, "");
    const abs = (u) => (u && u.startsWith("/") ? site + u : u);
    const status = data.packageStatus;

    return `${JSON.stringify({
      // What this file is, stated inside it. A feed found without its context —
      // linked from somewhere, quoted in a snippet — should still say where it
      // came from and how old it is.
      about: `${site}/status/`,
      source: "https://registry.npmjs.org",
      generated: status.generated,
      framework: status.framework,
      packages: status.packages.map((p) => ({
        name: p.name,
        scoped: p.scoped,
        version: p.version,
        license: p.license,
        node: p.node,
        released: p.released,
        firstRelease: p.firstRelease,
        releases: p.releases,
        majors: p.majors,
        deprecated: p.deprecated,
        install: p.install,
        docs: abs(p.docs),
        npm: p.npm,
        repo: p.repo,
        summary: p.blurb,
      })),
    }, null, 2)}\n`;
  }
};
