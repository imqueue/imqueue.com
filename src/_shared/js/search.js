/* Full-text search for imqueue.org.
 *
 * The corpus is two things with different query languages, and treating them as
 * one is the whole trap. ~85 prose pages are searched by concept ("retry a failed
 * call", "backpressure"); ~1,150 API symbol pages are searched by identifier
 * ("watcherCheckDelay", "RedisQueue.send"). Stemming helps the first and actively
 * breaks the second; prefix matching is essential for the second and produces
 * noise in the first. So there are two retrievers behind one input.
 *
 * Data comes from two files written by scripts/gen-search-index.js:
 *
 *   /search-index.json  every page, symbol and question-shaped section, no bodies.
 *                       Fetched when the dialog opens. Answers most queries alone.
 *   /search-text.json   the prose corpus at heading-section granularity.
 *                       Fetched in the background after the first query, and
 *                       results re-rank when it lands.
 *
 * Nothing is fetched on page load: the trigger is a plain button, and the dialog
 * markup is built on first open. A visitor who never searches pays for this file
 * and nothing else.
 *
 * The ranking rules are ported from the @imqueue MCP server's search_docs, which
 * was tuned against real failures. Two of them are load-bearing and easy to
 * "improve" back into bugs:
 *
 *  1. A field's contribution is CAPPED. Without that, a record whose summary
 *     happens to contain several query words outranks the record whose NAME is
 *     exactly the query. That regression has been shipped once already.
 *  2. Reference outranks the blog at equal score — except for a question, which
 *     an article usually answers better than a symbol page does.
 */
