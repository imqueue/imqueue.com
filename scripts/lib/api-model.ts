// api-model.ts — normalise an api-extractor doc model into a shape
// api-documenter can represent without losing pages.
//
// api-documenter derives every filename from the lowercased symbol name, so two
// declarations that differ only in kind, or only in static-vs-instance, write to
// the same file and the second silently wins. scripts/lib/api-pages.ts detects
// that; this file fixes the two cases that are fixable here, so a legitimate
// TypeScript pattern does not require a source change in the package.
//
// Both transformations are logged. Nothing here may run silently: a reader
// landing on a merged page needs the build log to explain why the page looks the
// way it does.
//
// --- 1. declaration merging (class + interface, same name) -----------------
//
// Giving an EventEmitter subclass typed `on`/`once` overloads by declaring an
// interface alongside the class is idiomatic TypeScript — the compiler merges
// them into one type. @imqueue/pg-pubsub does exactly this: `class PgPubSub`
// carries the real API (connect, listen, notify, close, destroy…) and
// `interface PgPubSub` adds one typed `on`/`once` overload per event.
//
// api-documenter has no concept of the merge. It wrote both to
// pg-pubsub.pgpubsub.md and the interface won, so the page for the package's main
// class read `export declare interface PgPubSub` and listed only event handlers.
// The 17 class-member pages were still written but appeared in no member table —
// published, unlinked, and `sitemap: false`, i.e. effectively invisible.
//
// Folding the interface's members into the class is what TypeScript itself does,
// so the page ends up describing the type the user actually has. Member filenames
// are unaffected: they derive from the parent's NAME, which is identical.
//
// --- 2. same-name siblings (static + instance) ------------------------------
//
// PgIpLock declares both `static destroy()` (destroys every instance) and
// `destroy()` (destroys this one). Both are overloadIndex 1, so both want
// pg-pubsub.pgiplock.destroy.md — and the static won, losing the instance method
// that callers actually use.
//
// api-documenter's own convention for several declarations of one name is the
// `_N` filename suffix, taken from overloadIndex. Assigning the colliding
// siblings distinct indices puts them on distinct pages through that existing
// mechanism rather than a new one. The INSTANCE member is left at the lower index
// so it keeps the unsuffixed URL — it is the common case, and for pg-pubsub it is
// also the one that is currently being lost.
//
// This lever only works where api-documenter honours overloadIndex, which is
// ApiParameterListMixin — methods, functions, constructors and signatures. A
// TypeAlias colliding with a Variable has NO filename lever at all. Where the two
// are one thing declared twice, (4) folds them; where they are genuinely unrelated
// there is nothing to be done here, so it is reported and left for api-pages.ts to
// fail on: the remedy is a source change or an @internal, and pretending otherwise
// would ship a lost page.
//
// --- 3. ambient-collision renames (`Response_2`) ----------------------------
//
// Do not confuse this with (2). There the NAME stays clean and api-documenter
// appends `_N` to the FILENAME from overloadIndex. Here api-extractor has put the
// suffix into the symbol's own `name`, because the name collided with a
// declaration outside the package — so it reaches the page title, the URL and
// every cross-reference, and readers see a symbol the package does not export.
//
// @imqueue/http-protect exports `interface Response`, which collides with the
// global `Response` from @types/node/web-globals/fetch.d.ts; @imqueue/pg-cache
// exports `ClassDecorator`, which collides with TypeScript's own global. The
// second is already published as pg-cache.classdecorator_2, titled
// `ClassDecorator_2 type`.
//
// The two families are told apart by whether a sibling holds the base name:
//
//   overload / sibling suffix   `on_1` … `on_9`   `on` IS present   -> keep
//   ambient collision           `Response_2`      `Response` is NOT -> strip
//
// So a `_N` name whose base is unclaimed is an artifact of a collision with
// something that is not in this package, and stripping it restores the name the
// package actually exports. Where the base IS claimed — including by another
// `_N` sibling that would strip to the same base — nothing is touched, because
// then the suffix is carrying real information.
//
// Renaming means rewriting canonicalReference too, in four places: the item's
// own, each of its members', and every excerptTokens entry that points at it.
// api-documenter resolves signature links through those references, so changing
// `name` alone turns a working cross-reference into plain text with no link and
// no warning.
//
// --- 4. const object + its derived union type (`AuditAction`) ----------------
//
// The standard TypeScript way to get an enum without `enum` is to declare a frozen
// object and derive a union from its values:
//
//   export const AuditAction = { INSERT: 'INSERT', … } as const;
//   export type  AuditAction = (typeof AuditAction)[keyof typeof AuditAction];
//
// That is ONE concept the language requires you to declare twice, once in value
// space and once in type space — which is why both declarations are public and why
// neither can be renamed or marked @internal without breaking consumers.
// @imqueue/pg-prisma does this at src/audit.ts:27+32 and it is the last thing
// standing between that package and a published reference.
//
// It reaches api-documenter as a TypeAlias and a Variable of the same name, both
// wanting pg-prisma.auditaction.md, and (2) has no lever for either kind. So this
// folds them onto one page instead: the Variable survives and the alias's
// declaration is appended to its signature, giving a page that shows both lines
// exactly as the source writes them.
//
// The discriminator is exact rather than a guess — the alias must carry a Reference
// token pointing at the variable's own canonicalReference, which is what
// `typeof AuditAction` compiles to in the model. A TypeAlias and a Variable that
// merely happen to share a name are two different things and are NOT folded; they
// keep the (2) report and the api-pages.ts failure, because putting two unrelated
// symbols on one page would be a worse lie than failing.
//
// The Variable is the survivor, not the alias, for a mechanical reason: the alias's
// excerpt reads `export type X = (typeof X)[keyof typeof X];`, a complete statement
// that appends cleanly, whereas the variable's reads `X: { … }`, which is not. It
// also keeps the alias's Reference tokens resolvable — they point at the variable,
// which is now the page itself.
//
// One cost, stated because it is invisible in the output: the package page lists
// the symbol under "Variables" only, since the row under "Type Aliases" came from
// the node that was folded away. The page it links to documents both declarations.
//
// --- 5. phantom parameters from a destructured argument ---------------------
//
// `export function f({ a, b }: Options)` produces TWO parameters in the model, not
// one:
//
//   { parameterName: '{ a, b }', parameterTypeTokenRange: { start: 0, end: 0 } }
//   { parameterName: 'input',    parameterTypeTokenRange: { start: 1, end: 2 } }
//
// The first is the binding pattern carrying no type; the second is api-extractor's
// own normalisation of it, and the one the signature excerpt shows. api-documenter
// renders both, so the page gets a parameter row the function does not have, typed
// "(not declared)".
//
// Already published on two archived core pages (core.logdebuginfo at 1.15.0 and
// 2.0.26), and @imqueue/pg-prisma destructures in four exported functions, so it
// would have shipped four more. No `@param` can document the phantom either: its
// name is not an identifier, so a tag naming it is dropped with no warning.
//
// Dropping it is safe precisely because the real entry is always alongside. The
// discriminator needs BOTH a binding-pattern name (`{` or `[`) and an empty type
// range, and the parameter is left alone unless a typed sibling exists to take its
// place — so a model shaped some other way is never silently reduced. Nothing is
// renamed, so no URL moves.
//
// One consequence for whoever writes the doc-blocks: the parameter's documentable
// name is `input`, not the source's binding pattern. That is api-extractor's
// placeholder and it matches the signature the page renders.

