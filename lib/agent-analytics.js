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
// 1. ONE PROPERTY, SEPARATE EVENT NAME. This used to say "point GA4_MP_MEASUREMENT_ID at
//    a property that is NOT the one in the site's <head>", to keep robots out of the
//    human numbers. That is no longer how it works: both streams land in the imqueue.org
//    property so that one report can cover every audience, and the separation is done by
//    EVENT NAME instead. gtag sends page_view; everything here sends srv_page_view. GA4's
//    `Views` metric counts only page_view/screen_view, so the two can never be summed by
//    accident — which is what the separate property was really protecting against.
//
// 2. COUNT EVERY REQUEST WORTH COUNTING, INCLUDING BROWSERS. Also changed (2026-08-03):
//    this used to skip browsers entirely on the grounds that gtag had them. It does not —
//    gtag only has the ones who accept the cookie banner, which is roughly half. So a
//    browser fetching a DOCUMENT is now counted here too, giving a complete total that
//    does not depend on a consent rate.
//    What is still skipped, and must stay skipped: subresources. The middleware fronts
//    every stylesheet, script, font and image on both sites, and counting those would turn
//    one page view into a dozen events. isDocumentRequest() is that gate.
//
// 3. NEVER FORWARD THE CRAWLER'S USER-AGENT. GA4 drops traffic it identifies as a
//    bot from the IAB list, and the Measurement Protocol only knows the UA if you
//    hand it over — which would silently discard the entire dataset. The crawler is
//    carried as an ordinary event parameter instead, so it is analysable rather than
//    a filter key.
//
// 4. A SALTED DIGEST FOR PEOPLE, A FAMILY LABEL FOR ROBOTS. This rule used to read "NO IP,
//    NO FINGERPRINT ... no hashing of addresses that would only pretend not to identify".
//    The owner reversed it on 2026-08-03, for a reason the old rule had no answer to:
//    unique visitors cannot be counted without an identifier, and refusing one meant the
//    only number the owner actually wanted was permanently unavailable.
//    What keeps it defensible: the address is hashed with a SECRET salt and never stored or
//    logged, nothing is written to the visitor's device (so ePrivacy Art. 5(3) — the cookie
//    consent rule — does not engage at all), and crawlers keep a family label because a
//    per-address digest for a rotating bot fleet is noise. What it costs: the id is
//    pseudonymous personal data, persistent by design, needs Art. 6(1)(f) legitimate
//    interest, and must be disclosed in /privacy/. See lib/visitor-id.js for the full
//    reasoning, including why the salt is not optional and why it does not rotate.
//
// 5. FAIL OPEN AND INERT BY DEFAULT. With the env vars unset this module does
//    nothing at all, so a fork or a preview deploy sends no traffic anywhere. Without
//    VISITOR_SALT it still reports robots but counts no people. The caller wraps it and
//    never awaits it — see functions/_middleware.js.

