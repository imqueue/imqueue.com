#!/usr/bin/env node
/**
 * Link-checker crawler for the built @imqueue sites.
 *
 * Serves the built editions locally (no external network needed) and crawls
 * every internal link recursively, reporting anything that does not resolve:
 *   - <a href>, <img src>, <script src>, <link href>, <source src>
 *   - cross-site links between imqueue.org and imqueue.com (both are served,
 *     so a link from .com to imqueue.org/license/ is verified against the
 *     .org build)
 *   - #fragment links (verified against the target page's element ids)
 *   - Cloudflare `_redirects` are applied, so links that resolve only via a
 *     301 are treated as valid (and followed to their destination)
 *
 * External links (any other host) are counted but not fetched by default, so
 * the check stays fast and offline; pass --external to fetch them too.
 *
 * Exit code is non-zero when any broken internal link is found — suitable for a
 * pre-commit hook.
 *
 * Usage:
 *   node scripts/check-links.js [--external] [--skip-descend=/api/,/foo/]
 *                               [--quiet]
 * Assumes `_site-org` and `_site-com` already built (run build:all first).
 */
"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");

const SITES = [
  { name: "org", dir: path.join(ROOT, "_site-org"), host: "imqueue.org" },
  { name: "com", dir: path.join(ROOT, "_site-com"), host: "imqueue.com" },
];

// ---- args ----------------------------------------------------------------
const args = process.argv.slice(2);
const CHECK_EXTERNAL = args.includes("--external");
const QUIET = args.includes("--quiet");
const skipArg = args.find((a) => a.startsWith("--skip-descend="));
const SKIP_DESCEND = skipArg
  ? skipArg.split("=")[1].split(",").filter(Boolean)
  : [];

// ---- tiny static server with _redirects ----------------------------------
const MIME = {
  ".html": "text/html", ".htm": "text/html", ".css": "text/css",
  ".js": "text/javascript", ".mjs": "text/javascript", ".json": "application/json",
  ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp",
  ".ico": "image/x-icon", ".txt": "text/plain", ".xml": "application/xml",
  ".woff": "font/woff", ".woff2": "font/woff2", ".map": "application/json",
  ".avif": "image/avif", ".mp4": "video/mp4", ".webmanifest": "application/manifest+json",
};

function parseRedirects(dir) {
  const file = path.join(dir, "_redirects");
  if (!fs.existsSync(file)) return [];
  const rules = [];
  for (let line of fs.readFileSync(file, "utf8").split("\n")) {
    line = line.trim();
    if (!line || line.startsWith("#")) continue;
    const parts = line.split(/\s+/);
    if (parts.length < 2) continue;
    const [from, to, status] = parts;
    rules.push({ from, to, status: parseInt(status, 10) || 301 });
  }
  return rules;
}

function matchRedirect(rules, urlPath) {
  for (const r of rules) {
    if (r.from.endsWith("/*")) {
      const prefix = r.from.slice(0, -1); // keep trailing slash
      if (urlPath === prefix || urlPath.startsWith(prefix)) {
        const splat = urlPath.slice(prefix.length);
        return { status: r.status, location: r.to.replace(":splat", splat) };
      }
    } else if (urlPath === r.from) {
      return { status: r.status, location: r.to };
    }
  }
  return null;
}

function resolveFile(dir, urlPath) {
  let p = decodeURIComponent(urlPath.split("?")[0].split("#")[0]);
  const joined = path.normalize(path.join(dir, p));
  if (!joined.startsWith(dir)) return null; // path traversal guard
  const candidates = [];
  if (p.endsWith("/")) {
    candidates.push(path.join(joined, "index.html"));
  } else {
    candidates.push(joined);
    candidates.push(joined + ".html");
    candidates.push(path.join(joined, "index.html"));
  }
  for (const c of candidates) {
    try {
      if (fs.statSync(c).isFile()) return c;
    } catch (_) {}
  }
  return null;
}

function makeServer(site) {
  const rules = parseRedirects(site.dir);
  return http.createServer((req, res) => {
    const urlPath = req.url;
    // Static asset takes precedence (as on Cloudflare Pages), then _redirects.
    const file = resolveFile(site.dir, urlPath);
    if (file) {
      const ext = path.extname(file).toLowerCase();
      res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
      if (req.method === "HEAD") return res.end();
      return fs.createReadStream(file).pipe(res);
    }
    const rd = matchRedirect(rules, urlPath.split("?")[0]);
    if (rd) {
      res.writeHead(rd.status, { Location: rd.location });
      return res.end();
    }
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not found");
  });
}

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve(server.address().port));
  });
}

