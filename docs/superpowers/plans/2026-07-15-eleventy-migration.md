# Eleventy Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Jekyll/Ruby build of imqueue.com with a single Node-based Eleventy build deployed to GitHub Pages via GitHub Actions, preserving all current URLs and output.

**Architecture:** Eleventy v3 runs the same Liquid engine Jekyll used, so `_layouts/`, `_includes/`, and `_data/` carry over with minimal edits. A global permalink rule reproduces Jekyll's flat `.html` URLs. Static assets (`api/` TypeDoc, `css/`, `js/`, `fonts/`, `images/`) are passthrough-copied. The committed `_site/` (current Jekyll output) is the golden reference every task diffs against.

**Tech Stack:** Node 20, Eleventy v3 (`@11ty/eleventy`), LiquidJS (built in, `jekyllInclude` mode), `markdown-it` + plugins (`markdown-it-anchor`, `markdown-it-table-of-contents`, `markdown-it-attrs`), GitHub Actions Pages deploy.

## Global Constraints

- **Node:** 20 (Eleventy v3 requires Node 18+). Copied verbatim into the workflow.
- **Output dir:** `_site` (unchanged from Jekyll).
- **Preserve URLs exactly:** flat `.html` at input path — `get-started.md` → `/get-started.html`, `intro/index.html` → `/intro/index.html`, `tutorial/*.md` → `/tutorial/*.html`, `api/index.md` → `/api/index.html`. Extensionless nav links resolve via GitHub Pages clean-URL serving.
- **`api/` is untouched:** 340 `.html` + 14 `.css` + 30 `.js` + 10 `.map` + 40 `.png` + 2 `.svg` TypeDoc files are passthrough-copied verbatim; only `api/index.md` is templated.
- **Blog stays a stub:** keep `_layouts/blog.html`, `_layouts/post.html`, `blog/index.html`; no pagination (no posts exist).
- **Golden reference:** current local `_site/` = Jekyll output. Copy it to `.golden-site/` before the first Eleventy build; diff against it thereafter.
- **Config file name:** `eleventy.config.js` (CommonJS `module.exports`).

---

### Task 0: Preserve golden reference and guard it from git

**Files:**
- Create: `.golden-site/` (copy of current `_site/`, gitignored)
- Modify: `.gitignore`

- [ ] **Step 1: Confirm you are on the migration branch**

Run: `git -C ~/Projects/imqueue/imqueue.com branch --show-current`
Expected: `chore/eleventy-migration`

- [ ] **Step 2: Copy the current Jekyll output to the golden reference**

The current `_site/` is the Jekyll-built output. Preserve it before any Eleventy build overwrites `_site/`.

```bash
cd ~/Projects/imqueue/imqueue.com
rm -rf .golden-site
cp -r _site .golden-site
```

- [ ] **Step 3: Verify the golden copy exists**

Run: `ls .golden-site/index.html .golden-site/get-started.html .golden-site/sitemap.xml .golden-site/robots.txt`
Expected: all four paths listed, no errors.

- [ ] **Step 4: Ignore the golden copy in git**

Add `.golden-site/` to `.gitignore` (append below the existing `_site/` line):

```
.golden-site/
```

- [ ] **Step 5: Commit**

```bash
git add .gitignore
git commit -m "chore: gitignore local golden-site reference"
```

---

### Task 1: Eleventy scaffold — config, data, template edits, clean build

**Files:**
- Modify: `package.json`
- Create: `eleventy.config.js`
- Create: `_data/site.yml`
- Create: `_data/eleventyComputed.js`
- Create: `.eleventyignore`
- Create: `.nojekyll`
- Modify: `_layouts/default.html:75` (`site.data.nav` → `nav`)
- Modify: `_includes/whys.html:10` (`site.data.whys` → `whys`)
- Modify: `_includes/slider.html:2,4` (`site.data.slides` → `slides`; keep `site.url`)
- Modify: `blog/index.html` (drop `paginator`, use empty-safe `collections.posts`)

**Interfaces:**
- Produces: `_data/site.yml` exposing `site.slogan` and `site.url`; global permalink rule `${page.filePathStem}.html`; passthrough copies of all static asset dirs. Later tasks rely on `site.url` (sitemap) and on the build emitting `_site/`.

- [ ] **Step 1: Update `package.json` (scripts + devDependencies)**

Replace the `"devDpendencies": {}` line (note: it is misspelled) and the `scripts` block. Final relevant sections:

