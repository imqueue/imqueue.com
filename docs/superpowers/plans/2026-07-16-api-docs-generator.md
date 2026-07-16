# API Docs Generator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add tooling in imqueue.com that generates `@imqueue/core` and `@imqueue/rpc` API reference docs (TypeScript 7) as standalone HTML under `api/<pkg>/<version>/`, and generate them for 3.2.1.

**Architecture:** A local `npm run build-docs` script builds each sibling package (emitting `.d.ts`), runs Microsoft **API Extractor** (`.d.ts` → `.api.json`) and **API Documenter** (`.api.json` → markdown), then renders the markdown to plain standalone HTML (minimal CSS, no site chrome) with intra-doc `.md`→`.html` links rewritten. Output is committed and served verbatim by the existing Eleventy passthrough for `api/**`.

**Tech Stack:** Node (CommonJS), `@microsoft/api-extractor`, `@microsoft/api-documenter`, `typescript@~5.8` (extractor only, to parse the stable `.d.ts`), `markdown-it` (already a repo dependency).

## Global Constraints

- **Packages:** `core` and `rpc` only (siblings `../core`, `../rpc`). Not cli.
- **Version:** read from each sibling `package.json` (currently **3.2.1**). Do not hard-code.
- **Output:** `api/<pkg>/<version>/*.html`, standalone (own `<title>`, one `<link>` to `/api/assets/apidoc.css`, no imqueue.com header/menu/footer).
- **TS 7 handling:** the extractor parses the emitted `.d.ts` using pinned `typescript@~5.8` via an inline `overrideTsconfig`; the TS 7 *source* is never parsed by the doc tools.
- **Run model:** local only (needs sibling source). Generated output is committed to the repo; CI just serves it. No Eleventy config change (relies on existing `api/**/*.html` passthrough + ignore).
- **Internal links:** every intra-doc link between generated pages must resolve (`.md` links rewritten to `.html`).

---

### Task 1: Install tooling and prove extraction works on both packages

This is the load-bearing task: it validates that API Extractor can read the TS 7 `.d.ts` at all. If it can't, stop and report before building the rest.

**Files:**
- Modify: `package.json` (devDependencies)
- Create: `api-extractor.core.json`, `api-extractor.rpc.json`
- Modify: `.gitignore` (ignore the `.api-tmp/` work dir)

**Interfaces:**
- Produces: `.api-tmp/core.api.json` and `.api-tmp/rpc.api.json` (the extractor model files later tasks feed to API Documenter).

- [ ] **Step 1: Add devDependencies**

Edit `package.json` `devDependencies` to add (keep the existing entries):
```json
    "@microsoft/api-extractor": "^7.47.0",
    "@microsoft/api-documenter": "^7.25.0",
    "typescript": "~5.8.0"
```

- [ ] **Step 2: Install**

```bash
cd ~/Projects/imqueue/imqueue.com
npm install
```
Expected: no errors; `npx api-extractor --help` and `npx api-documenter --help` both run.

- [ ] **Step 3: Ignore the work directory**

Append to `.gitignore`:
```
.api-tmp/
```

- [ ] **Step 4: Create `api-extractor.core.json`**

Paths resolve relative to this config file's folder (imqueue.com); `<projectFolder>` and `<unscopedPackageName>` are API Extractor tokens. `overrideTsconfig` keeps extraction independent of the sibling's TS 7 tsconfig.

