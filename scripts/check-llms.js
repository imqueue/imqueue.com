#!/usr/bin/env node
// check-llms.js — guards /llms.txt and /llms-full.txt against the ways they have
// silently broken, on both editions.
//
//   node scripts/check-llms.js
//
// These two files are the entry point this site asks AI agents to use, and the
// @imqueue MCP server builds its search index from llms.txt at runtime — so a
// defect here is not cosmetic, it is a page missing from the project's own docs
// search. Every assertion below corresponds to something that was actually wrong
// on 2026-08-03:
//
//   * FOUR pages absent from llms.txt entirely, including the home page and
//     /using-ai-assistants/ (the page holding the anti-hallucination rules),
//     because the Getting Started list was a hardcoded two-URL condition.
//   * PROSE inside `## Reference` (8 lines) and `## Articles` (2). The convention
//     puts prose in the block before the first H2 and nothing but a link list
//     inside a section; a consumer that splits on H2 gets malformed items.
//   * `### Reference — <group>` subsections. Our own MCP server matches `^##\s+`,
//     which never matched `###`, so every capability package it indexed was filed
//     under the framework-spine section.
//   * Liquid whitespace control gluing a heading onto the previous list item
//     (`…form that reaches the maintainers.## Optional`) — twice, in one sitting.
//   * llms-full.txt shipping raw source: HTML tables, inline SVG, `{#id}` attrs,
//     authoring comments and root-relative links, in a file meant to be ingested
//     standalone.
//   * A com llms-full.txt that called itself "full documentation" and concatenated
//     nothing (458 bytes).
//
// Exits non-zero on any failure; wired into `npm test`.

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const EDITIONS = { org: 'https://imqueue.org', com: 'https://imqueue.com' };

let failures = 0;
const fail = (msg) => { failures++; console.error(`  FAIL  ${msg}`); };
const pass = (msg) => console.log(`  ok    ${msg}`);

// A list item in llms.txt: `- [Title](url): description` with an optional
// ` — [markdown](url)` suffix. Kept identical in shape to the regex the MCP
// server's docs.ts uses, because that is the consumer that matters.
const ITEM = /^-\s+\[([^\]]+)\]\(([^)]+)\)(?::\s*(.*))?$/;

// A URL this tree cannot check a file for. Anything off-site, plus the OTHER
// edition — imqueue.com's llms.txt links imqueue.org on purpose, and that tree is
// built separately. check-links.js crawls both and owns those.
const EXTERNAL_OK = (url, origin) =>
  /^https?:\/\//.test(url) && !url.startsWith(origin);

function parse(text) {
  const sections = [];
  let current = null;
  const intro = [];

  for (const line of text.split('\n')) {
    const heading = /^##\s+(.+?)\s*$/.exec(line);

    if (heading && !line.startsWith('###')) {
      current = { name: heading[1], items: [], prose: [], lines: [] };
      sections.push(current);
      continue;
    }
    if (!current) {
      intro.push(line);
      continue;
    }

    current.lines.push(line);

    const item = ITEM.exec(line);

    if (item) {
      current.items.push({ title: item[1], url: item[2], description: item[3] || '' });
    } else if (line.trim() !== '') {
      current.prose.push(line);
    }
  }

  return { intro: intro.join('\n'), sections };
}

