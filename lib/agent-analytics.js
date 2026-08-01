// agent-analytics.js — server-side GA4 events for the traffic gtag cannot see.
//
// GA4 is a JavaScript tag, and the surface this site builds for AI agents runs
// none of it: /llms.txt, /llms-full.txt, every <page-url>index.md mirror,
// /api/search-index.json. Crawlers execute no JS even on the HTML pages. Measured
// 2026-08-01: Cloudflare's edge saw 4.77k requests in 24h while GA4 reported 347
// sessions in 28 days. Those are different populations, and only one of them was
// being measured.
//
// Cloudflare's AI Crawl Control shows the other one, but its free tier keeps only
// 24 hours of metrics and reports per crawler brand — no path analysis, no
// history, no slicing. This module sends the same events into GA4 instead, where
// the reporting already exists.
//
// --- rules this follows, each for a reason ------------------------------------
//
// 1. SEPARATE PROPERTY. Point GA4_MP_MEASUREMENT_ID at a property that is NOT the
//    one in the site's <head>. Crawler hits in the main property would corrupt the
//    numbers that describe humans — sessions, engagement rate, and the Direct share
//    that is already hard enough to read.
//
// 2. ONLY WHAT gtag MISSES. A browser loading an HTML page is already measured, so
//    it is skipped here; sending it would double-count and make the second property
//    a worse copy of the first. What gets sent: any request from a recognised bot,
//    and any request for the agent surface regardless of who asked.
//
// 3. NEVER FORWARD THE CRAWLER'S USER-AGENT. GA4 drops traffic it identifies as a
//    bot from the IAB list, and the Measurement Protocol only knows the UA if you
//    hand it over — which would silently discard the entire dataset. The crawler is
//    carried as an ordinary event parameter instead, so it is analysable rather than
//    a filter key.
//
// 4. NO IP, NO FINGERPRINT. client_id is derived from the crawler family alone, so
//    a GA4 "user" means "a crawler", not a person. Nothing identifying is sent, and
//    no hashing of addresses that would only pretend not to identify.
//
// 5. FAIL OPEN AND INERT BY DEFAULT. With the env vars unset this module does
//    nothing at all, so a fork or a preview deploy sends no traffic anywhere. The
//    caller wraps it and never awaits it — see functions/_middleware.js.

// Bot families, most specific first. `operator` groups them the way Cloudflare's AI
// Crawl Control does, so its numbers and GA4's can be compared.
const CRAWLERS = [
  [/GPTBot/i,            'GPTBot',            'OpenAI'],
  [/ChatGPT-User/i,      'ChatGPT-User',      'OpenAI'],
  [/OAI-SearchBot/i,     'OAI-SearchBot',     'OpenAI'],
  [/ClaudeBot/i,         'ClaudeBot',         'Anthropic'],
  [/Claude-Web/i,        'Claude-Web',        'Anthropic'],
  [/Claude-User/i,       'Claude-User',       'Anthropic'],
  [/anthropic-ai/i,      'anthropic-ai',      'Anthropic'],
  [/PerplexityBot/i,     'PerplexityBot',     'Perplexity'],
  [/Perplexity-User/i,   'Perplexity-User',   'Perplexity'],
  [/Google-Extended/i,   'Google-Extended',   'Google'],
  [/Googlebot/i,         'Googlebot',         'Google'],
  [/Google-CloudVertexBot/i, 'Vertex',        'Google'],
  [/Applebot-Extended/i, 'Applebot-Extended', 'Apple'],
  [/Applebot/i,          'Applebot',          'Apple'],
  [/Amazonbot/i,         'Amazonbot',         'Amazon'],
  [/meta-externalagent/i, 'Meta-ExternalAgent', 'Meta'],
  [/facebookexternalhit/i, 'facebookexternalhit', 'Meta'],
  [/bingbot/i,           'BingBot',           'Microsoft'],
  [/CCBot/i,             'CCBot',             'Common Crawl'],
  [/Bytespider/i,        'Bytespider',        'ByteDance'],
  [/DeepSeek/i,          'DeepSeekBot',       'DeepSeek'],
  [/MistralAI-User/i,    'MistralAI-User',    'Mistral'],
  [/cohere-ai/i,         'cohere-ai',         'Cohere'],
  [/YouBot/i,            'YouBot',            'You.com'],
  [/Diffbot/i,           'Diffbot',           'Diffbot'],
  [/Baiduspider/i,       'Baiduspider',       'Baidu'],
  [/YandexBot/i,         'YandexBot',         'Yandex'],
  [/DuckDuckBot/i,       'DuckDuckBot',       'DuckDuckGo'],
  // Not a crawler brand but the most interesting row on the report: a plain HTTP
  // client asking for markdown is very likely an agent following the convention,
  // including this project's own MCP server's get_doc.
  [/^(node|undici|axios|python-requests|httpx|aiohttp|Go-http-client|curl|wget)/i,
    'http-client', 'Generic client'],
];

// The pages and endpoints that exist FOR agents. A request for one of these counts
// even from an unrecognised client, because nothing else on the site is fetched
// this way on purpose.
const AGENT_SURFACE = [
  [/\/index\.md$/,               'markdown-mirror'],
  [/^\/llms\.txt$/,              'llms.txt'],
  [/^\/llms-full\.txt$/,         'llms-full.txt'],
  [/^\/api\/search-index\.json$/, 'symbol-index'],
  [/^\/robots\.txt$/,            'robots.txt'],
  [/sitemap[^/]*\.xml$/,         'sitemap'],
];