```json
{
  "$schema": "https://developer.microsoft.com/json-schemas/api-extractor/v7/api-extractor.schema.json",
  "projectFolder": "../core",
  "mainEntryPointFilePath": "<projectFolder>/index.d.ts",
  "bundledPackages": [],
  "compiler": {
    "overrideTsconfig": {
      "compilerOptions": {
        "target": "ESNext",
        "module": "nodenext",
        "moduleResolution": "nodenext",
        "skipLibCheck": true,
        "types": [],
        "lib": ["ESNext"]
      },
      "include": ["index.d.ts"]
    }
  },
  "apiReport": { "enabled": false },
  "docModel": {
    "enabled": true,
    "apiJsonFilePath": ".api-tmp/<unscopedPackageName>.api.json"
  },
  "dtsRollup": { "enabled": false },
  "tsdocMetadata": { "enabled": false },
  "messages": {
    "compilerMessageReporting": { "default": { "logLevel": "warning" } },
    "extractorMessageReporting": {
      "default": { "logLevel": "warning" },
      "ae-missing-release-tag": { "logLevel": "none" },
      "ae-unresolved-link": { "logLevel": "none" }
    }
  }
}
```

- [ ] **Step 5: Create `api-extractor.rpc.json`**

Identical except `projectFolder`:
```json
{
  "$schema": "https://developer.microsoft.com/json-schemas/api-extractor/v7/api-extractor.schema.json",
  "projectFolder": "../rpc",
  "mainEntryPointFilePath": "<projectFolder>/index.d.ts",
  "bundledPackages": [],
  "compiler": {
    "overrideTsconfig": {
      "compilerOptions": {
        "target": "ESNext",
        "module": "nodenext",
        "moduleResolution": "nodenext",
        "skipLibCheck": true,
        "types": [],
        "lib": ["ESNext"]
      },
      "include": ["index.d.ts"]
    }
  },
  "apiReport": { "enabled": false },
  "docModel": {
    "enabled": true,
    "apiJsonFilePath": ".api-tmp/<unscopedPackageName>.api.json"
  },
  "dtsRollup": { "enabled": false },
  "tsdocMetadata": { "enabled": false },
  "messages": {
    "compilerMessageReporting": { "default": { "logLevel": "warning" } },
    "extractorMessageReporting": {
      "default": { "logLevel": "warning" },
      "ae-missing-release-tag": { "logLevel": "none" },
      "ae-unresolved-link": { "logLevel": "none" }
    }
  }
}
```

- [ ] **Step 6: Build siblings so `.d.ts` are fresh**

```bash
cd ~/Projects/imqueue/imqueue.com
npm run build --prefix ../core
npm run build --prefix ../rpc
```
Expected: both `tsc` builds succeed; `../core/index.d.ts` and `../rpc/index.d.ts` exist.

- [ ] **Step 7: Run the extractor for both packages**