// Site-absolute path -> is there a built file for it?
function resolves(dir, url, origin) {
  if (EXTERNAL_OK(url, origin)) return true;   // off-site or other edition
  if (!/^https?:\/\//.test(url)) return null; // not a URL at all

  const rel = url.slice(origin.length) || '/';
  const clean = rel.split('#')[0].split('?')[0];
  const target = clean.endsWith('/')
    ? path.join(dir, clean, 'index.html')
    : path.join(dir, clean);

  return fs.existsSync(target);
}

for (const [edition, origin] of Object.entries(EDITIONS)) {
  const dir = path.join(ROOT, `_site-${edition}`);
  const indexFile = path.join(dir, 'llms.txt');
  const fullFile = path.join(dir, 'llms-full.txt');

  console.log(`\n${edition}:`);

  if (!fs.existsSync(indexFile) || !fs.existsSync(fullFile)) {
    fail(`_site-${edition} is missing llms.txt or llms-full.txt — build this edition first`);
    continue;
  }

  const text = fs.readFileSync(indexFile, 'utf8');
  const full = fs.readFileSync(fullFile, 'utf8');
  const { intro, sections } = parse(text);

  // ---- shape --------------------------------------------------------------
  if (!/^#\s+\S/.test(text)) fail('llms.txt does not start with an H1');
  if (!/\n>\s+\S/.test(text)) fail('llms.txt has no `> ` summary blockquote after the H1');
  if (!text.endsWith('\n')) fail('llms.txt does not end with a newline');
  if (!full.endsWith('\n')) fail('llms-full.txt does not end with a newline');
  if (!sections.length) fail('llms.txt has no `## ` sections at all');

  // The bug that shipped twice: `-%}` on a closing Liquid comment eats the newline
  // before the next line, gluing a heading or a field onto the previous one. It is
  // invisible in a diff of the template and obvious only in the output.
  for (const m of text.matchAll(/^(.*\S)(##\s+\S.*)$/gm)) {
    fail(`a heading is glued onto the end of another line: …${m[1].slice(-40)}[${m[2].slice(0, 30)}]`);
  }

  // ---- no prose inside a section ------------------------------------------
  // The one exception is a `{%- comment -%}` that failed to render, which would
  // show up as prose anyway — so there is no exception.
  const chatty = sections.filter((s) => s.prose.length);

  if (chatty.length) {
    for (const s of chatty) {
      fail(`## ${s.name} contains ${s.prose.length} non-list line(s): "${s.prose[0].trim().slice(0, 60)}…"`);
    }
    console.error('        Prose belongs in the block before the first H2. A consumer that');
    console.error('        splits on H2 and parses each section as a link list mis-reads it.');
  } else {
    pass(`all ${sections.length} sections contain link items only`);
  }

  // ---- no H3 sections -----------------------------------------------------
  // Our own MCP server's section matcher is `^##\s+`, so an H3 is content
  // attributed to whichever H2 preceded it.
  const h3 = [...text.matchAll(/^###\s+(.+)$/gm)].map((m) => m[1]);

  if (h3.length) {
    for (const h of h3.slice(0, 5)) fail(`H3 section "${h}" — llms.txt is flat, promote it to ##`);
  } else {
    pass('no H3 sections (an H2-splitting consumer cannot mis-bucket them)');
  }

  // ---- every item is well formed -----------------------------------------
  const all = sections.flatMap((s) => s.items.map((i) => ({ ...i, section: s.name })));
  let unresolved = 0;
  let foreign = 0;
  let undescribed = 0;

  for (const item of all) {
    if (!item.description.trim()) {
      undescribed++;
      fail(`${item.url} has no ": description" — the index is what an agent ranks on`);
    }

    const ok = resolves(dir, item.url, origin);

    if (ok === null) {
      foreign++;
      fail(`${item.url} is not an absolute URL — llms.txt is read standalone, so every link must be`);
    } else if (ok === false) {
      unresolved++;
      fail(`${item.url} is listed in llms.txt but no file was built for it`);
    }
  }
  if (!unresolved && !foreign && !undescribed) {
    pass(`${all.length} items: all described, all resolve to a built file`);
  }

  // ---- no URL under two H2s ----------------------------------------------
  const seen = new Map();
  let dupes = 0;

  for (const item of all) {
    const key = item.url.split('#')[0];

    if (seen.has(key) && seen.get(key) !== item.section) {
      dupes++;
      fail(`${key} appears under both "## ${seen.get(key)}" and "## ${item.section}"`);
    }
    seen.set(key, item.section);
  }
  if (!dupes) pass(`${seen.size} unique URLs, none listed under two sections`);

  // ---- COVERAGE: every indexable page is in llms.txt ----------------------
  // The failure that started this file. A page enters llms.txt only if a template
  // loop happens to match it, and four did not — so this asserts the other
  // direction, against the sitemap, which is the list of pages we tell search
  // engines exist.
  //
  // API member pages are excluded exactly as check-sitemap.js excludes them: the
  // symbol index at /api/search-index.json is how those are found, and listing 730
  // of them here would bury the 100 pages that matter.
  const sitemapFiles = fs.readdirSync(dir).filter((f) => /^sitemap.*\.xml$/.test(f));
  const submitted = new Set();

  for (const f of sitemapFiles) {
    const xml = fs.readFileSync(path.join(dir, f), 'utf8');

    if (xml.includes('<sitemapindex')) continue;
    for (const m of xml.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/g)) {
      submitted.add(m[1].slice(origin.length));
    }
  }

  const listed = new Set([...seen.keys()]
    .filter((u) => u.startsWith(origin))
    .map((u) => u.slice(origin.length) || '/'));
  // llms.txt lists PACKAGE INDEXES (/api/<pkg>/latest/) and nothing below them, by
  // design: /api/search-index.json is how a symbol is found by name, and listing
  // the ~400 per-symbol pages here would bury the ~100 that carry prose. So the
  // coverage assertion covers hand-authored pages and package indexes only.
  const isGeneratedSymbolPage = (url) =>
    /^\/api\/[^/]+\/[^/]+\/.+/.test(url);
  const missing = [...submitted]
    .filter((u) => !listed.has(u) && !isGeneratedSymbolPage(u) && !/\/page\/\d+\/$/.test(u))
    .sort();

  if (missing.length) {
    for (const u of missing.slice(0, 12)) {
      fail(`${u} is in the sitemap but absent from llms.txt — invisible to the MCP server's search_docs`);
    }
    if (missing.length > 12) {
      console.error(`  FAIL  …and ${missing.length - 12} more submitted pages absent from llms.txt`);
    }
  } else {
    pass(`every submitted page is indexed in llms.txt (${listed.size} entries)`);
  }

  // ---- llms-full.txt is actually full ------------------------------------
  // It was a 458-byte stub on .com. A floor rather than an exact size, because the
  // number changes with every page added — but two orders of magnitude below the
  // corpus is a stub, not a document.
  const MIN_FULL = 4000;

  if (full.length < MIN_FULL) {
    fail(`llms-full.txt is only ${full.length} bytes — it concatenates nothing`);
  } else {
    pass(`llms-full.txt is ${(full.length / 1024).toFixed(0)} KB`);
  }

  // ---- llms-full.txt has a table of contents that matches its contents ----
  // 499 KB / ~125k tokens with no index of its 62 documents, and the first document
  // was "Benchmarking @imqueue: throughput and delivery modes" — a hardware benchmark
  // — because the loop iterated collections.all unsorted. Documentation proper began
  // ~45% in and the tutorial sat at 75%. A retrieval system that truncates keeps the
  // BEGINNING, so accident decided what survived truncation.
  //
  // Asserted as an equality between the TOC and the documents rather than as "a TOC
  // exists": a stale index is worse than none, and the two are generated from one
  // ordered collection precisely so they cannot diverge. This is what caught the
  // duplicate `# title` / `Source:` headers on the three front-loaded includes (72
  // Source lines against 69 documents) and a `{%- comment` that glued the heading
  // onto the paragraph above it.
  if (edition === 'org') {
    const lines = full.split('\n');
    const start = lines.indexOf('## Contents');

    if (start < 0) {
      fail('llms-full.txt has no "## Contents" index');
    } else {
      const toc = [];
      const entry = /^(\d+)\. (.*) — (https:\/\/\S+)$/;

      for (let i = start + 1; i < lines.length; i++) {
        const m = entry.exec(lines[i]);

        if (m) { toc.push({ title: m[2], url: m[3] }); continue; }
        if (lines[i].trim() === '') continue;
        break;
      }

      // A document is a `Source:` line preceded by the nearest `# ` heading.
      const docs = [];

      for (let i = 0; i < lines.length; i++) {
        if (!/^Source: https:\/\//.test(lines[i])) continue;

        let j = i - 1;

        while (j >= 0 && !/^# /.test(lines[j])) j--;
        docs.push({ title: lines[j].slice(2), url: lines[i].slice('Source:'.length).trim() });
      }

      const mismatches = [];

      for (let i = 0; i < Math.max(toc.length, docs.length); i++) {
        const t = toc[i];
        const d = docs[i];

        if (!t || !d || t.title !== d.title || t.url !== d.url) {
          mismatches.push(`#${i + 1}: toc ${JSON.stringify(t)} vs doc ${JSON.stringify(d)}`);
        }
      }

      if (mismatches.length) {
        for (const m of mismatches.slice(0, 5)) fail(`llms-full.txt TOC/document mismatch ${m}`);
        if (mismatches.length > 5) console.error(`  FAIL  …and ${mismatches.length - 5} more`);
      } else {
        pass(`llms-full.txt: ${toc.length} documents, and the "## Contents" index matches them exactly, in order`);
      }

      // The corpus must open on orientation, not on whatever sorted first.
      if (docs.length && docs[0].url !== `${origin}/`) {
        fail(`llms-full.txt opens on ${docs[0].url} — the home page has to come first, since truncation keeps the beginning`);
      } else if (docs.length) {
        pass('llms-full.txt opens on the home page');
      }
    }
  }

  // ---- neither file leaks markup or template source ----------------------
  // agentMarkdown strips all of these; anything appearing here means a surface
  // bypassed it, which is exactly how /api/index.md came to ship
  // `"softwareVersion": "{{ latest_rpc }}"` as the API reference.
  const LEAKS = [
    [/\{\{|\{%/, 'unrendered Liquid'],
    [/<script\b/i, 'a <script> element'],
    [/<svg\b/i, 'an inline SVG'],
    [/<table\b/i, 'an HTML table'],
    [/<!--/, 'an HTML comment'],
    [/\{#[A-Za-z0-9_-]+\}/, 'markdown-it-attrs `{#id}` syntax'],
  ];

  for (const [file, body] of [['llms.txt', text], ['llms-full.txt', full]]) {
    let clean = true;

    for (const [re, what] of LEAKS) {
      // Liquid braces occur legitimately inside code samples as JSDoc type
      // literals — `@param {{ items: string[] }}` — so that one check is scoped to
      // lines that are not indented as code.
      const target = re.source.includes('\\{%')
        ? body.split('\n').filter((l) => !/^\s{4,}|^\t|^\s*[*>]/.test(l)).join('\n')
        : body;

      if (re.test(target)) {
        clean = false;
        fail(`${file} contains ${what} — a surface is bypassing agentMarkdown`);
      }
    }
    if (clean) pass(`${file} is clean markdown (no markup, no template source)`);
  }

  // ---- root-relative links resolve against nothing ----------------------
  // Both files are fetched standalone, so `](/api/…)` has no base to resolve
  // against. 1,224 of these existed in the mirrors before agentMarkdown
  // absolutised them.
  const rel = [...full.matchAll(/\]\((\/[^)\s]*)\)/g)].map((m) => m[1]);

  if (rel.length) {
    fail(`llms-full.txt has ${rel.length} root-relative link(s), e.g. ${rel[0]} — they resolve against nothing when the file is read on its own`);
  } else {
    pass('llms-full.txt links are absolute');
  }

  // ---- the canonical definition is present ------------------------------
  // Theme 2's whole mechanism: the same definitional string on every surface. If
  // it is missing here, this file is asserting an eighth variant.
  const site = require('js-yaml').load(fs.readFileSync(path.join(ROOT, 'src/_data/site.yml'), 'utf8'));
  const definition = String(site.definition).replace(/\s+/g, ' ').trim();

  for (const [file, body] of [['llms.txt', text], ['llms-full.txt', full]]) {
    if (!body.replace(/\s+/g, ' ').includes(definition)) {
      fail(`${file} does not contain the canonical definition from site.yml verbatim`);
    } else {
      pass(`${file} carries the canonical definition verbatim`);
    }
  }

  // ---- the contact address survives -------------------------------------
  // Cloudflare Email Obfuscation removes it from 100% of the HTML on both zones.
  // These files are text/plain, which obfuscation does not touch, so they are the
  // fallback — and a fallback that silently disappears is worse than none.
  if (!text.includes('support@imqueue.com')) {
    fail('llms.txt does not contain support@imqueue.com — Email Obfuscation strips it from every HTML page, so this is the only machine-readable copy');
  } else {
    pass('llms.txt carries the literal contact address');
  }

  console.log(`        ${sections.length} sections, ${all.length} items, ${(full.length / 1024).toFixed(0)} KB full text`);
}

if (failures) {
  console.error(`\n${failures} llms.txt check(s) failed.`);
  process.exit(1);
}
console.log('\nAll llms.txt checks passed.');
