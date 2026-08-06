// recall.js — recall@6 for BOTH rankers on one corpus: this site's, and the @imqueue MCP
// server's own.
//
//   node scripts/search-kpi/recall.js [--dir _site-org] [--mcp ../mcp] [--list] [--limit 6]
//                                     [--set agent|question|intent] [--ref <commit>]
//
// WHY A SECOND SCRIPT, next to measure.js. measure.js scores what a person sees: position 1 is
// worth 100 and every row below costs 10. That is the right question for a human, who mostly
// reads the first result. It is the wrong question for an agent, which is handed six results by
// search_docs and reads all six — there, whether the page is IN the set is everything and its
// rank inside the set is noise. So this reports recall@6 and nothing decayed.
//
// WHY IT SCORES THE MCP RANKER TOO. The plan this belongs to proposes replacing the MCP server's
// ranker (rankEntries in its docs.ts) with this site's. "Did that help?" has no answer unless both
// are scored on the same queries over the same corpus, which is what this does. Its corpus is
// built to match loadIndex() + loadApiIndex() exactly: llms.txt from both editions, plus
// /api/search-index.json. Get that wrong and the comparison measures the harness.
//
// THE DEFAULT QUERY SLICE is agent-shaped by construction: buckets api-symbol, api-member,
// api-path, keywords, heading and title — "vocabulary the agent has already read". Buckets are
// compound, so a query counts when ANY of its components qualifies; requiring an exact bucket
// would drop the combined ones for no reason.
//
// `--set` SCORES THE OTHER TWO POPULATIONS, and that is not a convenience — it settles the
// question this comparison was built for and then answered too narrowly. The switch measured
// +15.6 points of recall@6 on the slice above and was still not delivered, because two
// hand-written assertions in the MCP server's smoke test noticed that chat-shaped questions got
// WORSE (73.3% → 65.8%, over twelve cases). Twelve cases cannot carry a delivery decision, and
// the two labelled sets that can did not exist yet. They do now:
//
//   --set agent      the slice above: ~3,400 generated identifier queries (the default)
//   --set question   115 chat-shaped questions over 18 topics, hand-labelled from the inventory
//   --set intent     19 queries really sent to search_docs while building an app — HIGH
//                    IMPORTANCE, and the only set that measures what a miss COSTS an agent
//
// Both labelled sets carry a topic per query, so those runs also print recall@6 per topic for
// both rankers. A ranker can be even on the average and blind on one topic, which is exactly
// the failure the twelve-case sample stumbled into.
//
// SCORING THE MCP SIDE NEEDS ITS OLD RANKER, which no longer exists on its branch: Phase 2
// replaced `rankEntries` with the shared one, so a build of `search/shared-ranker` would have
// this script compare the site ranker against itself and report a dead heat. Point `--mcp` at a
// checkout of the MCP server's `main`:
//
//   git -C ../mcp worktree add /tmp/mcp-main main
//   ln -s "$PWD/../mcp/node_modules" /tmp/mcp-main/node_modules
//   npm --prefix /tmp/mcp-main run build
//   node scripts/search-kpi/recall.js --set question --mcp /tmp/mcp-main --list
//
// It says so rather than guessing: an absent `rankEntries` export is a hard error naming this
// cause, because silently measuring nothing is the one outcome a decision cannot survive.
//
// REPRODUCIBILITY. --dir takes a frozen snapshot of the feeds. Measuring the live _site-org means
// the corpus moves under the experiment and a delta between two runs means nothing. Freeze before
// quoting a number as a baseline:
//
//   npm run build:org && cp -r _site-org /tmp/kpi-snapshot
//   node scripts/search-kpi/recall.js --dir /tmp/kpi-snapshot
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const { load, baseline } = require('./lib/harness');
const { verdict } = require('./lib/stats.js');

const ROOT = path.join(__dirname, '..', '..');

const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);

  return i === -1 ? fallback : process.argv[i + 1];
};

