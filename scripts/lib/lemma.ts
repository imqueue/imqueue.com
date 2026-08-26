// Lemmatizer: surface form -> dictionary form, for the search index.
//
//   "queues" -> "queue"   "stated" -> "state"   "went" -> "go"   "mice" -> "mouse"
//
// WHY A DICTIONARY AND NOT RULES
//
// Suffix rules alone cannot tell `string` -> `str` from `stating` -> `state`, because
// both are "drop -ing, maybe restore an -e". A rule set patches that with a threshold
// — "don't strip if the stem is shorter than four characters" — and the threshold is
// fitted to the vocabulary you happened to look at. Measured on this corpus, adding
// that guard fixed five wrong merges and destroyed a right one: `use`/`used`/`using`
// stopped merging at all, and `pasting` -> `past` stayed wrong. Rules relocate errors
// rather than removing them, and every new page shifts where they land.
//
// A dictionary replaces the threshold with a question that has an answer: after
// detaching the suffix, IS THE RESULT A WORD? `str` is not, so `string` keeps its
// form. `state` is, so `stating` becomes it. That is the whole idea, and it is why
// this is worth 262 KB of vendored data (build-time only — see scripts/data/wordnet/).
//
// THE ORDERING THAT DOES MOST OF THE PRECISION WORK
//
// A form that is ITSELF a lemma is left alone, before exceptions are even consulted.
// Without that rule, `left` -> `leave` (it is in verb.exc), `saw` -> `see`, `being` ->
// `be` — a lemmatizer with no part-of-speech tagger cannot know which reading was
// meant, and in prose the noun/adjective reading is the common one. With it, those
// words stay themselves, and only forms that are not words in their own right —
// `went`, `queues`, `stated` — get rewritten. It also means `string`, `data` and
// `index` are safe by construction rather than by a rule I remembered to write.
//
// WHAT IT STILL CANNOT DO
//
// Genuine part-of-speech ambiguity where BOTH readings are inflections is unresolvable
// without a tagger, and technical vocabulary is missing from WordNet entirely —
// `namespace` is not in it. The second one is fixable and the fix is data:
// scripts/data/project-words.txt. `report()` below exists to find the words that
// belong in it, so the list grows from evidence rather than from guessing.
//
// Provenance and how to regenerate the vendored files: scripts/data/wordnet/README.md.

import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

/** The loaded lexicon, built once and reused for the process's lifetime. */
interface Lexicon {
  /** Every accepted lemma: WordNet's, plus this project's vocabulary. */
  lemmas: Set<string>;
  /** Just this project's, which also blocks rewriting — see lemmaOf. */
  project: Set<string>;
  /** `!`-prefixed entries: fragments that must never become a lemma. */
  ignored: Set<string>;
  /** Irregular surface form -> lemma. */
  exceptions: Map<string, string>;
  /** stem -> the word that produced it, for report(). Filled as lemmaOf runs. */
  rejected: Map<string, string>;
}

/** One candidate addition to project-words.txt. */
export interface MissingLemma {
  stem: string;
  sawAs: string;
}

const DATA = path.join(import.meta.dirname, "..", "data");

// Morphy's detachment rules. Order matters within each group: the longest suffix that
// applies wins, and each candidate is accepted only if it is a known lemma.
const DETACH: ReadonlyArray<readonly [string, string]> = [
  ["ches", "ch"], ["shes", "sh"], ["sses", "ss"], ["xes", "x"], ["zes", "z"],
  ["ies", "y"], ["ves", "f"], ["ves", "fe"],
  ["ing", ""], ["ing", "e"],
  ["ied", "y"], ["ed", ""], ["ed", "e"],
  ["es", ""], ["es", "e"], ["s", ""],
  ["men", "man"], ["ae", "a"], ["i", "us"],
];

// THE LINE THIS FILE DOES NOT CROSS
//
// Only INFLECTIONAL suffixes are here: -s, -es, -ies, -ed, -ing, and the irregular lists.
// They do not change part of speech, so "is the result a word?" is a sufficient test and
// the dictionary can answer it.
//
// DERIVATIONAL suffixes are absent, and three were tried before that was a rule rather than
// an omission. -er and -est gave `user -> use`, `server -> serve`, `broker -> broke`,
// `later -> lat`. -ly gave `reply -> rep`, `apply -> app`, `only -> on`, `fully -> ful`.
//
// Two attempts to rescue -ly failed in a way worth recording, because they close the door:
//
//   * A minimum stem length. At 4 it kept `apply -> apple` and `comply -> comp`; at 6 it
//     STILL kept `multiply -> multiple` and `supply -> supple`. Length is not the missing
//     information — both stems are real words and both transformations are legal spelling
//     rules.
//   * Refusing to touch a word that is itself a lemma. Every relevant word is one:
//     `commercially`, `silently` and `explicitly` are all WordNet adverb lemmas, exactly
//     like `supply` and `reply`. The check blocks the cases it should allow.
//
// What actually separates `commercially` from `supply` is that supply is not an adverb — a
// part of speech of the INPUT, which no lexicon carries and only a tagger could supply. So
// dictionary-based morphology genuinely cannot do derivation, and adding a fourth suffix
// will fail the same way.
//
// The consequence is handled elsewhere and deliberately: search.js falls back to a
// truncated-prefix match at MATCH time, where a wrong guess costs a little relevance
// instead of permanently merging two words in the index.

// -er and -est are DELIBERATELY ABSENT. In Morphy they belong to the adjective rules
// and are only reached when the part of speech is known; applied blind to nouns they
// destroy the most common vocabulary in this corpus:
//
//   user -> use      server -> serve     broker -> broke
//   later -> lat     logger -> log       worker -> work
//
// "broker" mattering here is not hypothetical — "the Redis broker" is on a dozen pages.
// The cost of leaving them out is that `faster` no longer reaches `fast`; comparatives
// are rare in reference documentation and worth nothing to a search over it. Irregular
// comparatives still work, because `better`/`worse` are in WordNet's exception lists.

