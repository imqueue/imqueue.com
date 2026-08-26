// pages-server.ts — a local stand-in for the Cloudflare Pages deployment.
//
//   node tests/e2e/server/pages-server.ts [--dir _site-org] [--port 8099]
//
// The end-to-end suite needs the site to behave the way it behaves in production,
// and on Pages a request is NOT just a file lookup. Three things sit in front of
// the static assets, and all three are user-visible:
//
//   1. functions/_middleware.ts — the parked-domain 301, the `x-agent-analytics`
//      diagnostic header and the `Link: …index.md; rel="alternate"` mirror hint.
//   2. functions/api/<pkg>/[[path]].ts — every retired API version URL, every
//      renamed package slug and every TypeDoc-era deep link resolves HERE, not in
//      _redirects (see lib/api-redirects.ts for why).
//   3. Pages' own static rules — clean URLs, the trailing-slash 301, _redirects,
//      and 404.html for anything left over.
//
// So this server runs the REAL function modules, imported from the repo, and only
// implements (3) itself. That keeps the tests honest: a change to the redirect
// policy is felt by the suite, and the suite cannot pass against a policy this
// file invented.
//
// It is deliberately not a build step. Point it at an already-built _site-org —
// running `eleventy --serve` instead would put a watcher in the loop that rebuilds
// mid-assertion.

import { createServer, type IncomingMessage } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "..", "..", "..");

/** One `_redirects` rule, after parsing. */
interface RedirectRule {
  from: string;
  to: string;
  status: number;
}

const argv = process.argv.slice(2);
const arg = (name: string, fallback: string): string => {
  const i = argv.indexOf(`--${name}`);

  return i === -1 ? fallback : argv[i + 1] ?? fallback;
};

const SITE = path.resolve(ROOT, arg("dir", process.env.E2E_SITE_DIR || "_site-org"));
const PORT = Number(arg("port", process.env.E2E_PORT || "8099"));
const HOST = "127.0.0.1";

if (!existsSync(path.join(SITE, "index.html"))) {
  console.error(
    `pages-server: ${path.relative(ROOT, SITE)} has no index.html — run \`npm run build:all\` first.`,
  );
  process.exit(1);
}

// ---- static layer ---------------------------------------------------------

const TYPES: Record<string, string | undefined> = {
  ".html": "text/html; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".avif": "image/avif",
};

const typeOf = (file: string): string =>
  TYPES[path.extname(file).toLowerCase()] || "application/octet-stream";

/**
 * `_redirects`, as Pages reads it: one rule per line, `from to [status]`, `#`
 * comments, and a trailing `/*` splat that carries `:splat` into the target.
 * imqueue.org ships no rules today (its API hops are Functions, on purpose) —
 * the parser exists so that adding one is covered rather than silently ignored.
 */
function loadRedirects(dir: string): RedirectRule[] {
  const file = path.join(dir, "_redirects");

  if (!existsSync(file)) {
    return [];
  }

  return readFileSync(file, "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => {
      const [from = "", to = "", code] = line.split(/\s+/);

      return { from, to, status: Number(code) || 302 };
    })
    .filter((rule) => rule.from && rule.to);
}

const REDIRECTS = loadRedirects(SITE);

function matchRedirect(pathname: string): { to: string; status: number } | null {
  for (const rule of REDIRECTS) {
    if (rule.from.endsWith("/*")) {
      const prefix = rule.from.slice(0, -1);

      if (pathname.startsWith(prefix)) {
        return {
          to: rule.to.replace(":splat", pathname.slice(prefix.length)),
          status: rule.status,
        };
      }
    } else if (rule.from === pathname) {
      return { to: rule.to, status: rule.status };
    }
  }

  return null;
}

/** Is `p` inside the site root? Guards against `..` in a request path. */
const inside = (p: string): boolean => p === SITE || p.startsWith(SITE + path.sep);

async function fileAt(rel: string): Promise<string | null> {
  const abs = path.join(SITE, decodeURIComponent(rel));

  if (!inside(abs)) {
    return null;
  }

  try {
    const info = await stat(abs);

    return info.isFile() ? abs : null;
  } catch {
    return null;
  }
}

async function isDir(rel: string): Promise<boolean> {
  const abs = path.join(SITE, decodeURIComponent(rel));

  if (!inside(abs)) {
    return false;
  }

  try {
    return (await stat(abs)).isDirectory();
  } catch {
    return false;
  }
}

