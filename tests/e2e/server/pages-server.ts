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
// All three now live in ./pages-core.ts (createPagesHandler), which runs the REAL
// function modules imported from the repo. This file is only the Node plumbing that
// puts that handler behind an http socket — kept separate so the pentest harness can
// reuse the exact same handler (scripts/security/target.ts) and neither the suite
// nor the scan can pass against a routing policy the other does not see.
//
// It is deliberately not a build step. Point it at an already-built _site-org —
// running `eleventy --serve` instead would put a watcher in the loop that rebuilds
// mid-assertion.

import { createServer, type IncomingMessage } from "node:http";
import { existsSync } from "node:fs";
import path from "node:path";

import { createPagesHandler, REPO_ROOT } from "./pages-core.ts";

const argv = process.argv.slice(2);
const arg = (name: string, fallback: string): string => {
  const i = argv.indexOf(`--${name}`);

  return i === -1 ? fallback : argv[i + 1] ?? fallback;
};

const SITE = path.resolve(REPO_ROOT, arg("dir", process.env.E2E_SITE_DIR || "_site-org"));
const PORT = Number(arg("port", process.env.E2E_PORT || "8099"));
const HOST = "127.0.0.1";

if (!existsSync(path.join(SITE, "index.html"))) {
  console.error(
    `pages-server: ${path.relative(REPO_ROOT, SITE)} has no index.html — run \`npm run build:all\` first.`,
  );
  process.exit(1);
}

// `env: {}` keeps the analytics inert (it is inert until the GA4 secrets are set)
// while still exercising the header note, which reports its own state.
const handle = await createPagesHandler({ siteDir: SITE, env: {} });

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
    const response = await handle(toWebRequest(req));

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
  console.log(`pages-server: ${path.relative(REPO_ROOT, SITE)} on http://${HOST}:${PORT}/`);
});
