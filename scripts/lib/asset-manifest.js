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

// 8 hex chars of sha256. Collision risk across a handful of files is nil, and it
// keeps the URLs readable in devtools and in the link checker's output.
const HASH_LEN = 8;

function hashFile(absPath) {
  return crypto
    .createHash("sha256")
    .update(fs.readFileSync(absPath))
    .digest("hex")
    .slice(0, HASH_LEN);
}

/**
 * Map every CSS/JS asset's logical URL onto its content-hashed URL.
 *
 * Shared files come from src/_shared, edition-specific ones from src/<edition>,
 * and both land in the same output directory — so the edition's own files can
 * shadow a shared name, which is how theme-<skin>.css works. Later sources win,
 * matching the passthrough-copy order in eleventy.config.js.
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

  return { manifest, copies };
}

module.exports = { buildAssetManifest, HASH_LEN };
