#!/usr/bin/env node
// check-jsonld.js — the structured-data graph, asserted across every built page.
//
//   node scripts/check-jsonld.js
//
// JSON-LD fails in the worst possible way: silently. A malformed block, a dangling
// @id or a node that quietly stopped being emitted costs nothing at build time,
// nothing at request time, and everything at the point where an answer engine tries
// to reconcile the entity. Nobody notices until a rich result disappears, and by
// then the cause is weeks back.
//
// What is asserted, and why each one:
//
//   1. Every block parses. 3,843 of them across 1,890 pages, in every Liquid
//      conditional combination. One trailing comma in a rarely-hit branch is enough.
//   2. Every internal `@id` reference resolves to a node defined ON THAT PAGE.
//      A reference to a node that is not there is a broken edge in the graph, which
//      is worse than no edge — it asserts a relationship to nothing.
//   3. The canonical definition and the alias list are present, verbatim, on every
//      page. That repetition IS the entity-resolution mechanism (see
//      src/_data/site.yml); a page that reworded it would be asserting an eighth
//      variant, which is the exact failure that file exists to end.
//   4. The contact address survives. Cloudflare Email Obfuscation strips it from
//      100% of the HTML on both zones, and the Organization node is the one place
//      in an HTML response it cannot reach — so if it vanishes from here, the site
//      has no machine-readable contact route at all.
//   5. No aggregateRating, review, or InteractionCounter, anywhere. A deliberate
//      standing decision: the real numbers (27 stars, low-thousands downloads, zero
//      third-party dependents) are self-defeating to publish, and inventing them is
//      out of the question. This asserts nobody adds them later "for the stars".
//   6. FAQPage answers are PRESENT ON THE PAGE. Google requires it, and the one
//      hand-written FAQPage block in this repo had already drifted from its prose
//      ("What is the best…" vs the visible "What's the best…"), which is why the
//      markup is generated now.
//   7. Both editions carry the software entity. imqueue.com described an
//      Organization, a WebSite and no software at all, on the older domain with all
//      the archival history — the one a model resolving "imqueue" fetches first.
//   8. Only imqueue.org claims price 0. The commercial home page selling licences
//      must never assert the product is free.
//
// Exits non-zero on any failure; wired into `npm test`.

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const yaml = require('js-yaml');

const ROOT = path.join(__dirname, '..');
const EDITIONS = { org: 'https://imqueue.org', com: 'https://imqueue.com' };

let failures = 0;
const fail = (msg) => { failures++; console.error(`  FAIL  ${msg}`); };
const pass = (msg) => console.log(`  ok    ${msg}`);

const site = yaml.load(fs.readFileSync(path.join(ROOT, 'src/_data/site.yml'), 'utf8'));
const DEFINITION = String(site.definition).replace(/\s+/g, ' ').trim();
const ALIASES = site.aliases;
const EMAIL = 'support@imqueue.com';

const BLOCK = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/g;

// Every node in a graph, flattened — a page may ship several blocks and each may
// be a single node, an @graph, or an array.
function nodesIn(json) {
  const out = [];
  const walk = (value) => {
    if (Array.isArray(value)) return value.forEach(walk);
    if (!value || typeof value !== 'object') return;
    if (value['@type'] || value['@id']) out.push(value);
    if (Array.isArray(value['@graph'])) value['@graph'].forEach(walk);
  };

  walk(json);

  return out;
}

// Visible text of a page, for the FAQPage "answer is on the page" assertion.
function visibleText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Whitespace is not comparable between the two sides and must not be. Stripping a
// tag leaves a space where there was none — `<code>@imqueue</code>, for…` becomes
// "@imqueue , for…" — while the markup, generated from the markdown source, has
// "@imqueue, for…". Comparing with whitespace removed keeps the assertion about the
// WORDS, which is what "the answer is on the page" means.
const squash = (s) => s.replace(/\s+/g, '').toLowerCase();

const FORBIDDEN = ['aggregateRating', 'review', 'reviewCount', 'ratingValue', 'InteractionCounter'];

