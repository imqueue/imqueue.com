# imqueue.org / imqueue.com

The @imqueue websites. One Eleventy project builds **two editions** from the same
source tree:

| Edition | Domain | Skin | Output | What it is |
|---|---|---|---|---|
| `org` (default) | [imqueue.org](https://imqueue.org/) | Terminal | `_site-org/` | Open-source docs, tutorial, CLI & MCP manuals, generated API reference, blog |
| `com` | [imqueue.com](https://imqueue.com/) | Flux | `_site-com/` | Commercial licensing, pricing, support |

`EDITION` picks one. Shared templates live in `src/_shared/`; each edition's own
pages live in `src/org/` and `src/com/`, and Eleventy ignores the other one.

## Local development

```bash
npm install
npm run serve:org   # imqueue.org — http://localhost:8080
npm run serve:com   # imqueue.com — http://localhost:8081
```

## Build

```bash
npm run build:all   # both editions -> _site-org/ and _site-com/
npm run build:org   # or just one
```

## Checks

```bash
npm test            # check:redirects + check:dates + check:links + check:sitemap
```

- **`check:redirects`** guards the Cloudflare rule budget and replays every
  historical `/api/` URL through `lib/api-redirects.js`. Cloudflare Pages silently
  drops `_redirects` rules past the **100th dynamic rule**, so the `/api/` version
  mapping deliberately does *not* live there — see below. Note it exercises
  `lib/api-redirects.js` under plain node and knows nothing about `functions/`, so
  it cannot catch a Pages **routing** regression — only a policy one.
- **`check:dates`** asserts `src/_data/pageDates.json` covers every hand-authored
  page and that no publication date has drifted. Run it explicitly after adding
  pages: at pre-commit the new files are staged but uncommitted, so they look
  untracked and the hook passes regardless.
- **`check:links`** builds both editions and validates internal links.
- **`check:sitemap`** validates the sitemap index and its children.

## Deployment

Two **Cloudflare Pages** projects build from `master`, one per edition, differing
only in the `EDITION` env var and output directory. There is no deploy workflow in
this repo; Pages builds on push.

Per-edition `_redirects` and `_headers` are generated into each build
(`src/<edition>/_redirects`, `src/headers.liquid`).

### Pages Functions

`functions/` is shared by both Pages projects:

- `functions/_middleware.js` — 301s `imqueue.net` and `www.imqueue.net` onto
  imqueue.org. Both are custom domains on the imqueue-org project, so without this
  they serve the docs site on a second hostname rather than pointing at it. Because
  this directory is shared, a root middleware runs in front of **every** request to
  both sites, so it is written to fail open: any internal error falls through to
  `next()`, degrading to "no redirect" rather than "site down". A Cloudflare Redirect
  Rule is the better mechanism and should replace it — see the header comment.
- `functions/api/contact.js` — the commercial lead form (imqueue.com `/pricing/`).
- `functions/api/<pkg>/[[path]].js` — **generated**, one per documented package
  (see `scripts/lib/api-packages.js`); resolves retired API version URLs onto the
  version trees that are actually published, using `lib/api-redirects.js`. Mounted
  per package rather than as one `/api/[[path]]` catch-all so it cannot shadow the
  contact endpoint: `[[path]]` is an *optional* catch-all and does match a bare
  segment, so a dynamic segment directly under `/api/` would sit on top of
  `/api/contact`. On imqueue.com it 301s `/api/` traffic to imqueue.org, because
  Functions run ahead of `_redirects`.

## Generated content

```bash
npm run build-docs                  # regenerate the API reference from npm
npm run gen-og / gen-og-blog        # social cards
npm run gen-favicons
npm run sync-cli-guide              # pull the CLI manual from the cli wiki
```

`npm run build-docs` publishes `/api/<pkg>/latest/` for each package's current
major, plus one archived copy of each past major **for `core` and `rpc` only** —
every other package is `latestOnly` and publishes `/latest/` and nothing else. It
also writes `src/_data/apiVersions.json`, `lib/api-versions.js`,
`lib/api-crosslinks.js` and the per-package Functions under `functions/api/`.

Which packages are documented, their group, tags and blurb all live in
**`scripts/lib/api-packages.js`** — the one place to edit. A package with
`status: 'planned'` is in the taxonomy but is not generated and is not linked from
`/api/`; flipping it to `'shipped'` and re-running is what lands a rollout wave.

It reads the **published npm packages**, so it needs network access and can be run
from anywhere. Re-run it after every release. Two guards run as part of it: a
page-name collision assertion (api-documenter builds filenames from lowercased
symbol names and silently overwrites on a clash) and a `prose%` report per package
against a floor — warn-only unless `--strict-prose`.
