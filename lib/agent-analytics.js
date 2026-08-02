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
//
// `kind` is the audience split every report here is built on, and it is stated per
// FAMILY rather than derived from `operator` because the same operator ships both:
// GPTBot is filling a training set, ChatGPT-User is a person waiting for an answer.
// Rolling them up by company would merge the two populations that most need
// separating. Three values are used:
//
//   assistant — fetching on a person's behalf, right now, mid-conversation
//   crawler   — indexing or collecting, nobody waiting
//   null      — cannot say from the UA alone; classifyKind() lets the path decide
//
const CRAWLERS = [
  [/GPTBot/i,            'GPTBot',            'OpenAI',     'crawler'],
  [/ChatGPT-User/i,      'ChatGPT-User',      'OpenAI',     'assistant'],
  [/OAI-SearchBot/i,     'OAI-SearchBot',     'OpenAI',     'crawler'],
  [/ClaudeBot/i,         'ClaudeBot',         'Anthropic',  'crawler'],
  [/Claude-Web/i,        'Claude-Web',        'Anthropic',  'crawler'],
  [/Claude-User/i,       'Claude-User',       'Anthropic',  'assistant'],
  [/anthropic-ai/i,      'anthropic-ai',      'Anthropic',  'crawler'],
  [/PerplexityBot/i,     'PerplexityBot',     'Perplexity', 'crawler'],
  [/Perplexity-User/i,   'Perplexity-User',   'Perplexity', 'assistant'],
  [/Google-Extended/i,   'Google-Extended',   'Google',     'crawler'],
  [/Googlebot/i,         'Googlebot',         'Google',     'crawler'],
  [/Google-CloudVertexBot/i, 'Vertex',        'Google',     'crawler'],
  [/Applebot-Extended/i, 'Applebot-Extended', 'Apple',      'crawler'],
  [/Applebot/i,          'Applebot',          'Apple',      'crawler'],
  [/Amazonbot/i,         'Amazonbot',         'Amazon',     'crawler'],
  [/meta-externalagent/i, 'Meta-ExternalAgent', 'Meta',     'crawler'],
  [/facebookexternalhit/i, 'facebookexternalhit', 'Meta',   'crawler'],
  [/bingbot/i,           'BingBot',           'Microsoft',  'crawler'],
  [/CCBot/i,             'CCBot',             'Common Crawl', 'crawler'],
  [/Bytespider/i,        'Bytespider',        'ByteDance',  'crawler'],
  [/DeepSeek/i,          'DeepSeekBot',       'DeepSeek',   'crawler'],
  [/MistralAI-User/i,    'MistralAI-User',    'Mistral',    'assistant'],
  [/cohere-ai/i,         'cohere-ai',         'Cohere',     'crawler'],
  [/YouBot/i,            'YouBot',            'You.com',    'crawler'],
  [/Diffbot/i,           'Diffbot',           'Diffbot',    'crawler'],
  [/Baiduspider/i,       'Baiduspider',       'Baidu',      'crawler'],
  [/YandexBot/i,         'YandexBot',         'Yandex',     'crawler'],
  [/DuckDuckBot/i,       'DuckDuckBot',       'DuckDuckGo', 'crawler'],

  // Coding agents and AI editors. These are the clients this site is most written FOR
  // — they read a package's reference while someone is typing against it — and they
  // are the reason the split above cannot stop at the search-and-training brands.
  //
  // Matched on a distinctive token rather than a full UA string because these tools
  // change their UA freely between releases. A token that stops appearing costs a row
  // that reads zero, which is visible; a token that is too broad would silently
  // mislabel, so they are kept narrow and anchored where the word is a common one.
  // Anything not matched here still lands as `unclassified` and is counted — see
  // classifyKind — so a missing tool understates the breakdown, never the total.
  [/claude-code/i,       'Claude Code',       'Anthropic',  'assistant'],
  [/\bCursor\b/i,        'Cursor',            'Cursor',     'assistant'],
  [/Windsurf/i,          'Windsurf',          'Windsurf',   'assistant'],
  [/Codeium/i,           'Codeium',           'Windsurf',   'assistant'],
  [/Copilot/i,           'Copilot',           'GitHub',     'assistant'],
  [/\bCline\b/i,         'Cline',             'Cline',      'assistant'],
  [/\bAider\b/i,         'Aider',             'Aider',      'assistant'],
  [/\bDevin\b/i,         'Devin',             'Cognition',  'assistant'],
  [/\bZed\b/i,           'Zed',               'Zed',        'assistant'],

  // Not a crawler brand but the most interesting row on the report: a plain HTTP
  // client asking for markdown is very likely an agent following the convention,
  // including this project's own MCP server's get_doc. Kind is left to the path,
  // because the same client fetching an HTML page could be anything.
  [/^(node|undici|axios|python-requests|httpx|aiohttp|Go-http-client|curl|wget)/i,
    'http-client', 'Generic client', null],
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

// Surfaces that exist ONLY for agents, used to classify a client we cannot name.
// robots.txt and sitemap*.xml are deliberately absent even though they are part of
// AGENT_SURFACE: those are what search crawlers and uptime monitors fetch, so they
// say nothing about who is asking. The markdown and the symbol index say a lot —
// no browser and no ordinary crawler asks for those on purpose.
const AGENT_ONLY = new Set([
  'markdown-mirror',
  'llms.txt',
  'llms-full.txt',
  'symbol-index',
]);

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/** Which crawler family a user-agent belongs to, or null for anything else. */
export function classifyCrawler(userAgent) {
  if (!userAgent) {
    // A request with no UA at all is not a browser. Worth counting, worth naming —
    // and worth leaving to the path, since it could be a script or a stripped agent.
    return { crawler: 'no-user-agent', operator: 'Unidentified', kind: null };
  }

  for (const [re, crawler, operator, kind] of CRAWLERS) {
    if (re.test(userAgent)) return { crawler, operator, kind };
  }

  return null;
}

/**
 * Which audience a request belongs to: 'assistant', 'crawler' or 'unknown'.
 *
 * 'human' is never returned here. A person in a browser runs gtag, which reports
 * itself, and this module deliberately skips those requests — see rule 2.
 *
 * When the user-agent names a family, that family's own answer wins. When it does not,
 * the PATH decides: a client nobody recognises that asked for llms.txt or a .md mirror
 * is an assistant on the balance of evidence, because those files exist for no other
 * caller. Everything else left over is 'unknown' rather than being folded into either
 * real bucket, so neither number is inflated by a guess.
 *
 * @param {{kind: string|null}|null} found Result of classifyCrawler.
 * @param {string|null} surface Result of classifySurface.
 * @returns {string} The audience bucket.
 */
export function classifyKind(found, surface) {
  if (found && found.kind) {
    return found.kind;
  }

  return AGENT_ONLY.has(surface) ? 'assistant' : 'unknown';
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
 * kind, crawler, operator, surface, status, visit_id — must each be registered as an
 * event-scoped custom dimension in Admin → Custom definitions before they can be used
 * as report dimensions. They show up in DebugView and Realtime immediately either way,
 * which makes the difference easy to misread: REGISTRATION IS NOT RETROACTIVE, so an
 * unregistered parameter is being thrown away for reporting even while you can watch
 * it arrive. All six are registered on the imqueue.org property.
 */
export function buildEvent({ url, userAgent, status, edition, now = Date.now() }) {
  const found = classifyCrawler(userAgent);
  const surface = classifySurface(url.pathname);

  // Rule 2: a browser on a normal page is gtag's job, not ours.
  if (!found && !surface) return null;

  const crawler = found ? found.crawler : 'unclassified';
  const operator = found ? found.operator : 'Unidentified';

  // A crawler family per half hour. Rule 4 rules out the two fields that would make
  // this a real visit — the address and the UA — so this is the finest grain available
  // without identifying anyone. It is honest about what it is: two GPTBot fetches 40
  // minutes apart are two "visits", and a hundred in one minute are one, no matter how
  // many machines OpenAI ran them from.
  const session = `${slug(crawler)}-${Math.floor(now / 1800000)}`;

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
        session_id: session,
        engagement_time_msec: 1,
        crawler,
        operator,
        kind: classifyKind(found, surface),
        // 'html' rather than null so the dimension is never (not set): a crawler
        // reading the HTML page instead of the mirror is exactly what you want to
        // be able to filter on.
        surface: surface || 'html',
        status: String(status),
        edition,
        // The same value again under a name GA4 will hand back as a dimension.
        // session_id above is consumed for sessionisation and is NOT reportable:
        // its own name and every ga_-prefixed spelling are refused as custom
        // dimensions ("Parameter name is not allowed for this scope"). Reporting
        // needs one row per visit for the one thing GA4 cannot aggregate — the
        // minimum and maximum of anything — so it is sent twice under two names.
        visit_id: session,
      },
    }],
  };
}

