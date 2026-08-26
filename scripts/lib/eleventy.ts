// The Eleventy shapes this repo's build-time TypeScript touches.
//
// Deliberately NOT @11ty/eleventy's own types: Eleventy ships none for the data
// cascade, and could not usefully — `data` is whatever front matter, directory
// data files and _data/ have merged into for THAT page, which is per-project by
// construction. What is spelled here is the subset every template in src/ reads,
// plus an index signature for the rest.
//
// The index signature is the honest part. Narrowing it away would be a claim that
// this file knows every key a page can carry, which no type in a project with
// authored front matter can. What the named fields buy is that `data.pge.url`
// and a misspelled `data.permalnk` still fail, because the ones that ARE known
// are known.

/** Eleventy's `page` object, as the templates here read it. */
export interface EleventyPage {
  url: string;
  /** Input path with the extension stripped, e.g. "/org/tutorial/index". */
  filePathStem: string;
  inputPath: string;
  outputPath: string | false;
  date: Date;
  fileSlug: string;
}

/**
 * One entry of an Eleventy collection.
 *
 * `data` is the item's own merged data, which is why this is mutually recursive
 * with EleventyData: a page's collections contain pages, each with collections.
 */
export interface CollectionItem {
  url: string;
  date: Date;
  inputPath: string;
  outputPath: string | false;
  page: EleventyPage;
  data: EleventyData;
  /** The rendered output. Present on a collection item, not during data resolution. */
  content?: string;
  /** The source before any template engine ran — what the markdown mirrors are built from. */
  rawInput?: string;
}

/** One page's merged data. */
export interface EleventyData {
  page: EleventyPage;
  /** Set in front matter; an explicit permalink wins over a computed one. */
  permalink?: string | false;
  draft?: boolean;
  /** Front-matter override for whether the page gets a markdown mirror. */
  mirror?: boolean;
  title?: string;
  /** 1-based chapter number, on the CLI and tutorial manual pages. */
  chapter?: number;
  collections?: Record<string, CollectionItem[] | undefined>;
  [key: string]: unknown;
}

/** What a `.11ty.ts` template's `render()` receives, and what `data()` returns. */
export type TemplateData = EleventyData;
