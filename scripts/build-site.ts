#!/usr/bin/env node
// build-site.ts — build one edition FOR DEPLOYMENT, with the peer index it needs.
//
//   node scripts/build-site.ts org     (what imqueue-org's Pages project runs)
//   node scripts/build-site.ts com     (what imqueue-com's Pages project runs)
//
// WHY THIS EXISTS
//
// Cross-site search reads the other edition's index from `/search-peer-*.json` on THIS
// origin — copied in by scripts/copy-peer-index.ts, which explains at length why copying
// beat both CORS and a symlink. The catch is that copying needs BOTH editions built, and
// each Cloudflare Pages project used to run only its own (`build:org` / `build:com`).
//
// So in production the peer files were simply absent and cross-site search was silently
// off, waiting on a dashboard edit — a build command changed by hand in two projects,
// which is a step that gets forgotten and leaves no trace when it is. The repo can just
// do it instead: each edition's deploy build produces the peer edition too, takes its
// index, and publishes only its own output directory. Nothing to remember, and the
// feature cannot be one dashboard field away from working again.
//
// It costs the com project about twelve seconds — org is 12s to build and com is under
// one, measured 2026-08-05 — for a deploy that used to take one. Worth it to make the
// behaviour a property of the repository rather than of a form somebody filled in.
//
// THE PEER BUILD IS NOT ALLOWED TO FAIL THE DEPLOY
//
// The obvious version of this couples the two sites: a broken page on imqueue.org would
// block a pricing fix on imqueue.com, which is a worse problem than the one being solved.
// So a failed PEER build is reported and tolerated — copy-peer-index.ts already treats a
// missing peer as "no peer", and the client already treats a missing peer index as "this
// site only". Cross-site results go quiet for that deploy; nothing breaks. A failure in
// the edition actually being deployed is fatal, as it must be.

import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { copyPeers } from './copy-peer-index.ts';

const ROOT = path.join(import.meta.dirname, '..');
const ELEVENTY = path.join(ROOT, 'node_modules', '.bin', 'eleventy');
const EDITIONS = ['org', 'com'];

const edition = process.argv[2] ?? '';

if (!EDITIONS.includes(edition)) {
  console.error(`usage: node scripts/build-site.ts <${EDITIONS.join('|')}>`);
  process.exit(1);
}

// Non-null by construction: EDITIONS has two entries and `edition` is proved to
// be one of them by the guard above, so the other one is always there.
const peer = EDITIONS.find((name) => name !== edition) ?? '';

function build(name: string): boolean {
  console.log(`\n[build] EDITION=${name}`);

  const result = spawnSync(ELEVENTY, [], {
    cwd: ROOT,
    stdio: 'inherit',
    env: { ...process.env, EDITION: name },
  });

  return result.status === 0;
}

// The peer first, so its index exists by the time this edition's own build finishes and
// copyPeers() runs. Tolerated on failure — see the note above.
if (!build(peer)) {
  // Deliberately not "without a peer index": on Cloudflare the checkout is fresh, so
  // _site-<peer> does not exist and copyPeers() reports cross-site search as inactive — but
  // run locally the previous build's output is still on disk and gets copied, stale. Both
  // are acceptable and neither is worth extra machinery; saying which one happened is.
  console.log(
    `\n[search] the ${peer} build FAILED. Continuing — ${edition} still deploys, with the ` +
    `peer index missing (fresh checkout) or stale (local rebuild). Cross-site search is the ` +
    'only thing affected; copy-peer-index.ts reports which case this is.'
  );
}

if (!build(edition)) {
  console.error(`\n[build] EDITION=${edition} failed — this is the edition being deployed.`);
  process.exit(1);
}

copyPeers();
