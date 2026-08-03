{%- comment -%}
The body of a generated markdown mirror, shared by both permalinks:
src/md-mirror.liquid (<page>/index.md) and src/md-mirror-flat.liquid (<page>.md).
Expects `doc` — the page being mirrored.
{%- endcomment -%}
{%- assign body = doc.rawInput | replace: "[[toc]]", "" | agentMarkdown -%}
# {{ doc.data.title | default: doc.url }}

Source: {{ siteUrl }}{{ doc.url }}
{%- include "mirror-meta.md", doc: doc %}
{% if doc.data.lead %}
{{ doc.data.lead }}
{% endif %}
{{ body | strip }}
