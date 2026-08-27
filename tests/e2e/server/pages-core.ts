// pages-core.ts — the request handling Cloudflare Pages does, as one importable
// function, so more than one caller can serve the built site the way production
// does WITHOUT re-inventing the routing.
//
// This is the half of pages-server.ts that is not Node plumbing: the static layer
// (clean URLs, the trailing-slash 301, _redirects, 404.html), the /api/<pkg>/
// Function routing, and the root _middleware in front of both. Two callers need it
// and must agree byte-for-byte on it, because a test that passes against one policy
// and a scan that passes against another would each be lying:
//
//   1. tests/e2e/server/pages-server.ts — the end-to-end suite's server.
//   2. scripts/security/target.ts        — the pentest harness's local target,
//      which wraps this with the _headers layer Cloudflare applies at the edge.
//
// It runs the REAL function modules, imported from the repo. `createPagesHandler`
// returns a `(Request) => Promise<Response>` — call it in-process, or put it behind
// an http server (pages-server does the latter). It deliberately does NOT apply
// _headers: on Pages those are edge infrastructure applied after the Function
// returns, so the header layer lives in the harness (scripts/security/headers.ts)
// where it can be modelled faithfully rather than smuggled in here.

import { readFile, stat } from "node:fs/promises";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { onRequest as middleware } from "../../../functions/_middleware.ts";
import { handleApiRequest } from "../../../lib/api-handler.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** Repo root, four levels up from tests/e2e/server/. */
export const REPO_ROOT = path.join(HERE, "..", "..", "..");

/** One `_redirects` rule, after parsing. */
export interface RedirectRule {
  from: string;
  to: string;
  status: number;
}

// Kept identical to pages-server.ts's original table — the static server answers
// with the same content types the suite has always asserted against.
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
 */
