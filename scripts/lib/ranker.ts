// Where the search ranker lives — one definition, because five things need it.
//
// The ranker is NOT a file in this repo. It is its own public repo,
// github.com/imqueue/search-ranker, included here as a git submodule pinned to a
// commit SHA, and included the same way by the @imqueue/mcp server. The reason is
// drift: the MCP server used to carry its own copy of the ranking rules, and the two
// answered the same query differently — measurably, and invisibly, because nothing
// compared them. One file with one history cannot drift from itself.
//
// TWO FILES SINCE 2026-08-06, and which one a caller wants is not a detail:
//
//   ranker.js  the engine. Scoring, query parsing, spelling correction, grouping. No
//              DOM, no network, no imqueue. This is what Node requires and what the
//              MCP server ships, and it is the half another site could reuse.
//   search.js  imqueue's browser UI. The dialog, /search/, the scoped sidebar boxes,
//              the feed URLs, the analytics. Never required — only served.
//
// BOTH ARE BUILD OUTPUT NOW. The ranker was rewritten in TypeScript, so the two files
// live at vendor/search-ranker/dist/ and are produced by `npm run build` inside the
// submodule rather than committed to it. Nothing else about the contract moved: the
// engine bundle is the same IIFE publishing the same 15 names to `module.exports`
// under Node and `window.SearchRanker` in a browser.
//
// What DID change is the number of ways this can be absent, and they need different
// instructions — see `state()` below.
//
// The site serves them CONCATENATED as one hashed asset (see asset-manifest.ts), so a
// visitor still makes one request. `ENGINE_*` and `UI_*` below are how a caller says
// which half it means; before the split there was one path and no way to be wrong,
// and now the wrong choice fails quietly — `require(UI_FILE)` throws on `document`,
// and grepping ENGINE_FILE for a UI constant finds nothing and reports a pass.
//
// This module exists so those paths appear once. Before it there were five independent
// spellings of `src/_shared/js/search.js` (three checks, the KPI harness, and the
// asset manifest's directory scan); moving the file meant finding all five, and a
// missed one fails in a different way in each caller.
//
// A CLONE WITHOUT SUBMODULES HAS NONE OF THIS. `git clone` alone leaves
// vendor/search-ranker/ an empty directory, so `exists()` is false and every caller
// has to say so rather than behave as though the ranker were merely broken. The
// asset manifest turns that into a hard build failure on purpose: an empty directory
// scanned for *.js yields nothing, no error, and a site that ships no search.js at
// all — a missing asset, not a build error, and nothing in CI would have noticed.

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

/**
 * The engine's export surface, as the `API` object in
 * vendor/search-ranker/src/ranker/api.ts publishes it.
 *
 * STILL HAND-WRITTEN, and that is now a choice rather than a limitation: the
 * ranker ships real declarations at dist/types/ranker/api.d.ts since the
 * TypeScript rewrite. Importing them would tie `npm run check:types` — the first
 * thing `npm test` runs — to the submodule having been BUILT, and dist/ is not
 * committed. A type check that fails on a clean checkout for a reason that has
 * nothing to do with types is worse than a declaration kept in step by hand and
 * asserted by check-search-ranker.ts against the built file.
 *
 * What this declaration buys is the failure that actually happens here — a member
 * NAME that stopped existing, which today reads as `undefined` and is caught by
 * nothing.
 *
 * The signatures are deliberately loose. Pinning them would be a second copy of
 * the ranker's own contract living in this repo, and a second copy that can
 * disagree with the first is precisely what this module exists to prevent; the
 * MCP server and this site diverging on the same query is the bug in its
 * header. Keep the NAMES in step with that `API` object and let the call sites
 * say what they expect of each result.
 */
export interface RankerEngine {
  ENGINE_V: number;
  FEED_V: number;
  G_API: number;
  P_KIND: number;
  P_URL: number;
  S_TEXT: number;
  state: Record<string, unknown>;
  fold: (...args: any[]) => any;
  groupKey: (...args: any[]) => any;
  isWordChar: (...args: any[]) => any;
  parseQuery: (...args: any[]) => any;
  prepare: (...args: any[]) => any;
  prepareSections: (...args: any[]) => any;
  search: (...args: any[]) => any;
  snippet: (...args: any[]) => any;
}

// The engine is CommonJS in another repo and is loaded by ABSOLUTE PATH decided
// at runtime, so a static `import` cannot express it. createRequire keeps the
// load SYNCHRONOUS, which is not a style preference: every caller of
// requireRanker() is synchronous, and `await import()` would make five checks
// and the KPI harness async to change nothing about what they do.
const require = createRequire(import.meta.url);

const ROOT = path.join(import.meta.dirname, "..", "..");

// Posix-separated and repo-relative: this spelling is what addPassthroughCopy and
// `git show <ref>:<path>` want. The absolute ones are for require() and readFileSync.
const RANKER_DIR = path.join(ROOT, "vendor", "search-ranker");

