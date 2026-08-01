#!/usr/bin/env node
// check-agent-analytics.js — guards lib/agent-analytics.js and the middleware that
// carries it.
//
// Everything here is offline pure logic, which is why it can live in `npm test`
// alongside check:redirects. It exists because every invariant in that module fails
// SILENTLY when broken:
//
//   * forward the crawler's user-agent and GA4's bot filter discards the entire
//     dataset — no error, just an empty property
//   * start emitting events for ordinary browser page views and the agent property
//     quietly becomes a worse duplicate of the main one
//   * throw anywhere in the middleware and it is not analytics that breaks, it is
//     imqueue.org and imqueue.com
//
// None of those show up in a build log, so they are asserted here instead.
const assert = require('node:assert');

const BROWSER = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36';
const GPTBOT = 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; GPTBot/1.2; +https://openai.com/gptbot';

const u = (p, host = 'imqueue.org') => new URL(`https://${host}${p}`);

let checks = 0;
const ok = (msg) => { checks++; console.log(`  ok    ${msg}`); };

async function main() {
  const { buildEvent, classifyCrawler, classifySurface, trackRequest } =
    await import('../lib/agent-analytics.js');

  // --- rule 2: only what gtag misses ---------------------------------------
  assert.strictEqual(
    buildEvent({ url: u('/tutorial/'), userAgent: BROWSER, status: 200, edition: 'org' }),
    null,
    'a browser reading an HTML page is gtag\'s job and must produce no event',
  );
  ok('browser + HTML page → no event (gtag already measures it)');

  const mirror = buildEvent({ url: u('/tutorial/index.md'), userAgent: BROWSER, status: 200, edition: 'org' });
  assert.ok(mirror, 'the agent surface counts even from an unrecognised client');
  assert.strictEqual(mirror.events[0].params.surface, 'markdown-mirror');
  assert.strictEqual(mirror.events[0].params.crawler, 'unclassified');
  ok('any client + .md mirror → event, surface=markdown-mirror');

  const botHtml = buildEvent({ url: u('/'), userAgent: GPTBOT, status: 200, edition: 'org' });
  assert.ok(botHtml, 'a crawler on an HTML page is invisible to gtag and must be counted');
  assert.strictEqual(botHtml.events[0].params.surface, 'html');
  assert.strictEqual(botHtml.events[0].params.crawler, 'GPTBot');
  assert.strictEqual(botHtml.events[0].params.operator, 'OpenAI');
  ok('crawler + HTML page → event, surface=html (gtag never fires for it)');

  // --- rule 3: the crawler UA must never reach Google ----------------------
  for (const body of [mirror, botHtml]) {
    assert.ok(
      !JSON.stringify(body).includes('Mozilla'),
      'the crawler user-agent must not appear anywhere in the payload — GA4 would '
      + 'bot-filter the hit and the whole dataset would silently vanish',
    );
  }
  ok('no user-agent string anywhere in the payload (GA4 bot filter would drop it)');

  // --- rule 4: identity is a crawler family, never a visitor ---------------
  const a = buildEvent({ url: u('/llms.txt'), userAgent: GPTBOT, status: 200, edition: 'org' });
  const b = buildEvent({ url: u('/api/index.md'), userAgent: GPTBOT, status: 404, edition: 'org' });
  assert.strictEqual(a.client_id, b.client_id, 'same crawler → same client_id');
  const claude = buildEvent({ url: u('/llms.txt'), userAgent: 'ClaudeBot/1.0', status: 200, edition: 'org' });
  assert.notStrictEqual(a.client_id, claude.client_id, 'different crawler → different client_id');
  assert.ok(!/\d+\.\d+\.\d+\.\d+/.test(JSON.stringify(a)), 'no IP-shaped value in the payload');
  ok('client_id is stable per crawler family and carries nothing identifying');

  // --- the fields the reports are built on ---------------------------------
  assert.strictEqual(b.events[0].params.status, '404', 'status is carried, as a string');
  assert.strictEqual(b.events[0].params.page_location, 'https://imqueue.org/api/index.md');
  assert.strictEqual(b.events[0].params.page_title, '/api/index.md');
  assert.strictEqual(b.events[0].name, 'page_view',
    'page_view is what populates GA4\'s built-in Pages reports without custom dimensions');
  assert.strictEqual(b.events[0].params.engagement_time_msec, 1);
  assert.ok(b.events[0].params.session_id, 'a session_id is required or engagement reads as zero');
  ok('page_view + page_location + status + session_id present');

  const com = buildEvent({ url: u('/index.md', 'imqueue.com'), userAgent: GPTBOT, status: 200, edition: 'com' });
  assert.strictEqual(com.events[0].params.edition, 'com');
  ok('edition is carried, so one property can hold both sites');

  // Sessions bucket by half-hour: a crawl burst is a session, and a crawler that
  // comes back tomorrow is not one long visit.
  const t0 = 1_800_000_000_000;
  const s1 = buildEvent({ url: u('/llms.txt'), userAgent: GPTBOT, status: 200, edition: 'org', now: t0 });
  const s2 = buildEvent({ url: u('/llms.txt'), userAgent: GPTBOT, status: 200, edition: 'org', now: t0 + 60_000 });
  const s3 = buildEvent({ url: u('/llms.txt'), userAgent: GPTBOT, status: 200, edition: 'org', now: t0 + 1_900_000 });
  assert.strictEqual(s1.events[0].params.session_id, s2.events[0].params.session_id);
  assert.notStrictEqual(s1.events[0].params.session_id, s3.events[0].params.session_id);
  ok('session_id buckets per half hour (a crawl burst is one session)');

  // --- classifiers ---------------------------------------------------------
  assert.strictEqual(classifyCrawler(BROWSER), null);
  assert.strictEqual(classifyCrawler('').crawler, 'no-user-agent');
  assert.strictEqual(classifyCrawler('node').operator, 'Generic client');
  assert.strictEqual(classifySurface('/blog/topics/rpc/'), null);
  assert.strictEqual(classifySurface('/api/search-index.json'), 'symbol-index');
  assert.strictEqual(classifySurface('/sitemap-api.xml'), 'sitemap');
  ok('classifiers agree on browsers, empty UAs, HTTP clients and each surface');

  // --- rule 5: inert without credentials -----------------------------------
  const req = { headers: { get: () => GPTBOT } };
  assert.strictEqual(
    trackRequest({ request: req, env: {}, url: u('/llms.txt'), status: 200, edition: 'org' }),
    null,
    'with no env vars this must do nothing — a fork or preview deploy sends nothing',
  );
  assert.strictEqual(
    trackRequest({ request: req, env: { GA4_MP_MEASUREMENT_ID: 'G-X' }, url: u('/llms.txt'), status: 200, edition: 'org' }),
    null,
    'half-configured is still inert',
  );
  ok('inert unless BOTH GA4_MP_MEASUREMENT_ID and GA4_MP_API_SECRET are set');

  // --- the middleware contract: always returns, never throws ---------------
  const { onRequest } = await import('../functions/_middleware.js');
  const page = new Response('hi', { status: 200 });
  const ctx = (url, extra = {}) => ({
    request: new Request(url, { headers: { 'user-agent': GPTBOT } }),
    env: {},
    next: async () => page,
    waitUntil: () => {},
    ...extra,
  });

  assert.strictEqual(await onRequest(ctx('https://imqueue.org/llms.txt')), page,
    'the response from next() must be passed through untouched');
  ok('middleware returns next()\'s response unchanged');

  const moved = await onRequest(ctx('https://imqueue.net/tutorial/'));
  assert.strictEqual(moved.status, 301);
  assert.strictEqual(moved.headers.get('location'), 'https://imqueue.org/tutorial/');
  ok('imqueue.net still 301s onto imqueue.org');

  // Constraint 1 in functions/_middleware.js: this file runs in front of every
  // request to BOTH sites, so a throw here is an outage. A context missing
  // waitUntil is the cheapest way to simulate the runtime not behaving as expected.
  //
  // This is the ONLY assertion that reaches the send path, and global fetch is
  // stubbed for it. Not tidiness: trackRequest starts the fetch BEFORE the caller
  // touches waitUntil, so without the stub this suite POSTs to Google on every
  // `npm test`, every pre-commit and every CI run — which contradicts the "offline
  // pure logic" claim at the top of this file and litters a stranger's property with
  // junk hits. Stubbing also makes the assertion stronger: the endpoint gets checked
  // without anyone being contacted.
  const realFetch = globalThis.fetch;
  const sends = [];
  globalThis.fetch = (target) => {
    sends.push(String(target));

    return Promise.resolve(new Response('{}'));
  };

  let broken;
  try {
    broken = await onRequest({
      request: new Request('https://imqueue.org/llms.txt'),
      env: { GA4_MP_MEASUREMENT_ID: 'G-X', GA4_MP_API_SECRET: 's' },
      next: async () => page,
      // no waitUntil at all
    });
  } finally {
    globalThis.fetch = realFetch;
  }

  assert.strictEqual(broken, page, 'a broken analytics path must still serve the page');
  ok('analytics failure degrades to "no measurement", never to "no page"');

  assert.strictEqual(sends.length, 1, 'exactly one send per tracked request');
  assert.ok(
    sends[0].startsWith('https://www.google-analytics.com/mp/collect?'),
    `the send must go to GA4's collect endpoint, got: ${sends[0].split('?')[0]}`,
  );
  ok('one send, to GA4\'s collect endpoint (verified without a network call)');

  console.log(`\nAll ${checks} agent-analytics checks passed.`);
}

main().catch((err) => {
  console.error(`\nFAIL  ${err.message}`);
  process.exit(1);
});
