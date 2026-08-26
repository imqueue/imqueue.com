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
 * The engine's export surface, as the `API` object at the bottom of
 * vendor/search-ranker/ranker.js publishes it.
 *
 * Hand-written, not generated. The ranker is a submodule from another repo,
 * plain JavaScript, and TypeScript cannot see across the require() below that
 * loads it by absolute path. What this declaration buys is the failure that
 * actually happens here — a member NAME that stopped existing, which today
 * reads as `undefined` and is caught by nothing.
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

const ENGINE_REL = "vendor/search-ranker/ranker.js";
const ENGINE_FILE = path.join(RANKER_DIR, "ranker.js");

const UI_REL = "vendor/search-ranker/search.js";
const UI_FILE = path.join(RANKER_DIR, "search.js");

/**
 * Has the submodule been checked out? False in a plain `git clone`.
 *
 * BOTH halves, because a checkout with only one of them is a real state — a submodule
 * pinned to a pre-split commit has search.js and no ranker.js — and it would otherwise
 * produce a site whose search asset is half the code it needs.
 */
export function exists(): boolean {
  return fs.existsSync(ENGINE_FILE) && fs.existsSync(UI_FILE);
}

// The instruction, in full, wherever the absence is reported. A contributor hitting
// this has a working tree that looks complete and a build that fails for a reason
// nothing on disk explains.
const MISSING =
  `The search ranker is missing: ${ENGINE_REL} and/or ${UI_REL}\n\n` +
  "It is a git submodule (github.com/imqueue/search-ranker), and a plain `git clone`\n" +
  "does not populate it. Run:\n\n" +
  "    git submodule update --init\n\n" +
  "or clone with `--recurse-submodules` next time.\n\n" +
  "If the directory IS populated and only ranker.js is missing, the submodule is\n" +
  "pinned to a commit from before the engine/UI split — update the pin.";

/**
 * Load the ENGINE for use under Node. Throws with the fix if the submodule is not
 * checked out.
 *
 */
export function requireRanker(): RankerEngine {
  if (!exists()) {
    throw new Error(MISSING);
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
    throw new Error(MISSING);
  }

  return fs.readFileSync(ENGINE_FILE, "utf8") + "\n" + fs.readFileSync(UI_FILE, "utf8");
}

export { RANKER_DIR, ENGINE_REL, ENGINE_FILE, UI_REL, UI_FILE, MISSING };
