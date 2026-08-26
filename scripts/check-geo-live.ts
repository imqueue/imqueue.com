#!/usr/bin/env node
// check-geo-live.ts — probes the DEPLOYED sites for the things only the edge can
// get wrong.
//
//   node scripts/check-geo-live.ts              # both editions
//   node scripts/check-geo-live.ts org          # one
//
// NOT part of `npm test`. It needs the network and it tests production, so a
// transient DNS failure must never fail a commit. Run it after a deploy, or on a
// schedule.
//
// Everything here is invisible to a build-time check by construction: the build
// produces `_headers` and `_redirects` as TEXT, and whether Cloudflare honours them
// is a different question. Each assertion below corresponds to something that was
// wrong or nearly wrong on 2026-08-03:
//
//   * Cloudflare's Email Obfuscation was rewriting the only published contact
//     address into a JS-decoded `__cf_email__` span on 100% of the HTML of both
//     zones. A repo cannot see that; it is a dashboard toggle.
//   * robots.txt was served with `max-age=14400` — Cloudflare Pages' default, not
//     ours — so a robots change takes four hours to reach a crawler.
//   * The markdown mirrors' `content-type` and the deliberate `X-Robots-Tag:
//     noindex` on them are edge behaviour, and the mirrors are the artefact this
//     site asks agents to read.
//   * AI crawler parity: a UA-based difference in what is served is the single
//     worst thing that can happen to this programme, and it can be introduced by a
//     WAF rule nobody in the repo knows about.
//   * The agent-analytics middleware announces its own decisions in
//     `x-agent-analytics`, which makes "is measurement live" one probe instead of a
//     tour of dashboards.
//
// Exits non-zero on any failure.

const EDITIONS: Record<string, string | undefined> = {
  org: 'https://imqueue.org',
  com: 'https://imqueue.com',
};

const only = process.argv[2] ?? '';
const targets: Record<string, string | undefined> =
  only ? { [only]: EDITIONS[only] } : EDITIONS;

if (only && !EDITIONS[only]) {
  console.error(`Unknown edition "${only}". Use org or com.`);
  process.exit(2);
}

let failures = 0;
const fail = (msg: string): void => { failures++; console.error(`  FAIL  ${msg}`); };
const pass = (msg: string): void => console.log(`  ok    ${msg}`);
const warn = (msg: string): void => console.log(`  warn  ${msg}`);

const UA_BROWSER =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0 Safari/537.36';
const AI_UAS = [
  'Mozilla/5.0 (compatible; GPTBot/1.2; +https://openai.com/gptbot)',
  'Mozilla/5.0 (compatible; ClaudeBot/1.0; +claudebot@anthropic.com)',
  'Mozilla/5.0 (compatible; PerplexityBot/1.0; +https://perplexity.ai/perplexitybot)',
  'Mozilla/5.0 (compatible; OAI-SearchBot/1.0; +https://openai.com/searchbot)',
  'CCBot/2.0 (https://commoncrawl.org/faq/)',
];

async function get(
  url: string,
  ua: string = UA_BROWSER,
  method: string = 'GET',
): Promise<{ status: number; headers: Headers; body: string }> {
  const res = await fetch(url, { method, headers: { 'user-agent': ua }, redirect: 'manual' });
  const body = method === 'GET' ? await res.text() : '';

  return { status: res.status, headers: res.headers, body };
}