// The property real visitors are measured in (eleventy.config.js, and public in page
// source). Hard-refused below, because rule 1 is the one mistake that cannot be
// undone: GA4 has no selective delete, so crawler page_views landing here would be
// mixed into the human dataset permanently. It is an easy mistake to make — this is
// the ID a maintainer already knows by heart, and it was in fact what the Pages env
// vars held first. An interlock costs one comparison; a contaminated property costs
// the reports.
const HUMAN_PROPERTY = 'G-EQTNPY721G';

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/** Which crawler family a user-agent belongs to, or null for anything else. */
export function classifyCrawler(userAgent) {
  if (!userAgent) {
    // A request with no UA at all is not a browser. Worth counting, worth naming.
    return { crawler: 'no-user-agent', operator: 'Unidentified' };
  }

  for (const [re, crawler, operator] of CRAWLERS) {
    if (re.test(userAgent)) return { crawler, operator };
  }

  return null;
}

/** Which agent-facing surface a path belongs to, or null for ordinary pages. */
export function classifySurface(pathname) {
  for (const [re, surface] of AGENT_SURFACE) {
    if (re.test(pathname)) return surface;
  }

  return null;
}

/**
 * The GA4 Measurement Protocol body for one request, or null when the request is
 * one gtag already measures (an ordinary browser asking for an ordinary page).
 *
 * Sent as `page_view` with `page_location` on purpose: that populates GA4's
 * built-in Pages and Landing-page reports with no custom dimensions registered, so
 * "which part of the docs do agents actually read" works on day one. The extras —
 * crawler, operator, surface, status — need registering as event-scoped custom
 * dimensions before they can be used as report dimensions, though they are visible
 * in DebugView and Realtime immediately.
 */
export function buildEvent({ url, userAgent, status, edition, now = Date.now() }) {
  const found = classifyCrawler(userAgent);
  const surface = classifySurface(url.pathname);

  // Rule 2: a browser on a normal page is gtag's job, not ours.
  if (!found && !surface) return null;

  const crawler = found ? found.crawler : 'unclassified';
  const operator = found ? found.operator : 'Unidentified';

  return {
    // Rule 4: a "user" here is a crawler family, nothing more.
    client_id: `${slug(operator)}.${slug(crawler)}`,
    events: [{
      name: 'page_view',
      params: {
        page_location: url.href,
        page_title: url.pathname,
        // GA4 needs both of these or the event lands without a session and the
        // engagement metrics read as zero.
        session_id: `${slug(crawler)}-${Math.floor(now / 1800000)}`,
        engagement_time_msec: 1,
        crawler,
        operator,
        // 'html' rather than null so the dimension is never (not set): a crawler
        // reading the HTML page instead of the mirror is exactly what you want to
        // be able to filter on.
        surface: surface || 'html',
        status: String(status),
        edition,
      },
    }],
  };
}

/**
 * Send one request's event. Returns a promise the caller passes to waitUntil, or
 * null when there is nothing to send — no credentials, or not a trackable request.
 *
 * `env.GA4_MP_DEBUG` routes to GA4's validation endpoint and logs what it says.
 * Use it once while setting this up, reading the output in the Pages project's
 * function logs, then unset it — the validation endpoint reports problems but
 * RECORDS NOTHING, so leaving it on means collecting no data at all. (It is not
 * DebugView, which needs the normal endpoint and a debug_mode parameter; validation
 * is the more useful half here because a malformed hit is otherwise accepted with a
 * 2xx and silently dropped.)
 */
export function trackRequest({ request, env, url, status, edition }) {
  const id = env && env.GA4_MP_MEASUREMENT_ID;
  const secret = env && env.GA4_MP_API_SECRET;

  if (!id || !secret) return null; // Rule 5: inert until configured.

  // Rule 1, enforced rather than merely documented. Misconfiguration here is silent
  // and permanent, so it fails closed: no measurement is a nuisance, a poisoned
  // human property is not recoverable.
  if (id === HUMAN_PROPERTY) {
    console.error(
      `[agent-analytics] REFUSING to send: GA4_MP_MEASUREMENT_ID is ${HUMAN_PROPERTY}, `
      + 'the property real visitors are measured in. Point it at a separate property '
      + '(see README, "Agent analytics") — crawler events there cannot be deleted later.',
    );

    return null;
  }

  const body = buildEvent({
    url,
    userAgent: request.headers.get('user-agent'),
    status,
    edition,
  });

  if (!body) return null;

  const debug = Boolean(env.GA4_MP_DEBUG);
  const endpoint = debug
    ? 'https://www.google-analytics.com/debug/mp/collect'
    : 'https://www.google-analytics.com/mp/collect';

  const sent = fetch(
    `${endpoint}?measurement_id=${encodeURIComponent(id)}&api_secret=${encodeURIComponent(secret)}`,
    {
      method: 'POST',
      // Rule 3: our own UA, never the crawler's. Sending the crawler's would let
      // GA4's bot filter discard the whole dataset.
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    },
  );

  if (!debug) {
    return sent.catch(() => {
      // A measurement failure must never become a site failure. There is nowhere
      // useful to report this from a Worker, and retrying a lost hit is worth less
      // than the request it would cost.
    });
  }

  // The normal endpoint answers 2xx for a malformed hit and drops it, so the only
  // way to know the payload is right is to ask. Read this in the Pages project's
  // function logs — an empty validationMessages array means the hit is good.
  return sent
    .then((res) => res.text())
    .then((text) => console.log(`[agent-analytics] ${url.pathname} → ${text}`))
    .catch(() => {});
}
