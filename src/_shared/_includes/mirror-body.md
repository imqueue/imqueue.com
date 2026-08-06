{%- comment -%}
The body of a generated markdown mirror, shared by both permalinks:
src/md-mirror.liquid (<page>/index.md) and src/md-mirror-flat.liquid (<page>.md).
Expects `doc` — the page being mirrored.
{%- endcomment -%}
{%- assign body = doc.rawInput | replace: "[[toc]]", "" | agentMarkdown -%}
{%- comment -%}
`heading` first, for the same reason docs.html renders it: where a page's H1 differs
from its search-engine `title`, the mirror has to say what the HTML twin says. Two
artefacts of one page that name it differently is a contradiction a machine can see.
{%- endcomment -%}
# {{ doc.data.heading | default: doc.data.title | default: doc.url }}

Source: {{ siteUrl }}{{ doc.url }}
{%- include "mirror-meta.md", doc: doc %}
{% if doc.data.lead %}
{{ doc.data.lead }}
{% endif %}
{{ body | strip }}