import { visitorId } from './visitor-id.js';

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
  [/GPTBot/i,            'GPTBot',            'OpenAI',     'ai.training'],
  [/ChatGPT-User/i,      'ChatGPT-User',      'OpenAI',     'assistant.chat'],
  [/OAI-SearchBot/i,     'OAI-SearchBot',     'OpenAI',     'ai.search'],
  [/ClaudeBot/i,         'ClaudeBot',         'Anthropic',  'ai.training'],
  // Judgement call: Claude-Web was the user-triggered fetcher before Claude-User
  // existed, and Anthropic's own docs no longer describe it. Filed as ai.search on the
  // grounds that it retrieved to answer rather than to train. Low volume; revisit if
  // it ever isn't.
  [/Claude-Web/i,        'Claude-Web',        'Anthropic',  'ai.search'],
  [/Claude-User/i,       'Claude-User',       'Anthropic',  'assistant.chat'],
  [/anthropic-ai/i,      'anthropic-ai',      'Anthropic',  'ai.training'],
  [/PerplexityBot/i,     'PerplexityBot',     'Perplexity', 'ai.search'],
  [/Perplexity-User/i,   'Perplexity-User',   'Perplexity', 'assistant.chat'],
  // Google-Extended is not a crawler at all — it is the token that governs whether
  // Googlebot's existing fetch may be used for Gemini training. It appears here so the
  // row exists; its kind describes the purpose it controls.
  [/Google-Extended/i,   'Google-Extended',   'Google',     'ai.training'],
  [/Googlebot/i,         'Googlebot',         'Google',     'search'],
  [/Google-CloudVertexBot/i, 'Vertex',        'Google',     'ai.search'],
  [/Applebot-Extended/i, 'Applebot-Extended', 'Apple',      'ai.training'],
  [/Applebot/i,          'Applebot',          'Apple',      'search'],
  // Judgement call: Amazonbot serves both Alexa answers and shopping crawls, and the
  // UA does not say which. `search` is the less flattering of the two readings.
  [/Amazonbot/i,         'Amazonbot',         'Amazon',     'search'],
  [/meta-externalagent/i, 'Meta-ExternalAgent', 'Meta',     'ai.training'],
  // Not analytics traffic at all: someone pasted a link into Facebook or Messenger and
  // it fetched the page to build a preview card. One hit per paste, no reader attached.
  [/facebookexternalhit/i, 'facebookexternalhit', 'Meta',   'infra'],
  [/bingbot/i,           'BingBot',           'Microsoft',  'search'],
  [/CCBot/i,             'CCBot',             'Common Crawl', 'ai.training'],
  [/Bytespider/i,        'Bytespider',        'ByteDance',  'ai.training'],
  [/DeepSeek/i,          'DeepSeekBot',       'DeepSeek',   'ai.training'],
  [/MistralAI-User/i,    'MistralAI-User',    'Mistral',    'assistant.chat'],
  [/cohere-ai/i,         'cohere-ai',         'Cohere',     'ai.training'],
  [/YouBot/i,            'YouBot',            'You.com',    'ai.search'],
  // Judgement call: Diffbot is a commercial web-data extractor. Not training a model of
  // its own, but the outcome for us is the same — the page becomes someone's dataset.
  [/Diffbot/i,           'Diffbot',           'Diffbot',    'ai.training'],
  [/Baiduspider/i,       'Baiduspider',       'Baidu',      'search'],
  [/YandexBot/i,         'YandexBot',         'Yandex',     'search'],
  [/DuckDuckBot/i,       'DuckDuckBot',       'DuckDuckGo', 'search'],

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
  //
  // `assistant.ide` is the row this whole taxonomy exists to expose: a coding agent
  // reading a package reference while a developer types against it. That is the reader
  // this site is written for, and it used to be averaged in with people asking a chatbot
  // a general question.
  [/claude-code/i,       'Claude Code',       'Anthropic',  'assistant.ide'],
  [/\bCursor\b/i,        'Cursor',            'Cursor',     'assistant.ide'],
  [/Windsurf/i,          'Windsurf',          'Windsurf',   'assistant.ide'],
  [/Codeium/i,           'Codeium',           'Windsurf',   'assistant.ide'],
  [/Copilot/i,           'Copilot',           'GitHub',     'assistant.ide'],
  [/\bCline\b/i,         'Cline',             'Cline',      'assistant.ide'],
  [/\bAider\b/i,         'Aider',             'Aider',      'assistant.ide'],
  [/\bDevin\b/i,         'Devin',             'Cognition',  'assistant.ide'],
  [/\bZed\b/i,           'Zed',               'Zed',        'assistant.ide'],

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
 * Which audience a request belongs to. Dotted values so a report can group with one
 * "contains" filter instead of a second dimension:
 *
 *   user             a browser — somebody is looking at it
 *   assistant.ide    coding agent, developer typing right now
 *   assistant.chat   AI fetching for a live conversation
 *   assistant.other  unnamed client on a path only agents ask for
 *   ai.search        index behind AI answers — where citations come from
 *   ai.training      corpus collection; no traffic today, weights tomorrow
 *   search           classic web search indexing
 *   infra            monitors, link previews, plain HTTP clients
 *   unknown          genuinely unclassified — the "add a pattern" queue
 *
 * `contains "assistant."` is everything with a person waiting; `contains "ai."` is
 * machine consumption; `search` is the one that sends humans back.
 *
 * This replaced a flat human/assistant/crawler/unknown on 2026-08-03. The old `crawler`
 * merged three outcomes that matter completely differently to a docs site — Google
 * indexing you sends readers, GPTBot training on you sends nothing today, OAI-SearchBot
 * indexing you produces citations — and one label hid all three.
 *
 * When the user-agent names a family, that family's own answer wins. When it does not:
 * a real browser asking for a document is `user`; an unnamed client on an agent-only
 * path is `assistant.other`, on the balance of evidence, because nothing else fetches
 * those files on purpose; everything left over is `unknown` rather than being folded
 * into a real bucket, so no number is inflated by a guess.
 *
 * @param {{kind: string|null}|null} found Result of classifyCrawler.
 * @param {string|null} surface Result of classifySurface.
 * @param {boolean} [browser] Request looks like a browser fetching a document.
 * @returns {string} The audience bucket.
 */
