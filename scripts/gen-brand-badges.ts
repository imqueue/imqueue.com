// Rasterise every square brand badge in brand/*-badge.svg to PNG.
// Run: node scripts/gen-brand-badges.ts   (or via `npm run gen-brand-badges`)
//
// Badges are the square, solid-background form of a glyph — the shape app stores,
// package registries, GitHub org avatars and the MCP/app directories all want. They
// are the only brand asset that regularly has to be handed over as a raster file at
// a specific pixel size, which is why they get a generator and the rest of brand/
// does not.
//
// The SVG is the source of truth; these PNGs are build output that happens to be
// committed (nothing in the site build regenerates them, and consumers need a file
// they can upload). Re-run this after editing a badge SVG.
import sharp from "sharp";
import { readFile, writeFile, readdir } from "node:fs/promises";
import { basename, join } from "node:path";

const DIR = "brand";
// 256 and 48 are what the OpenAI app directory asks for; 1024/512 cover every
// other upload form and the public URLs under images/.
const SIZES = [1024, 512, 256, 48];

// density: sharp renders SVG at 72dpi by default, so a 1024px-wide source would be
// resampled from 1024px and lose nothing — but a badge whose SVG uses a small
// viewBox would render tiny and then get upscaled. Rendering at high density and
// resizing down keeps every badge crisp regardless of its viewBox units.
const DENSITY = 384;

const svgs = (await readdir(DIR)).filter((f) => f.endsWith("-badge.svg")).sort();

if (!svgs.length) {
  console.error(`No *-badge.svg found in ${DIR}/`);
  process.exit(1);
}

for (const file of svgs) {
  const svg = await readFile(join(DIR, file));
  const stem = basename(file, ".svg");

  for (const size of SIZES) {
    // Badges are opaque by definition (the background is part of the design), so
    // flatten any residual alpha rather than shipping a PNG whose corners depend on
    // what the viewer composites it over.
    const png = await sharp(svg, { density: DENSITY })
      .resize(size, size, { fit: "cover" })
      .flatten({ background: "#ffffff" })
      .png({ compressionLevel: 9 })
      .toBuffer();

    // 1024 keeps the bare stem — it is the canonical asset, and the sandbox badge
    // was already committed under that name before this script existed.
    const out = join(DIR, size === 1024 ? `${stem}.png` : `${stem}-${size}.png`);
    await writeFile(out, png);
    console.log(`wrote ${out} (${size}x${size}, ${(png.length / 1024).toFixed(1)} kB)`);
  }
}
