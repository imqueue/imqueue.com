#!/usr/bin/env node
// check-api-versions.ts — does the published API reference still match npm?
//
// `npm run build-docs` reads the PUBLISHED npm tarball, so a package release makes
// /api/<pkg>/latest/ stale until it is re-run here. Skipping that step fails
// silently: nothing breaks, no page 404s, the site simply keeps advertising the
// previous version's reference. `core` and `rpc` sat four days stale that way, and
// the only thing that caught it was comparing src/_data/apiVersions.json against
// npm by hand. This is that comparison, as a command.
//
//   node scripts/check-api-versions.ts          report; exit 1 if anything is stale
//   node scripts/check-api-versions.ts --list   stale package names only, one per line
//
// --list is what .github/workflows/refresh-api-docs.yml feeds to `build-docs`, so
// it prints NOTHING but names on stdout and exits 0 even when everything is current.
//
// Deliberately NOT part of `npm test`. The gate runs in .githooks/pre-commit and on
// every pull request, and it is offline by design; adding 16 npm lookups to it would
// let an unreachable registry block an unrelated commit, and would fail the moment a
// package is published — which is precisely when someone is mid-release and least
// wants an unrelated red check. Staleness is a scheduled question, not a per-commit one.
import fs from 'node:fs';
import path from 'node:path';
import { shipped } from './lib/api-packages.ts';
import { latestRelease } from './lib/npm-releases.ts';

const ROOT = path.resolve(import.meta.dirname, '..');
const VERSIONS_FILE = path.join(ROOT, 'src', '_data', 'apiVersions.json');

function main() {
  const listOnly = process.argv.slice(2).includes('--list');
  const site = JSON.parse(fs.readFileSync(VERSIONS_FILE, 'utf8'));
  const pkgs = shipped().map(p => p.name);

  const rows = [];
  for (const pkg of pkgs) {
    // Let this throw. A registry failure must not read as "nothing is stale" — that
    // is the same silence this script exists to remove.
    const published = latestRelease(pkg);
    const documented = site[pkg] ? site[pkg].latest : null;
    rows.push({ pkg, published, documented, stale: documented !== published });
  }

  const stale = rows.filter(r => r.stale);

  if (listOnly) {
    for (const r of stale) console.log(r.pkg);
    return;
  }

  const width = Math.max(...pkgs.map(p => p.length));
  console.log(`\nAPI reference vs npm — ${pkgs.length} shipped packages\n`);
  for (const r of rows) {
    if (!r.stale) {
      console.log(`  ok     ${r.pkg.padEnd(width)}  ${r.published}`);
    } else if (r.documented === null) {
      console.log(`  MISSING ${r.pkg.padEnd(width)}  npm ${r.published}, never generated`);
    } else {
      console.log(`  STALE  ${r.pkg.padEnd(width)}  site ${r.documented} → npm ${r.published}`);
    }
  }

  if (!stale.length) {
    console.log(`\nAll ${pkgs.length} match. Nothing to regenerate.`);
    return;
  }

  console.log(
    `\n${stale.length} package(s) stale. Regenerate just those — a one-package run\n` +
    'merges into the shared outputs, so this costs seconds rather than a full build:\n\n' +
    `  npm run build-docs -- ${stale.map(r => r.pkg).join(' ')}\n\n` +
    'Then `npm test`, and commit the generated tree.',
  );
  process.exitCode = 1;
}

main();
