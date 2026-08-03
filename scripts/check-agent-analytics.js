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
// what fails SILENTLY or takes a site down.
//
// Item 13 revisits the half-hour one on purpose, and differs from the version that was
// deleted: it does not assert the arithmetic, it asserts the OBSERVABLE CONSEQUENCE of
// a deliberate limitation (two views a minute apart can be two sessions) and says why,
// so the next reader does not take it for a bug.
//
//   1-3. the middleware always returns a response, whatever analytics does
//   4.   the crawler's user-agent never reaches Google (it would bot-filter the lot)
//   5.   nothing is sent unless the deployment is configured to send it
//   6.   the header names the agent surface and nothing else
//   7.   `kind` separates a trainer from a search bot from a coding agent from a person
//   8.   SUBRESOURCES ARE NEVER COUNTED — the one that would flood the property
//   9.   the event is never named page_view, which is what stops the double count
//  10.   no raw address or user-agent reaches the payload, and no salt means no people
//  11.   an AI citation click is attributed to its brand, and our own navigation is not
//  12.   the `Link:` header names a mirror that EXISTS, and costs no rebuild elsewhere
//  13.   sessions are wall-clock buckets — pinned for its SEMANTICS, not its arithmetic
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

  // --- sessionisation is a BUCKET, and must keep reading as one --------------
  // Not arithmetic — `Math.floor(now / 1800000)` needs no test. This pins the
  // SEMANTICS, which are a known and deliberate limitation that a future reader will
  // otherwise mistake for a bug (or, worse, "fix" by inventing state the
  // no-paid-statistics constraint rules out): server-side sessions are wall-clock
  // half-hour buckets, while gtag's half of the same GA4 property uses the real
  // 30-minutes-of-inactivity rule.
  //
  // The consequence is the thing worth pinning: two views ONE MINUTE apart are two
  // sessions if they straddle :30, and two views TWENTY-NINE minutes apart are one if
  // they do not. Anyone reading edge session counts as comparable to gtag's needs to
  // know that, and check-agent-analytics.js records that a previous half-hour
  // assertion was deleted as ceremony — this one carries the reason so it is not
  // deleted again.
  const at = async (ms) => (await buildEvent({
    url: new URL('https://imqueue.org/cli/'),
    userAgent: BROWSER, ip: '203.0.113.9', salt: 'test-salt', isDocument: true,
    status: 200, edition: 'org', now: ms,
  })).events[0].params.visit_id;

  // 1970-01-01T00:29:30Z and 00:30:30Z — a minute apart, either side of a boundary.
  const before = await at(29.5 * 60 * 1000);
  const after = await at(30.5 * 60 * 1000);
  // 00:00:30 and 00:29:00 — twenty-eight minutes apart, same bucket.
  const early = await at(30 * 1000);
  const late = await at(29 * 60 * 1000);

  assert.notStrictEqual(before, after,
    'a wall-clock bucket splits two views a minute apart across :30 — this is the '
    + 'documented limitation, not a defect');
  assert.strictEqual(early, late,
    'and merges two views 28 minutes apart inside one bucket');
  assert.strictEqual(before, early, 'both halves of the hour before :30 are one bucket');
  ok('sessions are wall-clock half-hour buckets, and the reports say so');

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
    // Still the untouched object, and note WHY: `page` above is text/plain, so the
    // Link-header path below declines it. An HTML response at these URLs IS rebuilt,
    // which the next block asserts deliberately.
    assert.strictEqual(plain, page, `${p} must be the untouched response object`);
  }
  ok('x-agent-analytics on the agent surface only, response intact, no rebuild elsewhere');

  // --- Link: rel=alternate, type=text/markdown ------------------------------
  // The mirrors were reachable only by knowing the `<url>index.md` convention. This
  // header states it, head.html states it in the HTML, and mirror-link.html renders
  // a visible link — all three from hasMarkdownMirror() in lib/markdown-link.js, so
  // the three surfaces cannot disagree.
  //
  // What is worth a gate is not the happy path but the four ways this could produce
  // a header pointing at a 404, plus the cost: it fronts every request to both
  // zones, so anything that is not a 200 HTML directory URL must skip the rebuild.
  {
    const { hasMarkdownMirror, markdownLink } = await import('../lib/markdown-link.js');

    for (const [path, want, why] of [
      ['/cli/installation/', true, 'an ordinary docs page'],
      ['/', true, 'the home page'],
      ['/blog/', true, 'the blog index — its mirror is hand-written, and an earlier rule missed it'],
      ['/api/', true, 'the API landing page is mirrored by hand'],
      ['/api/rpc/latest/', true, 'a current-major API tree is mirrored'],
      ['/api/rpc/latest/rpc.imqservice/', true, 'including every symbol page in it'],
      ['/agents/delayed-scheduled-work/', true, 'noindex does not mean unmirrored — this page has a mirror'],
      ['/blog/page/2/', false, 'paginated listings have none: /blog/index.md is the whole index'],
      ['/api/rpc/2.1.0/', false, 'archived API majors are unmirrored'],
      ['/api/rpc/2.1.0/rpc.imqservice/', false, 'and so are their symbol pages'],
      ['/llms.txt', false, 'not a directory URL — <url>index.md is meaningless'],
      ['/favicon.svg', false, 'same'],
    ]) {
      assert.strictEqual(hasMarkdownMirror(path), want, `${path}: ${why}`);
    }

    assert.strictEqual(hasMarkdownMirror('/x/', { draft: true }), false,
      'drafts are excluded — the contentMd collection skips them, so no mirror exists');
    assert.strictEqual(hasMarkdownMirror('/x/', { mirror: false }), false,
      '`mirror: false` is the per-page opt-out');

    const html = { headers: new Headers({ 'content-type': 'text/html; charset=utf-8' }) };

    assert.strictEqual(
      markdownLink({ url: new URL('https://imqueue.org/cli/'), status: 200, response: html }),
      '<https://imqueue.org/cli/index.md>; rel="alternate"; type="text/markdown"',
      'the header names an absolute URL on the requested origin',
    );
    assert.strictEqual(
      markdownLink({ url: new URL('https://imqueue.com/license/'), status: 200, response: html }),
      '<https://imqueue.com/license/index.md>; rel="alternate"; type="text/markdown"',
      'and follows the host, so .com advertises .com',
    );
    assert.strictEqual(
      markdownLink({ url: new URL('https://imqueue.org/nope/'), status: 404, response: html }),
      null,
      'never on a non-200 — a header advertising a mirror on a 404 is worse than none',
    );
    assert.strictEqual(
      markdownLink({ url: new URL('https://imqueue.org/llms.txt'), status: 200, response: page }),
      null,
      'never on a non-HTML response',
    );

    // End to end through the middleware, with an HTML response this time.
    const htmlPage = new Response('<html></html>', {
      status: 200,
      headers: { 'content-type': 'text/html; charset=utf-8' },
    });
    const linked = await onRequest(ctx('https://imqueue.org/cli/', { next: async () => htmlPage }));

    assert.strictEqual(
      linked.headers.get('link'),
      '<https://imqueue.org/cli/index.md>; rel="alternate"; type="text/markdown"',
      'the middleware sends it on an HTML page',
    );
    assert.strictEqual(linked.status, 200, 'the rebuilt response keeps its status');
    assert.strictEqual(await linked.text(), '<html></html>', 'and its body');

    const notLinked = await onRequest(ctx('https://imqueue.org/blog/page/2/', { next: async () => htmlPage }));

    assert.strictEqual(notLinked.headers.get('link'), null,
      'and not on a page with no mirror');
    assert.strictEqual(notLinked, htmlPage,
      'which must also mean no rebuild — this fronts every request to both zones');
  }
  ok('Link: rel=alternate advertises the markdown mirror, and only where one exists');

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

  // --- 11. AI referral attribution ------------------------------------------
  // A click from an AI answer surface is the outcome the whole programme exists to
  // produce, and it is the number most easily lost: GA4's own "AI Assistants"
  // channel omits Perplexity and Claude, so both land in Referral with every
  // GitHub link. This asserts the pair of dimensions that fixes it, and — more
  // importantly — that our own navigation never lands in the same bucket.
  {
    const refFor = async (referrer, path = '/docs/index.md') => (await buildEvent({
      url: new URL(`https://imqueue.org${path}`),
      userAgent: 'curl/8.5.0',
      ip: '203.0.113.9',
      salt: 'test-salt',
      referrer,
      status: 200,
      edition: 'org',
    })).events[0].params;

    const cases = [
      // the two GA4's default channel group leaves in Referral
      ['https://www.perplexity.ai/search/imqueue-rpc', 'perplexity.ai', 'perplexity'],
      ['https://claude.ai/chat/abc-123', 'claude.ai', 'claude'],
      // ...and the ones it does cover, which must agree rather than double-classify
      ['https://chatgpt.com/c/abc', 'chatgpt.com', 'chatgpt'],
      ['https://chat.openai.com/c/abc', 'chat.openai.com', 'chatgpt'],
      ['https://gemini.google.com/app', 'gemini.google.com', 'gemini'],
      // www. and deeper subdomains must not create separate sources
      ['https://www.perplexity.ai/', 'perplexity.ai', 'perplexity'],
      // OUR OWN navigation. Without its own value this would drown `other` and
      // make the dimension unreadable; imqueue.com -> imqueue.org is a crossing
      // the site makes on purpose and is not a citation.
      ['https://imqueue.org/docs/', 'imqueue.org', 'internal'],
      ['https://imqueue.com/pricing/', 'imqueue.com', 'internal'],
      // an ordinary referral stays an ordinary referral
      ['https://news.ycombinator.com/item?id=1', 'news.ycombinator.com', 'other'],
      // a bare substring must NOT match: Google's own example regex starts with
      // `.*ai`, which would file every one of these as an AI assistant.
      ['https://mail.google.com/mail/u/0', 'mail.google.com', 'other'],
      ['https://www.chairish.com/x', 'chairish.com', 'other'],
      // most crawler traffic, and every click from the ChatGPT/Claude desktop apps
      [null, 'none', 'none'],
      // a client sending nonsense must not cost the event
      ['not a url', 'invalid', 'other'],
    ];

    for (const [referrer, host, source] of cases) {
      const params = await refFor(referrer);

      assert.strictEqual(params.referrer_host, host,
        `referrer ${referrer} must give referrer_host=${host}, got ${params.referrer_host}`);
      assert.strictEqual(params.ai_source, source,
        `referrer ${referrer} must give ai_source=${source}, got ${params.ai_source}`);
    }

    // page_referrer is GA4-reserved and drives attribution, so it is sent verbatim
    // when there is one and OMITTED when there is not — never invented as 'none',
    // which would be a claim about where a visitor came from.
    assert.strictEqual(
      (await refFor('https://claude.ai/chat/abc-123')).page_referrer,
      'https://claude.ai/chat/abc-123',
      'page_referrer must be passed through verbatim for GA4 attribution',
    );
    assert.ok(
      !('page_referrer' in await refFor(null)),
      'page_referrer must be absent, not "none", when the request had no referrer',
    );
  }
  ok('AI referrals are attributed by brand, and our own navigation is not one');

  // --- 12. gtag stitching ---------------------------------------------------
  // The edge used a salted IP+UA digest and gtag uses its own `_ga` client id, so a
  // person appearing in both streams was two unrelated users and no per-user metric
  // in the property was true for them. Reading gtag's id when it is already there
  // fixes it; the three assertions are that it is read, that a crawler never
  // borrows one, and that nothing is invented when there is no cookie.
  {
    const { ga4ClientId } = await import('../lib/agent-analytics.js');

    assert.strictEqual(
      ga4ClientId('foo=1; _ga=GA1.1.1234567890.1699999999; _ga_ABC=x'),
      '1234567890.1699999999',
      'the _ga cookie\'s client id must be extracted without its version/depth labels',
    );
    assert.strictEqual(ga4ClientId(null), null, 'no cookie header must give null');
    assert.strictEqual(ga4ClientId('_ga=nonsense'), null, 'a malformed _ga must give null');

    const browserEvent = await buildEvent({
      url: new URL('https://imqueue.org/docs/'),
      userAgent: BROWSER, ip: '203.0.113.9', salt: 'test-salt', isDocument: true,
      gaClientId: '1234567890.1699999999', status: 200, edition: 'org',
    });

    assert.strictEqual(browserEvent.client_id, '1234567890.1699999999',
      'a browser with a _ga cookie must be reported under gtag\'s client id');

    // A crawler has no cookie in practice, but if one is ever presented it must not
    // be adopted: GPTBot is not a person, and merging it into a real user's history
    // would corrupt exactly the numbers this exists to make true.
    const crawlerEvent = await buildEvent({
      url: new URL('https://imqueue.org/llms.txt'),
      userAgent: GPTBOT, ip: '203.0.113.9', salt: 'test-salt',
      gaClientId: '1234567890.1699999999', status: 200, edition: 'org',
    });

    assert.strictEqual(crawlerEvent.client_id, 'openai.gptbot',
      'a crawler must keep its family label even if a _ga cookie is present');

    const noCookie = await buildEvent({
      url: new URL('https://imqueue.org/docs/'),
      userAgent: BROWSER, ip: '203.0.113.9', salt: 'test-salt', isDocument: true,
      status: 200, edition: 'org',
    });

    assert.ok(noCookie.client_id && noCookie.client_id !== '1234567890.1699999999',
      'with no cookie the visitor digest must still be used');
  }
  ok('server events share gtag\'s client id when there is one, and never borrow one');

  console.log(`\nAll ${checks} agent-analytics checks passed.`);
}

main().catch((err) => {
  console.error(`\nFAIL  ${err.message}`);
  process.exit(1);
});