// ---- fetch ----------------------------------------------------------------
function request(localUrl, method = "GET") {
  return new Promise((resolve) => {
    const u = new URL(localUrl);
    const r = http.request(
      { hostname: u.hostname, port: u.port, path: u.pathname + u.search, method },
      (res) => {
        const chunks = [];
        const ct = res.headers["content-type"] || "";
        const isHtml = ct.includes("text/html");
        if (method === "HEAD" || !isHtml) {
          res.resume();
          res.on("end", () =>
            resolve({ status: res.statusCode, headers: res.headers, body: "", isHtml })
          );
          return;
        }
        res.on("data", (c) => chunks.push(c));
        res.on("end", () =>
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: Buffer.concat(chunks).toString("utf8"),
            isHtml,
          })
        );
      }
    );
    r.on("error", (e) => resolve({ status: 0, error: e.message, headers: {}, body: "", isHtml: false }));
    r.end();
  });
}

// ---- html parsing ---------------------------------------------------------
function decodeEntities(s) {
  return s
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&#x2F;/gi, "/");
}

const ATTR_RE = /<(a|link|area)\b[^>]*?\shref\s*=\s*["']([^"']+)["']/gi;
const SRC_RE = /<(img|script|source|iframe|audio|video|track)\b[^>]*?\ssrc\s*=\s*["']([^"']+)["']/gi;
const ID_RE = /\sid\s*=\s*["']([^"']+)["']/gi;
const NAME_RE = /<a\b[^>]*?\sname\s*=\s*["']([^"']+)["']/gi;

function extractLinks(html) {
  const out = [];
  let m;
  while ((m = ATTR_RE.exec(html))) out.push(decodeEntities(m[2]));
  while ((m = SRC_RE.exec(html))) out.push(decodeEntities(m[2]));
  return out;
}
function extractAnchors(html) {
  const set = new Set();
  let m;
  while ((m = ID_RE.exec(html))) set.add(m[1]);
  while ((m = NAME_RE.exec(html))) set.add(m[1]);
  return set;
}

// ---- url classification ---------------------------------------------------
const siteByHost = {};
SITES.forEach((s) => (siteByHost[s.host] = s));