(function () {
  "use strict";

  var TIER1 = "/search-index.json";
  var TIER2 = "/search-text.json";
  // The OTHER edition's index, copied onto this origin at build time by
  // scripts/copy-peer-index.js. Same-origin on purpose — see that file.
  var PEER1 = "/search-peer-index.json";
  var PEER2 = "/search-peer-text.json";

  // THE SITE YOU ARE ON WINS. Every local result precedes every peer result — the peer
  // group renders last, and in a merged list local hits sort first.
  //
  // This replaces a 0.8 de-weight, which could not deliver it. A multiplier only shifts
  // scores, and com's pages are titled things like "@imqueue — commercial license &
  // support", so for the query "what is imqueue license" the whole COMMERCIAL group
  // outranked imqueue.org's own /license/ page on imqueue.org. De-weighting expresses a
  // preference; priority is a rule, and a rule needs to be enforced where the order is
  // decided rather than hoped for in the scores.
  //
  // The cost is real and accepted: on imqueue.org, "pricing" now shows org's licensing
  // material above imqueue.com/pricing/, even though org has no pricing page. The peer
  // group is still there, labelled, one glance below.

  // Groups, as written by the generator.
  var G_DOC = 0;
  var G_API = 1;
  var G_ANSWER = 2;

  // Whole-string evidence: the strongest signals there are, because they say the
  // record IS the thing asked for rather than that it mentions it.
  var W = {
    exact: 1000,      // the whole name/title IS the query
    bag: 900,         // every word of the query is in the title, in any order
    lastSeg: 700,     // "send" for RedisQueue.send
    prefix: 500,
    squashed: 450,    // "backpressure" vs "Back-pressure" — real, weaker evidence
    substring: 320,
  };

  // A verbatim occurrence of the whole query is worth a quarter of the element it
  // occurs in. Proportional, not a flat bonus: a flat +90 was added to the BODY only,
  // which pushed a body match (120 + 90) above an emphasis match (200) and inverted
  // two of the four element weights. Scaling by the element keeps the ordering true
  // by construction rather than by luck.
  var PHRASE_SHARE = 0.25;

  // Word ORDER and SPACING, worth a small fraction of the element. Deliberately
  // small: it is a tie-breaker between two passages that already say the same thing,
  // not a reason to prefer one that says less. "What is imqueue" and "What @imqueue
  // is" both match the query "what is imqueue" on every other axis — coverage,
  // density, even the bag — and this is the only signal that separates them.
  var POSITION_SHARE = 0.12;

  // Within the position bonus: how much comes from the terms appearing in the query's
  // order, and how much from the gaps between them being the size the query implies.
  var ORDER_SHARE = 0.65;

  // ELEMENT WEIGHTS. Relevance flows in this order: what the thing is called, then
  // what the section it sits in is called, then what the author chose to emphasize,
  // then how densely the body talks about it. Each element is scored independently
  // and contributes at most its own weight, which is the structural form of the rule
  // that no single field can outrank a whole-name match.
  // Every one of these sits BELOW the whole-string signals in W, and that ordering is
  // load-bearing: graded evidence ("the title contains all the query words, densely")
  // must never overtake exact evidence ("the title IS the query"). With title at 620
  // it did — `IMQOptions.safeDeliveryTtl` scored 836 for the query "safeDelivery" and
  // `IMQOptions.safeDelivery`, whose last segment is exactly that, scored 708.
  // Element order: URL > keywords > title > header > emphasis > body.
  //
  // The URL leads because a path is two to four words and a human chose every one of them —
  // the same argument that makes a title strong, applied to something even terser. But it
  // only leads for the words it ADDS. A blog slug is generated from the title, so
  // /blog/imqueue-vs-moleculer/ matching "imqueue" is the title matching twice, not a second
  // piece of evidence; scoring that at the top weight would quietly mean "titles count
  // double" and demote every other element to pay for it.
  //
  // Split in two, therefore. A query term in the path AND in the title is an echo, worth
  // less than the title it repeats. A term in the path and NOT in the title is the case
  // worth the top weight: /mcp/installation/ is titled "Add the MCP server to Claude,
  // Cursor & VS Code", and the word "installation" exists nowhere on that page except its
  // path. Same for /pricing/, /get-started/ and /glossary/.
  var E = {
    // A path word the title does not have. See urlScore.
    urlNew: 480,
    // Curated `keywords` front matter: the author stating which queries this page exists to
    // answer. Just under the URL, as another deliberately-chosen and terse label — and above
    // title, which is a promotion: it used to sit at 300.
    //
    // Google has ignored <meta name="keywords"> since 2009 and Bing treats a stuffed one as
    // a spam signal, because neither can trust the author. This index can: the author is the
    // site. What does not change is that a self-declared list is cheap to pad, which is why
    // it is scored on COVERAGE ONLY — no density, no repetition bonus, so lengthening the
    // list buys nothing (see keywordScore).
    keywords: 450,
    title: 430,
    header: 360,
    emphasis: 200,
    // A path word the title already carries. Below body on purpose: it is not independent
    // evidence, and its only job now is to stop a path match counting as nothing at all.
    url: 110,
    body: 120,
  };

  // A query term counts against a path segment when it is a PREFIX of it, from this length up.
  //
  // The URL element used to require the term to EQUAL the segment. That is why "install mcp"
  // could not find /mcp/installation/ while "installation mcp" ranked it #1 — the one element
  // that knew the word was doing exact string equality while every other element matched on
  // substrings. Weight and ordering had nothing to do with it.
  //
  // Bounded by length because a path segment is short and unanchored prefixes of three
  // letters collide with everything: `com` is a prefix of `commercial`, `con` of `contact`
  // and `contributing`. Five is past the point where that happens on this site's paths.
  var URL_PREFIX_MIN = 5;

  // Share of the keywords weight that mere word overlap gets, as against a declared phrase.
  // 450 * 0.6 = 270, close to the 300 the whole element used to be worth.
  var KEYWORD_OVERLAP = 0.6;

  // A section's PAGE title is context, not the section's own name, so it counts at a
  // fraction — otherwise every section of a page whose title matches outranks the
  // page itself and the list fills up with one document.
  var PAGE_TITLE_SHARE = 0.4;

  // Inside one element: mostly "how much of the query does this cover", partly "how
  // concentrated is it". Coverage has to dominate, or a one-word section beats a
  // thorough treatment of the whole query.
  // A term matched only through its lemma counts for a bit over half of a literal hit.
  // It is real evidence — "queues" and "queue" are the same word — but weaker, because
  // no lemmatizer without a part-of-speech tagger is certain, and because a lemma match
  // contributes no position and gets no highlight.
  var LEMMA_WEIGHT = 0.55;

  // Truncated-prefix matching: the last resort for a long term that matched nothing.
  //
  // Truncating the QUERY term and requiring a word-start match is the classic fallback, and
  // it is safe where lemmatizing is not for one reason: it happens at match time. A wrong
  // guess costs a fraction of one term's weight on one query, where a wrong lemma would
  // merge two words in the index permanently and silently. Bounded to long terms so that
  // short words, where spelling collisions live, never reach it.
  var PREFIX_WEIGHT = 0.45;
  var PREFIX_MIN_TERM = 10;
  var PREFIX_KEEP = 8;

  // DERIVATIONAL matching, query side only: "commercially" -> "commercial".
  //
  // scripts/lib/lemma.js refuses -ly and gives the evidence: at index time it produced
  // `multiply -> multiple`, `supply -> supple`, `reply -> rep`, `only -> on`, and no stem
  // length or is-it-a-lemma test separates those from the cases worth having, because
  // `supply` and `commercially` are both WordNet lemmas. That reasoning stands, and this
  // does not contradict it — it changes the validity test to one the indexer cannot use.
  //
  // The candidate must appear IN THIS CORPUS, which is checked against the document
  // frequency table that tier 2 already ships. That is a stronger filter than any
  // dictionary here: `multip`, `supp`, `rep`, `assemb` and `fami` are not words on this
  // site, so they cannot be reached, while `commercial` (42 sections) and `explicit` (11)
  // can. `only` and `apply` are excluded before that by the stem length — the failures were
  // all short stems.
  //
  // Still query-side and still weighted as a lemma match rather than a literal one: a wrong
  // guess costs part of one term on one query. The index is never told that these two words
  // are the same, because they are not.
  var DERIV_MIN_STEM = 6;

  // What a candidate scores when it misses the query's TOPIC — the highest-weighted content
  // term, which after IDF means the rarest word the person typed.
  //
  // "can i use imqueue commercially" is the case. Five FAQ answers titled "Can I use
  // @imqueue with a GraphQL gateway?" / "…inside a NestJS application?" took the top five
  // places: each matched four of the five words, missed only `commercially`, and then
  // collected the 1.55 interrogative bonus for being question-shaped. The page that answers
  // the question — "Is the GPL-3.0 licence a problem for commercial use?" — was not in the
  // 72 results at all. Weighting `commercially` higher could not fix it, because coverage is
  // a RATIO: four cheap words still cover more of the query than one expensive word that
  // only half-matches.
  //
  // A multiplier rather than a filter, deliberately. A filter is one typo away from zero
  // results ("imqeueue commercially" would drop everything), and the rarest term is exactly
  // the one most likely to be misspelled or to be a word this site words differently. This
  // way a topic miss loses to any real topic match but still beats nothing.
  var TOPIC_MISS = 0.2;

  var COVERAGE_SHARE = 0.75;

  // Occurrences per token at which density counts as saturated. One hit in eight
  // words is already emphatic; ten hits in eight words is not ten times better.
  var DENSITY_SATURATION = 8;

  // Kind is a real relevance signal in generated reference: somebody typing
  // "RedisQueue" wants the class, not its 30th inherited method.
  var KIND_BONUS = {
    package: 45, class: 35, interface: 35, namespace: 22, enum: 22,
    function: 20, type: 12, variable: 10, method: 10, property: 8, constructor: 6,
  };

  // An article is a good answer to a question and a poor answer to "what is the
  // signature of X", so this de-weighting is lifted for interrogative queries.
  var EDITORIAL = { Article: 1, Topic: 1, Author: 1 };
  var BLOG_WEIGHT = 0.75;

  var QUESTION_WORD = /^(?:how|what|why|when|where|which|who|whose|does|do|did|is|are|was|can|could|should|would|will|must|am)\b/;

  // Stopwords are SEARCHABLE, at a fraction of the weight — not discarded.
  //
  // Discarding them was the first attempt and it broke short queries: "what is
  // imqueue" became the single term "imqueue", which is in half the corpus, thirty
  // records then tied, and the winner was whichever had the shortest URL. Keeping
  // them at full weight is the opposite failure — "does @imqueue retry a failed
  // call?" matched 170 sections on the words "does" and "a".
  //
  // A weight solves both: every word still matches, but a page whose only claim is
  // the word "the" cannot clear MIN_SCORE, while a heading that matches ALL of
  // "what", "is" and "imqueue" scores as the near-exact answer it is. The
  // interrogative words are in here too — they shape the query (see `question`
  // below) rather than describing content.
  // A term's weight also scales with how RARE it is in the corpus — inverse document
  // frequency, the oldest idea in retrieval and the one this ranker was missing.
  //
  // Measured over 703 sections: "imqueue" is in 600 of them, "use" in ~300, "commercial" in
  // ~20. Treating those equally is what made "can i use imqueue commercially" return five
  // FAQ answers titled "Can I use @imqueue…" — every one matched four words of the query and
  // none of them matched the word the question was ABOUT. Stopword weighting cannot fix that
  // on its own, because "use" and "imqueue" are not stopwords; they are just uninformative
  // HERE, which is a fact about this corpus rather than about English.
  //
  // Floored rather than allowed to reach zero: a term in every document still carries a
  // little evidence, and a query made only of common words must still rank something.
  var IDF_FLOOR = 0.12;

  // Rarity is evidence, and it was being read as proof. Raw log-IDF spreads an 86-page,
  // 719-section corpus over a range wide enough that the rarest word in a query effectively
  // decided the result, and on a corpus this small the rarest word a reader types is very
  // often one the right page does not use at all — "api gateway nodejs" is answered here by
  // /tutorial/api-service/, which never says "gateway".
  //
  // So the curve is flattened toward 1 without being removed. Measured over both KPI sets
  // (npm run kpi:search), exponent against natural macro / artificial macro, versus 1.0:
  //
  //   0.75  +0.8 / +0.6     0.5  +1.0 / +1.1     0.25  +0.4 / +1.3
  //   0.6   +1.1 / +1.0     0.4  +0.8 / +1.2     0     -1.4 / +1.2
  //
  // 0.6 is the macro peak, at 75 natural queries improved against 36 worsened, and the two
  // sets agree — which is the only reason to believe it, since they disagree readily (see
  // scripts/search-kpi/README.md). 0 is the control: switching rarity off entirely is the
  // worst result on natural macro, so the signal is real and only its strength was wrong.
  var IDF_POWER = 0.6;

  // The feed shape this ranker was written against, declared so a mismatch is loud.
  //
  // Needed because the ranker and the generator are about to stop sharing a repository: the
  // ranker becomes a submodule pinned to a commit, while the feeds it reads are fetched LIVE from
  // imqueue.org. A pinned ranker therefore reads today's feeds, and a tuple that gained a field or
  // moved one would be read as the old shape — wrong scores, no error. So the corpus states what
  // it emits (FEED_V in scripts/lib/search-corpus.js), this states what it understands, and
  // check-search-index.js fails when they disagree.
  //
  // Bump BOTH when a tuple position or a top-level key changes. Adding a record FIELD that older
  // code ignores does not need a bump; moving or removing one does.
  var FEED_V = 1;

  var STOP_WEIGHT = 0.15;
  // Object.create(null), NOT {} — and the same applies to every map in this file keyed by a
  // word rather than by an internal name.
  //
  // `({}).constructor` is inherited from Object.prototype and is a truthy function, so
  // `STOP["constructor"]` was true and the word was silently treated as an English stopword:
  // weight 0.15, whole-word-only, and excluded from the content-term count. Typing the exact
  // word therefore made results WORSE than typing a prefix of it — "rpc imqdelay constructo"
  // returned the constructor page at #1, "rpc imqdelay constructor" dropped it out of 17
  // results entirely. It also poisoned the arithmetic: `t2.df["constructor"]` returned that
  // same function, so `Math.log(docs / (1 + fn))` was NaN and every score for such a query
  // was NaN. 19 of the 21 pages the ranker could not retrieve at all were `_constructor_`
  // pages — one prototype chain, not nineteen ranking defects.
  var STOP = Object.create(null);

  ("a an and are as at be been but by can could did do does for from had has have how i if in into is it its "
    + "must my no not of on or should so than that the their then there these they this to was we what when where "
    + "which who why will with would you your").split(" ").forEach(function (word) { STOP[word] = 1; });

  var GROUPS = [
    { key: "answers", label: "Answers" },
    { key: "docs", label: "Guides & articles" },
    { key: "api", label: "API reference" },
    // Labelled from the search-peer-label meta tag at init; "peer" is a placeholder that
    // is never displayed, because the group is only ever rendered when a peer loaded.
    { key: "peer", label: "peer" },
  ];

  // Five per group in the dialog — three groups of five is a list you can take in
  // without scrolling, and anything past it is behind the link to /search/, which
  // pages through the whole group twenty at a time. At most two results from one
  // page, or a query matching a long comparison article returns that article five
  // times and buries everything else.
  var PER_GROUP = 5;
  var PER_PAGE = 20;
  var MAX = { perPage: 2 };

  // Below this a "match" is one weak term hit and showing it costs more than the
  // blank space it fills. On the element scale: a single term covering a whole query
  // in a body scores ~115, while one term of four covering nothing else scores ~28.
  var MIN_SCORE = 60;

  // Share of its group's BEST score that a hit must reach to be shown at all. See the note
  // where it is applied for why this is relative, and why it is per group.
  var GROUP_FLOOR = 0.3;

  var state = {
    t1: null, t2: null, p1: null, p2: null,
    // The peer's two tiers, loaded alongside this site's.
    x1: null, x2: null, px1: null, px2: null,
    q: "", results: null, active: -1,
  };

  // Set from the meta tags head.html emits. `peerOrigin` prefixes every peer result's
  // href — the index it came from holds root-relative URLs for ITS site, which on this
  // one would point at pages that do not exist.
  var peerOrigin = "";
  var peerLabel = "";
  var el = {};

  // Set at the bottom, once the DOM is there (this script is deferred). Non-null
  // only on /search/, where the page owns a search field of its own and the modal
  // would be a second one stacked on top of it.
  var pageHost = null;

  // Section tuple layout. The first five slots come from the generator, the rest are
  // computed once when tier 2 lands — folding and counting 640 KB of prose on every
  // keystroke was measurably the most expensive thing this file did.
  var S_PAGE = 0;
  var S_ANCHOR = 1;
  var S_HEAD = 2;
  var S_TEXT = 3;
  var S_EMPH = 4;
  var S_SQUASH = 5;
  var S_FOLDED = 6;
  var S_HEADTOK = 7;
  var S_FOLDEMPH = 8;
  var S_NTOK = 9;
  var S_NEMPH = 10;
  // Lemma strings, one per element: the lemmas of the words in that element whose
  // surface form differs. Needed for the direction the surface text cannot answer —
  // query "go" against a section that only says "went".
  var S_LEMHEAD = 11;
  var S_LEMEMPH = 12;
  var S_LEMBODY = 13;

  // Page tuple layout: url, title, kind, then the same precomputation.
  var P_URL = 0;
  var P_TITLE = 1;
  var P_KIND = 2;
  var P_FOLDED = 3;
  var P_NTOK = 4;
  var P_LEMMA = 5;

  // ---- text utilities -----------------------------------------------------

  function fold(s) {
    // Accents folded so "back-pressure" and "backpressure" both reach the same
    // token stream as the corpus. Deliberately no stemmer: it would map
    // `sendOptions` and `send` onto each other and wreck identifier search.
    return String(s == null ? "" : s)
      .toLowerCase()
      .normalize("NFD")
      // Escaped, not literal: a combining-marks range typed as raw characters is
      // invisible in an editor and in a diff.
      .replace(/[\u0300-\u036f]/g, "");
  }

  // Query/prose tokens. `@`, `.`, `_`, `$`, `/` and `-` survive because they are
  // part of what people type here: "@imqueue/rpc", "IMQ.create", "pg_notify".
  function terms(s) {
    return fold(s)
      .split(/[^a-z0-9@._$/-]+/)
      .map(function (t) { return t.replace(/^[.\-/]+|[.\-/]+$/g, ""); })
      .filter(function (t) { return t.length > 0; });
  }

  // Identifier tokens: camelCase, dots and underscores all split, so
  // "watcher check delay" finds `watcherCheckDelay` and "queue send" finds
  // `RedisQueue.send`.
  function idTokens(name) {
    return fold(String(name).replace(/([a-z0-9])([A-Z])/g, "$1 $2"))
      .split(/[^a-z0-9]+/)
      .filter(Boolean);
  }

  // Everything that is not a letter or digit, removed. This is how "backpressure"
  // reaches "Back-pressure for Node.js services": the site hyphenates the term, the
  // people searching for it mostly do not, and no amount of tokenizing bridges a
  // compound word whose split point you do not know. Comparing both sides squashed
  // does, and it costs one precomputed string per record.
  function squash(folded) {
    return folded.replace(/[^a-z0-9]/g, "");
  }

  // Leading sigils a caller never types: `$lte`, `_default`, `#private`.
  function sigilless(segment) {
    return segment.replace(/^[^a-z0-9]+/, "");
  }

  function lastSegment(name) {
    var parts = String(name).split(".");

    return parts[parts.length - 1];
  }

  /**
   * The query as an unordered bag of words against a title's own words.
   *
   * This is what makes "what is imqueue" find the section headed "What @imqueue is".
   * Nothing else could: the phrase check needs the words in order, and term matching
   * had already thrown "what" and "is" away as stopwords, leaving the single term
   * "imqueue" — which is in half the corpus. Thirty FAQ answers then scored
   * identically and the winner was decided by URL length, which is how "Can I use
   * @imqueue alongside gRPC or NATS?" became the top result for "what is imqueue".
   *
   * EVERY word of the query has to be present, so this fires rarely and precisely.
   * The score scales by how much of the title the query accounts for: three words
   * matching a three-word heading is an exact answer, three words matching a
   * twelve-word heading is a coincidence.
   */
  function bagScore(tokens, q) {
    if (!q.all.length || q.all.length > tokens.length) {
      return 0;
    }

    for (var i = 0; i < q.all.length; i++) {
      if (tokens.indexOf(q.all[i]) === -1) {
        return 0;
      }
    }

    // Damped for a query with little content, but never to zero: "how do i" is all
    // stopwords and a heading that is exactly those words is still the best possible
    // answer to it. The floor is what keeps that true while stopping a bare "the"
    // from scoring 450 on every heading that happens to start with it.
    var strength = Math.max(0.4, Math.min(1, q.weightSum));

    return W.bag * strength * (q.all.length / tokens.length);
  }

  function parseQuery(raw) {
    var text = String(raw || "").trim();
    var filters = { pkg: null, kind: null };

    // pkg:rpc / kind:method — every field they filter is already in the index,
    // so scoped search costs one regex rather than a second index.
    text = text.replace(/\b(pkg|package|kind):([\w@/-]+)/gi, function (_, key, value) {
      filters[key.toLowerCase() === "kind" ? "kind" : "pkg"] = fold(value);

      return " ";
    }).trim();

    var t = terms(text);
    var joined = fold(text).replace(/\s+/g, " ").trim();
    var weights = [];
    var offsets = [];
    var weightSum = 0;
    var content = 0;
    var cursor = 0;

    for (var i = 0; i < t.length; i++) {
      var weight = STOP[t[i]] ? STOP_WEIGHT : 1;

      weights.push(weight);
      weightSum += weight;

      if (weight === 1) {
        content++;
      }

      // Where each term sits in the query itself, so the gaps between terms in a
      // candidate can be compared with the gaps the person typed. Scanned with a
      // moving cursor so a repeated word gets its own successive positions.
      var at = joined.indexOf(t[i], cursor);

      offsets.push(at === -1 ? cursor : at);
      cursor = (at === -1 ? cursor : at) + t[i].length;
    }

    return {
      raw: text,
      joined: joined,
      squashed: squash(fold(text)),
      // Every token, stopwords included. `weights` is what makes them count for
      // less; see STOP_WEIGHT.
      terms: t,
      weights: weights,
      offsets: offsets,
      // Parallel to `terms`: true where the term must match a whole word. Stopwords
      // only — see scanFor().
      whole: weights.map(function (weight) { return weight !== 1; }),
      // Parallel to `terms`: the term's lemma when it differs, else "". Filled in by
      // lemmatize() once the map has loaded, so a query typed before tier 2 arrives
      // simply has no lemma layer rather than blocking on one.
      lemmas: t.map(function () { return ""; }),
      weightSum: weightSum || 1,
      // How many terms are not stopwords — the coverage floor is expressed in these,
      // so a long question cannot be "half matched" by its articles and prepositions.
      content: content,
      all: t,
      filters: filters,
      question: /\?\s*$/.test(text) || QUESTION_WORD.test(fold(text)),
    };
  }

  // The map covers every word the CORPUS contains, so these rules only ever run on a
  // form that appears nowhere in it — where the worst case is failing to find a match
  // that did not exist. That is why they can be this crude: the `string` -> `str` class
  // of error cannot reach the ranker, because "string" is in the corpus and therefore
  // in the map, and the map wins.
  function fallbackLemma(term) {
    if (term.length < 5) {
      return "";
    }
    if (/ies$/.test(term)) return term.slice(0, -3) + "y";
    if (/(ss|us|is|s)es$/.test(term)) return term.slice(0, -2);
    if (/[^s]s$/.test(term)) return term.slice(0, -1);
    if (/ing$/.test(term)) return term.slice(0, -3);
    if (/ed$/.test(term)) return term.slice(0, -2);

    return "";
  }

  // -ly / -ally only, validated against the corpus. See DERIV_MIN_STEM for why the
  // validity test is "does this site use the word" rather than "is this a word".
  function derivedLemma(term) {
    var df = state.t2 && state.t2.df;

    if (!df || !/ly$/.test(term)) {
      return "";
    }

    // "automatically" -> "automatical" is in no corpus; -ally has to be tried as a unit.
    var candidates = /ally$/.test(term)
      ? [term.slice(0, -4), term.slice(0, -2)]
      : [term.slice(0, -2)];

    for (var i = 0; i < candidates.length; i++) {
      if (candidates[i].length >= DERIV_MIN_STEM && df[candidates[i]]) {
        return candidates[i];
      }
    }

    return "";
  }

  function idfOf(term) {
    var t2 = state.t2;

    if (!t2 || !t2.df || !t2.docs) {
      return 1;
    }

    var df = t2.df[term] || 0;
    // Normalised by log(N) so the result is 0..1 regardless of corpus size, then floored.
    var idf = Math.log(t2.docs / (1 + df)) / Math.log(t2.docs);

    return Math.max(IDF_FLOOR, Math.pow(Math.min(1, idf), IDF_POWER));
  }

  function lemmatize(q) {
    var map = state.t2 && state.t2.lemmas;

    for (var i = 0; i < q.terms.length; i++) {
      // Stopwords are never lemma-matched. Merging is/was/were onto "be" would make a
      // function word match most sentences in the corpus for no gain in topicality.
      if (q.whole[i]) {
        continue;
      }

      var lemma = (map && map[q.terms[i]]) || fallbackLemma(q.terms[i]);

      q.lemmas[i] = lemma && lemma !== q.terms[i] ? lemma : "";

      // Last: the corpus-validated derivational route. After the map, so a word the
      // corpus actually contains is never rewritten — `only` and `supply` are in the
      // map, resolve to themselves, and never reach this.
      if (!q.lemmas[i]) {
        q.lemmas[i] = derivedLemma(q.terms[i]);
      }
    }

    // AFTER the lemma pass, not before: a term's document frequency is the frequency of the
    // word it actually matches on, and looking it up first read q.lemmas while it was still
    // empty — so every inflected term was scored as if it were unique.
    //
    // IDF folds into the per-term weights, so every ratio computed from them — coverage in
    // elementScore, keywordScore, urlScore — becomes rarity-weighted for free. Guarded,
    // because applying it twice to one query object would square it.
    if (!q.weighted && state.t2 && state.t2.df) {
      var sum = 0;

      for (var k = 0; k < q.terms.length; k++) {
        q.weights[k] *= idfOf(q.lemmas[k] || q.terms[k]);
        sum += q.weights[k];
      }
      q.weightSum = sum || 1;
      q.weighted = true;
    }

    // The TOPIC: the heaviest content term, which after IDF is the rarest word typed.
    // Computed here rather than in parseQuery because it is meaningless before the
    // weights are rarity-adjusted — by raw weight every content term ties at 1.
    //
    // Only for queries with at least two content terms. With one, the topic IS the query
    // and every result that scored at all already matches it.
    q.topic = -1;

    if (q.content >= 2) {
      var best = 0;

      for (var n = 0; n < q.terms.length; n++) {
        if (!q.whole[n] && q.weights[n] > best) {
          best = q.weights[n];
          q.topic = n;
        }
      }
    }

    return q;
  }

  // ---- scoring ------------------------------------------------------------

  function isWordChar(ch) {
    return (ch >= "a" && ch <= "z") || (ch >= "0" && ch <= "9");
  }

  /**
   * Occurrences of one term, and the position of the first.
   *
   * `whole` makes it match on word boundaries only, and is set for stopwords. They are
   * the terms where substring matching means nothing: searching "what is imqueue"
   * found "is" inside "comparison", "decision" and "Redis", which inflated density on
   * every page and — because the highlighter marks what matched — rendered snippets as
   * "compar<mark>is</mark>on". Content terms keep substring matching, because that is
   * what makes "imq" reach "imqueue" and "watcher" reach watcherCheckDelay.
   *
   * Allocates one small object per term per element. Deliberate: the alternative was a
   * module-level side channel to return two numbers, and a hidden second return value
   * is the kind of thing that breaks silently later. At ~20k short-lived objects per
   * keystroke behind a 110ms debounce, it does not register.
   */
  function scanFor(folded, term, whole) {
    var n = 0;
    var first = -1;
    var at = folded.indexOf(term);

    while (at !== -1) {
      var ok = true;

      if (whole) {
        ok = !(at > 0 && isWordChar(folded.charAt(at - 1))) &&
          !isWordChar(folded.charAt(at + term.length));
      }
      if (ok) {
        n++;

        if (first === -1) {
          first = at;
        }
      }
      // +1 rather than +term.length: adjacent and overlapping occurrences both count,
      // and a boundary rejection must not skip the characters after it.
      at = folded.indexOf(term, at + 1);
    }

    return { n: n, first: first };
  }

  /**
   * How closely the matched terms sit, relative to how the query spaced them.
   *
   * Two parts, both cheap. ORDER: of each adjacent pair of query terms, how often the
   * later one also appears later in the text. SPACING: how close the gap between them
   * is to the gap in the query — min/max, so "twice as far apart" and "half as far
   * apart" are penalised alike.
   *
   * Worked example, query "what is imqueue" (gaps 5 and 3):
   *   "What is imqueue"  order 1.0, spacing 1.0  -> full bonus
   *   "What @imqueue is" order 0.5, spacing 0.33 -> about a third of it
   * Everything else about those two headings is identical, which is exactly the case
   * this exists for.
   *
   * @param {Array<Array<number>>} found [queryIndex, positionInText] in query order.
   */
  function positionScore(found, q) {
    if (found.length < 2) {
      return 0;
    }

    var inOrder = 0;
    var spacing = 0;

    for (var i = 1; i < found.length; i++) {
      var textGap = found[i][1] - found[i - 1][1];
      var queryGap = q.offsets[found[i][0]] - q.offsets[found[i - 1][0]];

      if (textGap > 0) {
        inOrder++;
      }

      var a = Math.abs(textGap) || 1;
      var b = Math.abs(queryGap) || 1;

      spacing += Math.min(a, b) / Math.max(a, b);
    }

    var pairs = found.length - 1;

    return ORDER_SHARE * (inOrder / pairs) + (1 - ORDER_SHARE) * (spacing / pairs);
  }

  /**
   * The position bonus for one element, as points.
   *
   * Deliberately ADDED to whatever the element's base score turned out to be, rather
   * than folded into the graded path — because the case it exists for is two candidates
   * that tie on every other signal. "What is imqueue" and "What @imqueue is" contain
   * the same words, so they get the same bag match (900) and the same coverage; if this
   * lived inside the graded score, `Math.max(bag, graded)` would discard it and the two
   * would still tie exactly.
   *
   * Returns 0 for a single-term query without scanning: there is no order to compare.
   */
  function positionBonus(weight, folded, q) {
    if (!folded || q.terms.length < 2) {
      return 0;
    }

    var found = [];

    for (var i = 0; i < q.terms.length; i++) {
      // FIRST occurrence only. A term repeated across a long section has many
      // positions and no single meaningful one; for a bonus this small the first is a
      // good enough proxy.
      var at = scanFor(folded, q.terms[i], q.whole[i]).first;

      if (at !== -1) {
        found.push([i, at]);
      }
    }

    return weight * POSITION_SHARE * positionScore(found, q);
  }

  // Occurrences of `prefix` at the START of a word. scanFor's whole-word rule requires a
  // boundary on both sides, which is exactly what a truncated prefix cannot have.
  function scanPrefix(folded, prefix) {
    var n = 0;
    var at = folded.indexOf(prefix);

    while (at !== -1) {
      if (!(at > 0 && isWordChar(folded.charAt(at - 1)))) {
        n++;
      }
      at = folded.indexOf(prefix, at + 1);
    }

    return n;
  }

  /**
   * Score ONE element (a title, a heading, the emphasized text, a body) against the
   * query: how much of the query it covers, and how densely.
   *
   * Density is per element, so "queue" once in a five-word heading beats "queue"
   * once in a four-hundred-word section, which is the whole point of weighting by
   * element rather than counting hits across a page. Takes text that is already
   * folded — prepare() and loadTier2() do that once, not once per keystroke.
   */
  function elementScore(weight, folded, tokenCount, q, lemmaText) {
    if (!folded || !q.terms.length) {
      return 0;
    }

    var matched = 0;
    var occurrences = 0;

    for (var i = 0; i < q.terms.length; i++) {
      var hit = scanFor(folded, q.terms[i], q.whole[i]);

      if (hit.n) {
        // Both coverage and density are weighted, so a stopword contributes a
        // fifteenth of a content word on either axis.
        matched += q.weights[i];
        occurrences += hit.n * q.weights[i];
        continue;
      }
      // No literal hit. Two lemma routes remain, and they answer opposite directions:
      //
      //   query "queues", text says "queue"  -> the query's LEMMA appears in the text
      //   query "queue",  text says "queues" -> handled already, "queue" is a substring
      //   query "go",     text says "went"   -> only the text's lemma STRING has "go"
      //
      // `lemmaText === false` disables both. Nothing passes it today — identifiers are
      // kept safe by the whole-word rule below rather than by exclusion — but it stays
      // as the switch for any element that must be matched literally.
      if (lemmaText === false) {
        continue;
      }

      var lemmaHit = q.lemmas[i] ? scanFor(folded, q.lemmas[i], true) : { n: 0 };

      if (!lemmaHit.n && lemmaText) {
        lemmaHit = scanFor(lemmaText, q.lemmas[i] || q.terms[i], true);
      }
      if (lemmaHit.n) {
        matched += q.weights[i] * LEMMA_WEIGHT;
        occurrences += lemmaHit.n * q.weights[i] * LEMMA_WEIGHT;
        continue;
      }

      if (q.terms[i].length >= PREFIX_MIN_TERM) {
        var prefixHit = scanPrefix(folded, q.terms[i].slice(0, PREFIX_KEEP));

        if (prefixHit) {
          matched += q.weights[i] * PREFIX_WEIGHT;
          occurrences += prefixHit * q.weights[i] * PREFIX_WEIGHT;
        }
      }
    }
    if (!matched) {
      return 0;
    }

    var coverage = matched / q.weightSum;
    // Density cannot exceed coverage. Without that ceiling a SHORT field saturates on a
    // single term — `IMQOptions` is two tokens, so matching just "options" gave density 1.0
    // and the interface outranked the licensing page for the query "licensing options".
    // Concentration is a property of the terms that matched; if half the query missed, half
    // is the most that concentration can be worth.
    var density = Math.min(
      coverage,
      (occurrences / Math.max(tokenCount, 1)) * DENSITY_SATURATION
    );
    // Coverage is RELATIVE — matched weight over total weight — so a query of nothing
    // but stopwords would reach coverage 1.0 on the word "the" and return most of the
    // site. Strength is the absolute check: below one content word's worth of query,
    // graded evidence is scaled down until it cannot clear MIN_SCORE. bagScore() is
    // deliberately NOT scaled, so "how do i" still matches a heading that is exactly
    // those words.
    var strength = Math.min(1, q.weightSum);
    var phrase = q.joined.length > 3 && folded.indexOf(q.joined) !== -1 ? PHRASE_SHARE : 0;

    return weight * strength * (COVERAGE_SHARE * coverage + (1 - COVERAGE_SHARE) * density + phrase);
  }

  /**
   * The title element, including the whole-string signals that outrank it.
   *
   * `direct` is deliberately a Math.max against the graded element score rather than
   * added to it: an exact name match is not "a very dense title", it is a different
   * and stronger kind of evidence, and adding them would let a long title with many
   * repetitions overtake the record actually named after the query.
   */
  function titleScore(record, q) {
    var lower = record._l;
    var direct = 0;

    if (lower === q.joined) {
      direct = W.exact;
    } else if (sigilless(fold(lastSegment(lower))) === q.joined) {
      // Sigil-insensitive, because nobody types the sigil. `FilterInput.$lte` is exactly what
      // lastSeg exists for — "send" for RedisQueue.send — but its last segment folds to `$lte`,
      // which never equalled `lte`, so the record fell through to W.substring and ranked 27th
      // behind 26 titles that merely contain those letters inside aLTErnative and fiLTEr.
      // Same for `_default`, `$gte`, `$in`: the sigil is TypeScript's, not the reader's.
      direct = W.lastSeg;
    } else if (lower.indexOf(q.joined) === 0) {
      direct = W.prefix;
    } else if (q.squashed.length > 4 && record._q.indexOf(q.squashed) !== -1) {
      direct = W.squashed;
    } else if (q.joined.length > 2 && lower.indexOf(q.joined) !== -1) {
      direct = W.substring;
    }

    // Symbol names get the lemma route too, and the WHOLE-WORD requirement is what makes
    // that safe — not excluding them, which is what this did first.
    //
    // The fear was `send` reaching `sendOptions`. It cannot: a lemma is only ever matched
    // at word boundaries, and in `sendoptions` the characters after "send" are letters,
    // so the match is rejected. `locks` finds `rpc.lock` and does not find
    // `imqlockmetadataitem`; `logged` does not find `logger`. What the blanket exclusion
    // cost was real: `timeouts` could not reach `IMQClientOptions.timeout`, because its
    // description happens never to use the word.
    //
    // Blind SUFFIX STEMMING on identifiers would still be unsafe. That is not what this
    // is — every lemma here came from a dictionary that rejected the candidate unless the
    // result was a word.
    return Math.max(
      direct,
      bagScore(record._t, q),
      elementScore(E.title, lower, record._t.length, q, "")
    ) + positionBonus(E.title, lower, q);
  }

  /**
   * The keywords element. Coverage only — no density, no position, no phrase bonus.
   *
   * A keyword list is a handful of comma-separated phrases, so occurrences-per-token sits
   * near 1.0 for every page that matches at all: density would rank by list brevity, and
   * reward padding. Order in a comma list means nothing, so the position bonus would be
   * noise. What the list can honestly say is "these words describe this page", and coverage
   * is exactly that statement.
   */
  function keywordScore(record, q) {
    if (!record._w) {
      return 0;
    }

    // A DECLARED QUERY beats scattered overlap, and by a lot.
    //
    // The list is comma-separated phrases, and the difference between "one of these phrases
    // IS what you typed" and "your words appear somewhere among these phrases" is the whole
    // value of the element. Promoting it to 450 without this distinction rewarded the second
    // as if it were the first: /intro/ and /license/ both declare a real query, but so did
    // four blog comparison pages whose lists merely contain the word "imqueue" — and they
    // pushed the home page's own "What @imqueue is" heading from #1 to #9.
    //
    // Substring rather than equality, so "what is imqueue" matches the declared phrase
    // "@imqueue introduction, what is imqueue, …" wherever in the list it sits.
    if (q.joined.length > 3 && record._w.indexOf(q.joined) !== -1) {
      return E.keywords;
    }

    var matched = 0;

    for (var i = 0; i < q.terms.length; i++) {
      var hit = scanFor(record._w, q.terms[i], q.whole[i]);

      if (!hit.n && q.lemmas[i]) {
        hit = scanFor(record._w, q.lemmas[i], true);
      }
      if (hit.n) {
        matched += q.weights[i];
        continue;
      }
      // Same last resort as elementScore. This is the path that carries
      // "commercially" -> "commercial license" in /license/'s curated keywords.
      if (q.terms[i].length >= PREFIX_MIN_TERM &&
        scanPrefix(record._w, q.terms[i].slice(0, PREFIX_KEEP))) {
        matched += q.weights[i] * PREFIX_WEIGHT;
      }
    }

    // Word overlap, at KEYWORD_OVERLAP of the declared-phrase weight — near where the whole
    // element sat before it was promoted, which is the right place for "these words appear in
    // my list somewhere".
    return matched
      ? E.keywords * KEYWORD_OVERLAP * Math.min(1, q.weightSum ? matched / q.weightSum : 0)
      : 0;
  }

  /**
   * The URL element. Coverage of the query, plus how much of the path the query covers,
   * scored TWICE: once for the path words the title does not have, once for the echoes.
   *
   * Segments are split on `-` too, so "get started" reaches /get-started/, and a term is
   * credited when it equals a segment, is its lemma, or is a prefix of it from
   * URL_PREFIX_MIN characters up — which is what lets "install" reach /mcp/installation/.
   */
  function urlScore(record, q) {
    // NOT for generated reference. A symbol's path is derived from its own name, so scoring
    // it double-counts the title — and the package segment is a bare English word: `job`,
    // `net`, `core`, `validation`. For the query "nodejs job queue" that lifted every
    // @imqueue/job symbol above the article written for the phrase, moving it from #3 to
    // #10. The path only carries independent information when a human chose it.
    if (!record._u || record.g === G_API) {
      return 0;
    }

    var segments = record._u;
    // Two accumulators, split by whether the title already carries the term.
    var fresh = 0;
    var echo = 0;
    var hitSegments = 0;

    for (var i = 0; i < q.terms.length; i++) {
      var weight = 0;

      for (var j = 0; j < segments.length; j++) {
        var segment = segments[j];
        var exact = segment === q.terms[i] || (q.lemmas[i] && segment === q.lemmas[i]);
        // A prefix is real evidence but weaker than an exact segment, and weighted the same
        // as the other inexact routes: "install" is not certainly "installation".
        var prefix = !exact && q.terms[i].length >= URL_PREFIX_MIN &&
          segment.length > q.terms[i].length && segment.indexOf(q.terms[i]) === 0;

        if (exact || prefix) {
          weight = Math.max(weight, q.weights[i] * (exact ? 1 : PREFIX_WEIGHT));
          hitSegments++;
        }
      }
      if (!weight) {
        continue;
      }
      // In the title too? Then the path is repeating it, and titleScore already said so.
      if (scanFor(record._l, q.terms[i], q.whole[i]).n ||
        (q.lemmas[i] && scanFor(record._l, q.lemmas[i], true).n)) {
        echo += weight;
      } else {
        fresh += weight;
      }
    }

    if (!fresh && !echo) {
      return 0;
    }

    // `focus` — how much of the PATH the query accounts for — is shared by both halves:
    // /license/ matching "licensing" is the whole identity of that page, while
    // /blog/imqueue-vs-moleculer/ matching "imqueue" is a quarter of it.
    var focus = Math.min(1, hitSegments / segments.length);
    var graded = function (matched, weight) {
      return matched
        ? weight * (0.5 * (matched / q.weightSum) + 0.5 * focus)
        : 0;
    };

    return graded(fresh, E.urlNew) + graded(echo, E.url);
  }

  /**
   * Does term `i` of the query appear in any of `texts`, by ANY route that scoring
   * would credit — literal, lemma, or truncated prefix?
   *
   * One function because there used to be two, and they disagreed. The coverage floors
   * tested `indexOf` and the lemma probe only, while elementScore also credited a
   * truncated prefix — so "Is the GPL-3.0 licence a problem for commercial use?" was
   * dropped by the floor for a query about using @imqueue commercially: `commercially`
   * matched the heading in the scorer's eyes and not in the floor's, leaving one content
   * hit where two were required. A floor that rejects what the scorer would have ranked
   * first is the worst kind of bug — it produces no wrong answer to look at.
   */
  function covers(q, i, texts) {
    var term = q.terms[i];
    var probe = q.lemmas[i];

    for (var k = 0; k < texts.length; k++) {
      var text = texts[k];

      if (!text) {
        continue;
      }
      if (scanFor(text, term, q.whole[i]).n) {
        return true;
      }
      if (probe && scanFor(text, probe, true).n) {
        return true;
      }
      if (term.length >= PREFIX_MIN_TERM && scanPrefix(text, term.slice(0, PREFIX_KEEP))) {
        return true;
      }
    }

    return false;
  }

  // TOPIC_MISS, or 1 when the candidate does match the query's topic term.
  function topicFactor(q, texts) {
    return q.topic === -1 || covers(q, q.topic, texts) ? 1 : TOPIC_MISS;
  }

  // The package name amplifies a title match; it can never create one.
  //
  // urlScore() returns 0 for generated reference DELIBERATELY — a package segment is a bare
  // English word (`job`, `net`, `core`), and crediting it lifted every @imqueue/job symbol
  // above the article written for "nodejs job queue", #3 to #10. That reasoning holds only
  // while the package word is the ONLY thing matching. An agent names the package and the
  // symbol together — `net inttoip`, `rpc lock`, `job jobqueue` — and there it is the most
  // specific evidence in the query: 69 such queries had the right page at rank 18 or absent
  // from the set entirely, while the MCP server's own ranker put nearly all of them first.
  //
  // So the boost is gated on the title ALREADY matching a different term. "nodejs job queue"
  // matches no symbol title, gets nothing, and keeps the ordering that fix bought. "net
  // inttoip" matches `intToIp` exactly, and the qualifier stops that page losing to twenty
  // sibling pages whose only claim is the shared word "net".
  var PKG_QUALIFIER = 2.2;
  // A member beat its own class by 1238 to 1033 — a ratio of 1.20 — so an exact title match has
  // to clear 2.2 x 1.20 = 2.64 to win. 3.0 leaves margin without being a free-for-all.
  var PKG_EXACT = 3;

  function pkgQualifier(record, q) {
    if (!record.p || q.content < 2) {
      return 1;
    }

    var pkg = fold(record.p).split("/").pop();

    if (!pkg) {
      return 1;
    }

    var named = -1;

    for (var i = 0; i < q.terms.length; i++) {
      if (q.terms[i] === pkg || q.lemmas[i] === pkg) {
        named = i;
        break;
      }
    }
    if (named === -1) {
      return 1;
    }

    // A DIFFERENT term has to equal a whole SEGMENT of the title — `intToIp`, `logger`/`log`
    // of "logger.log", `imqdelay`/`constructor` of "imqdelay.(constructor)". Segment equality
    // is the gate, and each weaker test was measured and rejected:
    //
    //   covers()      substring — "queue" matched inside `JobQueue`, so "nodejs job queue"
    //                 put three job symbols above the article, the exact regression this
    //                 avoids.
    //   whole token   still too loose — "options" is a token of `JobOptions`, which cost
    //                 "bullmq job options" its #1 and moved two more natural queries.
    //
    // A segment is the unit a caller actually names. "options" is not a segment of
    // `JobOptions`, so a generic word riding along with a package name earns nothing, while
    // `net inttoip` and `rpc imqdelay constructor` — where the caller named the symbol —
    // earn the boost.
    // And EVERY other term has to be such a segment — the query has to be nothing but a
    // package-qualified symbol reference. One unaccounted word is enough to deny the boost,
    // which is what separates `job jobqueue` from "bullmq job options" and "delayed start date
    // for new job": there, `bullmq`, `start`, `date` and `new` name nothing in the symbol, so
    // the query is prose that happens to contain a package name. Requiring only *some* segment
    // to match left all three of those natural queries worse off; requiring all of them left
    // none.
    var segments = [];
    // The breadcrumb's disambiguator is a segment a caller may legitimately name, so `1` of
    // nullableindex_1 counts here exactly as `constructor` of imqdelay.(constructor) does.
    // Without it the stray term fails the all-terms test below and the exact match loses its
    // multiplier — passing the coverage floor only to be outranked, which fixes nothing.
    var raw = ((record._l || "") + " " + (record._ct || "")).split(/[^a-z0-9]+/);

    for (var e = 0; e < raw.length; e++) {
      if (raw[e]) {
        segments.push(raw[e]);
      }
    }

    var seenSeg = [];
    var matched = 0;

    for (var j = 0; j < q.terms.length; j++) {
      if (j === named) {
        continue;
      }

      var at = -1;

      for (var s = 0; s < segments.length; s++) {
        if (segments[s] === q.terms[j] || segments[s] === q.lemmas[j]) {
          at = s;
          break;
        }
      }
      if (at === -1) {
        return 1;
      }

      seenSeg[at] = true;
      matched++;
    }

    if (!matched) {
      return 1;
    }

    // Both directions, and the second one is what stops a class losing to its own members.
    // Above: every query term is a title segment. Here: every title SEGMENT was named, so the
    // query and the title are the same thing rather than a prefix of it.
    //
    // "net networks" put six members of `Networks` in the window — networks.ipv4 at 1238,
    // networks.tojson at 1191 — and the class page itself at #7 on 1033, because
    // "networks.ipv4" contains the segment `networks` too AND carries extra title content on
    // top. Whoever names a class exactly wants the class, not its sixth property.
    for (var k = 0; k < segments.length; k++) {
      if (!seenSeg[k]) {
        return PKG_QUALIFIER;
      }
    }

    return PKG_EXACT;

    return 1;
  }

  function scoreRecord(record, q) {
    if (q.filters.pkg && fold(record.p || "").indexOf(q.filters.pkg) === -1) {
      return 0;
    }
    if (q.filters.kind && fold(record.k || "") !== q.filters.kind) {
      return 0;
    }

    // The path is included for exactly the records urlScore will score, and excluded for the
    // ones it returns 0 for. Yesterday's bug was a floor that rejected what the scorer would
    // have ranked first; crediting a path the scorer ignores would be the same bug mirrored.
    var texts = [
      record._l, record._s, record._w,
      record.g === G_API || !record._u ? "" : record._u.join(" "),
      // Coverage only — see _ct in prepare(). This is what lets a query name the overload it
      // wants instead of being punished for it.
      record._ct,
    ];

    // Coverage floor. Matching ONE term of a four-term question is not a result:
    // "does @imqueue retry a failed call?" matched 57 answers and 151 sections,
    // most of them on the word "@imqueue" alone, which is in half the corpus. A
    // long query has to be met at least halfway.
    if (q.content >= 3) {
      var found = 0;

      for (var t = 0; t < q.terms.length; t++) {
        // `!q.whole[t]`, NOT `q.weights[t] === 1`. Weights are multiplied by inverse
        // document frequency now, so no weight is ever exactly 1 and that test silently
        // matched nothing — the floor then rejected every record for any query of three or
        // more content terms, and /license/ went from #1 to absent on three of them.
        if (!q.whole[t] && covers(q, t, texts)) {
          found++;
        }
      }
      if (found < 2) {
        return 0;
      }
    }

    // A record has two elements: what it is called, and its summary. The summary is
    // scored as a body — same weight a section's prose gets — so a symbol whose
    // description happens to use the query words cannot outrank the symbol named
    // after them.
    var score = titleScore(record, q) +
      keywordScore(record, q) +
      urlScore(record, q) +
      elementScore(E.body, record._s, record._sn, q, "");

    if (score < MIN_SCORE) {
      return 0;
    }

    if (record.g === G_API) {
      score += KIND_BONUS[record.k] || 0;
      score *= pkgQualifier(record, q);
      // A question is almost never answered by a signature page.
      if (q.question) score *= 0.6;
      if (record.d) score *= 0.35;
    } else if (record.g === G_ANSWER) {
      score *= q.question ? 1.55 : 1.1;
    } else if (EDITORIAL[record.k] && !q.question) {
      score *= BLOG_WEIGHT;
    }

    // The topic discount applies to ANSWERS ONLY, and the asymmetry is the point.
    //
    // A tier-1 record carries a title, a one-line summary and its keywords — no body. So
    // "this record does not contain the query's rarest word" is not evidence about the page:
    // /license/ is titled "GPL-3.0 open-source license terms" and never says "obligation" in
    // those twenty words, though the page is largely about them. Discounting it for that
    // dropped "gpl obligation" from #1 to #2 behind a /contributing/ clause. The page's BODY
    // is indexed too, as sections in tier 2, and there the test is meaningful.
    //
    // An answer record is different: its summary IS the answer, in full. A question-shaped
    // record that never mentions the topic anywhere in its own answer is not an answer to
    // this query, and it is the one kind of record that collects a 1.55 bonus for merely
    // looking like one — so it is exactly where the discount is both fair and needed.
    // Applied last so it discounts that bonus rather than being swallowed by it.
    return record.g === G_ANSWER ? score * topicFactor(q, texts) : score;
  }

  function scoreSection(section, q, page) {
    var head = section[S_HEAD] ? fold(section[S_HEAD]) : "";
    var text = section[S_FOLDED];

    // The four elements, each scored on its own coverage and its own density, then
    // summed — a section that matches in the heading AND in bolded text AND
    // throughout the body is genuinely more relevant than one that matches in only
    // one of them, and summing is what says so. The heading takes the whole-query
    // bag match the same way a title does.
    var score = Math.max(
      bagScore(section[S_HEADTOK], q),
      elementScore(E.header, head, section[S_HEADTOK].length, q, section[S_LEMHEAD])
    ) + positionBonus(E.header, head, q) +
      elementScore(E.emphasis, section[S_FOLDEMPH], section[S_NEMPH], q, section[S_LEMEMPH]) +
      positionBonus(E.emphasis, section[S_FOLDEMPH], q) +
      elementScore(E.body, text, section[S_NTOK], q, section[S_LEMBODY]) +
      positionBonus(E.body, text, q) +
      PAGE_TITLE_SHARE * (
        elementScore(E.title, page[P_FOLDED], page[P_NTOK], q, page[P_LEMMA]) +
        positionBonus(E.title, page[P_FOLDED], q)
      );

    // Coverage floor, over the union of the elements. Matching ONE term of a
    // four-term question is not a result: "does @imqueue retry a failed call?" once
    // matched 151 sections, most of them on the word "@imqueue" alone.
    var texts = [head, text, section[S_FOLDEMPH], section[S_LEMBODY], section[S_LEMHEAD]];
    var hits = 0;
    var contentHits = 0;

    for (var i = 0; i < q.terms.length; i++) {
      if (covers(q, i, texts)) {
        hits++;

        if (!q.whole[i]) {
          contentHits++;
        }
      }
    }

    if (!hits) {
      // Hyphenation, in the body this time: the back-pressure article says
      // "back-pressure" throughout and nobody types the hyphen. Last resort only —
      // it cannot report WHERE it matched, so it contributes no snippet position.
      if (q.squashed.length > 4 && section[S_SQUASH].indexOf(q.squashed) !== -1) {
        return W.squashed * 0.5;
      }

      return score > 0 ? score : 0;
    }
    if (q.content >= 3 && contentHits < 2) {
      return 0;
    }

    if (EDITORIAL[page[P_KIND]] && !q.question) {
      score *= BLOG_WEIGHT;
    }

    // The page title counts for the topic test but NOT for the coverage floor above. The
    // scorer credits it either way (PAGE_TITLE_SHARE), so a section of an article that is
    // itself about the topic should not be discounted for it — but letting it satisfy the
    // floor would readmit every section of any page whose title happens to carry two query
    // words, which is the noise the floor exists to stop.
    score *= topicFactor(q, texts.concat([page[P_FOLDED], page[P_LEMMA]]));

    return score < MIN_SCORE ? 0 : score;
  }

  // ---- search -------------------------------------------------------------

  function prepare(index) {
    for (var i = 0; i < index.records.length; i++) {
      var r = index.records[i];

      r._l = fold(r.t);
      r._s = fold(r.s);
      r._q = squash(r._l);
      r._t = idTokens(r.t);
      // Word count, for the summary's density. Cheap approximation on purpose:
      // splitting on whitespace is within a token or two of idTokens() here and this
      // runs over 1,325 records at load.
      r._sn = r._s ? r._s.split(" ").length : 0;
      r._w = r.w ? fold(r.w) : "";
      // Path segments, hyphens split, `latest` and `api` dropped — they are in 1,152 URLs
      // and identify nothing.
      r._u = fold(r.u).split("#")[0].split(/[^a-z0-9]+/)
        .filter(function (part) { return part && part !== "latest" && part !== "api"; });

      // What the breadcrumb says that nothing else does.
      //
      // crumbs() renders "@imqueue/pg-sequelize › pg-sequelize.nullableindex_1" under every
      // API result, so the `1` is on screen — and it was searchable nowhere, because urlScore
      // returns 0 for generated reference and the title is just "NullableIndex". Two overloads
      // therefore had identical searchable text, and typing the disambiguator that
      // distinguishes them RUINED the query: at three terms the coverage floor needs two of
      // them found, `1` was found in nothing, and the exact match was rejected while an /api/
      // section that merely lists version numbers survived on "pg-sequelize" and a digit from
      // "3.0.5".
      //
      // The package tokens are deliberately NOT included. That word is the reason urlScore
      // gives up on G_API at all — crediting `job` lifted every @imqueue/job symbol above the
      // article written for "nodejs job queue" — and crediting it for coverage cost 13
      // artificial regressions when measured. Tokens the title already carries are dropped too,
      // per E.url: an echoed path word is not independent evidence. What survives is the
      // disambiguator and nothing else: `1` for nullableindex_1, `9` for on_9, and empty for
      // the 1,126 records whose slug says only what their title already said.
      if (r.g === G_API) {
        // Object.create(null) — keyed by words, so `{}` would have made "constructor" always
        // look already-known. Same trap as STOP.
        var known = Object.create(null);
        var owned = fold(r.p || "").split(/[^a-z0-9]+/).concat(r._l.split(/[^a-z0-9]+/));

        for (var o = 0; o < owned.length; o++) {
          if (owned[o]) {
            known[owned[o]] = 1;
          }
        }

        r._ct = r._u.filter(function (part) { return !known[part]; }).join(" ");
      } else {
        r._ct = "";
      }
    }

    return index;
  }

  // One pass over one index pair. Called twice: once for this site, once for the peer.
  // `weight` is 1 locally and PEER_WEIGHT for the other site; `external` tags the records
  // so rendering can group them and absolutise their links.
  function collect(hits, t1, t2, q, weight, external) {
    var i;

    if (t1) {
      for (i = 0; i < t1.records.length; i++) {
        var record = t1.records[i];
        var score = scoreRecord(record, q);

        if (score > 0) {
          hits.push({ score: score * weight, record: record, section: null, external: external });
        }
      }
    }

    if (t2 && !q.filters.pkg && !q.filters.kind) {
      for (i = 0; i < t2.sections.length; i++) {
        var section = t2.sections[i];
        var page = t2.pages[section[S_PAGE]];
        var sectionScore = scoreSection(section, q, page);

        if (sectionScore > 0) {
          hits.push({
            score: sectionScore * weight,
            section: section,
            external: external,
            record: {
              g: G_DOC,
              t: section[S_HEAD] || page[P_TITLE],
              u: section[S_ANCHOR] ? page[P_URL] + "#" + section[S_ANCHOR] : page[P_URL],
              s: "",
              k: page[P_KIND],
              _page: page[P_TITLE],
            },
          });
        }
      }
    }
  }

  function search(q) {
    var hits = [];
    var i;

    // Here rather than in parseQuery, because the map arrives with tier 2 — after the
    // first keystrokes. Re-running the query when tier 2 lands is what upgrades an
    // already-typed search from literal to morphological.
    lemmatize(q);

    collect(hits, state.t1, state.t2, q, 1, false);
    collect(hits, state.x1, state.x2, q, 1, true);

    // One URL, one result — but an ANSWER and a prose section can be the same
    // heading seen twice, and then the answer's presentation is the one that
    // helps: it is the record that renders under "Answers" with the answer text.
    // Before this, the section outscored it and "Does @imqueue retry a failed RPC
    // call?" was returned as an ordinary article hit with the Answers group empty.
    var byUrl = {};

    for (i = 0; i < hits.length; i++) {
      // Keyed by SITE + url: both editions have a /license/ and a /contact/, and they are
      // different pages. Without the prefix one would silently evict the other.
      hits[i].key = (hits[i].external ? "x" : "") + hits[i].record.u;

      var previous = byUrl[hits[i].key];

      if (!previous) {
        byUrl[hits[i].key] = hits[i];
        continue;
      }

      // An answer wins outright — its presentation is the one that helps. Otherwise
      // the better-scoring hit wins, which was the missing half: a page whose
      // heading matched the query exactly ("What @imqueue is" for "what is imqueue")
      // shares a URL with the page record when the heading has no anchor, and
      // keeping "whichever came first" kept the page record — inheriting the
      // section's score while showing the page's title and blurb.
      var winner = hits[i].record.g === G_ANSWER && previous.record.g !== G_ANSWER ? hits[i]
        : previous.record.g === G_ANSWER || previous.score >= hits[i].score ? previous
          : hits[i];

      winner.score = Math.max(hits[i].score, previous.score);
      byUrl[hits[i].key] = winner;
    }

    hits = Object.keys(byUrl).map(function (url) { return byUrl[url]; });

    // Ties are common — a one-word query can match thirty records identically — and
    // the tie-break has to mean something. Shortest title first: it is the one with
    // the fewest words that are not the query, i.e. the most specifically about it.
    // This used to be URL length, which is why an arbitrary FAQ won.
    hits.sort(function (a, b) {
      // Local before peer, unconditionally — see the note on site priority above. Applies
      // to the merged "Everything" list on /search/ as much as to the dialog.
      return (a.external ? 1 : 0) - (b.external ? 1 : 0) ||
        b.score - a.score ||
        a.record.t.length - b.record.t.length ||
        a.record.u.length - b.record.u.length;
    });

    // At most MAX.perPage results from one page. Without this a query matching a
    // long comparison article returns that article eight times and buries
    // everything else — the list stops being a list of answers.
    var perPage = {};
    var seen = {};
    var kept = [];
    var lead = {};

    for (i = 0; i < hits.length; i++) {
      var hit = hits[i];
      var url = hit.key;
      var pageUrl = (hit.external ? "x" : "") + hit.record.u.split("#")[0];

      if (seen[url]) {
        continue;
      }

      // A RELATIVE floor, per group. MIN_SCORE is absolute and cannot express "far worse
      // than the thing above it": for "can i use imqueue commercially" the right answer
      // scored 386 and four "Can I use @imqueue…" near-misses sat at 155, 149, 134 and 130
      // — every one of them clear of MIN_SCORE, and every one of them visible, because the
      // dialog shows five rows per group. Ranking them correctly was not enough; they still
      // filled the group under the answer.
      //
      // Per group, not overall, and that matters: an exact identifier match scores over
      // 1000, so one shared yardstick would wipe out the entire prose group behind any
      // symbol lookup. Each group is judged against its OWN best hit, which is the only
      // comparison a reader makes.
      //
      // hits is already sorted descending, so the first hit of a group is its leader.
      var group = (hit.external ? "x:" : "") + groupKey(hit);

      if (lead[group] === undefined) {
        lead[group] = hit.score;
      } else if (hit.score < lead[group] * GROUP_FLOOR) {
        continue;
      }
      if (hit.record.g === G_DOC) {
        perPage[pageUrl] = (perPage[pageUrl] || 0) + 1;

        if (perPage[pageUrl] > MAX.perPage) {
          continue;
        }
      }
      seen[url] = true;
      kept.push(hit);
    }

    return kept;
  }

  // ---- snippets -----------------------------------------------------------

  function snippet(text, q, length) {
    var lower = fold(text);
    var at = q.joined.length > 3 ? lower.indexOf(q.joined) : -1;

    for (var i = 0; at === -1 && i < q.terms.length; i++) {
      at = lower.indexOf(q.terms[i]);
    }
    if (at === -1) {
      return text.slice(0, length);
    }

    var start = Math.max(0, at - Math.floor(length / 3));
    var end = Math.min(text.length, start + length);

    if (start > 0) {
      var space = text.indexOf(" ", start);

      start = space === -1 || space > at ? start : space + 1;
    }

    return (start > 0 ? "…" : "") + text.slice(start, end).trim() + (end < text.length ? "…" : "");
  }

  // Highlighting builds text nodes and <mark> elements rather than HTML, so
  // corpus text can never become markup. The index is generated from this repo,
  // but "our own data is trusted" is exactly the assumption that ages badly.
  function highlight(target, text, q) {
    var lower = fold(text);
    var marks = [];
    var i;

    for (i = 0; i < q.terms.length; i++) {
      var term = q.terms[i];

      if (term.length < 2) {
        continue;
      }
      // Stopwords are matched but not MARKED, unless they are all the query has.
      // Marking them turned a snippet for "what is imqueue" into a field of green on
      // "is" and "what" — the words that contributed least to the result being there.
      if (q.whole[i] && q.content > 0) {
        continue;
      }

      var at = lower.indexOf(term);

      while (at !== -1) {
        // Same boundary rule the scorer used, so what is highlighted is what matched.
        if (!q.whole[i] ||
          (!(at > 0 && isWordChar(lower.charAt(at - 1))) && !isWordChar(lower.charAt(at + term.length)))) {
          marks.push([at, at + term.length]);
        }
        at = lower.indexOf(term, at + 1);
      }
    }

    marks.sort(function (a, b) { return a[0] - b[0]; });

    var merged = [];

    for (i = 0; i < marks.length; i++) {
      var last = merged[merged.length - 1];

      if (last && marks[i][0] <= last[1]) {
        last[1] = Math.max(last[1], marks[i][1]);
      } else {
        merged.push(marks[i]);
      }
    }

    var cursor = 0;

    for (i = 0; i < merged.length; i++) {
      if (merged[i][0] > cursor) {
        target.appendChild(document.createTextNode(text.slice(cursor, merged[i][0])));
      }

      var mark = document.createElement("mark");

      mark.textContent = text.slice(merged[i][0], merged[i][1]);
      target.appendChild(mark);
      cursor = merged[i][1];
    }
    if (cursor < text.length) {
      target.appendChild(document.createTextNode(text.slice(cursor)));
    }
  }

  // ---- rendering ----------------------------------------------------------

  function groupKey(hit) {
    // The peer's results form one group of their own rather than being spread through
    // this site's three: the useful distinction for a reader is "this is on the other
    // site" long before it is "this is an answer vs a symbol".
    if (hit.external) {
      return "peer";
    }

    return hit.record.g === G_ANSWER ? "answers" : hit.record.g === G_API ? "api" : "docs";
  }

  /**
   * The row's second line: where this result lives.
   *
   * A title on its own does not say whether "Verify" is a tutorial step, an agent
   * recipe or a section of a blog post — and after the caps, several rows can share
   * a heading. The URL path answers it in the fewest characters.
   */
  function host(url) {
    return String(url || "").replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  }

  function crumbs(record, external) {
    var path = record.u.split("#")[0].replace(/^\/+|\/+$/g, "");
    var parts = path ? path.split("/") : [];

    // A root URL has no path to show, so it shows its HOST. This used to be the literal
    // string "imqueue.org", which made imqueue.com's home page read
    // "imqueue.com › imqueue.org" as a peer result, and claim to be on imqueue.org when
    // viewed on imqueue.com itself.
    if (!parts.length) {
      return external ? host(peerOrigin) : host(window.location.host);
    }

    if (record.g === G_API) {
      // "api › core › latest › core.redisqueue.send" says the same thing three
      // times: the package is a field of the record and `latest` is an artefact of
      // the URL scheme, not information.
      return record.p + (parts.length > 2 ? " › " + parts[parts.length - 1] : "") +
        (record.d ? " · deprecated" : "");
    }

    return parts.join(" › ");
  }

  function row(hit, q, index, listbox) {
    var record = hit.record;
    var a = document.createElement("a");

    a.className = "s-hit s-hit--" + (hit.external ? "peer" : groupKey(hit));
    // Peer records hold URLs that are root-relative to THEIR site; on this one they would
    // point at pages that do not exist.
    a.href = hit.external ? peerOrigin + record.u : record.u;

    if (listbox) {
      a.id = "s-hit-" + index;
      a.setAttribute("role", "option");
      a.setAttribute("aria-selected", "false");
    }

    var head = document.createElement("span");

    head.className = "s-hit__title";
    highlight(head, record.t, q);

    if (record.g === G_API && record.k) {
      var kind = document.createElement("span");

      kind.className = "s-hit__kind";
      kind.textContent = record.k;
      head.appendChild(kind);
    }
    a.appendChild(head);

    var crumb = document.createElement("span");

    crumb.className = "s-hit__crumbs";
    // The host, so it is never a surprise that following this leaves the current site.
    // The peer's host prefixes its path, so following the row is never a surprise — but
    // only when there IS a path; for the peer's home page the host is the whole crumb.
    crumb.textContent = hit.external && record.u.split("#")[0].replace(/^\/+|\/+$/g, "")
      ? host(peerOrigin) + " › " + crumbs(record, true)
      : crumbs(record, hit.external);
    a.appendChild(crumb);

    var body = hit.section ? snippet(hit.section[S_TEXT], q, 190) : record.s;

    if (body) {
      var text = document.createElement("span");

      text.className = "s-hit__text";
      highlight(text, body, q);
      a.appendChild(text);
    }

    return a;
  }

  function resultsUrl(key, raw, page) {
    return "/search/?q=" + encodeURIComponent(raw) +
      (key ? "&g=" + key : "") +
      (page && page > 1 ? "&page=" + page : "");
  }

  function group(def, hits, q, offset, extra) {
    if (!hits.length) {
      return null;
    }

    var section = document.createElement("div");

    section.className = "s-group";

    var label = document.createElement("div");

    label.className = "s-group__label";
    label.textContent = def.label;
    section.appendChild(label);

    for (var i = 0; i < hits.length; i++) {
      section.appendChild(row(hits[i], q, offset + i, true));
    }

    // Only when the cap actually hid something. A group of six needs no "more",
    // and a link that leads to the same six results is worse than no link.
    if (extra > 0) {
      var more = document.createElement("a");

      more.className = "s-more";
      more.href = resultsUrl(def.key, q.raw);
      more.textContent = "All " + (hits.length + extra) + " results in " + def.label.toLowerCase() + " →";
      section.appendChild(more);
    }

    return section;
  }

  function render(q, hits) {
    el.results.textContent = "";
    state.results = [];
    state.active = -1;

    if (!q.terms.length) {
      el.status.textContent = "";
      el.hint.hidden = false;

      return;
    }
    el.hint.hidden = true;

    var buckets = { answers: [], docs: [], api: [], peer: [] };
    var extra = { answers: 0, docs: 0, api: 0, peer: 0 };

    for (var i = 0; i < hits.length; i++) {
      var key = groupKey(hits[i]);

      if (buckets[key].length < PER_GROUP) {
        buckets[key].push(hits[i]);
      } else {
        extra[key]++;
      }
    }

    var groups = GROUPS.map(function (def) {
      return [
        def.key === "peer" ? { key: "peer", label: peerLabel || "Elsewhere" } : def,
        buckets[def.key],
        extra[def.key],
      ];
    });

    // Grouped, but ORDERED BY RELEVANCE — by each group's best hit, not by a fixed
    // list. A static order looks tidy and lies: typing `watcherCheckDelay` scored
    // the property page 1008 and three prose mentions ~94, and rendering "Guides &
    // articles" first put all three above the page that documents the thing. The
    // grouping is worth keeping (a symbol and an article are different kinds of
    // answer); the fixed precedence is not.
    groups.sort(function (a, b) {
      // The peer group is pinned last, whatever it scored. Everything else is ordered by
      // its best hit, which is the rule that stopped three prose mentions of
      // `watcherCheckDelay` from sitting above the page documenting it.
      if ((a[0].key === "peer") !== (b[0].key === "peer")) {
        return a[0].key === "peer" ? 1 : -1;
      }

      var bestA = a[1].length ? a[1][0].score : -1;
      var bestB = b[1].length ? b[1][0].score : -1;

      return bestB - bestA;
    });

    state.results = groups.reduce(function (all, g) { return all.concat(g[1]); }, []);

    if (!state.results.length) {
      var empty = document.createElement("p");

      empty.className = "s-empty";
      empty.textContent = state.t2
        ? "Nothing matched. Try a symbol name (RedisQueue, callTimeout) or a shorter phrase."
        : "Nothing matched yet — still loading the full text of the docs.";
      el.results.appendChild(empty);
      el.status.textContent = "No results";
      queueReport(q, 0, "");

      return;
    }

    var offset = 0;

    for (i = 0; i < groups.length; i++) {
      var node = group(groups[i][0], groups[i][1], q, offset, groups[i][2]);

      if (node) {
        el.results.appendChild(node);
        offset += groups[i][1].length;
      }
    }

    el.status.textContent = state.results.length + (state.results.length === 1 ? " result" : " results");
    move(0);
    queueReport(q, hits.length, state.results[0] && state.results[0].record.u);
  }

  // ---- what gets measured -------------------------------------------------
  //
  // Zero-result queries are the most valuable output here: they are a ranked list
  // of documentation nobody has written yet. gtag only exists after a visitor has
  // accepted analytics (see _includes/consent.html), so this is consent-gated by
  // construction — there is no fallback path that sends anything without it.
  //
  // Truncated at the length GA4 would truncate at anyway, but done here so it reads as
  // a decision rather than a side effect: a search box is where people paste stack
  // traces, and nothing longer than a query is needed to learn from one.
  var MAX_TERM = 100;

  // How still the field must be before what is in it counts as a question somebody
  // asked. The dialog searches on every keystroke, so without this GA4 receives "ide",
  // "idem", "idemp", "idempo" — a report of prefixes nobody typed on purpose, with the
  // real query buried among its own fragments. The 110ms render debounce is about
  // feeling responsive and is deliberately far shorter than this.
  var SETTLE = 1200;

  var reported = "";
  var pending = null;
  var settleTimer = null;

  // The query whose results are on screen, so a click can be attributed to it.
  // Deliberately not named `shown`: renderPage has a local of that name.
  var onScreen = null;

  function capped(value) {
    return String(value === null || value === undefined ? "" : value).slice(0, MAX_TERM);
  }

  function send(entry) {
    if (!window.gtag || entry.raw.length < 3 || entry.raw === reported) {
      return;
    }
    reported = entry.raw;
    window.gtag("event", entry.count ? "search" : "search_no_results", {
      search_term: capped(entry.raw),
      results: entry.count,
      // What was offered, so a query nobody clicked is still interpretable: a wrong
      // top result and an empty result set are different failures.
      top_result: capped(entry.top),
    });
  }

  // /search/ reports immediately. That query arrived by form submit or in the URL, so
  // it is settled by definition and there are no prefixes to wait out.
  function report(q, count, top) {
    onScreen = { raw: q.raw, count: count, top: top };
    send(onScreen);
  }

  function queueReport(q, count, top) {
    onScreen = { raw: q.raw, count: count, top: top };
    pending = onScreen;
    clearTimeout(settleTimer);
    settleTimer = setTimeout(flushReport, SETTLE);
  }

  function flushReport() {
    clearTimeout(settleTimer);

    if (pending) {
      send(pending);
      pending = null;
    }
  }

  // Which result was taken, and from what position. This is the only signal here that
  // says whether the RANKING was right rather than merely what was asked, and it is
  // what would let real readers replace hand-written ground truth in
  // scripts/search-kpi/. Acting on a query settles it whatever the timer thinks, so
  // the search event is flushed first and always precedes its own click.
  function reportSelect(position, url) {
    flushReport();

    if (!window.gtag || !onScreen || onScreen.raw.length < 3) {
      return;
    }
    window.gtag("event", "search_select", {
      search_term: capped(onScreen.raw),
      results: onScreen.count,
      position: position,
      result_url: capped(url),
    });
  }

  // Delegated, so it covers every group and survives a re-render. Position is counted
  // over `.s-hit` in DOM order, which is the order the reader actually saw — the
  // "All N results" links carry `.s-more` and are correctly not results.
  function watchClicks(container) {
    if (!container) {
      return;
    }

    container.addEventListener("click", function (event) {
      var hit = event.target.closest ? event.target.closest(".s-hit") : null;

      if (hit) {
        reportSelect(
          Array.prototype.indexOf.call(container.querySelectorAll(".s-hit"), hit) + 1,
          hit.getAttribute("href")
        );
      }
    });
  }

  // ---- interaction --------------------------------------------------------

  function move(to) {
    var rows = el.results.querySelectorAll(".s-hit");

    if (!rows.length) {
      return;
    }

    var next = (to + rows.length) % rows.length;

    for (var i = 0; i < rows.length; i++) {
      rows[i].setAttribute("aria-selected", i === next ? "true" : "false");
      rows[i].classList.toggle("is-active", i === next);
    }
    state.active = next;
    el.input.setAttribute("aria-activedescendant", rows[next].id);
    rows[next].scrollIntoView({ block: "nearest" });
  }

  function run() {
    var q = parseQuery(el.input.value);

    state.q = q.raw;

    if (!q.terms.length && !q.filters.pkg && !q.filters.kind) {
      render(q, []);

      return;
    }
    // Tier 2 is worth its bytes once there is a query to spend them on, and it is
    // never awaited: tier-1 results paint now and the list re-ranks when the prose
    // corpus lands. This lives here rather than in the input handler so that a
    // query arriving any other way — `?q=` on load — gets the prose corpus too.
    // It did not, and a seeded search returned symbols only.
    if (q.raw.length > 1) {
      loadTier2();
    }
    render(q, search(q));
  }

  function load(url, key, then) {
    if (state["p" + key]) {
      return state["p" + key];
    }

    state["p" + key] = fetch(url, { credentials: "omit" })
      .then(function (response) {
        if (!response.ok) {
          throw new Error(url + " -> " + response.status);
        }

        return response.json();
      })
      .then(then)
      .catch(function (error) {
        // A failed index fetch must not leave a dead-looking box. Retry on the
        // next keystroke by clearing the memoised promise.
        state["p" + key] = null;
        // Guarded: `el` is only populated by build(), and both the /search/ page and
        // the scoped sidebar load indexes before any dialog exists. Unguarded, a failed
        // fetch on those pages threw a TypeError from inside this very catch — turning a
        // handled network error into an unhandled rejection, and losing the warning
        // below that says what actually happened.
        if (el.status) {
          el.status.textContent = "Search index unavailable";
        }
        if (window.console) window.console.warn("[search]", error);
      });

    return state["p" + key];
  }

  function loadTier1() {
    loadPeer();

    return load(TIER1, 1, function (index) {
      state.t1 = prepare(index);
      if (el.input && el.input.value) run();
    });
  }

  // Folded, squashed and counted once here, not once per keystroke: this is 640 KB of
  // prose, and doing it in the scorer made every keystroke re-normalize the whole
  // corpus. Stored as extra slots on each section and page tuple.
  // The lemmas of the words in one element whose surface form differs, deduplicated.
  // Only the DELTA needs to be here: a word that is already its own lemma is findable
  // in the surface text, which the literal pass has already searched.
  function lemmaStringOf(folded, map) {
    if (!map || !folded) {
      return "";
    }

    var words = folded.split(/[^a-z0-9]+/);
    var seen = Object.create(null);
    var out = [];

    for (var i = 0; i < words.length; i++) {
      var lemma = map[words[i]];

      if (lemma && !seen[lemma]) {
        seen[lemma] = 1;
        out.push(lemma);
      }
    }

    return out.join(" ");
  }

  function prepareSections(index) {
    {
      // Sanitised onto a null prototype and written back, so both readers — parseQuery's
      // `state.t2.lemmas` and lemmaStringOf below — are safe. JSON.parse builds ordinary
      // objects, so `lemmas["constructor"]` inherited a function that lemmaStringOf would
      // have joined into a section's lemma text as "function Object() { [native code] }".
      var map = Object.create(null);

      for (var key in index.lemmas) {
        if (Object.prototype.hasOwnProperty.call(index.lemmas, key)) {
          map[key] = index.lemmas[key];
        }
      }

      index.lemmas = map;
      // Document frequency: in how many SECTIONS a term appears at all. Presence per
      // section, not total occurrences — that is what makes it a measure of how
      // discriminating a word is rather than of how chatty a page is.
      var df = Object.create(null);

      for (var i = 0; i < index.sections.length; i++) {
        var section = index.sections[i];
        var folded = fold(section[S_TEXT]);
        var emphasis = fold(section[S_EMPH] || "");

        section[S_SQUASH] = squash(folded);
        section[S_FOLDED] = folded;
        section[S_HEADTOK] = idTokens(section[S_HEAD]);
        section[S_FOLDEMPH] = emphasis;
        section[S_NTOK] = folded ? folded.split(" ").length : 0;
        section[S_NEMPH] = emphasis ? emphasis.split(" ").length : 0;
        section[S_LEMHEAD] = lemmaStringOf(fold(section[S_HEAD]), map);
        section[S_LEMEMPH] = lemmaStringOf(emphasis, map);
        section[S_LEMBODY] = lemmaStringOf(folded, map);

        var seenHere = Object.create(null);
        var words = (folded + " " + fold(section[S_HEAD])).split(/[^a-z0-9]+/);

        for (var w = 0; w < words.length; w++) {
          if (words[w] && !seenHere[words[w]]) {
            seenHere[words[w]] = 1;
            df[words[w]] = (df[words[w]] || 0) + 1;
          }
        }
      }

      index.df = df;
      index.docs = index.sections.length;
      for (i = 0; i < index.pages.length; i++) {
        index.pages[i][P_FOLDED] = fold(index.pages[i][P_TITLE]);
        index.pages[i][P_NTOK] = idTokens(index.pages[i][P_TITLE]).length;
        index.pages[i][P_LEMMA] = lemmaStringOf(index.pages[i][P_FOLDED], map);
      }
    }

    return index;
  }

  function loadTier2() {
    return load(TIER2, 2, function (index) {
      state.t2 = prepareSections(index);
      if (el.input && el.input.value) run();
    });
  }

  // The peer's tiers. Failures are SWALLOWED, not surfaced: a peer index that was not built
  // — a local `npm run edition:org`, or a deploy whose peer build failed — is a supported
  // state, not an error, and "Search index unavailable" would be a lie about a search that
  // is working perfectly for this site.
  function loadPeer() {
    if (!peerOrigin || state.px1) {
      return;
    }

    state.px1 = fetch(PEER1, { credentials: "omit" })
      .then(function (response) { return response.ok ? response.json() : null; })
      .then(function (index) {
        if (index) {
          state.x1 = prepare(index);
          if (el.input && el.input.value) run();
        }
      })
      .catch(function () { /* no peer; this site's search is unaffected */ });

    state.px2 = fetch(PEER2, { credentials: "omit" })
      .then(function (response) { return response.ok ? response.json() : null; })
      .then(function (index) {
        if (index) {
          state.x2 = prepareSections(index);
          if (el.input && el.input.value) run();
        }
      })
      .catch(function () { /* same */ });

    return Promise.all([state.px1, state.px2]);
  }

  function build() {
    var dialog = document.createElement("dialog");

    dialog.className = "s-dialog";
    dialog.setAttribute("aria-label", "Search the documentation");
    dialog.innerHTML =
      '<form class="s-form" method="dialog">' +
      '<div class="s-bar">' +
      '<svg class="s-bar__icon" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-4.3-4.3"/></svg>' +
      '<input class="s-input" type="search" autocomplete="off" autocapitalize="off" spellcheck="false" ' +
      'placeholder="Search docs, articles and the API reference" aria-label="Search query" ' +
      'role="combobox" aria-expanded="true" aria-controls="s-results" aria-autocomplete="list">' +
      '<button class="s-close" type="submit" aria-label="Close search">esc</button>' +
      "</div>" +
      '<div class="s-results" id="s-results" role="listbox" aria-label="Search results"></div>' +
      '<p class="s-hint">Type a symbol (<code>RedisQueue.send</code>), a question ' +
      "(<code>does @imqueue retry?</code>) or a concept (<code>backpressure</code>). " +
      "Narrow with <code>pkg:rpc</code> or <code>kind:method</code>.</p>" +
      '<p class="s-status" role="status" aria-live="polite"></p>' +
      "</form>";

    document.body.appendChild(dialog);

    el.dialog = dialog;
    el.input = dialog.querySelector(".s-input");
    el.results = dialog.querySelector(".s-results");
    el.hint = dialog.querySelector(".s-hint");
    el.status = dialog.querySelector(".s-status");

    watchClicks(el.results);

    var timer = null;

    el.input.addEventListener("input", function () {
      clearTimeout(timer);
      timer = setTimeout(run, 110);
    });

    el.input.addEventListener("keydown", function (event) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        move(state.active + 1);
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        move(state.active - 1);
      } else if (event.key === "Enter") {
        var rows = el.results.querySelectorAll(".s-hit");

        if (rows.length && state.active >= 0) {
          event.preventDefault();
          reportSelect(state.active + 1, rows[state.active].href);
          window.location.href = rows[state.active].href;
        }
      }
    });

    // Clicking the backdrop closes it. `dialog` itself is the backdrop's element,
    // so a click whose target is the dialog and not its contents means outside.
    dialog.addEventListener("click", function (event) {
      if (event.target === dialog) {
        dialog.close();
      }
    });

    // Typing something and closing without clicking is an ABANDONED query, and that is
    // a result worth having — it is the shape of a search that returned nothing useful.
    // Without this flush it would be the one outcome that never reaches the report,
    // because it is exactly the case where the settle timer may not have fired yet.
    dialog.addEventListener("close", function () {
      document.documentElement.classList.remove("s-open");
      flushReport();
    });

    return dialog;
  }

  function open(seed) {
    // On /search/ the same intent — the nav button, ⌘K, "/" — means "let me type a
    // query", and there is already a field for that. Opening a modal over it would
    // put two search inputs on screen with different behaviour.
    if (pageHost) {
      var field = pageEl(pageHost, "input");

      if (seed) {
        field.value = seed;
      }
      field.focus();
      field.select();

      return;
    }

    var dialog = el.dialog || build();

    loadTier1();
    document.documentElement.classList.add("s-open");

    if (!dialog.open) {
      dialog.showModal();
    }
    if (seed) {
      el.input.value = seed;
      run();
    }
    el.input.focus();
    el.input.select();
  }

  function typing(target) {
    return target && (/^(?:INPUT|TEXTAREA|SELECT)$/.test(target.tagName) || target.isContentEditable);
  }

  // ---- browser wiring ------------------------------------------------------
  // Everything above is pure functions over two JSON files; everything below needs a
  // DOM. The guard is what lets Node require this file and exercise the ranker —
  // see scripts/check-search-ranking.js, which asserts the rankings that were argued
  // over rather than trusting that a screenshot still looks right.
  if (typeof document === "undefined") {
    module.exports = {
      parseQuery: parseQuery,
      prepare: prepare,
      prepareSections: prepareSections,
      search: search,
      groupKey: groupKey,
      state: state,
      FEED_V: FEED_V,
    };

    return;
  }

  document.addEventListener("click", function (event) {
    var trigger = event.target.closest("[data-search-open]");

    if (trigger) {
      event.preventDefault();
      open("");
    }
  });

  document.addEventListener("keydown", function (event) {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      open("");

      return;
    }
    // "/" is the convention on documentation sites, but only when it would
    // otherwise be a stray keystroke — never while someone is typing in a field.
    if (event.key === "/" && !event.metaKey && !event.ctrlKey && !event.altKey && !typing(event.target)) {
      event.preventDefault();
      open("");
    }
  });

  // Warm the index on intent rather than on load: hovering or tab-focusing the
  // trigger is a reliable signal, and it means the first keystroke has data.
  ["pointerenter", "focusin"].forEach(function (type) {
    document.addEventListener(type, function (event) {
      if (event.target.closest && event.target.closest("[data-search-open]")) {
        loadTier1();
      }
    }, true);
  });

  // ---- /search/ — the full, paged result list ------------------------------
  // The dialog shows the best five per group, which is the right size for "find the
  // page I mean". This is the other job: see everything that matched and walk it.
  // It runs the SAME ranker over the same two files — there is no second index and
  // no second scoring implementation to drift — and it is a static page that does
  // its work in the browser, so it needs no server.

  function pageEl(host, name) {
    return host.querySelector(".s-page__" + name);
  }

  function tab(def, count, active, raw) {
    var a = document.createElement("a");

    a.className = "s-tab" + (active ? " is-active" : "");
    a.href = resultsUrl(def.key, raw);
    a.textContent = def.label + " " + count;

    return a;
  }

  function pager(page, pages, key, raw) {
    var nav = document.createElement("nav");

    nav.className = "s-pager";
    nav.setAttribute("aria-label", "Result pages");

    if (pages < 2) {
      return nav;
    }

    var link = function (to, text, disabled, current) {
      var node = document.createElement(disabled ? "span" : "a");

      node.className = "s-pager__item" + (disabled ? " is-disabled" : "") + (current ? " is-current" : "");
      node.textContent = text;

      if (!disabled) {
        node.href = resultsUrl(key, raw, to);
      }
      if (current) {
        node.setAttribute("aria-current", "page");
      }

      return node;
    };

    nav.appendChild(link(page - 1, "← prev", page === 1));

    // A window around the current page, with the first and last always reachable —
    // 58 pages of numbers would be its own navigation problem.
    var from = Math.max(1, Math.min(page - 2, pages - 4));
    var to = Math.min(pages, Math.max(page + 2, 5));

    if (from > 1) {
      nav.appendChild(link(1, "1", false, page === 1));
      if (from > 2) {
        nav.appendChild(link(0, "…", true));
      }
    }
    for (var n = from; n <= to; n++) {
      nav.appendChild(link(n, String(n), false, n === page));
    }
    if (to < pages) {
      if (to < pages - 1) {
        nav.appendChild(link(0, "…", true));
      }
      nav.appendChild(link(pages, String(pages), false, page === pages));
    }

    nav.appendChild(link(page + 1, "next →", page === pages));

    return nav;
  }

  function renderPage(host) {
    var params = new URLSearchParams(window.location.search);
    var raw = params.get("q") || "";
    var key = params.get("g") || "";
    var page = Math.max(1, parseInt(params.get("page"), 10) || 1);
    var results = pageEl(host, "results");
    var status = pageEl(host, "status");
    var tabs = pageEl(host, "tabs");
    var input = pageEl(host, "input");

    input.value = raw;
    results.textContent = "";
    tabs.textContent = "";

    var q = parseQuery(raw);

    if (!q.terms.length && !q.filters.pkg && !q.filters.kind) {
      status.textContent = raw ? "Nothing to search for." : "Type something to search for.";

      return;
    }

    document.title = "Search: " + raw + " · @imqueue";

    var hits = search(q);
    var counts = { answers: 0, docs: 0, api: 0, peer: 0 };

    for (var i = 0; i < hits.length; i++) {
      counts[groupKey(hits[i])]++;
    }

    var shown = key ? hits.filter(function (hit) { return groupKey(hit) === key; }) : hits;
    var pages = Math.max(1, Math.ceil(shown.length / PER_PAGE));

    page = Math.min(page, pages);

    var all = document.createElement("a");

    all.className = "s-tab" + (key ? "" : " is-active");
    all.href = resultsUrl("", raw);
    all.textContent = "Everything " + hits.length;
    tabs.appendChild(all);

    for (i = 0; i < GROUPS.length; i++) {
      var def = GROUPS[i].key === "peer" ? { key: "peer", label: peerLabel || "Elsewhere" } : GROUPS[i];

      if (counts[def.key]) {
        tabs.appendChild(tab(def, counts[def.key], key === def.key, raw));
      }
    }

    if (!shown.length) {
      var empty = document.createElement("p");

      empty.className = "s-empty";
      empty.textContent =
        "Try a symbol name (RedisQueue, callTimeout), a shorter phrase, or narrow with pkg:rpc.";
      status.textContent = "Nothing matched “" + raw + "”.";
      results.appendChild(empty);
      report(q, 0, "");

      return;
    }

    var first = (page - 1) * PER_PAGE;
    var slice = shown.slice(first, first + PER_PAGE);

    status.textContent = shown.length + (shown.length === 1 ? " result" : " results") +
      (pages > 1 ? " · showing " + (first + 1) + "–" + (first + slice.length) : "");

    for (i = 0; i < slice.length; i++) {
      results.appendChild(row(slice[i], q, i, false));
    }

    host.appendChild(pager(page, pages, key, raw));
    report(q, hits.length, shown[0] && shown[0].record.u);
  }

  // ---- scoped host: one part of the site, from a sidebar --------------------
  // The blog's "Search posts" box. It was a THIRD search implementation — 37 lines of
  // inline script in blog/index.html running indexOf() over title + summary + topics
  // from /blog/search-index.json — and two things were wrong with it beyond the
  // duplication. `haystack.indexOf(query)` tests the WHOLE query as one substring, so it
  // was a phrase match: "redis queue" found nothing, because no title or summary carries
  // those two words adjacent. And post bodies were never in that feed, so "idempotency"
  // and "retries" found nothing either. Seven of fourteen ordinary queries returned
  // nothing while this ranker answered all fourteen.
  //
  // Scoped by filtering RESULTS, not by indexing a subset. A blog-only corpus would
  // compute df over 29 pages instead of 86, so every idf — and therefore the ranking —
  // would drift from what scripts/search-kpi/ measures. Filtering after the ranker has
  // run leaves the measured behaviour exactly intact.
  //
  // `kind:article` cannot do this job either. It is an exact match against the
  // overloaded record.k (the kind on a page record, the parent page's TITLE on an answer
  // record), and it switches tier 2 off — see collect() — which is precisely the post
  // body that makes "idempotency" findable.

  var SCOPE_MAX = 8;
  var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  // Formatted from the ISO parts rather than through `new Date`, which would shift the
  // day for every reader west of UTC — "2026-08-12" parses as midnight UTC.
  function isoDate(iso) {
    var parts = String(iso || "").split("-");

    if (parts.length !== 3) {
      return "";
    }

    return MONTHS[Number(parts[1]) - 1] + " " + Number(parts[2]) + ", " + parts[0];
  }

  // The page URLs of one kind. Tier 2's page tuples are the only place the corpus
  // records what a page IS, and this is cached against the identity of that array.
  var scopeCache = { pages: null, kind: "", urls: null };

  function urlsOfKind(kind) {
    var pages = state.t2 && state.t2.pages;

    if (!pages) {
      return null;
    }
    if (scopeCache.pages === pages && scopeCache.kind === kind) {
      return scopeCache.urls;
    }

    var urls = {};

    for (var i = 0; i < pages.length; i++) {
      if (pages[i][P_KIND] === kind) {
        urls[pages[i][P_URL]] = 1;
      }
    }

    scopeCache = { pages: pages, kind: kind, urls: urls };

    return urls;
  }

  function scopedHost(host) {
    var kind = host.getAttribute("data-search-scope");
    var datesUrl = host.getAttribute("data-search-dates");
    var input = host.querySelector("[data-scope-input]");
    var out = host.querySelector("[data-scope-results]");
    var note = host.querySelector("[data-scope-note]");
    var dates = null;
    var started = false;
    var timer = null;

    if (!kind || !input || !out || !note) {
      return;
    }

    function say(message) {
      note.textContent = message;
      note.hidden = !message;
    }

    function row(hit) {
      var page = hit.record.u.split("#")[0];
      var deep = hit.record.u !== page;
      var li = document.createElement("li");
      var a = document.createElement("a");
      var meta = document.createElement("span");

      a.href = hit.record.u;
      // `record.t` is already the right label for both shapes: collect() builds a section
      // hit with the matched HEADING as its title, and a page record carries the page
      // title. So a section hit leads with the heading the link lands on — the part that
      // answers the query, rather than the post title repeating down the whole list.
      a.textContent = hit.record.t;
      // Which is why the meta line differs: a heading needs the post it belongs to, or
      // the result is a fragment with no context. A whole-post hit keeps the date, which
      // is what this box showed before.
      meta.className = "meta";
      meta.textContent = deep
        ? (hit.record._page || hit.record.k || "")
        : isoDate(dates && dates[page]);

      if (meta.textContent) {
        a.appendChild(meta);
      }
      li.appendChild(a);

      return li;
    }

    function draw() {
      var raw = input.value.trim();

      out.textContent = "";

      if (!raw) {
        say("");

        return;
      }
      if (!state.t1 || !state.t2) {
        say(state.p1 === null || state.p2 === null ? "Search is unavailable." : "Loading…");

        return;
      }

      var urls = urlsOfKind(kind);
      var q = parseQuery(raw);

      if (!q.terms.length) {
        say("Nothing to search for.");

        return;
      }

      var hits = search(q).filter(function (hit) {
        return !hit.external && urls[hit.record.u.split("#")[0]];
      });

      if (!hits.length) {
        say("No posts match “" + raw + "”.");

        return;
      }

      say("");
      hits = hits.slice(0, SCOPE_MAX);

      for (var i = 0; i < hits.length; i++) {
        out.appendChild(row(hits[i]));
      }
    }

    function start() {
      if (started) {
        return;
      }

      started = true;

      // Both tiers: tier 1 alone would answer titles and summaries only, which is the
      // behaviour this replaced. Not the peer index — the other edition has no posts.
      Promise.all([loadTier1(), loadTier2()]).then(draw);

      if (datesUrl) {
        // Post dates are not in the search corpus. This feed is 12 KB, llms.txt already
        // publishes it for agents, and a failure here costs a meta line and nothing else.
        dates = {};
        fetch(datesUrl, { credentials: "omit" })
          .then(function (response) { return response.ok ? response.json() : []; })
          .then(function (posts) {
            for (var i = 0; i < posts.length; i++) {
              dates[posts[i].url] = posts[i].date;
            }

            draw();
          })
          .catch(function () {});
      }
    }

    input.addEventListener("focus", start);
    input.addEventListener("input", function () {
      start();
      clearTimeout(timer);
      timer = setTimeout(draw, 110);
    });

    // Deliberately NOT reported to analytics. The dialog and /search/ send one `search`
    // event shape, and mixing a corpus-of-29 sidebar query into it would make the
    // site-wide numbers mean two different things with no parameter to tell them apart.
    // Reporting this surface needs its own dimension registered first.
  }

  var peerMeta = document.querySelector('meta[name="search-peer"]');
  var labelMeta = document.querySelector('meta[name="search-peer-label"]');

  peerOrigin = peerMeta ? String(peerMeta.getAttribute("content") || "").replace(/\/+$/, "") : "";
  peerLabel = labelMeta ? labelMeta.getAttribute("content") || "" : "";

  pageHost = document.querySelector("[data-search-page]");

  if (pageHost) {
    // Both tiers, because this page shows everything and a half-loaded list that
    // silently grows would be worse than a moment's wait.
    pageEl(pageHost, "status").textContent = "Searching…";
    // The peer is awaited here, unlike in the dialog: this page shows everything, and a
    // list that silently grows a group a second later is worse than a moment's wait.
    // `loadPeer` never rejects, so a missing peer cannot hold the page.
    Promise.all([loadTier1(), loadTier2(), loadPeer()]).then(function () {
      renderPage(pageHost);
    });

    // Attached to the container rather than to the rows, so it survives every
    // re-render this page does — a tab switch, a page of the pager, a refined query.
    watchClicks(pageEl(pageHost, "results"));

    pageHost.addEventListener("submit", function (event) {
      event.preventDefault();
      // Straight to the URL, so a refined search is a real, shareable page and the
      // back button walks the searches somebody actually ran.
      window.location.href = resultsUrl("", pageEl(pageHost, "input").value.trim());
    });
  } else {
    // ?q= on any other page opens the dialog with the query already run, so a link
    // into search works from anywhere.
    var seed = new URLSearchParams(window.location.search).get("q");

    if (seed) {
      loadTier1();
      open(seed);
    }
  }

  // Independent of the branch above: a scoped box is a sidebar on an ordinary page, and
  // there may be more than one of them.
  var scopes = document.querySelectorAll("[data-search-scope]");

  for (var s = 0; s < scopes.length; s++) {
    scopedHost(scopes[s]);
  }
})();
