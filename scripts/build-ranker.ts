#!/usr/bin/env node
// build-ranker.ts — build the search-ranker submodule, so the site can serve it.
//
//   npm run ranker:build
//
// WHY THIS EXISTS AT ALL. Until the ranker was rewritten in TypeScript it had no
// build: vendor/search-ranker/ranker.js and search.js were hand-written ES5 and a
// submodule checkout was all this repo needed. They are bundles now, produced by the
// submodule's own `npm run build` into dist/ and deliberately not committed there — a
// generated file in git is a second copy of the source that can disagree with it.
//
// So the site's build has a prerequisite it did not have before, and the failure when
// it is unmet is the quiet kind: no dist/ means no `/js/search.js`, which is a missing
// asset rather than a build error. scripts/lib/asset-manifest.ts already turns that
// into a hard failure; this script is the other half — the thing that makes the
// failure not happen.
//
// WIRED AS `prebuild:all`, so `npm run build:all` (and `npm run build`, `npm test` and
// `npm run verify`, which all reach it through `check:links`) get it for free. A
// contributor who runs `npm run edition:org` directly still gets the instruction from
// asset-manifest rather than a broken site.
//
// IDEMPOTENT, because it runs before every build and a build that reinstalls and
// re-bundles a submodule nobody touched would make the inner loop slower for nothing.
// The freshness test is a modification time: the newest input against the oldest
// output. That is the same test `make` makes and it has the same hole — a checkout
// that rewinds src/ to older content leaves stale bundles in place — which is why
// `--force` exists and why the pin change in `git submodule update` is not trusted to
// be visible here.

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { ENGINE_FILE, RANKER_DIR, RANKER_MANIFEST, UI_FILE } from './lib/ranker.ts';

const FORCE = process.argv.includes('--force');
const QUIET = process.argv.includes('--quiet');

/** The files whose content decides whether the bundles are stale. */
const INPUTS = ['src', 'build.mjs', 'package.json', 'tsconfig.base.json', 'tsconfig.json',
  'tsconfig.ranker.json', 'tsconfig.ui.json'];

const say = (message: string): void => {
  if (!QUIET) {
    console.log(message);
  }
};

/** The most recent mtime under a path, recursing into directories. */
function newestUnder(target: string): number {
  let stat;

  try {
    stat = fs.statSync(target);
  } catch {
    return 0; // absent inputs do not make anything stale
  }

  if (!stat.isDirectory()) {
    return stat.mtimeMs;
  }

  let newest = stat.mtimeMs;

  for (const entry of fs.readdirSync(target)) {
    newest = Math.max(newest, newestUnder(path.join(target, entry)));
  }

  return newest;
}

/** Are the bundles present and at least as new as everything they are built from? */
function fresh(): boolean {
  if (!fs.existsSync(ENGINE_FILE) || !fs.existsSync(UI_FILE)) {
    return false;
  }

  const built = Math.min(fs.statSync(ENGINE_FILE).mtimeMs, fs.statSync(UI_FILE).mtimeMs);
  const source = Math.max(...INPUTS.map((rel) => newestUnder(path.join(RANKER_DIR, rel))));

  return built >= source;
}

function run(command: string, args: string[]): void {
  execFileSync(command, args, { cwd: RANKER_DIR, stdio: QUIET ? 'pipe' : 'inherit' });
}

if (!fs.existsSync(RANKER_MANIFEST)) {
  // Two different absences, and neither is "not built": one is fixed by git and the
  // other by moving the pin. Running `npm ci` in either would say something about a
  // missing package.json that names neither the submodule nor the fix.
  if (fs.existsSync(path.join(RANKER_DIR, 'ranker.js'))) {
    console.error('vendor/search-ranker/ holds the pre-rewrite layout: ranker.js and');
    console.error('search.js at its root, and no package.json to build from.\n');
    console.error('    git submodule update --remote vendor/search-ranker\n');
    console.error('This repo reads the built bundles at dist/ now. Measure the move before');
    console.error('committing it — `npm run kpi -- --ref <old-sha>` compares both engines.');
    process.exit(1);
  }

  console.error('vendor/search-ranker/ is empty — the submodule is not checked out.\n');
  console.error('    git submodule update --init\n');
  console.error('or clone with `--recurse-submodules` next time.');
  process.exit(1);
}

if (!FORCE && fresh()) {
  say('ranker: dist/ is up to date.');
  process.exit(0);
}

// `npm ci` only when there is nothing to run with. It is the slow half and the
// submodule's dependencies (esbuild, typescript) move only when its lockfile does —
// which, being a pinned submodule, is when the pin moves, and a moved pin rewrites
// package-lock.json and so trips the freshness test above anyway.
if (!fs.existsSync(path.join(RANKER_DIR, 'node_modules'))) {
  say('ranker: installing build dependencies…');
  run('npm', ['ci']);
}

say('ranker: building dist/…');
run('npm', ['run', 'build']);

if (!fs.existsSync(ENGINE_FILE) || !fs.existsSync(UI_FILE)) {
  // The submodule's build exited 0 and produced neither bundle, which means its own
  // build script changed shape. Better here than as a site that ships no search.
  console.error(`\nranker: the build succeeded but did not write both bundles.\n`);
  console.error(`  expected ${path.relative(RANKER_DIR, ENGINE_FILE)}`);
  console.error(`       and ${path.relative(RANKER_DIR, UI_FILE)}`);
  console.error(`\nin ${RANKER_DIR}`);
  process.exit(1);
}

say('ranker: dist/ranker.js and dist/search.js are built.');