// `Uint8Array.from` rather than `new Uint8Array(buffer)`: both copy the bytes out
// of the Buffer, but only this one is typed as backed by a plain ArrayBuffer, and
// `Response` takes nothing else. A Buffer is a view into a pool Node may have
// handed out in pieces, so the copy was always the point.
const body = async (file: string): Promise<Uint8Array<ArrayBuffer>> =>
  Uint8Array.from(await readFile(file));

/** The static half of Pages: what `context.next()` resolves to. */
async function serveStatic(url: URL): Promise<Response> {
  const hop = matchRedirect(url.pathname);

  if (hop) {
    return new Response(null, {
      status: hop.status,
      headers: { Location: `${url.origin}${hop.to}${url.search}` },
    });
  }

  const pathname = url.pathname;

  // A directory URL: the index inside it.
  if (pathname.endsWith("/")) {
    const index = await fileAt(`${pathname}index.html`);

    if (index) {
      return new Response(await body(index), {
        status: 200,
        headers: { "content-type": typeOf(index) },
      });
    }
  } else {
    const direct = await fileAt(pathname);

    if (direct) {
      return new Response(await body(direct), {
        status: 200,
        headers: { "content-type": typeOf(direct) },
      });
    }

    // Pages normalises a directory reached without its slash. The 301 matters:
    // every in-page link on this site is written with the slash, so a rule that
    // served the page directly would hide a link that had lost one.
    if (await isDir(pathname)) {
      return new Response(null, {
        status: 301,
        headers: { Location: `${url.origin}${pathname}/${url.search}` },
      });
    }

    // Clean URL: /foo -> /foo.html, which is how 404.html and the flat .md
    // mirrors are addressed.
    const clean = await fileAt(`${pathname}.html`);

    if (clean) {
      return new Response(await body(clean), {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
  }

  const notFound = await fileAt("/404.html");

  return new Response(notFound ? await body(notFound) : "Not found", {
    status: 404,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

// ---- function layer -------------------------------------------------------

const { onRequest: middleware } = await import(
  path.join(ROOT, "functions", "_middleware.ts")
);
const { handleApiRequest } = await import(path.join(ROOT, "lib", "api-handler.ts"));

// Which /api/<pkg>/ prefixes have a Function mounted, read from the directory the
// generator writes. Hard-coding the list here would let a newly generated package
// pass the suite while 404ing in production.
const { readdirSync } = await import("node:fs");
const API_PACKAGES = new Set(
  readdirSync(path.join(ROOT, "functions", "api"), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name),
);

function apiPackageOf(pathname: string): string | null {
  const m = /^\/api\/([^/]+)(?:\/|$)/.exec(pathname);
  const pkg = m?.[1];

  return pkg && API_PACKAGES.has(pkg) ? pkg : null;
}

/**
 * The routing Pages does between the middleware and the assets: a matching
 * Function handles the request, everything else falls through to static.
 */
async function route(request: Request): Promise<Response> {
  const url = new URL(request.url);

  if (apiPackageOf(url.pathname)) {
    return handleApiRequest({ request, next: () => serveStatic(url), env: {} });
  }

  return serveStatic(url);
}

// ---- node plumbing --------------------------------------------------------

function toWebRequest(req: IncomingMessage): Request {
  const url = `http://${req.headers.host || `${HOST}:${PORT}`}${req.url}`;
  const headers = new Headers();

  for (const [key, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) {
      value.forEach((v) => headers.append(key, v));
    } else if (value !== undefined) {
      headers.set(key, value);
    }
  }

  return new Request(url, { method: req.method, headers });
}

const server = createServer(async (req, res) => {
  try {
    const request = toWebRequest(req);
    // `env: {}` keeps the analytics inert (it is inert until the GA4 secrets are
    // set) while still exercising the header note, which reports its own state.
    const response = await middleware({
      request,
      env: {},
      waitUntil: (promise: Promise<unknown>) => { void Promise.resolve(promise).catch(() => {}); },
      next: () => route(request),
    });

    res.statusCode = response.status;

    for (const [key, value] of response.headers) {
      res.setHeader(key, value);
    }

    if (req.method === "HEAD" || !response.body) {
      res.end();

      return;
    }

    res.end(Buffer.from(await response.arrayBuffer()));
  } catch (error) {
    res.statusCode = 500;
    res.setHeader("content-type", "text/plain; charset=utf-8");
    res.end(`pages-server: ${error instanceof Error ? error.stack : String(error)}`);
  }
});

server.listen(PORT, HOST, () => {
  console.log(`pages-server: ${path.relative(ROOT, SITE)} on http://${HOST}:${PORT}/`);
});
