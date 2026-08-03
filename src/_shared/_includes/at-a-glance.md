{%- comment -%}
The "@imqueue at a glance" table, markdown rendering. Rows come from
src/_data/atAGlance.js; the HTML twin is _includes/at-a-glance.html. One list, so the
page and its mirror cannot disagree about the facts people ask for first.
{%- endcomment -%}
| | |
|---|---|
{%- for row in atAGlance %}
| {{ row.label }} | {{ row.value }} |
{%- endfor %}
