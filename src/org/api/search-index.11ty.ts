// Emits /api/search-index.json — a symbol-level index of the generated API
// reference, for AI agents and the @imqueue MCP server's search_docs.
//
// llms.txt lists only the two package indexes: enumerating 350+ symbol pages
// there would bury the curated guides. But a symbol name is the most natural
// thing an agent searches for ("watcherCheckDelay", "RedisQueue.send"), and
// without this feed such a query matches nothing — or worse, matches an
// unrelated page on a common word. The site is the only place that knows each
// symbol's exact name, kind and summary, so it publishes them here, following
// the same convention as /blog/search-index.json.
//
// Only the current major of each package is indexed, matching the markdown
// mirrors: an agent must never be handed a stale API surface.
//
// The summary comes from the SHARED extractor that also writes each page's meta
// description. This file used to carry its own near-copy, and the copy was broken
// in two ways that only showed up here: it had no table-markup rejection, and it
// anchored the symbol section to `##` when a stored page's symbol heading has been
// promoted to `#`. Between them, 101 of the 349 shipped entries had
// `"summary": "<table><thead><tr><th>"` and 81 were empty — 52% junk, in the feed
// llms.txt advertises for symbol lookup. There is now one implementation.
import type { EleventyData } from '../../../scripts/lib/eleventy.ts';

import { summaryParagraph } from "../../../scripts/lib/api-summary.ts";

const API_LATEST = /^\/api\/([^/]+)\/latest\//;

// api-documenter's page titles are "<Name> <kind> · @imqueue/<pkg>", e.g.
// "RedisQueue.send() method" or "IMQOptions.watcherCheckDelay property".
const KINDS = new Set([
  "class", "interface", "enum", "method", "property", "function", "variable",
  "type", "namespace", "constructor", "package",
]);

/** One record of the generated /api/search-index.json feed. */
interface SymbolEntry {
  name: string;
  kind: string;
  package: string;
  url: string;
  summary: string;
  /** Set only when api-documenter marked the symbol obsolete. */
  deprecated?: boolean;
}

function parseTitle(
  title: unknown,
  isPackageIndex: boolean,
): { name: string; kind: string } {
  const name = (String(title || "").split(" · ")[0] ?? "").trim();

  // "@imqueue/core 3.3.0 · API reference" — the package landing page.
  if (isPackageIndex) {
    return { name: name.replace(/\s+\d+\.\d+\.\d+.*$/, ""), kind: "package" };
  }

  // Construct signatures are titled "RedisQueue.(constructor)" / "ICacheConstructor.(new)"
  // — no trailing kind word, so name them for what they are.
  if (/\.\((?:constructor|new)\)$/.test(name)) {
    return { name, kind: "constructor" };
  }

  const parts = name.split(/\s+/);
  const last = (parts[parts.length - 1] ?? "").toLowerCase();

  if (parts.length > 1 && KINDS.has(last)) {
    // Trailing "()" is presentational for methods/functions; the callable name
    // is what an agent needs to write in code.
    return { name: parts.slice(0, -1).join(" ").replace(/\(\)$/, ""), kind: last };
  }

  return { name, kind: "" };
}

export default class ApiSearchIndex {
  data() {
    return {
      permalink: "/api/search-index.json",
      eleventyExcludeFromCollections: true,
    };
  }

  render(data: EleventyData) {
    const symbols: SymbolEntry[] = [];

    for (const item of data.collections?.contentMd ?? []) {
      const url = item.url || "";
      const match = API_LATEST.exec(url);

      if (!match) {
        continue; // hand-written pages and the /api/ landing page
      }

      const pkg = match[1] ?? "";
      const isPackageIndex = url === `/api/${pkg}/latest/`;
      const { name, kind } = parseTitle(item.data.title, isPackageIndex);
      const raw = item.rawInput || "";

      const entry: SymbolEntry = {
        name,
        kind,
        package: `@imqueue/${pkg}`,
        url,
        summary: summaryParagraph(raw),
      };

      // api-documenter renders `@deprecated` as this banner. Surfacing it in the
      // index keeps an agent from reaching for an obsolete member.
      if (/Warning: This API is now obsolete/.test(raw)) {
        entry.deprecated = true;
      }

      symbols.push(entry);
    }

    symbols.sort((a, b) => a.url.localeCompare(b.url));

    return JSON.stringify(symbols);
  }
};
