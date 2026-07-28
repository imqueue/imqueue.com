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
const API_LATEST = /^\/api\/([^/]+)\/latest\//;

// api-documenter's page titles are "<Name> <kind> · @imqueue/<pkg>", e.g.
// "RedisQueue.send() method" or "IMQOptions.watcherCheckDelay property".
const KINDS = new Set([
  "class", "interface", "enum", "method", "property", "function", "variable",
  "type", "namespace", "constructor", "package",
]);

function parseTitle(title, isPackageIndex) {
  const name = String(title || "").split(" · ")[0].trim();

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
  const last = parts[parts.length - 1].toLowerCase();

  if (parts.length > 1 && KINDS.has(last)) {
    // Trailing "()" is presentational for methods/functions; the callable name
    // is what an agent needs to write in code.
    return { name: parts.slice(0, -1).join(" ").replace(/\(\)$/, ""), kind: last };
  }

  return { name, kind: "" };
}

// The summary is the first prose paragraph after the page's `## ` heading.
// Everything here is api-documenter output, so the shape is predictable.
function extractSummary(raw) {
  const body = String(raw || "").replace(/^---[\s\S]*?\n---\n/, "");
  const afterHeading = body.split(/\n##\s+[^\n]*\n/)[1];

  if (!afterHeading) {
    return "";
  }

  for (const block of afterHeading.split(/\n\s*\n/)) {
    const text = block
      .replace(/<!-- -->/g, "")
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1") // links -> their text
      .replace(/&gt;/g, ">")
      .replace(/&lt;/g, "<")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&amp;/g, "&")
      .replace(/\\([\\`*_{}[\]()#+\-.!|<>~])/g, "$1") // api-documenter escapes
      .replace(/\s+/g, " ")
      .trim();

    // Skip the deprecation banner and the signature block; keep looking for prose.
    if (!text || text.startsWith(">") || text.startsWith("**") || text.startsWith("|")
      || text.startsWith("```")) {
      continue;
    }

    return text;
  }

  return "";
}

module.exports = class ApiSearchIndex {
  data() {
    return {
      permalink: "/api/search-index.json",
      eleventyExcludeFromCollections: true,
    };
  }

  render(data) {
    const symbols = [];

    for (const item of data.collections.contentMd || []) {
      const url = item.url || "";
      const match = API_LATEST.exec(url);

      if (!match) {
        continue; // hand-written pages and the /api/ landing page
      }

      const isPackageIndex = url === `/api/${match[1]}/latest/`;
      const { name, kind } = parseTitle(item.data.title, isPackageIndex);
      const raw = item.rawInput || "";

      const entry = {
        name,
        kind,
        package: `@imqueue/${match[1]}`,
        url,
        summary: extractSummary(raw),
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
