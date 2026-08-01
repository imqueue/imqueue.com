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
//   export GA4_MP_MEASUREMENT_ID='G-…'   # the AGENT property, not the site's
//   export GA4_MP_API_SECRET='…'         # from that property's own data stream
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

// The site's own GA4 property, read from where it actually lives rather than copied
// here. Sending crawler events to it is the one mistake with no undo — GA4 has no
// selective delete — so the probe refuses by default. Deriving it means this cannot
// go stale when the site's id changes; if the read fails, the check is skipped rather
// than guessed at.
function sitePropertyIds() {
  try {
    const cfg = fs.readFileSync(path.join(ROOT, 'eleventy.config.js'), 'utf8');

    return new Set([...cfg.matchAll(/ga4:\s*"(G-[A-Z0-9]+)"/g)].map((m) => m[1]));
  } catch {
    return new Set();
  }
}

const CASES = [
  ['GPTBot/1.2 (+https://openai.com/gptbot)',      '/llms.txt',                  200],
  ['ClaudeBot/1.0 (+claudebot@anthropic.com)',     '/tutorial/index.md',         200],
  ['PerplexityBot/1.0',                            '/probe-missing/index.md',    404],
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

  if (siteIds.has(env.GA4_MP_MEASUREMENT_ID) && !force) {
    console.error(
      `Refusing: ${env.GA4_MP_MEASUREMENT_ID} is the property the SITE reports to `
      + '(eleventy.config.js).\nCrawler events there mix into the numbers that describe '
      + 'humans, and GA4 has no\nselective delete. Point this at the agent property, '
      + 'or pass --force if you mean it.',
    );
    process.exit(1);
  }

  const { trackRequest, buildEvent } = await import('../lib/agent-analytics.js');
  const debug = Boolean(env.GA4_MP_DEBUG);

  console.log(`property: ${env.GA4_MP_MEASUREMENT_ID}${debug ? '  (GA4_MP_DEBUG — validating, NOT recording)' : ''}\n`);

  for (const [userAgent, pathname, status] of CASES) {
    const url = new URL(`https://imqueue.org${pathname}`);
    const { params } = buildEvent({ url, userAgent, status, edition: 'org' }).events[0];

    await trackRequest({
      request: { headers: { get: (h) => (h.toLowerCase() === 'user-agent' ? userAgent : null) } },
      env,
      url,
      status,
      edition: 'org',
    });

    console.log(`  sent  ${params.crawler.padEnd(15)} ${params.surface.padEnd(16)} ${params.status}  ${pathname}`);
  }

  console.log(
    debug
      ? '\nValidation output is above: an empty validationMessages array means the payload'
        + '\nis well-formed. Nothing was recorded — unset GA4_MP_DEBUG and re-run to send.'
      : '\nDone. GA4 answers 204 to valid and invalid hits alike, so no error here proves'
        + '\nnothing — the proof is the data. Open GA4 → Reports → Realtime on that property;'
        + '\nthree page_view events should appear within a minute or two, including the 404.'
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
