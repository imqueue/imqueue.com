#!/usr/bin/env node
// check-ranker-engine.ts — is the ranker we pinned still the ranker that ships?
//
//   node scripts/check-ranker-engine.ts
//
// NETWORKED, so it is NOT in `npm test`. It reads github.com/imqueue/search-ranker
// at master. Same split as check-api-versions.ts, for the same reason: `npm test`
// runs in a pre-commit hook and must work on a train. It runs in checks.yml.
//
// WHAT IT IS FOR. The ranker is a submodule, and two repositories pin it: this one
// takes ranker.js and search.js, @imqueue/mcp takes ranker.js alone. Because they
// pin by COMMIT and consume different halves, the pins fall out of step on a commit
// to either half — in August 2026 they sat a fortnight apart with nothing red in
// either repo. That one was harmless, the divergent commit being search.js, and
// harmless is exactly the problem: a signal that fires on a UI commit is one both
// repos learn to ignore, so the next divergence — a scoring change — goes through
// on the same shrug.
//
// So this compares ENGINE_V and not the SHA. ENGINE_V moves only when the ANSWERS
// move; the ranker repo's own CI enforces that. A UI-only commit never turns this
// red, and when it does go red it means something worth reading: the engine's
// behaviour changed and this site is still building feeds with the old one.
//
// Deliberately NOT auto-fixed here. Repinning the ranker changes what every search
// on this site returns, and the rule in that repo's README is that a delta is not a
// result until it is tested — `npm run kpi` is the test, and it is a human's call.
// .github/workflows/repin-ranker.yml opens an issue rather than committing when
// this number moves.

import { requireRanker } from './lib/ranker.ts';

// THE SOURCE, not a bundle. The ranker was rewritten in TypeScript and no longer
// commits its build output, so master has no ranker.js to read — dist/ is produced
// by `npm run build` and exists only in a checkout. src/ranker/constants.ts is where
// the constant is declared and is committed, which makes it the file to fetch as
// well as the honest one: this compares against what upstream WROTE rather than
// against whatever a build of it happened to emit.
const RAW = 'https://raw.githubusercontent.com/imqueue/search-ranker/master/src/ranker/constants.ts';
const TIMEOUT_MS = 15000;

// Read as TEXT, not by evaluating the fetched file. Downloading a module from the
// network and running it to learn a version number would be a genuinely bad trade,
// and this is one regex against a constant declaration whose spelling the ranker
// repo's own CI depends on too.
const DECLARATION = /^\s*export\s+const\s+ENGINE_V\s*=\s*(\d+)\s*;/m;

function declaredIn(source: string, where: string): number {
  const m = DECLARATION.exec(source);

  if (!m) {
    throw new Error(`${where} declares no ENGINE_V — the pin predates it, or the constant was renamed`);
  }

  return Number(m[1]);
}

async function main() {
  // Read through scripts/lib/ranker.ts rather than by a second spelling of the
  // submodule path — that module is the one place it is supposed to appear, and
  // an unpopulated submodule now says how to populate it.
  const vendored: unknown = requireRanker().ENGINE_V;

  if (typeof vendored !== 'number') {
    console.error('  FAIL  vendor/search-ranker/dist/ranker.js exports no ENGINE_V. '
      + 'Update the submodule pin: this site stamps that number into every feed, '
      + 'and @imqueue/mcp compares against it at runtime.');
    process.exit(1);
  }

  const res = await fetch(RAW, { signal: AbortSignal.timeout(TIMEOUT_MS) });

  if (res.status === 404) {
    // A 404 IS NOT AN OUTAGE, and lumping it in with one is how this check would go
    // green forever the day the constant moves. GitHub being down answers 5xx; a 404
    // means the file is not where this repo believes it is, which is a real finding
    // with a real fix, so it fails.
    console.error(`  FAIL  ${RAW} is 404.`);
    console.error('');
    console.error('        Either the TypeScript rewrite has not landed on search-ranker@master');
    console.error('        yet — this repo already reads the rewritten layout, and master still');
    console.error('        holds the single ranker.js — or ENGINE_V moved out of');
    console.error('        src/ranker/constants.ts. Both are answered by looking at that repo.');
    process.exit(1);
  }

  if (!res.ok) {
    // A GitHub outage is not a drift. Failing the build on one would teach everyone
    // to re-run the job until it passes, which is how a real failure gets clicked
    // through as well.
    console.error(`  SKIP  could not read ${RAW} (HTTP ${res.status}) — not treating an `
      + 'unreachable GitHub as a version mismatch');
    process.exit(0);
  }

  const upstream = declaredIn(await res.text(), 'search-ranker@master');

  if (upstream === vendored) {
    console.log(`  ok    engine v${vendored} — the pin matches search-ranker@master`);

    return;
  }

  console.error(`  FAIL  search-ranker@master is engine v${upstream}; this repo pins v${vendored}.`);
  console.error('');
  console.error('        The engine\'s ANSWERS changed and this site is still building its feeds');
  console.error('        with the old one, so /search/ and @imqueue/mcp can disagree about the');
  console.error('        same query. To take it:');
  console.error('');
  console.error('          git submodule update --remote vendor/search-ranker');
  console.error('          npm run ranker:build               # dist/ is not committed');
  console.error('          npm run build:all && npm run kpi   # paired, before and after');
  console.error('');
  console.error('        A ranking delta is not a result until it is tested — read the per-query');
  console.error('        deltas, not the summary line.');
  process.exit(1);
}

main().catch((e) => {
  console.error(`  FAIL  ${e.message}`);
  process.exit(1);
});
