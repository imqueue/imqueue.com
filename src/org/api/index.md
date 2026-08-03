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
      "downloadUrl": "https://www.npmjs.com/package/@imqueue/core",
      "identifier": "pkg:npm/%40imqueue/core@{{ latest_core }}",
      "programmingLanguage": ["TypeScript", "JavaScript"],
      "runtimePlatform": "Node.js",
      "softwareVersion": "{{ latest_core }}",
      "license": "https://www.gnu.org/licenses/gpl-3.0.html",
      "usageInfo": "https://imqueue.com/license/",
      "isPartOf": { "@id": "{{ siteUrl }}/#software" },
      "author": { "@id": "{{ siteUrl }}/#org" }
    },
    {
      "@type": "SoftwareSourceCode",
      "@id": "{{ siteUrl }}/api/#rpc",
      "name": "@imqueue/rpc",
      "description": "Type-safe RPC over a message queue for @imqueue — decorators, clients and services on top of @imqueue/core.",
      "url": "{{ siteUrl }}/api/rpc/latest/",
      "codeRepository": "https://github.com/imqueue/rpc",
      "downloadUrl": "https://www.npmjs.com/package/@imqueue/rpc",
      "identifier": "pkg:npm/%40imqueue/rpc@{{ latest_rpc }}",
      "programmingLanguage": ["TypeScript", "JavaScript"],
      "runtimePlatform": "Node.js",
      "softwareVersion": "{{ latest_rpc }}",
      "license": "https://www.gnu.org/licenses/gpl-3.0.html",
      "usageInfo": "https://imqueue.com/license/",
      "isPartOf": { "@id": "{{ siteUrl }}/#software" },
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
      {%- comment -%}
      npm and a package-url, for all 16. An ld+json scan over both builds used to
      yield exactly two npm URLs — the /imqueue org page and @imqueue/mcp's — so
      nothing tied a documented symbol to the artifact an agent had just installed.
      `downloadUrl` is the human-facing package page; `identifier` is the purl, which
      is the machine-readable half and the reason this is worth adding at all.

      Deliberately NOT adding Libraries.io or Snyk `sameAs` edges: `sameAs` asserts
      identity, not authority, so it transfers nothing, and security.snyk.io no longer
      serves a package-health grade to point at.
      {%- endcomment -%}
      "downloadUrl": "https://www.npmjs.com/package/{{ pkg.scoped }}",
      {%- if apiVersions[pkg.name].latest %}
      "identifier": "pkg:npm/%40imqueue/{{ pkg.name }}@{{ apiVersions[pkg.name].latest }}",
      {%- else %}
      "identifier": "pkg:npm/%40imqueue/{{ pkg.name }}",
      {%- endif %}
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
      "usageInfo": "https://imqueue.com/license/",
      "isPartOf": { "@id": "{{ siteUrl }}/#software" },
      "author": { "@id": "{{ siteUrl }}/#org" }
    }{%- endfor %}{%- endfor %}
  ]
}
</script>

[[toc]]

## Full API Reference

Browse the complete generated reference for the latest release — every class, interface, decorator and function, with signatures and types. These pages always live at `/latest/`, so a bookmark or link keeps working across releases.

Looking a symbol up by name rather than browsing? [`/api/search-index.json`](/api/search-index.json) lists every exported symbol of the current majors as `{name, kind, package, url, summary}`, with `deprecated: true` on obsolete members — one fetch instead of a crawl. `llms.txt` has advertised it for a while; this page had never mentioned it, which meant the mirror the MCP server's `get_doc` returns for `/api/` did not either.

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
     versions to list for any of these: Tier 2 is `latest` only.

     Each group is a <details>, open by default, and its state is remembered per
     visitor. Two details of the markup are load-bearing:

       * The `### heading` stays MARKDOWN, on its own line with blank lines around
         it. markdown-it ends an HTML block at a blank line, so the heading is still
         parsed as a heading and still reaches [[toc]] — which is generated from the
         markdown AST, not the DOM, so an HTML <h3> written by hand would silently
         vanish from the "On this page" sidebar.
       * The heading goes in the <summary>, not the body, so a collapsed group is
         still a visible anchor target when its sidebar link is clicked. -->
{%- for group in apiPackages.groups %}
<details class="api-pkg-group" open data-api-group="{{ group.id }}">
<summary>

### {{ group.group }}

</summary>

<ul class="api-pkg-list">
{%- for pkg in group.packages %}
<li class="api-pkg"><a class="api-pkg-link" href="{{ pkg.url }}"><span class="api-pkg-name">{{ pkg.scoped | escape }}</span>{% if pkg.tags.size > 0 %} <span class="api-pkg-tags">{% for tag in pkg.tags %}<span class="topic-chip topic-chip--flat"{% if tag.exclusive %} title="Exclusive — pick at most one package carrying this tag"{% endif %}>{{ tag.label | escape }}</span>{% endfor %}</span>{% endif %}{% if apiVersions[pkg.name].latest %}<span class="api-ref-ver api-pkg-ver">v{{ apiVersions[pkg.name].latest }}</span>{% endif %}<span class="api-pkg-blurb">{{ pkg.blurb | escape }}</span>{% if pkg.note %}<span class="api-pkg-note">{{ pkg.note | escape }}</span>{% endif %}</a></li>
{%- endfor %}
</ul>

