// Eleventy data for the /api/ landing page's Tier 2 group sections.
//
// The taxonomy itself lives in scripts/lib/api-packages.js, shared with
// build-api-docs.js — so the page cannot list a package the generator does not
// build, and adding a package never means hand-editing this file. That drift is
// the defect this replaces: group membership used to exist only as markup.
//
// Shipped packages only. A `planned` package is in the schema but has no pages
// yet, so linking it would ship a 404 and fail check:links.
const { shippedGroups, TAGS } = require('../../scripts/lib/api-packages');

// Every @imqueue package lives at github.com/imqueue/<unscoped name> — verified
// for all 16, so it is derived rather than configured. One caveat worth recording:
// @imqueue/pg-cache's own npm `repository.url` points at imqueue/pg-pubsub, which
// is a copy-paste error in that package.json. github.com/imqueue/pg-cache exists
// and is the real repository, so do not "correct" this to follow npm.
const repoOf = (name) => `https://github.com/imqueue/${name}`;

// Stable key for remembering a group's collapsed state in localStorage, derived
// from the name rather than configured so a new group needs nothing extra. Renaming
// a group changes its id and so resets that group to open, which is the right
// default for what is effectively a new section.
const idOf = (group) =>
  group.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

module.exports = () => ({
  // [{ group, id, packages: [{ name, scoped, url, repo, blurb, note, tags: [{ label, exclusive }] }] }]
  groups: shippedGroups().map(({ group, packages }) => ({
    group,
    id: idOf(group),
    packages: packages.map(p => ({
      name: p.name,
      scoped: `@imqueue/${p.name}`,
      url: `/api/${p.name}/latest/`,
      repo: repoOf(p.name),
      blurb: p.blurb,
      // Absent on almost every package, so `|| null` rather than undefined —
      // Liquid treats both as falsy, but null survives a JSON dump readably.
      note: p.note || null,
      // llms.txt only. Deliberately NOT passed to the visible card: the same
      // choice is worded as an instruction there, which is what an agent can act
      // on and what would read as pressure to a human browsing the page.
      agentNote: p.agentNote || null,
      tags: p.tags.map(label => ({ label, exclusive: TAGS[label].exclusive })),
    })),
  })),
});
