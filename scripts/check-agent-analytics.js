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
//   7.   `kind` never claims a bot is human, and keeps a trainer apart from a browser
//
// Nothing here touches the network — verified by running it under a global fetch
// spy. Delivery is deliberately NOT tested here; it needs a credential and a
// network, which is what `npm run probe:agent-analytics` is for.
const assert = require('node:assert');

const GPTBOT = 'Mozilla/5.0 (compatible; GPTBot/1.2; +https://openai.com/gptbot)';

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
  const event = buildEvent({
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

  // A fork, a preview deploy or a half-finished setup must send nothing anywhere.
  const req = { headers: { get: () => GPTBOT } };
  const url = new URL('https://imqueue.org/llms.txt');
  for (const env of [{}, { GA4_MP_MEASUREMENT_ID: 'G-X' }, { GA4_MP_API_SECRET: 's' }]) {
    assert.strictEqual(
      trackRequest({ request: req, env, url, status: 200, edition: 'org' }),
      null,
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
  // Every number in the GA4 report is a filter on `kind`, and a wrong value here does
  // not fail — it produces a confident answer to the wrong question. Two ways it could
  // go wrong silently, so both are pinned:
  //
  //   * 'human' must be unreachable from this module. Only gtag, which runs solely in
  //     a browser, is allowed to claim it. One crawler labelled human and the human
  //     audience is fiction.
  //   * a trainer and a browser from the SAME operator must not merge. If they did,
  //     `operator` would already have been enough and the dimension would be pointless.
  const kindOf = (userAgent, path) => buildEvent({
    url: new URL(`https://imqueue.org${path}`),
    userAgent,
    status: 200,
    edition: 'org',
  }).events[0].params;

  const cases = [
    [GPTBOT, '/llms.txt', 'crawler'],
    ['Mozilla/5.0 (compatible; ChatGPT-User/1.0; +https://openai.com/bot)', '/llms.txt', 'assistant'],
    ['claude-code/1.0.0', '/docs/index.md', 'assistant'],
    ['Cursor/0.42.0', '/docs/index.md', 'assistant'],
    // Unnamed client, agent-only path: assistant on the balance of evidence.
    ['curl/8.5.0', '/docs/index.md', 'assistant'],
    // Same unnamed client on a path anyone might fetch: not guessed at either way.
    ['curl/8.5.0', '/robots.txt', 'unknown'],
  ];

  for (const [userAgent, path, expected] of cases) {
    const params = kindOf(userAgent, path);

    assert.strictEqual(params.kind, expected,
      `${userAgent} on ${path} must be ${expected}, got ${params.kind}`);
    assert.notStrictEqual(params.kind, 'human',
      'only gtag may report kind=human');
    // Sent twice under two names on purpose: session_id sessionises but is not
    // reportable, visit_id is. If they ever diverge, every min/max reads from rows
    // that do not line up with GA4's own sessions.
    assert.strictEqual(params.visit_id, params.session_id,
      'visit_id must be the session id GA4 is actually using');
  }
  ok('kind splits assistant from crawler and never claims human; visit_id tracks the session');

  console.log(`\nAll ${checks} agent-analytics checks passed.`);
}

main().catch((err) => {
  console.error(`\nFAIL  ${err.message}`);
  process.exit(1);
});
