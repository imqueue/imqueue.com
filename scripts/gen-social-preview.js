/**
 * Generate GitHub social-preview cards (1280x640, GitHub's recommended size)
 * for the main @imqueue repos, in the Terminal (.org) brand style.
 *
 *   node scripts/gen-social-preview.js   (or: npm run gen-social)
 *
 * GitHub social-preview images can only be UPLOADED per-repo via
 * Settings -> Social preview (there is no API), so these are produced as files
 * for manual upload. Output: promotion/social-preview/<repo>.png
 *
 * Font handling mirrors gen-og-images.js (woff2 -> sfnt behind a throwaway
 * fontconfig) so librsvg/Pango can resolve the brand fonts.
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const woff2 = require("wawoff2");

const ROOT = path.resolve(__dirname, "..");
const FONTS_DIR = path.join(ROOT, "src", "_shared", "fonts");
const OUT_DIR = path.join(ROOT, "promotion", "social-preview");
const MONO = "JetBrains Mono";

const FONT_FILES = [
  "jetbrains-mono-latin-400-normal.woff2",
  "jetbrains-mono-latin-700-normal.woff2",
];

async function setupFonts() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "imq-social-"));
  const ttfDir = path.join(dir, "ttf");
  const cacheDir = path.join(dir, "cache");
  fs.mkdirSync(ttfDir, { recursive: true });
  fs.mkdirSync(cacheDir, { recursive: true });
  for (const f of FONT_FILES) {
    const sfnt = await woff2.decompress(fs.readFileSync(path.join(FONTS_DIR, f)));
    fs.writeFileSync(path.join(ttfDir, f.replace(/\.woff2$/, ".ttf")), Buffer.from(sfnt));
  }
  const conf = path.join(dir, "fonts.conf");
  fs.writeFileSync(
    conf,
    `<?xml version="1.0"?>
<!DOCTYPE fontconfig SYSTEM "fonts.dtd">
<fontconfig>
  <dir>${ttfDir}</dir>
  <cachedir>${cacheDir}</cachedir>
  <config></config>
</fontconfig>`
  );
  process.env.FONTCONFIG_FILE = conf;
  process.env.FONTCONFIG_PATH = dir;
}

// Brand glyph (from src/_shared/_includes/brand-logo.html), viewBox "3 10 42 28".
const glyph = (x, y, scale, color) => `
  <g transform="translate(${x},${y}) scale(${scale})" fill="none" stroke="${color}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round">
    <path d="M33 12H15a8 8 0 0 0-8 8v8a8 8 0 0 0 8 8h18"/>
    <circle cx="16" cy="24" r="2.6" fill="${color}" stroke="none"/>
    <circle cx="24" cy="24" r="2.6" fill="${color}" stroke="none"/>
    <circle cx="41" cy="24" r="2.8" fill="${color}" stroke="none"/>
  </g>`;

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// name, tagline (+ optional second line for long ones), install command
const CARDS = [
  { repo: "org", name: "@imqueue", tagline: "RPC over a message queue for Node & TypeScript", cmd: "npm i -g @imqueue/cli" },
  { repo: "rpc", name: "@imqueue/rpc", tagline: "Type-safe RPC over a message queue", cmd: "npm i @imqueue/rpc" },
  { repo: "core", name: "@imqueue/core", tagline: "The Redis-backed messaging-queue engine", cmd: "npm i @imqueue/core" },
  { repo: "cli", name: "@imqueue/cli", tagline: "Scaffolding & typed-client generation", cmd: "npm i -g @imqueue/cli" },
  { repo: "job", name: "@imqueue/job", tagline: "Simple, safe-by-default Redis job queue", cmd: "npm i @imqueue/job" },
  { repo: "pg-pubsub", name: "@imqueue/pg-pubsub", tagline: "Reliable PostgreSQL LISTEN/NOTIFY", tagline2: "with inter-process lock support", cmd: "npm i @imqueue/pg-pubsub" },
  // Not npm packages (UDP nodes that announce new Redis broker instances so the
  // message bus scales out horizontally) — no install command, so they show a
  // context tag instead of a `$ npm i` line. Promoter broadcasts (where allowed);
  // unicaster sends direct unicast to discovered pods where broadcast is blocked.
  { repo: "redis-broker-promoter", name: "redis-broker-promoter", tagline: "Announces new Redis broker instances", tagline2: "for horizontal message-bus auto-scaling", tag: "UDP broadcast · Redis · auto-scaling" },
  { repo: "redis-broker-unicaster", name: "redis-broker-unicaster", tagline: "Unicasts new Redis brokers to cluster pods", tagline2: "where broadcast is blocked (e.g. GCP VPC)", tag: "UDP unicast · Kubernetes · auto-scaling" },
];

// Fit the package name: shrink font so it never collides with the right edge.
function nameSize(name) {
  if (name.length <= 8) return 96;   // "@imqueue"
  if (name.length <= 13) return 78;  // "@imqueue/core"
  if (name.length <= 18) return 70;  // "@imqueue/pg-pubsub"
  return 62;                         // "redis-broker-unicaster"
}

function card({ name, tagline, tagline2, cmd, tag }) {
  const ns = nameSize(name);
  // One-line tagline sits at y=372 with the command at 486; a second tagline
  // line tightens the two together and pushes the command down.
  const ty1 = tagline2 ? 358 : 372;
  const taglineBlock = tagline2
    ? `<text x="100" y="${ty1}" font-family="${MONO}" font-weight="400" font-size="40" fill="#d5e2db">${esc(tagline)}</text>
  <text x="100" y="${ty1 + 52}" font-family="${MONO}" font-weight="400" font-size="40" fill="#d5e2db">${esc(tagline2)}</text>`
    : `<text x="100" y="${ty1}" font-family="${MONO}" font-weight="400" font-size="40" fill="#d5e2db">${esc(tagline)}</text>`;
  const cmdY = tagline2 ? 504 : 486;
  // Prominent green `$ npm i …` for packages; a muted `// tag` for repos with
  // no install command (e.g. deployable infra nodes).
  const actionLine = cmd
    ? `<text x="100" y="${cmdY}" font-family="${MONO}" font-weight="700" font-size="32" fill="#63e6a0"><tspan fill="#35d0e0">$</tspan> ${esc(cmd)}</text>`
    : tag
    ? `<text x="100" y="${cmdY}" font-family="${MONO}" font-weight="700" font-size="30" fill="#7f8f89"><tspan fill="#35d0e0">//</tspan> ${esc(tag)}</text>`
    : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="640" viewBox="0 0 1280 640">
  <defs>
    <linearGradient id="gt" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#3ddc84"/>
      <stop offset="1" stop-color="#35d0e0"/>
    </linearGradient>
    <radialGradient id="tglow" cx="0.15" cy="0.15" r="0.6">
      <stop offset="0" stop-color="#3ddc84" stop-opacity="0.22"/>
      <stop offset="1" stop-color="#3ddc84" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="1280" height="640" fill="#0a0e0d"/>
  <rect width="1280" height="640" fill="url(#tglow)"/>
  <rect x="0" y="0" width="1280" height="8" fill="url(#gt)"/>

  <g transform="translate(96,150)">
    ${glyph(0, 0, 2.4, "url(#gt)")}
    <text x="124" y="82" font-family="${MONO}" font-weight="700" font-size="${ns}" fill="#e8f0ec">${esc(name)}</text>
  </g>

  ${taglineBlock}

  ${actionLine}

  <text x="100" y="590" font-family="${MONO}" font-weight="700" font-size="28" fill="#7f8f89">open source · GPL-3.0</text>
  <text x="1180" y="590" text-anchor="end" font-family="${MONO}" font-weight="700" font-size="28" fill="#7f8f89">imqueue.org</text>
</svg>`;
}

async function main() {
  await setupFonts();
  const sharp = require("sharp"); // require after FONTCONFIG_* are set
  fs.mkdirSync(OUT_DIR, { recursive: true });
  for (const c of CARDS) {
    await sharp(Buffer.from(card(c))).png().toFile(path.join(OUT_DIR, `${c.repo}.png`));
    console.log(`  wrote promotion/social-preview/${c.repo}.png`);
  }
  console.log(`\nUpload each per repo: Settings -> Options -> Social preview.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
