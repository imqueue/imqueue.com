// Content-hash the CSS and JS assets so they can be cached hard.
//
// Why: /css/* and /js/* were served as `public, max-age=14400, must-revalidate`
// with unfingerprinted filenames, which is a deploy-correctness problem, not just
// a caching inefficiency. Verified in production on 2026-07-30: after a CSS fix
// deployed, https://imqueue.org/css/base.css kept serving the OLD file from the
// Cloudflare edge for hours. The freshly-built HTML was live, the stylesheet it
// pointed at was not, and the canonical URL reported success the whole time — a
// `fetch(..., {cache:'reload'})`, which bypasses the *browser* cache, still got
// the stale bytes, while the same URL with a `?cb=` query string returned the new
// ones. Any CSS/JS change was therefore invisible to visitors for up to 4 hours.
//
// With the content hash in the filename, a changed file is a new URL: nothing can
// serve it stale, and the old URL is never requested again. That is what makes
// `immutable` safe here, exactly as headers.liquid said it would be ("Adding
// content hashes to the build is the prerequisite for caching them hard").
//
// Only CSS and JS are hashed. Fonts already carry content-stable @fontsource
// names and are already immutable. Images are deliberately left alone: they are
// referenced from markdown content and from absolute og:image URLs, where a
// changing filename would break social-preview caches for no benefit — and they
// were not the bug.

"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const { MISSING, exists, bundle } = require("./ranker.js");

// Where the concatenated ranker lands. Repo root and gitignored, following
// .search-frontmatter-*.json: a build intermediate, regenerated on every config load,
// and never a file anybody edits. It exists at all because addPassthroughCopy takes a
// PATH, not bytes, so the one asset the site serves has to be a real file somewhere.
const BUNDLE_REL = ".search-bundle.js";

// 8 hex chars of sha256. Collision risk across a handful of files is nil, and it
// keeps the URLs readable in devtools and in the link checker's output.
const HASH_LEN = 8;

function hash(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex").slice(0, HASH_LEN);
}

function hashFile(absPath) {
  return hash(fs.readFileSync(absPath));
}

/**
 * Map every CSS/JS asset's logical URL onto its content-hashed URL.
 *
 * Shared files come from src/_shared, edition-specific ones from src/<edition>,
 * and both land in the same output directory — so the edition's own files can
 * shadow a shared name, which is how theme-<skin>.css works. Later sources win,
 * matching the passthrough-copy order in eleventy.config.js.
 *
 * One JS asset comes from outside src/ entirely: the search ranker is a git submodule
 * of TWO files, engine and UI, concatenated here into one (see scripts/lib/ranker.js).
 * It is handled by name rather than by adding its directory to the scan below, and that
 * is the whole point — an unpopulated submodule is an EMPTY DIRECTORY, so a directory
 * scan would find no *.js, report nothing, and emit a site with no search.js in it.
 * Naming the files lets their absence throw.
 *
 * @param {string} root Repository root.
 * @param {string} edition "org" | "com".
 * @returns {{manifest: Record<string,string>, copies: Array<[string,string]>}}
 *   `manifest` maps "/css/base.css" -> "/css/base.<hash>.css" for templates;
 *   `copies` is [sourcePath, outputPath] for addPassthroughCopy.
 */
function buildAssetManifest(root, edition) {
  const manifest = {};
  const copies = [];

  for (const dir of ["css", "js"]) {
    for (const base of [path.join("src", "_shared", dir), path.join("src", edition, dir)]) {
      const abs = path.join(root, base);

      if (!fs.existsSync(abs)) {
        continue; // an edition need not ship its own css/ or js/
      }

      for (const name of fs.readdirSync(abs).sort()) {
        const ext = path.extname(name);

        if (ext !== `.${dir === "js" ? "js" : "css"}`) {
          continue;
        }

        const hashed = `${path.basename(name, ext)}.${hashFile(path.join(abs, name))}${ext}`;

        manifest[`/${dir}/${name}`] = `/${dir}/${hashed}`;
        copies.push([path.join(base, name).split(path.sep).join("/"), `${dir}/${hashed}`]);
      }
    }
  }

  // The submodule LAST, and it refuses to be shadowed. Both halves are deliberate.
  //
  // Last, so that if anything above claimed /js/search.js the collision is visible
  // here rather than decided by iteration order. And a hard failure rather than
  // "later wins", because a src/**/js/search.js reappearing is not a local override
  // worth honouring — it is the second copy of the ranker that this repo split the
  // ranker out to make impossible, and it would be served in preference to the
  // pinned one with nothing saying so.
  if (manifest["/js/search.js"]) {
    throw new Error(
      `A second search.js exists in src/: ${copies.find((c) => c[1].startsWith("js/search."))[0]}\n\n` +
        "The ranker is a submodule now (see scripts/lib/ranker.js). Delete the copy in\n" +
        "src/ and edit vendor/search-ranker/ instead — ranker.js for anything that scores,\n" +
        "search.js for anything a reader sees — or the site would serve the copy while the\n" +
        "MCP server serves the submodule, which is the drift the split ended.",
    );
  }

  if (!exists()) {
    // Loud, at eleventy config load, before a single page is written. The alternative
    // is a complete-looking build whose search button does nothing.
    throw new Error(MISSING);
  }

  // The ranker is TWO files — engine then UI — and the site serves them as one. The
  // hash is over the concatenation rather than over either half, which is the whole
  // point: an edit to the engine alone still changes the URL, so the `immutable`
  // caching this manifest exists to make safe stays safe. Hashing one half would
  // silently serve a stale pairing of the two.
  const source = bundle();
  const hashed = `search.${hash(source)}.js`;
  const bundleAbs = path.join(root, BUNDLE_REL);

  fs.writeFileSync(bundleAbs, source);

  manifest["/js/search.js"] = `/js/${hashed}`;
  copies.push([BUNDLE_REL, `js/${hashed}`]);

  return { manifest, copies };
}

module.exports = { buildAssetManifest, HASH_LEN, BUNDLE_REL };
