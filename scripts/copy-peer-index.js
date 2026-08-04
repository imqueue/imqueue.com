// Cross-publish each edition's search index into the other's output, so that
// searching imqueue.com for documentation is a SAME-ORIGIN fetch.
//
//   _site-com/search-index.json  ->  _site-org/search-peer-index.json
//   _site-org/search-index.json  ->  _site-com/search-peer-index.json
//   (and the same for search-text.json)
//
// WHY NOT CORS
//
// The first version of this had each site fetch the other's index cross-origin, with
// `Access-Control-Allow-Origin: <the peer>` on the two files. It works, and it is worse
// on three counts: it publishes a header whose only purpose is to let one specific other
// host read a file, it makes each site's search depend on the other ZONE being reachable
// at query time, and it cannot be verified locally at all — the peer URL points at
// production, whose allowlist will never contain localhost, so the whole feature is
// untestable until it is deployed.
//
// Copying makes the peer index an ordinary static file on the same origin. Nothing to
// allow, nothing to reach at runtime, and `npm run build:all` produces it locally, which
// is what makes cross-site search something you can actually look at before shipping.
//
// WHY NOT A SYMLINK
//
// Cloudflare Pages uploads a flat list of files, so a symlink is at best resolved at upload
// time and at worst dangling. The bytes have to be copied, by a step that runs after BOTH
// editions are built — which is why this cannot hang off the per-edition eleventy hook.
//
// HOW IT GETS RUN IN PRODUCTION
//
// It used to be that each Pages project built only its own edition, so this never ran on a
// deploy and the peer files were simply absent — cross-site search silently off, waiting on
// somebody editing a build command in two dashboards. scripts/build-site.js closes that:
// `npm run build:org` and `npm run build:com` each build the peer edition as well and then
// call copyPeers(), so the dashboard commands can stay exactly as CUTOVER.md documents them
// and the behaviour lives in the repo. That file explains the cost and why a failed peer
// build is not allowed to fail the deploy.
//
// A missing peer index is still a supported state, and this reports it: a local
// single-edition run, or a deploy whose peer build failed, searches only its own site.

"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");

const EDITIONS = [
  { name: "org", dir: "_site-org" },
  { name: "com", dir: "_site-com" },
];

const FILES = [
  ["search-index.json", "search-peer-index.json"],
  ["search-text.json", "search-peer-text.json"],
];

function kb(bytes) {
  return `${(bytes / 1024).toFixed(0)} KB`;
}

function copyPeers() {
  const present = EDITIONS.filter((edition) => fs.existsSync(path.join(ROOT, edition.dir)));

  if (present.length < 2) {
    const missing = EDITIONS.filter((e) => !present.includes(e)).map((e) => e.dir).join(", ");

    console.log(
      `[search] ${missing} not built, so no peer index was written — cross-site search ` +
      "will be inactive. Build both editions (npm run build) to enable it."
    );

    return { copied: 0 };
  }

  let copied = 0;
  let bytes = 0;

  for (const target of EDITIONS) {
    const peer = EDITIONS.find((edition) => edition !== target);

    for (const [source, destination] of FILES) {
      const from = path.join(ROOT, peer.dir, source);
      const to = path.join(ROOT, target.dir, destination);

      if (!fs.existsSync(from)) {
        console.log(`[search] ${peer.dir}/${source} is missing — ${target.name} gets no peer index`);
        continue;
      }

      fs.copyFileSync(from, to);
      bytes += fs.statSync(to).size;
      copied++;
    }
  }

  console.log(`[search] cross-published ${copied} peer index file(s), ${kb(bytes)} total`);

  return { copied };
}

module.exports = { copyPeers };

if (require.main === module) {
  copyPeers();
}
