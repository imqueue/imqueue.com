// Ambient declarations for the two dependencies that ship no types and have no
// DefinitelyTyped package.
//
// Hand-written on purpose, and deliberately minimal: each one declares only the
// surface this repo actually calls, so an upstream signature change shows up as a
// type error at the call site rather than being absorbed by an `any`. A blanket
// `declare module "x";` would type the whole import as `any` and buy nothing.
//
// The third untyped dependency, js-yaml, has @types/js-yaml and uses it — a real
// package always beats a shim written here.

declare module "markdown-it-table-of-contents" {
  import type MarkdownIt from "markdown-it";

  /** Only the options eleventy.config passes. */
  interface TocOptions {
    includeLevel?: number[];
    containerClass?: string;
    listType?: string;
    slugify?: (s: string) => string;
    transformLink?: (link: string) => string;
    containerHeaderHtml?: string;
    markerPattern?: RegExp;
  }

  const plugin: (md: MarkdownIt, options?: TocOptions) => void;

  export default plugin;
}

declare module "wawoff2" {
  /** Compress a TTF/OTF buffer to WOFF2. */
  export function compress(input: Uint8Array): Promise<Uint8Array>;
  /** Decompress a WOFF2 buffer back to TTF/OTF. */
  export function decompress(input: Uint8Array): Promise<Uint8Array>;
}
