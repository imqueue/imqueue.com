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
npm test            # check:redirects + check:links
```

- **`check:redirects`** guards the Cloudflare rule budget and replays every
  historical `/api/` URL through `lib/api-redirects.js`. Cloudflare Pages silently
  drops `_redirects` rules past the **100th dynamic rule**, so the `/api/` version
  mapping deliberately does *not* live there — see below.
- **`check:links`** builds both editions and validates internal links.

## Deployment

Two **Cloudflare Pages** projects build from `master`, one per edition, differing
only in the `EDITION` env var and output directory. There is no deploy workflow in
this repo; Pages builds on push.

Per-edition `_redirects` and `_headers` are generated into each build
(`src/<edition>/_redirects`, `src/headers.liquid`).

### Pages Functions

`functions/` is shared by both Pages projects:

- `functions/api/contact.js` — the commercial lead form (imqueue.com `/pricing/`).
- `functions/api/{core,rpc}/[[path]].js` — resolves retired API version URLs onto
  the version trees that are actually published, using `lib/api-redirects.js`.
  Mounted per package rather than as one `/api/[[path]]` catch-all so it cannot
  shadow the contact endpoint. On imqueue.com it 301s `/api/` traffic to
  imqueue.org, because Functions run ahead of `_redirects`.

## Generated content

```bash
npm run build-docs                  # regenerate the API reference from npm
npm run gen-og / gen-og-blog        # social cards
npm run gen-favicons
npm run sync-cli-guide              # pull the CLI manual from the cli wiki
```

`npm run build-docs` publishes, per package, `/api/<pkg>/latest/` for the current
major plus one archived copy of each past major, and writes
`src/_data/apiVersions.json`, `lib/api-versions.js` and `lib/api-crosslinks.js`.
It reads the **published npm packages**, so it needs network access and can be run
from anywhere. Re-run it after every release.
