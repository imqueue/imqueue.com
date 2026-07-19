# Dual-domain cutover checklist

How to take the `rebrand/dual-domain` branch live as two sites from one repo:

- **imqueue.org** — open-source "Terminal" edition (all docs, tutorial, API, blog)
- **imqueue.com** — commercial "Flux" edition (home + pricing/license form)
- **imqueue.net** — 301 → imqueue.com

Everything below happens on **Cloudflare** (free tier) unless noted. Nothing here
touches the live site until the final merge step — the branch is the safety net.

> **Assumption:** the current production imqueue.com is served by **GitHub Pages**
> (`.github/workflows/deploy.yml`, `CNAME`, `.nojekyll`). This plan replaces it with
> two Cloudflare Pages projects. If production is hosted elsewhere, adjust step 6.

## 1. Cloudflare Pages projects (two, one repo)

Create two Pages projects from this GitHub repo:

| Project | Build command | Output dir | Production branch |
|---|---|---|---|
| `imqueue-org` | `npm run build:org` | `_site-org` | `master` |
| `imqueue-com` | `npm run build:com` | `_site-com` | `master` |

- Both use the same repo; the `EDITION` env var is set by the build command.
- Node version: match `.nvmrc`/`engines` if present (Eleventy 3 needs Node 18+).

## 2. Custom domains

- `imqueue-org` → add custom domain **imqueue.org** (and `www.imqueue.org` → redirect to apex if desired).
- `imqueue-com` → add custom domain **imqueue.com** (and `www`).
- Point DNS (Cloudflare-managed) at the Pages projects; enable "Always use HTTPS".

## 3. Contact form → Resend (imqueue.com only)

The pricing form POSTs to the `functions/api/contact.js` Pages Function, which sends
via [Resend](https://resend.com).

1. Create a free Resend account.
2. **Verify the `imqueue.com` domain** in Resend (add the DNS records it gives you:
   SPF/DKIM). Sending from `noreply@imqueue.com` requires this.
3. On the **imqueue-com** Pages project → Settings → Environment variables, add:
   - `RESEND_API_KEY` = your Resend API key (Production + Preview).
   - *(optional)* `CONTACT_TO` (default `support@imqueue.com`), `CONTACT_FROM`
     (default `@imqueue <noreply@imqueue.com>`).
4. Enable **Cloudflare Email Routing** on imqueue.com so `support@imqueue.com`
   forwards to a real inbox you monitor.
5. Smoke-test: submit the pricing form; confirm the email arrives at support@.

## 4. imqueue.net → imqueue.com

- Add `imqueue.net` to Cloudflare.
- Create a **Redirect Rule**: `*imqueue.net/*` → `https://imqueue.com/${1}` (301).
  (This is a domain-level redirect, so it lives as a Cloudflare rule, not `_redirects`.)

## 5. Legacy path redirects (already in the repo)

- `src/com/_redirects` → built to `_site-com/_redirects`. It 301s the old
  imqueue.com content paths (`/docs`, `/tutorial`, `/intro`, `/get-started`,
  `/blog`, `/api`) to imqueue.org so inbound links and SEO carry over.
- `/sitemap.xml` and `/robots.txt` are generated per edition (each advertises its
  own domain's sitemap).
- After go-live, submit both sitemaps in Google Search Console:
  `https://imqueue.org/sitemap.xml` and `https://imqueue.com/sitemap.xml`.

## 6. Go live (this changes the live site)

1. Verify both Pages preview deployments look correct (they build from the branch).
2. **Merge `rebrand/dual-domain` → `master`.** Cloudflare Pages redeploys both
   projects from `master`.
3. Retire the old GitHub Pages deploy so it doesn't fight Cloudflare for the domain:
   disable/remove `.github/workflows/deploy.yml` and the Pages setting in the repo,
   and remove the `CNAME` if DNS now points at Cloudflare.
4. Post-cutover checks:
   - imqueue.com loads the Flux home; `/pricing/` submits and emails support@.
   - imqueue.org loads the Terminal home; docs/tutorial/API render.
   - Old links like `imqueue.com/docs/` and `/api/` 301 to imqueue.org.
   - `imqueue.net` 301s to imqueue.com.
   - Theme toggle, favicons, analytics (GA + Clarity) all work on both.

## Rollback

If anything is wrong after merge, revert the merge commit on `master`; Cloudflare
redeploys the previous state. DNS/redirect rules can be toggled off independently.
