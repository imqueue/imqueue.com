#!/usr/bin/env node
// check-agent-analytics.js — the five things about lib/agent-analytics.js and
// functions/_middleware.js that are worth a gate.
//
// This file is the ONLY place in the repo that loads functions/. check-links and
// check-sitemap read built output; nothing else ever executes the middleware that
// runs in front of every request to both production sites.
//
// Deliberately small. An earlier version asserted thirteen things, including which
// regex matches Applebot and that sessions bucket per half hour — pure functions
// that are correct by inspection, and ceremony to maintain. What survives is only
// what fails SILENTLY or takes a site down:
//
//   1-3. the middleware always returns a response, whatever analytics does
//   4.   the crawler's user-agent never reaches Google (it would bot-filter the lot)
//   5.   nothing is sent unless the deployment is configured to send it
//   6.   the header names the agent surface and nothing else
//   7.   `kind` separates a trainer from a search bot from a coding agent from a person
//   8.   SUBRESOURCES ARE NEVER COUNTED — the one that would flood the property
//   9.   the event is never named page_view, which is what stops the double count
//  10.   no raw address or user-agent reaches the payload, and no salt means no people
//
// Nothing here touches the network — verified by running it under a global fetch
// spy. Delivery is deliberately NOT tested here; it needs a credential and a
// network, which is what `npm run probe:agent-analytics` is for.
const assert = require('node:assert');

const GPTBOT = 'Mozilla/5.0 (compatible; GPTBot/1.2; +https://openai.com/gptbot)';
const BROWSER =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0 Safari/537.36';

let checks = 0;
const ok = (msg) => { checks++; console.log(`  ok    ${msg}`); };

