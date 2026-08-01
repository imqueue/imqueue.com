// api-packages.js — the single source of truth for which @imqueue packages get a
// generated API reference, and how they are grouped.
//
// Everything downstream reads this file instead of hard-coding a package list:
//
//   scripts/build-api-docs.js   which packages to generate, and per-package policy
//   scripts/gen-api-crosslinks  which packages to diff for stripped re-exports
//   src/_data/apiPackages.js    the /api/ landing page's Tier 2 group sections
//   functions/api/<pkg>/        generated per-package Cloudflare Pages Functions
//
// Adding a package is a one-line change here plus `npm run build-docs`. Nothing
// is hand-edited per package, which is the whole point: the previous shape
// (PKGS = ['core','rpc']) meant every new package cost a copy-pasted Function
// and a hand edit in four files, and the four drifted.
//
// --- fields ---------------------------------------------------------------
//
//   name        npm name without the @imqueue/ scope; also the /api/<name>/ segment
//   tier        1 = framework spine (you cannot build a service without it)
//               2 = a service capability you opt into
//   group       Tier 2 section heading on /api/. Ignored for tier 1, which keeps
//               its own hand-written card block.
//   tags        Sub-category, rendered as chips on the package entry. Never a
//               heading — two levels (group, then packages) is the limit.
//               REQUIRED on every tier 2 package, asserted below: a list where
//               some entries carry a chip and some do not reads as missing data
//               rather than as a distinction, which is why the original
//               "only where it distinguishes something" rule was dropped
//               (owner decision, 2026-08-01). Tier 1 stays untagged — its cards
//               are hand-written and the owner decided that block stays as it is.
//   blurb       One line on /api/. Seeded from the package's own npm description
//               so it starts out true; revise it when the package's wave ships.
//   note        Optional. Guidance about CHOOSING the package rather than about what
//               it does: which upstream version it targets, or which sibling package
//               covers the same ground for a different stack. Rendered under the blurb
//               on /api/ and carried into llms.txt, because an agent recommending a
//               package needs it more than a human browsing does. Keep it to one or
//               two sentences and keep it about the choice — anything describing
//               behaviour belongs in the blurb or the package's own documentation.
//               Inform the choice; do not make it. Two packages sharing an exclusive
//               tag are alternatives, not a preference, unless the owner says one is
//               deprecated — and none is.
//   agentNote   Optional, and llms.txt ONLY — never rendered on a visible page. The
//               same choice stated as an INSTRUCTION, because the two audiences want
//               different things from it: a human weighs a trade-off and picks, while
//               an agent needs a rule it can apply and will otherwise pick on whichever
//               summary best matches the prompt it was given. Keeping it out of the
//               page is the point — directive text that reads as guidance to an agent
//               reads as pressure to a human.
//               Say what to do in each case, and where a migration is implied, say it
//               is separate work. An agent handed "prefer X" will otherwise refactor a
//               working project in the middle of an unrelated task.
//   cliId       Matching id in the CLI's package catalog, or null when the package
//               has no catalog entry. `catalog.json` ships with the CLI and is
//               mirrored in the templates repo — it does NOT live in this repo, so
//               this is two files kept in sync, not one source of truth.
//   latestOnly  Publish /api/<pkg>/latest/ and nothing else. See LATEST-ONLY below.
//   status      'shipped'  generate it, list it on /api/, mount its Function
//               'planned'  in the schema, but not generated and not linked yet
//   wave        Rollout wave from the plan. Documentation only; `status` gates.
//
// --- LATEST-ONLY -----------------------------------------------------------
//
// `latestOnly: true` forces `archives: []`, so no past-major copies are generated.
// Two consequences that are deliberate, not accidental:
//
//   * A past-major URL 301s to /latest/ instead of 404ing, via the
//     `archive ? ... : /api/<pkg>/latest/` fallback in lib/api-redirects.js:83.
//   * cleanStale() deletes any version dir outside the plan, so flipping
//     latestOnly ON for core or rpc later would DELETE their published archives.
//     Those archives are noindex but may carry inbound links, which is the reason
//     to keep them — hence core and rpc are the two `latestOnly: false` entries.

'use strict';

// Tier 2 section order on the /api/ landing page, by combined monthly downloads.
const GROUP_ORDER = [
  'Data & events',
  'Observability',
  'API composition',
  'Hardening & validation',
  'Background work',
];

// The CLI marks ORM/database and Tracing/APM as pick-at-most-one. That rule is a
// property of a SET of packages, so it lives on the tag rather than becoming a
// navigation level for a constraint no doc reader cares about. `exclusive` is the
// only behaviour a tag carries — it adds a title attribute to the chip; every other
// tag is a plain label.
//
// A tag shared by several packages names what they have in common; a tag held by
// one names what that package is. Both are useful to a reader scanning the list,
// and every tier 2 package must have one.
const TAGS = {
  events: { exclusive: false },
  caching: { exclusive: false },
  ORM: { exclusive: true },
  'tracing & APM': { exclusive: true },
  logging: { exclusive: false },
  GraphQL: { exclusive: false },
  'network validation': { exclusive: false },
  'DDoS protection': { exclusive: false },
  'input validation': { exclusive: false },
  'jobs & scheduling': { exclusive: false },
};

