// Shared request handler for the /api/<pkg>/ Cloudflare Pages Functions.
//
// Mounted per package (functions/api/core/, functions/api/rpc/, …) rather than as
// a single functions/api/[[path]].ts on purpose: a catch-all at /api/ would sit on
// top of /api/contact, and static Function routes only win over dynamic ones by
// convention. Keeping the catch-alls one level deeper means they cannot shadow
// the commercial contact endpoint at all.
//
// Note this is NOT avoided by using a named segment either. `[[path]]` is an
// OPTIONAL catch-all, so functions/api/[pkg]/[[path]].ts compiles to /api/:pkg/*
// and matches a bare single segment too — GET /api/core, with nothing after
// `core`, 301s to /api/core/latest/, which can only come from this handler. So
// /api/contact would be a live candidate for such a route.
//
// The per-package mount used to be two hand-copied files, which is what made
// collapsing it tempting. It is now GENERATED — one file per package from
// scripts/lib/api-packages.ts, written by scripts/build-api-docs.ts — so the
// copy-paste cost is gone and the routing guarantee is kept. Do not hand-edit the
// files under functions/api/<pkg>/; edit the generator.


import {
  resolveApiRedirect,
  resolveCoreReexport,
  resolveLegacyTypedoc,
  resolveRenamedApiPage,
} from "./api-redirects.ts";
import type { PagesContext } from "./pages.ts";

// imqueue.com is the commercial edition — every /api/ page lives on imqueue.org.
// src/com/_redirects used to 301 those, but Pages Functions are evaluated ahead
// of _redirects, so the hop has to happen here or it would be silently dropped.
const COMMERCIAL_HOSTS: ReadonlySet<string> = new Set(["imqueue.com", "www.imqueue.com"]);

export async function handleApiRequest(context: PagesContext): Promise<Response> {
  const url = new URL(context.request.url);

  if (COMMERCIAL_HOSTS.has(url.hostname)) {
    // Map a TypeDoc-era path here too, not just on .org. These URLs exist BECAUSE
    // the reference used to live on this host, so .com is where most of them arrive
    // — and resolving before the hop means one 301 to the real page instead of
    // .com -> .org -> page.
    const legacy = resolveLegacyTypedoc(url.pathname);

    return Response.redirect(
      `https://imqueue.org${legacy || url.pathname}${url.search}`,
      301,
    );
  }

  const redirect = (to: string): Response =>
    Response.redirect(`${url.origin}${to}${url.search}`, 301);
  const target = resolveApiRedirect(url.pathname);

  if (target) {
    return redirect(target);
  }

  // A kept version tree — serve the built page.
  const response = await context.next();

  // Symbols rpc only ever documented because it re-exported them from core now
  // 404 here. Those URLs were indexed, so send them to the core page that
  // replaced them. Checked after the asset lookup so a real page always wins.
  // Likewise for a page whose URL moved when the generator stripped an
  // api-extractor collision suffix from the symbol's name.
  if (response.status === 404) {
    const salvaged =
      resolveCoreReexport(url.pathname) ||
      resolveRenamedApiPage(url.pathname) ||
      resolveLegacyTypedoc(url.pathname);

    if (salvaged) {
      return redirect(salvaged);
    }
  }

  return response;
}
