{%- comment -%}
The provenance block for a markdown mirror: when the page was published, when it
last changed, and who wrote it.

Included by src/md-mirror.liquid and src/llms-full.liquid with `doc:` set to the
page being mirrored. It is the ONE implementation of the date-precedence chain
outside the sitemap, and it deliberately matches
src/_shared/_includes/sitemap-urls.html step for step — a mirror that dates a page
differently from the sitemap is worse than one that carries no date, because both
are machine-readable and only one can be right.

Why an agent needs this at all: the HTML page states its dates in JSON-LD
(datePublished/dateModified) and names its author as a Person node. The mirror —
the artefact this site actually asks agents to read, and the one the MCP server
fetches — carried neither, so anything reading the markdown could not tell a page
revised last week from one last touched in 2018, and had no author to attribute a
claim to. Freshness and authorship are two of the few signals an answer engine has
for whether to trust a technical assertion, and we were stripping both out of the
copy we recommend.

The precedence, and why each step exists:

  apiReleased    npm's publish time for a version tree. A generated API page has no
                 editorial date, and its file mtime is the build — which is how all
                 350 API URLs once shared one lastmod.
  post date      blog posts carry real `date:` front matter, and are the only pages
                 for which Eleventy's `date` is trustworthy. `dateModified` wins
                 when a post has been genuinely revised.
  pageDates      git history, committed. For every hand-authored page this is the
                 only true value: `page.date` falls back to the file mtime, and
                 Cloudflare Pages builds from a fresh clone, so it reads as the
                 deploy moment and moves forward on every deploy.

Absent all three, nothing is emitted. No date beats a wrong one — the same rule
head.html follows.
{%- endcomment -%}
{%- assign pdKey = doc.inputPath | remove_first: "./" -%}
{%- assign pd = pageDates[pdKey] -%}
{%- assign isPost = false -%}
{%- if doc.inputPath contains "/blog/posts/" -%}{%- assign isPost = true -%}{%- endif -%}
{%- assign pub = "" -%}
{%- assign mod = "" -%}
{%- if doc.data.apiReleased -%}
{%- assign pub = doc.data.apiReleased -%}
{%- assign mod = doc.data.apiReleased -%}
{%- elsif isPost -%}
{%- assign pub = doc.data.date -%}
{%- assign mod = doc.data.dateModified | default: doc.data.date -%}
{%- elsif pd -%}
{%- assign pub = doc.data.datePublished | default: pd.published -%}
{%- assign mod = doc.data.dateModified | default: pd.modified | default: pd.published -%}
{%- endif -%}
{%- assign person = authors | authorBySlug: doc.data.author -%}
{%- if pub != "" %}
Published: {{ pub | date: "%Y-%m-%d" }}
{%- endif -%}
{%- if mod != "" and mod != pub %}
Updated: {{ mod | date: "%Y-%m-%d" }}
{%- endif -%}
{%- comment -%}
A named Person for a post, the organisation for everything else — which is exactly
what the JSON-LD on the HTML twin says (post.html emits Person, head.html emits
`author: {@id: #org}`), so the two cannot contradict each other.
{%- endcomment -%}
{%- if person %}
Author: {{ person.name }}{% if person.occupation %} — {{ person.occupation }}{% endif %}{% if person.github %} ({{ person.github }}){% endif %}
{%- else %}
Author: @imqueue maintainers (https://github.com/imqueue)
{%- endif -%}
{%- if doc.data.apiPkg %}
Package: @imqueue/{{ doc.data.apiPkg }}{% if doc.data.apiVersion %} {{ doc.data.apiVersion }}{% endif %} — generated reference, not hand-written
{%- endif -%}
{%- if doc.data.license %}
License: {{ doc.data.license }}
{%- endif -%}
