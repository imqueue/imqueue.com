// scripts/security/active.ts — the NIST "Attack" / PTES "Exploitation" phase. Every
// probe here is NON-DESTRUCTIVE: no data is changed, no availability test is run, and
// — the one that matters for this site — no mail is ever sent. The two email
// endpoints are exercised only through paths that cannot reach the mail provider:
// on the live edge every POST trips the honeypot (which returns ok WITHOUT sending),
// and locally there is no RESEND_API_KEY so the send path returns a config error.
// A researcher's own site is in scope; sending its owner spam is not.

import { connect as tlsConnect } from "node:tls";
import { resolveTxt } from "node:dns/promises";

import type { Report, Sink } from "./lib.ts";
import { rule, SENSITIVE_PATHS } from "./policy.ts";
import { discoverFunctions } from "./discovery.ts";
import type { FetchResult, Target } from "./target.ts";

/* ---- shared helpers -------------------------------------------------------- */

interface Occurrence {
  loc: string;
  detail?: string;
}

function aggregate(sink: Sink, ruleId: string, occ: Occurrence[]): void {
  if (!occ.length) {
    sink.pass(ruleId);
    return;
  }
  const sample = occ
    .slice(0, 6)
    .map((o) => (o.detail ? `${o.loc} (${o.detail})` : o.loc))
    .join("; ");
  sink.add(rule(ruleId), { evidence: `${occ.length} occurrence(s); e.g. ${sample}` });
}