async function checkEdition(edition: string, origin: string): Promise<void> {
  console.log(`\n${edition} (${origin}):`);

  // ---- the agent surface is reachable and correctly typed -----------------
  const TYPED: ReadonlyArray<readonly [string, string]> = [
    ['/llms.txt', 'text/plain'],
    ['/llms-full.txt', 'text/plain'],
    ['/index.md', 'text/markdown'],
    ['/robots.txt', 'text/plain'],
  ];

  for (const [path, type] of TYPED) {
    const res = await get(origin + path);

    if (res.status !== 200) {
      fail(`${path} returned ${res.status}`);
      continue;
    }

    const ct = res.headers.get('content-type') || '';

    if (!ct.includes(type)) {
      fail(`${path} is served as "${ct}", expected ${type}`);
    } else {
      pass(`${path} 200 ${ct}`);
    }
  }

  // ---- the agent surface must be cheap to correct -------------------------
  // Cloudflare Pages' default for a static asset is max-age=14400, so a correction
  // takes four hours to reach a crawler. src/headers.liquid overrides it; only the
  // edge can say whether the override took.
  //
  // Two different severities on purpose:
  //
  //   llms.txt / mirrors — HARD FAIL. The rule demonstrably works for these, so a
  //     regression here is a real one.
  //   robots.txt        — WARNING. Verified 2026-08-03: Cloudflare Pages does not
  //     apply _headers to /robots.txt at all, and no repo change can make it (see
  //     the long note in src/headers.liquid for what was ruled out). Failing on it
  //     every run would train the reader to ignore this whole script; the honest
  //     report is a standing warning with the one lever that would fix it named.
  {
    const lifetime = async (path: string): Promise<{ cc: string; seconds: number | null }> => {
      const cc = (await get(origin + path)).headers.get('cache-control') || '';
      const m = /max-age=(\d+)/.exec(cc);

      return { cc, seconds: m?.[1] === undefined ? null : Number(m[1]) };
    };

    for (const path of ['/llms.txt', '/llms-full.txt', '/index.md']) {
      const { cc, seconds } = await lifetime(path);

      if (seconds === null) {
        warn(`${path} has no max-age (cache-control: "${cc}")`);
      } else if (seconds > 600) {
        fail(`${path} is cached for ${seconds}s — the ingestion surface is regenerated every deploy`);
      } else {
        pass(`${path} max-age=${seconds}`);
      }
    }

    const robots = await lifetime('/robots.txt');

    if (robots.seconds !== null && robots.seconds > 600) {
      warn(
        `robots.txt is cached for ${robots.seconds}s — Cloudflare Pages ignores _headers for this path. `
        + 'Only a zone Cache Rule (Browser TTL) can change it; see src/headers.liquid.',
      );
    } else {
      pass(`robots.txt max-age=${robots.seconds}`);
    }
  }

  // ---- THE CONTACT ADDRESS SURVIVES -------------------------------------
  // Cloudflare Email Obfuscation. Measured 2026-08-03 under a GPTBot UA:
  // `__cf_email__` spans on imqueue.org/support/ and imqueue.com/pricing/, with
  // ZERO occurrences of the literal address in the HTML of either zone.
  //
  // DISABLED on both zones 2026-08-25, and this check has passed since. It stays
  // because it is a per-zone dashboard toggle: nothing in the repo can prevent it
  // coming back, and a new zone starts with it ON. Note the setting has MOVED —
  // it is no longer under Scrape Shield, which is where this message used to send
  // people. It is now Security -> Settings, filtered by "Client-side abuse".
  //
  // Probing ONE page per zone was not enough, and 2026-08-25 is how we found out.
  // The toggle rewrites every address-shaped string in every HTML response, and the
  // contact page is the least damaging place it lands. The expensive places are the
  // ones nothing probed:
  //
  //   * /tutorial/deployment/ publishes six SSH clone commands as
  //     `git clone [email protected]:imqueue-sandbox/api.git`. A reader who
  //     copies one gets a command that cannot work, and an SSH URL cannot be
  //     written without an address, so no content change can avoid it.
  //   * A hero illustration is worse still: an <a> injected into an inline SVG's
  //     <text> is not positioned SVG text, so it reflows and displaces every
  //     element after it. /blog/runtime-validation-typescript-services/ shipped
  //     that way and the drawing came apart on production while rendering
  //     perfectly on localhost.
  //
  // So the probe set now includes a page from each family that got hurt. The
  // source-side guard is scripts/check-email-literals.ts, which runs in `npm test`
  // and cannot see the toggle; this is the half that can.
  {
    const pages = edition === 'org'
      ? ['/support/', '/tutorial/deployment/', '/blog/runtime-validation-typescript-services/']
      : ['/pricing/'];
    const contactPage = edition === 'org' ? '/support/' : '/pricing/';
    let obfuscated = 0;
    let literal = false;

    for (const page of pages) {
      const res = await get(origin + page, AI_UAS[0]);
      const n = (res.body.match(/__cf_email__/g) || []).length;

      obfuscated += n;
      if (page === contactPage) literal = res.body.includes('support@imqueue.com');
      if (n) {
        fail(`${page} has ${n} __cf_email__ span(s) — Cloudflare Email Obfuscation is ON for this zone (dashboard -> the zone -> Security -> Settings -> filter "Client-side abuse" -> Email Address Obfuscation -> Off)`);
      }
    }

    if (!literal) {
      fail(`${contactPage} contains no literal contact address that a non-JS crawler can read`);
    }
    if (!obfuscated && literal) {
      pass(`${pages.length} page(s) carry no __cf_email__, and ${contactPage} serves the literal contact address to a crawler`);
    }

    // The JSON-LD copy is the belt-and-braces half and must hold either way.
    const home = await get(`${origin}/`, AI_UAS[0]);

    if (!/"email"\s*:\s*"support@imqueue\.com"/.test(home.body)) {
      fail('the home page Organization node has no readable email');
    } else {
      pass('Organization JSON-LD carries the address (obfuscation cannot reach a <script>)');
    }
  }

  // ---- the mirrors are typed, cached and deliberately noindex ------------
  {
    const res = await get(`${origin}/index.md`);
    const ct = res.headers.get('content-type') || '';
    const robots = res.headers.get('x-robots-tag') || '';

    if (res.status !== 200) {
      // Reported once, and nothing below it is meaningful: a 404's content-type and
      // X-Robots-Tag describe the error page, not a mirror.
      fail(`/index.md returned ${res.status} — the home page has no markdown mirror`);
    } else if (!ct.includes('text/markdown')) {
      fail(`/index.md content-type is "${ct}"`);
    } else if (!robots.includes('noindex')) {
      // noindex on the mirrors is DELIBERATE and documented in src/headers.liquid:
      // duplicate-content hygiene, the HTML page being canonical. Asserted so it
      // stays a decision rather than becoming a drift — in either direction.
      warn('/index.md has no X-Robots-Tag: noindex — src/headers.liquid intends one (duplicate-content hygiene)');
    } else {
      pass('/index.md: text/markdown + the intended X-Robots-Tag: noindex');
    }
  }

  // ---- AI crawler parity -------------------------------------------------
  // A UA-based difference in what is served is the worst single failure available
  // to this programme, and a WAF or rate-limiting rule can introduce it without any
  // repo change. Compares status AND body length against a browser.
  {
    const paths = ['/', '/llms.txt', '/index.md'];
    let mismatches = 0;

    for (const path of paths) {
      const base = await get(origin + path, UA_BROWSER);

      for (const ua of AI_UAS) {
        const res = await get(origin + path, ua);
        const name = /([A-Za-z-]+Bot|CCBot|GPTBot)/.exec(ua);
        const label = name ? name[1] : ua.slice(0, 20);

        if (res.status !== base.status) {
          mismatches++;
          fail(`${path} returns ${res.status} to ${label} but ${base.status} to a browser`);
        } else if (res.body.length !== base.body.length) {
          mismatches++;
          fail(`${path} serves ${res.body.length} bytes to ${label} but ${base.body.length} to a browser`);
        }
      }
    }
    if (!mismatches) {
      pass(`${paths.length} paths x ${AI_UAS.length} AI crawlers: byte-identical to a browser`);
    }
  }

  // ---- measurement is live ----------------------------------------------
  // The middleware states its own decision in a header, which is the only way to
  // tell "never sent" from "sent and rejected" from "sent to a property you are not
  // looking at" without touching a dashboard.
  {
    const res = await get(`${origin}/llms.txt`, AI_UAS[0]);
    const note = res.headers.get('x-agent-analytics');

    if (!note) {
      fail('no x-agent-analytics header on /llms.txt — the middleware is not running');
    } else if (!note.startsWith('sent ')) {
      fail(`x-agent-analytics says "${note}" — measurement is not active`);
    } else {
      const fields = Object.fromEntries(
        note.split(/\s+/).slice(1).map((kv) => kv.split('=')),
      );

      if (fields.salt !== 'set') {
        fail(`VISITOR_SALT is ${fields.salt} on this project — browsers are counted as nothing`);
      }
      if (fields.kind !== 'ai.training') {
        fail(`GPTBot classified as kind=${fields.kind}, expected ai.training`);
      }
      if (fields.edition !== edition) {
        fail(`this deployment reports edition=${fields.edition} — the Pages projects may be crossed`);
      }
      if (fields.salt === 'set' && fields.kind === 'ai.training' && fields.edition === edition) {
        pass(`x-agent-analytics: ${note}`);
      }
    }

    // The referrer classifier, which is the one part an operator can exercise by
    // hand. `ai=perplexity` proves a citation click would be attributed.
    const ref = await fetch(`${origin}/llms.txt`, {
      headers: { 'user-agent': AI_UAS[0], referer: 'https://www.perplexity.ai/search/x' },
    });
    const refNote = ref.headers.get('x-agent-analytics') || '';

    if (!/\bai=perplexity\b/.test(refNote)) {
      fail(`a Perplexity referrer was classified as "${/ai=\S+/.exec(refNote) || 'nothing'}" — AI citation clicks are not being attributed`);
    } else {
      pass('a Perplexity referrer is attributed as ai=perplexity');
    }
  }

  // ---- llms.txt links actually resolve ----------------------------------
  // The build-time check-llms.ts asserts every listed URL has a built file; this
  // asserts the deployed site serves it. Sampled, not exhaustive — 106 requests
  // against production is rude, and a 404 is systemic rather than per-URL.
  {
    const text = (await get(`${origin}/llms.txt`)).body;
    const urls = [...text.matchAll(/\]\((https:\/\/[^)]+)\)/g)]
      .map((m) => m[1] ?? '')
      .filter((u) => u.startsWith(origin));
    const step = Math.max(1, Math.floor(urls.length / 12));
    const sample = urls.filter((_, i) => i % step === 0).slice(0, 12);
    let bad = 0;

    for (const url of sample) {
      const res = await get(url, AI_UAS[0], 'HEAD');

      if (res.status >= 400) {
        bad++;
        fail(`${url} is in llms.txt and returns ${res.status} live`);
      }
    }
    if (!bad) pass(`sampled ${sample.length} of ${urls.length} llms.txt URLs, all live`);
  }
}

(async () => {
  for (const [edition, origin] of Object.entries(targets)) {
    if (!origin) continue;

    try {
      await checkEdition(edition, origin);
    } catch (err) {
      fail(`${edition}: probe failed — ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (failures) {
    console.error(`\n${failures} live GEO check(s) failed.`);
    process.exit(1);
  }
  console.log('\nAll live GEO checks passed.');
})();
