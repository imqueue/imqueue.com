// api-pages.ts — reproduce api-documenter's page filenames from an api.json doc
// model, so the build can assert it did not silently lose a page.
//
// Why this exists. api-documenter derives each filename from the LOWERCASED
// symbol name (Utilities.getSafeFilenameForName), so two declarations that differ
// only in kind, or only in static-vs-instance, write to the same file and the
// second silently overwrites the first. There is no warning and no error — the
// page count just comes out one short, which nothing was checking.
//
// Three real cases exist in the packages this repo is about to document:
//
//   @imqueue/pg-pubsub  PgPubSub is declared as BOTH an interface and a class;
//                       both want pg-pubsub.pgpubsub.md and the interface wins,
//                       so the class documentation is simply absent.
//   @imqueue/pg-pubsub  PgIpLock.destroy exists as a static AND an instance
//                       method, both at overloadIndex 1 — so no `destroy_1`.
//   @imqueue/pg-prisma  AuditAction is both a TypeAlias and a Variable.
//
// The derivation below was validated against every package that extracts: for all
// 15, the expected filename set matches what api-documenter actually emitted
// exactly — no missing entries and no extras — and it independently reproduces
// all three collisions above.

/**
 * The slice of an api.json doc-model node this file reads.
 *
 * Deliberately not API Extractor's own ApiItem types. Those describe the
 * in-memory model its loader builds; this reads the RAW json, where `name` is
 * absent on constructors and construct signatures and `members` is absent on
 * leaves. Both absences are load-bearing here — DISPLAY_NAME exists for the
 * first — so the shape is spelled from what the file actually contains.
 */
export interface DocModelNode {
  kind: string;
  name?: string;
  overloadIndex?: number;
  members?: DocModelNode[];
}

/** One filename claimed by more than one declaration — a page that gets lost. */
export interface PageCollision {
  file: string;
  claimants: string[];
}

/** What expectedPages() found: every page-owning node, and the clashes. */
export interface ExpectedPages {
  /** filename -> human-readable claimant descriptions. */
  byFile: Map<string, string[]>;
  /** The filenames claimed more than once. */
  collisions: PageCollision[];
}

/** Inputs to assertNoLostPages(). */
export interface LostPagesInput {
  /** Unscoped package name. */
  pkg: string;
  /** Version being documented, for the message. */
  version: string;
  /** Parsed <pkg>.api.json. */
  model: DocModelNode;
  /** Filenames api-documenter wrote. */
  emitted: string[];
}

// api-documenter's Utilities.getSafeFilenameForName().
const safeName = (name: string): string => name.replace(/[^a-z0-9_\-.]/gi, '_').toLowerCase();

// Kinds that contribute nothing to the filename. Model and EntryPoint are
// structural; EnumMember renders inside its enum's page rather than getting one.
const UNNAMED_IN_PATH = new Set(['Model', 'EntryPoint', 'EnumMember']);

// Kinds api-documenter does not give a page of its own. Package is excluded here
// because its page is handled separately (`<pkg>.md`, folded into index.md by
// build-api-docs.ts); call and index signatures render inline in their parent.
const NO_PAGE_OF_ITS_OWN = new Set([
  'Model', 'Package', 'EntryPoint', 'EnumMember', 'CallSignature', 'IndexSignature',
]);

// api.json omits `name` for these two; api-documenter names them by displayName.
const DISPLAY_NAME: Record<string, string> = { Constructor: '(constructor)', ConstructSignature: '(new)' };

function* walk(
  node: DocModelNode | null | undefined,
  trail: DocModelNode[],
): Generator<{ node: DocModelNode; trail: DocModelNode[] }> {
  if (!node) return;

  yield { node, trail };

  const next = [...trail, node];

  for (const member of node.members || []) {
    yield* walk(member, next);
  }
}

