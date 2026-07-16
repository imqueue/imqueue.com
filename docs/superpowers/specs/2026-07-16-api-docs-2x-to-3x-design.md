# Design: Document 2.x → 3.x API changes + migration section

**Date:** 2026-07-16
**Branch:** `chore/eleventy-migration` (continued)
**Status:** Approved

## Goal

Update the hand-written API docs (`_includes/api/*.md`, rendered on `/api/`) to
reflect the `@imqueue/core` and `@imqueue/rpc` 2.x → 3.x changes, and add a
"Migration from 2.x to 3.x" section.

## Analysis (verified in ../core and ../rpc git history)

- **Removed re-exported helpers** from `@imqueue/core` public API (present in
  `v2.0.26`, absent in `3.2.1`; propagate to `@imqueue/rpc` via `export *`):
  `uuid`, `promisify`, `buildOptions`, `copyEventEmitter`.
  - `uuid()` was a custom UUID-v4 generator → replace with `crypto.randomUUID()`.
  - `promisify` re-exported Node's util.promisify → use `node:util`.
  - `buildOptions`, `copyEventEmitter` were internal helpers → removed, inline if needed.
- **New `@classType()` decorator** (`rpc/src/decorators/classType.ts`), exported
  from `@imqueue/rpc`. Applied at class level on complex/DTO types that use
  `@property()`. It registers the collected property metadata as a named type.
- **Root cause / broader shift:** 3.x moved from legacy decorators
  (`experimentalDecorators`+`emitDecoratorMetadata`, CommonJS, `target es2017`)
  to **standard TC39 decorators** (`lib: ["esnext.decorators"]`, `target es2024`),
  **ESM** (`"type": "module"`, `nodenext`, `.js` import specifiers), and
  **Node ≥ 22.12**, built with **TypeScript 7**. Under standard decorators,
  `@property()` only collects into `context.metadata`, so a class-level
  `@classType()` is now REQUIRED to register a complex type.

## Changes

1. **`_includes/api/intro.md`** — the equivalence example imports
   `{ IMQ, uuid, profile }`; `uuid` is removed. Change to `{ IMQ, profile }`
   (both still exported by core and re-exported by rpc) and fix the following
   sentence that names `uuid`.

2. **`_includes/api/rpc.md`** ("Complex Types") — every complex-type class
   example (`UserObject`, `AddressObject`, nested variants) gains a class-level
   `@classType()` and its import (`import { classType, property } from '@imqueue/rpc'`),
   plus a short paragraph stating `@classType()` is required in 3.x for complex
   types (why: standard decorators). Generated-client interface examples are
   unchanged (client side is unaffected).

3. **New `_includes/api/migration.md`** — a `## Migration from 2.x to 3.x`
   section, included into `api/index.md` after the `misc` include (so it appears
   in the page's `[[toc]]`). Content:
   - **ESM & Node:** packages are ESM now; add `.js` to relative imports, drop
     `require()`; Node ≥ 22.12.
   - **Standard decorators / TS 7:** remove `experimentalDecorators` +
     `emitDecoratorMetadata`; add `"lib": ["esnext.decorators"]` (target es2024+).
   - **`@classType()` required on complex types:** before/after example.
   - **Removed re-exported helpers:** table of `uuid`/`promisify`/`buildOptions`/
     `copyEventEmitter` with replacements.

4. **`api/index.md`** — add `{% include api/migration.md %}` after
   `{% include api/misc.md %}`.

## Verification

- `npx @11ty/eleventy` builds cleanly; `_site/api/index.html` contains the new
  "Migration from 2.x to 3.x" heading and it appears in the page TOC.
- No occurrence of the removed helper `uuid` remains in the intro example; the
  rpc complex-type examples show `@classType()`; migration table lists the four
  removed helpers with replacements.
- Markdown renders correctly (code fences, table) with the site's markdown-it
  (blank-line rules; no `markdown="1"`).

## Out of scope

- Regenerating the TypeDoc-style generated docs (those are separate, done).
- Changing rpc/core source; this is documentation only.
