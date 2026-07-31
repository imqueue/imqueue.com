// api-model.js — normalise an api-extractor doc model into a shape
// api-documenter can represent without losing pages.
//
// api-documenter derives every filename from the lowercased symbol name, so two
// declarations that differ only in kind, or only in static-vs-instance, write to
// the same file and the second silently wins. scripts/lib/api-pages.js detects
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
// TypeAlias colliding with a Variable (@imqueue/pg-prisma's AuditAction) has NO
// filename lever at all, so it is reported and left for api-pages.js to fail on:
// the remedy there is a source change or an @internal, and pretending otherwise
// would ship a lost page.

'use strict';

const { expectedPages } = require('./api-pages');

// api-documenter appends `_<overloadIndex - 1>` only for ApiParameterListMixin.
const HAS_OVERLOAD_INDEX = new Set([
  'Constructor', 'ConstructSignature', 'Function', 'Method', 'MethodSignature',
  'CallSignature', 'IndexSignature',
]);

const safeName = (name) => String(name).replace(/[^a-z0-9_\-.]/gi, '_').toLowerCase();

// Interface member kinds have no meaning inside a class: api-documenter groups a
// class's members by Constructor/Method/Property and never looks for a
// MethodSignature, so a folded-in member would be written into no member table and
// given no page. It has to be restated as the class-member kind, which is exactly
// what TypeScript's merge means — the interface declares instance members of the
// class. The extra fields are the ones ApiMethod/ApiProperty carry and their
// signature counterparts do not.
const AS_CLASS_MEMBER = {
  MethodSignature: 'Method',
  PropertySignature: 'Property',
};
const CLASS_MEMBER_DEFAULTS = { isStatic: false, isProtected: false, isAbstract: false };

function* containers(node) {
  if (!node) return;

  if (node.members && node.members.length) {
    yield node;
  }
  for (const member of node.members || []) {
    yield* containers(member);
  }
}

// Fold `interface X` into `class X` wherever both are declared in one container.
function mergeDeclarationMerges(model, notes) {
  for (const parent of [...containers(model)]) {
    const byName = new Map();

    for (const member of parent.members) {
      if (!['Class', 'Interface'].includes(member.kind) || member.name === undefined) {
        continue;
      }
      if (!byName.has(member.name)) byName.set(member.name, []);
      byName.get(member.name).push(member);
    }

    for (const [name, decls] of byName) {
      const klass = decls.find(d => d.kind === 'Class');
      const iface = decls.find(d => d.kind === 'Interface');

      if (!klass || !iface || decls.length !== 2) {
        continue; // not the merge pattern — leave it for the assertion
      }

      const moved = [];
      const unmappable = [];

      for (const member of iface.members || []) {
        const asClassKind = AS_CLASS_MEMBER[member.kind];

        if (!asClassKind) {
          // Construct/call/index signatures have no class-member equivalent. Do
          // not drop them quietly — a lost page is the whole point of this file.
          unmappable.push(member.kind);
          continue;
        }
        member.kind = asClassKind;
        for (const [field, value] of Object.entries(CLASS_MEMBER_DEFAULTS)) {
          if (member[field] === undefined) member[field] = value;
        }
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

      parent.members = parent.members.filter(m => m !== iface);
      notes.push(
        `merged declaration-merged interface ${name} into class ${name} ` +
        `(+${moved.length} member(s) — TypeScript merges these into one type, ` +
        `api-documenter would have dropped the class page)`,
      );
    }
  }
}

// Give same-filename siblings distinct overloadIndex values where the filename
// derivation honours them.
function disambiguateSiblings(model, notes) {
  for (const parent of containers(model)) {
    // Group siblings by the filename component their name produces.
    const byName = new Map();

    for (const member of parent.members) {
      const key = safeName(member.name !== undefined ? member.name
        : member.kind === 'Constructor' ? '(constructor)'
        : member.kind === 'ConstructSignature' ? '(new)' : '');

      if (!byName.has(key)) byName.set(key, []);
      byName.get(key).push(member);
    }

    for (const [key, group] of byName) {
      if (group.length < 2) continue;

      // Only those sharing an index actually collide; genuine overloads already
      // differ. Compare on the emitted suffix, not the raw index.
      const bySuffix = new Map();

      for (const member of group) {
        const suffix = member.overloadIndex > 1 ? member.overloadIndex - 1 : 0;

        if (!bySuffix.has(suffix)) bySuffix.set(suffix, []);
        bySuffix.get(suffix).push(member);
      }

      const used = new Set(group.map(m => (m.overloadIndex > 1 ? m.overloadIndex - 1 : 0)));

      for (const clashing of bySuffix.values()) {
        if (clashing.length < 2) continue;

        if (!clashing.every(m => HAS_OVERLOAD_INDEX.has(m.kind))) {
          notes.push(
            `CANNOT disambiguate ${key}: ${clashing.map(m => m.kind).join(' + ')} — ` +
            'api-documenter only suffixes filenames for parameter-bearing members, ' +
            'so there is no lever here. Rename one declaration or mark it @internal.',
          );
          continue;
        }

        // Instance before static, so the instance keeps the unsuffixed URL.
        const ordered = [...clashing].sort((a, b) => Number(!!a.isStatic) - Number(!!b.isStatic));

        for (const member of ordered.slice(1)) {
          let suffix = 1;
          while (used.has(suffix)) suffix++;
          used.add(suffix);
          member.overloadIndex = suffix + 1;
          notes.push(
            `disambiguated ${key} (${member.isStatic ? 'static' : 'instance'} ` +
            `${member.kind}) -> ${key}_${suffix}, so it stops overwriting the ` +
            `${ordered[0].isStatic ? 'static' : 'instance'} declaration`,
          );
        }
      }
    }
  }
}

/**
 * Rewrite a doc model in place so api-documenter emits one page per symbol.
 *
 * @param {object} model Parsed <pkg>.api.json.
 * @returns {string[]} Human-readable notes on every change made, plus any
 *   collision it could not fix. Empty when the model needed nothing.
 */
function normalizeModel(model) {
  const notes = [];

  mergeDeclarationMerges(model, notes);
  disambiguateSiblings(model, notes);

  // Report anything still colliding, so the caller can log it next to the notes
  // rather than only hitting the assertion later with no context.
  for (const { file, claimants } of expectedPages(model).collisions) {
    notes.push(`UNRESOLVED ${file} <- ${claimants.join(' | ')}`);
  }

  return notes;
}

module.exports = { normalizeModel };