import { expectedPages } from './api-pages.ts';

/** One excerpt token of a declaration's rendered signature. */
export interface ExcerptToken {
  kind: string;
  text?: string;
  canonicalReference?: string;
}

/** One parameter entry of a parameter-bearing declaration. */
export interface ApiParameter {
  parameterName?: string;
  parameterTypeTokenRange?: { startIndex: number; endIndex: number };
}

/**
 * A node of a parsed <pkg>.api.json, as this file needs to read AND WRITE it.
 *
 * Wider than api-pages.ts's DocModelNode, which reads only enough to derive a
 * filename. Every field past `kind` is optional because api.json puts a dozen
 * declaration shapes in one members array — a Variable carries excerptTokens and
 * no parameters, a Method the reverse — and the transforms below are written to
 * TEST for each field rather than to assume a kind.
 */
export interface ApiNode {
  kind: string;
  name?: string;
  overloadIndex?: number;
  members?: ApiNode[];
  docComment?: string;
  canonicalReference?: string;
  excerptTokens?: ExcerptToken[];
  parameters?: ApiParameter[];
  isStatic?: boolean;
  isProtected?: boolean;
  isAbstract?: boolean;
}

/** A symbol whose name this file changed, so the caller can 301 the old URL. */
export interface Rename {
  from: string;
  to: string;
  kind: string;
}