</details>
{%- endfor %}

<!-- Collapsed-group state, inline and parser-blocking ON PURPOSE.
     It has to run after these <details> exist and before they paint. site.js is
     `defer`, so it runs only after the whole document is parsed — and this page is
     long enough that first paint happens well before that, which would flash every
     remembered-closed group open. head.html's no-FOUC theme script has the mirror
     problem: it runs early but the elements do not exist yet.
     Storing the CLOSED ids (not the open ones) is what makes a group added by a
     later wave default to open without touching stored state. -->
<script>
(function () {
  var KEY = 'imqueue-api-groups';
  var groups = [].slice.call(document.querySelectorAll('.api-pkg-group[data-api-group]'));
  var stored;

  try { stored = JSON.parse(localStorage.getItem(KEY)); } catch (e) { stored = null; }
  var shut = stored || [];

  groups.forEach(function (el) {
    if (shut.indexOf(el.getAttribute('data-api-group')) !== -1) {
      el.removeAttribute('open');
    }
  });

  // Derived from the DOM on every change rather than patched incrementally: that
  // cannot produce a duplicate or a stale id, and it does not care in which order
  // the events arrive — which matters, because they are not all user-driven.
  function state() {
    return JSON.stringify(groups.filter(function (el) { return !el.open; })
      .map(function (el) { return el.getAttribute('data-api-group'); }));
  }

  // `toggle` does not bubble, so listen in the capture phase — that still reaches a
  // non-bubbling event on the way down, and needs one listener rather than one per
  // group.
  //
  // Chrome fires `toggle` when a <details open> is INSERTED, not only when its state
  // changes, so simply loading this page queues one event per group before anyone has
  // clicked anything. Writing unconditionally therefore wrote to storage on every
  // visit, including a first visit — hence the two guards below: skip when the value
  // has not changed, and never create the key just to record "nothing is closed".
  document.addEventListener('toggle', function (e) {
    var el = e.target;

    if (!el.classList || !el.classList.contains('api-pkg-group')) { return; }

    try {
      var next = state();

      if (next === '[]' && localStorage.getItem(KEY) === null) { return; }
      if (next !== localStorage.getItem(KEY)) { localStorage.setItem(KEY, next); }
    } catch (e2) {}
  }, true);

  // ---- roll down / roll up ------------------------------------------------
  // <details> cannot be animated natively: the body is not rendered at all while
  // the element is closed, so there is no height to transition from or to. The
  // browser also flips the state the instant the summary is clicked, which leaves
  // nothing on screen to animate out.
  //
  // So the open flag is driven by hand. Opening sets it first and animates the
  // list up from zero; closing animates down and only then clears it, which is
  // what keeps the content visible for the length of the roll-up.
  var DURATION = 200;
  var reduced = window.matchMedia
    ? window.matchMedia('(prefers-reduced-motion: reduce)')
    : { matches: false };

  // Both disclosures on this page roll: the package groups and the "Older versions"
  // list above them. Each needs its body named, because the element that grows is the
  // one whose height is animated — a <details> has no single "content" child to find
  // generically.
  var ROLLS = [
    { group: '.api-pkg-group', body: '.api-pkg-list' },
    { group: '.api-older', body: '.api-older-body' },
  ];

  function roll(el, body) {
    var summary = el.querySelector('summary');

    if (!summary || !body || !body.animate) { return; }

    summary.addEventListener('click', function (e) {
      // Honour the OS setting by doing nothing and letting <details> behave
      // natively — the state still changes, just without the movement.
      if (reduced.matches) { return; }
      // Ignore a click that lands mid-roll rather than queueing or reversing it.
      if (el.hasAttribute('data-rolling')) { e.preventDefault(); return; }

      e.preventDefault();
      var opening = !el.open;

      // The value, not just the presence, so the marker can flip at the start of a
      // roll-up instead of waiting for `open` to clear at the end of it.
      el.setAttribute('data-rolling', opening ? 'open' : 'close');

      if (opening) { el.open = true; }

      // Measured while open, so the target is the real laid-out height rather than
      // a guess. Padding and margin ride along with it, or a body that has either
      // would leave its spacing behind at zero height.
      var box = getComputedStyle(body);
      var end = {
        height: body.scrollHeight + 'px',
        marginBottom: box.marginBottom,
        paddingTop: box.paddingTop,
        paddingBottom: box.paddingBottom,
        opacity: 1,
      };
      var start = { height: '0px', marginBottom: '0px', paddingTop: '0px', paddingBottom: '0px', opacity: 0 };
      var frames = opening ? [start, end] : [end, start];

      body.style.overflow = 'hidden';

      var anim = body.animate(frames, { duration: DURATION, easing: 'ease' });

      anim.onfinish = anim.oncancel = function () {
        body.style.overflow = '';
        // Only now, so the body was on screen for the whole roll-up.
        if (!opening) { el.open = false; }
        el.removeAttribute('data-rolling');
      };
    });
  }

  ROLLS.forEach(function (kind) {
    [].forEach.call(document.querySelectorAll(kind.group), function (el) {
      roll(el, el.querySelector(kind.body));
    });
  });
})();
</script>

{% include "api/intro.md" %}
{% include "api/rpc.md" %}
{% include "api/mq.md" %}
{% include "api/misc.md" %}
{% include "api/migration.md" %}
