// scripts/security/active.ts — the NIST "Attack" / PTES "Exploitation" phase. Every
// probe here is NON-DESTRUCTIVE: no data is changed, no availability test is run, and
// — the one that matters for this site — no mail is ever sent. The two email
// endpoints are exercised only through paths that cannot reach the mail provider:
// on the live edge every POST trips the honeypot (which returns ok WITHOUT sending),
// and locally there is no RESEND_API_KEY so the send path returns a config error.
// A researcher's own site is in scope; sending its owner spam is not.

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

  // A directory that has no index must 404, not list. Probe a couple.
  for (const dir of ["/js/", "/images/", "/fonts/"]) {
    const res = await target.fetch(dir);
    if (res.status === 200 && /<title>Index of|Directory listing/i.test(res.body)) {
      leaks.push({ loc: dir, detail: "directory listing" });
    }
  }

  aggregate(sink, "exposure/sensitive-file", leaks);
  aggregate(sink, "exposure/source-map", maps);
}

/* ---- HTTP method tampering ------------------------------------------------- */

export async function checkMethods(target: Target, sink: Sink): Promise<void> {
  const paths = ["/", "/api/contact", "/api/message"];
  // fetch() refuses CONNECT/TRACE/TRACK, which is also what a browser does, so they
  // are effectively untestable from here — the ones a client can actually send are.
  const methods = ["PUT", "DELETE", "PATCH"];
  const dangerous: Occurrence[] = [];
  const stacks: Occurrence[] = [];

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

  // 5. Reflected XSS via the search query string (server returns a static page).
  const q = await target.fetch(`/search/?q=${encodeURIComponent(XSS)}`);
  if (q.body.includes(XSS)) reflected.push({ loc: "/search/?q=", detail: "query reflected server-side" });

  aggregate(sink, "input/xss-reflected", reflected);
  aggregate(sink, "input/injection-echo", echoed);
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
    sink.pass("input/oversized-accepted");
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
    `/api/core/%2f%2f${REDIRECT_MARKER}`,
    `/?redirect=https://${REDIRECT_MARKER}`,
    `/?url=https://${REDIRECT_MARKER}`,
    `//${REDIRECT_MARKER}/`,
  ];
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
  if (target.kind !== "remote") return;

  const httpUrl = `http://${target.host}/`;
  const res = await target.fetch(httpUrl);

  // 0 = the connection failed outright (also acceptable — nothing served over http).
  if (res.status === 0) {
    sink.pass("transport/no-https-redirect");
    return;
  }

  const redirectsToHttps =
    res.status >= 300 && res.status < 400 && (res.location ?? "").startsWith("https://");

  if (!redirectsToHttps) {
    sink.add(rule("transport/no-https-redirect"), {
      location: httpUrl,
      evidence: `status ${res.status}${res.location ? `, Location: ${res.location}` : ", no redirect"}`,
    });
  } else {
    sink.pass("transport/no-https-redirect");
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
  await checkOpenRedirect(target, sink);
  await checkTransport(target, sink);

  report.note(`${target.label}: active probes complete`);
}