export function classifyKind(found, surface, browser = false) {
  if (found && found.kind) {
    return found.kind;
  }

  // Only when nothing named the client. A crawler that happens to send Sec-Fetch-Dest
  // must never outrank its own UA match.
  if (!found && browser) {
    return 'user';
  }

  return AGENT_ONLY.has(surface) ? 'assistant.other' : 'unknown';
}

/**
 * Does this request look like a browser fetching a DOCUMENT?
 *
 * This is the gate that keeps the human count from becoming a flood. The middleware
 * fronts every request to both sites — stylesheets, scripts, fonts, images — and once
 * browsers are counted at all, anything less specific than "document" turns each page
 * view into a dozen events and the numbers into noise.
 *
 * Sec-Fetch-Dest is the reliable signal: every current browser sends `document` for a
 * navigation and something else (`style`, `script`, `font`, `image`) for a subresource.
 * The Accept fallback covers clients that send no Sec-Fetch headers at all — assets ask
 * for `text/css` or `image/*`, so they still fall out.
 *
 * Deliberately NOT a check on the path. Extension lists rot, and `/api/core/latest/` has
 * no extension at all.
 *
 * @param {{headers: {get: (name: string) => string|null}}} request
 * @returns {boolean}
 */
export function isDocumentRequest(request) {
  const dest = request.headers.get('sec-fetch-dest');

  if (dest) {
    return dest === 'document';
  }

  return (request.headers.get('accept') || '').includes('text/html');
}

/**
 * Everything about a request that can be decided without async work: who, what, and
 * whether it is ours to count at all. Returns null for the requests this module skips.
 *
 * Split out from buildEvent so the diagnostic header stays synchronous — buildEvent has
 * to await the visitor digest, and making the middleware await it before it can attach a
 * header would put a hash on the critical path of a page it is only describing.
 */
