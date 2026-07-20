// Generate a multi-size favicon.ico from each edition's favicon.svg glyph.
// Run: node scripts/gen-favicons.mjs   (or via `npm run gen-favicons`)
import sharp from "sharp";
import pngToIco from "png-to-ico";
import { readFile, writeFile } from "node:fs/promises";

const editions = ["org", "com"];
const sizes = [16, 32, 48, 64];

for (const ed of editions) {
  const svg = await readFile(`src/${ed}/favicon.svg`);
  const pngs = await Promise.all(
    sizes.map((s) => sharp(svg, { density: 384 }).resize(s, s).png().toBuffer())
  );
  const ico = await pngToIco(pngs);
  await writeFile(`src/${ed}/favicon.ico`, ico);
  console.log(`wrote src/${ed}/favicon.ico (${sizes.join(",")}px)`);
}
