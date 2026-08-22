#!/usr/bin/env node
// gen-package-status.js — what every published @imqueue package IS, right now, in a
// form something other than a browser can read.
//
//   node scripts/gen-package-status.js            write src/_data/packageStatus.json
//   node scripts/gen-package-status.js --check    exit 1 if the committed file is stale
//
// WHY THIS EXISTS. An AI agent evaluating @imqueue could not establish the current
// version, licence or Node floor of a single package. www.npmjs.com serves bot
// detection to an unattended fetch — scripts/external-allowlist.txt has recorded
// that about our own link checker for months — so the agent fell back to search
// snippets, which are cached from the 1.x era and say ISC and Node 8. It then wrote
// that down as fact. Every page on this site was reachable to it; none of them
// carried a version, a licence or an engines floor for anything but core and rpc.
//
// The registry itself is NOT blocked — registry.npmjs.org and api.npmjs.org answer
// a scripted request fine. Only the website refuses. So the facts were always one
// call away from a build step, and this is that build step: the site reads npm at
// build time and republishes the answer at a URL an agent can actually fetch.
//
// READS NPM, NEVER THE SIBLING CHECKOUTS. /home/.../imqueue/core/package.json said
// 3.3.2 while npm served 3.4.0. A local clone is whatever was last pulled, and a
// page claiming to state what is published must not be sourced from what is
// checked out. See scripts/lib/npm-releases.js.
//
// FAILS LOUDLY. If npm is unreachable this throws rather than writing a file with
// nulls in it. A status page that says "licence: unknown" is worse than no status
// page: the agent reads the absence as an answer.

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const { statusPackages } = require('./lib/api-packages');
const { releaseVersions, majorOf, packageManifest, releaseTimes } = require('./lib/npm-releases');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'src', '_data', 'packageStatus.json');
const PAGE = path.join(ROOT, 'src', 'org', 'status', 'index.md');
const CHECK = process.argv.includes('--check');

// --- framework-wide facts ----------------------------------------------------

// Sourced from src/_data/atAGlance.js — the same rows /intro/ renders and llms.txt
// carries — rather than restated here. Three copies of "Node 22.12 or newer" is how
// a site ends up contradicting itself, and that file already exists to stop it.
//
// Looked up BY LABEL, with a hard failure when a label is missing, because the
// alternative is a framework block that silently loses a row when someone rewords
// one.
function frameworkFacts() {
  const rows = require('../src/_data/atAGlance')();
  const pick = (label) => {
    const row = rows.find(r => r.label === label);

    if (!row) {
      throw new Error(
        `gen-package-status: src/_data/atAGlance.js has no "${label}" row any more. ` +
        'The status feed quotes it; update the label here in the same change.',
      );
    }

    return row.value;
  };

  return {
    license: 'GPL-3.0-only',
    licenseNote: pick('Licence'),
    commercial: 'https://imqueue.com/license/',
    node: pick('Node.js'),
    redis: pick('Redis'),
  };
}

// --- per package -------------------------------------------------------------

function factsFor(pkg) {
  const versions = releaseVersions(pkg.name);

  if (!versions.length) {
    throw new Error(`gen-package-status: @imqueue/${pkg.name} has no published release`);
  }

  const version = versions[versions.length - 1];
  const manifest = packageManifest(pkg.name, version);
  const times = releaseTimes(pkg.name);
  const day = (v) => (times[v] ? times[v].slice(0, 10) : null);

  if (!manifest.license) {
    throw new Error(`gen-package-status: @imqueue/${pkg.name}@${version} declares no license`);
  }

  return {
    name: pkg.name,
    scoped: `@imqueue/${pkg.name}`,
    version,
    license: manifest.license,
    // Absent on a few packages. Reported as null rather than filled in from the
    // framework floor: "this package does not say" and "this package says 22.12"
    // are different facts, and inventing the second is the kind of confident wrong
    // answer this whole file is a reaction to.
    node: (manifest.engines && manifest.engines.node) || null,
    released: day(version),
    firstRelease: day(versions[0]),
    releases: versions.length,
    majors: [...new Set(versions.map(majorOf))].sort((a, b) => a - b),
    deprecated: Boolean(manifest.deprecated),
    install: `npm i @imqueue/${pkg.name}`,
    docs: pkg.docs,
    documented: pkg.documented,
    npm: `https://www.npmjs.com/package/@imqueue/${pkg.name}`,
    // Derived, not read from the manifest. @imqueue/pg-cache's own repository.url
    // points at imqueue/pg-pubsub — a copy-paste error in that package.json, noted
    // in src/_data/apiPackages.js. Every package lives at github.com/imqueue/<name>.
    repo: `https://github.com/imqueue/${pkg.name}`,
    blurb: pkg.blurb,
  };
}

// --- the page ----------------------------------------------------------------

// /status/ is a .md page whose tables are written from here, rather than a template
// that interpolates the data at render time.
//
// It has to be. The markdown mirrors — /status/index.md and /status.md, which are
// what an agent actually fetches — are built from `doc.rawInput` in
// src/_shared/_includes/mirror-body.md, i.e. the file BEFORE any template engine
// touches it. A Liquid loop in the body renders correctly into the HTML page and
// then ships verbatim, `{%- for pkg in … %}` and all, to every machine reader. The
// same is true of llms-full.txt.
//
// The markers are HTML comments because agentMarkdown strips those, so they never
// reach the mirror or llms-full.txt — check-llms.js fails the build on a surviving
// comment, and that assertion stays honest.