const DIR = arg('--dir', path.join(ROOT, '_site-org'));
const COM_DIR = arg('--com-dir', path.join(ROOT, '_site-com'));
const MCP = arg('--mcp', path.join(ROOT, '..', 'mcp'));
const LIMIT = Number(arg('--limit', 6));
const LIST = process.argv.includes('--list');
const SET = arg('--set', 'agent');
const REF = arg('--ref', null);

// Buckets whose queries are the vocabulary an agent has already read.
const AGENT = new Set(['api-symbol', 'api-member', 'api-path', 'keywords', 'heading', 'title']);

const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));

const data = (name) => readJson(path.join(__dirname, 'data', name));

/**
 * The query population to score. Returns the cases plus the line describing where they came
 * from, because a recall number without its population attached is unreadable six weeks later.
 *
 * `total` is separate from `cases.length` for the agent slice only, where the file holds ~10,000
 * queries and this script scores the agent-shaped third of them.
 */
function setOf(name) {
  if (name === 'question') {
    const file = data('question-queries.json');

    return { cases: file.queries, total: file.queries.length, note: '115 chat-shaped questions' };
  }

  if (name === 'intent') {
    const file = data('intent-queries.json');

    return {
      cases: file.queries,
      total: file.queries.length,
      note: 'real search_docs calls from building an app — HIGH IMPORTANCE',
    };
  }

  if (name !== 'agent') {
    console.error(`Unknown --set \`${name}\`. Expected agent, question or intent.`);
    process.exit(1);
  }

  // artificial-queries.json is gitignored and regenerated, so an absent file is a missing step
  // rather than a broken checkout — say which step.
  const file = path.join(__dirname, 'data', 'artificial-queries.json');

  if (!fs.existsSync(file)) {
    console.error(`${file} is missing — run \`npm run kpi:search:gen\` first.`);
    process.exit(1);
  }

  const all = readJson(file).main;

  return {
    cases: all.filter((c) => String(c.bucket).split('+').some((b) => AGENT.has(b))),
    total: all.length,
    note: `${all.length} artificial, agent-shaped only`,
  };
}

// Page-level and host-aware. The site ranker returns relative URLs and flags peer hits
// `external`; the MCP ranker returns absolute ones. Both collapse onto "the same org page", and a
// peer URL keeps an `@host` prefix so it can never silently satisfy an imqueue.org expectation.
const orgPage = (url) => String(url)
  .replace(/^https?:\/\/([^/]+)/, (_, host) => (host === 'imqueue.org' ? '' : `@${host}`))
  .split('#')[0];

const isOrg = (url) => !orgPage(url).startsWith('@');

/**
 * The MCP server's corpus, replicating loadIndex() + loadApiIndex() from its docs.ts.
 *
 * Returns null when the sibling checkout is absent or unbuilt: the site half is still worth
 * measuring alone, and a missing peer repo is not an error worth failing a KPI run over.
 */
