// Shared request handler for the /api/<pkg>/ Cloudflare Pages Functions.
//
// Mounted per package (functions/api/core, functions/api/rpc) rather than as a
// single functions/api/[[path]].js on purpose: a catch-all at /api/ would sit on
// top of /api/contact, and static Function routes only win over dynamic ones by
// convention. Keeping the catch-alls one level deeper means they cannot shadow
// the commercial contact endpoint at all.

import { resolveApiRedirect, resolveCoreReexport } from "./api-redirects.js";

// imqueue.com is the commercial edition — every /api/ page lives on imqueue.org.
// src/com/_redirects used to 301 those, but Pages Functions are evaluated ahead
// of _redirects, so the hop has to happen here or it would be silently dropped.
const COMMERCIAL_HOSTS = new Set(["imqueue.com", "www.imqueue.com"]);

export async function handleApiRequest(context) {
  const url = new URL(context.request.url);

  if (COMMERCIAL_HOSTS.has(url.hostname)) {
    return Response.redirect(
      `https://imqueue.org${url.pathname}${url.search}`,
      301,
    );
  }

  const redirect = (to) =>
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
  if (response.status === 404) {
    const salvaged = resolveCoreReexport(url.pathname);

    if (salvaged) {
      return redirect(salvaged);
    }
  }

  return response;
}
