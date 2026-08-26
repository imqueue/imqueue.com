#!/usr/bin/env node
/*
 * Regenerate the CLI User Guide (src/org/cli/*.md) from the @imqueue/cli wiki.
 *
 *   node scripts/sync-cli-wiki.ts [--wiki <dir>] [--check]
 *
 *   --wiki <dir>  Path to the cli repo's wiki/ directory.
 *                 Default: ../cli/wiki relative to this repo (sibling checkout),
 *                 overridable with the CLI_WIKI_DIR env var.
 *   --check       Do not write; exit 1 if the generated output would differ from
 *                 what is on disk (useful in CI to detect drift). Part of
 *                 `npm test`, via the sync-cli-guide:check script.
 *
 * CLI_WIKI_REQUIRED=1 makes --check fail when the wiki dir is missing instead of
 * skipping. CI sets it; see the note above the existsSync check before pass 1.
 *
 * The page bodies come verbatim from the wiki; this repo owns only the editorial
 * front matter and ordering (scripts/cli-wiki-manifest.ts). The transform is
 * deterministic and idempotent: re-running with an unchanged wiki produces no
 * diff. It performs exactly the three things a plain copy cannot:
 *
 *   1. strips the leading "# Title" (the title comes from the manifest);
 *   2. rewrites GitHub-wiki links  [x](Page)  /  [x](Page#anchor)  to site URLs;
 *   3. pins an explicit {#slug} on every heading that another page (or the same
 *      page) links to by #fragment — because this site's markdown slugifier is
 *      not GitHub-compatible, so wiki anchors would otherwise not resolve.
 */
import fs from "node:fs";
import path from "node:path";
import { pages, externalRewrites, type WikiPage } from "./cli-wiki-manifest.ts";

const REPO = path.resolve(import.meta.dirname, "..");
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
function githubSlug(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\w\- ]+/g, "") // drop punctuation (parens, colons, dots, slashes, backticks, em-dashes…)
    .replace(/ /g, "-");
}

// Plain-text of a heading line: drop the leading #'s, strip markdown emphasis/
// code markers so the slug is computed from the visible text.
function headingText(line: string): string {
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

// The wiki lives in a DIFFERENT repo, so `npm test` cannot assume it is on disk:
// a contributor without a sibling checkout has no wiki/ to compare against, and
// neither do the workflows that run the suite for an unrelated reason (api docs,
// weekly maintenance, ranker repin). Skipping there is what lets this check sit in
// `npm test` without making the suite depend on a second clone — it stays offline,
// which is the rule for everything in that chain.
//
// Skipping SILENTLY would recreate the bug this check exists to catch, so the two
// workflows that are meant to enforce it — checks.yml, which runs on every push and
// PR, and sync-cli-guide.yml, which gates the bot's own commit — set
// CLI_WIKI_REQUIRED=1, and the skip becomes a failure there.
//
// A write run always requires the wiki, whatever the env says: a sync that cannot
// find its source must fail, not report success having copied nothing.
//
// This has to stay AHEAD of pass 1, which reads every wiki file at module scope.
// It used to sit further down, next to the run loop, where it was unreachable: a
// missing dir threw a raw ENOENT stack out of pass 1 long before the friendly
// message could print. Moving it back down silently restores that.
if (!fs.existsSync(WIKI_DIR)) {
  if (CHECK && process.env.CLI_WIKI_REQUIRED !== "1") {
    console.log(`— skipped: no @imqueue/cli wiki at ${WIKI_DIR}`);
    console.log("  Clone imqueue/cli beside this repo (or set CLI_WIKI_DIR) to run this check.");
    process.exit(0);
  }

  console.error(`✗ wiki dir not found: ${WIKI_DIR}\n  pass --wiki <dir> or set CLI_WIKI_DIR.`);
  process.exit(2);
}

// --- pass 1: collect every #fragment that is linked to, per destination page ---
// A link [text](Page#frag) references (Page, frag). A same-page [text](#frag)
// references (currentPage, frag). We only need anchors that are actually linked.
const linkedAnchors = new Map<string, Set<string>>(); // pageName -> Set(frag)
function addAnchor(pageName: string, frag: string | undefined): void {
  if (!frag) return;

  const frags = linkedAnchors.get(pageName) ?? new Set<string>();

  frags.add(frag);
  linkedAnchors.set(pageName, frags);
}

const LINK_RE = /\]\(([^)\s]+)\)/g; // ](target) with no spaces in target
const raw = new Map<string, string>(); // wiki file -> source text
for (const p of pages) {
  const src = fs.readFileSync(path.join(WIKI_DIR, p.wiki), "utf8");
  raw.set(p.wiki, src);
  const thisName = p.wiki.replace(/\.md$/, "");
  let m: RegExpExecArray | null;
  LINK_RE.lastIndex = 0;
  while ((m = LINK_RE.exec(src))) {
    const target = m[1] ?? "";
    if (target.startsWith("#")) {
      addAnchor(thisName, target.slice(1));
    } else {
      const [name = "", frag] = target.split("#");
      if (pageUrlByName.has(name)) addAnchor(name, frag);
    }
  }
}