```bash
cd ~/Projects/imqueue/imqueue.com
npx api-extractor run --local --config api-extractor.core.json
npx api-extractor run --local --config api-extractor.rpc.json
```
Expected: each completes (warnings OK, no fatal error). If the extractor reports an "unsupported TypeScript version," that is a warning, not fatal — proceed. If it reports a fatal parse error on a specific `.d.ts` construct, STOP and report the exact file/construct (this is the plan's known risk; do not work around it silently).

- [ ] **Step 8: Verify the model files exist and have real content**

```bash
cd ~/Projects/imqueue/imqueue.com
for p in core rpc; do
  test -s ".api-tmp/$p.api.json" && echo "OK $p.api.json ($(wc -c < .api-tmp/$p.api.json) bytes)" || echo "MISSING $p.api.json"
done
grep -q '"kind": "Class"' .api-tmp/core.api.json && echo "core has classes" || echo "core: no classes found"
grep -oE '"@imqueue/(core|rpc)!' .api-tmp/core.api.json .api-tmp/rpc.api.json | sort -u
```
Expected: both files present and non-trivial; core model contains class entries; canonical references name the packages.

- [ ] **Step 9: Commit**

```bash
cd ~/Projects/imqueue/imqueue.com
git add package.json .gitignore api-extractor.core.json api-extractor.rpc.json
git add -f package-lock.json
git commit -m "build: add API Extractor tooling and configs for core/rpc docs"
```

---

### Task 2: Generator script — documenter + render to standalone HTML

**Files:**
- Modify: `api-docs.js` (full rewrite)
- Create: `api/assets/apidoc.css`
- Modify: `package.json` (keep `build-docs` script; ensure it is `node api-docs`)

**Interfaces:**
- Consumes: the `api-extractor.<pkg>.json` configs from Task 1; `markdown-it` (installed).
- Produces: `api/core/3.2.1/*.html` and `api/rpc/3.2.1/*.html` (standalone pages), plus `api/assets/apidoc.css`.

- [ ] **Step 1: Create `api/assets/apidoc.css`**

```css
:root { color-scheme: light dark; }
body { margin: 0; }
.apidoc {
  max-width: 900px;
  margin: 2rem auto;
  padding: 0 1rem;
  font: 16px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  color: #24292f;
}
.apidoc h1, .apidoc h2, .apidoc h3, .apidoc h4 { line-height: 1.25; margin: 1.6rem 0 .8rem; }
.apidoc h1 { font-size: 1.9rem; border-bottom: 1px solid #d0d7de; padding-bottom: .3rem; }
.apidoc h2 { font-size: 1.4rem; border-bottom: 1px solid #d0d7de; padding-bottom: .3rem; }
.apidoc a { color: #0969da; text-decoration: none; }
.apidoc a:hover { text-decoration: underline; }
.apidoc code {
  background: #f6f8fa; padding: .15em .35em; border-radius: 4px;
  font: 0.9em/1.4 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}
.apidoc pre { background: #f6f8fa; padding: 1rem; border-radius: 6px; overflow: auto; }
.apidoc pre code { background: none; padding: 0; }
.apidoc table {
  border-collapse: collapse; width: 100%; margin: 1rem 0;
  display: block; overflow-x: auto;
}
.apidoc th, .apidoc td { border: 1px solid #d0d7de; padding: .5rem .75rem; text-align: left; vertical-align: top; }
.apidoc th { background: #f6f8fa; }
@media (prefers-color-scheme: dark) {
  .apidoc { color: #c9d1d9; }
  .apidoc h1, .apidoc h2 { border-color: #30363d; }
  .apidoc code, .apidoc pre, .apidoc th { background: #161b22; }
  .apidoc th, .apidoc td { border-color: #30363d; }
  .apidoc a { color: #58a6ff; }
}
```

- [ ] **Step 2: Rewrite `api-docs.js`**

```js
// api-docs.js — generate @imqueue API docs (core, rpc) as standalone HTML pages.
// Local tool: requires sibling ../core and ../rpc source repos. Run: npm run build-docs
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const MarkdownIt = require('markdown-it');

const ROOT = process.cwd();
const TMP = path.join(ROOT, '.api-tmp');
const PKGS = [
  { name: 'core', repo: path.resolve(ROOT, '../core'), config: 'api-extractor.core.json' },
  { name: 'rpc',  repo: path.resolve(ROOT, '../rpc'),  config: 'api-extractor.rpc.json' },
];

const md = new MarkdownIt({ html: true, linkify: false });

function sh(cmd, cwd) {
  console.log(`$ ${cmd}`);
  execSync(cmd, { cwd: cwd || ROOT, stdio: 'inherit' });
}
function rmrf(p) { fs.rmSync(p, { recursive: true, force: true }); }

function firstHeading(text, fallback) {
  const m = text.match(/^#\s+(.+?)\s*$/m);
  return m ? m[1].replace(/[\\`]/g, '').trim() : fallback;
}