/**
 * The `x-agent-analytics` header value for a request, or null when the request should
 * not carry one.
 *
 * Always on, no variable to set. "Is the site sending events?" is otherwise only
 * answerable by touring dashboards, and GA4's reports cannot distinguish "never sent"
 * from "sent and rejected" from "sent to a property you are not looking at" — so a
 * diagnostic that needs a redeploy to switch on is unavailable exactly when it is
 * wanted. This makes the server-side half one curl, permanently:
 *
 *   curl -sI -A 'GPTBot/1.2' https://imqueue.org/llms.txt | grep x-agent-analytics
 *
 * Restricted to the AGENT SURFACE — llms.txt, the .md mirrors, the symbol index —
 * for two reasons. Attaching a header means rebuilding the response (the one from
 * next() has immutable headers), and this middleware fronts every request to both
 * sites: pages, CSS, fonts, images. Those are exactly the requests this returns null
 * for, so the rebuild never touches the traffic that dominates. And HTML pages are
 * already measured for the audience that reads them, by gtag in the browser.
 *
 * Note that is narrower than what gets SENT: a crawler fetching an HTML page is
 * tracked (it runs no JavaScript, so gtag never sees it) but gets no header. The
 * header is a diagnostic, not a mirror of the policy.
 *
 * Reuses buildEvent and the same credential guard as trackRequest rather than
 * restating the policy — if that guard changes, change it here too.
 */
export function headerNote({ request, env, url, status, edition }) {
  if (!classifySurface(url.pathname)) return null;

  if (!env || !env.GA4_MP_MEASUREMENT_ID || !env.GA4_MP_API_SECRET) {
    return 'off reason=not-configured';
  }

  const event = buildEvent({
    url,
    userAgent: request.headers.get('user-agent'),
    status,
    edition,
  });

  if (!event) return 'skipped reason=gtag-covers-this';

  const p = event.events[0].params;

  return `sent kind=${p.kind} crawler=${p.crawler} surface=${p.surface} status=${p.status} edition=${p.edition}`;
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

  // The secret goes in the QUERY STRING because that is the only form the Measurement
  // Protocol accepts — no header auth, no body field. Server-to-server over TLS, so it
  // is never exposed to a browser or a network observer, and the credential is
  // write-only to one property and revocable in GA4 at any time.
  //
  // The one way it can still leak is OUR OWN LOGS: never log this URL, and never
  // interpolate a fetch error verbatim, because the message can echo it. The debug
  // branch below logs the site's pathname and GA4's verdict, never the endpoint.
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
