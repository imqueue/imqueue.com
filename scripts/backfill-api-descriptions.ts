#!/usr/bin/env node
// backfill-api-descriptions.ts — add `description:` front matter to the already
// generated API reference pages under src/org/api/.
//
// scripts/build-api-docs.ts now emits a per-symbol description, but rerunning it
// re-downloads every published package and regenerates ~1500 pages. The pages on
// disk are already correct apart from the missing description, so derive it in
// place with the same scripts/lib/api-summary.ts the generator uses.
//
// Idempotent: pages that already carry a description are left alone unless
// --force is passed.
//
//   node scripts/backfill-api-descriptions.ts [--dry-run] [--force]

import fs from 'node:fs';
import path from 'node:path';
import { apiDescription } from './lib/api-summary.ts';

const ROOT = path.join(import.meta.dirname, '..');
const API_DIR = path.join(ROOT, 'src', 'org', 'api');
const DRY = process.argv.includes('--dry-run');
const FORCE = process.argv.includes('--force');

// src/org/api/<pkg>/<seg>/<file>.md — <seg> is "latest" or an archived version.
function* apiPages() {
  for (const pkg of fs.readdirSync(API_DIR)) {
    const pkgDir = path.join(API_DIR, pkg);
    if (!fs.statSync(pkgDir).isDirectory()) continue;

    for (const seg of fs.readdirSync(pkgDir)) {
      const segDir = path.join(pkgDir, seg);
      if (!fs.statSync(segDir).isDirectory()) continue;

      // The version each tree documents is recorded in its data file.
      const dataFile = path.join(segDir, `${seg}.11tydata.json`);
      const version = fs.existsSync(dataFile)
        ? JSON.parse(fs.readFileSync(dataFile, 'utf8')).apiVersion
        : seg;

      for (const file of fs.readdirSync(segDir)) {
        if (file.endsWith('.md')) {
          yield { pkg, seg, version, file: path.join(segDir, file) };
        }
      }
    }
  }
}

const FRONT_MATTER = /^---\n([\s\S]*?)\n---\n/;

let added = 0;
let skipped = 0;
let noSummary = 0;
const samples = [];

for (const { pkg, version, file } of apiPages()) {
  const src = fs.readFileSync(file, 'utf8');
  const m = FRONT_MATTER.exec(src);

  if (!m) {
    console.warn(`  ?? no front matter: ${path.relative(ROOT, file)}`);
    continue;
  }

  const fm = m[1] ?? '';

  if (/^description:/m.test(fm) && !FORCE) {
    skipped++;
    continue;
  }

  // `title: "AFTER_HOOK_ERROR variable · @imqueue/rpc"` -> the symbol heading.
  const titleMatch = /^title:\s*"(.*)"\s*$/m.exec(fm);
  const symbol = titleMatch?.[1]?.split(' · ')[0] ?? path.basename(file, '.md');

  const body = src.slice(m[0].length);
  const description = apiDescription(body, { pkg, version, symbol });

  if (description.startsWith(`${symbol} — @imqueue/`)) {
    noSummary++;
  }

  // Drop any existing description first — otherwise --force appends a second
  // `description:` key and gray-matter rejects the duplicate mapping key.
  const nextFm = fm
    .replace(/^description:.*(?:\n(?=[ \t]).*)*\n?/gm, '')
    .replace(/^(title:.*)$/m, `$1\ndescription: ${JSON.stringify(description)}`);

  if (samples.length < 6) {
    samples.push(`${path.relative(ROOT, file)}\n      ${description}`);
  }

  if (!DRY) {
    fs.writeFileSync(file, `---\n${nextFm.trim()}\n---\n${body}`);
  }
  added++;
}

console.log(`${DRY ? '[dry run] ' : ''}descriptions written: ${added}`);
console.log(`  already had one (skipped): ${skipped}`);
console.log(`  no JSDoc summary in source, fell back to symbol name: ${noSummary}`);
console.log('\nSamples:');
for (const s of samples) console.log(`  - ${s}`);
