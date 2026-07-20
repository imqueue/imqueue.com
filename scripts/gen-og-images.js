/**
 * Generate social-share (Open Graph / Twitter) images for both editions.
 *
 *   node scripts/gen-og-images.js      (or: npm run gen-og)
 *
 * Renders 1200x630 PNGs from inline SVG using the project's own brand fonts
 * (Space Grotesk for Flux / .com, JetBrains Mono for Terminal / .org).
 *
 * librsvg's Pango backend resolves fonts through fontconfig + freetype, which
 * want sfnt (ttf/otf) rather than woff2. So we decompress the bundled woff2
 * fonts to a throwaway temp dir (wawoff2 just unwraps the sfnt — glyphs are
 * untouched), point a throwaway fontconfig config at it, then render.
 *
 * Output: images/og-com.png, images/og-org.png (shared passthrough dir).
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const woff2 = require("wawoff2");

const ROOT = path.resolve(__dirname, "..");
const FONTS_DIR = path.join(ROOT, "src", "_shared", "fonts");
const OUT_DIR = path.join(ROOT, "images");

// Family names as fontconfig sees them once decompressed (see fc-scan). The
// fontsource static faces report these legacy families; we only use the 400
// and 700 faces, which share the base family, so weight selection is clean.
const FLUX_FAMILY = "Space Grotesk Light";
const MONO_FAMILY = "JetBrains Mono";

const FONT_FILES = [
  "space-grotesk-latin-400-normal.woff2",
  "space-grotesk-latin-700-normal.woff2",
  "jetbrains-mono-latin-400-normal.woff2",
  "jetbrains-mono-latin-700-normal.woff2",
];

async function setupFonts() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "imq-og-"));
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
  // Must be set before sharp/librsvg initialise fontconfig.
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

const SLOGAN_1 = "RPC over an inter-communication messaging queue";
const SLOGAN_2 = "for Node & TypeScript";

// --- Flux (imqueue.com) --------------------------------------------------
const fluxSVG = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#7b61ff"/>
      <stop offset="1" stop-color="#ff5db1"/>
    </linearGradient>
    <radialGradient id="glow1" cx="0.18" cy="0.2" r="0.6">
      <stop offset="0" stop-color="#7b61ff" stop-opacity="0.32"/>
      <stop offset="1" stop-color="#7b61ff" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="glow2" cx="0.9" cy="0.95" r="0.7">
      <stop offset="0" stop-color="#ff5db1" stop-opacity="0.26"/>
      <stop offset="1" stop-color="#ff5db1" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="1200" height="630" fill="#0c0a17"/>
  <rect width="1200" height="630" fill="url(#glow1)"/>
  <rect width="1200" height="630" fill="url(#glow2)"/>
  <rect x="0" y="0" width="1200" height="8" fill="url(#g)"/>

  <g transform="translate(90,150)">
    ${glyph(0, 0, 2.35, "url(#g)")}
    <text x="120" y="80" font-family="${FLUX_FAMILY}" font-weight="700" font-size="108" fill="#f2eeff">@imqueue</text>
  </g>

  <text x="94" y="362" font-family="${FLUX_FAMILY}" font-weight="400" font-size="43" fill="#e7e0ff">${esc(SLOGAN_1)}</text>
  <text x="94" y="420" font-family="${FLUX_FAMILY}" font-weight="400" font-size="43" fill="#e7e0ff">${esc(SLOGAN_2)}</text>

  <text x="94" y="514" font-family="${FLUX_FAMILY}" font-weight="700" font-size="30" fill="#b9a6ff">Commercial license &amp; support</text>

  <text x="1108" y="576" text-anchor="end" font-family="${FLUX_FAMILY}" font-weight="700" font-size="30" fill="#9a92c0">imqueue.com</text>
</svg>`;

// --- Terminal (imqueue.org) ----------------------------------------------
const termSVG = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
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
  <rect width="1200" height="630" fill="#0a0e0d"/>
  <rect width="1200" height="630" fill="url(#tglow)"/>
  <rect x="0" y="0" width="1200" height="8" fill="url(#gt)"/>

  <g transform="translate(90,150)">
    ${glyph(0, 0, 2.35, "url(#gt)")}
    <text x="120" y="80" font-family="${MONO_FAMILY}" font-weight="700" font-size="92" fill="#e8f0ec">@imqueue</text>
  </g>

  <text x="94" y="356" font-family="${MONO_FAMILY}" font-weight="400" font-size="36" fill="#d5e2db">${esc(SLOGAN_1)}</text>
  <text x="94" y="408" font-family="${MONO_FAMILY}" font-weight="400" font-size="36" fill="#d5e2db">${esc(SLOGAN_2)}</text>

  <text x="94" y="506" font-family="${MONO_FAMILY}" font-weight="700" font-size="30" fill="#63e6a0"><tspan fill="#35d0e0">$</tspan> npm i @imqueue/rpc</text>

  <text x="1108" y="576" text-anchor="end" font-family="${MONO_FAMILY}" font-weight="700" font-size="30" fill="#7f8f89">imqueue.org</text>
</svg>`;

async function main() {
  await setupFonts();
  const sharp = require("sharp"); // require after FONTCONFIG_* are set
  fs.mkdirSync(OUT_DIR, { recursive: true });
  await sharp(Buffer.from(fluxSVG)).png().toFile(path.join(OUT_DIR, "og-com.png"));
  await sharp(Buffer.from(termSVG)).png().toFile(path.join(OUT_DIR, "og-org.png"));
  console.log("Wrote images/og-com.png and images/og-org.png");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
