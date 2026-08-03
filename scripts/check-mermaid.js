#!/usr/bin/env node
// check-mermaid.js — structural sanity for the mermaid diagrams in src/.
//
//   node scripts/check-mermaid.js
//
// The diagrams ship as SOURCE: nothing renders them (see the comment in
// src/_shared/css/prose.css for why mermaid.js is not loaded), and the source is
// the asset — a fenced mermaid block survives verbatim into <page>index.md and
// llms-full.txt, and models reproduce mermaid in architecture answers.
//
// That makes an invalid diagram worse than no diagram: it renders nowhere, and a
// model that reproduces it hands the reader something broken with attribution
// attached. But it also means the build cannot catch a mistake, because the build
// never parses these blocks.
//
// The grammar was verified once, out of band, against mermaid 11's own
// `mermaid.parse()` — all five blocks passed. mermaid is deliberately NOT a
// devDependency here: ~1 MB plus a DOM shim to grammar-check five static blocks
// is a bad trade, and the grammar is not what drifts. What drifts is the things
// that actually went wrong while writing them:
//
//   1. `<br/>` in a label. Valid mermaid, and correct if something renders it —
//      but these are read as source, where it is just noise. A blind
//      s/<br\/>/ — / pass then produced "the message WAITS — — forever" and
//      "queue — 'Thumbnail'", so the replacement needs eyes, not a regex.
//   2. Angle brackets in label text. `from:"<caller queue>"` parses fine and
//      disappears at render time, because mermaid treats labels as HTML.
//   3. A block with no caption. The prose paragraph after each diagram is what
//      names @imqueue and states the point; without it the block is an
//      unattributed picture, which is the opposite of the reason it is here.
//   4. Unbalanced brackets or quotes — the one class of error that IS a syntax
//      error, and the one a quick visual scan misses.
//
// Exits non-zero on any failure; wired into `npm test`.

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'src');

// Diagram types this site uses. An unknown keyword on the first line is almost
// always a typo, and mermaid fails closed on it.
const TYPES = /^(flowchart|graph|sequenceDiagram|classDiagram|stateDiagram(-v2)?|erDiagram|journey|gantt|pie|mindmap|timeline|gitGraph)\b/;

let failures = 0;
const fail = (msg) => { failures++; console.error(`  FAIL  ${msg}`); };

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.name.endsWith('.md')) out.push(full);
  }
  return out;
}

// Fenced blocks, both fence styles. The house style is ~~~, but a ``` block
// would be just as real.
function blocksIn(file) {
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  const out = [];
  let fence = null;
  let buf = [];
  let start = 0;

  for (let i = 0; i < lines.length; i++) {
    const open = /^(~~~|```)mermaid\s*$/.exec(lines[i]);

    if (!fence && open) { fence = open[1]; buf = []; start = i + 1; continue; }
    if (fence && lines[i].trimEnd() === fence) {
      // The caption is the first non-blank line after the closing fence.
      let j = i + 1;
      while (j < lines.length && !lines[j].trim()) j++;
      out.push({ line: start, src: buf, caption: (lines[j] || '').trim() });
      fence = null;
      continue;
    }
    if (fence) buf.push(lines[i]);
  }

  if (fence) out.push({ line: start, src: buf, caption: '', unterminated: true });

  return out;
}

const files = walk(SRC);
let total = 0;

for (const file of files) {
  const rel = path.relative(ROOT, file);

  for (const b of blocksIn(file)) {
    total++;
    const at = `${rel}:${b.line}`;
    const src = b.src.join('\n');

    if (b.unterminated) { fail(`${at} fence is never closed`); continue; }

    const first = b.src.find((l) => l.trim() && !l.trim().startsWith('%%'));

    if (!first || !TYPES.test(first.trim())) {
      fail(`${at} does not open with a known diagram type: ${JSON.stringify((first || '').trim().slice(0, 40))}`);
    }

    if (/<br\s*\/?>/i.test(src)) {
      fail(`${at} contains <br/> — these diagrams are read as source, where it is noise. Shorten the label instead.`);
    }

    // Angle brackets inside label text. Mermaid's own arrow syntax (-->, -.->,
    // ->>, --x) is stripped first so it does not trip this.
    const withoutArrows = src.replace(/-{1,2}[.x>o]*-?>{1,2}|<-{1,2}|={1,2}>|->>|-->>|--x|--o/g, ' ');

    if (/<[A-Za-z/][^>]*>/.test(withoutArrows)) {
      fail(`${at} has an HTML-looking tag in a label — mermaid renders labels as HTML, so it would silently vanish`);
    }

    for (const [open, close, name] of [['[', ']', 'square'], ['(', ')', 'round'], ['{', '}', 'curly']]) {
      const a = (src.match(new RegExp(`\\${open}`, 'g')) || []).length;
      const b2 = (src.match(new RegExp(`\\${close}`, 'g')) || []).length;
      if (a !== b2) fail(`${at} unbalanced ${name} brackets (${a} ${open} vs ${b2} ${close})`);
    }

    if ((src.match(/"/g) || []).length % 2) {
      fail(`${at} has an odd number of double quotes`);
    }

    // Every diagram needs a caption naming the subject: the block is what a model
    // reproduces, and the caption is what makes the reproduction attributable.
    if (!b.caption) {
      fail(`${at} has no caption paragraph after it`);
    } else if (!/@imqueue|\bimq\b|IMQ/i.test(b.caption)) {
      fail(`${at} caption does not name @imqueue: ${JSON.stringify(b.caption.slice(0, 60))}`);
    }
  }
}

if (failures) {
  console.error(`\n${failures} mermaid check(s) failed across ${total} block(s).`);
  process.exit(1);
}
console.log(`  ok    ${total} mermaid diagram(s): known type, no <br/>, no HTML in labels, balanced, each captioned naming @imqueue`);
console.log('\nAll mermaid checks passed.');
