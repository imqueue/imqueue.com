# Design: API Docs Generator (API Extractor + Documenter)

**Date:** 2026-07-16
**Branch:** `chore/eleventy-migration` (continued)
**Status:** Approved

## Goal

Add tooling in the imqueue.com repo that generates API reference documentation
for `@imqueue/core` and `@imqueue/rpc` — which are now on **TypeScript 7**
(TypeDoc was removed because it can't parse TS 7 source) — and produce it for
version **3.2.1**. Output is self-contained HTML under `api/<pkg>/<version>/`,
matching the existing per-version folder scheme.

## Context (surveyed)

- `../core` and `../rpc` are sibling repos, both at version **3.2.1**, both on
  `typescript@^7.0.2`. Their `doc`/TypeDoc script is gone.
- Each `npm run build` runs `tsc` with `declaration: true` (no `outDir`), emitting
  `.d.ts` alongside source. Entry declarations: `../core/index.d.ts`,
  `../rpc/index.d.ts` (per each package's `types` field). 52 `.d.ts` in core,
  76 in rpc.
- The old `api-docs.js` shelled into the siblings, ran their TypeDoc, and copied
  `docs/*` into `api/<pkg>/<version>/`. Existing `api/core/*/` and `api/rpc/*/`
  folders are standalone TypeDoc HTML dumps (latest 2.0.2 / 2.0.4).
- In the Eleventy build, `api/**/*.html` is already passthrough-copied verbatim
  and ignored from templating; `api/index.md` is the hand-written API landing.

## Decisions

- **Generator:** Microsoft **API Extractor** (`.d.ts` → `.api.json` model) +
  **API Documenter** (`.api.json` → markdown). Chosen by the user over TypeDoc
  after understanding the trade-off (below).
- **Rendering:** generated markdown is converted to **plain standalone HTML**
  pages — minimal shared stylesheet, **no** imqueue.com site chrome — living
  under `api/<pkg>/<version>/`, self-contained like the old TypeDoc folders.
- **TS 7 handling:** the extractor reads the **`.d.ts`** (stable, simple syntax),
  using a pinned `typescript@~5.8` purely to parse declarations. The TS 7
  *source* is never handed to a TypeDoc/older-TS parser, so the incompatibility
  is sidestepped.
- **Run model:** doc generation is a **local** `npm run build-docs` step (it needs
  the sibling source repos, which CI does not have). The generated output is
  **committed** into `api/<pkg>/3.2.1/`; the normal Eleventy deploy just serves
  it — identical to how today's `api/` folders are committed static assets.
- **Version:** auto-read from each sibling `package.json` (currently 3.2.1),
  as the old script did.
- **Scope:** `core` and `rpc` only (cli has no API docs, matching today).

### Trade-off acknowledged

API Extractor + Documenter produces plain markdown (headings + property/parameter
**tables**), NOT TypeDoc's sidebar+search+theme look. The generated 3.2.1 pages
will therefore look **different** from the existing 2.0.x TypeDoc dumps. The user
chose this route knowingly; matching TypeDoc's exact look would require a
hand-built theme and is explicitly out of scope.

## Pipeline

A rewritten generator (`api-docs.js`, keeping the `build-docs` npm script name)
runs the following for each package (`core`, `rpc`):

1. **Build sibling package:** `npm run build` in `../<pkg>` → fresh `.d.ts`.
2. **API Extractor:** run against `api-extractor.<pkg>.json` (in imqueue.com) →
   `.api.json` model into a temp/work dir.
   - Config: `mainEntryPointFilePath` = `<projectFolder>/index.d.ts`;
     `projectFolder` = the sibling repo; `docModel.enabled = true`
     (`apiJsonFilePath`); `dtsRollup.enabled = false`; `apiReport.enabled = false`.
   - Compiler input via an inline `overrideTsconfig` (target `ESNext`, module
     `nodenext`, `moduleResolution nodenext`, `skipLibCheck: true`) so extraction
     does NOT depend on the sibling's TS 7 tsconfig.
3. **API Documenter:** `generate --input-folder <api-json dir> --output-folder
   <markdown dir>` → a folder of markdown pages (one per API item + `index.md`).
4. **Render to standalone HTML:** using the repo's existing `markdown-it`,
   for each `.md`:
   - rewrite intra-doc links `href="./x.md"` (and `x.md#anchor`) → `x.html`,
   - render markdown (html enabled — Documenter emits tables and inline HTML),
   - wrap in a minimal standalone template (`<title>`, one `<link>` to
     `/api/assets/apidoc.css`, the content),
   - write to `api/<pkg>/<version>/<name>.html` (`index.md` → `index.html`).

## Files

- Modify: `api-docs.js` — rewritten generator implementing the pipeline.
- Modify: `package.json` — add devDeps `@microsoft/api-extractor`,
  `@microsoft/api-documenter`, `typescript@~5.8`; keep `build-docs` script.
- Create: `api-extractor.core.json`, `api-extractor.rpc.json` — extractor configs.
- Create: `api/assets/apidoc.css` — minimal stylesheet for the standalone pages
  (readable headings, code, and tables).
- Modify: `api/index.md` — add a short "Latest generated API (3.2.1)" section
  linking to `/api/core/3.2.1/` and `/api/rpc/3.2.1/` for discoverability.
- Generated (committed): `api/core/3.2.1/**`, `api/rpc/3.2.1/**`.

## Integration with Eleventy

No Eleventy config change needed: `api/**/*.html` is already passthrough-copied
and ignored from templating (from the migration work), and `api/assets/**` is
covered by the api passthrough globs. Generated pages are served verbatim and
stay out of `sitemap.xml` (not Eleventy collections) — consistent with the
existing versioned folders.

## Verification

1. `npm run build-docs` completes without error; creates `api/core/3.2.1/index.html`
   plus member pages, and `api/rpc/3.2.1/index.html` plus member pages.
2. Open a generated page directly: it renders standalone (title, css applied,
   tables readable) with no imqueue.com header/footer.
3. Inter-page links: every `href="*.html"` in the generated pages resolves to a
   real file in the same version folder (no `.md` links remain; no dangling links).
4. `npx @11ty/eleventy` still builds cleanly and copies the new `api/*/3.2.1/`
   pages into `_site` verbatim; `/api/` landing shows the new 3.2.1 links.

## Risks

- **API Extractor + TS 7 `.d.ts`:** the extractor may warn about an untested
  TypeScript version or choke on a TS-7-only declaration construct. Mitigation:
  pin `typescript@~5.8` for the extractor and use `overrideTsconfig`; if a
  specific declaration fails to parse, address it narrowly during implementation.
- **Subpath exports:** core exposes a `./debug` subpath export; API Extractor
  documents a single main entry point. `./debug` will be omitted (as it likely
  was under TypeDoc too). Acceptable; note it. If needed later, a second
  extraction for the subpath can be added.
- **Documenter markdown link shape:** links/anchors must be rewritten reliably;
  the render step is the single place responsible for `.md` → `.html`.

## Out of scope

- Reproducing TypeDoc's exact look/sidebar/search.
- Regenerating older versions (2.0.x remain as-is).
- Running doc generation in CI.
- Documenting `@imqueue/cli` or other packages.
