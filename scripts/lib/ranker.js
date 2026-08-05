// Where the search ranker lives — one definition, because five things need it.
//
// `search.js` is NOT a file in this repo any more. It is its own public repo,
// github.com/imqueue/search-ranker, included here as a git submodule pinned to a
// commit SHA, and included the same way by the @imqueue/mcp server. The reason is
// drift: the MCP server used to carry its own copy of the ranking rules, and the two
// answered the same query differently — measurably, and invisibly, because nothing
// compared them. One file with one history cannot drift from itself.
//
// This module exists so the path appears once. Before it there were five independent
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

"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..");

// Posix-separated and repo-relative: this spelling is what addPassthroughCopy and
// `git show <ref>:<path>` want. RANKER_FILE is the absolute one for require().
const RANKER_REL = "vendor/search-ranker/search.js";
const RANKER_DIR = path.join(ROOT, "vendor", "search-ranker");
const RANKER_FILE = path.join(RANKER_DIR, "search.js");

/** Has the submodule been checked out? False in a plain `git clone`. */
function exists() {
  return fs.existsSync(RANKER_FILE);
}

// The instruction, in full, wherever the absence is reported. A contributor hitting
// this has a working tree that looks complete and a build that fails for a reason
// nothing on disk explains.
const MISSING =
  `The search ranker is missing: ${RANKER_REL}\n\n` +
  "It is a git submodule (github.com/imqueue/search-ranker), and a plain `git clone`\n" +
  "does not populate it. Run:\n\n" +
  "    git submodule update --init\n\n" +
  "or clone with `--recurse-submodules` next time.";

/**
 * Load the ranker for use under Node, where it exports its scoring functions instead
 * of wiring up a DOM. Throws with the fix if the submodule is not checked out.
 *
 * @returns {object} `{ parseQuery, prepare, prepareSections, search, groupKey, state, FEED_V }`
 */
function requireRanker() {
  if (!exists()) {
    throw new Error(MISSING);
  }

  return require(RANKER_FILE);
}

module.exports = { RANKER_DIR, RANKER_FILE, RANKER_REL, MISSING, exists, requireRanker };