function classify(raw, fromSite, fromPath) {
  const t = raw.trim();
  if (!t) return { kind: "ignore" };
  if (/^(mailto:|tel:|javascript:|data:|sms:|ftp:)/i.test(t)) return { kind: "ignore" };
  if (t.startsWith("#")) {
    return { kind: "internal", site: fromSite, path: fromPath, frag: t.slice(1) };
  }
  let url;
  try {
    url = new URL(t, `https://${fromSite.host}${fromPath}`);
  } catch (_) {
    return { kind: "ignore" };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return { kind: "ignore" };
  const host = url.hostname.replace(/^www\./, "");
  const site = siteByHost[host];
  if (site) {
    return {
      kind: "internal",
      site,
      path: url.pathname + url.search,
      frag: url.hash ? url.hash.slice(1) : "",
    };
  }
  return { kind: "external", url: url.origin + url.pathname };
}

function pathKey(site, p) {
  return site.name + ":" + p.split("#")[0].split("?")[0];
}

// ---- crawl ----------------------------------------------------------------
async function main() {
  // Verify builds exist.
  for (const s of SITES) {
    if (!fs.existsSync(path.join(s.dir, "index.html"))) {
      console.error(`✗ ${s.dir}/index.html missing — run \`npm run build:all\` first.`);
      process.exit(2);
    }
  }

  const servers = [];
  for (const s of SITES) {
    const server = makeServer(s);
    s.port = await listen(server);
    s.base = `http://127.0.0.1:${s.port}`;
    servers.push(server);
  }

  const pageCache = new Map(); // pathKey -> {status, isHtml, anchors, links, redirectedExternal}
  const descended = new Set();
  const broken = []; // {url, from, reason}
  const brokenSeen = new Set();
  const externals = new Set();
  let pagesCrawled = 0;

  function reportBroken(url, from, reason) {
    const k = `${url}|${from}|${reason}`;
    if (brokenSeen.has(k)) return;
    brokenSeen.add(k);
    broken.push({ url, from, reason });
  }

  // Fetch + parse one internal target, following redirects across both sites.
  async function getPage(site, p) {
    const key = pathKey(site, p);
    if (pageCache.has(key)) return pageCache.get(key);
    let curSite = site;
    let curPath = p.split("#")[0];
    let result = null;
    for (let hop = 0; hop < 6; hop++) {
      const resp = await request(curSite.base + curPath);
      if (resp.status >= 300 && resp.status < 400 && resp.headers.location) {
        const cls = classify(resp.headers.location, curSite, curPath);
        if (cls.kind === "internal") {
          curSite = cls.site;
          curPath = cls.path.split("#")[0];
          continue;
        }
        // redirect leaves our sites -> treat as resolved (external destination)
        result = { status: 200, isHtml: false, anchors: new Set(), links: [], redirectedExternal: true };
        break;
      }
      result = {
        status: resp.status,
        error: resp.error,
        isHtml: resp.isHtml,
        anchors: resp.isHtml ? extractAnchors(resp.body) : new Set(),
        links: resp.isHtml ? extractLinks(resp.body) : [],
        redirectedExternal: false,
        finalSite: curSite,
        finalPath: curPath,
      };
      break;
    }
    if (!result)
      result = { status: 0, error: "too many redirects", isHtml: false, anchors: new Set(), links: [], redirectedExternal: false };
    pageCache.set(key, result);
    return result;
  }

  const queue = SITES.map((s) => ({ site: s, path: "/", from: "(seed)" }));

  while (queue.length) {
    const { site, path: p, from } = queue.shift();
    const key = pathKey(site, p);
    if (descended.has(key)) continue;
    descended.add(key);

    const page = await getPage(site, p);
    const display = `https://${site.host}${p}`;

    if (page.redirectedExternal) continue;
    if (page.status !== 200) {
      reportBroken(display, from, page.error ? `error: ${page.error}` : `HTTP ${page.status}`);
      continue;
    }
    if (!page.isHtml) continue;
    pagesCrawled++;

    if (SKIP_DESCEND.some((pre) => p.startsWith(pre))) continue;

    for (const raw of page.links) {
      const cls = classify(raw, site, p);
      if (cls.kind === "ignore") continue;
      if (cls.kind === "external") {
        externals.add(cls.url);
        if (CHECK_EXTERNAL) {
          const r = await request(cls.url, "HEAD").catch(() => ({ status: 0 }));
          if (!(r.status >= 200 && r.status < 400))
            reportBroken(cls.url, display, `external HTTP ${r.status || "unreachable"}`);
        }
        continue;
      }
      // internal
      const target = await getPage(cls.site, cls.path);
      const tdisplay = `https://${cls.site.host}${cls.path}${cls.frag ? "#" + cls.frag : ""}`;
      if (target.redirectedExternal) {
        // resolves via redirect to an external destination — OK
      } else if (target.status !== 200) {
        reportBroken(tdisplay, display, target.error ? `error: ${target.error}` : `HTTP ${target.status}`);
      } else if (cls.frag && target.isHtml && !target.anchors.has(cls.frag)) {
        reportBroken(tdisplay, display, `missing #${cls.frag} anchor`);
      }
      // enqueue internal html pages for further crawling
      if (
        target.status === 200 &&
        target.isHtml &&
        !target.redirectedExternal &&
        !descended.has(pathKey(cls.site, cls.path))
      ) {
        queue.push({ site: cls.site, path: cls.path.split("#")[0], from: display });
      }
    }
  }

  servers.forEach((s) => s.close());

  // ---- report -------------------------------------------------------------
  if (!QUIET) {
    console.log(
      `\nLink check: crawled ${pagesCrawled} pages across ${SITES.map((s) => s.host).join(", ")}` +
        `; ${externals.size} external link(s) ${CHECK_EXTERNAL ? "checked" : "skipped"}.`
    );
    if (SKIP_DESCEND.length) console.log(`(did not descend into: ${SKIP_DESCEND.join(", ")})`);
  }

  if (broken.length) {
    console.error(`\n✗ ${broken.length} broken link(s):\n`);
    // group by source page
    const byFrom = new Map();
    for (const b of broken) {
      if (!byFrom.has(b.from)) byFrom.set(b.from, []);
      byFrom.get(b.from).push(b);
    }
    for (const [fromPage, items] of byFrom) {
      console.error(`  on ${fromPage}`);
      for (const it of items) console.error(`    → ${it.url}  [${it.reason}]`);
    }
    console.error("");
    process.exit(1);
  }

  if (!QUIET) console.log("✓ No broken links found.\n");
}

main().catch((e) => {
  console.error("check-links crashed:", e);
  process.exit(2);
});