```json
  "dependencies": {},
  "devDependencies": {
    "@11ty/eleventy": "^3.0.0",
    "markdown-it": "^14.1.0",
    "markdown-it-anchor": "^9.2.0",
    "markdown-it-table-of-contents": "^0.9.0",
    "markdown-it-attrs": "^4.3.1"
  },
  "scripts": {
    "test": "echo \"Error: no test specified\" && exit 0",
    "build": "eleventy",
    "serve": "eleventy --serve",
    "build-docs": "node api-docs"
  },
```

- [ ] **Step 2: Install dependencies**

```bash
cd ~/Projects/imqueue/imqueue.com
npm install
```

Expected: `node_modules/` created, `@11ty/eleventy` present. Verify:
Run: `npx @11ty/eleventy --version`
Expected: a `3.x.x` version string.

- [ ] **Step 3: Create `_data/site.yml`**

These two keys were top-level in the old `_config.yml`; templates reference `{{ site.slogan }}` and `{{ site.url }}`.

```yaml
slogan: Intercommunication Messaging Queue For Microservices using Node and Typescript
url: "https://imqueue.com"
```

- [ ] **Step 4: Create `_data/eleventyComputed.js` (flat-URL permalink rule)**

```js
module.exports = {
  // Reproduce Jekyll's flat output: get-started.md -> /get-started.html.
  // Respect any explicit front-matter permalink (e.g. sitemap.xml).
  permalink: (data) => {
    if (data.permalink && data.permalink !== true) {
      return data.permalink;
    }
    return `${data.page.filePathStem}.html`;
  },
};
```

- [ ] **Step 5: Create `eleventy.config.js`**

```js
module.exports = function (eleventyConfig) {
  // Jekyll-compatible Liquid: allow unquoted {% include foo.html %}.
  eleventyConfig.setLiquidOptions({
    jekyllInclude: true,
    dynamicPartials: false,
    strictFilters: false,
  });

  // Static assets copied verbatim (never run through the template engine).
  // api/ is copied by extension so the lone api/index.md stays a template.
  eleventyConfig.addPassthroughCopy("api/**/*.html");
  eleventyConfig.addPassthroughCopy("api/**/*.css");
  eleventyConfig.addPassthroughCopy("api/**/*.js");
  eleventyConfig.addPassthroughCopy("api/**/*.map");
  eleventyConfig.addPassthroughCopy("api/**/*.png");
  eleventyConfig.addPassthroughCopy("api/**/*.svg");
  eleventyConfig.addPassthroughCopy("css");
  eleventyConfig.addPassthroughCopy("js");
  eleventyConfig.addPassthroughCopy("fonts");
  eleventyConfig.addPassthroughCopy("images");
  eleventyConfig.addPassthroughCopy("favicon.ico");
  eleventyConfig.addPassthroughCopy("CNAME");
  eleventyConfig.addPassthroughCopy("TODO.txt");
  eleventyConfig.addPassthroughCopy("robots.txt");
  eleventyConfig.addPassthroughCopy(".nojekyll");

  return {
    dir: {
      input: ".",
      output: "_site",
      includes: "_includes",
      layouts: "_layouts",
      data: "_data",
    },
    markdownTemplateEngine: "liquid",
    htmlTemplateEngine: "liquid",
  };
};
```

- [ ] **Step 6: Create `.eleventyignore`**

Keeps passthrough-only files (and non-content) from being processed as templates. `api/**/*.html` prevents the 340 TypeDoc pages from being run through Liquid; `api/index.md` is deliberately NOT ignored.

```
_site
.golden-site
node_modules
README.md
docs
.idea
api/**/*.html
css/icons.html
```

- [ ] **Step 7: Create empty `.nojekyll`**

```bash
cd ~/Projects/imqueue/imqueue.com
touch .nojekyll
```

- [ ] **Step 8: Edit the three `site.data.*` references**

`_layouts/default.html` line 75:
```liquid
              {% for item in nav %}
```
`_includes/whys.html` line 10:
```liquid
    {% for why in whys %}
```
`_includes/slider.html` line 2 (leave the `{{ site.url }}` on line 4 unchanged):
```liquid
  {% for slide in slides %}
```

- [ ] **Step 9: Make `blog/index.html` stub-safe (no paginator)**

Replace the body (keep the front matter) so it does not reference the undefined `paginator`. Full file:

```liquid
---
layout: blog
title: Blog
section_id: blog
---

{% for post in collections.posts %}
  <div class='post'>
    <div class='timestamp left text-center'>
      <span class='month'>{{ post.date | date: "%h" }}</span>
      <span class='date'>{{ post.date | date: "%d" }}</span>
    </div>
    <div class='info'>
      <h3>
        <a href='{{ post.url }}'>{{ post.data.title }}</a>
      </h3>
      <p>By <span class='author'>{{ post.data.author }}</span></p>
    </div>
    <div class='content'>
      {{ post.templateContent }}
      <a class='button' href='{{ post.url }}'>Read more</a>
    </div>
  </div>
{% endfor %}
```

- [ ] **Step 10: Build**

```bash
cd ~/Projects/imqueue/imqueue.com
npx @11ty/eleventy
```

Expected: build succeeds, ends with a line like `Wrote N files`, no errors.

- [ ] **Step 11: Verify URL structure parity (HTML pages + assets)**

Run:
```bash
cd ~/Projects/imqueue/imqueue.com
for f in index.html docs.html get-started.html contributing.html licence.html \
         intro/index.html tutorial/index.html tutorial/api-service.html \
         blog/index.html api/index.html; do
  test -f "_site/$f" && echo "OK $f" || echo "MISSING $f"
done
test -f _site/api/core/2.0.2/index.html && echo "OK api passthrough" || echo "MISSING api passthrough"
test -f _site/css/style.css && echo "OK css passthrough" || echo "MISSING css passthrough"
test -f _site/CNAME && echo "OK CNAME" || echo "MISSING CNAME"
```
Expected: every line prints `OK ...`.

- [ ] **Step 12: Verify no unrendered Liquid leaked into HTML pages**

Run:
```bash
cd ~/Projects/imqueue/imqueue.com
grep -RlE '\{[%{]' _site/index.html _site/docs.html _site/intro/index.html || echo "CLEAN"
```
Expected: `CLEAN` (no template tags left in the rendered HTML-source pages).

- [ ] **Step 13: Spot-diff the home page against golden**

Run:
```bash
cd ~/Projects/imqueue/imqueue.com
diff <(grep -o 'href="[^"]*"' .golden-site/index.html | sort -u) \
     <(grep -o 'href="[^"]*"' _site/index.html | sort -u)
```
Expected: no output, or only trivial differences (whitespace/attribute ordering). Investigate any missing/extra links; the nav, slider, and footer links must match.

- [ ] **Step 14: Commit**

```bash
git add package.json eleventy.config.js _data/site.yml \
  _data/eleventyComputed.js .eleventyignore .nojekyll \
  _layouts/default.html _includes/whys.html _includes/slider.html blog/index.html
git add -f package-lock.json   # currently gitignored; needed for reproducible `npm ci` in CI
git commit -m "feat: add Eleventy build scaffolding and config"
```

Note: `package-lock.json` is force-added because the repo's `.gitignore` lists it — CI's `npm ci` requires a committed lockfile. Do NOT add it without `-f` (git will abort the whole `add` on an ignored path).

---

### Task 2: Markdown rendering parity (kramdown → markdown-it)

**Files:**
- Modify: `eleventy.config.js` (register markdown-it plugins)
- Modify: `get-started.md`, `api/index.md`, `tutorial/auth-service.md`, `tutorial/deployment.md`, `tutorial/other-services.md` (TOC blocks + `markdown="1"` blocks)

**Interfaces:**
- Consumes: the Eleventy config and build from Task 1.
- Produces: markdown pages whose rendered HTML matches golden — headings carry `id` anchors and a table of contents renders where kramdown's `{:toc}` was.

- [ ] **Step 1: Register markdown-it plugins in `eleventy.config.js`**

Add near the top of the exported function (before the `return`):

```js
  const markdownIt = require("markdown-it");
  const mdAnchor = require("markdown-it-anchor");
  const mdToc = require("markdown-it-table-of-contents");
  const mdAttrs = require("markdown-it-attrs");

  const md = markdownIt({ html: true, linkify: false, typographer: false })
    .use(mdAttrs)
    .use(mdAnchor, { permalink: false })
    .use(mdToc, {
      includeLevel: [2, 3],
      containerHeaderHtml: undefined,
      markerPattern: /^\[\[toc\]\]/im,
    });

  eleventyConfig.setLibrary("md", md);
```