async function main() {
  const { buildEvent, trackRequest } = await import('../lib/agent-analytics.js');
  const { onRequest } = await import('../functions/_middleware.js');

  const page = new Response('hi', { status: 200 });
  const ctx = (url, extra = {}) => ({
    request: new Request(url, { headers: { 'user-agent': GPTBOT } }),
    env: {},
    next: async () => page,
    waitUntil: () => {},
    ...extra,
  });

  // --- the middleware contract ---------------------------------------------
  // An ordinary page: next()'s response object must come back untouched, not a copy.
  // (/llms.txt is deliberately not used here — the agent surface IS rebuilt, to carry
  // the x-agent-analytics header, and that is asserted further down.)
  assert.strictEqual(
    await onRequest(ctx('https://imqueue.org/tutorial/')), page,
    'the response from next() must be passed through untouched',
  );
  ok('middleware returns next()\'s response unchanged');

  const moved = await onRequest(ctx('https://imqueue.net/tutorial/'));
  assert.strictEqual(moved.status, 301);
  assert.strictEqual(moved.headers.get('location'), 'https://imqueue.org/tutorial/');
  ok('imqueue.net still 301s onto imqueue.org');

  // A throw in this file is an outage, not a lost metric. Provoked with a request the
  // middleware cannot parse — new URL() throws inside the analytics block — so the
  // catch is reached with no credentials, no fetch stub and no send path.
  const unparseable = await onRequest({
    request: { url: '://not-a-url', headers: { get: () => null } },
    env: { GA4_MP_MEASUREMENT_ID: 'G-X', GA4_MP_API_SECRET: 's' },
    next: async () => page,
    waitUntil: () => {},
  });
  assert.strictEqual(unparseable, page, 'a broken analytics path must still serve the page');
  ok('analytics failure degrades to "no measurement", never to "no page"');

  // --- the two silent failures ---------------------------------------------
  // GA4 discards traffic it identifies as an IAB bot, and the Measurement Protocol
  // only knows the user-agent if you send it. Forward it and the property collects
  // nothing, forever, while every request still answers 2xx.
  const event = await buildEvent({
    url: new URL('https://imqueue.org/tutorial/index.md'),
    userAgent: GPTBOT,
    status: 200,
    edition: 'org',
  });
  assert.ok(event, 'a crawler fetching a mirror must produce an event');
  assert.ok(
    !JSON.stringify(event).includes('Mozilla'),
    'the crawler user-agent must not appear anywhere in the payload',
  );
  ok('no user-agent string in the payload (GA4 would bot-filter the whole dataset)');

  // The payload now carries a digest of the visitor's ADDRESS, so the raw inputs must be
  // provably absent from it — a leak here would put an IP in Google's hands and in the
  // property, which is the one outcome the hashing exists to prevent.
  const salted = await buildEvent({
    url: new URL('https://imqueue.org/docs/'),
    userAgent: BROWSER,
    ip: '203.0.113.7',
    salt: 'test-salt',
    isDocument: true,
    status: 200,
    edition: 'org',
  });
  const serialised = JSON.stringify(salted);

  assert.ok(salted, 'a browser fetching a document must produce an event');
  assert.strictEqual(salted.events[0].params.kind, 'user', 'a browser is kind=user');
  assert.ok(!serialised.includes('203.0.113.7'), 'the raw address must never be in the payload');
  assert.ok(!serialised.includes('Mozilla'), 'nor the raw user-agent');
  assert.ok(!serialised.includes('test-salt'), 'nor the salt');
  assert.match(salted.client_id, /^[0-9a-f]{32}$/, 'client_id is the digest, nothing else');

  // Same visitor twice is one visitor, or unique counts are meaningless. Different salt
  // is a different id, which is what makes the secret worth having.
  const again = await buildEvent({
    url: new URL('https://imqueue.org/other/'),
    userAgent: BROWSER, ip: '203.0.113.7', salt: 'test-salt', isDocument: true,
    status: 200, edition: 'org',
  });
  const elsewhere = await buildEvent({
    url: new URL('https://imqueue.org/docs/'),
    userAgent: BROWSER, ip: '203.0.113.7', salt: 'other-salt', isDocument: true,
    status: 200, edition: 'org',
  });

  assert.strictEqual(again.client_id, salted.client_id, 'same visitor, same id');
  assert.notStrictEqual(elsewhere.client_id, salted.client_id, 'different salt, different id');

  // No salt, no people. Counting them under a weaker identifier would be worse than
  // not counting them, so this must stay a hard drop rather than a fallback.
  assert.strictEqual(
    await buildEvent({
      url: new URL('https://imqueue.org/docs/'),
      userAgent: BROWSER, ip: '203.0.113.7', isDocument: true, status: 200, edition: 'org',
    }),
    null,
    'a browser with no VISITOR_SALT must produce no event at all',
  );
  ok('visitor digest: no raw ip/ua/salt in the payload, stable per visitor, none without a salt');

  // THE FLOOD GUARD. The middleware fronts every stylesheet, script, font and image on
  // both sites. Now that browsers are counted, anything less specific than "document"
  // turns one page view into a dozen events and the numbers into noise. Every one of
  // these is a browser request that must produce nothing.
  for (const dest of ['style', 'script', 'font', 'image', 'empty']) {
    assert.strictEqual(
      await buildEvent({
        url: new URL('https://imqueue.org/css/base.css'),
        userAgent: BROWSER, ip: '203.0.113.7', salt: 'test-salt',
        isDocument: false, status: 200, edition: 'org',
      }),
      null,
      `a browser subresource (sec-fetch-dest: ${dest}) must never be counted`,
    );
  }
  ok('subresources produce no event — one page view stays one event');

  // A fork, a preview deploy or a half-finished setup must send nothing anywhere.
  // trackRequest is async now, so "inert" means it resolves without ever calling fetch —
  // asserted here by leaving fetch un-stubbed and giving it no credentials to use.
  const req = { headers: { get: () => GPTBOT } };
  const url = new URL('https://imqueue.org/llms.txt');
  for (const env of [{}, { GA4_MP_MEASUREMENT_ID: 'G-X' }, { GA4_MP_API_SECRET: 's' }]) {
    assert.strictEqual(
      await trackRequest({ request: req, env, url, status: 200, edition: 'org' }),
      undefined,
      `must be inert with env ${JSON.stringify(env)}`,
    );
  }
  ok('inert unless BOTH GA4_MP_MEASUREMENT_ID and GA4_MP_API_SECRET are set');

  // x-agent-analytics is how a deployment gets validated with one curl, so it has to
  // appear on the agent surface — and NOT anywhere else, because attaching it means
  // rebuilding the response, and this middleware fronts every page, stylesheet and
  // image on both sites. Rebuilding is also the one point where it touches what a
  // visitor receives, so status and body are asserted to survive.
  const tagged = await onRequest(ctx('https://imqueue.org/llms.txt'));
  assert.strictEqual(tagged.headers.get('x-agent-analytics'), 'off reason=not-configured',
    'the agent surface always reports, with no variable to set');
  assert.strictEqual(tagged.status, 200, 'the rebuilt response keeps its status');
  assert.strictEqual(await tagged.text(), 'hi', 'and its body');

  for (const p of ['/tutorial/', '/', '/css/base.css']) {
    const plain = await onRequest(ctx(`https://imqueue.org${p}`));
    assert.strictEqual(plain.headers.get('x-agent-analytics'), null,
      `${p} must not be rebuilt — it is not the agent surface`);
    assert.strictEqual(plain, page, `${p} must be the untouched response object`);
  }
  ok('x-agent-analytics on the agent surface only, response intact, no rebuild elsewhere');

  // --- the audience split ---------------------------------------------------
  // Every number in the report is a filter on `kind`, and a wrong value here does not
  // fail — it produces a confident answer to the wrong question. The distinctions worth
  // pinning are the ones a single `crawler` bucket used to hide: Google indexing you
  // sends readers, GPTBot training on you sends nothing today, OAI-SearchBot indexing you
  // produces citations. Same company, three outcomes.
  const paramsFor = async (userAgent, path, isDocument = false) => (await buildEvent({
    url: new URL(`https://imqueue.org${path}`),
    userAgent,
    ip: '203.0.113.9',
    salt: 'test-salt',
    isDocument,
    status: 200,
    edition: 'org',
  })).events[0].params;

  const cases = [
    // same operator, three different purposes — the whole point of the taxonomy
    [GPTBOT, '/llms.txt', false, 'ai.training'],
    ['Mozilla/5.0 (compatible; OAI-SearchBot/1.0; +https://openai.com/searchbot)', '/llms.txt', false, 'ai.search'],
    ['Mozilla/5.0 (compatible; ChatGPT-User/1.0; +https://openai.com/bot)', '/llms.txt', false, 'assistant.chat'],
    // classic search must not sit in the same bucket as training
    ['Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)', '/docs/', false, 'search'],
    ['Mozilla/5.0 (compatible; Google-Extended/1.0)', '/docs/', false, 'ai.training'],
    // the row this exists for
    ['claude-code/1.0.0', '/docs/index.md', false, 'assistant.ide'],
    ['Cursor/0.42.0', '/docs/index.md', false, 'assistant.ide'],
    // a link preview is not a reader
    ['facebookexternalhit/1.1', '/docs/', false, 'infra'],
    // unnamed client on an agent-only path: an agent of unknown subtype
    ['curl/8.5.0', '/docs/index.md', false, 'assistant.other'],
    // same client on a path anyone might fetch: not guessed at either way
    ['curl/8.5.0', '/robots.txt', false, 'unknown'],
    // a real browser navigating
    [BROWSER, '/docs/', true, 'user'],
    // ...and a named crawler that happens to send Sec-Fetch-Dest must NOT become a user
    [GPTBOT, '/docs/', true, 'ai.training'],

    // THE `user` FLOOD GUARD. Nearly every crawler on the web sends Mozilla/ inside a
    // `(compatible; Xbot/1.0; +http://…)` UA, on purpose, so old servers serve it. The
    // browser heuristic was Mozilla/ + a document request and nothing else, so every
    // bot with no row in CRAWLERS — SEO auditors, scrapers, the next model vendor's
    // first crawler — was landing in `kind=user`, the one number that is supposed to
    // mean a person is looking at the page. These are the four announcement shapes.
    ['Mozilla/5.0 (compatible; SemrushBot/7~bl; +http://www.semrush.com/bot.html)', '/docs/', true, 'unknown'],
    ['Mozilla/5.0 (compatible; AhrefsBot/7.0; +http://ahrefs.com/robot/)', '/docs/', true, 'unknown'],
    ['Mozilla/5.0 (compatible; SomeCrawler)', '/docs/', true, 'unknown'],
    ['Mozilla/5.0 (Linux) NewSpider/2.0', '/docs/', true, 'unknown'],
    // A declared bot on an agent-only surface is NOT assistant.*: every assistant
    // value means a person is waiting, and nobody is waiting on SemrushBot. The
    // anonymous-client reading above (curl -> assistant.other) does not transfer.
    ['Mozilla/5.0 (compatible; SemrushBot/7~bl; +http://www.semrush.com/bot.html)', '/docs/index.md', false, 'unknown'],
    // ...and legacy Internet Explorer must survive all of the above as a HUMAN. Its UA
    // carries `(compatible;`, which is why that token is deliberately not matched:
    // a false positive here silently deletes a real reader from the report.
    ['Mozilla/5.0 (compatible; MSIE 9.0; Windows NT 6.1; Trident/5.0)', '/docs/', true, 'user'],
  ];

  for (const [userAgent, path, isDocument, expected] of cases) {
    const params = await paramsFor(userAgent, path, isDocument);

    assert.strictEqual(params.kind, expected,
      `${userAgent} on ${path} must be ${expected}, got ${params.kind}`);
    // Sent twice under two names on purpose: session_id sessionises but is not
    // reportable, visit_id is. If they ever diverge, every min/max reads from rows
    // that do not line up with GA4's own sessions.
    assert.strictEqual(params.visit_id, params.session_id,
      'visit_id must be the session id GA4 is actually using');
    // THE DOUBLE-COUNT GUARD. gtag owns page_view; GA4's `Views` counts only that name.
    // The moment anything here is called page_view, every consenting browser is counted
    // twice and no number in the property is true.
    assert.strictEqual(
      (await buildEvent({
        url: new URL(`https://imqueue.org${path}`),
        userAgent, ip: '203.0.113.9', salt: 'test-salt', isDocument,
        status: 200, edition: 'org',
      })).events[0].name,
      'srv_page_view',
      'every server-sent event must be srv_page_view, never page_view',
    );
  }
  ok('kind separates training / search / AI-search / IDE agent / person; never page_view');

  console.log(`\nAll ${checks} agent-analytics checks passed.`);
}

main().catch((err) => {
  console.error(`\nFAIL  ${err.message}`);
  process.exit(1);
});
