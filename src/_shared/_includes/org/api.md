{%- comment -%}
Authored mirror of /api/. See README.txt: the generic md-mirror.liquid renders
`rawInput`, and src/org/api/index.md's rawInput is a JSON-LD block, two card
grids, a 120-line state-persistence <script> and five `{% include %}`s — the
guide an agent came for is in the includes, and the template source is not
markdown at all. eleventy.config.js therefore keeps /api/ out of `contentMd`
and this file mirrors the page instead.

The package list is generated from src/_data/apiPackages.js, the same source the
HTML page and /llms.txt use, so it cannot list a package the build did not
generate. The guide sections are the same five includes both of those render.
{%- endcomment -%}
# API Reference

Source: {{ siteUrl }}/api/

Application programming interface documentation for the @imqueue packages.
Packaging follows nesting, so importing @imqueue/rpc re-exports everything from
@imqueue/core.

For task-shaped questions rather than symbol lookups, start at the
[FAQ]({{ siteUrl }}/api/faq/) — nineteen answered questions, each linking the
generated pages for the symbols it names, and each addressable on its own at
`{{ siteUrl }}/api/faq/#<question-slug>`.
[markdown]({{ siteUrl }}/api/faq/index.md)

Every page below, and every per-symbol page under it, is also published as plain
markdown at `<page-url>index.md` and at `<page>.md`, byte-identical — same content,
no HTML. To look a symbol up by
name, fetch {{ siteUrl }}/api/search-index.json: every exported symbol of the
current majors as `{name, kind, package, url, summary}`, with `deprecated: true`
on obsolete members.

## Generated reference — framework spine

- [@imqueue/rpc {{ apiVersions.rpc.latest }}]({{ siteUrl }}/api/rpc/latest/) —
  services, clients and decorators (`@expose`, `@remote`, `@lock`, `@cache`) and
  the RPC runtime. [markdown]({{ siteUrl }}/api/rpc/latest/index.md)
- [@imqueue/core {{ apiVersions.core.latest }}]({{ siteUrl }}/api/core/latest/) —
  the JSON messaging-queue engine, the IMQ factory and the pluggable adapter
  interface. [markdown]({{ siteUrl }}/api/core/latest/index.md)

These `/latest/` URLs always serve the current major, so a link keeps working
across releases. Archived majors are HTML-only and are not mirrored:
{% for v in apiVersions.rpc.archives %}@imqueue/rpc {{ v }} at {{ siteUrl }}/api/rpc/{{ v }}/{% unless forloop.last %}, {% endunless %}{% endfor %}{% if apiVersions.core.archives.size > 0 %}, {% for v in apiVersions.core.archives %}@imqueue/core {{ v }} at {{ siteUrl }}/api/core/{{ v }}/{% unless forloop.last %}, {% endunless %}{% endfor %}{% endif %}.
{%- for group in apiPackages.groups %}

## Generated reference — {{ group.group }}
{%- for pkg in group.packages %}
- [{{ pkg.scoped }}{% if apiVersions[pkg.name].latest %} {{ apiVersions[pkg.name].latest }}{% endif %}]({{ siteUrl }}{{ pkg.url }}) — {{ pkg.blurb }}{% if pkg.note %} {{ pkg.note }}{% endif %}{% if pkg.tags.size > 0 %} Tagged {% for tag in pkg.tags %}`{{ tag.label }}`{% unless forloop.last %}, {% endunless %}{% endfor %}{% for tag in pkg.tags %}{% if tag.exclusive %} (pick at most one package with this tag){% endif %}{% endfor %}.{% endif %} [markdown]({{ siteUrl }}{{ pkg.url }}index.md)
{%- endfor %}
{%- endfor %}

{%- comment -%}
Captured and piped through agentMarkdown, not included directly. These partials are
authored for the HTML page, so they carry root-relative links (`](/api/rpc/latest/…)`)
and markdown-it-attrs ids — 33 relative hrefs reached this mirror, and a mirror is
fetched standalone, where `/api/...` resolves against nothing.
{%- endcomment -%}
{%- capture apiGuide -%}
{% include "api/intro.md" %}

{% include "api/rpc.md" %}

{% include "api/mq.md" %}

{% include "api/misc.md" %}

{% include "api/migration.md" %}
{%- endcapture -%}
{{ apiGuide | agentMarkdown }}
