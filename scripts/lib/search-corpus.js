// Builds the site's search corpus from the BUILT MARKDOWN MIRRORS, not from the
// built HTML.
//
// Every page this site publishes also ships as plain markdown at
// `<page-url>index.md` (see src/md-mirror.liquid) — byte-identical content, no
// nav, no footer, no sidebar. That makes the mirrors the right index source and
// removes the single most tedious part of adding search to a static site:
//
//  * No boilerplate stripping. Indexing HTML means teaching the indexer which
//    parts of every template are chrome. Get it wrong and "commercial license"
//    (footer) or "npm i -g @imqueue/cli" (nav) matches all 1,886 pages.
//  * Complete by construction. The mirrors cover pages authored as markdown AND
//    the ones authored as Liquid templates (the home page, /intro/, /docs/, the
//    /api/ landing page), whose mirrors are hand-written in src/org/mirrors/.
//    An Eleventy collection of `.md` inputs — which is what collections.contentMd
//    is — silently omits those four. That exact failure has already been paid
//    for once in llms.txt, where a hand-maintained URL allowlist dropped the home
//    page, /using-ai-assistants/, /contact/ and /blog/ from the index the MCP
//    server searches. scripts/check-search-index.js exists so it cannot happen
//    a third time.
//  * Archived API majors are excluded for free. They are HTML-only by design, so
//    a mirror-derived index cannot offer a stale API surface — the same rule
//    /api/search-index.json states in its own header.
//
// Only `index.md` is read. Each page also has a flat `<page>.md` twin with
// identical bytes (the ecosystem is split on which shape it should be, so the
// site serves both); reading one shape is what keeps every page out of the index
// twice.

"use strict";

const fs = require("fs");
const path = require("path");

const { slugify } = require("./md-slug.js");

// Metadata block emitted by _includes/mirror-meta.md, directly under the `# `
// title. Dropped from the indexed text: "Published: 2026-07-23" is in every
// mirror, so indexing it makes every page a hit for "published" and for any
// date that happens to be typed.
const META_LINE = /^(?:Source|Published|Updated|Author|Package|Canonical|Topics|Version|Generated|Note):\s/;

const MAX_SUMMARY = 200;

