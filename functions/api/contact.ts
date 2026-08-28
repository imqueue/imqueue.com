// Cloudflare Pages Function — POST /api/contact
// Receives the commercial-license lead form (imqueue.com /pricing/) and emails
// it to support@imqueue.com via Resend. Spam is filtered with a honeypot field.
//
// Required env var (set on the imqueue.com Pages project):
//   RESEND_API_KEY   — Resend API key; the imqueue.com domain must be verified in Resend.
// Optional overrides:
//   CONTACT_TO       — recipient (default support@imqueue.com)
//   CONTACT_FROM     — sender (default "@imqueue <noreply@imqueue.com>"); domain must be verified.

import type { PagesContext } from "../../lib/pages.ts";

/**
 * The parsed request body. Every field is `unknown` because every field arrives
 * from the network — the readers below (clean, isEmail) take `unknown` for the
 * same reason, so there is nowhere a forged value can be trusted by accident.
 */
type Body = Record<string, unknown>;

const json = (data: unknown, status = 200): Response =>
  new Response(JSON.stringify(data), {
    status,
    // no-store: this is a per-request API response, never a cacheable document.
    // Keeps an intermediary or the edge from holding one caller's result for another
    // (CWE-525 / WSTG-ATHN-06), asserted by the headers/cache-sensitive check.
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

const isEmail = (v: unknown): boolean =>
  typeof v === "string" && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v);

const clean = (v: unknown, max = 2000): string =>
  (typeof v === "string" ? v : "").trim().slice(0, max);

// Hoisted out of esc(). It used to be an object literal inside the replace
// callback, rebuilt once per escaped character; as a module constant it is built
// once, and `?? c` covers the index that the character class makes unreachable.
const ESCAPES: Record<string, string> = {
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
};

const esc = (v: unknown): string =>
  clean(v).replace(/[&<>"']/g, (c) => ESCAPES[c] ?? c);

export async function onRequestPost(context: PagesContext): Promise<Response> {
  const { request, env } = context;

  let body: Body;

  try {
    const parsed: unknown = await request.json();

    // `null`, `5` and `[]` are all valid JSON, and reading `.company_url` off the
    // first of those throws — so a body of exactly `null` used to become an
    // uncaught TypeError and a 500, where every other malformed body gets a 400.
    // Parsing as `unknown` is what made the gap visible.
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return json({ ok: false, error: "Invalid request body." }, 400);
    }

    body = parsed as Body;
  } catch {
    return json({ ok: false, error: "Invalid request body." }, 400);
  }

  // Honeypot: bots fill this hidden field; humans never see it. Pretend success.
  if (clean(body.company_url)) return json({ ok: true });

  const useType = body.useType === "personal" ? "personal" : "business";
  const name = clean(body.name, 200);
  const email = clean(body.email, 320);
  const company = clean(body.company, 300);
  const developers = clean(body.developers, 40);
  const phone = clean(body.phone, 60);
  const source = clean(body.source, 120);
  const page = clean(body.page, 500);

  // Validation mirrors the client so a stripped/forged request is still checked.
  if (!name) return json({ ok: false, error: "Name is required." }, 400);
  if (!isEmail(email)) return json({ ok: false, error: "A valid email is required." }, 400);
  if (useType === "business" && !company)
    return json({ ok: false, error: "Company is required for business use." }, 400);

  if (!env.RESEND_API_KEY) {
    // Misconfiguration — surface a 500 so the form shows its "email us directly" fallback.
    return json({ ok: false, error: "Mail service is not configured." }, 500);
  }

  const TO = env.CONTACT_TO || "support@imqueue.com";
  const FROM = env.CONTACT_FROM || "@imqueue <noreply@imqueue.com>";

  const rows = [
    ["Type of use", useType === "business" ? "Business" : "Personal"],
    ["Name", name],
    ["Email", email],
    ...(useType === "business" ? [["Company", company], ["Developers", developers || "—"]] : []),
    ["Phone", phone || "—"],
    ["Found us via", source || "—"],
    ["Submitted from", page || "—"],
  ];

  const text = rows.map(([k, v]) => `${k}: ${v}`).join("\n");
  const html =
    `<h2 style="font-family:sans-serif;">New commercial-license enquiry</h2>` +
    `<table style="font-family:sans-serif;font-size:14px;border-collapse:collapse;">` +
    rows
      .map(
        ([k, v]) =>
          `<tr><td style="padding:6px 14px 6px 0;color:#666;vertical-align:top;">${esc(k)}</td>` +
          `<td style="padding:6px 0;"><strong>${esc(v)}</strong></td></tr>`
      )
      .join("") +
    `</table>`;

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: FROM,
        to: [TO],
        reply_to: email,
        subject: `Commercial licence enquiry — ${company || name}`,
        text,
        html,
      }),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      console.error("Resend error", res.status, detail);
      return json({ ok: false, error: "Could not send your message." }, 502);
    }
  } catch (err) {
    console.error("Resend request failed", err);
    return json({ ok: false, error: "Could not send your message." }, 502);
  }

  return json({ ok: true });
}
