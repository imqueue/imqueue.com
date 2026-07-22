/**
 * Per-post social-share images for the .org blog.
 *
 *   node scripts/gen-og-blog.js      (or: npm run gen-og-blog)
 *
 * Renders images/blog/<slug>.png (1200x630) for every post in
 * src/org/blog/posts/*.md, in the Terminal (.org) style: the post title,
 * author + date byline, and the post's own vector illustration composited in.
 *
 * Fonts are handled exactly like gen-og-images.js (woff2 -> sfnt in a temp dir
 * behind a throwaway fontconfig). Illustration SVGs use CSS custom properties
 * (var(--accent) …) which librsvg can't resolve standalone, so we substitute
 * the dark-theme hex values before compositing.
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const woff2 = require("wawoff2");
const yaml = require("js-yaml");

const ROOT = path.resolve(__dirname, "..");
const FONTS_DIR = path.join(ROOT, "src", "_shared", "fonts");
const POSTS_DIR = path.join(ROOT, "src", "org", "blog", "posts");
const ART_DIR = path.join(ROOT, "src", "_shared", "_includes", "blog-art");
const AUTHORS_FILE = path.join(ROOT, "src", "_data", "authors.yml");
const OUT_DIR = path.join(ROOT, "images", "blog");

const DISPLAY = "Space Grotesk Light"; // 700 face shares this family
const MONO = "JetBrains Mono";

const FONT_FILES = [
  "space-grotesk-latin-400-normal.woff2",
  "space-grotesk-latin-700-normal.woff2",
  "jetbrains-mono-latin-400-normal.woff2",
  "jetbrains-mono-latin-700-normal.woff2",
];

async function setupFonts() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "imq-ogblog-"));
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
<fontconfig><dir>${ttfDir}</dir><cachedir>${cacheDir}</cachedir><config></config></fontconfig>`
  );
  process.env.FONTCONFIG_FILE = conf;
  process.env.FONTCONFIG_PATH = dir;
}

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// Dark-theme concrete values for the illustration CSS variables.
const VARS = {
  "var(--accent)": "#3ddc84",
  "var(--muted)": "#7f8f89",
  "var(--line)": "rgba(255,255,255,0.14)",
  "var(--surface)": "#111917",
  "var(--bg)": "#0a0e0d",
  "var(--on-accent)": "#06120c",
  "var(--code)": "#c4cfc9",
};
function resolveVars(svg) {
  let out = svg;
  for (const [k, v] of Object.entries(VARS)) out = out.split(k).join(v);
  return out;
}

// Read front matter (between the first pair of --- lines).
function frontMatter(src) {
  const m = src.match(/^---\n([\s\S]*?)\n---/);
  return m ? yaml.load(m[1]) : {};
}

// Greedy word-wrap to a max character count per line.
function wrap(text, max, maxLines) {
  const words = text.split(/\s+/);
  const lines = [];
  let cur = "";
  for (const w of words) {
    if (!cur) cur = w;
    else if ((cur + " " + w).length <= max) cur += " " + w;
    else { lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    kept[maxLines - 1] = kept[maxLines - 1].replace(/[\s—-]+$/, "") + "…";
    return kept;
  }
  return lines;
}

const glyph = (x, y, scale, color) => `
  <g transform="translate(${x},${y}) scale(${scale})" fill="none" stroke="${color}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round">
    <path d="M33 12H15a8 8 0 0 0-8 8v8a8 8 0 0 0 8 8h18"/>
    <circle cx="16" cy="24" r="2.6" fill="${color}" stroke="none"/>
    <circle cx="24" cy="24" r="2.6" fill="${color}" stroke="none"/>
    <circle cx="41" cy="24" r="2.8" fill="${color}" stroke="none"/>
  </g>`;

function buildSVG({ title, illu, byline }) {
  const lines = wrap(title, 30, 4);
  const titleStartY = 300;
  const lineH = 62;
  const titleSVG = lines
    .map((ln, i) => `<text x="90" y="${titleStartY + i * lineH}" font-family="${DISPLAY}" font-weight="700" font-size="50" fill="#e8f0ec">${esc(ln)}</text>`)
    .join("\n  ");
  const bylineY = titleStartY + lines.length * lineH + 26;

  // Illustration nested top-right, with concrete colors.
  let illuEl = "";
  if (illu) {
    let art = resolveVars(illu).replace(/<svg\b/, '<svg x="742" y="70" width="378" height="205"');
    illuEl = `<rect x="742" y="70" width="378" height="205" rx="12" fill="#0d1512" stroke="rgba(255,255,255,0.10)"/>\n  ${art}`;
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <linearGradient id="gt" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#3ddc84"/><stop offset="1" stop-color="#35d0e0"/></linearGradient>
    <radialGradient id="tglow" cx="0.12" cy="0.12" r="0.65"><stop offset="0" stop-color="#3ddc84" stop-opacity="0.20"/><stop offset="1" stop-color="#3ddc84" stop-opacity="0"/></radialGradient>
  </defs>
  <rect width="1200" height="630" fill="#0a0e0d"/>
  <rect width="1200" height="630" fill="url(#tglow)"/>
  <rect x="0" y="0" width="1200" height="8" fill="url(#gt)"/>

  <g transform="translate(90,96)">
    ${glyph(0, 0, 1.6, "url(#gt)")}
    <text x="84" y="55" font-family="${MONO}" font-weight="700" font-size="52" fill="#e8f0ec">@imqueue</text>
  </g>
  <text x="94" y="228" font-family="${MONO}" font-weight="700" font-size="24" fill="#63e6a0">// BLOG</text>

  ${illuEl}

  ${titleSVG}

  <text x="90" y="${bylineY}" font-family="${MONO}" font-weight="400" font-size="26" fill="#7f8f89">${esc(byline)}</text>
  <text x="1110" y="584" text-anchor="end" font-family="${MONO}" font-weight="700" font-size="26" fill="#7f8f89">imqueue.org/blog</text>
</svg>`;
}

async function main() {
  await setupFonts();
  const sharp = require("sharp");
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const authorsList = yaml.load(fs.readFileSync(AUTHORS_FILE, "utf8")) || [];
  const authors = Object.fromEntries(authorsList.map((a) => [a.slug, a]));

  const files = fs.readdirSync(POSTS_DIR).filter((f) => f.endsWith(".md"));
  let n = 0;
  for (const file of files) {
    const slug = file.replace(/\.md$/, "");
    const fm = frontMatter(fs.readFileSync(path.join(POSTS_DIR, file), "utf8"));
    if (!fm.title) continue;
    const author = authors[fm.author];
    const dateStr = fm.date
      ? new Date(fm.date).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" })
      : "";
    const byline = [author ? author.name : null, dateStr].filter(Boolean).join("  ·  ");
    let illu = null;
    if (fm.illustration) {
      const p = path.join(ART_DIR, `${fm.illustration}.svg`);
      if (fs.existsSync(p)) illu = fs.readFileSync(p, "utf8");
    }
    const svg = buildSVG({ title: fm.title, illu, byline });
    await sharp(Buffer.from(svg)).png().toFile(path.join(OUT_DIR, `${slug}.png`));
    n++;
  }
  console.log(`Wrote ${n} blog OG images to images/blog/`);
}

main().catch((e) => { console.error(e); process.exit(1); });