// Section labels, by first path segment. This is what the result rows show as a
// badge, and it is also the only thing distinguishing an article from reference
// documentation in the ranker (see the blog de-weighting in search.js).
const GROUPS = [
  [/^\/blog\/topics\//, "Topic"],
  [/^\/blog\/authors\//, "Author"],
  [/^\/blog\//, "Article"],
  [/^\/tutorial\//, "Tutorial"],
  [/^\/cli\//, "CLI"],
  [/^\/mcp\//, "MCP"],
  [/^\/agents\//, "Recipe"],
  [/^\/glossary\//, "Glossary"],
  [/^\/compare\//, "Compare"],
  [/^\/(?:license|terms|privacy|contributing|support|contact)\/?/, "Project"],
];

function groupFor(url) {
  for (const [re, label] of GROUPS) {
    if (re.test(url)) {
      return label;
    }
  }

  return "Docs";
}

/**
 * Markdown -> readable text.
 *
 * Code is KEPT rather than stripped: `brpop`, `callTimeout: 5000` and
 * `safeDelivery` are things people search for, and on this site they live in
 * fenced blocks as often as in prose. Only the fence markers and the syntax
 * punctuation go.
 *
 * Link TEXT is kept and the target dropped — a page linking to
 * /api/core/latest/core.redisqueue/ should not thereby rank for "latest".
 */
function plainText(md) {
  return String(md == null ? "" : md)
    // Liquid, HTML comments and raw tags. Named-tag stripping is deliberate:
    // a generic /<[^>]+>/ eats the angle-bracket placeholders that belong to
    // the prose — `imq client generate <name> [path]` would lose `<name>`.
    .replace(/\{%[\s\S]*?%\}/g, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<\/?(?:a|code|pre|em|strong|b|i|span|br|kbd|sup|sub|small|abbr|div|p|ul|ol|li|table|thead|tbody|tr|th|td|img|figure|figcaption|details|summary|section|nav|h[1-6])\b[^>]*>/gi, " ")
    // ![alt](src) before [text](href), or the alt text survives as "!alt".
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^\s*```.*$/gm, " ")
    .replace(/^\s*~~~.*$/gm, " ")
    .replace(/`/g, " ")
    .replace(/^\s{0,3}#{1,6}\s+/gm, " ")
    .replace(/^\s*>\s?/gm, " ")
    .replace(/^\s*[-*+]\s+/gm, " ")
    .replace(/^\s*\d+\.\s+/gm, " ")
    .replace(/^\s*\|?[\s:|-]{6,}\|?\s*$/gm, " ") // table separator rows
    .replace(/\|/g, " ")
    .replace(/\*\*|\*|__|~~/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Parse one built mirror.
 *
 * @returns {{title: string, url: string, body: string}|null} null when the file
 *   is not a mirror (no `# ` title, or no `Source:` line to take the URL from).
 */
function parseMirror(text) {
  const lines = String(text).split("\n");
  let title = null;
  let url = null;
  // Metadata is only recognised in the header block — the run of lines between
  // the `# ` title and the first line of prose. Matching it anywhere would delete
  // real content: "Note: …" and "Version: …" open paragraphs in this corpus.
  let inHeader = true;
  const body = [];

  for (const line of lines) {
    if (title === null) {
      const h1 = line.match(/^#\s+(.+?)\s*$/);

      if (h1) {
        title = h1[1].trim();
      }
      continue;
    }

    if (inHeader) {
      const source = line.match(/^Source:\s+https?:\/\/[^/]+(\/\S*)\s*$/);

      if (source && url === null) {
        url = source[1];
        continue;
      }
      if (line.trim() === "" || META_LINE.test(line)) {
        continue;
      }
      inHeader = false;
    }

    body.push(line);
  }

  if (title === null || url === null) {
    return null;
  }

  return { title, url, body: body.join("\n").replace(/^\s+/, "") };
}

/**
 * Split a mirror body into indexable sections at `##`/`###` boundaries.
 *
 * Section granularity, not page granularity: pages here run to 200 lines with
 * seven distinct answers in them, and a page-level hit makes the reader scan for
 * the one they asked about. Each section carries the anchor markdown-it-anchor
 * gave its heading, so a result deep-links to the paragraph.
 *
 * Fenced code is tracked so a `# comment` inside a shell example is not mistaken
 * for a heading.
 *
 * @returns {Array<{heading: string, level: number, anchor: string, text: string}>}
 */
function splitSections(body) {
  const sections = [];
  const seen = new Map();
  let current = { heading: "", level: 0, anchor: "", lines: [] };
  let fence = null;

  // Every heading is emitted, INCLUDING one with no prose of its own. A `## FAQ`
  // that goes straight into `### Does @imqueue retry…?` has an empty body, and
  // dropping it here dropped the marker faqRecords() gates on — 2 of the site's
  // 86 FAQ answers were being indexed. Callers that want text filter on it.
  const flush = () => {
    sections.push({
      heading: current.heading,
      level: current.level,
      anchor: current.anchor,
      text: plainText(current.lines.join("\n")),
    });
  };

  for (const line of body.split("\n")) {
    const fenceMark = line.match(/^\s{0,3}(```+|~~~+)/);

    if (fenceMark) {
      if (fence === null) {
        fence = fenceMark[1][0];
      } else if (fenceMark[1][0] === fence) {
        fence = null;
      }
      current.lines.push(line);
      continue;
    }

    const heading = fence === null ? line.match(/^(#{2,3})\s+(.+?)\s*$/) : null;

    if (!heading) {
      current.lines.push(line);
      continue;
    }

    flush();

    // Same de-duplication markdown-it-anchor applies, so the anchors here match
    // the ids in the HTML even when two headings slugify identically.
    const label = headingText(heading[2]);
    const base = slugify(label);
    const n = seen.get(base) || 0;

    seen.set(base, n + 1);

    current = {
      heading: label,
      level: heading[1].length,
      anchor: n === 0 ? base : `${base}-${n}`,
      lines: [],
    };
  }
  flush();

  return sections;
}

/**
 * Heading text, for the label AND for the slug.
 *
 * Deliberately NOT plainText(): that strips block-level markers, including the
 * ordered-list one, and `### 1. A home per project, automatically, with direnv`
 * therefore lost its "1." — producing the anchor
 * `#a-home-per-project-automatically-with-direnv` while the page's real id is
 * `#1-a-home-per-project-automatically-with-direnv`. 69 deep links pointed at
 * nothing. Only inline syntax is removed here, which is all a heading can contain.
 */
function headingText(md) {
  return String(md == null ? "" : md)
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\{[#.][^}]*\}/g, " ") // markdown-it-attrs, e.g. `## Title {#custom}`
    .replace(/<\/?(?:a|code|em|strong|b|i|span|br|kbd|sup|sub|small|abbr)\b[^>]*>/gi, " ")
    .replace(/`/g, "")
    .replace(/\*\*|__|~~/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function summarize(text) {
  const first = String(text).split(/\n\s*\n/).map(plainText).find(Boolean) || "";

  if (first.length <= MAX_SUMMARY) {
    return first;
  }

  const cut = first.slice(0, MAX_SUMMARY);

  return `${cut.slice(0, cut.lastIndexOf(" ")).trim()}…`;
}

/**
 * Question-shaped sections, promoted to direct answers.
 *
 * These are the most useful thing on the site to somebody who typed a question,
 * so search shows the answer text itself above the link list rather than making
 * the reader open the page.
 *
 * The gate is DELIBERATELY WIDER than the `faqPairs` filter's, which builds the
 * FAQPage JSON-LD: any heading that is a question, wherever it sits. faqPairs
 * requires a `## FAQ` / `## Frequently asked…` parent because schema.org's
 * FAQPage means "this page is an FAQ", and claiming it for a page that merely
 * contains a question would be a false claim about the page. Search has no such
 * obligation — and the difference is not hypothetical: /mcp/security/ answers 12
 * questions under `## Local or hosted…` and `## Troubleshooting`, and the
 * narrower gate found none of them. `## `-level questions count too, e.g.
 * "Which pitfalls does @imqueue actually take off your hands?".
 *
 * A heading with no prose under it is skipped: there is no answer to show.
 */
function faqRecords(sections, page) {
  return sections
    .filter((s) => s.level >= 2 && s.level <= 3 && s.heading.endsWith("?") && s.text)
    .map((s) => ({
      g: 2,
      t: s.heading,
      u: s.anchor ? `${page.url}#${s.anchor}` : page.url,
      s: summarize(s.text),
      k: page.title,
    }));
}

/**
 * Walk the built site and produce both index tiers.
 *
 * @param {string} outputDir e.g. "_site-org".
 * @returns {{tier1: object, tier2: object, stats: object}}
 */
// Ids present in a built page, read once per page.
const idCache = new Map();

function pageIds(outputDir, url) {
  if (!idCache.has(url)) {
    const html = path.join(outputDir, url.replace(/^\//, ""), "index.html");
    const ids = new Set();

    if (fs.existsSync(html)) {
      for (const match of fs.readFileSync(html, "utf8").matchAll(/\sid="([^"]+)"/g)) {
        ids.add(match[1]);
      }
    }
    idCache.set(url, ids);
  }

  return idCache.get(url);
}

let unanchored = 0;

/**
 * Drop an anchor the page does not actually have.
 *
 * Deriving anchors from the mirror and trusting them is not enough, because a
 * handful of pages are authored as Liquid templates with HAND-WRITTEN mirrors
 * (/blog/, the author pages) — their mirrors have headings the rendered page never
 * had, so `#articles` on an author page scrolls nowhere. The generator runs after
 * the build and can simply check. A section with no verifiable anchor is still
 * indexed; it just links to the page instead of into it.
 */
function verifyAnchor(part, outputDir, url) {
  if (!part.anchor || pageIds(outputDir, url).has(part.anchor)) {
    return part;
  }
  unanchored++;

  return { ...part, anchor: "" };
}

function buildCorpus(outputDir) {
  const docs = [];
  const faq = [];
  const pages = [];
  const sections = [];

  idCache.clear();
  unanchored = 0;

  const walk = (dir) => {
    const entries = fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of entries) {
      const abs = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        walk(abs);
        continue;
      }
      // Only the directory shape, and never the generated API reference: its
      // 1,150 symbol pages come from /api/search-index.json instead, which
      // already carries each symbol's exact name, kind, package and summary.
      if (entry.name !== "index.md") {
        continue;
      }

      const mirror = parseMirror(fs.readFileSync(abs, "utf8"));

      // `/api/` itself is a hand-written guide page and belongs here; everything
      // BELOW it is generated reference and comes from /api/search-index.json.
      // Excluding the whole prefix left the /api/ landing page — a sitemap URL —
      // unsearchable.
      if (!mirror || /^\/api\/.+/.test(mirror.url)) {
        continue;
      }

      const parts = splitSections(mirror.body).map((part) => verifyAnchor(part, outputDir, mirror.url));

      docs.push({
        g: 0,
        t: mirror.title,
        u: mirror.url,
        s: summarize(mirror.body),
        k: groupFor(mirror.url),
      });

      faq.push(...faqRecords(parts, mirror));

      const pageIdx = pages.length;

      pages.push([mirror.url, mirror.title, groupFor(mirror.url)]);

      for (const part of parts) {
        if (part.text) {
          sections.push([pageIdx, part.anchor, part.heading, part.text]);
        }
      }
    }
  };

  walk(outputDir);

  // The generated reference, verbatim from the feed the site already publishes.
  // Reusing it rather than re-deriving from the API mirrors is deliberate: that
  // feed's summaries come from the SHARED extractor that also writes each page's
  // meta description, and the last time this data was derived twice, 52% of the
  // entries in one copy were junk (101 of 349 were "<table><thead><tr><th>").
  const apiFeed = path.join(outputDir, "api", "search-index.json");
  let api = [];

  if (fs.existsSync(apiFeed)) {
    api = JSON.parse(fs.readFileSync(apiFeed, "utf8")).map((s) => {
      const entry = { g: 1, t: s.name, u: s.url, s: s.summary || "", k: s.kind || "", p: s.package };

      if (s.deprecated) {
        entry.d = 1;
      }

      return entry;
    });
  }

  return {
    tier1: { v: 1, records: [...faq, ...docs, ...api] },
    tier2: { v: 1, pages, sections },
    stats: {
      docs: docs.length,
      faq: faq.length,
      api: api.length,
      sections: sections.length,
      // Reported rather than swallowed: a jump here means a page's rendered
      // headings and its markdown mirror have drifted apart.
      unanchored,
    },
  };
}

module.exports = {
  buildCorpus,
  faqRecords,
  groupFor,
  headingText,
  parseMirror,
  plainText,
  splitSections,
  summarize,
};
