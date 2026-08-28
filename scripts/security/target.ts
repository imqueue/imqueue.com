// scripts/security/target.ts — what "a site under test" means to every check.
//
// A Target hands the checks one thing: `fetch(path)` → a plain FetchResult they can
// assert on, WITHOUT following redirects (a 301's Location is itself evidence, for
// the open-redirect and trailing-slash checks). Two implementations, one shape:
//
//   * local  — boots the built edition behind the real Pages handler (pages-core.ts)
//              with the _headers layer re-applied (headers.ts), on an ephemeral
//              loopback port. Same middleware, same Functions, same headers as prod.
//              Also exposes the built directory for the static file checks.
//   * remote — the live edge, https://imqueue.org / https://imqueue.com. No file
//              access; everything is observed over HTTP, which is the point.
//
// One shape means a single set of checks grades a local build before commit and the
// live site after deploy — which is exactly the "test the local build AND the remote
// sites" the harness is for.

import { createServer, type Server, type IncomingMessage } from "node:http";
import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { performance } from "node:perf_hooks";
import path from "node:path";

import { createPagesHandler, REPO_ROOT } from "../../tests/e2e/server/pages-core.ts";
import { applyHeaders, readHeadersFile, type HeaderRule } from "./headers.ts";

/** The normalised result every check reads. Redirects are never followed. */
export interface FetchResult {
  url: string;
  status: number;
  ok: boolean;
  headers: Headers;
  body: string;
  location: string | null;
  contentType: string;
  /** Round-trip time in ms — used only to keep timing-based checks honest, never asserted tightly. */
  timeMs: number;
}

export interface FetchOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: string | Uint8Array;
}

export interface Target {
  /** e.g. "local:org" or "remote:imqueue.com" — the label printed on every finding. */
  label: string;
  kind: "local" | "remote";
  /** The origin a check builds URLs against. */
  origin: string;
  /** The canonical host this edition answers as (imqueue.org / imqueue.com). */
  host: string;
  fetch(pathOrUrl: string, opts?: FetchOptions): Promise<FetchResult>;
  /** Built edition directory — local only; undefined for remote. */
  siteDir?: string;
  /** Parsed `_headers` — local only (remote reads them off live responses). */
  headerRules?: HeaderRule[];
  close(): Promise<void>;
}

// Hop-by-hop and host headers the local server must not forward from the probe into
// the internal Request — the host is set from the edition, and content-length/
// connection belong to the transport, not the application request.
const STRIP_REQUEST_HEADERS = new Set(["host", "connection", "content-length", "keep-alive"]);

async function doFetch(base: string, pathOrUrl: string, opts: FetchOptions = {}): Promise<FetchResult> {
  const url = pathOrUrl.startsWith("http") ? pathOrUrl : base + pathOrUrl;
  const start = performance.now();

  let resp: Response;

  try {
    resp = await fetch(url, {
      method: opts.method ?? "GET",
      headers: opts.headers,
      body: opts.body,
      redirect: "manual",
    });
  } catch (err) {
    // A refused/failed connection is itself a result the checks can reason about
    // (e.g. http:// that will not connect at all). Represent it as status 0.
    return {
      url,
      status: 0,
      ok: false,
      headers: new Headers(),
      body: err instanceof Error ? err.message : String(err),
      location: null,
      contentType: "",
      timeMs: performance.now() - start,
    };
  }

  // Cap the body read so a probe of a large asset cannot balloon memory; every
  // check works on the head of the document, and 2 MB covers the largest page.
  const raw = await resp.text().catch(() => "");
  const body = raw.length > 2_000_000 ? raw.slice(0, 2_000_000) : raw;

  return {
    url,
    status: resp.status,
    ok: resp.ok,
    headers: resp.headers,
    body,
    location: resp.headers.get("location"),
    contentType: resp.headers.get("content-type") ?? "",
    timeMs: performance.now() - start,
  };
}

/* ---- local target ---------------------------------------------------------- */

const EDITION_HOST: Record<"org" | "com", string> = {
  org: "imqueue.org",
  com: "imqueue.com",
};

function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