// Signatures of a leaked stack trace / internal path in a response body.
const STACK_SIGNS = [
  /\bat\s+[\w.$]+\s+\(/, // "at Object.<anonymous> ("
  /\n\s+at\s+\//, // "   at /abs/path"
  /\/functions\//,
  /node:internal/,
  /\w+\.ts:\d+:\d+/,
  /\bTypeError\b|\bReferenceError\b/,
];

const looksLikeStack = (body: string): boolean => STACK_SIGNS.some((re) => re.test(body));

/** Build an endpoint body that is guaranteed not to send mail on a live target. */
function safeBody(target: Target, fields: Record<string, unknown>): string {
  // company_url is the honeypot: any value makes the endpoint return {ok:true}
  // BEFORE the mail provider is touched. Forced on remote; harmless locally.
  const body = target.kind === "remote" ? { ...fields, company_url: "https://scanner.invalid/" } : fields;
  return JSON.stringify(body);
}

const JSON_HEADERS = { "content-type": "application/json" };

/* ---- exposure of sensitive files ------------------------------------------- */

export async function checkExposure(target: Target, sink: Sink): Promise<void> {
  const leaks: Occurrence[] = [];
  const maps: Occurrence[] = [];
  const listings: Occurrence[] = [];

  for (const p of SENSITIVE_PATHS) {
    const res = await target.fetch(p);

    // A real 200 with a non-empty body means the file is served. Redirects and 404s
    // are the expected, safe answers.
    if (res.status === 200 && res.body.trim().length > 0) {
      const target_rule = p.endsWith(".map") ? "exposure/source-map" : "exposure/sensitive-file";
      (target_rule === "exposure/source-map" ? maps : leaks).push({
        loc: p,
        detail: `200 ${res.contentType || ""}`.trim(),
      });
    }
  }

  // A directory that has no index must 404, not list. Reported under its own rule
  // (exposure/directory-listing) rather than lumped in with served sensitive files.
  for (const dir of ["/js/", "/images/", "/fonts/"]) {
    const res = await target.fetch(dir);
    if (res.status === 200 && /<title>Index of|Directory listing/i.test(res.body)) {
      listings.push({ loc: dir, detail: "directory listing" });
    }
  }

  aggregate(sink, "exposure/sensitive-file", leaks);
  aggregate(sink, "exposure/source-map", maps);
  aggregate(sink, "exposure/directory-listing", listings);
}

/* ---- HTTP method tampering ------------------------------------------------- */

export async function checkMethods(target: Target, sink: Sink): Promise<void> {
  const { endpoints } = discoverFunctions();
  // The two form endpoints, root, and every discovered /api route — so a newly
  // generated package is method-probed automatically (S1), not just the hardcoded two.
  const paths = [...new Set(["/", "/api/contact", "/api/message", ...endpoints])];
  // fetch() refuses CONNECT/TRACE/TRACK, which is also what a browser does, so they
  // are effectively untestable from here — the ones a client can actually send are.
  const methods = ["PUT", "DELETE", "PATCH"];
  const dangerous: Occurrence[] = [];
  const stacks: Occurrence[] = [];

  // TRACE/TRACK/CONNECT cannot be sent by fetch() (a browser refuses them too), so the
  // harness genuinely cannot exercise them — recorded as not-exercised, not as a pass.
  sink.skip("method/dangerous@trace", "TRACE/TRACK/CONNECT are not sendable via fetch() (browser-blocked); only PUT/DELETE/PATCH are exercised");

  for (const p of paths) {
    for (const method of methods) {
      let res: FetchResult;
      try {
        res = await target.fetch(p, { method });
      } catch {
        continue; // client refused to send it
      }
      if (res.status >= 200 && res.status < 300) {
        dangerous.push({ loc: p, detail: `${method} → ${res.status}` });
      }
      if (looksLikeStack(res.body)) stacks.push({ loc: `${method} ${p}`, detail: `${res.status}` });
    }
  }

  aggregate(sink, "method/dangerous", dangerous);
  aggregate(sink, "disclosure/stack-trace", stacks);
}

/* ---- CORS ------------------------------------------------------------------ */

export async function checkCors(target: Target, sink: Sink): Promise<void> {
  const evil = "https://scanner.example";
  // Two severities: reflecting the Origin (or wildcard WITH credentials) is
  // dangerous; a bare wildcard on public, cookieless content is low-risk but worth
  // confirming — so they are reported apart.
  const dangerous: Occurrence[] = [];
  const wildcard: Occurrence[] = [];

  const probe = async (p: string, method: string, extra: Record<string, string> = {}) => {
    const res = await target.fetch(p, { method, headers: { origin: evil, ...extra } });
    const acao = res.headers.get("access-control-allow-origin");
    const acac = res.headers.get("access-control-allow-credentials");

    if (!acao) return;

    if (acao === evil || acao.includes("scanner.example")) {
      dangerous.push({ loc: p, detail: `ACAO reflects Origin (${acao})` });
    } else if (acao === "*" && acac === "true") {
      dangerous.push({ loc: p, detail: "ACAO: * with Allow-Credentials: true" });
    } else if (acao === "*") {
      wildcard.push({ loc: p, detail: "ACAO: *" });
    }
  };

  await probe("/", "GET");
  // Preflight against the email endpoint.
  await probe("/api/message", "OPTIONS", { "access-control-request-method": "POST" });

  aggregate(sink, "cors/permissive", dangerous);
  aggregate(sink, "cors/wildcard", wildcard);
}

/* ---- input handling: reflection, injection, error shape ------------------- */

const XSS = '<script>alert(1)</script>';
const PAYLOADS = [
  XSS,
  '"><img src=x onerror=alert(1)>',
  "{{7*7}}",
  "${7*7}",
  "'; DROP TABLE users;--",
  "../../../../etc/passwd",
];

export async function checkInjection(target: Target, sink: Sink): Promise<void> {
  const reflected: Occurrence[] = [];
  const echoed: Occurrence[] = [];
  const stacks: Occurrence[] = [];
  const badStatus: Occurrence[] = [];

  // 1. Malformed JSON must be a clean 400, never a 500 with a stack.
  for (const p of ["/api/contact", "/api/message"]) {
    const res = await target.fetch(p, { method: "POST", headers: JSON_HEADERS, body: "{ this is not json" });
    if (res.status >= 500) badStatus.push({ loc: p, detail: `malformed JSON → ${res.status}` });
    if (looksLikeStack(res.body)) stacks.push({ loc: p, detail: "malformed JSON body" });
  }

  // 2. A JSON literal `null` (valid JSON, not an object) must also be a 400.
  for (const p of ["/api/contact", "/api/message"]) {
    const res = await target.fetch(p, { method: "POST", headers: JSON_HEADERS, body: "null" });
    if (res.status >= 500) badStatus.push({ loc: p, detail: `null body → ${res.status}` });
    if (looksLikeStack(res.body)) stacks.push({ loc: p, detail: "null body" });
  }

  // 3. Payloads in fields must not come back in the response body (reflected XSS),
  //    and must not be echoed verbatim (injection echo).
  for (const payload of PAYLOADS) {
    const body = safeBody(target, {
      name: payload,
      email: "probe@scanner.invalid",
      subject: payload,
      message: payload,
    });
    const res = await target.fetch("/api/message", { method: "POST", headers: JSON_HEADERS, body });

    if (res.body.includes(XSS) && payload === XSS) {
      reflected.push({ loc: "/api/message", detail: "XSS payload reflected unescaped" });
    } else if (res.body.includes(payload) && payload.length > 6) {
      echoed.push({ loc: "/api/message", detail: `echoes: ${payload.slice(0, 24)}` });
    }
    if (looksLikeStack(res.body)) stacks.push({ loc: "/api/message", detail: "payload body" });
  }

  // 4. Reflected XSS via a request path (the 404 page must not echo it).
  const pathXss = await target.fetch(`/${encodeURIComponent(XSS)}`);
  if (pathXss.body.includes(XSS)) reflected.push({ loc: "404 path", detail: "path reflected into 404" });

  // 5. /search/ renders results in the BROWSER from a static page; the server never
  //    echoes the query, so asserting on the server body proved nothing (it always
  //    passed). That assurance is false, so the server-side assertion is dropped — the
  //    real DOM-XSS coverage lives in the Playwright e2e suite (search-page.spec.ts).
  sink.skip("input/xss-reflected@search", "/search reflects the query client-side only; DOM-XSS is covered by tests/e2e/specs/search-page.spec.ts, not observable from a server-body grep");

  // 6. Email header (CR/LF) injection — defense-in-depth (O1). No live vuln expected:
  //    values reach Resend as JSON, and isEmail() rejects whitespace. The probe sends a
  //    CR/LF payload and confirms it neither crashes the endpoint nor is reflected into
  //    a RESPONSE header (a header-shaped echo would be the tell).
  const crlf = "probe\r\nBcc: injected@scanner.invalid";
  const mailProbe = safeBody(target, {
    name: crlf,
    email: "probe@scanner.invalid",
    subject: crlf,
    message: "crlf probe",
  });
  const mailRes = await target.fetch("/api/message", { method: "POST", headers: JSON_HEADERS, body: mailProbe });
  // The genuine injection signal is a CR/LF field VALUE surfacing as a response header
  // (a header the endpoint never sets, or an injected value inside one). A 5xx is NOT
  // used here: locally a valid submission always 500s ("Mail service is not
  // configured", no RESEND_API_KEY) — that is the config path, not a CR/LF crash, and
  // treating it as one is a false positive. A real unhandled crash still shows as a
  // stack in the body, which looksLikeStack catches.
  const headerEcho =
    [...mailRes.headers.keys()].some((k) => /^bcc$|injected/i.test(k)) ||
    [...mailRes.headers.values()].some((v) => v.includes("injected@scanner.invalid"));
  if (headerEcho) {
    sink.add(rule("input/mail-header-injection"), {
      location: "/api/message",
      evidence: "a CR/LF field value appeared in a response header",
    });
  } else if (looksLikeStack(mailRes.body)) {
    sink.add(rule("input/mail-header-injection"), {
      location: "/api/message",
      evidence: "CR/LF field value produced a stack trace (unhandled input)",
    });
  } else {
    sink.pass("input/mail-header-injection");
  }

  // On remote the email POST is honeypot-shadowed (it returns ok BEFORE the fields are
  // processed), so an echo bug in the mail path is not observable there — record the
  // echo assertions as not-exercised on remote rather than a hollow pass.
  if (target.kind === "remote") {
    sink.skip("input/injection-echo", "email endpoint is honeypot-shadowed on remote (returns ok before processing fields); echo behaviour is exercised locally");
  }

  aggregate(sink, "input/xss-reflected", reflected);
  if (target.kind === "local") aggregate(sink, "input/injection-echo", echoed);
  aggregate(sink, "disclosure/stack-trace", stacks);
  aggregate(sink, "disclosure/verbose-error-500", badStatus);
}

/* ---- oversized body -------------------------------------------------------- */

export async function checkOversized(target: Target, sink: Sink): Promise<void> {
  // Only assert on local, where no mail can be sent by any path: a valid message
  // with an attachment over the 5 MB cap must be refused with a 4xx BEFORE the mail
  // provider is called — never a 500, never a silent accept. On remote the honeypot
  // short-circuits before attachments are read, so the cap is not observable without
  // risking a send; it is asserted locally instead.
  if (target.kind !== "local") {
    sink.skip("input/oversized-accepted", "the 5 MB attachment cap is asserted locally only; on remote the honeypot short-circuits before attachments are read, so the cap is not observable without risking a send");
    return;
  }

  const bigBase64 = "QQ".repeat(3_500_000); // ~7 MB of base64 → ~5.25 MB decoded, over the 5 MB cap
  const body = JSON.stringify({
    name: "Probe",
    email: "probe@scanner.invalid",
    subject: "oversized",
    message: "oversized attachment probe",
    attachments: [{ filename: "big.png", type: "image/png", data: bigBase64 }],
  });

  const res = await target.fetch("/api/message", { method: "POST", headers: JSON_HEADERS, body });

  if (res.status >= 500) {
    sink.add(rule("input/oversized-accepted"), {
      location: "/api/message",
      evidence: `oversized attachment → ${res.status} (should be a 4xx, not a server error)`,
    });
  } else if (res.status >= 200 && res.status < 300) {
    sink.add(rule("input/oversized-accepted"), {
      location: "/api/message",
      evidence: "oversized attachment accepted (2xx) instead of rejected",
    });
  } else {
    sink.pass("input/oversized-accepted");
  }

  if (looksLikeStack(res.body)) {
    sink.add(rule("disclosure/stack-trace"), { location: "/api/message", evidence: "oversized body" });
  }
}

/* ---- attachment abuse (local only) ----------------------------------------- */

// Abusive attachments must be rejected with a clean 4xx, never accepted (2xx) and
// never crash the endpoint (5xx/stack). Local only, for the same reason as oversized:
// a VALID attachment would reach the mail path, and a bad one is rejected before it.
export async function checkAttachments(target: Target, sink: Sink): Promise<void> {
  if (target.kind !== "local") {
    sink.skip("input/attachment-unvalidated", "attachment validation is asserted locally only; a valid attachment would reach the mail path on remote");
    return;
  }

  const cases: { detail: string; attachments: unknown }[] = [
    { detail: "disallowed type/extension", attachments: [{ filename: "evil.exe", type: "application/x-msdownload", data: "QQ==" }] },
    { detail: "invalid base64", attachments: [{ filename: "x.png", type: "image/png", data: "@@@ not base64 @@@" }] },
    { detail: "malformed attachments (not a list)", attachments: "nope" },
  ];

  const bad: Occurrence[] = [];
  const stacks: Occurrence[] = [];

  for (const c of cases) {
    const body = JSON.stringify({
      name: "Probe",
      email: "probe@scanner.invalid",
      subject: "attachment probe",
      message: "attachment probe",
      attachments: c.attachments,
    });
    const res = await target.fetch("/api/message", { method: "POST", headers: JSON_HEADERS, body });

    if (res.status >= 500) bad.push({ loc: "/api/message", detail: `${c.detail} → ${res.status} (want 4xx)` });
    else if (res.status >= 200 && res.status < 300) bad.push({ loc: "/api/message", detail: `${c.detail} accepted (2xx, want 4xx)` });
    if (looksLikeStack(res.body)) stacks.push({ loc: "/api/message", detail: c.detail });
  }

  aggregate(sink, "input/attachment-unvalidated", bad);
  if (stacks.length) aggregate(sink, "disclosure/stack-trace", stacks);
}

/* ---- open redirect --------------------------------------------------------- */

// A distinctive host that appears in NO legitimate redirect target. An open redirect
// is proven only when the attacker-controlled host reaches the Location HOST — a
// redirect that keeps this string in the PATH (e.g. the legitimate imqueue.com→org
// /api hop appending it) is safe, and a redirect to a fixed sibling host (imqueue.org)
// is not attacker-controlled. So the test is precise: does MARKER become the host?
const REDIRECT_MARKER = "scanner-open-redirect.example";

export async function checkOpenRedirect(target: Target, sink: Sink): Promise<void> {
  const vectors = [
    `/%2f%2f${REDIRECT_MARKER}/`,
    `/%5c%5c${REDIRECT_MARKER}/`,
    `/.%2e/${REDIRECT_MARKER}`,
    `/?redirect=https://${REDIRECT_MARKER}`,
    `/?url=https://${REDIRECT_MARKER}`,
    `//${REDIRECT_MARKER}/`,
  ];

  // Every discovered /api package is a redirecting catch-all (a bare /api/<pkg> 301s
  // to /latest/), so probe each for a marker escaping into the Location host (S1),
  // rather than only the one hardcoded /api/core hop.
  const { apiPackages } = discoverFunctions();
  const pkgs = apiPackages.length ? apiPackages : ["core"];
  for (const pkg of pkgs) vectors.push(`/api/${pkg}/%2f%2f${REDIRECT_MARKER}`);

  const hits: Occurrence[] = [];

  for (const v of vectors) {
    const res = await target.fetch(v);
    if (res.status < 300 || res.status >= 400 || !res.location) continue;

    let locHost = "";
    try {
      locHost = new URL(res.location, target.origin).host;
    } catch {
      locHost = res.location; // unparseable — compare the raw string
    }

    // Only a finding if the attacker's marker reached the HOST of the redirect.
    if (locHost.toLowerCase().includes(REDIRECT_MARKER)) {
      hits.push({ loc: v, detail: `→ ${res.location}` });
    }
  }

  aggregate(sink, "redirect/open", hits);
}

/* ---- transport (remote only) ---------------------------------------------- */

export async function checkTransport(target: Target, sink: Sink): Promise<void> {
  if (target.kind !== "remote") {
    sink.skip("transport/no-https-redirect", "http→https redirect is an edge behaviour, exercised in remote mode only");
    return;
  }

  // Probe the apex root, a deep path, and the www host — a redirect rule that covers
  // only `/` would still leave a deep link interceptable, so all three must redirect.
  const targets = [
    `http://${target.host}/`,
    `http://${target.host}/docs/`,
    `http://www.${target.host.replace(/^www\./, "")}/`,
  ];
  const bad: Occurrence[] = [];

  for (const httpUrl of targets) {
    const res = await target.fetch(httpUrl);

    // 0 = the connection failed outright (also acceptable — nothing served over http).
    if (res.status === 0) continue;

    const loc = res.location ?? "";
    const toHttps = res.status >= 300 && res.status < 400 && loc.startsWith("https://");
    // A permanent (301/308) redirect is what HSTS/graders expect; a 302 works but is
    // called out as evidence rather than passed silently.
    if (!toHttps) {
      bad.push({ loc: httpUrl, detail: `status ${res.status}${loc ? `, Location: ${loc}` : ", no redirect"}` });
    } else if (res.status !== 301 && res.status !== 308) {
      bad.push({ loc: httpUrl, detail: `redirects with ${res.status}, prefer a permanent 301` });
    }
  }

  aggregate(sink, "transport/no-https-redirect", bad);
}

/* ---- email-endpoint rate-limiting (tracked, not sent) ---------------------- */

// The one genuinely live gap for these sites, made first-class here (L1). Rate-limiting
// / anti-automation on the email endpoints is a Cloudflare edge control (a WAF rate
// rule or Turnstile) that the harness CANNOT verify without sending a burst — exactly
// the DoS the assessment forbids. So the finding is always emitted for the two email
// endpoints and folded into an accepted risk (policy.ACCEPTED), which surfaces it in
// every report's accepted-risk table instead of leaving it buried in prose.
export async function checkRateLimit(target: Target, sink: Sink): Promise<void> {
  sink.add(rule("abuse/no-rate-limit"), {
    location: "/api/contact, /api/message",
    evidence:
      "rate-limiting is an edge/WAF control the harness cannot confirm non-destructively; tracked pending owner confirmation of a Cloudflare rate rule / Turnstile",
  });
}

/* ---- host-header injection (remote only) ----------------------------------- */

// A crafted Host / X-Forwarded-Host must not reach an absolute URL or a redirect
// Location. Locally the internal Request host is fixed to the edition, so this is only
// meaningful against the live edge. No live exposure expected (security.txt/canonical
// are pinned to editionDomain), so this is a regression tripwire.
export async function checkHostHeader(target: Target, sink: Sink): Promise<void> {
  if (target.kind !== "remote") {
    sink.skip("host-header/injection", "the local target pins the request Host to the edition; crafted-Host behaviour is only observable against the live edge");
    return;
  }

  const evil = "scanner-host-injection.example";
  const hits: Occurrence[] = [];

  for (const p of ["/", "/.well-known/security.txt"]) {
    for (const header of ["host", "x-forwarded-host"]) {
      const res = await target.fetch(p, { headers: { [header]: evil } });
      const loc = res.location ?? "";
      const bodyHasEvil = res.body.includes(evil);
      let locHost = "";
      try {
        locHost = loc ? new URL(loc, target.origin).host : "";
      } catch {
        locHost = loc;
      }
      if (locHost.includes(evil) || bodyHasEvil) {
        hits.push({ loc: `${header} → ${p}`, detail: locHost.includes(evil) ? `reflected into Location: ${loc}` : "reflected into body" });
      }
    }
  }

  aggregate(sink, "host-header/injection", hits);
}

/* ---- TLS minimum version (remote only) ------------------------------------- */

// A handshake that SUCCEEDS at TLS 1.0/1.1 is the finding. fetch() cannot pin a max
// version, so this uses a raw TLS socket. Edge-level control (Cloudflare), so remote
// only. Non-destructive: it opens one socket and closes it.
export async function checkTls(target: Target, sink: Sink): Promise<void> {
  if (target.kind !== "remote") {
    sink.skip("transport/weak-tls", "TLS version negotiation is an edge control, not observable against the local loopback target");
    return;
  }

  const host = target.host;
  const negotiatedOldTls = await new Promise<string | null>((resolve) => {
    let settled = false;
    const done = (v: string | null) => {
      if (!settled) {
        settled = true;
        resolve(v);
      }
    };
    // Ask for at most TLS 1.1. If the edge completes the handshake, it accepts a
    // deprecated version; a healthy edge refuses and the socket errors instead.
    const socket = tlsConnect(
      { host, port: 443, servername: host, minVersion: "TLSv1", maxVersion: "TLSv1.1", timeout: 8000 },
      () => {
        const proto = socket.getProtocol();
        socket.end();
        done(proto ?? "unknown");
      },
    );
    socket.on("error", () => done(null));
    socket.on("timeout", () => {
      socket.destroy();
      done(null);
    });
  });

  if (negotiatedOldTls) {
    sink.add(rule("transport/weak-tls"), {
      location: `${host}:443`,
      evidence: `handshake succeeded at ${negotiatedOldTls} (want a minimum of TLS 1.2)`,
    });
  } else {
    sink.pass("transport/weak-tls");
  }
}

/* ---- DNS email-auth posture (remote only) ---------------------------------- */

// Email is the site's core function, so a missing SPF or DMARC record is worth
// flagging — it lets the domain be spoofed in From:. Remote only (needs public DNS).
export async function checkEmailAuth(target: Target, sink: Sink): Promise<void> {
  if (target.kind !== "remote") {
    sink.skip("dns/email-auth-missing", "DNS posture (SPF/DMARC) is checked in remote mode only");
    return;
  }

  const domain = target.host.replace(/^www\./i, "");
  const missing: string[] = [];

  const txt = async (name: string): Promise<string[]> => {
    try {
      return (await resolveTxt(name)).map((chunks) => chunks.join(""));
    } catch {
      return [];
    }
  };

  const root = await txt(domain);
  if (!root.some((r) => /^v=spf1/i.test(r.trim()))) missing.push("SPF (no v=spf1 TXT on the apex)");

  const dmarc = await txt(`_dmarc.${domain}`);
  if (!dmarc.some((r) => /^v=DMARC1/i.test(r.trim()))) missing.push("DMARC (no v=DMARC1 TXT at _dmarc)");

  if (missing.length) {
    sink.add(rule("dns/email-auth-missing"), { location: domain, evidence: missing.join("; ") });
  } else {
    sink.pass("dns/email-auth-missing");
  }
}

/* ---- agent-analytics header reflection ------------------------------------- */

// The edge tags agent-surface responses with x-agent-analytics, built from the request
// UA/Referer but as classified enum tokens only. Assert a crafted UA/Referer is never
// reflected verbatim into that header (S8). Runs on any target that emits the header;
// where it is absent (analytics off), there is nothing to reflect.
export async function checkAgentAnalytics(target: Target, sink: Sink): Promise<void> {
  const marker = "scanner-reflect-9x7";
  const res = await target.fetch("/llms.txt", {
    headers: { "user-agent": `${marker}/1.0`, referer: `https://${marker}.example/x` },
  });
  const note = res.headers.get("x-agent-analytics");

  if (note === null) {
    sink.skip("disclosure/agent-analytics-reflection", "no x-agent-analytics header on this response (analytics not configured or not an agent surface)");
    return;
  }

  if (note.includes(marker)) {
    sink.add(rule("disclosure/agent-analytics-reflection"), {
      location: "/llms.txt",
      evidence: `x-agent-analytics reflected the crafted UA/Referer: ${note.slice(0, 120)}`,
    });
  } else {
    sink.pass("disclosure/agent-analytics-reflection");
  }
}

/* ---- entry ----------------------------------------------------------------- */

export async function runActiveChecks(target: Target, sink: Sink, report: Report): Promise<void> {
  const { endpoints, apiPackages } = discoverFunctions();
  report.note(
    `${target.label}: discovered ${endpoints.length} endpoint(s), ${apiPackages.length} /api package(s)`,
  );

  await checkExposure(target, sink);
  await checkMethods(target, sink);
  await checkCors(target, sink);
  await checkInjection(target, sink);
  await checkOversized(target, sink);
  await checkAttachments(target, sink);
  await checkRateLimit(target, sink);
  await checkOpenRedirect(target, sink);
  await checkTransport(target, sink);
  await checkHostHeader(target, sink);
  await checkTls(target, sink);
  await checkEmailAuth(target, sink);
  await checkAgentAnalytics(target, sink);

  report.note(`${target.label}: active probes complete`);
}