async function mcpRanker() {
  const dist = path.join(MCP, 'dist', 'docs.js');

  if (!fs.existsSync(dist)) {
    return null;
  }

  const { parseLlmsTxt, rankEntries } = await import(dist);

  // A build of the MCP server's own `search/shared-ranker` branch exports `rankCorpus`, not
  // `rankEntries` — Phase 2 replaced the ranker being measured with the one it is measured
  // against. Left to itself this script would then compare the site ranker with the site ranker
  // and print a flawless dead heat, which is the most convincing wrong answer available.
  if (typeof rankEntries !== 'function') {
    console.error(`${dist} exports no rankEntries().`);
    console.error('  That build already uses the shared ranker, so there is nothing to compare.');
    console.error('  Point --mcp at a checkout of the server\'s `main` — see the header of this file.');
    process.exit(1);
  }

  const curated = parseLlmsTxt(fs.readFileSync(path.join(DIR, 'llms.txt'), 'utf8'));
  const seen = new Set(curated.map((e) => e.url));
  const comLlms = path.join(COM_DIR, 'llms.txt');

  if (fs.existsSync(comLlms)) {
    // The suffix matches the server's: both editions have a "Commercial" heading meaning
    // different things, and a result's section is what a caller reads to tell them apart.
    for (const entry of parseLlmsTxt(fs.readFileSync(comLlms, 'utf8'), ' · imqueue.com')) {
      if (!seen.has(entry.url)) {
        curated.push(entry);
        seen.add(entry.url);
      }
    }
  }

  const symbols = readJson(path.join(DIR, 'api', 'search-index.json'))
    .filter((s) => s && typeof s.name === 'string' && typeof s.url === 'string')
    .map((s) => ({
      title: s.name,
      url: `https://imqueue.org${s.url}`,
      description: s.deprecated
        ? `DEPRECATED — do not use in new code. ${s.summary || ''}`.trim()
        : s.summary || '',
      section: `API · ${s.package || '@imqueue'}${s.kind ? ` ${s.kind}` : ''}`,
      symbol: true,
    }));

  return {
    curated,
    symbols,
    search: (query) => rankEntries(curated, symbols, query, LIMIT).filter((e) => isOrg(e.url)),
  };
}

function siteSearch(ranker, query) {
  try {
    return ranker.search(ranker.parseQuery(query)).filter((hit) => !hit.external);
  } catch {
    return [];
  }
}

/** recall@LIMIT per topic for both rankers, weakest first — only for the labelled sets. */
function byTopic(rows) {
  const groups = new Map();

  for (const row of rows) {
    const key = row.label || '(unlabelled)';

    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }

  return [...groups.entries()]
    .map(([label, list]) => ({
      label,
      n: list.length,
      site: (list.filter((r) => r.siteHit).length / list.length) * 100,
      mcp: (list.filter((r) => r.mcpHit).length / list.length) * 100,
    }))
    .sort((a, b) => (a.site - a.mcp) - (b.site - b.mcp) || a.site - b.site);
}