/** What normalizeModel() did, and what it could not do. */
export interface NormalizeResult {
  /**
   * A human-readable line per change made, plus any collision it could not fix;
   * empty when the model needed nothing.
   */
  notes: string[];
  /** The subset of changes that moved a symbol's name. */
  renames: Rename[];
}

// api-documenter appends `_<overloadIndex - 1>` only for ApiParameterListMixin.
const HAS_OVERLOAD_INDEX = new Set([
  'Constructor', 'ConstructSignature', 'Function', 'Method', 'MethodSignature',
  'CallSignature', 'IndexSignature',
]);

const safeName = (name: unknown): string => String(name).replace(/[^a-z0-9_\-.]/gi, '_').toLowerCase();

// Interface member kinds have no meaning inside a class: api-documenter groups a
// class's members by Constructor/Method/Property and never looks for a
// MethodSignature, so a folded-in member would be written into no member table and
// given no page. It has to be restated as the class-member kind, which is exactly
// what TypeScript's merge means — the interface declares instance members of the
// class. The extra fields are the ones ApiMethod/ApiProperty carry and their
// signature counterparts do not.
const AS_CLASS_MEMBER: Record<string, string | undefined> = {
  MethodSignature: 'Method',
  PropertySignature: 'Property',
};

function* containers(node: ApiNode | null | undefined): Generator<ApiNode> {
  if (!node) return;

  if (node.members && node.members.length) {
    yield node;
  }
  for (const member of node.members || []) {
    yield* containers(member);
  }
}

// Fold `interface X` into `class X` wherever both are declared in one container.
function mergeDeclarationMerges(model: ApiNode, notes: string[]): void {
  for (const parent of [...containers(model)]) {
    const byName = new Map<string, ApiNode[]>();

    for (const member of parent.members ?? []) {
      if (!['Class', 'Interface'].includes(member.kind) || member.name === undefined) {
        continue;
      }

      const group = byName.get(member.name) ?? [];

      group.push(member);
      byName.set(member.name, group);
    }

    for (const [name, decls] of byName) {
      const klass = decls.find(d => d.kind === 'Class');
      const iface = decls.find(d => d.kind === 'Interface');

      if (!klass || !iface || decls.length !== 2) {
        continue; // not the merge pattern — leave it for the assertion
      }

      const moved: ApiNode[] = [];
      const unmappable: string[] = [];

      for (const member of iface.members || []) {
        const asClassKind = AS_CLASS_MEMBER[member.kind];

        if (!asClassKind) {
          // Construct/call/index signatures have no class-member equivalent. Do
          // not drop them quietly — a lost page is the whole point of this file.
          unmappable.push(member.kind);
          continue;
        }
        member.kind = asClassKind;
        // The three fields ApiMethod/ApiProperty carry that their signature
        // counterparts do not. Written out rather than iterated over a defaults
        // object, which is what lets ApiNode stay a closed shape instead of
        // needing a string index signature to satisfy `member[field] = value`.
        if (member.isStatic === undefined) { member.isStatic = false; }
        if (member.isProtected === undefined) { member.isProtected = false; }
        if (member.isAbstract === undefined) { member.isAbstract = false; }
        moved.push(member);
      }

      if (unmappable.length) {
        notes.push(
          `CANNOT fold ${unmappable.length} member(s) of interface ${name} into ` +
          `class ${name}: ${[...new Set(unmappable)].join(', ')} have no ` +
          'class-member equivalent. Those declarations will not be documented.',
        );
      }

      klass.members = [...(klass.members || []), ...moved];

      // Keep the class's own prose; inherit the interface's only if the class has
      // none, so a documented interface beside a bare class is not thrown away.
      if (!String(klass.docComment || '').trim() && String(iface.docComment || '').trim()) {
        klass.docComment = iface.docComment;
      }

      parent.members = (parent.members ?? []).filter(m => m !== iface);
      notes.push(
        `merged declaration-merged interface ${name} into class ${name} ` +
        `(+${moved.length} member(s) — TypeScript merges these into one type, ` +
        `api-documenter would have dropped the class page)`,
      );
    }
  }
}

// Is this TypeAlias derived from that Variable? True only when the alias names the
// variable itself, which is what `typeof <name>` leaves in the model — so a
// same-named pair that has nothing to do with each other is not matched.
function aliasDerivesFrom(alias: ApiNode, variable: ApiNode): boolean {
  return (alias.excerptTokens || []).some(
    token => token.kind === 'Reference'
      && token.canonicalReference === variable.canonicalReference,
  );
}