function renderPage(mdText, title) {
  const body = md.render(mdText)
    // rewrite intra-doc links: ./foo.md and foo.md#anchor -> .html
    .replace(/href="([^"]+?)\.md(#[^"]*)?"/g, 'href="$1.html$2"');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<link rel="stylesheet" href="/api/assets/apidoc.css">
</head>
<body>
<main class="apidoc">
${body}
</main>
</body>
</html>
`;
}

function main() {
  rmrf(TMP);
  fs.mkdirSync(TMP, { recursive: true });

  for (const pkg of PKGS) {
    const version = require(path.join(pkg.repo, 'package.json')).version;
    console.log(`\n=== @imqueue/${pkg.name}@${version} ===`);

    // 1. build sibling -> fresh .d.ts
    sh('npm run build', pkg.repo);

    // 2. API Extractor -> .api-tmp/<pkg>.api.json
    sh(`npx api-extractor run --local --config ${pkg.config}`);

    // isolate the model in its own input folder for the documenter
    const modelDir = path.join(TMP, `${pkg.name}-model`);
    fs.mkdirSync(modelDir, { recursive: true });
    fs.copyFileSync(
      path.join(TMP, `${pkg.name}.api.json`),
      path.join(modelDir, `${pkg.name}.api.json`),
    );

    // 3. API Documenter -> markdown
    const mdDir = path.join(TMP, `${pkg.name}-md`);
    sh(`npx api-documenter markdown --input-folder "${modelDir}" --output-folder "${mdDir}"`);

    // 4. render markdown -> standalone HTML into api/<pkg>/<version>/
    const outDir = path.join(ROOT, 'api', pkg.name, version);
    rmrf(outDir);
    fs.mkdirSync(outDir, { recursive: true });
    let count = 0;
    for (const file of fs.readdirSync(mdDir)) {
      if (!file.endsWith('.md')) continue;
      const src = fs.readFileSync(path.join(mdDir, file), 'utf8');
      const title = `${firstHeading(src, pkg.name)} | @imqueue/${pkg.name} ${version}`;
      fs.writeFileSync(
        path.join(outDir, file.replace(/\.md$/, '.html')),
        renderPage(src, title),
      );
      count++;
    }
    console.log(`Wrote ${count} pages to ${path.relative(ROOT, outDir)}`);
  }

  rmrf(TMP);
  console.log('\nDone!');
}

main();
```

- [ ] **Step 3: Confirm the npm script**

Ensure `package.json` still has:
```json
    "build-docs": "node api-docs"
```

- [ ] **Step 4: Run the generator**

```bash
cd ~/Projects/imqueue/imqueue.com
npm run build-docs
```
Expected: ends with `Done!`; logs "Wrote N pages" for both packages.

- [ ] **Step 5: Verify standalone HTML output**

```bash
cd ~/Projects/imqueue/imqueue.com
for p in core rpc; do
  echo "== $p =="
  test -f "api/$p/3.2.1/index.html" && echo "index.html OK" || echo "MISSING index.html"
  echo "page count: $(ls api/$p/3.2.1/*.html | wc -l)"
done
echo "== standalone (no site chrome)? should be 0 =="
grep -l 'top-bar\|logo.svg\|donate-button' api/core/3.2.1/*.html api/rpc/3.2.1/*.html 2>/dev/null | wc -l
echo "== css linked =="
grep -c '/api/assets/apidoc.css' api/core/3.2.1/index.html
echo "== no leftover .md links =="
grep -rlE 'href="[^"]+\.md(#|")' api/core/3.2.1/ api/rpc/3.2.1/ 2>/dev/null || echo "none"
```
Expected: `index.html` present for both; page counts > 1; 0 pages with site chrome; css link present; no `.md` links remain.

- [ ] **Step 6: Verify inter-page links resolve**

```bash
cd ~/Projects/imqueue/imqueue.com
node -e '
const fs=require("fs"),path=require("path");
let bad=0,checked=0;
for (const pkg of ["core","rpc"]) {
  const dir=`api/${pkg}/3.2.1`;
  for (const f of fs.readdirSync(dir)) {
    if(!f.endsWith(".html"))continue;
    const html=fs.readFileSync(path.join(dir,f),"utf8");
    for(const m of html.matchAll(/href="(?!https?:|\/|#)([^"#]+\.html)/g)){
      checked++;
      if(!fs.existsSync(path.join(dir,m[1]))){bad++;console.log("DANGLING",dir,f,"->",m[1]);}
    }
  }
}
console.log(`checked ${checked} relative links, ${bad} dangling`);
process.exit(bad?1:0);
'
```
Expected: `0 dangling`.

- [ ] **Step 7: Commit tooling (not the generated pages yet)**

```bash
cd ~/Projects/imqueue/imqueue.com
git add api-docs.js api/assets/apidoc.css package.json
git commit -m "feat: generate standalone API doc pages via API Documenter + markdown-it"
```

---

### Task 3: Discoverability link, Eleventy verification, commit generated docs

**Files:**
- Modify: `api/index.md`
- Add (generated): `api/core/3.2.1/**`, `api/rpc/3.2.1/**`

**Interfaces:**
- Consumes: generated pages from Task 2; the Eleventy build.

- [ ] **Step 1: Add a discoverability link to `api/index.md`**

Insert this block immediately after the front matter's closing `---` and the `{% include api/intro.md %}` line region — place it right after the TOC/intro area so it is visible near the top. Add:

```markdown
<div class="panel radius">

**Latest generated API reference (v3.2.1):**
[@imqueue/core](/api/core/3.2.1/) &middot; [@imqueue/rpc](/api/rpc/3.2.1/)

</div>
```
Do NOT add a `markdown="1"` attribute (the site migrated off kramdown; markdown-it renders inner markdown via the blank lines instead). Keep a blank line immediately after `<div ...>` and before `</div>`. If `api/index.md` has a `[[toc]]` block, place this block after it.

- [ ] **Step 2: Confirm the links point at real files**

```bash
cd ~/Projects/imqueue/imqueue.com
test -f api/core/3.2.1/index.html && test -f api/rpc/3.2.1/index.html && echo "targets exist"
```
Expected: `targets exist`.

- [ ] **Step 3: Eleventy build serves the new docs**

```bash
cd ~/Projects/imqueue/imqueue.com
npx @11ty/eleventy 2>&1 | tail -1
test -f _site/api/core/3.2.1/index.html && test -f _site/api/rpc/3.2.1/index.html && echo "served in _site"
test -f _site/api/assets/apidoc.css && echo "css served"
grep -c '/api/core/3.2.1/' _site/api/index.html
```
Expected: build succeeds; both index pages present in `_site`; css served; the landing shows the 3.2.1 link.

- [ ] **Step 4: Spot-check a generated page renders as intended**

```bash
cd ~/Projects/imqueue/imqueue.com
grep -o '<title>[^<]*</title>' _site/api/core/3.2.1/index.html
grep -c '<table>' _site/api/core/3.2.1/index.html
```
Expected: a sensible title (e.g. contains `@imqueue/core 3.2.1`); at least one table rendered.

- [ ] **Step 5: Commit the landing edit and the generated docs**

```bash
cd ~/Projects/imqueue/imqueue.com
git add api/index.md api/core/3.2.1 api/rpc/3.2.1
git commit -m "docs: generate @imqueue core/rpc 3.2.1 API reference and link from /api/"
```

---

## Notes for the executor

- **Task 1 is the risk gate.** If API Extractor cannot parse the TS 7 `.d.ts`, report the exact failing construct rather than improvising a different toolchain — the tool choice was a deliberate user decision.
- **Verification is run-and-inspect**, not unit tests. Paste actual command output; treat any dangling link, missing `index.html`, or site-chrome leakage as a failure to fix before committing.
- **Path resolution** in `api-extractor.<pkg>.json` is relative to the config file (imqueue.com); if the extractor writes the `.api.json` somewhere other than `.api-tmp/<pkg>.api.json`, adjust the config's `apiJsonFilePath` (and the script's copy path) so they agree, and note it.
- **Do not edit** files inside the sibling `../core` / `../rpc` repos; only build them.
