#!/usr/bin/env node
// gen-artificial.js — build a large labelled query set out of the site's own content.
//
//   node scripts/search-kpi/gen-artificial.js [--count 10000] [--out FILE]
//
// WHY A SYNTHETIC SET AT ALL
//
// There are no query logs yet, and a hand-written case list is worth about twenty queries
// before it starts describing the ranker instead of the reader. Deriving queries from the
// content gives ground truth for free — a query built from page P should return P — at
// scale, across every page rather than the handful anybody thought to check.
//
// WHAT IT CANNOT TELL YOU
//
// It is optimistic by construction. Every query here uses the site's own vocabulary, so it
// cannot measure the thing that actually breaks a site search: a reader who does not know
// the words. Read this number as an upper bound and a regression detector, and read the
// natural set for the real one. That gap is the whole point of measuring both.
//
// AMBIGUITY
//
// The same string can be generated from several pages — "installation" comes from both
// /cli/installation/ and /mcp/installation/. Those queries are kept with EVERY source page
// accepted as correct, because any of them at #1 is a good answer. Strings claimed by more
// than MAX_CLAIMS pages are dropped instead: at that point the query has no best answer and
// scoring it would only measure the tie-break.

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const OUT_DEFAULT = path.join(__dirname, 'data', 'artificial-queries.json');
const MAX_CLAIMS = 4;
const MIN_LEN = 3;

const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);

  return i === -1 ? fallback : process.argv[i + 1];
};

const COUNT = Number(arg('--count', 10000));
const OUT = arg('--out', OUT_DEFAULT);

// Deterministic PRNG. A KPI you re-run has to produce the same set, or every comparison
// includes the noise of a different sample.
function rng(seed) {
  let state = seed >>> 0;

  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;

    return state / 0x100000000;
  };
}

const random = rng(20260805);
const pick = (list) => list[Math.floor(random() * list.length)];

function shuffled(list) {
  const copy = [...list];

  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));

    [copy[i], copy[j]] = [copy[j], copy[i]];
  }

  return copy;
}

// ---- vocabulary -----------------------------------------------------------
// Words too common on this site to carry a query on their own. Dropping them from SUBSET
// buckets keeps "the and for" from being generated as a three-word query; they are left
// alone inside whole phrases, where they are part of real phrasing.
const STOP = new Set((
  'a an the and or but if then than that this these those of in on at to for from by with ' +
  'as is are was were be been being do does did doing have has had having it its into over ' +
  'under about between out up down not no nor so such can could will would should may might ' +
  'must you your yours we our us they them their he she his her i me my what which who whom ' +
  'when where why how all any both each few more most other some only own same too very s t ' +
  'just also via per vs'
).split(' '));

