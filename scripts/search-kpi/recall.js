// recall.js — recall@6 for BOTH rankers on one corpus: this site's, and the @imqueue MCP
// server's own.
//
//   node scripts/search-kpi/recall.js [--dir _site-org] [--mcp ../mcp] [--list] [--limit 6]
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
// THE QUERY SLICE is agent-shaped by construction: buckets api-symbol, api-member, api-path,
// keywords, heading and title — "vocabulary the agent has already read". Buckets are compound, so
// a query counts when ANY of its components qualifies; requiring an exact bucket would drop the
// combined ones for no reason.
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

const { load } = require('./lib/harness');

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

// Buckets whose queries are the vocabulary an agent has already read.
const AGENT = new Set(['api-symbol', 'api-member', 'api-path', 'keywords', 'heading', 'title']);

const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));

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

async function main() {
  const ranker = load(DIR);
  const mcp = await mcpRanker();
  const all = readJson(path.join(__dirname, 'data', 'artificial-queries.json')).main;
  const cases = all.filter((c) => String(c.bucket).split('+').some((b) => AGENT.has(b)));

  const expectsOf = (c) => (Array.isArray(c.expect) ? c.expect : [c.expect]).map(orgPage);
  const stat = { site: 0, mcp: 0, both: 0, neither: 0, siteEmpty: 0, mcpEmpty: 0 };
  const regressions = [];

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

    if (mcpAt >= 0) stat.mcp++;
    if (!mcpTop.length) stat.mcpEmpty++;
    if (mcpAt >= 0 && siteHit) stat.both++;
    if (mcpAt < 0 && !siteHit) stat.neither++;

    // The set that matters most: the MCP server answers these today and the switch would lose
    // them. A net gain says nothing about whether an individual answer got worse, so these are
    // enumerated rather than averaged.
    if (mcpAt >= 0 && !siteHit) {
      const deep = siteAll.findIndex((hit) => want.includes(orgPage(hit.record.u)));

      regressions.push({
        query: testCase.query,
        bucket: testCase.bucket,
        expect: want.join(' | '),
        mcpRank: mcpAt + 1,
        // Ranked past the limit and absent from the whole set are different defects: the first is
        // ordering or eviction, the second is retrieval.
        siteRank: deep < 0 ? null : deep + 1,
        siteReturned: siteAll.length,
      });
    }
  }

  const pct = (n) => `${((n / cases.length) * 100).toFixed(1)}%`.padStart(6);

  console.log(`corpus:  site ${ranker.state.t1.records.length} records`
    + `${ranker.state.x1 ? ` + ${ranker.state.x1.records.length} peer` : ' (NO PEER FEED — com half unmeasured)'}`
    + `${mcp ? `   MCP ${mcp.curated.length} curated + ${mcp.symbols.length} symbols` : ''}`);
  console.log(`queries: ${all.length} artificial, ${cases.length} agent-shaped\n`);

  console.log(`  site recall@${LIMIT}   ${pct(stat.site)}     empty ${pct(stat.siteEmpty)}`);

  if (!mcp) {
    console.log(`\n  MCP ranker not scored: ${path.join(MCP, 'dist/docs.js')} is absent.`);
    console.log('  Run `npm run build` in the @imqueue/mcp checkout, or pass --mcp <path>.');

    return;
  }

  console.log(`  MCP  recall@${LIMIT}   ${pct(stat.mcp)}     empty ${pct(stat.mcpEmpty)}`);
  console.log(`  delta          ${(((stat.site - stat.mcp) / cases.length) * 100).toFixed(1)} pts`
    + `     both ${pct(stat.both)}  neither ${pct(stat.neither)}`);
  console.log(`\n  the MCP ranker answers ${regressions.length} that this one does not`);

  if (regressions.length && LIST) {
    console.log('\n  mcp site  query                                   expected');

    for (const r of regressions) {
      const site = r.siteRank !== null ? String(r.siteRank) : r.siteReturned ? '—' : '0res';

      console.log(`  ${String(r.mcpRank).padStart(3)} ${site.padStart(4)}  `
        + `${r.query.slice(0, 38).padEnd(38)}  ${r.expect.slice(0, 60)}`);
    }
  } else if (regressions.length) {
    console.log('  pass --list to enumerate them');
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
