#!/usr/bin/env node
// probe-agent-analytics.js — does the agent-analytics pipeline actually deliver?
//
// `npm test` proves the module's LOGIC offline: what gets sent, what gets skipped,
// that the crawler's user-agent never reaches Google, that a failure cannot cost a
// page view. What it cannot prove is delivery — that needs a real property, a real
// Measurement Protocol secret and a network, none of which belong in a gate that
// runs at pre-commit and on every pull request.
//
// This is that other half, and it is deliberately opt-in:
//
//   export GA4_MP_MEASUREMENT_ID='G-…'   # the site's own property for this edition
//   export GA4_MP_API_SECRET='…'         # from that property's own data stream
//
// One property, not two: see the note above sitePropertyIds().
//   npm run probe:agent-analytics
//
// It calls the same lib/agent-analytics.js the Cloudflare middleware calls, so a pass
// here means the module, the credential and the property agree — not that a
// hand-written payload happens to be valid.
//
// GA4_MP_DEBUG=1 routes to GA4's validation endpoint instead, which reports what is
// wrong with a payload but RECORDS NOTHING. Useful once; useless as a habit.
//
// Prints no secret. The value never appears in output, and never in an error message.
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

// The site's own GA4 property ids, read from where they actually live.
//
// THIS USED TO BE A REFUSAL. The probe would exit 1 if pointed at the site's own
// property, on the grounds that crawler events must not mix into the human numbers
// and GA4 has no selective delete. That reasoning was superseded on 2026-08-03 by
// rule 1 in lib/agent-analytics.js: both streams land in the SAME property on
// purpose, and the separation is done by EVENT NAME — gtag sends page_view,
// everything server-side sends srv_page_view, and GA4's `Views` metric counts only
// the former, so the two can never be summed by accident.
//
// So the site's property is now the CORRECT target and the refusal was rejecting the
// only supported configuration. What remains is worth saying out loud, because a
// probe writes real rows into real reports: it names which property it is about to
// write to, and whether that is the site's.
function sitePropertyIds() {
  try {
    const cfg = fs.readFileSync(path.join(ROOT, 'eleventy.config.js'), 'utf8');

    return new Set([...cfg.matchAll(/ga4:\s*"(G-[A-Z0-9]+)"/g)].map((m) => m[1]));
  } catch {
    return new Set();
  }
}

// The fourth case is a BROWSER arriving from a Perplexity answer, which is the
// outcome the whole programme exists to produce and the one row nobody had ever seen
// arrive. It needs an ip and a salt, because a browser with no salt is dropped by
// design.
const CASES = [
  ['GPTBot/1.2 (+https://openai.com/gptbot)',      '/llms.txt',                  200],
  ['ClaudeBot/1.0 (+claudebot@anthropic.com)',     '/tutorial/index.md',         200],
  ['PerplexityBot/1.0',                            '/probe-missing/index.md',    404],
  [
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0 Safari/537.36',
    '/compare/',
    200,
    { referrer: 'https://www.perplexity.ai/search/imqueue-vs-nats', document: true },
  ],
];

