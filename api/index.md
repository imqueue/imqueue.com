---
layout: docs
title: "API Documentation"
section_id: docs
icon: book-open
---

{% assign latest_core = "1.3.13" %}
{% assign latest_rpc = "1.2.10" %}

<div class="special-title centered-text">
    <p markdown="1">
        Application programming interfaces documentation for @imqueue packages
    </p>
    <p class="shortline"></p>
    <div class="spacing"></div>
    <div class="spacing"></div>
</div>

<div class="medium-4 columns right panel radius toc" markdown="1">
<h4>Table Of Contents</h4>
{:#toc}
* TOC
{:toc}
</div>

{% include api/intro.md %}
{% include api/rpc.md %}
{% include api/mq.md %}
{% include api/misc.md %}

## Generated API Docs

### Latest Version

- <a href="/api/rpc/{{ latest_rpc }}/" target="_blank">@imqueue/rpc</a>
- <a href="/api/core/{{ latest_core }}/" target="_blank">@imqueue/core</a>

### Older Versions

- **@imqueue/rpc**
  * <a href="/api/rpc/1.2.9/" target="_blank">v1.2.9</a>
  * <a href="/api/rpc/1.2.8/" target="_blank">v1.2.8</a>
- **@imqueue/core**
  * <a href="/api/core/1.3.12/" target="_blank">v1.3.12</a>
  * <a href="/api/core/1.3.11/" target="_blank">v1.3.11</a>
