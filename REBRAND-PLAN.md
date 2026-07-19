# imqueue Dual-Domain Rebrand — Implementation Plan

Status: **plan / not started**. Source of truth for the design is the Claude Design
project *"Imqueue rebranding concepts"* → pages `imqueue Flux` (.com) and
`imqueue Terminal` (.org).

---

## 1. Goal

Rework this single Eleventy repo into **two editions of the same project**, served on
two domains, sharing a common design-system foundation but with distinct brand skins:

| Domain | Edition | Audience | Brand skin |
|---|---|---|---|
| **imqueue.com** | "Flux" — commercial | buyers / licensing | Space Grotesk display, purple→pink gradient |
| **imqueue.org** | "Terminal" — open source | developers | JetBrains Mono display, green/cyan, terminal vibe |
| **imqueue.net** | — | — | 301 → imqueue.com |

The open-source edition (.org) is the canonical home for **all docs/tutorial/api/blog**
(today's imqueue.com content). The commercial edition (.com) is a focused landing +
licensing surface that deep-links into .org for docs.

---

## 2. Hosting architecture (decided)

All on **Cloudflare free tier**. Code stays on GitHub; Cloudflare builds from it.

```
                      GitHub repo (this one)
                              │
             ┌────────────────┴─────────────────┐
   Cloudflare Pages project           Cloudflare Pages project
        "imqueue-com"                       "imqueue-org"
   build: EDITION=com                  build: EDITION=org
   output: _site-com                   output: _site-org
        │                                   │
   imqueue.com                         imqueue.org
        │
   functions/api/contact  ──► Resend API ──► support@imqueue.com

   imqueue.net ──(Cloudflare Redirect Rule, 301)──► imqueue.com
```

- **Two Pages projects, one repo** — each domain independent, plain static hosting.
- **imqueue.net** → Cloudflare **Redirect Rule** (301), no hosting/build needed.
- **Contact form** → Cloudflare **Pages Function** `/api/contact` (on the .com project)
  → **Resend** free tier (3k/mo) → emails support@imqueue.com. API key server-side.
- **Receive** support@imqueue.com via **Cloudflare Email Routing** (free) → personal inbox.
- **Spam**: Cloudflare **Turnstile** (free) on the form (optional but recommended).

**Cost:** $0/mo. Only real cost = domain registration for imqueue.org / .net (~$10–15/yr each).

---

## 2b. Safety & branching (protecting the live site)

The live imqueue.com is deployed by `.github/workflows/deploy.yml`, which fires **only on
push to `master`**. That trigger is the safety mechanism:

- **All rebrand work happens on the `rebrand/dual-domain` branch**, never `master`. Pushing
  a non-master branch does not trigger the deploy workflow — the live site is untouched.
- `master` stays frozen at its current commit, serving the current site throughout.
- **Preview without touching domains:** locally via `npm run serve:org|com`, or on Cloudflare
  branch preview URLs (`*.pages.dev`) — no DNS change, no impact on imqueue.com.
- **Never merge the rebrand to `master` until cutover.** The new build emits
  `_site-com`/`_site-org` (not `_site`), so an early merge would break the old workflow. At
  cutover we update/disable `deploy.yml` and flip DNS to Cloudflare; GitHub Pages keeps
  serving the old site as a live fallback until we're confident (reversible).

## 3. Proposed repo structure

Restructure into a clear shared/edition split (one-time move):

```
src/
  _shared/
    css/
      reset.css
      tokens.css          # variable *contract* (names only) + structural styles
      base.css            # layout primitives shared by both editions
    js/
      theme.js            # 3-way theme switch, localStorage 'imqueue-theme', data-theme on <html>
    includes/
      brand-logo.html     # shared @imqueue SVG mark
      theme-toggle.html   # segmented system/light/dark control
      head.html           # <head> partial: canonical, fonts, no-FOUC theme init
    data/
      site.yml            # shared site metadata

  com/                     # Flux commercial edition
    _includes/            # nav-com, ribbon-com, footer-com
    css/theme-flux.css    # purple/pink light+dark palette bound to the token contract
    index.html            # Home (hero, stats, features, "change the license", CTA)
    pricing.html          # Commercial license lead form + FAQ
    _data/ (com nav, etc.)

  org/                     # Terminal open-source edition
    _includes/            # nav-org, ribbon-org, footer-org
    css/theme-terminal.css# green/cyan light+dark palette
    index.html            # Home (hero + code terminal, features, how-it-works, packages)
    intro/                # migrated
    docs/                 # migrated (section landing + superpowers)
    get-started.md        # migrated
    tutorial/             # migrated 6 chapters
    api/                  # generated API docs (api-extractor/documenter), re-shelled
    blog/                 # migrated

functions/
  api/
    contact.js            # Cloudflare Pages Function → Resend (deploys with .com)

eleventy.config.js         # single config, EDITION env switches ignores/output/global data
```

> The `src/` move is the biggest single change. It's justified by long-term
> maintainability, but can be staged (see §11 execution).

---

## 4. Build system changes

**One config, env-switched** (`eleventy.config.js`):

- Reads `process.env.EDITION` (`com` | `org`).
- Sets `dir.output` → `_site-com` or `_site-org`.
- `eleventyConfig.ignores` excludes the *other* edition's `src/<edition>` dir.
- Injects a global data flag `edition` so layouts/includes branch on it.
- Points `includes`/`layouts`/`data` so both `_shared` and the active edition are visible.

**package.json scripts:**
```
build          → runs current edition (EDITION env)
build:com      → EDITION=com eleventy
build:org      → EDITION=org eleventy
build:all      → build:com && build:org
serve:com / serve:org → local preview per edition
build-docs     → unchanged (api-extractor/documenter), output lands under src/org/api
```

**Cloudflare Pages build config:**
- `imqueue-com`: build command `npm run build:com`, output dir `_site-com`.
- `imqueue-org`: build command `npm run build:org`, output dir `_site-org`.

---

## 5. Design system

### Token contract (shared variable names, per-edition values)
Both editions use the same CSS custom-property names so components are edition-agnostic:
`--bg --navbg --surface --surface2 --ink --muted --accent --accent2 --line --code
--eyebrow --on-accent --shadow`.

Values come from the edition's theme file, switched by `data-theme` on `<html>`:

| Token | Flux dark | Flux light | Terminal dark | Terminal light |
|---|---|---|---|---|
| `--bg` | `#0c0a17` | `#faf9ff` | `#0a0e0d` | `#eef2ef` |
| `--ink` | `#f2eeff` | `#171226` | `#e8f0ec` | `#0d1512` |
| `--muted` | `#9a92c0` | `#6b6486` | `#7f8f89` | `#5a6b63` |
| `--accent` | `#7b61ff` | `#6d4bff` | `#3ddc84` | `#0f9d52` |
| `--accent2` | `#ff5db1` | `#e0468f` | `#35d0e0` | `#0b8a99` |
| `--surface` | `rgba(255,255,255,.045)` | `#ffffff` | `#111917` | `#ffffff` |
| `--line` | `rgba(255,255,255,.12)` | `rgba(23,18,38,.12)` | `rgba(255,255,255,.12)` | `rgba(13,21,18,.13)` |
| `--eyebrow` | `#b9a6ff` | `#5b3fd6` | `#63e6a0` | `#0b7a40` |

(Full set taken verbatim from the two prototype scripts.)

### Theme switcher (`theme.js`)
- Segmented control: **system / light / dark** (matches prototype).
- Persists to `localStorage['imqueue-theme']`; applies `data-theme="dark|light"` to `<html>`
  (system = follow `prefers-color-scheme`).
- Inline no-FOUC init snippet in `<head>` sets the attribute before first paint.
- **Note:** the prototype synced theme across editions live because both rendered in one
  document. Across real domains (.com vs .org are separate origins) localStorage is **not**
  shared — each domain remembers its own theme. Acceptable; documented.

### Fonts
Design uses **Space Grotesk** (Flux display), **JetBrains Mono** (Terminal display + code
everywhere), **Inter** (body). **Decision: self-host** woff2 (via `@fontsource` or
downloaded), served from `fonts/` with `@font-face` + `font-display:swap` — no third-party
dependency, no Google Fonts request. The current **fontello** icon font is superseded by
inline SVG icons (drop it).

### Shared components (Eleventy includes)
- Brand logo SVG (identical mark both editions, color via `currentColor`).
- Theme toggle segmented control.
- Cross-ref ribbon (edition-specific target) + nav + footer.
- Responsive: CSS **container queries**, mobile breakpoint ≤ 760px (as in prototype).

---

## 6. Page inventory

### imqueue.com (Flux)
- **Home** — eyebrow pill, gradient hero headline, subcopy, 2 CTAs; 3 stat cards; 3 feature
  cards; "Start open. Change the license, not the code." (3 numbered steps); gradient CTA
  band → "Read the docs ↗" (deep-links .org). Animated gradient background blobs.
- **Pricing / Contact** — commercial-license explainer; lead form: Business/Personal toggle,
  Company, employee-count (1–10 / 10–100 / 100–1000 / 1000+), contact name, email, phone
  (optional), "how did you find us" select; success state; 4-item licensing FAQ. Submits to
  `/api/contact`.

### imqueue.org (Terminal)
- **Home** — hero + live "hello.service.ts" code terminal card; 3 stats; 3 feature cards;
  "how it works" (3 steps); "three packages" (core / rpc / cli).
- **Intro** — principles (Reliable/Scalable/Simple/Self-describing), benchmarks table, broker
  + service/client model.
- **Docs** — section landing cards → Getting started / Tutorial / API.
- **Get Started** — prerequisites, install CLI, create/run service, generate client.
- **Tutorial** — 6 chapters (Introduction, User Service, Auth Service, Domain Services, API
  Integration, Deployment) with on-page chapter nav.
- **API** — restyled shell around generated api-extractor/documenter output.
- **Blog** — migrated.

---

## 7. Content migration map (current → new)

| Current | Destination |
|---|---|
| `intro/` | `src/org/intro/` |
| `docs/` (superpowers) | `src/org/docs/` |
| `tutorial/*.md` (6) | `src/org/tutorial/` → tutorial chapters |
| `get-started.md` | `src/org/get-started.md` |
| `api/` (generated) | `src/org/api/` (re-shelled) |
| `blog/` | `src/org/blog/` |
| `index.html` (old home) | superseded by `src/org/index.html` |
| `licence.md` | `src/org/licence.md`; referenced from .com pricing |
| `contributing.md` | `src/org/contributing.md` |
| `_data/whys.yml`, `slides.yml` | content reused into new sections where it fits |
| `css/*` (framework/style/animation) | superseded by new design system; `prism.css`/`syntax.css` retheme & keep for code blocks |

---

## 8. Contact Function + Resend

`functions/api/contact.js` (Cloudflare Pages Function):
1. Accept `POST` JSON; reject other methods.
2. Validate required fields; enforce a **honeypot** hidden field.
3. (Optional) verify **Turnstile** token via `TURNSTILE_SECRET`.
4. Call **Resend** API with `RESEND_API_KEY` (Pages env secret):
   `from: noreply@imqueue.com` (verified domain), `to: support@imqueue.com`,
   subject + body built from submitted fields.
5. Return `{ ok: true }` / error JSON; front-end shows the success/thanks state.

Env (set in Cloudflare dashboard, imqueue-com project): `RESEND_API_KEY` (secret),
optionally `TURNSTILE_SECRET`. Turnstile **site key** is public (in the form HTML).

---

## 9. Cloudflare setup checklist (owner tasks — I can't do these)

1. Add imqueue.com, imqueue.org, imqueue.net as Cloudflare zones (update registrar NS).
2. Create Pages project **imqueue-com** from the repo → build `npm run build:com`,
   output `_site-com`; add custom domains imqueue.com (+ www).
3. Create Pages project **imqueue-org** from the repo → build `npm run build:org`,
   output `_site-org`; add custom domains imqueue.org (+ www).
4. Add **Redirect Rule**: `imqueue.net/*` → `https://imqueue.com/$1` (301).
5. **Resend**: sign up, verify imqueue.com domain (add DKIM/SPF DNS records), create API
   key → add as secret `RESEND_API_KEY` on imqueue-com.
6. (Optional) **Turnstile**: create widget → site key in form, `TURNSTILE_SECRET` as env.
7. (Optional) **Email Routing** on imqueue.com: forward support@ → personal inbox.
8. Retire GitHub Pages for imqueue.com (remove GH Pages custom domain / `CNAME`) once
   Cloudflare is verified live, to avoid DNS conflict.

---

## 10. SEO / cutover / redirects (important)

Docs are **moving domains** (imqueue.com/* → imqueue.org/*). To preserve SEO:
- Per-domain `<link rel="canonical">` (already in the design).
- On **imqueue.com**, add 301s for old doc paths → new .org paths, e.g.
  `imqueue.com/tutorial/*` → `imqueue.org/tutorial/*`, `/intro`, `/docs`, `/api`, `/blog`.
  Implement via a `_redirects` file in the .com build (Cloudflare Pages supports it).
- Update sitemaps per domain (`sitemap.liquid` → two sitemaps).
- Cutover safely: build on Cloudflare, verify on `*.pages.dev` preview URLs, then switch DNS.

---

## 11. Cleanup items
- Drop **fontello** icon font (replaced by inline SVG).
- Retire `framework.css`, `style.css`, `animation.css` (superseded); keep/retheme
  `prism.css`/`syntax.css` for code blocks.
- Reconcile `_data/nav.yml` into per-edition nav.
- Confirm `api-docs.js` / api-extractor config still points at the right output path after move.

---

## 12. Phased execution (build order: .org first)

1. **Foundation** — `src/` restructure, env-switched Eleventy config, shared design-system
   CSS (token contract + both theme files), `theme.js`, shared head/logo/toggle includes.
2. **.org home** — vertical slice to validate the system end-to-end (nav, ribbon, footer,
   theme, responsive, code-terminal component).
3. **.org content** — migrate + re-shell intro, docs, get-started, tutorial, api, blog.
4. **.com home** — Flux landing (hero, stats, features, license steps, CTA, gradient blobs).
5. **.com pricing** — lead form UI + success/FAQ.
6. **Function** — `/api/contact` + Resend wiring; Turnstile + honeypot.
7. **Redirects / SEO** — `_redirects`, canonicals, sitemaps.
8. **Cutover** — Cloudflare setup (owner), preview verification, DNS switch.

---

## 13. Open questions / risks
- **Domains**: imqueue.org and imqueue.net are **registered** ✓ (owner confirmed).
- **Cross-domain theme**: not synced across .com/.org (separate origins) — **acceptable** ✓ (owner confirmed); each domain remembers its own theme.
- **API docs styling**: generated HTML is verbose; decide how deeply to re-skin vs. wrap. *(still open — resolve during .org content phase)*
- **Blog**: lives on **.org** ✓ (owner confirmed).
- **Fonts**: self-host ✓ (owner confirmed) — Space Grotesk, JetBrains Mono, Inter as woff2.
- **`from:` address** for Resend: `noreply@imqueue.com` ✓ (owner confirmed).
```