const PACKAGES = [
  // --- Tier 1: framework spine (shipped; keeps its archives) ---------------
  //
  // core before rpc: this order is the build order, and it is what fixes the key
  // order of the generated src/_data/apiVersions.json and lib/api-versions.js.
  // Reversing it produces a pure-churn diff in both. It is NOT the order the /api/
  // landing page shows the two spine cards in — that block is hand-written and
  // leads with rpc, deliberately.
  {
    name: 'core',
    tier: 1,
    group: null,
    tags: [],
    blurb: 'The JSON messaging-queue engine, the IMQ factory, and the pluggable adapter interface.',
    cliId: null,
    latestOnly: false,
    status: 'shipped',
    wave: 0,
  },
  {
    name: 'rpc',
    tier: 1,
    group: null,
    tags: [],
    blurb: 'Services, clients and decorators — @expose, @remote, @lock, @cache — and the RPC runtime.',
    cliId: null,
    latestOnly: false,
    status: 'shipped',
    wave: 0,
  },

  // --- Tier 2: Data & events ----------------------------------------------
  {
    name: 'pg-pubsub',
    tier: 2,
    group: 'Data & events',
    tags: ['events'],
    blurb: 'Reliable PostgreSQL LISTEN/NOTIFY with inter-process lock support.',
    cliId: 'pg-pubsub',
    latestOnly: true,
    status: 'shipped',
    wave: 1,
  },
  {
    name: 'pg-cache',
    tier: 2,
    group: 'Data & events',
    tags: ['caching'],
    blurb: 'PostgreSQL-managed cache on Redis for @imqueue service methods.',
    cliId: 'pg-cache',
    latestOnly: true,
    status: 'shipped',
    wave: 1,
  },
  {
    name: 'tag-cache',
    tier: 2,
    group: 'Data & events',
    tags: ['caching'],
    blurb: 'Tagged cache implementation over Redis.',
    cliId: 'tag-cache',
    latestOnly: true,
    status: 'shipped',
    wave: 1,
  },
  {
    name: 'sequelize',
    tier: 2,
    group: 'Data & events',
    tags: ['ORM'],
    blurb: 'Turns a query described as data — filters, paging, ordering and the '
      + 'requested fields — into one efficient Sequelize statement, with database '
      + 'views as models.',
    note: 'Built on Sequelize v6 — mature, proven in production, and actively '
      + 'developed against here. If you would rather build on Prisma, '
      + '@imqueue/pg-prisma covers the same ground for that stack.',
    agentNote: 'Choosing: use this only in a project already built on Sequelize. '
      + 'For a new service use @imqueue/pg-prisma instead. In a Sequelize-based '
      + 'project, build on this package rather than working around it, and propose '
      + 'migrating to @imqueue/pg-prisma as separate work — never begin a migration '
      + 'in the middle of an unrelated task.',
    cliId: 'sequelize',
    latestOnly: true,
    status: 'planned',
    wave: 6,
  },
  {
    name: 'pg-prisma',
    tier: 2,
    group: 'Data & events',
    tags: ['ORM'],
    blurb: 'Prisma query extensions — soft-delete, access scoping, authorship and '
      + 'audit trails — plus row archiving, change-notify triggers and down-migrations.',
    agentNote: 'Choosing: this is the database toolkit to use for a new service.',
    cliId: 'prisma',
    latestOnly: true,
    status: 'shipped',
    wave: 6,
  },

  // --- Tier 2: Observability ----------------------------------------------
  {
    name: 'async-logger',
    tier: 2,
    group: 'Observability',
    // Deliberately NOT `tracing & APM`: it is not part of the CLI's exclusive
    // tracing pair, and a service can run it alongside either tracer.
    tags: ['logging'],
    blurb: 'Non-blocking logger over winston, with file and HTTP transports '
      + 'configured from the environment.',
    cliId: null,
    latestOnly: true,
    status: 'shipped',
    wave: 2,
  },
  {
    name: 'opentelemetry-instrumentation-imqueue',
    tier: 2,
    group: 'Observability',
    tags: ['tracing & APM'],
    blurb: 'OpenTelemetry instrumentation for @imqueue/rpc — every RPC traced, '
      + 'with no changes to service or client code.',
    cliId: 'opentelemetry',
    latestOnly: true,
    status: 'shipped',
    wave: 2,
  },
  {
    name: 'dd-trace',
    tier: 2,
    group: 'Observability',
    tags: ['tracing & APM'],
    blurb: 'Datadog APM tracing for @imqueue/rpc — a drop-in dd-trace '
      + 'replacement that traces every RPC.',
    cliId: 'dd-trace',
    latestOnly: true,
    status: 'shipped',
    wave: 2,
  },

  // --- Tier 2: API composition --------------------------------------------
  {
    name: 'graphql-dependency',
    tier: 2,
    group: 'API composition',
    tags: ['GraphQL'],
    blurb:
      'Declarative cross-service dependency loading for GraphQL — nested data in bulk instead of one call per resolved object.',
    cliId: 'graphql-dependency',
    latestOnly: true,
    status: 'shipped',
    wave: 3,
  },
  {
    name: 'type-graphql-dependency',
    tier: 2,
    group: 'API composition',
    tags: ['GraphQL'],
    blurb:
      'The same dependency loading for type-graphql — declared on your decorated classes rather than on raw GraphQL types.',
    cliId: 'type-graphql-dependency',
    latestOnly: true,
    status: 'shipped',
    wave: 3,
  },

  // --- Tier 2: Hardening & validation -------------------------------------
  {
    name: 'net',
    tier: 2,
    group: 'Hardening & validation',
    tags: ['network validation'],
    blurb: 'CIDR membership testing for IPv4 and IPv6 — sorted binary ranges '
      + 'searched in O(log n) rather than one comparison per network.',
    cliId: 'net',
    latestOnly: true,
    status: 'shipped',
    wave: 5,
  },
  {
    name: 'http-protect',
    tier: 2,
    group: 'Hardening & validation',
    tags: ['DDoS protection'],
    blurb: 'Per-IP rate limiting and banning for express-like servers, backed by '
      + 'Redis so every process sees one view of a client.',
    cliId: 'http-protect',
    latestOnly: true,
    status: 'shipped',
    wave: 5,
  },
  {
    name: 'validation',
    tier: 2,
    group: 'Hardening & validation',
    tags: ['input validation'],
    blurb: 'Zod-backed field- and method-level validation via native (TC39) decorators.',
    cliId: null,
    latestOnly: true,
    status: 'shipped',
    wave: 5,
  },

  // --- Tier 2: Background work --------------------------------------------
  {
    name: 'job',
    tier: 2,
    group: 'Background work',
    tags: ['jobs & scheduling'],
    blurb: 'Safe-by-default Redis job queue — delayed and scheduled jobs, '
      + 'at-least-once delivery, and retries driven by the handler.',
    cliId: 'job',
    latestOnly: true,
    status: 'shipped',
    wave: 4,
  },
];

