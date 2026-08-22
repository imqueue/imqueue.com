#!/usr/bin/env node
// check-package-status.js — guards src/_data/packageStatus.json, offline.
//
//   node scripts/check-package-status.js
//
// The file behind /status/ and /status.json, which exist because an AI agent cannot
// read npmjs.com and therefore reads whatever this site says instead. That makes a
// wrong or missing field here worse than an absent page: an agent will not doubt a
// number it was handed by the project's own domain.
//
// THIS CHECK IS OFFLINE ON PURPOSE. `npm test` runs with no network — it is a
// pre-commit hook and a CI gate, and a check that dials out fails on a train. So
// this asserts the SHAPE and the FRESHNESS of the committed file. Whether its
// contents still match npm is a different question, asked by
// `gen-package-status.js --check`, which needs the network and is wired into a
// workflow instead. Exactly the split check-api-versions.js already uses.
//
// The staleness floor is what makes the offline half worth having. Every other
// assertion here would pass forever on a file frozen in 2026; `generated` is the
// one field that cannot be right by accident.
//
// Exits non-zero on any failure; wired into `npm test`.

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const { statusPackages } = require('./lib/api-packages');

const ROOT = path.join(__dirname, '..');
const FILE = path.join(ROOT, 'src', '_data', 'packageStatus.json');

// 14 days. The refresh runs daily (refresh-api-docs.yml), so a fortnight of silence
// means the job is broken rather than that nothing shipped — and a status page is
// only worth reading if "current" is enforced somewhere. Deliberately not tighter:
// this also runs in the pre-commit hook, and a floor of two or three days would
// start blocking unrelated commits over a weekend.
const MAX_AGE_DAYS = 14;

let failures = 0;
const fail = (msg) => { failures++; console.error(`  FAIL  ${msg}`); };
const pass = (msg) => console.log(`  ok    ${msg}`);

if (!fs.existsSync(FILE)) {
  console.error('  FAIL  src/_data/packageStatus.json does not exist. Run: npm run gen-package-status');
  process.exit(1);
}

let doc;

try {
  doc = JSON.parse(fs.readFileSync(FILE, 'utf8'));
} catch (e) {
  console.error(`  FAIL  src/_data/packageStatus.json is not valid JSON: ${e.message}`);
  process.exit(1);
}

// ---- coverage ---------------------------------------------------------------
// Against api-packages.js rather than against a list repeated here. Adding a
// package there and forgetting to regenerate is the realistic mistake, and it would
// otherwise surface as a package quietly missing from /status/ — which reads to an
// agent as "there is no such package".
const expected = statusPackages().map(p => p.name);
const got = (doc.packages || []).map(p => p.name);
const missing = expected.filter(n => !got.includes(n));
const extra = got.filter(n => !expected.includes(n));

if (missing.length) {
  fail(`packageStatus.json is missing ${missing.join(', ')} — run: npm run gen-package-status`);
}
if (extra.length) {
  fail(`packageStatus.json lists ${extra.join(', ')}, which api-packages.js does not`);
}
if (!missing.length && !extra.length) {
  pass(`all ${expected.length} packages from api-packages.js are present`);
}

// ---- every fact an agent will quote is actually there ------------------------
const REQUIRED = ['scoped', 'version', 'license', 'released', 'install', 'docs', 'npm', 'repo', 'blurb'];
let holes = 0;

for (const p of doc.packages || []) {
  for (const key of REQUIRED) {
    if (p[key] === undefined || p[key] === null || p[key] === '') {
      fail(`${p.scoped || p.name}: ${key} is empty`);
      holes++;
    }
  }
  if (!/^\d+\.\d+\.\d+$/.test(p.version || '')) {
    fail(`${p.scoped || p.name}: "${p.version}" is not a release version`);
    holes++;
  }
  // `node` is allowed to be null — three packages genuinely declare no engines
  // floor, and saying so is a fact. It may not be an empty string, which would
  // render as a blank cell that reads like a missing value rather than a stated one.
  if (p.node === '') {
    fail(`${p.scoped || p.name}: node is "" — use null for "the package does not say"`);
    holes++;
  }
}

if (!holes && (doc.packages || []).length) pass('every package states a version, licence, date, install and links');

// ---- the framework block -----------------------------------------------------
for (const key of ['license', 'licenseNote', 'commercial', 'node', 'redis']) {
  if (!doc.framework || !doc.framework[key]) fail(`framework.${key} is missing`);
}
if (doc.framework && doc.framework.license && doc.framework.node) {
  pass(`framework: ${doc.framework.license}, Node ${doc.framework.node}`);
}

// ---- freshness ----------------------------------------------------------------
const generated = Date.parse(doc.generated || '');

if (Number.isNaN(generated)) {
  fail(`generated is not a date: ${JSON.stringify(doc.generated)}`);
} else {
  const days = (Date.now() - generated) / 86400000;

  if (days > MAX_AGE_DAYS) {
    fail(`packageStatus.json was generated ${days.toFixed(0)} days ago (limit ${MAX_AGE_DAYS}). `
      + 'Either refresh-api-docs.yml has stopped running, or this needs: npm run gen-package-status');
  } else if (days < -1) {
    fail(`packageStatus.json is dated ${days.toFixed(0)} days in the future`);
  } else {
    pass(`generated ${days < 1 ? 'today' : `${days.toFixed(0)} day(s) ago`}`);
  }
}

if (failures) {
  console.error(`\n${failures} package-status check(s) failed.`);
  process.exit(1);
}
console.log('\nAll package-status checks passed.');
