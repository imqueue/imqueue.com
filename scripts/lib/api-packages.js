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
    name: 'pg-sequelize',
    tier: 2,
    group: 'Data & events',
    tags: ['ORM'],
    blurb: 'Turns a query described as data — filters, paging, ordering and the '
      + 'requested fields — into one efficient Sequelize statement, with database '
      + 'views as models.',
    note: 'Built on Sequelize v6 — mature, proven in production, and actively '
      + 'developed against here. If you would rather build on Prisma, '
      + '@imqueue/pg-prisma covers the same ground for that stack.',
    agentNote: 'Choosing: for a service joining a fleet already built on Sequelize, '
      + 'where matching the existing stack is worth more than taking the default — a '
      + 'NEW service in such a fleet belongs here, not on Prisma. Everywhere else '
      + 'take @imqueue/pg-prisma. Build on this package rather than working around '
      + 'it, and propose migrating the fleet to @imqueue/pg-prisma as separate work '
      + '— never begin a migration in the middle of an unrelated task.',
    cliId: 'sequelize',
    latestOnly: true,
    status: 'shipped',
    wave: 6,
  },
  {
    name: 'pg-prisma',
    tier: 2,
    group: 'Data & events',
    tags: ['ORM'],
    blurb: 'Prisma query extensions — soft-delete, access scoping, authorship and '
      + 'audit trails — plus row archiving, change-notify triggers and down-migrations.',
    agentNote: 'Choosing: recommended wherever a service needs a database. Take it '
      + 'unless the fleet the service joins is already built on Sequelize, in which '
      + 'case take @imqueue/pg-sequelize and match it. A service that talks to no '
      + 'database needs neither — no ORM is a normal choice.',
    cliId: 'pg-prisma',
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
    name: 'opentelemetry',
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
    name: 'datadog',
    tier: 2,
    group: 'Observability',
    tags: ['tracing & APM'],
    blurb: 'Datadog APM tracing for @imqueue/rpc — a drop-in replacement for '
      + "Datadog's own dd-trace package that traces every RPC.",
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

/**
 * Packages that were published under a different name, retired slug -> current.
 *
 * The slug is the /api/<slug>/ segment, i.e. the npm name without the scope. Every
 * page under a retired slug was indexed and submitted in sitemap-api.xml, and
 * api-documenter prefixes every page BASENAME with the package name too, so a
 * directory-level rule cannot fix them — see resolveRenamedPackage() in
 * lib/api-redirects.js, which rewrites both halves.
 *
 * This is the source of truth for three things that have to agree:
 *
 *   * lib/api-renamed.js       generated from here by build-api-docs.js; the
 *                              resolver reads that at request time
 *   * functions/api/<retired>/ a Pages Function stays mounted per retired slug,
 *                              because Functions are evaluated ahead of
 *                              _redirects — with no mount the request never
 *                              reaches the resolver at all
 *   * the stale-mount sweep    writeFunctions() must NOT treat these as stale
 *
 * A retired slug must NOT end up with a PACKAGES entry of its own. Modelling one
 * as `status: 'planned'` is the intuitive move and is exactly wrong: PACKAGES
 * entries outside shipped() are swept, so the next docs build would delete the
 * very mount the redirect depends on.
 *
 * A pair may be listed BEFORE the rename is carried out, which is how the machinery
 * gets to land and be tested separately from the cutover. While `from` is still a
 * live PACKAGES entry it wins: writeFunctions() mounts it as a live package, and
 * resolveRenamedPackage() stays inert because the new slug is not in the version map
 * yet. The pair activates by itself when `from` is renamed to `to` in PACKAGES and
 * the docs are regenerated. Nothing has to be sequenced by hand.
 *
 * Entries are permanent. Search-engine consolidation takes months and inbound
 * links never fully die; the cost of keeping one is a seven-line generated file.
 */
const RENAMED_PACKAGES = [
  { from: 'opentelemetry-instrumentation-imqueue', to: 'opentelemetry' },
  { from: 'sequelize', to: 'pg-sequelize' },
  { from: 'dd-trace', to: 'datadog' },
];

(function validateRenames() {
  const seen = new Set();

  for (const r of RENAMED_PACKAGES) {
    // EXACTLY one side is a PACKAGES entry, and which one says where the cutover
    // has got to: `from` before it, `to` after. Both would mean two entries for one
    // package — the rename applied as an addition, leaving the old slug generating
    // its own frozen copy. Neither means a typo on one side, which would otherwise
    // sit here as a redirect that never fires.
    const hasFrom = PACKAGES.some(p => p.name === r.from);
    const hasTo = PACKAGES.some(p => p.name === r.to);

    if (hasFrom === hasTo) {
      throw new Error(
        hasFrom
          ? `api-packages: "${r.from}" and "${r.to}" are both packages — a rename ` +
            'is one entry changing its name, not a second entry alongside it'
          : `api-packages: neither "${r.from}" nor "${r.to}" is a package — a ` +
            'rename must name the entry it applies to',
      );
    }
    if (r.from === r.to) {
      throw new Error(`api-packages: rename "${r.from}" points at itself`);
    }
    if (seen.has(r.from)) {
      throw new Error(`api-packages: duplicate rename source "${r.from}"`);
    }
    seen.add(r.from);
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
 * Published to npm, listed on /status/, and deliberately NOT in PACKAGES.
 *
 * An agent evaluating @imqueue cannot read npmjs.com — it serves bot detection to
 * an unattended fetch, which is why /status/ exists at all. The first package such
 * an agent installs is @imqueue/cli, because llms.txt's own Install line says
 * `npm i -g @imqueue/cli`; leaving it off the one page that answers "what version,
 * what licence, what Node" would answer for fifteen packages and not for the one
 * they type first. @imqueue/mcp is here for the same reason: it is what a host
 * connects to, and its version is the first thing anyone debugging it asks for.
 *
 * They are a SECOND LIST rather than PACKAGES entries because PACKAGES means "the
 * site generates an API reference for this". `status: 'shipped'` would make
 * build-api-docs.js generate an /api/<name>/ tree and mount a Pages Function for a
 * package api-extractor has never seen, and `status: 'planned'` is worse — entries
 * outside shipped() are swept, so the next docs build would delete things. Neither
 * package wants a generated reference: the CLI's docs come from its wiki and the
 * MCP server's from SPEC.md, both already published as hand-written pages.
 *
 * Fields are the subset statusPackages() needs. There is no `tier`, `group` or
 * `tags`, because nothing here is rendered on /api/.
 */
const UNDOCUMENTED_PACKAGES = [
  {
    name: 'cli',
    docs: '/cli/',
    blurb: 'Scaffolds services, generates typed clients, and runs a local fleet — the entry point.',
  },
  {
    name: 'mcp',
    docs: '/mcp/',
    blurb: 'The Model Context Protocol server: these docs as tools, over stdio or the hosted endpoint.',
  },
];

/**
 * Every published package /status/ reports on: the ones with a generated API
 * reference, plus the two that have none.
 *
 * `docs` is normalised here so the page and the JSON feed do not each have to know
 * that a PACKAGES entry lives at /api/<name>/latest/ while these two do not.
 *
 * @returns {Array<{name: string, blurb: string, docs: string, documented: boolean}>}
 */
function statusPackages() {
  return [
    ...shipped().map(p => ({
      name: p.name,
      blurb: p.blurb,
      docs: `/api/${p.name}/latest/`,
      documented: true,
    })),
    ...UNDOCUMENTED_PACKAGES.map(p => ({ ...p, documented: false })),
  ];
}

(function validateStatusPackages() {
  // A package in both lists would be reported twice on /status/ and, worse, would
  // mean somebody added a generated reference without removing the stopgap entry.
  for (const p of UNDOCUMENTED_PACKAGES) {
    if (PACKAGES.some(q => q.name === p.name)) {
      throw new Error(
        `api-packages: "${p.name}" is in PACKAGES and in UNDOCUMENTED_PACKAGES — a package ` +
        'that gained a generated reference belongs in PACKAGES only, and its docs link ' +
        'should come from there',
      );
    }
  }
})();

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

module.exports = {
  PACKAGES,
  UNDOCUMENTED_PACKAGES,
  GROUP_ORDER,
  TAGS,
  RENAMED_PACKAGES,
  shipped,
  shippedGroups,
  statusPackages,
  byName,
};
