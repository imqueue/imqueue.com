// Declarations for the parts of Eleventy this repo's config calls.
//
// Eleventy 3 ships no .d.ts. `@11ty/eleventy/package.json` does map a "types"
// condition for ./UserConfig, but it points at src/UserConfig.js — a JavaScript
// file with JSDoc, inside node_modules, which TypeScript will not read as a type
// source at the default `maxNodeModuleJsDepth: 0`. Raising that flag to reach it
// would pull the whole of Eleventy's source into the program for the sake of one
// parameter, so this states the contract instead.
//
// Same rule as types/untyped-modules.d.ts: only what is actually called, so an
// upstream signature change surfaces at the call site rather than being absorbed
// by an `any`. Anything Eleventy offers that this repo does not use is absent on
// purpose — add it here when a call site needs it.

declare module "@11ty/eleventy/UserConfig" {
  import type MarkdownIt from "markdown-it";

  import type { CollectionItem } from "../scripts/lib/eleventy.ts";

  /** What `addCollection`'s callback is handed. */
  interface CollectionApi {
    getAll(): CollectionItem[];
    getFilteredByGlob(glob: string | string[]): CollectionItem[];
    getFilteredByTag(tag: string): CollectionItem[];
  }

  /** The `dir` config Eleventy resolved, as the `eleventy.after` event reports it. */
  interface EleventyDirectories {
    input: string;
    output: string;
    includes: string;
    layouts?: string;
    data: string;
  }

  interface AfterEvent {
    dir: EleventyDirectories;
  }

  /**
   * A custom template or data extension.
   *
   * `key` reuses one of Eleventy's own engines rather than defining a new one;
   * `read: false` hands the parser a PATH instead of the file's contents.
   */
  interface ExtensionOptions {
    key?: string;
    read?: boolean;
    parser?: (file: string) => unknown;
    compile?: (contents: string, path: string) => unknown;
  }

  class UserConfig {
    /** Registered under a template-engine name, e.g. "md". */
    setLibrary(name: string, library: MarkdownIt): void;
    setLiquidOptions(options: Record<string, unknown>): void;

    addPlugin(plugin: unknown, options?: unknown): void;

    addTemplateFormats(formats: string | string[]): void;
    addExtension(extension: string | string[], options: ExtensionOptions): void;
    addDataExtension(
      extensions: string,
      options: ExtensionOptions | ((contents: string, path: string) => unknown),
    ): void;

    addGlobalData(name: string, value: unknown): void;
    // Deliberately `unknown[]`/`unknown` rather than generics: a Liquid filter is
    // called from a template, where nothing is checked anyway, so a precise
    // signature here would be a claim about the call site that cannot be enforced.
    addFilter(name: string, callback: (...args: never[]) => unknown): void;
    addCollection(name: string, callback: (api: CollectionApi) => unknown): void;

    /** `{ from: to }` — the form every call in this repo uses. */
    addPassthroughCopy(paths: Record<string, string>): void;

    /** Globs excluded from the build. A live Set, mutated in place. */
    ignores: Set<string>;

    /** A path to rebuild on, beyond the templates Eleventy already watches. */
    addWatchTarget(target: string): void;

    on(event: "eleventy.after", handler: (event: AfterEvent) => void): void;
    on(event: "eleventy.before", handler: (event: AfterEvent) => void): void;
    /** Fires before each rebuild under --serve/--watch, with the changed files. */
    on(event: "eleventy.beforeWatch", handler: (changed: string[]) => void): void;
  }

  export default UserConfig;
}

declare module "@11ty/eleventy-plugin-syntaxhighlight" {
  /** Registered through `addPlugin`; this repo passes no options. */
  const plugin: unknown;

  export default plugin;
}