async function main() {
  const ranker = load(DIR, REF ? baseline(REF) : undefined);
  const mcp = await mcpRanker();
  const { cases, note } = setOf(SET);
  const labelled = SET !== 'agent';

  const expectsOf = (c) => (Array.isArray(c.expect) ? c.expect : [c.expect]).map(orgPage);
  const stat = { site: 0, mcp: 0, both: 0, neither: 0, siteEmpty: 0, mcpEmpty: 0 };
  const rows = [];
  const regressions = [];
  const gains = [];

  for (const testCase of cases) {
    const want = expectsOf(testCase);
    const siteAll = siteSearch(ranker, testCase.query);
    const siteTop = siteAll.slice(0, LIMIT);
    const siteHit = siteTop.some((hit) => want.includes(orgPage(hit.record.u)));

    if (siteHit) stat.site++;
    if (!siteTop.length) stat.siteEmpty++;

    if (!mcp) continue;

    const mcpTop = mcp.search(testCase.query);
    const mcpAt = mcpTop.findIndex((entry) => want.includes(orgPage(entry.url)));
    const mcpHit = mcpAt >= 0;

    if (mcpHit) stat.mcp++;
    if (!mcpTop.length) stat.mcpEmpty++;
    if (mcpHit && siteHit) stat.both++;
    if (!mcpHit && !siteHit) stat.neither++;

    rows.push({ label: testCase.label, siteHit, mcpHit });

    const deep = () => {
      const at = siteAll.findIndex((hit) => want.includes(orgPage(hit.record.u)));

      return at < 0 ? null : at + 1;
    };

    // The set that matters most: the MCP server answers these today and the switch would lose
    // them. A net gain says nothing about whether an individual answer got worse, so these are
    // enumerated rather than averaged.
    if (mcpHit && !siteHit) {
      regressions.push({
        query: testCase.query,
        label: testCase.label || testCase.bucket,
        expect: want.join(' | '),
        mcpRank: mcpAt + 1,
        // Ranked past the limit and absent from the whole set are different defects: the first is
        // ordering or eviction, the second is retrieval.
        siteRank: deep(),
        siteReturned: siteAll.length,
      });
    }

    // And the other direction, which the agent slice never needed to see: there the switch lost
    // 69 queries and won 552, so only the losses were in doubt. On a set where the two rankers
    // trade blows, "what does the switch WIN" is half the decision.
    if (siteHit && !mcpHit) {
      gains.push({
        query: testCase.query,
        label: testCase.label || testCase.bucket,
        expect: want.join(' | '),
        siteRank: deep(),
      });
    }
  }

  const pct = (n) => `${((n / cases.length) * 100).toFixed(1)}%`.padStart(6);

  console.log(`corpus:  site ${ranker.state.t1.records.length} records`
    + `${ranker.state.x1 ? ` + ${ranker.state.x1.records.length} peer` : ' (NO PEER FEED — com half unmeasured)'}`
    + `${mcp ? `   MCP ${mcp.curated.length} curated + ${mcp.symbols.length} symbols` : ''}`);
  console.log(`ranker:  ${REF ? `site @ ${REF}` : 'site @ working tree'}`
    + `${mcp ? `   MCP @ ${MCP}` : ''}`);
  console.log(`queries: ${SET} — ${note} (n = ${cases.length})\n`);

  console.log(`  site recall@${LIMIT}   ${pct(stat.site)}     empty ${pct(stat.siteEmpty)}`);

  if (!mcp) {
    console.log(`\n  MCP ranker not scored: ${path.join(MCP, 'dist/docs.js')} is absent.`);
    console.log('  Run `npm run build` in the @imqueue/mcp checkout, or pass --mcp <path>.');

    return;
  }

  console.log(`  MCP  recall@${LIMIT}   ${pct(stat.mcp)}     empty ${pct(stat.mcpEmpty)}`);
  console.log(`  delta          ${(((stat.site - stat.mcp) / cases.length) * 100).toFixed(1)} pts`
    + `     both ${pct(stat.both)}  neither ${pct(stat.neither)}`);

  // Paired, over the SAME queries, so the significance test is the right one: each query
  // contributes site-hit minus mcp-hit in points, and 100 identical queries with 3 disagreements
  // is not evidence however large the two averages look.
  console.log(`  paired         ${verdict(rows.map((r) => (r.siteHit ? 100 : 0) - (r.mcpHit ? 100 : 0))).line}`);

  if (labelled) {
    console.log('\n  recall@6 per topic, worst delta first');

    for (const row of byTopic(rows)) {
      const delta = row.site - row.mcp;

      console.log(`    ${row.label.padEnd(20)} n=${String(row.n).padStart(2)}  `
        + `site ${row.site.toFixed(0).padStart(3)}%  MCP ${row.mcp.toFixed(0).padStart(3)}%  `
        + `${delta > 0 ? '+' : ''}${delta.toFixed(0)}`);
    }
  }

  console.log(`\n  the MCP ranker answers ${regressions.length} that this one does not`);
  console.log(`  this one answers ${gains.length} that the MCP ranker does not`);

  if (!LIST) {
    if (regressions.length || gains.length) console.log('\n  pass --list to enumerate them');

    return;
  }

  if (regressions.length) {
    console.log('\n  LOST by the switch');
    console.log('  mcp site  query                                   expected');

    for (const r of regressions) {
      const site = r.siteRank !== null ? String(r.siteRank) : r.siteReturned ? '—' : '0res';

      console.log(`  ${String(r.mcpRank).padStart(3)} ${site.padStart(4)}  `
        + `${r.query.slice(0, 38).padEnd(38)}  ${r.expect.slice(0, 60)}`);
    }
  }

  if (gains.length) {
    console.log('\n  WON by the switch');
    console.log('  site      query                                   expected');

    for (const r of gains) {
      console.log(`  ${String(r.siteRank).padStart(3)}       `
        + `${r.query.slice(0, 38).padEnd(38)}  ${r.expect.slice(0, 60)}`);
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