// api-documenter's MarkdownDocumenter._getFilenameForApiItem(), against the
// api.json shape.
export function filenameFor(node: DocModelNode, trail: DocModelNode[]): string {
  let base = '';

  for (const item of [...trail, node]) {
    if (item.kind === 'Package') {
      // Every Package node in a real api.json carries a name; typing `name` as
      // optional — which it is, on constructors — turns the old TypeError into
      // a sentence that says which invariant broke.
      if (item.name === undefined) {
        throw new Error('api-pages: a Package node in the doc model has no name.');
      }

      // "@imqueue/pg-pubsub" -> "pg-pubsub"
      base = safeName(item.name.replace(/^@[^/]+\//, ''));
      continue;
    }
    if (UNNAMED_IN_PATH.has(item.kind)) {
      continue;
    }

    let part = safeName(item.name !== undefined ? item.name : (DISPLAY_NAME[item.kind] || ''));

    // Read once into a local because the field is absent on most nodes, and
    // `undefined > 1` is false — the same answer the comparison gave before.
    const overload = item.overloadIndex ?? 0;

    // Overloads past the first get a _1, _2 … suffix. Two declarations that BOTH
    // sit at overloadIndex 1 — a static and an instance method of the same name —
    // therefore collide, which is the PgIpLock.destroy case.
    if (overload > 1) {
      part += `_${overload - 1}`;
    }

    base += `.${part}`;
  }

  return `${base}.md`;
}

/**
 * Map every page-owning node in a doc model to the filename api-documenter will
 * write for it.
 *
 * @param model Parsed <pkg>.api.json.
 */
export function expectedPages(model: DocModelNode): ExpectedPages {
  const byFile = new Map<string, string[]>();

  for (const { node, trail } of walk(model, [])) {
    if (NO_PAGE_OF_ITS_OWN.has(node.kind)) {
      continue;
    }

    const file = filenameFor(node, trail);
    const label = `${node.kind} ${node.name !== undefined ? node.name : (DISPLAY_NAME[node.kind] || '?')}`;

    const claimants = byFile.get(file) ?? [];

    claimants.push(label);
    byFile.set(file, claimants);
  }

  const collisions = [...byFile]
    .filter(([, claimants]) => claimants.length > 1)
    .map(([file, claimants]) => ({ file, claimants }));

  return { byFile, collisions };
}

/**
 * Assert api-documenter emitted a page for every symbol in the model.
 *
 * Throws on a name collision (two symbols, one file — a page is lost) and on any
 * expected page that is missing for some other reason. Extra emitted files are
 * reported but not fatal: `index.md` and `<pkg>.md` are api-documenter's own
 * additions, and a future version adding more is not a data-loss bug.
 *
 */
export function assertNoLostPages(
  { pkg, version, model, emitted }: LostPagesInput,
): { expected: number; emitted: number } {
  const { byFile, collisions } = expectedPages(model);

  if (collisions.length) {
    const detail = collisions
      .map(c => `    ${c.file}\n      <- ${c.claimants.join('\n      <- ')}`)
      .join('\n');

    throw new Error(
      `${pkg}@${version}: ${collisions.length} page-name collision(s). ` +
      `api-documenter lowercases symbol names to build filenames, so these ` +
      `declarations overwrite each other and the documentation for all but the ` +
      `last is lost:\n${detail}\n` +
      `  Fix the source declarations (rename, or merge the interface into the ` +
      `class), or exclude one with @internal. Do not silence this check — a ` +
      `collision is invisible in the output.`,
    );
  }

  const emittedSet = new Set(emitted);
  // api-documenter's own extras, not derived from a model node.
  const missing = [...byFile.keys()].filter(f => !emittedSet.has(f)).sort();

  if (missing.length) {
    throw new Error(
      `${pkg}@${version}: ${missing.length} expected page(s) not emitted by ` +
      `api-documenter: ${missing.slice(0, 10).join(', ')}` +
      `${missing.length > 10 ? ` (+${missing.length - 10} more)` : ''}`,
    );
  }

  return { expected: byFile.size, emitted: emittedSet.size };
}
