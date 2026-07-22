---
layout: docs.html
section: api
title: API Reference
docLabel: API REFERENCE
lead: "Application programming interface documentation for the @imqueue packages — core, rpc and cli. Packaging follows nesting, so importing @imqueue/rpc re-exports everything from @imqueue/core."
description: "API reference for @imqueue — core, rpc and cli packages: RPC API, decorators, doc-blocks, the Messaging API and adapters, plus generated per-version reference docs."
keywords: "@imqueue API reference, imqueue core, imqueue rpc, imqueue cli, RPC decorators, TypeScript RPC API, message queue API, IMQService, IMQClient, @expose decorator"
relatedTopics: [rpc, queue, types, delivery]
---
{% assign latest_core = apiVersions.core.latest %}
{% assign latest_rpc = apiVersions.rpc.latest %}

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

{% include "api/intro.md" %}
{% include "api/rpc.md" %}
{% include "api/mq.md" %}
{% include "api/misc.md" %}
{% include "api/migration.md" %}
