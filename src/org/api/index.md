---
layout: docs.html
section: api
title: API Reference
docLabel: API REFERENCE
lead: "Application programming interface documentation for the @imqueue packages. Packaging follows nesting, so importing @imqueue/rpc re-exports everything from @imqueue/core."
description: "API reference for @imqueue: the RPC API, decorators, doc-blocks, the Messaging API and adapters, plus the generated per-package reference."
keywords: "@imqueue API reference, imqueue core, imqueue rpc, RPC decorators, TypeScript RPC API, message queue API, IMQService, IMQClient, @expose decorator"
relatedTopics: [rpc, queue, types, delivery]
---
{% assign latest_core = apiVersions.core.latest %}
{% assign latest_rpc = apiVersions.rpc.latest %}

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "SoftwareSourceCode",
      "@id": "{{ siteUrl }}/api/#core",
      "name": "@imqueue/core",
      "description": "Core messaging-queue engine for @imqueue — the Redis-backed transport shared by the RPC and job packages.",
      "url": "{{ siteUrl }}/api/core/latest/",
      "codeRepository": "https://github.com/imqueue/core",
      "programmingLanguage": ["TypeScript", "JavaScript"],
      "runtimePlatform": "Node.js",
      "softwareVersion": "{{ latest_core }}",
      "license": "https://www.gnu.org/licenses/gpl-3.0.html",
      "author": { "@id": "{{ siteUrl }}/#org" }
    },
    {
      "@type": "SoftwareSourceCode",
      "@id": "{{ siteUrl }}/api/#rpc",
      "name": "@imqueue/rpc",
      "description": "Type-safe RPC over a message queue for @imqueue — decorators, clients and services on top of @imqueue/core.",
      "url": "{{ siteUrl }}/api/rpc/latest/",
      "codeRepository": "https://github.com/imqueue/rpc",
      "programmingLanguage": ["TypeScript", "JavaScript"],
      "runtimePlatform": "Node.js",
      "softwareVersion": "{{ latest_rpc }}",
      "license": "https://www.gnu.org/licenses/gpl-3.0.html",
      "author": { "@id": "{{ siteUrl }}/#org" }
    }{%- comment -%}
    One SoftwareSourceCode per SHIPPED Tier 2 package, generated from the same
    config that renders the group lists below — so the graph can never describe a
    package the page does not link, and a wave does not mean hand-writing a fifth
    entity. Each is a real published library with its own repository and releases,
    which is what makes it a defensible @graph member rather than dilution.

    The two spine entries above stay hand-written: their descriptions are richer
    than a one-line blurb, and the owner decision is that the spine block does not
    change. All @imqueue packages are GPL-3.0-only (verified across all 16).
    {%- endcomment -%}
    {%- for group in apiPackages.groups %}{%- for pkg in group.packages %},
    {
      "@type": "SoftwareSourceCode",
      "@id": "{{ siteUrl }}/api/#{{ pkg.name }}",
      "name": {{ pkg.scoped | json }},
      "description": {{ pkg.blurb | json }},
      "url": "{{ siteUrl }}{{ pkg.url }}",
      "codeRepository": {{ pkg.repo | json }},
      "programmingLanguage": ["TypeScript", "JavaScript"],
      "runtimePlatform": "Node.js",
      {%- comment -%}
      Omitted rather than emitted empty when apiVersions has no entry for the
      package — which happens if a `status` is flipped to shipped before
      `npm run build-docs` repopulates src/_data/apiVersions.json. An empty
      softwareVersion is a worse claim than no claim.
      {%- endcomment -%}
      {%- if apiVersions[pkg.name].latest %}
      "softwareVersion": "{{ apiVersions[pkg.name].latest }}",
      {%- endif %}
      "license": "https://www.gnu.org/licenses/gpl-3.0.html",
      "author": { "@id": "{{ siteUrl }}/#org" }
    }{%- endfor %}{%- endfor %}
  ]
}
</script>

[[toc]]

## Full API Reference

Browse the complete generated reference for the latest release — every class, interface, decorator and function, with signatures and types. These pages always live at `/latest/`, so a bookmark or link keeps working across releases.

<div class="api-ref-cards">
  <a href="/api/rpc/latest/" class="api-ref-card">
    <span class="api-ref-top"><span class="api-ref-name">@imqueue/rpc</span><span class="api-ref-ver">v{{ latest_rpc }}</span></span>
    <span class="api-ref-desc">Services, clients and decorators — <code>@expose</code>, <code>@remote</code>, <code>@lock</code>, <code>@cache</code> — and the RPC runtime.</span>
    <span class="api-ref-cta">Browse reference →</span>
  </a>
  <a href="/api/core/latest/" class="api-ref-card">
    <span class="api-ref-top"><span class="api-ref-name">@imqueue/core</span><span class="api-ref-ver">v{{ latest_core }}</span></span>
    <span class="api-ref-desc">The JSON messaging-queue engine, the IMQ factory, and the pluggable adapter interface.</span>
    <span class="api-ref-cta">Browse reference →</span>
  </a>
</div>

<details class="api-older">
  <summary>Older versions</summary>
  <div class="api-older-body">
    <div><span class="api-older-pkg">@imqueue/rpc</span> {% for v in apiVersions.rpc.archives %}<a href="/api/rpc/{{ v }}/">{{ v }}</a> {% endfor %}</div>
    <div><span class="api-older-pkg">@imqueue/core</span> {% for v in apiVersions.core.archives %}<a href="/api/core/{{ v }}/">{{ v }}</a> {% endfor %}</div>
  </div>
</details>

<!-- Tier 2 — the capability libraries you add to a service, one section per group.
     Generated from src/_data/apiPackages.js (which reads scripts/lib/api-packages.js),
     so a wave ships by flipping one `status` in the config rather than editing markup
     here — that is what keeps this page and the generator from drifting.

     EXACTLY TWO LEVELS: group heading, then a flat list of packages. Sub-group
     distinctions are chips on the package entry, never a third heading level.

     Only `shipped` packages appear. A `planned` package has no pages yet, so
     listing it would ship a 404 and fail check:links. There are no archived
     versions to list for any of these: Tier 2 is `latest` only. -->
{%- for group in apiPackages.groups %}

### {{ group.group }}

<ul class="api-pkg-list">
{%- for pkg in group.packages %}
<li class="api-pkg"><a class="api-pkg-link" href="{{ pkg.url }}"><span class="api-pkg-name">{{ pkg.scoped | escape }}</span>{% if pkg.tags.size > 0 %} <span class="api-pkg-tags">{% for tag in pkg.tags %}<span class="topic-chip topic-chip--flat"{% if tag.exclusive %} title="Exclusive — pick at most one package carrying this tag"{% endif %}>{{ tag.label | escape }}{% if tag.exclusive %} <span>one of</span>{% endif %}</span>{% endfor %}</span>{% endif %}{% if apiVersions[pkg.name].latest %}<span class="api-ref-ver api-pkg-ver">v{{ apiVersions[pkg.name].latest }}</span>{% endif %}<span class="api-pkg-blurb">{{ pkg.blurb | escape }}</span></a></li>
{%- endfor %}
</ul>
{%- endfor %}

{% include "api/intro.md" %}
{% include "api/rpc.md" %}
{% include "api/mq.md" %}
{% include "api/misc.md" %}
{% include "api/migration.md" %}
