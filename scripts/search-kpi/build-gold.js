#!/usr/bin/env node
// build-gold.js — assemble data/gold.json and data/quarantine.json from the judged/ decisions.
//
// This replaces judge-gold.js's regex rules as the source of the natural labels. The decisions live
// in judged/*.js as explicit per-query membership lists with a content-grounded rationale each; this
// script only assembles them, stamps the fingerprint, and writes one record per line.
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const SP = __dirname;
const ROOT = path.join(__dirname, '..', '..');
const KPI = __dirname;
const DATA = path.join(KPI, 'data');

const { fingerprint, writeCollection, bySortKey } = require(path.join(KPI, 'lib', 'labels.js'));

const natural = require(path.join(DATA, 'natural-queries.json'));
const { QUESTION } = require(path.join(SP, 'judged', 'question.js'));
const { INTENT } = require(path.join(SP, 'judged', 'intent.js'));
const { PEER } = require(path.join(SP, 'judged', 'peer.js'));

const MODULES = ['mcp.js', 'mcp-spelled.js', 'noise-molecule.js', 'jobqueue.js',
  'comparisons.js', 'delivery-monolith-testing.js', 'infra.js', 'core.js'];

// A quarantined query is one no page here answers, and there are two very different ways for that to
// be true. Keeping them in one bucket makes both numbers useless:
//
//   NEGATIVE     the query is not about anything this site could cover — another vendor's own API,
//                another language's ecosystem, or keyword-tool wreckage where a name collided
//                ("boss pg" as hostel listings, TRPC the ion channel). This is the population the
//                RESTRAINT measure needs: what does the ranker do when there is genuinely nothing,
//                and how confident does it look about it.
//   CONTENT GAP  the query IS this site's subject and no page answers it. That is a content backlog,
//                not a ranking fact, and mixing 203 of these into 2,081 negatives buries the list
//                worth acting on.
//
// The reason string each judged module already wrote is the classifier, listed here rather than
// pattern-matched, because "another ecosystem's load balancing" and "a balancer pattern we do not
// cover" differ by judgement and not by any substring. ON_TOPIC holds the gaps; everything else is a
// negative, and a reason missing from BOTH lists is a hard error — a new verdict must be classified
// deliberately, not silently defaulted into whichever bucket is larger.
const ON_TOPIC = new Set([
  'test disciplines and tooling the layered approach does not cover',
  'whether to adopt microservices at all — the extraction page assumes you have',
  'scaling, microservices or TypeScript as a general concept',
  'the site publishes no wire-level gRPC/REST measurements, and says so',
  'load balancing in another ecosystem, or a balancer pattern not covered',
  'a protocol the site never puts in the comparison',
  "a vendor's gateway product, or the generic definition the site never gives",
  'a tool the site never compares against',
  'prompts and resources — MCP primitives this server does not expose',
  'a client the setup page does not document',
  'hunting for a Node circuit-breaker library; the site ships and documents none',
]);

const OFF_TOPIC = new Set([
  "names a third party's MCP server; the site documents only @imqueue/mcp",
  'keyword-tool stemming wreckage: chemistry, biology, comics, perfume, restaurants',
  "tRPC's own API, adapters and integrations",
  'authoring, packaging or hosting a server of your own',
  'the MCP spec, registries and ecosystem meta — not covered',
  "NestJS's own framework surface, tutorials and courses",
  'keyword-tool wreckage on alternative / page / boss / split / vs / service client',
  "BullMQ's own API, options and error messages",
  "a host's own adjacent feature, not adding this server",
  "pg-boss's own API, schema and integrations",
  "another broker's own client library — the site never teaches them",
  '"pg" as paying-guest accommodation or a film rating; "nats" as gnats',
  'TRPC as an ion channel, a retirement company, a pigeon club',
  'the same question in another language ecosystem or cloud',
  'books, courses, certifications and other material about MCP',
  'LISTEN/NOTIFY, a Postgres queue or a broker in another language or stack',
  'deploying BullMQ, or pairing it with another runtime or store',
  'books, papers and diagrams about the migration',
  "gRPC's own API and Node tooling",
  '"delivery" as parcels, post and text messages',
  "another language ecosystem's gRPC, REST or tRPC story",
  "BullMQ Pro's commercial terms, or project media and branding",
  'a job queue in another language ecosystem',
  'the migration in another ecosystem, cloud, or as a named case study',
  'the JSON-RPC spec, or generating a client from an OpenAPI document',
  'IMQ the Spanish health insurer and its dental clinics',
  "node-cron's own syntax, or a plain JS timer",
  "a specific broker's own configuration for a delivery guarantee",
  "Redis's own commands, limits and operational properties",
  "Kubernetes', Windows' or Land Rover's discovery",
  '"bull" harvested as a word, not the library',
  'Node stream back-pressure, a different subject from a slow downstream service',
  'Ansible Molecule, a different tool that shares the name',
  "another product's own registry or integration docs",
  "Postgres's own SQL and server configuration",
]);