async function main() {
  const force = process.argv.includes('--force');
  const env = {
    GA4_MP_MEASUREMENT_ID: process.env.GA4_MP_MEASUREMENT_ID,
    GA4_MP_API_SECRET: process.env.GA4_MP_API_SECRET,
    GA4_MP_DEBUG: process.env.GA4_MP_DEBUG,
  };

  if (!env.GA4_MP_MEASUREMENT_ID || !env.GA4_MP_API_SECRET) {
    console.error(
      'Both GA4_MP_MEASUREMENT_ID and GA4_MP_API_SECRET must be EXPORTED in this shell.\n'
      + '  ID:     ' + (env.GA4_MP_MEASUREMENT_ID || '<not visible to child processes>') + '\n'
      + '  SECRET: ' + (env.GA4_MP_API_SECRET ? 'visible' : '<not visible to child processes>') + '\n\n'
      + 'Note `echo` finds a plain `FOO=bar` assignment but no child process does — only\n'
      + 'exported variables are handed to one. If echo shows them but this does not:\n'
      + '  export GA4_MP_MEASUREMENT_ID GA4_MP_API_SECRET',
    );
    process.exit(1);
  }

  const siteIds = sitePropertyIds();
  const isSiteProperty = siteIds.has(env.GA4_MP_MEASUREMENT_ID);

  if (!isSiteProperty && siteIds.size && !force) {
    // The inverse of the old refusal, and the one that is now worth having: an id
    // that is NOT one of the site's is probably a stale copy from before the
    // one-property decision, or someone else's property entirely. Sending there
    // produces a clean run and no data where anyone will look for it.
    console.error(
      `${env.GA4_MP_MEASUREMENT_ID} is not a property this site reports to.\n`
      + `  eleventy.config.js names: ${[...siteIds].join(', ')}\n\n`
      + 'Both streams share one property by design (rule 1 in lib/agent-analytics.js);\n'
      + 'the separation is the srv_page_view event name, not a second property. If you\n'
      + 'do mean to write somewhere else, pass --force.',
    );
    process.exit(1);
  }

  const { trackRequest, buildEvent } = await import('../lib/agent-analytics.js');
  const debug = Boolean(env.GA4_MP_DEBUG);

  console.log(`property: ${env.GA4_MP_MEASUREMENT_ID}${debug ? '  (GA4_MP_DEBUG — validating, NOT recording)' : ''}\n`);

  for (const [userAgent, pathname, status, extra = {}] of CASES) {
    const url = new URL(`https://imqueue.org${pathname}`);
    // AWAIT. buildEvent became async when the visitor digest was added (crypto.subtle
    // returns a promise), and this line was reading `.events` off the promise —
    // so `npm run probe:agent-analytics` threw before sending anything at all.
    const headers = {
      'user-agent': userAgent,
      ...(extra.referrer ? { referer: extra.referrer } : {}),
      ...(extra.document ? { 'sec-fetch-dest': 'document' } : {}),
    };
    const probeEnv = extra.document
      ? { ...env, VISITOR_SALT: env.VISITOR_SALT || 'probe-salt' }
      : env;
    const built = await buildEvent({
      url, userAgent, status, edition: 'org',
      referrer: extra.referrer || null,
      isDocument: Boolean(extra.document),
      ip: extra.document ? '203.0.113.9' : null,
      salt: probeEnv.VISITOR_SALT,
    });
    const { params } = built.events[0];

    await trackRequest({
      request: { headers: { get: (h) => headers[h.toLowerCase()] ?? null } },
      env: probeEnv,
      url,
      status,
      edition: 'org',
    });

    console.log(
      `  sent  ${params.crawler.padEnd(15)} ${params.surface.padEnd(16)} ${params.status}`
      + `  ai=${(params.ai_source || '-').padEnd(11)} ${pathname}`,
    );
  }

  console.log(
    debug
      ? '\nValidation output is above: an empty validationMessages array means the payload'
        + '\nis well-formed. Nothing was recorded — unset GA4_MP_DEBUG and re-run to send.'
      : '\nDone. GA4 answers 204 to valid and invalid hits alike, so no error here proves'
        + '\nnothing — the proof is the data. Open GA4 → Reports → Realtime on that property'
        + '\nand look for srv_page_view — NOT page_view, which is gtag\'s and is what the'
        + '\n`Views` metric counts. Three of them should appear within a minute or two,'
        + '\nincluding the 404.'
        + '\nIf Realtime stays empty: wrong property, a secret from a different stream, or'
        + '\nGA4 filtering. Re-run with GA4_MP_DEBUG=1 to see what it says about the payload.',
  );
}

main().catch((err) => {
  // Never interpolate the error blindly — a fetch failure can echo the request URL,
  // and that URL carries api_secret as a query parameter.
  console.error(`\nFAIL  ${String(err.message).replace(/api_secret=[^&\s]+/g, 'api_secret=<redacted>')}`);
  process.exit(1);
});