for (const [edition, origin] of Object.entries(EDITIONS)) {
  const dir = path.join(ROOT, `_site-${edition}`);

  console.log(`\n${edition}:`);

  if (!fs.existsSync(dir)) {
    fail(`_site-${edition} is missing — build this edition first`);
    continue;
  }

  const stats = {
    pages: 0, blocks: 0, unparseable: 0, noJsonLd: 0,
    danglingIds: 0, missingDefinition: 0, missingAliases: 0,
    noEmail: 0, forbidden: 0, faqPages: 0, faqQuestions: 0, faqNotOnPage: 0,
    softwareHome: 0, priced: 0, types: new Map(),
  };

  (function walk(d) {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, entry.name);

      if (entry.isDirectory()) { walk(full); continue; }
      if (entry.name !== 'index.html' && entry.name !== '404.html') continue;

      const html = fs.readFileSync(full, 'utf8');
      const rel = `/${path.relative(dir, path.dirname(full)).split(path.sep).join('/')}/`.replace('//', '/');

      stats.pages++;

      const blocks = [...html.matchAll(BLOCK)];

      if (!blocks.length) {
        stats.noJsonLd++;
        fail(`${rel} has no JSON-LD at all`);
        continue;
      }

      const nodes = [];

      for (const [, body] of blocks) {
        stats.blocks++;
        try {
          nodes.push(...nodesIn(JSON.parse(body)));
        } catch (err) {
          stats.unparseable++;
          if (stats.unparseable <= 5) {
            fail(`${rel} has an unparseable ld+json block: ${err.message.slice(0, 90)}`);
          }
        }
      }

      const defined = new Set(nodes.map((n) => n['@id']).filter(Boolean));

      for (const node of nodes) {
        const type = [].concat(node['@type'] || []).join('|');

        if (type) stats.types.set(type, (stats.types.get(type) || 0) + 1);

        // Dangling @id references. A node that is ONLY `{ "@id": "..." }` is a
        // reference; it has to point at something defined on the same page.
        for (const [key, value] of Object.entries(node)) {
          const refs = [].concat(value).filter(
            (v) => v && typeof v === 'object' && v['@id'] && Object.keys(v).length === 1,
          );

          for (const ref of refs) {
            // Only SAME-PAGE references. A reference to `<other-page>#node` is
            // ordinary linked data — /blog/topics/queue/ saying `isPartOf:
            // /blog/#blog` is correct, and /blog/ does define that node. What is
            // genuinely broken is a page pointing at a fragment of ITSELF that it
            // never defines, which is an edge to nothing.
            const samePage = ref['@id'].startsWith(`${origin}${rel}#`)
              || (rel === '/' && ref['@id'].startsWith(`${origin}/#`));

            if (samePage && !defined.has(ref['@id'])) {
              stats.danglingIds++;
              if (stats.danglingIds <= 8) {
                fail(`${rel} ${type}.${key} references ${ref['@id']} — a fragment of its OWN url that it never defines`);
              }
            }
          }
        }

        for (const key of FORBIDDEN) {
          if (key in node || type.includes(key)) {
            stats.forbidden++;
            fail(`${rel} ${type} carries "${key}" — a standing decision says no ratings, reviews or interaction counts`);
          }
        }

        if (type === 'FAQPage') {
          stats.faqPages++;

          const page = visibleText(html);

          for (const q of node.mainEntity || []) {
            stats.faqQuestions++;

            const answer = ((q.acceptedAnswer || {}).text || '').replace(/\s+/g, ' ').trim();
            // A prefix is enough: the visible answer often continues past what the
            // markup carries, and matching the whole string would fail on a
            // legitimate trailing link.
            const probe = squash(answer).slice(0, 60);

            if (probe && !squash(page).includes(probe)) {
              stats.faqNotOnPage++;
              if (stats.faqNotOnPage <= 5) {
                fail(`${rel} FAQPage answer is not in the visible page: "${probe}…"`);
              }
            }
          }
        }

        if (type === 'SoftwareApplication' && node['@id'] === `${origin}/#software`) {
          if (rel === '/') stats.softwareHome++;
          if (node.offers) stats.priced++;
        }
      }

      // The definition, the aliases and the address, on every page.
      const org = nodes.find((n) => n['@id'] === `${origin}/#org`);

      if (!org) {
        fail(`${rel} has no Organization node at ${origin}/#org`);
        continue;
      }

      if (String(org.description || '').replace(/\s+/g, ' ').trim() !== DEFINITION) {
        stats.missingDefinition++;
        if (stats.missingDefinition <= 3) {
          fail(`${rel} Organization.description is not the canonical definition from site.yml`);
        }
      }
      if (JSON.stringify(org.alternateName) !== JSON.stringify(ALIASES)) {
        stats.missingAliases++;
        if (stats.missingAliases <= 3) {
          fail(`${rel} Organization.alternateName is not site.yml's alias list`);
        }
      }
      if (org.email !== EMAIL) {
        stats.noEmail++;
        if (stats.noEmail <= 3) {
          fail(`${rel} Organization has no email — Email Obfuscation removes it from the HTML, so this is the only copy a crawler can read`);
        }
      }
    }
  }(dir));

  if (!stats.unparseable) pass(`${stats.blocks} ld+json blocks across ${stats.pages} pages, all parse`);
  if (!stats.noJsonLd) pass('every page carries JSON-LD');
  if (!stats.danglingIds) pass('no page references a fragment of its own url that it does not define');
  if (!stats.missingDefinition) pass(`the canonical definition is on all ${stats.pages} pages, verbatim`);
  if (!stats.missingAliases) pass(`alternateName ${JSON.stringify(ALIASES)} is on all ${stats.pages} pages`);
  if (!stats.noEmail) pass('the contact address survives on every page');
  if (!stats.forbidden) pass('no aggregateRating / review / InteractionCounter anywhere');
  if (stats.faqPages && !stats.faqNotOnPage) {
    pass(`${stats.faqQuestions} FAQPage answers across ${stats.faqPages} pages, all present in the visible page`);
  }

  // Per-edition expectations.
  if (!stats.softwareHome) {
    fail(`the home page has no SoftwareApplication at ${origin}/#software — this edition describes no software`);
  } else {
    pass('the home page describes the software entity');
  }

  if (edition === 'org' && !stats.priced) {
    fail('imqueue.org/#software has no price-0 Offer — the GPL edition should say it is free');
  }
  if (edition === 'com' && stats.priced) {
    fail('imqueue.com/#software carries an Offer — the commercial site must not claim the product is free');
  }
  if ((edition === 'org') === Boolean(stats.priced)) {
    pass(edition === 'org'
      ? 'the open-source edition advertises price 0'
      : 'the commercial edition makes no free-price claim');
  }

  const top = [...stats.types.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);

  console.log(`        node types: ${top.map(([t, n]) => `${t}×${n}`).join(', ')}`);
}

if (failures) {
  console.error(`\n${failures} JSON-LD check(s) failed.`);
  process.exit(1);
}
console.log('\nAll JSON-LD checks passed.');