const ENGINE_REL = "vendor/search-ranker/dist/ranker.js";
const ENGINE_FILE = path.join(RANKER_DIR, "dist", "ranker.js");

const UI_REL = "vendor/search-ranker/dist/search.js";
const UI_FILE = path.join(RANKER_DIR, "dist", "search.js");

// The submodule's own manifest. Present iff the submodule has been checked out at
// all, and it is what separates the two kinds of absence below.
const RANKER_MANIFEST = path.join(RANKER_DIR, "package.json");

/**
 * Why the ranker is not usable, or null when it is.
 *
 * FOUR STATES SINCE THE BUNDLES BECAME BUILD OUTPUT, and three of them look identical
 * from here — no dist/ranker.js — while needing different instructions. Telling a
 * contributor to run `git submodule update --init` on a submodule that is already
 * checked out sends them to look for a problem that is not there, and telling them to
 * build one pinned to a commit that has nothing to build sends them somewhere worse.
 */
function state(): "unpopulated" | "prerewrite" | "unbuilt" | null {
  if (!fs.existsSync(RANKER_MANIFEST)) {
    // A pre-rewrite pin is POPULATED and has no manifest: the old layout committed
    // ranker.js and search.js at the root and had no package.json at all. Only an
    // empty directory is an unpopulated submodule.
    return fs.existsSync(path.join(RANKER_DIR, "ranker.js")) ? "prerewrite" : "unpopulated";
  }

  return exists() ? null : "unbuilt";
}

/**
 * Are the built bundles on disk?
 *
 * BOTH halves, because a checkout with only one of them is a real state — an
 * interrupted build leaves one bundle written and the other not — and it would
 * otherwise produce a site whose search asset is half the code it needs.
 */
export function exists(): boolean {
  return fs.existsSync(ENGINE_FILE) && fs.existsSync(UI_FILE);
}

/**
 * The instruction, in full, wherever the absence is reported.
 *
 * A function rather than a constant because which instruction is right depends on
 * what is on disk, and that is read at the moment of failure. A contributor hitting
 * either of these has a working tree that looks complete and a build that fails for a
 * reason nothing on disk explains.
 */
function missing(): string {
  const why = state();

  if (why === "prerewrite") {
    return (
      "The search ranker pin predates its TypeScript rewrite.\n\n" +
      "vendor/search-ranker/ holds the old layout — ranker.js and search.js at its root,\n" +
      "no package.json — and this repo now reads the built bundles at dist/. Move the pin:\n\n" +
      "    git submodule update --remote vendor/search-ranker\n" +
      "    npm run ranker:build\n\n" +
      "and measure it before committing: `npm run kpi -- --ref <old-sha>` compares the two\n" +
      "engines in one process, and a ranking delta is not a result until it is read."
    );
  }

  if (why === "unpopulated") {
    return (
      `The search ranker is missing: vendor/search-ranker/ is empty.\n\n` +
      "It is a git submodule (github.com/imqueue/search-ranker), and a plain `git clone`\n" +
      "does not populate it. Run:\n\n" +
      "    git submodule update --init\n" +
      "    npm run ranker:build\n\n" +
      "or clone with `--recurse-submodules` next time."
    );
  }

  return (
    `The search ranker is not built: ${ENGINE_REL} and/or ${UI_REL}\n\n` +
    "The submodule IS checked out — these two files are build output, not sources.\n" +
    "Since the ranker was rewritten in TypeScript they are produced by its own build\n" +
    "and deliberately not committed, so a fresh checkout has src/ and no dist/. Run:\n\n" +
    "    npm run ranker:build\n\n" +
    "which is `npm ci && npm run build` inside the submodule, and is what\n" +
    "`npm run build:all` runs for you.\n\n" +
    "If dist/ exists and only one of the two files is in it, the last build was\n" +
    "interrupted — run it again."
  );
}

/**
 * Load the ENGINE for use under Node. Throws with the fix if the submodule is not
 * checked out.
 *
 */
export function requireRanker(): RankerEngine {
  if (!exists()) {
    throw new Error(missing());
  }

  return require(ENGINE_FILE) as RankerEngine;
}

/**
 * The two halves in the order the browser needs them, as one string.
 *
 * The engine first, because it publishes `window.SearchRanker` and the UI reads it at
 * its own top level — reverse them and the site throws on load rather than on search.
 * Concatenated rather than served as two files so that a visitor who searches makes
 * one request and the "nothing is fetched on page load" property stays true of one
 * asset instead of being split across two with a load-order dependency in the HTML.
 */
export function bundle(): string {
  if (!exists()) {
    throw new Error(missing());
  }

  return fs.readFileSync(ENGINE_FILE, "utf8") + "\n" + fs.readFileSync(UI_FILE, "utf8");
}

export { RANKER_DIR, RANKER_MANIFEST, ENGINE_REL, ENGINE_FILE, UI_REL, UI_FILE, missing };
