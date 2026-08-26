// Directory data for blog posts: point each post's social image at its
// generated per-post OG card (images/blog/<slug>.png, built by
// scripts/gen-og-blog.ts). Merges with src/org/org.11tydata.ts (permalink).
import type { EleventyData } from '../../../../scripts/lib/eleventy.ts';

export default {
  // Post <title>s stand on their own — head.html leaves off the " · @imqueue"
  // suffix here so the headline gets the full SERP width.
  bareTitle: true,
  eleventyComputed: {
    ogImage: (data: EleventyData) => {
      if (!data.illustration) return data.ogImage;
      return `${data.siteUrl}/images/blog/${data.page.fileSlug}.png`;
    },
    ogImageAlt: (data: EleventyData) => data.title,
  },
};