// Point every canonicalReference at `toRef` that currently names `fromRef`,
// including references to its members (`…!X:type#member`). Used when a node is
// folded away: a reference left naming the removed node resolves to nothing, and
// api-documenter renders that as unlinked plain text without warning.
function retargetReferences(node: unknown, fromRef: string, toRef: string): number {
  let rewritten = 0;

  const visit = (item: unknown): void => {
    if (Array.isArray(item)) {
      item.forEach(visit);

      return;
    }
    if (!item || typeof item !== 'object') return;

    // The walk is over an arbitrary json graph, not over ApiNode: it descends
    // into excerpt tokens, parameter entries and reference objects alike. A
    // string-keyed record is what that actually is.
    const record = item as Record<string, unknown>;
    const ref = record.canonicalReference;

    if (typeof ref === 'string' && (ref === fromRef || ref.startsWith(`${fromRef}#`))) {
      record.canonicalReference = toRef + ref.slice(fromRef.length);
      rewritten++;
    }
    for (const value of Object.values(record)) {
      if (value && typeof value === 'object') visit(value);
    }
  };

  visit(node);

  return rewritten;
}

// Fold `type X = (typeof X)[keyof typeof X]` into `const X`, so the pair the
// language forces you to declare twice occupies one page instead of losing one.
function foldDerivedUnionTypes(model: ApiNode, notes: string[]): void {
  for (const parent of [...containers(model)]) {
    const byName = new Map<string, ApiNode[]>();

    for (const member of parent.members ?? []) {
      if (member.name === undefined) continue;
      if (!['TypeAlias', 'Variable'].includes(member.kind)) continue;

      const group = byName.get(member.name) ?? [];

      group.push(member);
      byName.set(member.name, group);
    }

    for (const [name, decls] of byName) {
      if (decls.length !== 2) continue;

      const alias = decls.find(d => d.kind === 'TypeAlias');
      const variable = decls.find(d => d.kind === 'Variable');

      if (!alias || !variable) continue;

      const from = alias.canonicalReference;
      const to = variable.canonicalReference;

      // Both are present on every real declaration. The guard is here rather
      // than at the retarget below because aliasDerivesFrom compares the two
      // references with ===, so a pair that BOTH lack one would match on
      // `undefined === undefined` and fold two unrelated declarations together.
      if (from === undefined || to === undefined) continue;

      if (!aliasDerivesFrom(alias, variable)) {
        continue; // same name, unrelated declarations — not ours to merge
      }

      // Append the alias's own tokens rather than a reconstructed type: the page
      // then shows the two declarations the source actually has, references and all.
      variable.excerptTokens = [
        ...(variable.excerptTokens || []),
        { kind: 'Content', text: '\n\n' },
        ...(alias.excerptTokens || []).map(token => ({ ...token })),
      ];

      // Same rule as (1): keep the survivor's prose, inherit the folded node's only
      // when the survivor has none, so a documented alias is not thrown away.
      if (!String(variable.docComment || '').trim() && String(alias.docComment || '').trim()) {
        variable.docComment = alias.docComment;
      }

      parent.members = (parent.members ?? []).filter(m => m !== alias);

      const refs = retargetReferences(model, from, to);

      notes.push(
        `folded type ${name} into const ${name} and retargeted ${refs} canonical ` +
        'reference(s): the alias is derived from the const, so the two are one ' +
        'concept TypeScript makes you declare twice — both declarations are now on ' +
        `the ${safeName(name)} page, which the package page lists under Variables`,
      );
    }
  }
}

