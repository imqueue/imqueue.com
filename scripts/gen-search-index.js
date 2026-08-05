// Emits the two files the site's search reads:
//
//   /search-index.json  tier 1 — every page, every exported symbol and every FAQ
//                       answer as {title, url, summary, kind}. No bodies.
//                       Fetched on the first keystroke and nothing else.
//   /search-text.json   tier 2 — the prose corpus, one record per heading
//                       section, with text. Fetched lazily, in the background,
//                       only once a query has been typed.
//
// Two tiers rather than one because the common query does not need the second.
// An identifier ("watcherCheckDelay"), a page title, or a question that matches
// an FAQ heading is answered entirely out of tier 1; tier 2 is what makes "where
// do you talk about coalescing duplicate calls" work. Loading one index would
// mean paying for the second case on every query, on a site whose entire client
// JS is currently 25 KB.
//
// It runs from an `eleventy.after` hook (see eleventy.config.js) rather than as a
// template, because it reads the BUILT markdown mirrors — including the four
// pages whose mirrors are hand-authored Liquid, which no collection of `.md`
// inputs contains. The hook also means `--serve` regenerates it on every
// rebuild, so the dev preview never serves a stale index.

"use strict";

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const { buildCorpus } = require("./lib/search-corpus.js");

const TIER1 = "search-index.json";
const TIER2 = "search-text.json";
// Not a tier: nothing in the browser reads it. Anchor -> [start, end) line range into
// <page>/index.md, for a reader that wants one section of a mirror rather than the whole page.
const RANGES = "search-sections.json";

// A failing check is how index growth gets noticed. Tier 1 is fetched
// interactively, so its transfer size is a UX number, not a build statistic.
// Both are gzipped sizes, which is what Cloudflare actually serves.
const BUDGET_GZ = { [TIER1]: 120 * 1024, [TIER2]: 320 * 1024, [RANGES]: 40 * 1024 };

function gzipSize(text) {
  return zlib.gzipSync(Buffer.from(text), { level: 9 }).length;
}

function kb(bytes) {
  return `${(bytes / 1024).toFixed(1)} KB`;
}

/**
 * Build and write both tiers.
 *
 * @param {string} outputDir Built site root, e.g. "_site-org".
 * @param {{quiet?: boolean}} [opts]
 * @returns {{stats: object, sizes: object}}
 */
function generate(outputDir, opts = {}) {
  const { tier1, tier2, sectionRanges, stats } = buildCorpus(outputDir);
  const sizes = {};

  for (const [name, data] of [[TIER1, tier1], [TIER2, tier2], [RANGES, sectionRanges]]) {
    const json = JSON.stringify(data);
    const gz = gzipSize(json);

    fs.writeFileSync(path.join(outputDir, name), json);

    sizes[name] = { raw: json.length, gz };

    if (gz > BUDGET_GZ[name]) {
      throw new Error(
        `search index ${name} is ${kb(gz)} gzipped, over the ${kb(BUDGET_GZ[name])} budget. ` +
        `Either trim what goes in (scripts/lib/search-corpus.js) or raise the budget deliberately.`
      );
    }
  }

  if (!opts.quiet) {
    console.log(
      `[search] ${stats.docs} pages, ${stats.api} symbols, ${stats.faq} FAQ answers, ` +
      `${stats.sections} sections — ${TIER1} ${kb(sizes[TIER1].gz)} gz, ` +
      `${TIER2} ${kb(sizes[TIER2].gz)} gz, ${stats.lemmas} lemmas` +
      (stats.unanchored ? ` (${stats.unanchored} sections link to the page, not a heading)` : "")
    );

    // Vocabulary the dictionary does not have but the corpus uses. Printed, never
    // applied: about one in seven is a fragment that would break a word that currently
    // works, so scripts/data/project-words.txt is curated by hand from this list. An
    // empty report is the steady state, which is what makes a new line worth reading.
    if (stats.missingWords.length) {
      console.log(
        `[search] ${stats.missingWords.length} word(s) missing from the dictionary — ` +
        `review for scripts/data/project-words.txt: ` +
        stats.missingWords.map((w) => `${w.stem} (from ${w.sawAs})`).join(", ")
      );
    }
  }

  return { stats, sizes };
}

module.exports = { generate, TIER1, TIER2 };

if (require.main === module) {
  const dir = process.argv[2] || "_site-org";

  if (!fs.existsSync(dir)) {
    console.error(`[search] no such output directory: ${dir} — run the build first`);
    process.exit(1);
  }

  generate(dir);
}
