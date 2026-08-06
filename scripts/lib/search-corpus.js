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
const { lemmaOf, report } = require("./lemma.js");

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
// The shape of every feed this module writes. The ranker declares the shape it READS
// (FEED_V in src/_shared/js/search.js) and check-search-index.js fails when the two disagree —
// which is what stops a pinned, submoduled ranker from silently misreading live feeds it was
// never written for. Bump both when a tuple position or a top-level key changes.
const FEED_V = 1;

function parseMirror(text) {
  const lines = String(text).split("\n");
  let title = null;
  let url = null;
  // File line index of each line kept in `body`, so a section's range can be reported in the
  // coordinates of the FILE an agent fetches rather than of this substring. The header block is
  // a variable number of lines — title, Source, blanks, META_LINE metadata — so the offset
  // cannot be assumed, and assuming it would slice the wrong text silently instead of erroring.
  const at = [];
  // Metadata is only recognised in the header block — the run of lines between
  // the `# ` title and the first line of prose. Matching it anywhere would delete
  // real content: "Note: …" and "Version: …" open paragraphs in this corpus.
  let inHeader = true;
  const body = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

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
    at.push(i);
  }

  if (title === null || url === null) {
    return null;
  }

  // The leading-whitespace trim is preserved, but done by DROPPING whole blank lines first so the
  // file offset stays exact. `.replace(/^\s+/, "")` on the joined string would have eaten leading
  // newlines invisibly, and every range after them would be short by that many lines.
  let first = 0;

  while (first < body.length && body[first].trim() === "") {
    first++;
  }

  return {
    title,
    url,
    body: body.slice(first).join("\n").replace(/^\s+/, ""),
    // 0-based file line index of the body's first line. Add it to a section range to get the
    // range within the mirror file itself.
    bodyLine: first < at.length ? at[first] : 0,
  };
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
  let current = { heading: "", level: 0, anchor: "", lines: [], start: 0 };
  let fence = null;
  // Line index within `body`, so each section can report the range it occupies. A range, not the
  // text: search-text.json already carries section text, but plainText()-normalised with code
  // fences stripped, which is useless for handing back markdown.
  let at = 0;

  // Every heading is emitted, INCLUDING one with no prose of its own. A `## FAQ`
  // that goes straight into `### Does @imqueue retry…?` has an empty body, and
  // dropping it here dropped the marker faqRecords() gates on — 2 of the site's
  // 86 FAQ answers were being indexed. Callers that want text filter on it.
  const flush = () => {
    const raw = current.lines.join("\n");

    sections.push({
      heading: current.heading,
      level: current.level,
      anchor: current.anchor,
      // [start, end) within `body`, half-open so end - start is the line count. `start` is the
      // heading's own line, because a slice that omitted its heading would hand an agent a
      // fragment with no idea what it is about.
      start: current.start,
      end: at,
      text: plainText(raw),
      // Extracted from the RAW markdown, before plainText() deletes the markers
      // that identify it. See emphasized().
      emphasis: emphasized(raw),
    });
  };

  // A THEMATIC BREAK ends the section too, and the text after it belongs to the page
  // rather than to the heading above it.
  //
  // Every blog post closes with `---` and then a "where to go next" paragraph. Without
  // this the paragraph is glued onto whatever the last heading was, and on nine posts that
  // heading is an FAQ answer — so `### Can I use @imqueue with a GraphQL or REST gateway?`
  // ended up containing the sentence "Shipping inside a closed-source product? See
  // commercial licensing & support", and was returned as the second-best answer to "can i
  // use imqueue commercially". It also put a literal "---" in the middle of that answer's
  // snippet in the dialog, which is how it was noticed.
  //
  // The text is KEPT, as a headingless section: it is real prose with real links, and a
  // page-level hit for it is honest. Dropping it would be a judgement that trailing
  // navigation is worthless, which is a bigger claim than the one this fixes.
  //
  // `previousBlank` is required because `text` followed by `---` is a SETEXT H2 in
  // markdown, not a rule. Every real break in this corpus has a blank line before it.
  let previousBlank = true;

  const lines = body.split("\n");

  for (at = 0; at < lines.length; at++) {
    const line = lines[at];
    const fenceMark = line.match(/^\s{0,3}(```+|~~~+)/);

    if (fenceMark) {
      if (fence === null) {
        fence = fenceMark[1][0];
      } else if (fenceMark[1][0] === fence) {
        fence = null;
      }
      current.lines.push(line);
      previousBlank = false;
      continue;
    }

    if (fence === null && previousBlank && /^ {0,3}(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      flush();
      // The thematic break itself is consumed, so the next section starts after it.
      current = { heading: "", level: 0, anchor: "", lines: [], start: at + 1 };
      previousBlank = true;
      continue;
    }

    const heading = fence === null ? line.match(/^(#{2,3})\s+(.+?)\s*$/) : null;

    if (!heading) {
      current.lines.push(line);
      previousBlank = line.trim() === "";
      continue;
    }

    flush();
    previousBlank = false;

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
      start: at,
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

/**
 * The emphasized text of a section, as one string.
 *
 * Ranking weights title > heading > emphasis > body density, and emphasis is the
 * element that was missing: plainText() deletes `**`, `*` and `>` along with the
 * rest of the syntax, so a term the author had bolded scored exactly like a term
 * buried in a paragraph. Authors emphasize what a passage is ABOUT, which makes
 * this the cheapest signal on the page.
 *
 * Bold, italic and blockquotes only. Inline `code` is deliberately excluded: on
 * this site almost every paragraph contains some, so it separates nothing — the
 * body text already carries those identifiers, and giving them emphasis weight
 * would promote every page that mentions any API name in passing.
 */
function emphasized(md) {
  const found = [];
  const text = String(md == null ? "" : md);

  for (const re of [
    /\*\*([^*\n]+)\*\*/g,          // **bold**
    /__([^_\n]+)__/g,              // __bold__
    /(?:^|[\s(])\*([^*\n]+)\*/g,   // *italic*, not a list bullet
    /(?:^|[\s(])_([^_\n]+)_/g,     // _italic_
    /^\s{0,3}>\s?(.+)$/gm,         // > blockquote
  ]) {
    for (const match of text.matchAll(re)) {
      found.push(match[1]);
    }
  }

  return plainText(found.join(" "));
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

/**
 * Surface form -> lemma, for every word in the corpus whose lemma differs.
 *
 * Only the DELTA is emitted: 64% of the vocabulary is already its own lemma and needs
 * no entry. The client applies the map to the prose it has already folded, so no
 * per-section lemma data ships — this map is the entire cost of morphology on the
 * wire, and the ~20 ms of lookups at load is cheaper than the bytes would be.
 *
 * Stopwords are left IN the map. They are excluded at match time instead (the ranker
 * knows which terms are stopwords), so the exclusion lives in one place rather than
 * being duplicated here as a second list that could drift.
 */
function vocabularyOf(text, into) {
  for (const word of String(text).toLowerCase().split(/[^a-z0-9]+/)) {
    if (word) {
      into.add(word);
    }
  }

  return into;
}

function lemmaMap(words) {
  const map = {};

  for (const word of words) {
    const lemma = lemmaOf(word);

    if (lemma !== word) {
      map[word] = lemma;
    }
  }

  return map;
}

/**
 * Curated `description`/`summary` and `keywords` per URL, from the build intermediate
 * src/search-frontmatter.11ty.js writes.
 *
 * MOVED out of the output directory rather than deleted, and that distinction is the whole
 * function. Deleting it made this generator NON-IDEMPOTENT: `eleventy.after` fires on every
 * rebuild, including the incremental ones under `--serve`, and an incremental rebuild that
 * did not happen to re-render this one template found no file — so the index was rewritten
 * with every curated description and keyword list silently absent. It cost two rounds of
 * "the keywords element has stopped working" with numbers identical to before the feature
 * existed, which is the most convincing kind of wrong.
 *
 * Keeping a copy outside the output keeps both properties: it never ships (it duplicates
 * facts already public in llms.txt and in each page's meta description, so a third machine
 * -readable copy would be a maintenance surface with no consumer), and any rebuild can read
 * it whether or not the template ran. Per edition, because org and com have different
 * front matter and one cache would serve whichever built last.
 */
function takeFrontmatter(outputDir) {
  const cache = path.join(
    __dirname, "..", "..",
    `.search-frontmatter-${path.basename(outputDir)}.json`
  );
  const fresh = path.join(outputDir, "search-frontmatter.json");

  if (fs.existsSync(fresh)) {
    fs.copyFileSync(fresh, cache);
    fs.unlinkSync(fresh);
  }
  if (!fs.existsSync(cache)) {
    return {};
  }

  return JSON.parse(fs.readFileSync(cache, "utf8"));
}

function buildCorpus(outputDir) {
  const docs = [];
  const faq = [];
  const pages = [];
  const sections = [];
  // url -> { anchor: [startLine, endLine) } into the markdown mirror. See the walk below.
  const ranges = {};
  const vocabulary = new Set();

  const frontmatter = takeFrontmatter(outputDir);

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
      //
      // WITH ONE EXCEPTION, and it was measured: the 16 PACKAGE INDEX pages,
      // /api/<pkg>/latest/. They are not symbol pages. Each one carries an
      // overview naming the entry points, a Remarks section stating the
      // behaviours no signature shows, and worked code examples — the best page
      // in the reference for anyone who does not already know what to call.
      //
      // All of that was invisible to search. The feed gives these URLs ONE record
      // whose entire searchable text is a title and a one-line summary, so
      // "protect an HTTP gateway from too many requests per IP" returned four
      // HttpProtect *property* pages — each with its own summary mentioning
      // requests and IPs — while the page holding `app.use(new
      // HttpProtect().jsonMiddleware())` never appeared at all. Measured over a
      // scratch build against 14 packages, this was the single largest source of
      // unanswerable questions: the `hardening` topic of the question KPI scored
      // 0% on BOTH rankers, because what answers it was not in the corpus.
      //
      // Sections only, NOT a page record: the feed already contributes a `package`
      // record for this exact URL with the right title, kind and package name.
      // Pushing a second record for the same URL would put two spellings of one
      // page in the index and leave the ranker's URL dedupe to pick between them.
      const isPackageIndex = mirror && /^\/api\/[^/]+\/latest\/$/.test(mirror.url);
      // /api/faq/ is authored prose that happens to live under /api/, and it is
      // the page most directly aimed at this corpus: nineteen question-shaped
      // headings, each of which faqRecords() below turns into a direct answer with
      // its own anchor. Excluding it by prefix would have dropped exactly the
      // records the questions were written to produce.
      const isAuthoredPage = mirror && /^\/api\/faq\/$/.test(mirror.url);

      if (!mirror
        || (/^\/api\/.+/.test(mirror.url) && !isPackageIndex && !isAuthoredPage)) {
        continue;
      }

      const parts = splitSections(mirror.body).map((part) => verifyAnchor(part, outputDir, mirror.url));

      const meta = frontmatter[mirror.url] || {};
      // Named `record`, not `entry`: the enclosing loop's variable is the directory entry,
      // and shadowing it in the same block is a temporal-dead-zone error at the line ABOVE
      // this one, which reads as the readdir having failed.
      const record = {
        g: 0,
        t: mirror.title,
        u: mirror.url,
        // The CURATED description wins over the first paragraph. It was written to say
        // what the page answers, in one sentence; a lead paragraph was written to be read
        // next. Falling back matters for the pages that have neither.
        s: meta.d ? summarize(meta.d) : summarize(mirror.body),
        k: groupFor(mirror.url),
      };

      // Curated keywords, as their own scoring element — see E.keywords in search.js. This
      // is the one signal no amount of body analysis can reconstruct: it is the author
      // stating which queries the page exists to answer.
      if (meta.k) {
        vocabularyOf(meta.k, vocabulary);
        record.w = meta.k;
      }

      if (!isPackageIndex) {
        docs.push(record);
      }

      // faqRecords is driven by heading SHAPE, so it contributes nothing from a
      // package index today (its headings are Remarks, Example 1, Classes). Left
      // running rather than skipped: if one of those pages ever grows a
      // question-shaped heading, that heading is a good answer.
      faq.push(...faqRecords(parts, mirror));

      const pageIdx = pages.length;

      pages.push([mirror.url, mirror.title, groupFor(mirror.url)]);

      vocabularyOf(`${mirror.title} ${mirror.body}`, vocabulary);

      for (const part of parts) {
        if (part.text) {
          sections.push([pageIdx, part.anchor, part.heading, part.text, part.emphasis]);
        }

        // The RANGE map, in the coordinates of the mirror FILE. Published so a reader that
        // fetched /page/index.md can return one section of it instead of the whole page, without
        // re-deriving heading boundaries: a `#` at the start of a line inside a bash fence is
        // indistinguishable from a heading, and this corpus is full of them, so a regex slicer
        // eventually cuts inside a fence and emits an unbalanced one. These come from the parsed
        // walk that already knows where the fences are.
        //
        // Ranges rather than text, because search-text.json's text is plainText()-normalised with
        // fences stripped — correct for scoring, useless for handing back markdown.
        if (part.anchor) {
          ranges[mirror.url] = ranges[mirror.url] || {};
          ranges[mirror.url][part.anchor] = [
            part.start + mirror.bodyLine,
            part.end + mirror.bodyLine,
          ];
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

  const lemmas = lemmaMap(vocabulary);

  return {
    tier1: { v: FEED_V, records: [...faq, ...docs, ...api] },
    tier2: { v: FEED_V, pages, sections, lemmas },
    // Anchor -> line range into each page's markdown mirror. Its own feed rather than a field of
    // tier 2, because tier 2 is fetched by every visitor who searches and this is for readers that
    // fetch the mirrors instead — no browser has any use for it.
    sectionRanges: { v: FEED_V, pages: ranges },
    stats: {
      docs: docs.length,
      faq: faq.length,
      api: api.length,
      sections: sections.length,
      // Reported rather than swallowed: a jump here means a page's rendered
      // headings and its markdown mirror have drifted apart.
      unanchored,
      vocabulary: vocabulary.size,
      keyworded: docs.filter((d) => d.w).length,
      lemmas: Object.keys(lemmas).length,
      // Stems a detachment produced, that the dictionary rejected, and that the corpus
      // uses as words: candidates for scripts/data/project-words.txt. Reported rather
      // than added automatically — see that file for why roughly one in seven is a trap.
      missingWords: report(vocabulary),
    },
  };
}

module.exports = {
  buildCorpus,
  emphasized,
  faqRecords,
  groupFor,
  headingText,
  parseMirror,
  plainText,
  splitSections,
  FEED_V,
  summarize,
};
