#!/usr/bin/env node
/*
 * Regenerate the CLI User Guide (src/org/cli/*.md) from the @imqueue/cli wiki.
 *
 *   node scripts/sync-cli-wiki.js [--wiki <dir>] [--check]
 *
 *   --wiki <dir>  Path to the cli repo's wiki/ directory.
 *                 Default: ../cli/wiki relative to this repo (sibling checkout),
 *                 overridable with the CLI_WIKI_DIR env var.
 *   --check       Do not write; exit 1 if the generated output would differ from
 *                 what is on disk (useful in CI to detect drift).
 *
 * The page bodies come verbatim from the wiki; this repo owns only the editorial
 * front matter and ordering (scripts/cli-wiki-manifest.js). The transform is
 * deterministic and idempotent: re-running with an unchanged wiki produces no
 * diff. It performs exactly the three things a plain copy cannot:
 *
 *   1. strips the leading "# Title" (the title comes from the manifest);
 *   2. rewrites GitHub-wiki links  [x](Page)  /  [x](Page#anchor)  to site URLs;
 *   3. pins an explicit {#slug} on every heading that another page (or the same
 *      page) links to by #fragment — because this site's markdown slugifier is
 *      not GitHub-compatible, so wiki anchors would otherwise not resolve.
 */
"use strict";
const fs = require("fs");
const path = require("path");
const { pages, externalRewrites } = require("./cli-wiki-manifest.js");

const REPO = path.resolve(__dirname, "..");
const OUT_DIR = path.join(REPO, "src/org/cli");

const argv = process.argv.slice(2);
const CHECK = argv.includes("--check");
const wikiArg = (() => {
  const i = argv.indexOf("--wiki");
  return i >= 0 ? argv[i + 1] : process.env.CLI_WIKI_DIR;
})();
const WIKI_DIR = path.resolve(wikiArg || path.join(REPO, "../cli/wiki"));

// GitHub-compatible heading slug (matches the anchors the wiki links use):
// lowercase, strip anything but word chars / spaces / hyphens, spaces -> hyphens.
function githubSlug(text) {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\w\- ]+/g, "") // drop punctuation (parens, colons, dots, slashes, backticks, em-dashes…)
    .replace(/ /g, "-");
}

// Plain-text of a heading line: drop the leading #'s, strip markdown emphasis/
// code markers so the slug is computed from the visible text.
function headingText(line) {
  return line
    .replace(/^#{1,6}\s+/, "")
    .replace(/\{#[^}]+\}\s*$/, "") // any pre-existing explicit id
    .replace(/[`*_]/g, "")
    .trim();
}

// wiki page name (file without .md) -> site URL, e.g. Configuration -> /cli/configuration/
const pageUrlByName = new Map(
  pages.map((p) => [p.wiki.replace(/\.md$/, ""), p.url])
);

// --- pass 1: collect every #fragment that is linked to, per destination page ---
// A link [text](Page#frag) references (Page, frag). A same-page [text](#frag)
// references (currentPage, frag). We only need anchors that are actually linked.
const linkedAnchors = new Map(); // pageName -> Set(frag)
function addAnchor(pageName, frag) {
  if (!frag) return;
  if (!linkedAnchors.has(pageName)) linkedAnchors.set(pageName, new Set());
  linkedAnchors.get(pageName).add(frag);
}

const LINK_RE = /\]\(([^)\s]+)\)/g; // ](target) with no spaces in target
const raw = new Map(); // wiki file -> source text
for (const p of pages) {
  const src = fs.readFileSync(path.join(WIKI_DIR, p.wiki), "utf8");
  raw.set(p.wiki, src);
  const thisName = p.wiki.replace(/\.md$/, "");
  let m;
  LINK_RE.lastIndex = 0;
  while ((m = LINK_RE.exec(src))) {
    const target = m[1];
    if (target.startsWith("#")) {
      addAnchor(thisName, target.slice(1));
    } else {
      const [name, frag] = target.split("#");
      if (pageUrlByName.has(name)) addAnchor(name, frag);
    }
  }
}

// --- rewrite a single link target from wiki-space to site-space ---
function rewriteTarget(target) {
  if (Object.prototype.hasOwnProperty.call(externalRewrites, target)) {
    return externalRewrites[target];
  }
  if (target.startsWith("#") || target.startsWith("/") || /^[a-z]+:/i.test(target)) {
    return target; // same-page anchor, already-absolute, or external URL
  }
  const [name, frag] = target.split("#");
  if (pageUrlByName.has(name)) {
    return pageUrlByName.get(name) + (frag ? "#" + frag : "");
  }
  return target;
}

// --- generate one page ---
function generate(p, index) {
  const total = pages.length;
  const n = index + 1;
  const src = raw.get(p.wiki);
  const lines = src.replace(/\r\n/g, "\n").split("\n");

  // strip the leading "# H1" (and the blank line following it)
  let start = 0;
  while (start < lines.length && lines[start].trim() === "") start++;
  if (lines[start] && /^#\s+/.test(lines[start])) {
    start++;
    while (start < lines.length && lines[start].trim() === "") start++;
  }
  const body = lines.slice(start);

  const wantAnchors = linkedAnchors.get(p.wiki.replace(/\.md$/, "")) || new Set();

  const out = body.map((line) => {
    let l = line;
    // (2) rewrite links
    l = l.replace(LINK_RE, (whole, target) => "](" + rewriteTarget(target) + ")");
    // (3) pin {#slug} on headings that are linked to by #fragment
    if (/^#{2,6}\s+/.test(l) && !/\{#[^}]+\}\s*$/.test(l)) {
      const slug = githubSlug(headingText(l));
      if (wantAnchors.has(slug)) l = l.replace(/\s*$/, "") + ` {#${slug}}`;
    }
    return l;
  });

  const fm = [
    "---",
    `chapter: ${n}`,
    `title: ${JSON.stringify(p.title)}`,
    `docLabel: ${JSON.stringify(`CLI MANUAL — ${String(n).padStart(2, "0")} / ${total}`)}`,
    `lead: ${JSON.stringify(p.lead)}`,
    `description: ${JSON.stringify(p.description)}`,
    `keywords: ${JSON.stringify(p.keywords)}`,
    "ogType: article",
    "---",
    "",
    "",
  ].join("\n");

  // normalise trailing whitespace: exactly one final newline
  let bodyText = out.join("\n").replace(/\n+$/, "") + "\n";
  return fm + bodyText;
}

// --- run ---
if (!fs.existsSync(WIKI_DIR)) {
  console.error(`✗ wiki dir not found: ${WIKI_DIR}\n  pass --wiki <dir> or set CLI_WIKI_DIR.`);
  process.exit(2);
}

let changed = 0;
const written = [];
for (let i = 0; i < pages.length; i++) {
  const p = pages[i];
  const outPath = path.join(OUT_DIR, p.out);
  const next = generate(p, i);
  const prev = fs.existsSync(outPath) ? fs.readFileSync(outPath, "utf8") : null;
  if (prev !== next) {
    changed++;
    if (CHECK) {
      console.error(`≠ would change: src/org/cli/${p.out}`);
    } else {
      fs.writeFileSync(outPath, next);
      written.push(p.out);
    }
  }
}

if (CHECK) {
  if (changed) {
    console.error(`\n✗ ${changed} page(s) out of date. Run: node scripts/sync-cli-wiki.js`);
    process.exit(1);
  }
  console.log("✓ CLI User Guide is in sync with the wiki.");
} else {
  console.log(
    written.length
      ? `✓ synced ${written.length} page(s): ${written.join(", ")}`
      : "✓ already up to date — no changes."
  );
}
