// The "@imqueue at a glance" fact block — one row list, three renderings.
//
// Node and Redis requirements lived only in running prose on four pages. They all
// AGREED (diffed — the "five contradictory comparison tables" premise was false), so
// this is a convenience fix rather than a correctness one: the facts someone asks for
// first were spread across four pages of prose and absent from the two files this
// site asks agents to ingest.
//
// A data file rather than three hand-written tables. It is rendered by
// _includes/at-a-glance.html (the /intro/ page), _includes/at-a-glance.md (the
// /intro/ markdown mirror, which is a shared include, and so llms-full.txt too) and
// src/llms.liquid's info block. The mirror README warns that /intro/'s HTML and its
// hand-written mirror are kept in step BY HAND; this is the part that no longer can
// drift, because there is one list.
//
// Versions come from src/_data/apiVersions.json, which `npm run build-docs`
// regenerates, so a release moves this table without anyone editing it.
//
// Values are PLAIN TEXT — no markdown, no backticks. The HTML rendering has no
// markdown filter available (this is not Jekyll; `markdownify` does not exist here),
// and a value that has to be interpreted differently by two renderings is exactly the
// kind of shared string that drifts. Anything needing emphasis belongs in the prose
// around the table.
//
// @imqueue/cli has no row: it is not in apiVersions.json (its docs come from the cli
// repo's wiki, not from api-documenter), and hard-coding a version here would be a
// number nothing updates. `npm i -g @imqueue/cli` always installs the current one,
// which is what the install line says.

'use strict';

const versions = require('./apiVersions.json');

const latest = (pkg) => (versions[pkg] && versions[pkg].latest) || null;

module.exports = () => {
  const rows = [];
  const add = (label, value) => { if (value) rows.push({ label, value }); };

  add('@imqueue/core', latest('core'));
  add('@imqueue/rpc', latest('rpc'));
  add('Licence', 'GPL-3.0-only, or a commercial licence for closed-source distribution');
  add('Node.js', '22.12 or newer');
  add('Redis', '3.2 or newer (6.2+ for safe delivery)');
  add('Transport', 'Redis only — the vendor option defaults to Redis and is its only supported value');
  add('Addressing', 'the queue name, which is the service class name — no discovery');
  add('Load balancing', 'competing consumers — no balancer, no weighting, no canaries');
  add('Delivery', 'at-least-once in both modes, so exposed methods should be idempotent');
  add('Streaming', 'none — request/response only');
  add('Languages', 'Node.js and TypeScript only');
  add('Contract source', 'the service class plus its JSDoc; clients are generated from a running service');

  return rows;
};
