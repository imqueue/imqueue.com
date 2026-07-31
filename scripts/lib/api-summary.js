// Derive a per-symbol `<meta name="description">` from an api-documenter page.
//
// Why: 351 of the 352 indexed API pages shared one meta description (the site
// slogan), because the generated front matter only carried `title`. The summary
// sentence api-documenter already emits under the symbol heading is exactly the
// right text, it just was not being lifted into the front matter.
//
// Shared by scripts/build-api-docs.js (at generation time),
// scripts/backfill-api-descriptions.js (which applies it to pages that were
// generated before this existed), and src/org/api/search-index.11ty.js (which
// reads the STORED pages), so the three can never drift.
//
// It has to handle both inputs, and they differ in one way that matters: raw
// api-documenter markdown opens the symbol section at `##`, while a stored page
// has had that first heading promoted to `#` (promoteFirstHeading, so the page has
// a real h1). Hence the `#{1,2}` below — anchoring to `##` alone made this read
// the section after `## Parameters` on a stored page and return the parameter
// table, which is exactly the defect the search index shipped.

const MAX = 160; // Google renders ~155–160 characters

// Blocks that follow the symbol heading but are not prose.
const NOT_PROSE =
  /^(?:#{1,6}\s|\*\*(?:Signature|Extends|Implements|References|Returns|Type|Parameters)\b|```|\||:|<)/;

// api-documenter emits its parameter/property tables as raw HTML, and the blank
// lines inside them mean a mid-table chunk can start with `</th>` rather than
// `<table`. Reject anything carrying table markup wherever it appears.
const TABLE_MARKUP = /<\/?(?:table|thead|tbody|tr|th|td)\b/i;

// api-documenter escapes markdown-significant characters and emits `<!-- -->`
// spacers plus HTML-escaped angle brackets. Undo all of it for plain-text use.
function toPlainText(md) {
  return md
    .replace(/<!-- -->/g, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    // Blockquote markers, per line. api-documenter renders `@deprecated` as a
    // blockquote whose PROSE is inside the quote, so the block cannot just be
    // skipped — doing that leaves a deprecated symbol with no summary at all.
    // Dropping the syntax and keeping the sentence gives the real thing:
    // "Warning: This API is now obsolete. Inert, and always absent in practice…"
    // instead of "> Warning: This API is now obsolete. > > Inert, and always…".
    .replace(/^[ \t]*>+[ \t]?/gm, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')            // images
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')         // links -> label
    .replace(/`([^`]+)`/g, '$1')                     // inline code
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/(?<!\\)\*([^*]+)\*/g, '$1')
    .replace(/\\([\\`*_{}[\]()#+\-.!|<>~])/g, '$1')  // markdown escapes
    .replace(/&gt;/g, '>')
    .replace(/&lt;/g, '<')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')                          // last: &amp;gt; -> >
    .replace(/\s+/g, ' ')
    .trim();
}

// The first prose paragraph of the page's own summary section.
//
// Scoped strictly to the text between the `<Symbol> <kind>` heading and whatever
// ends that section — the signature block, or the next heading. Searching the
// whole page instead lets a symbol whose summary is very short ("Any JSON
// value.") fall through and pick up a sentence from ## Remarks, which reads as a
// non-sequitur in a search result.
function summaryParagraph(md) {
  const body = md.replace(/^---\n[\s\S]*?\n---\n/, '');
  // `#` or `##`: the symbol heading is `##` in raw api-documenter output and `#`
  // in a stored page. Sub-headings ("Parameters", "Remarks") stay `##` in both, so
  // splitting on either level still ends the section in the right place.
  const section = (body.split(/^#{1,2}\s+.+$/m)[1] || '')
    .split(/^\*\*Signature:\*\*/m)[0];

  if (!section.trim()) {
    return '';
  }

  for (const block of section.split(/\n\s*\n/)) {
    const text = block.trim();

    if (!text || NOT_PROSE.test(text) || TABLE_MARKUP.test(text)) {
      continue;
    }
    // The breadcrumb line is a run of links joined by ">" — never a summary.
    if (/^\[Home\]/.test(text)) {
      continue;
    }

    const plain = toPlainText(text);

    // Low floor on purpose: a real three-word summary beats a borrowed sentence.
    if (plain.length > 3) {
      return plain;
    }
  }

  return '';
}

// Keep whole sentences where possible, otherwise cut on a word boundary.
function clamp(text) {
  if (text.length <= MAX) {
    return text;
  }

  const sentences = text.split(/(?<=[.!?])\s+(?=[A-Z"'(])/);
  let out = '';

  for (const s of sentences) {
    if (out && (`${out} ${s}`).length > MAX) {
      break;
    }
    out = out ? `${out} ${s}` : s;
  }

  if (out.length && out.length <= MAX) {
    return out;
  }

  const cut = text.slice(0, MAX - 1);

  return `${cut.slice(0, cut.lastIndexOf(' ')).replace(/[,;:.]$/, '')}…`;
}

/**
 * Build the meta description for one generated API page.
 *
 * @param {string} md       Raw api-documenter markdown (front matter optional).
 * @param {object} ctx
 * @param {string} ctx.pkg     Package name without the scope, e.g. "rpc".
 * @param {string} ctx.version Version the page documents.
 * @param {string} ctx.symbol  Heading text, e.g. "IMQRPCError interface".
 * @returns {string} A description that is unique to this page.
 */
function apiDescription(md, { pkg, version, symbol }) {
  const summary = summaryParagraph(md);

  if (summary) {
    // Deliberately NOT padded out to a "nicer" length with the package name.
    // The defect being fixed is that ~1000 pages shared one description; a short
    // accurate sentence is unique, and Google simply writes its own snippet when
    // a description is too short. A repeated tail would reintroduce boilerplate.
    return clamp(summary);
  }

  // No prose in the source JSDoc — common, because the packages document with
  // JSDoc rather than TSDoc and API Extractor discards much of that prose. The
  // symbol name still makes the page unique, which is the point.
  return clamp(`${symbol} — @imqueue/${pkg} ${version} API reference.`);
}

module.exports = { apiDescription, summaryParagraph, toPlainText, clamp };
