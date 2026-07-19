# Dual-domain cutover checklist

Take the `rebrand/dual-domain` branch live as two sites from one repo, replacing
the current **GitHub Pages** production site with two **Cloudflare Pages** projects:

- **imqueue.org** — open-source "Terminal" edition (docs, tutorial, API, blog)
- **imqueue.com** — commercial "Flux" edition (home + pricing/license form)
- **imqueue.net** — 301 → imqueue.com

**Context / confirmed:** production imqueue.com is served by GitHub Pages
(`.github/workflows/deploy.yml`, `CNAME`, `.nojekyll`), with the domain already in
Cloudflare (proxied → free SSL + CDN/WAF). We fully replace GitHub Pages with
Cloudflare Pages. The old `deploy.yml` is incompatible with the new multi-edition
build (it builds `_site`, but editions output `_site-org`/`_site-com` and need the
`EDITION` env), and GitHub Pages can only serve one site — so it is retired here.

The **same Cloudflare zone stays** — SSL, caching, WAF/DDoS all continue. The only
DNS change is the record target: GitHub's IPs (`185.199.108–111.153`) → a proxied
`*.pages.dev` CNAME. Pages provisions the custom-domain cert automatically.

**Strategy: branch-first.** Point the Pages projects at `rebrand/dual-domain`,
verify on `*.pages.dev`, then switch DNS. This decouples the DNS cutover from the
git merge, so downtime is a few seconds (both old + new serve valid sites) and
rollback is trivial. The merge to `master` becomes a cosmetic final step.

---

## A. Build both Pages projects (live site untouched — no DNS change yet)

Cloudflare → Workers & Pages → Create → Pages → connect this GitHub repo, twice:

| Project | Production branch | Build command | Output dir |
|---|---|---|---|
| `imqueue-org` | `rebrand/dual-domain` | `npm run build:org` | `_site-org` |
| `imqueue-com` | `rebrand/dual-domain` | `npm run build:com` | `_site-com` |

- Node version comes from `.nvmrc` (20). No other build config needed.
- On **`imqueue-com`** → Settings → Environment variables, add `RESEND_API_KEY`
  (Production + Preview). Optional: `CONTACT_TO` (default `support@imqueue.com`),
  `CONTACT_FROM` (default `@imqueue <noreply@imqueue.com>`).
- Verify both on their `imqueue-org.pages.dev` / `imqueue-com.pages.dev` URLs.
  (imqueue.com is still served by GitHub Pages this whole time.)

## B. Email (Resend + routing)

1. Resend → create account → **add & verify the `imqueue.com` domain** (add the
   SPF/DKIM DNS records it gives you, in Cloudflare). Required to send from
   `noreply@imqueue.com`. Put the API key in step A.
2. Cloudflare → **Email Routing** on imqueue.com → forward `support@imqueue.com`
   to a real inbox you monitor.
   - ⚠️ Enabling Email Routing rewrites the domain's **MX** records. If imqueue.com
     already receives email elsewhere, reconcile that first.
3. Smoke-test after DNS cutover: submit the pricing form → confirm mail at support@.

## C. DNS cutover (the switch — seconds; both sides serve valid sites)

1. **imqueue.com** → `imqueue-com` project → Custom domains → add `imqueue.com`
   (and `www.imqueue.com`). Cloudflare replaces the GitHub Pages `A` records with a
   proxied CNAME → `imqueue-com.pages.dev`. Manually delete any leftover
   `185.199.x.x` `A`/`AAAA` records on `@`. SSL provisions automatically.
2. **imqueue.org** → add the zone to Cloudflare if not already → `imqueue-org`
   project → add custom domain `imqueue.org` (+ `www`).
3. **imqueue.net** → add the zone to Cloudflare → add a proxied placeholder record
   (`A @ → 192.0.2.1`, orange cloud; same for `www`) so it resolves → Rules →
   **Redirect Rules**: when host is `imqueue.net`/`www.imqueue.net`, 301 to
   `https://imqueue.com` + the original path.
4. Keep **SSL/TLS mode = Full (strict)** on all zones.
5. Verify live:
   - imqueue.com → Flux home; `/pricing/` submits and emails support@.
   - imqueue.org → Terminal home; docs / tutorial / API render.
   - `imqueue.com/docs/`, `/tutorial/`, `/api/`, etc. → 301 to imqueue.org
     (via `src/com/_redirects`; note `/api/contact` is a Function and is unaffected).
   - `imqueue.net` → 301 → imqueue.com.
   - Theme toggle, favicons, GA + Clarity work on both.
6. Submit both sitemaps in Google Search Console:
   `https://imqueue.org/sitemap.xml` and `https://imqueue.com/sitemap.xml`.

## D. Retire GitHub Pages

1. GitHub repo → Settings → Pages → Source = **None** (stops GitHub Pages serving).
2. `deploy.yml`, `CNAME`, and `.nojekyll` are already removed on this branch, so
   they disappear from `master` at merge (until then, `master` keeps serving the
   current live site normally).
3. **Merge `rebrand/dual-domain` → `master`.**
4. Switch both Pages projects' production branch to `master` (visually a no-op;
   future pushes to master auto-deploy).

## Rollback

- Before merge: nothing to undo — DNS can be pointed back at GitHub's IPs, and
  GitHub Pages is still enabled until step D.1.
- After merge: revert the merge commit on `master`; Cloudflare redeploys the prior
  state. Redirect rules and Email Routing can be toggled off independently.
