# End-to-end tests — imqueue.org

172 tests over 13 spec files, driving the **built** site through a local
stand-in for the Cloudflare Pages deployment.

```bash
npm run build:all      # the suite tests _site-org, it does not build it
npm run test:e2e       # everything
npm run test:e2e -- --project=desktop specs/search-dialog.spec.js
npm run test:e2e -- --grep consent
```

## What is covered

| File | What it protects |
|---|---|
| `pages.spec.js` | every section renders: chrome, one `h1`, title, description, canonical, CSS applied, no console errors, no subresource 404s |
| `navigation.spec.js` | nav bar, brand, breadcrumbs, footer, 404 as a dead end with a way out, and every homepage link resolving |
| `theme.spec.js` | system/light/dark, persistence across navigation, applied before first paint, `aria-pressed` on both copies of the switch, OS preference |
| `search-dialog.spec.js` | the modal: three entry points, keyboard walking with wrap, topic chips, `pkg:` filters, highlighting, empty states |
| `search-page.spec.js` | `/search/`: query, topic selection and page number surviving into the URL and back out, history, paging |
| `consent.spec.js` | the banner's actual promise — **which vendor was contacted, and when** — allow/decline/per-purpose, persistence, withdrawal |
| `contact-form.spec.js` | field validation, attachment type/count/size limits, the JSON payload, error paths, the honeypot |
| `blog.spec.js` | listing, pager, topic and author pages, byline and dates, related reading, Article JSON-LD, the sidebar's own search |
| `doc-chrome.spec.js` | table of contents moved to the sidebar, scroll-spy, disclosures that roll, `#fragment` opening a collapsed answer, the screenshot lightbox |
| `api-reference.spec.js` | the whole retired-URL policy: trimmed URLs, retired versions, renamed packages, TypeDoc-era deep links — and that **no 301 lands anywhere but a 200** |
| `agent-surfaces.spec.js` | llms.txt and every page it lists, the markdown mirrors, the `Link:` and `x-agent-analytics` headers, sitemaps, robots, the JSON feeds. No browser is started for this file |
| `nav.mobile.spec.js` | the drawer: the only nav and the only search entry point below 900px, plus horizontal-overflow checks |
| `search.mobile.spec.js` | the dialog on a phone: fits the viewport, rows are tappable, reachable exit |

Deliberately **not** covered, because `npm test` already does it better and
cheaply: link crawling (`check-links.js`), search ranking (`npm run kpi`), index
integrity (`check-search-index.js`), JSON-LD schema (`check-jsonld.js`). This
suite covers what only a browser can see.

## How it works

`server/pages-server.mjs` serves `_site-org` the way Pages does, and **imports the
real Functions** to do it: `functions/_middleware.js` for the mirror `Link:`
header and the `x-agent-analytics` note, and `lib/api-handler.js` for every
`/api/<pkg>/` redirect. A file server alone would prove nothing about the URLs
that readers and crawlers actually hold, since those hops happen at the edge.

`support/fixtures.js` gives every test three things: no request ever leaves the
machine (external hosts are intercepted, recorded and answered locally — which is
what makes the consent assertions possible), a consent decision already seeded so
the banner does not eat clicks, and a console that is asserted clean.

## Running it safely on this machine

This workstation panics under network load, for reasons that have nothing to do
with this suite. Captured by kdump on 2026-08-25:

```
Oops: Split lock detected
CPU: 5 PID: 648 Comm: systemd-resolve
RIP: skb_clone+0x159/0x1e0     <- lock incl 0x20(%rdx), on a misaligned address
```

A DNS query, delivered locally, cloned for a raw socket, atomically incrementing
a misaligned refcount — and a kernel configured to panic on kernel split locks.
The real fix is `split_lock_detect=off` on the kernel command line.

Until then, and regardless, the suite contains itself:

* **Network isolated by default** — the whole run goes in a namespace with only
  loopback, so its traffic never reaches the host's nftables/WireGuard/Docker
  path. Costs nothing: every external host is already stubbed in-process.
  `E2E_HOST_NET=1` opts out.
* **Headless (default)** uses `chromium-headless-shell`, which has no
  window-system or GPU integration at all, with software rendering forced.
* **Headed** (`--headed`) uses full Chromium pinned to the **integrated** GPU:
  Mesa gets the iGPU by PCI address, glvnd only Mesa's EGL vendor, the Vulkan
  loader only the iGPU's ICD. See `support/gpu.js`.
* `run.sh` also wraps every run in a cgroup with memory, CPU and task caps, and
  reaps orphaned browsers before and after — including after a Ctrl-C.

```bash
npm run e2e:which-gpu           # prove the dGPU is untouched across a launch
npm run e2e:which-gpu -- --headed
E2E_HIDE_DGPU=1 npm run test:e2e   # optional: /dev/dri without the dGPU nodes
npm run test:e2e:reap              # after an interrupted run
```

Knobs: `E2E_WORKERS` (default 2), `E2E_MEMORY_MAX` (6G), `E2E_CPU_QUOTA` (400%),
`E2E_PORT` (8099), `E2E_CHANNEL`, `E2E_HEADED`.
