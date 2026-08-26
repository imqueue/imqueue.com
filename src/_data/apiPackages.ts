// Eleventy data for the /api/ landing page's Tier 2 group sections.
//
// The taxonomy itself lives in scripts/lib/api-packages.ts, shared with
// build-api-docs.ts — so the page cannot list a package the generator does not
// build, and adding a package never means hand-editing this file. That drift is
// the defect this replaces: group membership used to exist only as markup.
//
// Shipped packages only. A `planned` package is in the schema but has no pages
// yet, so linking it would ship a 404 and fail check:links.
import { shippedGroups, TAGS } from '../../scripts/lib/api-packages.ts';

// Every @imqueue package lives at github.com/imqueue/<unscoped name> — verified
// for all 16, so it is derived rather than configured.
//
// This used to carry a caveat: @imqueue/pg-cache published `repository.url`
// pointing at imqueue/pg-pubsub, so the note said not to "correct" this to follow
// npm. That was true up to 5.0.5 and stopped being true at 5.0.6, and the note
// outlived it by two releases — the derived URL was right the whole time, which is
// why nothing caught the drift. npm now agrees with the derivation for all 16.
const repoOf = (name: string): string => `https://github.com/imqueue/${name}`;

// Stable key for remembering a group's collapsed state in localStorage, derived
// from the name rather than configured so a new group needs nothing extra. Renaming
// a group changes its id and so resets that group to open, which is the right
// default for what is effectively a new section.
const idOf = (group: string): string =>
  group.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

export default () => ({
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
      // `?? false` covers a tag that is not in TAGS. api-packages.ts validates
      // that at load and throws, so this cannot be reached — but the alternative
      // is a `!` on the one line that would report the corrupted taxonomy.
      tags: p.tags.map(label => ({ label, exclusive: TAGS[label]?.exclusive ?? false })),
    })),
  })),
});
