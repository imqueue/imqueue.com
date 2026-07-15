# Design: Migrate imqueue.com from Jekyll to Eleventy + GitHub Actions

**Date:** 2026-07-15
**Branch:** `chore/eleventy-migration`
**Status:** Approved

## Goal

Remove the Ruby/Jekyll toolchain and replace it with a single Node-based
Eleventy (11ty) build, deployed to GitHub Pages through an explicit GitHub
Actions workflow — while preserving all current URLs and producing output
that matches the existing site.

## Why Eleventy, and why low-risk

Eleventy runs the same **Liquid** template engine Jekyll uses, so the existing
`_layouts/`, `_includes/`, and `_data/` carry over almost verbatim. It is
Node-based (the repo already has `package.json`), so the Ruby dependency
disappears entirely.

Verification is unusually strong: the committed `_site/` directory is the
current Jekyll output (built 2025-07-03). It serves as the golden reference —
Eleventy's output is diffed against it and differences are driven to zero.

## Current state (as surveyed)

- Jekyll site, built by GitHub Pages classic auto-build (no `.github/` exists).
- Liquid usage is modest:
  - Layouts: `default` (main chrome), and `docs`/`page`/`blog` → `default`,
    `post` → `blog` → `default` (native layout chaining).
  - Includes: `slider.html`, `whys.html`, `thanks.html` (used by `index.html`),
    and `api/{intro,rpc,mq,misc}.md` (included into `api/index.md`). All use
    Jekyll's **unquoted** include syntax: `{% include slider.html %}`.
  - Data: `_data/nav.yml`, `slides.yml`, `whys.yml`; plus `slogan` + `url`
    from `_config.yml`.
- Content pages: `index.html`, `docs.html`, `intro/index.html`,
  `get-started.md`, `contributing.md`, `licence.md`, `tutorial/*.md`,
  `api/index.md`.
- `api/` also contains 340 pre-generated TypeDoc HTML files — already static.
- Blog is effectively dead: no `_posts/`, nav link commented out, only an empty
  `blog/index.html` and a `jekyll-paginate` dependency remain.
- Site chrome: Google Analytics, MS Clarity, PayPal donate button, and a
  client-side fetch of GitHub tags — all pure client-side, unaffected by the
  build change.
- Ruby gems pin ancient versions (asciidoctor 1.5.4, pygments.rb 0.6.3).

## URL structure to preserve (from `_site/`)

Jekyll emits **flat** HTML at the input path:

| Source | Output URL |
|--------|-----------|
| `index.html` | `/` (`/index.html`) |
| `get-started.md` | `/get-started.html` |
| `docs.html` | `/docs.html` |
| `contributing.md` | `/contributing.html` |
| `licence.md` | `/licence.html` |
| `intro/index.html` | `/intro/index.html` |
| `tutorial/*.md` | `/tutorial/*.html` |
| `api/index.md` | `/api/index.html` |
| `blog/index.html` | `/blog/index.html` |

Extensionless nav links (`/get-started`, `/docs`, `/tutorial`) already resolve
to these `.html` files via GitHub Pages' clean-URL serving. This must not change.

## Decisions

- **Engine:** Eleventy v3 (requires Node 18+); config `eleventy.config.js` (CJS).
- **Blog:** keep as a **stub** — retain `blog.html`/`post.html` layouts and the
  empty `blog/index.html`; drop pagination (no posts exist).
- **API docs:** `api/` **passed through untouched** (static copy, not templated).

## Detailed design

### 1. Eleventy config (`eleventy.config.js`)

- `dir: { input: '.', output: '_site', includes: '_includes', layouts: '_layouts', data: '_data' }`.
- LiquidJS options with **`jekyllInclude: true`** so existing unquoted include
  tags (`{% include slider.html %}`, `{% include api/rpc.md %}`) work unchanged.
- **URL parity via a global `permalink` rule** of `${page.filePathStem}.html`,
  reproducing Jekyll's flat output. (`index.html` → `/index.html`,
  `get-started.md` → `/get-started.html`, `intro/index.html` →
  `/intro/index.html`.)
- Passthrough copy for static assets that must not be templated:
  `api/`, `css/`, `js/`, `fonts/`, `images/`, `favicon.ico`, `CNAME`, `TODO.txt`.
- Ignore from processing: `_site`, `node_modules`, `README.md`,
  `docs/` (the spec folder), `.idea/`. (`TODO.txt` is passthrough-copied above,
  matching its presence in the current `_site`.)