- [ ] **Step 2: Replace the kramdown TOC block in each of the 5 pages**

In each file the current block is:
```markdown
<h4>Table Of Contents</h4>
{:#toc}
* TOC
{:toc}
```
Replace it with a blank-line-separated marker so markdown-it processes it (the `markdown="1"` wrapper div stays; the blank line makes markdown-it parse the inner content):
```markdown
<h4>Table Of Contents</h4>

[[toc]]
```
Ensure there is a blank line **before** `[[toc]]` and a blank line **after** it (before the closing `</div>`). Apply to: `get-started.md`, `api/index.md`, `tutorial/auth-service.md`, `tutorial/deployment.md`, `tutorial/other-services.md`.

- [ ] **Step 3: Fix `markdown="1"` inline blocks in `get-started.md`**

The `<p markdown="1">` intro block contains markdown (`` `@imqueue` ``, `[Tutorial](/tutorial/)`, `[here](/api/)`) that markdown-it will NOT process inside a `<p>` HTML block. Convert that inline markdown to HTML so it renders identically:

```html
<div class="special-title centered-text">
    <p>
        This is basic and shortest step-by-step guide how to start using <code>@imqueue</code>.
        For more detailed guide, take a look at <a href="/tutorial/">Tutorial</a>.<br>
        Full API technical documentation is available <a href="/api/">here</a>.
    </p>
    <p class="shortline"></p>
    <div class="spacing"></div>
    <div class="spacing"></div>
</div>
```

- [ ] **Step 4: Build**

```bash
cd ~/Projects/imqueue/imqueue.com
npx @11ty/eleventy
```
Expected: build succeeds, no errors.

- [ ] **Step 5: Verify TOC and anchors rendered (no literal kramdown left)**

Run:
```bash
cd ~/Projects/imqueue/imqueue.com
echo "== literal kramdown markers (must be empty) =="
grep -RnE '\{:#?toc\}|\[\[toc\]\]|markdown="1"' _site/get-started.html _site/api/index.html _site/tutorial/*.html || echo "NONE"
echo "== TOC container present =="
grep -l 'table-of-contents' _site/get-started.html _site/api/index.html
echo "== heading anchors present =="
grep -c 'id=' _site/get-started.html
```
Expected: first check prints `NONE`; the TOC container grep lists the files; heading-id count is > 0.

- [ ] **Step 6: Spot-diff heading text against golden**

Run:
```bash
cd ~/Projects/imqueue/imqueue.com
diff <(grep -oE '<h[23][^>]*>[^<]*' .golden-site/get-started.html | sed 's/<[^>]*>//g' | sort) \
     <(grep -oE '<h[23][^>]*>[^<]*' _site/get-started.html | sed 's/<[^>]*>//g' | sort)
```
Expected: no output (same headings). Investigate differences.

- [ ] **Step 7: Commit**

```bash
git add eleventy.config.js get-started.md api/index.md \
  tutorial/auth-service.md tutorial/deployment.md tutorial/other-services.md
git commit -m "feat: render markdown with markdown-it (TOC, anchors, attrs)"
```

---

### Task 3: Sitemap, robots.txt, and asset parity

**Files:**
- Create: `sitemap.liquid`
- Create: `robots.txt`

**Interfaces:**
- Consumes: `site.url` from Task 1; the build pipeline.
- Produces: `_site/sitemap.xml`, `_site/robots.txt`, `_site/.nojekyll`, `_site/CNAME` in output.

- [ ] **Step 1: Create `sitemap.liquid`**

The `permalink` front matter overrides the global `.html` rule (respected by `_data/eleventyComputed.js`). `eleventyExcludeFromCollections` keeps the sitemap out of its own listing. The loop variable is `item` (not `page`, which is reserved).

```liquid
---
permalink: /sitemap.xml
eleventyExcludeFromCollections: true
---
<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
{%- assign items = collections.all | sort: "url" -%}
{%- for item in items %}
  <url>
    <loc>{{ site.url }}{{ item.url }}</loc>
  </url>
{%- endfor %}
</urlset>
```

Note (intended deviation from golden): this sitemap lists the templated content pages only, not the 340 versioned TypeDoc pages that jekyll-sitemap swept in. Those are historical API-version dumps with negligible SEO value. Documented, not a defect.

- [ ] **Step 2: Create `robots.txt` (copy the golden content)**