export function describe({ url, userAgent, isDocument = false }) {
  const found = classifyCrawler(userAgent);
  const surface = classifySurface(url.pathname);

  // A named client is whatever it is named; `browser` only applies to the leftovers.
  // Mozilla/ is in every real browser's UA and absent from curl, wget and most tools.
  const browser = !found && isDocument && /Mozilla\//.test(userAgent || '');

  // Nothing to count: not a recognised client, not the agent surface, not a document.
  // This is where every stylesheet, font and image leaves.
  if (!found && !surface && !browser) {
    return null;
  }

  return {
    crawler: found ? found.crawler : (browser ? 'browser' : 'unclassified'),
    operator: found ? found.operator : (browser ? 'Browser' : 'Unidentified'),
    kind: classifyKind(found, surface, browser),
    surface: surface || 'html',
    browser,
  };
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
export async function buildEvent({
  url, userAgent, status, edition, ip, salt, isDocument = false, now = Date.now(),
}) {
  const seen = describe({ url, userAgent, isDocument });

  if (!seen) return null;

  const { crawler, operator, kind, surface, browser } = seen;

  // A real visitor id for browsers, a family label for everything else.
  //
  // For a person the digest is the whole point: it makes unique visitors countable, and
  // it makes SESSIONS real, so views-per-visit and duration mean something on this stream
  // instead of being an artefact of bucketing. For a crawler it would be noise — GPTBot
  // arrives from a rotating fleet and each address is a different "visitor" that is really
  // the same robot — so crawlers keep the family identity they had.
  const visitor = browser ? await visitorId({ ip, userAgent, salt }) : null;

  // No salt, no human counting. Deliberate: better to count no people than to invent a
  // weaker identifier for them. See lib/visitor-id.js.
  if (browser && !visitor) return null;

  // Per visitor per half hour for a person; per crawler family per half hour otherwise.
  // The crawler case is honest about what it is: two GPTBot fetches 40 minutes apart are
  // two "visits" and a hundred in one minute are one, however many machines ran them.
  const session = `${visitor ? visitor.slice(0, 16) : slug(crawler)}-${Math.floor(now / 1800000)}`;

  return {
    client_id: visitor || `${slug(operator)}.${slug(crawler)}`,
    events: [{
      // NOT page_view. gtag owns that name, and GA4's `Views` metric counts only
      // page_view/screen_view — so a browser that consents is reported twice, once by
      // gtag and once from here, and `Views` would read ~140% of reality with no single
      // true number anywhere in the property. A distinct name makes the two streams
      // incapable of being added up by accident: `Views` stays gtag's, and everything the
      // server saw is Event count of this. The cost is that GA4's built-in Pages and
      // Landing-page reports no longer include it; `page_location` is still sent so a
      // free-form exploration can do that job.
      name: 'srv_page_view',
      params: {
        page_location: url.href,
        page_title: url.pathname,
        // GA4 needs both of these or the event lands without a session and the
        // engagement metrics read as zero.
        session_id: session,
        engagement_time_msec: 1,
        crawler,
        operator,
        kind,
        // 'html' rather than null so the dimension is never (not set): a crawler
        // reading the HTML page instead of the mirror is exactly what you want to
        // be able to filter on.
        surface,
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
 * Note that is narrower than what gets SENT: a crawler fetching an HTML page, and now any
 * browser fetching one, are both tracked but get no header. The header is a diagnostic,
 * not a mirror of the policy.
 *
 * Uses describe() rather than buildEvent so it stays synchronous — buildEvent has to await
 * the visitor digest, and a hash has no business on the critical path of a response this
 * only annotates. Same credential guard as trackRequest; if that changes, change it here.
 */
export function headerNote({ request, env, url, status, edition }) {
  if (!classifySurface(url.pathname)) return null;

  if (!env || !env.GA4_MP_MEASUREMENT_ID || !env.GA4_MP_API_SECRET) {
    return 'off reason=not-configured';
  }

  const seen = describe({
    url,
    userAgent: request.headers.get('user-agent'),
    isDocument: isDocumentRequest(request),
  });

  if (!seen) return 'skipped reason=subresource';

  // `salt=` is the one thing this cannot infer from describe(): a browser is reported as
  // kind=user here, but with no VISITOR_SALT configured buildEvent will drop it. Saying so
  // is the difference between "the deployment is fine" and half an hour in the dashboards.
  const salted = Boolean(env.VISITOR_SALT);

  return `sent kind=${seen.kind} crawler=${seen.crawler} surface=${seen.surface} ` +
    `status=${status} edition=${edition} salt=${salted ? 'set' : 'MISSING'}`;
}

/**
 * Send one request's event. Always returns a promise for the caller to hand to
 * waitUntil; it resolves immediately when there is nothing to send — no credentials, a
 * subresource, or a browser with no salt configured. Async because the visitor digest is
 * (crypto.subtle), which is why it no longer returns null for "nothing to do".
 *
 * `env.GA4_MP_DEBUG` routes to GA4's validation endpoint and logs what it says.
 * Use it once while setting this up, reading the output in the Pages project's
 * function logs, then unset it — the validation endpoint reports problems but
 * RECORDS NOTHING, so leaving it on means collecting no data at all. (It is not
 * DebugView, which needs the normal endpoint and a debug_mode parameter; validation
 * is the more useful half here because a malformed hit is otherwise accepted with a
 * 2xx and silently dropped.)
 */
export async function trackRequest({ request, env, url, status, edition }) {
  const id = env && env.GA4_MP_MEASUREMENT_ID;
  const secret = env && env.GA4_MP_API_SECRET;

  if (!id || !secret) return; // Rule 5: inert until configured.

  const body = await buildEvent({
    url,
    userAgent: request.headers.get('user-agent'),
    // cf-connecting-ip is Cloudflare's own header and cannot be spoofed by the client;
    // x-forwarded-for can be, so it is deliberately not consulted. Goes straight into the
    // digest and is never stored or logged — see lib/visitor-id.js.
    ip: request.headers.get('cf-connecting-ip'),
    salt: env.VISITOR_SALT,
    isDocument: isDocumentRequest(request),
    status,
    edition,
  });

  if (!body) return;

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
