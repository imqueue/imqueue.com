// Cloudflare Pages middleware — 301s imqueue.net onto imqueue.org.
//
// imqueue.net is a defensive registration. Both it and www.imqueue.net are custom
// domains on the imqueue-org Pages project, so without this they *serve* the docs
// site on a second hostname instead of pointing at it — ~180 duplicate URLs whose
// only protection is the canonical tag.
//
// A Cloudflare Redirect Rule is the better mechanism and should replace this:
//
//   If    (http.host eq "imqueue.net") or (http.host eq "www.imqueue.net")
//   Then  Dynamic → concat("https://imqueue.org", http.request.uri.path), 301, preserve query
//
// It runs at the edge before Pages is involved, needs no code, and cannot affect
// imqueue.org or imqueue.com at all. This file exists only because it is the half of
// the job that lives in the repo. When the rule is in place, delete it.
//
// Two constraints shape the code below:
//
// 1. `functions/` is shared by BOTH Pages projects (see README), and a root
//    _middleware runs in front of every request to both — including static assets.
//    So the non-matching path must be as close to free as possible, and must never
//    throw. Any error here would take down imqueue.org and imqueue.com, not just a
//    parked domain, so the whole thing is wrapped to fail open.
//
// 2. It must call context.next() for everything else, so the existing functions
//    (api/contact, api/core, api/rpc) and each edition's _redirects still run.

const REDIRECT_HOSTS = new Set(["imqueue.net", "www.imqueue.net"]);

const TARGET = "imqueue.org";

export async function onRequest(context) {
  try {
    const url = new URL(context.request.url);

    if (REDIRECT_HOSTS.has(url.hostname)) {
      url.protocol = "https:";
      url.hostname = TARGET;
      url.port = "";

      return new Response(null, {
        status: 301,
        headers: {
          Location: url.toString(),
          // Browsers cache a bare 301 more or less forever, which is painful to undo
          // if the target ever changes. An hour is plenty for crawlers to consolidate
          // and keeps this reversible while it is still a stopgap.
          "Cache-Control": "public, max-age=3600",
        },
      });
    }
  } catch {
    // Deliberately swallowed — see constraint 1. Falling through to next() means a
    // bug here degrades to "no redirect", never to "site down".
  }

  return context.next();
}