export function loadRedirects(dir: string): RedirectRule[] {
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

function matchRedirect(
  rules: RedirectRule[],
  pathname: string,
): { to: string; status: number } | null {
  for (const rule of rules) {
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
const inside = (siteDir: string, p: string): boolean =>
  p === siteDir || p.startsWith(siteDir + path.sep);

async function fileAt(siteDir: string, rel: string): Promise<string | null> {
  // decodeURIComponent so an encoded traversal (`%2e%2e%2f`) is resolved to the
  // `..` it hides before `inside()` gets to reject it — the whole point of the
  // guard is defeated if the check runs on the still-encoded string.
  let decoded: string;

  try {
    decoded = decodeURIComponent(rel);
  } catch {
    // A malformed %-escape can't name a real file; treat it as a miss.
    return null;
  }

  const abs = path.join(siteDir, decoded);

  if (!inside(siteDir, abs)) {
    return null;
  }

  try {
    const info = await stat(abs);

    return info.isFile() ? abs : null;
  } catch {
    return null;
  }
}

async function isDir(siteDir: string, rel: string): Promise<boolean> {
  let decoded: string;

  try {
    decoded = decodeURIComponent(rel);
  } catch {
    return false;
  }

  const abs = path.join(siteDir, decoded);

  if (!inside(siteDir, abs)) {
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
// `Response` takes nothing else.
const body = async (file: string): Promise<Uint8Array<ArrayBuffer>> =>
  Uint8Array.from(await readFile(file));

// Control files Cloudflare Pages owns and never serves as content — see the long
// note in _site-*/_headers about /robots.txt. Serving these locally (they exist on
// disk in the built output) would both diverge from production and make the exposure
// scan report a leak that does not exist on the edge.
const RESERVED_FILES = new Set(["/_headers", "/_redirects", "/_routes.json", "/_worker.js"]);

/** The static half of Pages: what `context.next()` resolves to. */
export async function serveStatic(
  siteDir: string,
  redirects: RedirectRule[],
  url: URL,
  method = "GET",
): Promise<Response> {
  // Static assets answer GET/HEAD only; Pages returns 405 for anything else. This is
  // what makes an HTTP method-tampering probe meaningful against the local build.
  if (method !== "GET" && method !== "HEAD") {
    return new Response(null, { status: 405, headers: { Allow: "GET, HEAD" } });
  }

  if (RESERVED_FILES.has(url.pathname)) {
    const notFound = await fileAt(siteDir, "/404.html");
    return new Response(notFound ? await body(notFound) : "Not found", {
      status: 404,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }

  const hop = matchRedirect(redirects, url.pathname);

  if (hop) {
    return new Response(null, {
      status: hop.status,
      headers: { Location: `${url.origin}${hop.to}${url.search}` },
    });
  }

  const pathname = url.pathname;

  // A directory URL: the index inside it.
  if (pathname.endsWith("/")) {
    const index = await fileAt(siteDir, `${pathname}index.html`);

    if (index) {
      return new Response(await body(index), {
        status: 200,
        headers: { "content-type": typeOf(index) },
      });
    }
  } else {
    const direct = await fileAt(siteDir, pathname);

    if (direct) {
      return new Response(await body(direct), {
        status: 200,
        headers: { "content-type": typeOf(direct) },
      });
    }

    // Pages normalises a directory reached without its slash. The 301 matters:
    // every in-page link on this site is written with the slash.
    if (await isDir(siteDir, pathname)) {
      return new Response(null, {
        status: 301,
        headers: { Location: `${url.origin}${pathname}/${url.search}` },
      });
    }

    // Clean URL: /foo -> /foo.html.
    const clean = await fileAt(siteDir, `${pathname}.html`);

    if (clean) {
      return new Response(await body(clean), {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
  }

  const notFound = await fileAt(siteDir, "/404.html");

  return new Response(notFound ? await body(notFound) : "Not found", {
    status: 404,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

/**
 * Which /api/<pkg>/ prefixes have a Function mounted, read from the directory the
 * generator writes. Hard-coding the list would let a newly generated package pass
 * while 404ing in production.
 */
export function apiPackages(): Set<string> {
  return new Set(
    readdirSync(path.join(REPO_ROOT, "functions", "api"), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name),
  );
}

function apiPackageOf(pathname: string, packages: Set<string>): string | null {
  const m = /^\/api\/([^/]+)(?:\/|$)/.exec(pathname);
  const pkg = m?.[1];

  return pkg && packages.has(pkg) ? pkg : null;
}

// Standalone Function FILES under functions/api/ (contact.ts, message.ts) — as
// opposed to the /api/<pkg>/ package DIRECTORIES handled by handleApiRequest. Pages
// mounts each at /api/<basename> and dispatches by method to the onRequest<Method>
// export. Reproduced here so the pentest harness exercises the real endpoint modules,
// not a mock — the e2e suite route-mocks /api/message in the browser, so this does
// not change what it sees.
const METHOD_EXPORT: Record<string, string> = {
  GET: "onRequestGet",
  HEAD: "onRequestHead",
  POST: "onRequestPost",
  PUT: "onRequestPut",
  DELETE: "onRequestDelete",
  PATCH: "onRequestPatch",
  OPTIONS: "onRequestOptions",
};

type FunctionModule = Record<string, unknown>;

/** Map /api/<name> -> its imported module, for every non-catch-all Function file. */
async function loadFunctionFiles(): Promise<Map<string, FunctionModule>> {
  const apiDir = path.join(REPO_ROOT, "functions", "api");
  const out = new Map<string, FunctionModule>();

  for (const entry of readdirSync(apiDir, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    // Skip _middleware, and skip [[path]]/[param] catch-alls (those are package dirs).
    if (entry.name.startsWith("_") || entry.name.startsWith("[")) continue;
    if (!/\.(ts|js)$/.test(entry.name)) continue;

    const route = `/api/${entry.name.replace(/\.(ts|js)$/, "")}`;
    out.set(route, (await import(path.join(apiDir, entry.name))) as FunctionModule);
  }

  return out;
}

/** Dispatch a standalone Function by method, mirroring Pages' 405 + Allow behaviour. */
async function dispatchFunction(
  mod: FunctionModule,
  request: Request,
  env: Record<string, string | undefined>,
  next: () => Promise<Response>,
): Promise<Response> {
  const method = request.method.toUpperCase();
  const handler = (mod[METHOD_EXPORT[method] ?? ""] ?? mod.onRequest) as
    | ((ctx: unknown) => Promise<Response> | Response)
    | undefined;

  if (typeof handler !== "function") {
    const allow = Object.entries(METHOD_EXPORT)
      .filter(([, exp]) => typeof mod[exp] === "function")
      .map(([m]) => m);

    if (typeof mod.onRequest === "function") allow.push("GET", "HEAD", "POST", "OPTIONS");

    return new Response(null, {
      status: 405,
      headers: { Allow: [...new Set(allow)].join(", ") },
    });
  }

  return handler({
    request,
    env,
    next,
    waitUntil: (promise: Promise<unknown>) => {
      void Promise.resolve(promise).catch(() => {});
    },
    params: {},
    data: {},
  });
}

export interface PagesHandlerOptions {
  /** The built edition directory to serve (absolute, or relative to cwd). */
  siteDir: string;
  /** The Pages env bindings. `{}` keeps analytics inert; that is the default. */
  env?: Record<string, string | undefined>;
}

/**
 * Build the `(Request) => Promise<Response>` that Pages runs: root middleware in
 * front of the Functions (standalone files and /api/<pkg>/ catch-alls) in front of
 * the static layer. The redirect table, the mounted-package set and the Function
 * modules are read once, here, so each request is just a lookup. Async because the
 * Function files are imported up front rather than on the hot path.
 */
export async function createPagesHandler(
  options: PagesHandlerOptions,
): Promise<(request: Request) => Promise<Response>> {
  const siteDir = path.resolve(options.siteDir);
  const env = options.env ?? {};
  const redirects = loadRedirects(siteDir);
  const packages = apiPackages();
  const functionFiles = await loadFunctionFiles();

  const route = async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    const serve = () => serveStatic(siteDir, redirects, url, request.method);

    // Standalone Function files (contact, message) win on an exact path match.
    const mod = functionFiles.get(url.pathname);
    if (mod) return dispatchFunction(mod, request, env, serve);

    // /api/<pkg>/ catch-alls (redirect resolution + kept version trees).
    if (apiPackageOf(url.pathname, packages)) {
      return handleApiRequest({
        request,
        next: serve,
        env,
        waitUntil: (promise: Promise<unknown>) => {
          void Promise.resolve(promise).catch(() => {});
        },
      });
    }

    return serve();
  };

  return (request: Request): Promise<Response> =>
    middleware({
      request,
      env,
      // waitUntil, so the response is on its way while analytics (if configured)
      // runs; swallowed so a rejection here can never fail the request.
      waitUntil: (promise: Promise<unknown>) => {
        void Promise.resolve(promise).catch(() => {});
      },
      next: () => route(request),
    });
}