/**
 * Boot the built edition behind the real Pages handler + _headers, on an ephemeral
 * loopback port. The internal Request is given the edition's canonical host so the
 * host-keyed behaviour (per-edition security.txt, the imqueue.com→org /api hop) runs
 * exactly as it does in production, while the probe still connects to 127.0.0.1.
 */
export async function createLocalTarget(edition: "org" | "com"): Promise<Target> {
  const siteDir = path.join(REPO_ROOT, `_site-${edition}`);

  if (!existsSync(path.join(siteDir, "index.html"))) {
    throw new Error(
      `security: ${path.relative(REPO_ROOT, siteDir)} is not built — run \`npm run build:all\` first.`,
    );
  }

  const host = EDITION_HOST[edition];
  const rules = readHeadersFile(siteDir);
  const handle = await createPagesHandler({ siteDir, env: {} });

  const server: Server = createServer(async (req, res) => {
    try {
      const buf = await readBody(req);
      const headers = new Headers();

      for (const [k, v] of Object.entries(req.headers)) {
        if (STRIP_REQUEST_HEADERS.has(k.toLowerCase())) continue;
        if (Array.isArray(v)) v.forEach((x) => headers.append(k, x));
        else if (v !== undefined) headers.set(k, v);
      }

      const internalUrl = `https://${host}${req.url}`;
      const init: RequestInit = { method: req.method, headers };

      if (buf.length && req.method !== "GET" && req.method !== "HEAD") init.body = buf;

      const request = new Request(internalUrl, init);
      let response = await handle(request);

      response = applyHeaders(response, new URL(internalUrl), rules);

      res.statusCode = response.status;
      for (const [k, v] of response.headers) res.setHeader(k, v);

      if (req.method === "HEAD" || !response.body) {
        res.end();
        return;
      }

      res.end(Buffer.from(await response.arrayBuffer()));
    } catch (error) {
      // A THROWN handler is a 500 that, on Cloudflare, returns a generic body — the
      // stack never reaches the client. So the local wrapper must do the same: return a
      // generic body and log the stack to stderr for the operator. Putting the stack in
      // the response body instead would manufacture a disclosure/stack-trace finding
      // that the real edge would never produce (E6). A genuine app-level leak — a
      // handler that RETURNS a 500 whose body contains a trace — is unaffected: that
      // response is passed through above and still caught by the disclosure check.
      console.error(`security-server: handler threw for ${req.method} ${req.url}\n`, error instanceof Error ? error.stack : String(error));
      res.statusCode = 500;
      res.setHeader("content-type", "text/plain; charset=utf-8");
      res.end("Internal Server Error");
    }
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  const origin = `http://127.0.0.1:${port}`;

  return {
    label: `local:${edition}`,
    kind: "local",
    origin,
    host,
    siteDir,
    headerRules: rules,
    fetch: (p, o) => doFetch(origin, p, o),
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
  };
}

/* ---- remote target --------------------------------------------------------- */

/** A live edge origin. `origin` must be a bare https origin, e.g. https://imqueue.org. */
export function createRemoteTarget(origin: string): Target {
  const clean = origin.replace(/\/$/, "");
  const host = new URL(clean).host;

  return {
    label: `remote:${host}`,
    kind: "remote",
    origin: clean,
    host,
    fetch: (p, o) => doFetch(clean, p, o),
    close: () => Promise.resolve(),
  };
}

/* ---- static file access (local only) --------------------------------------- */

/** Every file under a built edition, as paths relative to the site root ("/x/y.html"). */
export function walkSite(siteDir: string): string[] {
  const out: string[] = [];

  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(abs);
      else out.push("/" + path.relative(siteDir, abs).split(path.sep).join("/"));
    }
  };

  if (existsSync(siteDir)) walk(siteDir);

  return out;
}

/** Read a built file as text, or null if it is absent. */
export function readSiteFile(siteDir: string, rel: string): string | null {
  const abs = path.join(siteDir, rel.replace(/^\//, ""));

  return existsSync(abs) && statSync(abs).isFile() ? readFileSync(abs, "utf8") : null;
}