const BLOCK = (name) => ({
  begin: `<!-- status:begin ${name} -->`,
  end: `<!-- status:end ${name} -->`,
});

function replaceBlock(source, name, body) {
  const { begin, end } = BLOCK(name);
  const from = source.indexOf(begin);
  const to = source.indexOf(end);

  if (from === -1 || to === -1 || to < from) {
    throw new Error(
      `gen-package-status: src/org/status/index.md has no "${name}" block. ` +
      `Restore the ${begin} / ${end} markers, or the page silently stops being regenerated.`,
    );
  }

  return `${source.slice(0, from + begin.length)}\n${body}\n${source.slice(to)}`;
}

// A table cell must never break the row it is in. None of these values contains a
// pipe today — versions, SPDX ids and semver ranges cannot — but a blurb is prose
// somebody edits, and one pipe in it would silently shift every column after it.
const cell = (v) => String(v).replace(/\|/g, '\\|');

function renderPage(doc) {
  const f = doc.framework;
  const framework = [
    '| | |',
    '|---|---|',
    `| Licence | ${cell(f.licenseNote)} |`,
    `| Node.js | ${cell(f.node)} |`,
    `| Redis | ${cell(f.redis)} |`,
    `| Commercial licence | [imqueue.com/license/](${f.commercial}) |`,
  ].join('\n');

  const rows = doc.packages.map(p => `| [${cell(p.scoped)}](${p.docs}) | ${cell(p.version)} | `
    + `${cell(p.license)} | ${p.node ? `\`${cell(p.node)}\`` : 'not declared'} | ${cell(p.released)} |`);
  const deprecated = doc.packages
    .filter(p => p.deprecated)
    .map(p => `\n**\`${cell(p.scoped)}\` is deprecated on npm.** See [its documentation](${p.docs}) `
      + 'for what replaces it.');
  const packages = [
    '| Package | Version | Licence | Node | Last release |',
    '|---|---|---|---|---|',
    ...rows,
    ...deprecated,
  ].join('\n');

  const blurbs = doc.packages
    .map(p => `- [\`${cell(p.scoped)}\`](${p.docs}) — ${cell(p.blurb)}`)
    .join('\n');

  let page = fs.readFileSync(PAGE, 'utf8');

  page = replaceBlock(page, 'framework', framework);
  page = replaceBlock(page, 'packages', packages);
  page = replaceBlock(page, 'blurbs', blurbs);

  return page;
}

// --- main --------------------------------------------------------------------

const packages = statusPackages().map(factsFor);
const built = { generated: new Date().toISOString(), framework: frameworkFacts(), packages };

// `generated` moves on every run by definition, so comparing it would make --check
// report drift on a file that is perfectly current. Everything else is the claim.
const claim = (doc) => JSON.stringify({ framework: doc.framework, packages: doc.packages });

if (CHECK) {
  if (!fs.existsSync(OUT)) {
    console.error('✗ src/_data/packageStatus.json is missing. Run: npm run gen-package-status');
    process.exit(1);
  }

  const committed = JSON.parse(fs.readFileSync(OUT, 'utf8'));

  // The page is generated from the same data, so it can be stale on its own — a
  // hand-edit, or a `gen` run whose page write was reverted. Checked before the
  // data, because a stale page is the one a reader actually sees.
  if (fs.readFileSync(PAGE, 'utf8') !== renderPage(built)) {
    console.error('✗ src/org/status/index.md does not match npm. Run: npm run gen-package-status');
    process.exit(1);
  }

  if (claim(committed) !== claim(built)) {
    const before = new Map(committed.packages.map(p => [p.name, p]));

    console.error('✗ src/_data/packageStatus.json is out of date. npm now says:\n');

    for (const p of built.packages) {
      const was = before.get(p.name);

      if (!was) { console.error(`  + ${p.scoped} ${p.version} (new)`); continue; }
      for (const key of ['version', 'license', 'node', 'released', 'deprecated']) {
        if (JSON.stringify(was[key]) !== JSON.stringify(p[key])) {
          console.error(`    ${p.scoped} ${key}: ${JSON.stringify(was[key])} -> ${JSON.stringify(p[key])}`);
        }
      }
    }
    for (const p of committed.packages) {
      if (!built.packages.some(q => q.name === p.name)) console.error(`  - ${p.scoped} (no longer listed)`);
    }

    console.error('\n  Run: npm run gen-package-status');
    process.exit(1);
  }

  console.log(`✓ packageStatus.json and /status/ match npm for all ${built.packages.length} packages`);
  process.exit(0);
}

fs.writeFileSync(OUT, `${JSON.stringify(built, null, 2)}\n`);
fs.writeFileSync(PAGE, renderPage(built));

console.log(`packageStatus.json — ${built.packages.length} packages`);
for (const p of built.packages) {
  console.log(`  ${p.scoped.padEnd(34)} ${p.version.padEnd(8)} ${p.license.padEnd(14)} node ${p.node || '(unset)'}`);
}