// --- validation ------------------------------------------------------------
// This config is the only place the taxonomy exists, so a typo here silently
// drops a package from the landing page or mounts a Function for a name that has
// no pages. Fail loudly at require() time instead.
(function validate() {
  const seen = new Set();

  for (const p of PACKAGES) {
    if (seen.has(p.name)) throw new Error(`api-packages: duplicate package "${p.name}"`);
    seen.add(p.name);

    if (p.tier === 2 && !GROUP_ORDER.includes(p.group)) {
      throw new Error(`api-packages: ${p.name} has unknown group "${p.group}"`);
    }
    if (p.tier === 1 && p.group !== null) {
      throw new Error(`api-packages: tier 1 ${p.name} must not carry a group`);
    }
    for (const t of p.tags) {
      if (!TAGS[t]) throw new Error(`api-packages: ${p.name} has unknown tag "${t}"`);
    }
    // Every tier 2 entry renders a chip, so a missing tag shows up as a package
    // that looks less classified than the ones around it rather than as a
    // deliberate omission. Asserted so adding a package cannot reintroduce that.
    if (p.tier === 2 && !p.tags.length) {
      throw new Error(
        `api-packages: tier 2 ${p.name} has no tag — every tier 2 package needs ` +
        'one, add it to TAGS if the sub-category is new',
      );
    }
    if (!['shipped', 'planned'].includes(p.status)) {
      throw new Error(`api-packages: ${p.name} has unknown status "${p.status}"`);
    }
  }

  const orphanGroups = GROUP_ORDER.filter(g => !PACKAGES.some(p => p.group === g));
  if (orphanGroups.length) {
    throw new Error(`api-packages: group(s) with no packages: ${orphanGroups.join(', ')}`);
  }

  const orphanTags = Object.keys(TAGS).filter(t => !PACKAGES.some(p => p.tags.includes(t)));
  if (orphanTags.length) {
    throw new Error(`api-packages: tag(s) on no package: ${orphanTags.join(', ')}`);
  }
})();

/** Packages the site actually generates and links to. */
function shipped() {
  return PACKAGES.filter(p => p.status === 'shipped');
}

/** One package by its unscoped name, or undefined. */
function byName(name) {
  return PACKAGES.find(p => p.name === name);
}

/**
 * Tier 2 packages grouped for rendering, in GROUP_ORDER, shipped only.
 * Groups with nothing shipped yet are omitted rather than rendered empty.
 *
 * @returns {Array<{group: string, packages: object[]}>}
 */
function shippedGroups() {
  return GROUP_ORDER
    .map(group => ({
      group,
      packages: shipped().filter(p => p.tier === 2 && p.group === group),
    }))
    .filter(g => g.packages.length);
}

module.exports = { PACKAGES, GROUP_ORDER, TAGS, shipped, shippedGroups, byName };