### 2. Data & template edits (minimal)

- Create `_data/site.yml` with `slogan` and `url` (moved from `_config.yml`),
  so `{{ site.slogan }}` and `{{ site.url }}` keep resolving.
- Eleventy auto-exposes `_data/nav.yml`/`slides.yml`/`whys.yml` as
  `nav`/`slides`/`whys`. Edit the **three** template references:
  - `_layouts/default.html`: `site.data.nav` → `nav`
  - `_includes/whys.html`: `site.data.whys` → `whys`
  - `_includes/slider.html`: `site.data.slides` → `slides`
- No other template edits expected for the layouts/includes.

### 3. Markdown (kramdown → markdown-it) — the main work item

The `.md` pages use kramdown-specific syntax markdown-it doesn't natively
support. Add markdown-it plugins and adjust source where needed:

- **Auto TOC** `{:#toc}` / `* TOC` / `{:toc}` on 5 pages
  (`get-started.md`, `api/index.md`, `tutorial/{auth-service,deployment,other-services}.md`):
  add `markdown-it-anchor` + `markdown-it-table-of-contents`; replace the
  kramdown TOC block with the plugin's marker.
- **Attribute lists** `{: ... }` / `{:#id}`: add `markdown-it-attrs`.
- **`markdown="1"`** on HTML blocks: verify markdown-it renders the inner
  markdown; adjust markup where behavior differs.

Each page is validated against its `_site/*.html` counterpart (normalized diff).

### 4. Sitemap, robots, CNAME, .nojekyll

- Replace `jekyll-sitemap` with a small `sitemap.njk` (or Liquid) template
  iterating `collections.all` and emitting `<url>` entries; output `sitemap.xml`.
- Keep a static `robots.txt` (present in current `_site`).
- `CNAME` passes through unchanged (custom domain `imqueue.com`).
- Emit `.nojekyll` into output so GitHub Pages serves the artifact verbatim
  (insurance against any `_`-prefixed paths).

### 5. Build tooling & cleanup

- `package.json`:
  - Add devDependencies: `@11ty/eleventy`, `markdown-it-anchor`,
    `markdown-it-table-of-contents`, `markdown-it-attrs`.
  - Scripts: `build` = `eleventy`, `serve` = `eleventy --serve`; keep
    `build-docs`; remove the Jekyll `start`.
- **Delete:** `Gemfile`, `Gemfile.lock`, `_config.yml`, `.jekyll-cache/`.
- Update `README.md` build instructions (Node/npm, not Ruby/bundler).

### 6. GitHub Actions workflow (`.github/workflows/deploy.yml`)

- Triggers: `push` to `master`, plus `workflow_dispatch`.
- Permissions: `contents: read`, `pages: write`, `id-token: write`.
- Concurrency group `pages`, cancel-in-progress false.
- Build job: `actions/checkout` → `actions/setup-node` (Node 20, npm cache) →
  `npm ci` → `npx @11ty/eleventy` → `actions/configure-pages` →
  `actions/upload-pages-artifact` (path `_site`).
- Deploy job: `actions/deploy-pages` (environment `github-pages`).
- **Manual one-time step (documented for the user):** in repo Settings → Pages,
  switch *Source* from "Deploy from a branch" to "GitHub Actions".

### 7. Verification strategy

1. `npm ci && npx @11ty/eleventy` builds without error.
2. Normalized diff of Eleventy output vs. the committed `_site/` (the Jekyll
   golden output); iterate until only intended differences remain.
3. `npx @11ty/eleventy --serve` and browser spot-check: home slider + why
   counters, sticky nav dropdown + active states, footer, docs page cards,
   get-started/tutorial TOC + code blocks, api page includes.
4. Confirm `sitemap.xml`, `robots.txt`, `CNAME`, `.nojekyll` present in output.

## Out of scope

- No redesign of styles, content, or the TypeDoc API output.
- No revival of the blog beyond the existing stub.
- No changes to analytics, Clarity, PayPal, or GitHub-tag client scripts.

## Risks

- **kramdown vs markdown-it rendering drift** — mitigated by golden-output diff
  and per-page checks; plugins chosen to cover the specific syntax in use.
- **Pages source switch** is a manual GitHub setting; until flipped, the classic
  build stays active. Documented as an explicit deploy step.
