// Cloudflare Pages Function — POST /api/message
//
// The general contact form (/contact/ on BOTH imqueue.org and imqueue.com — this
// functions/ directory is shared by the two Pages projects). Emails the message to
// support@imqueue.com through Resend, with optional attachments. Spam is filtered
// with the same honeypot field the licensing form uses.
//
// Kept separate from api/contact.js on purpose. That one is the licensing LEAD form:
// different fields, different validation, "Commercial licence enquiry" subject line,
// and no attachments. Folding both into one endpoint would mean a request shape where
// half the fields are conditional on the other half — the shape that makes it easy to
// ship a validation hole.
//
// Required env var (set on BOTH Pages projects):
//   RESEND_API_KEY   — Resend API key; the sending domain must be verified in Resend.
// Optional overrides:
//   CONTACT_TO       — recipient (default support@imqueue.com)
//   CONTACT_FROM     — sender (default "@imqueue <noreply@imqueue.com>"); domain must be verified.

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const isEmail = (v) => typeof v === "string" && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v);

const clean = (v, max = 2000) =>
  (typeof v === "string" ? v : "").trim().slice(0, max);

const esc = (v) =>
  clean(v, 20000).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );

// Attachment policy. Resend allows 40MB per email after base64 encoding; this is a
// contact form, not a file transfer, so the cap is far below that — a Worker has to
// hold the whole decoded payload in memory to count it, and a generous limit is also
// the cheapest denial-of-service anyone could aim at this endpoint.
const MAX_FILES = 3;
const MAX_TOTAL_BYTES = 5 * 1024 * 1024; // 5 MB across all files, before encoding
const ALLOWED = new Set([
  "image/png", "image/jpeg", "image/gif", "image/webp",
  "text/plain", "text/markdown", "text/csv", "application/json",
  "application/pdf",
]);
// Extensions are checked too: a browser reports whatever the OS claims, so the type
// alone is not evidence. Both have to agree before a file is forwarded.
const ALLOWED_EXT = /\.(png|jpe?g|gif|webp|txt|md|log|csv|json|pdf)$/i;

/** Decoded byte length of a base64 string, without allocating the bytes. */
function base64Bytes(b64) {
  const len = b64.length;

  if (!len) { return 0; }

  const padding = b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0;

  return Math.floor((len * 3) / 4) - padding;
}

/**
 * Validate the attachment list into Resend's shape, or return an error string.
 *
 * The client sends `{ filename, type, data }` where data is base64 WITHOUT the
 * `data:` URL prefix. Anything failing a check rejects the whole submission rather
 * than being dropped silently — someone who attached a screenshot and got a
 * "message sent" with no screenshot has been told a small lie.
 */
function normalizeAttachments(raw) {
  if (raw === undefined || raw === null) { return { files: [] }; }
  if (!Array.isArray(raw)) { return { error: "Attachments are malformed." }; }
  if (raw.length > MAX_FILES) {
    return { error: `Please attach no more than ${MAX_FILES} files.` };
  }

  const files = [];
  let total = 0;

  for (const item of raw) {
    if (!item || typeof item !== "object") {
      return { error: "Attachments are malformed." };
    }

    const filename = clean(item.filename, 200).replace(/[/\\]/g, "_");
    const type = clean(item.type, 100).toLowerCase();
    const data = typeof item.data === "string" ? item.data : "";

    if (!filename || !data) { return { error: "An attachment is missing its name or content." }; }
    if (!ALLOWED_EXT.test(filename) || !ALLOWED.has(type)) {
      return { error: `“${filename}” is not an accepted file type. Images, text files and PDFs only.` };
    }
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(data)) {
      return { error: `“${filename}” could not be read.` };
    }

    total += base64Bytes(data);

    if (total > MAX_TOTAL_BYTES) {
      return { error: "Attachments are too large — 5 MB in total, please." };
    }

    files.push({ filename, content: data, content_type: type });
  }

  return { files };
}

export async function onRequestPost(context) {
  const { request, env } = context;

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "Invalid request body." }, 400);
  }

  // Honeypot: bots fill this hidden field; humans never see it. Pretend success.
  if (clean(body.company_url)) { return json({ ok: true }); }

  const name = clean(body.name, 200);
  const email = clean(body.email, 320);
  const subject = clean(body.subject, 200);
  const message = clean(body.message, 20000);
  const page = clean(body.page, 500);

  // Mirrors the client so a stripped or forged request is still checked.
  if (!name) { return json({ ok: false, error: "Name is required." }, 400); }
  if (!isEmail(email)) { return json({ ok: false, error: "A valid email is required." }, 400); }
  if (!subject) { return json({ ok: false, error: "Subject is required." }, 400); }
  if (!message) { return json({ ok: false, error: "Message is required." }, 400); }

  const { files, error } = normalizeAttachments(body.attachments);

  if (error) { return json({ ok: false, error }, 400); }

  if (!env.RESEND_API_KEY) {
    // Misconfiguration — surface a 500 so the form shows its "email us directly" fallback.
    return json({ ok: false, error: "Mail service is not configured." }, 500);
  }

  const TO = env.CONTACT_TO || "support@imqueue.com";
  const FROM = env.CONTACT_FROM || "@imqueue <noreply@imqueue.com>";

  const rows = [
    ["Name", name],
    ["Email", email],
    ["Subject", subject],
    ["Submitted from", page || "—"],
    ["Attachments", files.length ? files.map((f) => f.filename).join(", ") : "—"],
  ];

  const text = `${rows.map(([k, v]) => `${k}: ${v}`).join("\n")}\n\n${message}`;
  const html =
    `<h2 style="font-family:sans-serif;">New message from the contact form</h2>` +
    `<table style="font-family:sans-serif;font-size:14px;border-collapse:collapse;">` +
    rows
      .map(
        ([k, v]) =>
          `<tr><td style="padding:6px 14px 6px 0;color:#666;vertical-align:top;">${esc(k)}</td>` +
          `<td style="padding:6px 0;"><strong>${esc(v)}</strong></td></tr>`
      )
      .join("") +
    `</table>` +
    // white-space:pre-wrap so the sender's own line breaks survive, and esc() so a
    // message containing markup cannot inject any into the mail we read.
    `<p style="font-family:sans-serif;font-size:14px;white-space:pre-wrap;margin-top:18px;">${esc(message)}</p>`;

  try {
    const payload = {
      from: FROM,
      to: [TO],
      reply_to: email,
      subject: `Contact form — ${subject}`,
      text,
      html,
    };

    if (files.length) { payload.attachments = files; }

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
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