const clean = (text) => String(text || '')
  .toLowerCase()
  .replace(/[‘’“”]/g, '')
  .replace(/[^a-z0-9@/.\-+ ]+/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const words = (text) => clean(text).split(' ').filter(Boolean);
const content = (text) => words(text).filter((w) => !STOP.has(w) && w.length > 1);

// ---- load content ---------------------------------------------------------
function loadContent(dir) {
  const read = (name) => JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
  const index = read('search-index.json');
  const text = read('search-text.json');

  const S_PAGE = 0;
  const S_ANCHOR = 1;
  const S_HEAD = 2;
  const S_TEXT = 3;
  const S_EMPH = 4;

  const docs = index.records.filter((r) => r.g === 0);
  const answers = index.records.filter((r) => r.g === 2);
  const api = index.records.filter((r) => r.g === 1);

  const sections = text.sections.map((section) => ({
    url: text.pages[section[S_PAGE]][0],
    anchor: section[S_ANCHOR],
    head: section[S_HEAD],
    text: section[S_TEXT],
    emph: section[S_EMPH],
  }));

  // Section document frequency: in how many sections a word appears at all, matching how
  // search.js measures it. A Map, not an object — `df.constructor` on a plain object is a
  // truthy function, which is exactly the bug that hid nineteen unreachable pages in the
  // ranker (see STOP in src/_shared/js/search.js).
  const df = new Map();

  for (const section of sections) {
    for (const word of new Set(words(`${section.text} ${section.head}`))) {
      df.set(word, (df.get(word) || 0) + 1);
    }
  }

  return { docs, answers, api, sections, df };
}

// ---- buckets --------------------------------------------------------------
// Each generator yields {query, expect, bucket}. `expect` is the URL the query was derived
// from; identical strings are merged later so all their sources are accepted.
function generate(data) {
  const out = [];
  // A one-word query whose word is everywhere on this site has no defensible expected answer,
  // so scoring one measures nothing. Two such cases reached the set and both were reviewed as
  // invalid: `service` — generated from `StartSpanOptions.service` but appearing in 365 of 719
  // sections, and a reader typing it more likely wants IMQService — and `default`, from
  // `_default`, in 130 sections, where what the ranker returns today is more useful than the
  // page the case demanded. Marking either a miss made the KPI wrong, not the ranker.
  //
  // Data-driven rather than a blocklist, so it holds as the corpus changes: this is the same
  // principle as STOP above ("too common on this site to carry a query on their own"), applied
  // to the API buckets, which STOP never reached. The threshold keeps every real identifier
  // clear — `networks` 11, `jobqueue` 6, `constructor` 3, `lte` 0 — while both invalid cases sit
  // an order of magnitude above it.
  const COMMON_SHARE = 0.05;
  const tooCommon = Math.max(8, Math.round(data.sections.length * COMMON_SHARE));

  const add = (query, expect, bucket) => {
    const q = clean(query);
    const terms = content(q);

    if (terms.length === 1 && (data.df.get(terms[0]) || 0) > tooCommon) {
      return;
    }

    if (q.length >= MIN_LEN && terms.length) out.push({ query: q, expect, bucket });
  };

  // 1. curated keywords front matter — the phrasings the authors predicted readers use.
  for (const doc of [...data.docs, ...data.api]) {
    for (const phrase of String(doc.w || '').split(',')) {
      if (content(phrase).length) add(phrase, doc.u, 'keywords');
    }
  }

  // 2. page titles, whole and as subsets.
  for (const doc of data.docs) {
    add(doc.t, doc.u, 'title');

    const terms = content(doc.t);

    for (let n = 0; n < 8 && terms.length > 2; n++) {
      const size = 2 + Math.floor(random() * Math.min(3, terms.length - 1));

      add(shuffled(terms).slice(0, size).join(' '), doc.u, 'title-subset');
    }

    // The summary is the one-line answer to "what is this page" — its distinctive words are
    // a plausible half-remembered query.
    const blurb = content(doc.s).filter((t) => t.length > 4);

    for (let n = 0; n < 4 && blurb.length > 2; n++) {
      add(shuffled(blurb).slice(0, 2 + Math.floor(random() * 2)).join(' '), doc.u, 'summary');
    }
  }

  // 3. section headings — whole, and as subsets. A heading is the closest thing the content
  //    has to a question somebody would type.
  for (const section of data.sections) {
    if (!section.head) continue;

    const url = section.anchor ? `${section.url}#${section.anchor}` : section.url;

    add(section.head, url, 'heading');

    const terms = content(section.head);

    for (let n = 0; n < 3 && terms.length > 2; n++) {
      add(shuffled(terms).slice(0, 2 + Math.floor(random() * 2)).join(' '), url, 'heading-subset');
    }
  }

  // 4. FAQ answer titles — real question phrasing, verbatim and stripped of question words.
  for (const answer of data.answers) {
    add(answer.t, answer.u, 'question');

    const terms = content(answer.t);

    if (terms.length > 2) add(terms.slice(0, 4).join(' '), answer.u, 'question-keywords');
  }

  // 5. API identifiers — the lookup an engineer does mid-edit. Both the bare symbol and the
  //    dotted path the docs title uses.
  for (const record of data.api) {
    add(record.t, record.u, 'api-symbol');

    const last = record.u.replace(/\/$/, '').split('/').pop();

    if (last && last.includes('.')) {
      add(last.split('.').pop(), record.u, 'api-member');
      add(last.replace(/\./g, ' '), record.u, 'api-path');
    }
  }

  // 6. natural-language templates over each page's own topic words. Content words only, so
  //    the template supplies the question shape and the page supplies the subject.
  const TEMPLATES = [
    (t) => `how to ${t}`,
    (t) => `what is ${t}`,
    (t) => `${t} example`,
    (t) => `${t} tutorial`,
    (t) => `how do i ${t}`,
    (t) => `${t} not working`,
    (t) => `${t} nodejs`,
    (t) => `${t} typescript`,
    (t) => `best way to ${t}`,
    (t) => `${t} vs`,
  ];

  for (const doc of data.docs) {
    const terms = content(`${doc.t} ${doc.w || ''}`);

    if (terms.length < 2) continue;

    for (let n = 0; n < 12; n++) {
      const subject = shuffled(terms).slice(0, 2 + Math.floor(random() * 2)).join(' ');

      add(pick(TEMPLATES)(subject), doc.u, 'template');
    }
  }

  // 7. salient body terms. Rarest-on-site words from a section's prose: what a reader
  //    remembers of a page is usually its unusual words, not its title.
  const df = Object.create(null);

  for (const section of data.sections) {
    for (const term of new Set(content(section.text))) df[term] = (df[term] || 0) + 1;
  }

  for (const section of data.sections) {
    const terms = [...new Set(content(`${section.emph} ${section.text}`))]
      .filter((t) => t.length > 3 && df[t] >= 2 && df[t] <= 12)
      .sort((a, b) => df[a] - df[b]);

    if (terms.length < 2) continue;

    const url = section.anchor ? `${section.url}#${section.anchor}` : section.url;

    // Several windows into the rarest-first list, not just the head of it: a reader
    // remembers *some* unusual word from the page, not reliably the rarest one.
    for (const [from, size] of [[0, 2], [0, 3], [1, 2], [2, 2], [0, 4], [1, 3]]) {
      if (terms.length >= from + size) {
        add(terms.slice(from, from + size).join(' '), url, 'body-salient');
      }
    }
  }

  return out;
}

// ---- typo bucket ----------------------------------------------------------
// Reported SEPARATELY, never folded into the headline number. The ranker has no fuzzy
// matching at all, so mixing typos in would move the KPI for a reason that has nothing to do
// with relevance weighting. Kept because it is the one bucket that quantifies a known gap.
function typos(cases, count) {
  const KEYS = { a: 's', e: 'w', i: 'o', o: 'i', s: 'a', t: 'r', n: 'm', r: 'e', l: 'k', c: 'x' };
  const out = [];

  for (const source of shuffled(cases).slice(0, count)) {
    const letters = source.query.split('');
    const positions = letters
      .map((ch, i) => (KEYS[ch] ? i : -1))
      .filter((i) => i > 0);

    if (!positions.length) continue;

    const at = positions[Math.floor(random() * positions.length)];

    letters[at] = KEYS[letters[at]];

    out.push({ query: letters.join(''), expect: source.expect, bucket: 'typo' });
  }

  return out;
}

// ---- main -----------------------------------------------------------------
function main() {
  const dir = arg('--index', path.join(ROOT, '_site-org'));
  const data = loadContent(dir);

  console.log(
    `[gen] ${data.docs.length} pages, ${data.sections.length} sections, ` +
    `${data.answers.length} answers, ${data.api.length} api records`
  );

  const raw = generate(data);

  // Merge identical strings, accumulating every page that claims them.
  const merged = new Map();

  for (const item of raw) {
    const existing = merged.get(item.query);

    if (existing) {
      if (!existing.expect.includes(item.expect)) existing.expect.push(item.expect);
      existing.buckets.add(item.bucket);
    } else {
      merged.set(item.query, {
        query: item.query,
        expect: [item.expect],
        buckets: new Set([item.bucket]),
      });
    }
  }

  const pageOf = (url) => url.split('#')[0];
  const kept = [];
  let dropped = 0;

  for (const item of merged.values()) {
    // Ambiguity is judged at PAGE level: three headings on one page generating the same
    // string is not ambiguous, it just means the page says it three times.
    if (new Set(item.expect.map(pageOf)).size > MAX_CLAIMS) {
      dropped++;
      continue;
    }

    kept.push({
      query: item.query,
      expect: item.expect,
      bucket: [...item.buckets].sort().join('+'),
    });
  }

  console.log(`[gen] ${raw.length} generated -> ${merged.size} unique -> ${kept.length} kept ` +
    `(${dropped} dropped as claimed by >${MAX_CLAIMS} pages)`);

  // Sample down to COUNT, proportionally across buckets so no single bucket dominates the
  // headline number just because the content happens to yield more of it.
  const byBucket = new Map();

  for (const item of kept) {
    if (!byBucket.has(item.bucket)) byBucket.set(item.bucket, []);
    byBucket.get(item.bucket).push(item);
  }

  let selected = kept;

  if (kept.length > COUNT) {
    selected = [];

    const buckets = [...byBucket.values()].map(shuffled);
    let i = 0;

    while (selected.length < COUNT) {
      let added = 0;

      for (const bucket of buckets) {
        if (i < bucket.length && selected.length < COUNT) {
          selected.push(bucket[i]);
          added++;
        }
      }

      if (!added) break;

      i++;
    }
  }

  const typoCases = typos(selected, Math.round(selected.length * 0.05));

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, `${JSON.stringify({ main: selected, typos: typoCases }, null, 0)}\n`);

  const counts = {};

  for (const item of selected) counts[item.bucket] = (counts[item.bucket] || 0) + 1;

  console.log(`[gen] wrote ${selected.length} queries + ${typoCases.length} typo variants -> ${OUT}`);

  for (const [bucket, n] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
    console.log(`       ${String(n).padStart(5)}  ${bucket}`);
  }
}

main();
