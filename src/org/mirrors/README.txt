Markdown mirrors for HTML-templated pages
=========================================

src/md-mirror.liquid emits <page-url>index.md for every page in the `contentMd`
collection, and that collection requires inputPath.endsWith(".md") — it renders
`doc.rawInput` through the agentMarkdown filter, so a page with no markdown
source has nothing to mirror.

That left 19 pages with no mirror, against three places that tell agents otherwise:

  * src/org/agents/index.md — "every page has a plain-markdown mirror at
    `<page-url>index.md`". A universal claim, on a page written for machines.
  * src/org/using-ai-assistants.md — "Markdown mirror of ANY docs page — append
    `index.md` to a page URL".
  * the @imqueue MCP server's `get_doc`, which fetches `<page-url>index.md` for
    whatever page URL it is handed — so an agent asking it for the docs home or
    the blog got a 404 rather than the page.

(/llms.txt states the convention too, but scoped to its Reference and article
sections, so it was not the one being broken.)

The pages that lacked mirrors were exactly the ones an agent tries first: the home
page, /docs/, /intro/, /blog/, 12 topic hubs and 3 author pages. Measured
2026-08-01 by requesting every sitemap URL's index.md as GPTBot: 19 of 498
returned 404. Self-inflicted — agents following a documented convention — and a
share of the AI-crawler errors Cloudflare was reporting.

The templates here close it. Two kinds:

  * GENERATED (blog-index, blog-topics, blog-authors) paginate the same
    collections their HTML counterparts do, so they cannot drift. Compare each
    with its sibling in ../blog/.

  * AUTHORED (home, docs, intro). Hero markup, card grids and an inline SVG
    architecture diagram do not convert into useful markdown, and a
    transcription of a landing page is not what an agent wants from one anyway.
    These are concise equivalents: same claims, same links, no layout. They are
    the ONE place in the mirror system that can drift from its page — when you
    rewrite copy on those three pages, update the mirror here.

check-sitemap.js asserts the coverage, so a new HTML-templated page fails the
build rather than silently reintroducing the hole.

Links here are absolute, unlike the .md-sourced mirrors which inherit whatever
their source used. These are navigation pages whose whole job is to send an agent
somewhere else, and /llms.txt — the entry point that leads here — sets that
precedent.

This file is .txt on purpose. As README.md it would be an Eleventy template, and
`permalink: false` does not save it: org.11tydata.ts computes a permalink whenever
`data.permalink` is falsy, so it would publish itself at /mirrors/README/.