// --- rewrite a single link target from wiki-space to site-space ---
function rewriteTarget(target: string): string {
  const external = externalRewrites[target];

  if (external !== undefined) {
    return external;
  }
  if (target.startsWith("#") || target.startsWith("/") || /^[a-z]+:/i.test(target)) {
    return target; // same-page anchor, already-absolute, or external URL
  }
  const [name = "", frag] = target.split("#");
  const url = pageUrlByName.get(name);

  if (url !== undefined) {
    return url + (frag ? "#" + frag : "");
  }
  return target;
}

// --- generate one page ---
function generate(p: WikiPage, index: number): string {
  const total = pages.length;
  const n = index + 1;
  // Every page was read into `raw` by the pass above, so a miss here means the
  // manifest and that pass disagree about the page list.
  const src = raw.get(p.wiki) ?? "";
  const lines = src.replace(/\r\n/g, "\n").split("\n");

  // strip the leading "# H1" (and the blank line following it)
  let start = 0;
  while (start < lines.length && (lines[start] ?? "").trim() === "") start++;
  if (lines[start] && /^#\s+/.test(lines[start] ?? "")) {
    start++;
    while (start < lines.length && (lines[start] ?? "").trim() === "") start++;
  }
  const body = lines.slice(start);

  const wantAnchors = linkedAnchors.get(p.wiki.replace(/\.md$/, "")) ?? new Set<string>();

  const out = body.map((line) => {
    let l = line;
    // (2) rewrite links
    l = l.replace(LINK_RE, (_whole: string, target: string) => "](" + rewriteTarget(target) + ")");
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

let changed = 0;
const written: string[] = [];
for (let i = 0; i < pages.length; i++) {
  const p = pages[i];

  if (!p) continue;

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
    // Read the diff before running the sync. "Out of date" is symmetric — it fires
    // when the wiki has moved ahead of the site (sync it) AND when the site has
    // prose the wiki does not (syncing DELETES it, because this transform is a
    // whole-file overwrite with no merge). The second case has already cost this
    // repo one page: two FAQ pairs were written straight into
    // src/org/cli/clients-and-versioning.md and were a release away from being
    // silently dropped, until they were moved up to the wiki where they belong.
    console.error(`\n✗ ${changed} page(s) out of date.`);
    console.error("\n  Look at what would change before you fix it:");
    console.error("    node scripts/sync-cli-wiki.ts && git diff -- src/org/cli");
    console.error("\n  Wiki ahead of the site  -> keep that sync and commit it.");
    console.error("  Site has prose the wiki lacks -> the sync would DELETE it.");
    console.error("    Revert, move the text into imqueue/cli's wiki/, and re-run.");
    console.error("    Guide pages are generated; the wiki is the only place edits survive.");
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