Match the existing file so nothing regresses:
```bash
cd ~/Projects/imqueue/imqueue.com
cp .golden-site/robots.txt robots.txt
cat robots.txt
```
Expected: prints the robots content (a `User-agent`/`Sitemap` block). If `.golden-site/robots.txt` is absent, create it with:
```
User-agent: *
Sitemap: https://imqueue.com/sitemap.xml
```

- [ ] **Step 3: Build**

```bash
cd ~/Projects/imqueue/imqueue.com
npx @11ty/eleventy
```
Expected: build succeeds.

- [ ] **Step 4: Verify sitemap, robots, nojekyll, CNAME present and well-formed**

Run:
```bash
cd ~/Projects/imqueue/imqueue.com
test -f _site/sitemap.xml && echo "OK sitemap" || echo "MISSING sitemap"
test -f _site/robots.txt && echo "OK robots" || echo "MISSING robots"
test -f _site/.nojekyll && echo "OK nojekyll" || echo "MISSING nojekyll"
test -f _site/CNAME && echo "OK CNAME" || echo "MISSING CNAME"
head -3 _site/sitemap.xml
grep -c '<loc>' _site/sitemap.xml
```
Expected: four `OK` lines; sitemap starts with the XML declaration + `<urlset>`; `<loc>` count matches the number of content pages (roughly a dozen).

- [ ] **Step 5: Commit**

```bash
git add sitemap.liquid robots.txt
git commit -m "feat: generate sitemap.xml and add robots.txt"
```

---

### Task 4: Remove the Jekyll toolchain

**Files:**
- Delete: `Gemfile`, `Gemfile.lock`, `_config.yml`, `.jekyll-cache/`
- Modify: `README.md`

**Interfaces:**
- Consumes: a fully working Eleventy build (Tasks 1–3).
- Produces: a repo with no Ruby/Jekyll build inputs.

- [ ] **Step 1: Confirm nothing still references the Jekyll files**

Run:
```bash
cd ~/Projects/imqueue/imqueue.com
grep -RnI 'jekyll\|_config.yml\|bundle exec' \
  --exclude-dir=_site --exclude-dir=.golden-site --exclude-dir=node_modules \
  --exclude-dir=.git --exclude-dir=docs . || echo "NO REFERENCES"
```
Expected: `NO REFERENCES` (or only matches inside `.jekyll-cache/`, which is being deleted).

- [ ] **Step 2: Delete the Jekyll toolchain files**

```bash
cd ~/Projects/imqueue/imqueue.com
git rm -f Gemfile
git rm -f _config.yml
rm -f Gemfile.lock          # gitignored; remove from working tree
rm -rf .jekyll-cache        # gitignored build cache
```
(`Gemfile.lock` is in `.gitignore`, so `git rm` would report it as untracked — `rm -f` is correct.)

- [ ] **Step 3: Rebuild to confirm the site still builds without Jekyll files**

```bash
cd ~/Projects/imqueue/imqueue.com
npx @11ty/eleventy
```
Expected: build succeeds, same file count as Task 3.

- [ ] **Step 4: Update `README.md`**

Replace the Ruby instructions with the Node workflow. Full file:

```markdown
# Intercommunication Messaging Queue For Microservices

Please, visit at [imqueue.com](https://imqueue.com/)

This site is a static site built with [Eleventy](https://www.11ty.dev/).

## Local development

~~~
cd imqueue.com
npm install
npm run serve   # dev server with live reload at http://localhost:8080
~~~

## Production build

~~~
npm run build   # outputs static site to ./_site
~~~

Deployment is automated: pushing to `master` triggers the
`.github/workflows/deploy.yml` GitHub Actions workflow, which builds the site
and publishes `_site/` to GitHub Pages.
~~~
```

(Remove the trailing stray `~~~` if the editor adds one — the file should end after the deployment paragraph.)

- [ ] **Step 5: Commit**

```bash
git add README.md
git rm --cached --ignore-unmatch Gemfile.lock
git commit -m "chore: remove Jekyll toolchain, update README for Eleventy"
```

---

### Task 5: GitHub Actions deploy workflow

**Files:**
- Create: `.github/workflows/deploy.yml`

**Interfaces:**
- Consumes: `npm ci` + `npx @11ty/eleventy` producing `_site/` (Tasks 1–4); committed `package-lock.json`.
- Produces: an automated Pages deployment on push to `master`.