const BINDING_PATTERN = /^[{[]/;

// Is this a binding-pattern parameter entry with no type — i.e. the phantom half
// of a destructured argument rather than a parameter the function really has?
function isPhantomParameter(parameter: ApiParameter): boolean {
  const range = parameter.parameterTypeTokenRange;

  return BINDING_PATTERN.test(parameter.parameterName || '')
    && (!range || range.startIndex === range.endIndex);
}

// Drop the phantom parameter api-extractor emits beside a destructured argument.
function dropPhantomParameters(model: ApiNode, notes: string[]): void {
  const visit = (item: unknown): void => {
    if (Array.isArray(item)) {
      item.forEach(visit);

      return;
    }
    if (!item || typeof item !== 'object') return;

    const record = item as Record<string, unknown>;
    const parameters = record.parameters as ApiParameter[] | undefined;

    if (Array.isArray(parameters) && parameters.length > 1) {
      const phantoms = parameters.filter(isPhantomParameter);
      const real = parameters.filter(p => !isPhantomParameter(p));

      // Only when something typed survives — never reduce a signature to nothing.
      if (phantoms.length && real.length) {
        record.parameters = real;
        for (const phantom of phantoms) {
          notes.push(
            `dropped phantom parameter "${phantom.parameterName}" from ` +
            `${String(record.kind)} ${record.name ?? '(constructor)'}: api-extractor emits the ` +
            'binding pattern of a destructured argument as an untyped parameter ' +
            `beside the real one (now "${real.map(p => p.parameterName).join(', ')}"), ` +
            'and api-documenter would render it as a row typed "(not declared)"',
          );
        }
      }
    }
    for (const value of Object.values(record)) {
      if (value && typeof value === 'object') visit(value);
    }
  };

  visit(model);
}

// Give same-filename siblings distinct overloadIndex values where the filename
// derivation honours them.
function disambiguateSiblings(model: ApiNode, notes: string[]): void {
  for (const parent of containers(model)) {
    // Group siblings by the filename component their name produces.
    const byName = new Map<string, ApiNode[]>();

    for (const member of parent.members ?? []) {
      const key = safeName(member.name !== undefined ? member.name
        : member.kind === 'Constructor' ? '(constructor)'
        : member.kind === 'ConstructSignature' ? '(new)' : '');

      const group = byName.get(key) ?? [];

      group.push(member);
      byName.set(key, group);
    }

    for (const [key, group] of byName) {
      if (group.length < 2) continue;

      // Only those sharing an index actually collide; genuine overloads already
      // differ. Compare on the emitted suffix, not the raw index.
      const bySuffix = new Map<number, ApiNode[]>();
      // The suffix api-documenter emits for a declaration: 0 for the first, and
      // `overloadIndex - 1` past that. Absent on kinds that carry no parameter
      // list, where `undefined > 1` was already false.
      const suffixOf = (m: ApiNode): number =>
        (m.overloadIndex ?? 0) > 1 ? (m.overloadIndex ?? 0) - 1 : 0;

      for (const member of group) {
        const suffix = suffixOf(member);
        const clash = bySuffix.get(suffix) ?? [];

        clash.push(member);
        bySuffix.set(suffix, clash);
      }

      const used = new Set(group.map(suffixOf));

      for (const clashing of bySuffix.values()) {
        if (clashing.length < 2) continue;

        // Only the parameter-bearing declarations can be moved. That is enough
        // as long as at most one of the clashing declarations cannot: the
        // immovable one keeps the unsuffixed page and the rest step aside. The
        // Class + Function pair a package writes when it adds a factory
        // alongside a class — `ImqueueInstrumentation` and
        // `imqueueInstrumentation()` — is exactly that shape, and the class
        // keeping its URL is what stops an existing link from moving.
        const immovable = clashing.filter(m => !HAS_OVERLOAD_INDEX.has(m.kind));

        if (immovable.length > 1) {
          notes.push(
            `CANNOT disambiguate ${key}: ${clashing.map(m => m.kind).join(' + ')} — ` +
            'api-documenter only suffixes filenames for parameter-bearing members, ' +
            `and ${immovable.length} of these are not, so there is no lever here. ` +
            'Rename one declaration or mark it @internal.',
          );
          continue;
        }

        // What cannot move goes first; then instance before static, so the
        // instance keeps the unsuffixed URL.
        const ordered = [...clashing].sort((a, b) =>
          Number(HAS_OVERLOAD_INDEX.has(a.kind)) - Number(HAS_OVERLOAD_INDEX.has(b.kind)) ||
          Number(!!a.isStatic) - Number(!!b.isStatic));
        const describe = (m: ApiNode): string => (HAS_OVERLOAD_INDEX.has(m.kind) && m.isStatic !== undefined
          ? `${m.isStatic ? 'static' : 'instance'} ${m.kind}`
          : m.kind);

        // The one that keeps the unsuffixed page, and the ones stepping aside.
        // Destructured rather than indexed so `keeper` is a value the compiler
        // knows exists — `ordered` has at least two entries here by construction.
        const [keeper, ...stepAside] = ordered;

        if (!keeper) continue;

        for (const member of stepAside) {
          let suffix = 1;
          while (used.has(suffix)) suffix++;
          used.add(suffix);
          member.overloadIndex = suffix + 1;
          notes.push(
            `disambiguated ${key} (${describe(member)}) -> ${key}_${suffix}, ` +
            `so it stops overwriting the ${describe(keeper)} declaration`,
          );
        }
      }
    }
  }
}

const SUFFIXED_NAME = /^(.+)_(\d+)$/;

// Rewrite every canonicalReference that names `from` so it names `to`. The
// delimiter lookahead is what keeps `Response_2` from also matching a distinct
// `Response_20`, and what stops a package whose name happens to end in the same
// text being rewritten.
function renameInReferences(node: unknown, from: string, to: string): number {
  const pattern = new RegExp(
    `(!)${from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=[:#])`,
    'g',
  );
  let rewritten = 0;

  const visit = (item: unknown): void => {
    if (Array.isArray(item)) {
      item.forEach(visit);

      return;
    }
    if (!item || typeof item !== 'object') return;

    const record = item as Record<string, unknown>;
    const ref = record.canonicalReference;

    if (typeof ref === 'string') {
      const next = ref.replace(pattern, `$1${to}`);

      if (next !== ref) {
        record.canonicalReference = next;
        rewritten++;
      }
    }
    for (const value of Object.values(record)) {
      if (value && typeof value === 'object') visit(value);
    }
  };

  visit(node);

  return rewritten;
}

// Strip api-extractor's `_N` suffix where it records a collision with something
// outside the package rather than a second declaration inside it.
function stripAmbientCollisionSuffixes(
  model: ApiNode,
  notes: string[],
  renames: Rename[],
): void {
  for (const parent of containers(model)) {
    const members = parent.members ?? [];
    const taken = new Set(
      members.map(m => m.name).filter((n): n is string => n !== undefined),
    );

    // How many siblings would strip to each base name? More than one means the
    // suffix is load-bearing and none of them may be touched.
    const wantedBase = new Map<string, number>();

    for (const member of members) {
      const match = SUFFIXED_NAME.exec(member.name ?? '');

      if (!match) continue;

      const stem = match[1] ?? '';

      wantedBase.set(stem, (wantedBase.get(stem) || 0) + 1);
    }

    for (const member of members) {
      const match = SUFFIXED_NAME.exec(member.name ?? '');

      if (!match) continue;

      const base = match[1] ?? '';
      const wanted = wantedBase.get(base) ?? 0;

      if (taken.has(base)) {
        continue; // a real sibling owns the base name — this is family 1
      }
      if (wanted > 1) {
        notes.push(
          `KEPT the suffix on ${member.name} (${member.kind}): ` +
          `${wanted} siblings would all become ${base}, so the ` +
          'suffix is distinguishing real declarations, not an artifact.',
        );
        continue;
      }

      // Non-empty by construction: the regex above needs at least one character
      // before the `_N`, so it cannot have matched an absent name.
      const suffixed = member.name ?? '';

      member.name = base;
      taken.delete(suffixed);
      taken.add(base);

      const refs = renameInReferences(model, suffixed, base);

      renames.push({ from: suffixed, to: base, kind: member.kind });
      notes.push(
        `renamed ${suffixed} -> ${base} (${member.kind}) and rewrote ${refs} ` +
        'canonical reference(s): the suffix recorded a collision with a ' +
        `declaration outside this package, and no sibling claims ${base}, so ` +
        'it was naming a symbol the package does not export',
      );
    }
  }
}

/**
 * Rewrite a doc model in place so api-documenter emits one page per symbol.
 *
 * @param model Parsed <pkg>.api.json.
 */
export function normalizeModel(model: ApiNode): NormalizeResult {
  const notes: string[] = [];
  const renames: Rename[] = [];

  mergeDeclarationMerges(model, notes);
  // Before (2), so a pair this fixes never also draws (2)'s "no lever here" report.
  foldDerivedUnionTypes(model, notes);
  dropPhantomParameters(model, notes);
  disambiguateSiblings(model, notes);
  // After (2), so a suffix this run assigned via overloadIndex is never mistaken
  // for one api-extractor baked into a name.
  stripAmbientCollisionSuffixes(model, notes, renames);

  // Report anything still colliding, so the caller can log it next to the notes
  // rather than only hitting the assertion later with no context.
  for (const { file, claimants } of expectedPages(model).collisions) {
    notes.push(`UNRESOLVED ${file} <- ${claimants.join(' | ')}`);
  }

  return { notes, renames };
}