// A doubled final consonant before -ed/-ing is spelling, not morphology:
// "deferring" -> "deferr" -> "defer", "running" -> "runn" -> "run".
const DOUBLED = /([bdfglmnprt])\1$/;

let cache: Lexicon | null = null;

function load(): Lexicon {
  if (cache) {
    return cache;
  }

  const lemmas = new Set(
    zlib.gunzipSync(fs.readFileSync(path.join(DATA, "wordnet", "lemmas.txt.gz")))
      .toString("utf8")
      .split("\n")
      .filter(Boolean)
  );

  // Project vocabulary WordNet does not have. Same status as a dictionary entry: a
  // word here is a valid lemma, so a detachment that produces it is accepted.
  const projectFile = path.join(DATA, "project-words.txt");

  const project = new Set<string>();
  // Entries prefixed with `!` are the opposite declaration: a fragment that looks like
  // a missing word but must never become a lemma. They are recorded so report() stops
  // suggesting them — which is what keeps that report quiet enough that a genuinely
  // new candidate is visible in it.
  const ignored = new Set<string>();

  if (fs.existsSync(projectFile)) {
    for (const line of fs.readFileSync(projectFile, "utf8").split("\n")) {
      const word = (line.split("#")[0] ?? "").trim().toLowerCase();

      if (!word) {
        continue;
      }
      if (word.startsWith("!")) {
        ignored.add(word.slice(1));
        continue;
      }
      lemmas.add(word);
      project.add(word);
    }
  }

  // Irregular forms. One surface form can appear under several parts of speech
  // ("saw" is in verb.exc); the first mapping wins, which matches Morphy's own order
  // of noun, verb, adjective, adverb.
  const exceptions = new Map<string, string>();

  for (const line of fs.readFileSync(path.join(DATA, "wordnet", "exceptions.txt"), "utf8").split("\n")) {
    const [, form, lemma] = line.split(" ");

    if (form && lemma && !exceptions.has(form)) {
      exceptions.set(form, lemma);
    }
  }

  cache = { lemmas, project, ignored, exceptions, rejected: new Map() };

  return cache;
}

/**
 * @param word A single lowercase token.
 * @returns Its lemma, or the word unchanged when nothing applies.
 */
export function lemmaOf(word: string): string {
  const { lemmas, project, exceptions, rejected } = load();

  if (word.length < 2) {
    return word;
  }
  // Our own vocabulary wins over the dictionary, in both directions: a word listed in
  // project-words.txt is a lemma AND is never rewritten. That second half is the
  // override channel, and it is needed — WordNet's noun exceptions map `data` to
  // `datum` and `media` to `medium`, which is correct Latin and wrong for a corpus
  // where "data" is a term of art.
  if (project.has(word)) {
    return word;
  }
  // Read once rather than has()-then-get(): the Map's own value type says the
  // second call could miss, and a `!` to deny it would be denying the only thing
  // that can go wrong here.
  const irregular = exceptions.get(word);

  if (irregular !== undefined) {
    return irregular;
  }

  for (const [suffix, replacement] of DETACH) {
    if (!word.endsWith(suffix) || word.length - suffix.length < 2) {
      continue;
    }

    const stem = word.slice(0, word.length - suffix.length) + replacement;

    if (lemmas.has(stem)) {
      return stem;
    }
    // "deferring" -> "deferr" is not a word, but "defer" is.
    if (DOUBLED.test(stem)) {
      const single = stem.slice(0, -1);

      if (lemmas.has(single)) {
        return single;
      }
    }
    // Nothing accepted this candidate. Remember it: if the same stem turns out to be
    // a word the CORPUS uses, it is missing project vocabulary, and report() surfaces
    // it. This is how scripts/data/project-words.txt gets maintained from evidence.
    if (stem.length >= 3 && !rejected.has(stem)) {
      rejected.set(stem, word);
    }
  }

  // Identity LAST, not first. Trying it first looked right — "a word that is already a
  // dictionary form should be left alone" — and it silently blocked the most common
  // merges in English prose, because WordNet lists `going`, `running`, `used`, `gone`,
  // `stated` and `coming` as nouns and adjectives in their own right. Ten of the
  // thirty-six test cases failed on exactly that.
  //
  // Running detachment first costs the opposite error, and it is the cheaper one:
  // `left` -> `leave` and `saw` -> `see`, because both are in the irregular lists and
  // nothing here knows which part of speech was meant. Those are rare in prose, the
  // merge is only ever worth 0.55 of a term at match time, and it carries no
  // highlight — while `used`/`using`/`use` failing to merge costs recall on every
  // page. `string`, `data`, `index` and `str` are unaffected either way: no
  // detachment produces a word from them, so they fall through to here.
  if (lemmas.has(word)) {
    return word;
  }

  return word;
}

/**
 * Candidate additions to project-words.txt: stems that a detachment produced, that
 * the dictionary rejected, but that the corpus itself uses as a word. Each one is an
 * inflection that failed to merge — `namespaces` not reaching `namespace`.
 *
 * @param corpusWords Every token the corpus contains.
 */
export function report(corpusWords: Set<string>): MissingLemma[] {
  const { rejected, ignored } = load();
  const missing: MissingLemma[] = [];

  for (const [stem, sawAs] of rejected) {
    if (!ignored.has(stem) && corpusWords.has(stem)) {
      missing.push({ stem, sawAs });
    }
  }

  return missing.sort((a, b) => a.stem.localeCompare(b.stem));
}