- [ ] **Step 1: Create `.github/workflows/deploy.yml`**

```yaml
name: Deploy to GitHub Pages

on:
  push:
    branches: [master]
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: pages
  cancel-in-progress: false

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm

      - name: Install dependencies
        run: npm ci

      - name: Build with Eleventy
        run: npx @11ty/eleventy

      - name: Configure Pages
        uses: actions/configure-pages@v5

      - name: Upload artifact
        uses: actions/upload-pages-artifact@v3
        with:
          path: _site

  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - name: Deploy to GitHub Pages
        id: deployment
        uses: actions/deploy-pages@v4
```

- [ ] **Step 2: Validate the workflow YAML parses**

Run:
```bash
cd ~/Projects/imqueue/imqueue.com
python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/deploy.yml')); print('YAML OK')"
```
Expected: `YAML OK`.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/deploy.yml
git commit -m "ci: add GitHub Actions workflow to build and deploy to Pages"
```

- [ ] **Step 4: Record the required manual step**

The workflow only takes effect once the repo's Pages source is switched. This is a GitHub UI action the human operator must perform (cannot be done from code):

> Repo **Settings → Pages → Build and deployment → Source → "GitHub Actions"**.

Leave this as a note in the final handoff; do not attempt it from the CLI.

---

### Task 6: Full output-parity verification and cleanup

**Files:** none created; verification + reference cleanup.

**Interfaces:**
- Consumes: the complete build (Tasks 1–5) and `.golden-site/`.

- [ ] **Step 1: Clean rebuild**

```bash
cd ~/Projects/imqueue/imqueue.com
rm -rf _site
npx @11ty/eleventy
```
Expected: build succeeds.

- [ ] **Step 2: Compare the file trees against golden**

Run:
```bash
cd ~/Projects/imqueue/imqueue.com
diff <(cd .golden-site && find . -type f | sort) \
     <(cd _site && find . -type f | sort)
```
Expected differences (acceptable, explain each): none missing among content/asset pages. `_site` may add `.nojekyll`; the sitemap has fewer `<loc>` entries by design. Any **missing** content page or asset is a defect to fix.

- [ ] **Step 3: Byte-compare a passthrough asset (must be identical)**

Run:
```bash
cd ~/Projects/imqueue/imqueue.com
diff .golden-site/api/core/2.0.2/index.html _site/api/core/2.0.2/index.html && echo "API IDENTICAL"
diff .golden-site/css/style.css _site/css/style.css && echo "CSS IDENTICAL"
```
Expected: both print `IDENTICAL` (passthrough copies are verbatim).

- [ ] **Step 4: Browser spot-check with the dev server**

```bash
cd ~/Projects/imqueue/imqueue.com
npx @11ty/eleventy --serve
```
Open `http://localhost:8080/` and verify:
- Home: slider renders, "why" counters/section present, footer + social icons.
- Sticky top nav: Documentation dropdown opens; active state highlights per page.
- `/get-started` and `/tutorial/`: Table of Contents renders and links jump to headings; code blocks styled.
- `/docs`: three section cards link correctly.
- `/api/`: included sections (intro/rpc/mq/misc) present; TypeDoc links under `/api/core/...` resolve.

Stop the server (Ctrl-C) when done.

- [ ] **Step 5: Remove the golden reference**

```bash
cd ~/Projects/imqueue/imqueue.com
rm -rf .golden-site
```

- [ ] **Step 6: Final status check**

Run: `git -C ~/Projects/imqueue/imqueue.com status`
Expected: clean tree (all migration commits made); `_site/`, `node_modules/`, `.golden-site/` untracked/ignored.

- [ ] **Step 7 (human): switch Pages source and push**

Push the branch and open a PR (or merge), then in GitHub **Settings → Pages** set **Source → GitHub Actions**. The first push to `master` after merge runs the workflow and deploys.

---

## Notes for the executor

- **Verification is diff-against-golden, not unit tests.** Each task's "test" is a build followed by a grep/diff assertion. Treat any unexplained diff from `.golden-site/` as a failure to investigate before committing.
- **Do not touch `api/` contents** — they are generated TypeDoc output, passthrough-copied verbatim.
- **Kramdown parity is the risk area** (Task 2). If a page still diverges after the documented fixes, compare its rendered HTML to `.golden-site/<page>` and adjust the source markdown/HTML until the meaningful content matches; minor attribute-order/whitespace differences are fine.