const queries = [];
const contentGap = [];
const negative = [];
const unclassified = new Set();
const order = new Map(natural.map((q, i) => [q, i]));

for (const file of MODULES) {
  const mod = require(path.join(SP, 'judged', file));

  for (const [target, topic, list] of mod.positive || []) {
    for (const query of list) {
      // The MCP setup keywords are real labels and correctly judged, but there are 246 of them all
      // pointing at one page, and they are SEO harvest rather than anything a visitor types into the
      // site's own search box. Carried as their own reported set so they cannot swamp the headline.
      const src = topic === 'mcp installation' ? 'seo' : 'natural';

      queries.push({ query, target, also: [], topic, src });
    }
  }
  for (const [why, list] of mod.negative || []) {
    const bucket = ON_TOPIC.has(why) ? contentGap : negative;

    if (!ON_TOPIC.has(why) && !OFF_TOPIC.has(why)) unclassified.add(`${file}: ${why}`);

    for (const query of list) bucket.push({ query, why });
  }
}

if (unclassified.size) {
  console.error('These quarantine verdicts are in neither ON_TOPIC nor OFF_TOPIC in build-gold.js.');
  console.error('Classify each one deliberately — an on-topic gap belongs on the content backlog, an');
  console.error('off-topic query belongs in the restraint population, and defaulting silently would');
  console.error('put a real content gap where nobody looks for it:\n');
  for (const line of [...unclassified].sort()) console.error(`  ${line}`);
  process.exit(1);
}

queries.sort((a, b) => (order.get(a.query) ?? 0) - (order.get(b.query) ?? 0));

for (const [query, target, also, topic] of QUESTION) {
  queries.push({ query, target, also, topic, src: 'question' });
}
for (const [query, target, also, topic, mustReach] of INTENT) {
  queries.push({
    query, target, also, topic, src: 'intent', kind: 'reference',
    ...(mustReach ? { mustReach } : {}),
  });
}
for (const [query, target, also, topic] of PEER) {
  queries.push({ query, target, also, topic, src: 'peer', kind: 'commercial', peer: true });
}

const byTopic = {};
const bySrc = {};

for (const c of queries) {
  byTopic[c.topic] = (byTopic[c.topic] || 0) + 1;
  bySrc[c.src] = (bySrc[c.src] || 0) + 1;
}

const stamp = fingerprint(queries);
const anchored = queries.filter((c) => c.target.includes('#')).length;

writeCollection(path.join(DATA, 'gold.json'), {
  about: 'The gold set: one expected #1 per query, chosen by reading the page that answers it.',
  how: 'Every target was judged from the real built page content — which page or anchored section '
    + 'actually answers the search string best. Ranker behaviour was not an input, and a metric that '
    + 'would saturate is a reason to add a metric, never a reason to write an untrue label.',
  fingerprint: stamp,
  counts: {
    total: queries.length,
    ...bySrc,
    anchoredTargets: anchored,
    withMustReach: queries.filter((c) => c.mustReach).length,
    topics: Object.keys(byTopic).length,
  },
  byTopic: Object.fromEntries(Object.entries(byTopic).sort((a, b) => b[1] - a[1])),
}, { queries });

writeCollection(path.join(DATA, 'quarantine.json'), {
  about: 'Queries with no answer on this site. Each verdict is a statement about the CONTENT — having '
    + 'read the pages, nothing on the site answers this — recorded per query so it is reviewable.',
  contentGap: 'ON TOPIC and unanswered: this site could reasonably cover it and no page does. A '
    + 'content backlog, not a ranking fact.',
  negative: 'NOT this site\'s subject at all — another vendor\'s own API, another language\'s '
    + 'ecosystem, or a name collision in the keyword harvest. This is the population the RESTRAINT '
    + 'measure samples: what comes back when there is genuinely nothing to return.',
  counts: { contentGap: contentGap.length, negative: negative.length },
}, {
  contentGap: contentGap.sort(bySortKey),
  negative: negative.sort(bySortKey),
});

console.log(`gold.json      ${queries.length} labels   fingerprint ${stamp}`);
console.log(`               ${JSON.stringify(bySrc)}`);
console.log(`               ${anchored} target an anchored section, ${queries.filter((c) => c.mustReach).length} carry mustReach`);
console.log(`               ${Object.keys(byTopic).length} topics`);
console.log(`quarantine.json ${contentGap.length + negative.length} with no answer here`);
console.log(`               ${negative.length} negative (not this site's subject — the restraint population)`);
console.log(`               ${contentGap.length} on-topic content gaps (the backlog worth reading)`);
