Markdown mirrors for imqueue.com
================================

Same idea and same rules as src/org/mirrors/ — read its README.txt first; only
the reasons this directory exists at all are new.

imqueue.com had NO markdown mirrors. `find _site-com -name '*.md'` returned
terms/index.md and privacy/index.md, both accidental: those two pages have a
markdown source, so the generic src/md-mirror.liquid picked them up via the
`contentMd` collection. Every page that matters commercially — /, /pricing/,
/license/, /support/, /contact/ — is an HTML/Liquid template and 404'd on
index.md. And /llms-full.txt was a 458-byte stub that concatenated nothing.

That mattered more here than the equivalent gap did on .org, for one reason:
imqueue.com is the OLDER domain. It has Wayback snapshots back to 2018 where
imqueue.org has none, and a `site:imqueue.org` query still surfaces imqueue.com
URLs. So it is the address an engine already holds and the one a model resolving
"imqueue" fetches first — and what it found there was a marketing page with an
Organization node, no software entity, and no agent-readable form of the four
questions this domain exists to answer:

  * when does the GPL-3.0 obligation actually apply to me?
  * do I need a licence for internal tools? for SaaS?
  * what does a commercial licence include?
  * is the code different from the open-source version?

Those are answered in HTML, and in FAQPage JSON-LD on three of the pages, but a
model reading markdown had nothing. An LLM asked "can I use @imqueue in a
commercial product?" reads the npm licence field, sees GPL-3.0-only, and answers
"not without open-sourcing your product" — which is wrong, and is generated from
our own metadata. These files are the flat, quotable form of the correct answer.

ALL FIVE ARE AUTHORED, not transcriptions. Hero copy, card grids, an enquiry form
and a stats band do not convert into useful markdown, and a transcription of a
landing page is not what an agent wants from one. They are concise equivalents:
same claims, same links, no layout — which means they CAN drift from their pages.
When you rewrite copy on those five pages, update the matching file here.

One structural difference from src/org/mirrors/: the body of each mirror lives in
src/_shared/_includes/com/<name>.md, and the .liquid file here is a two-line
wrapper that sets the permalink and includes it. That is because the com branch of
src/llms-full.liquid concatenates the same five bodies, and /api/ already
established the pattern (its guide sections are includes shared by the HTML page,
the mirror and llms-full.txt). One source, three consumers, no drift.

check-sitemap.js asserts mirror coverage for this edition too now — its
`edition === 'org'` exemption is gone, along with the comment claiming ".com's
four pages have none" (there are eight, and two had them by accident).
