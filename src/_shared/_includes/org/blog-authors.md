{%- comment -%}
Mirrors src/org/blog/authors.html — same `authors` data, same byAuthor filter, so
adding a maintainer to src/_data/authors.yml gets a mirror for free.
{%- endcomment -%}
{%- assign myPosts = collections.posts | byAuthor: author.slug -%}
# {{ author.name }} — Node.js microservices posts

Source: {{ siteUrl }}/blog/authors/{{ author.slug }}/

{{ author.name }} — {{ author.occupation }}.
{% if author.bio %}
{{ author.bio | strip_newlines }}
{% endif %}
{%- if author.github %}
GitHub: {{ author.github }}
{%- endif %}

## Articles

{{ myPosts.size }} article{% unless myPosts.size == 1 %}s{% endunless %}, newest first.

{% for post in myPosts -%}
- [{{ post.data.title }}]({{ siteUrl }}{{ post.url }}) — {{ post.date | date: "%Y-%m-%d" }}{% if post.data.summary %}: {{ post.data.summary | strip_newlines }}{% endif %} — [markdown]({{ siteUrl }}{{ post.url }}index.md)
{% endfor %}
All articles: [{{ siteUrl }}/blog/]({{ siteUrl }}/blog/) — [markdown]({{ siteUrl }}/blog/index.md)
