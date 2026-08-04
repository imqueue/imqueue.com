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

  // Results from the other site are de-weighted so they can never outrank a page of the
  // site you are actually on at comparable relevance. Not hidden, not excluded: somebody
  // reading the docs who searches "pricing" should be offered the pricing page, and
  // somebody on the commercial site searching "callTimeout" should be offered the
  // reference — just never ahead of a local page that answers as well.
  var PEER_WEIGHT = 0.8;

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
  var E = {
    title: 430,
    header: 360,
    emphasis: 200,
    // Curated `keywords` front matter: the author stating which queries this page exists to
    // answer. BELOW emphasis deliberately. Google has ignored <meta name="keywords"> since
    // 2009 and Bing treats a stuffed one as a spam signal — because neither can trust the
    // author. This index can: the author is the site. What does not change is that a
    // self-declared list is cheap to pad, so it sits under the signals that cost something
    // to fake and is scored on COVERAGE ONLY (see keywordScore).
    keywords: 300,
    body: 120,
  };

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
  var STOP_WEIGHT = 0.15;
  var STOP = {};

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
      }
    }
    if (!matched) {
      return 0;
    }

    var coverage = matched / q.weightSum;
    var density = Math.min(1, (occurrences / Math.max(tokenCount, 1)) * DENSITY_SATURATION);
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
    } else if (fold(lastSegment(lower)) === q.joined) {
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

    var matched = 0;

    for (var i = 0; i < q.terms.length; i++) {
      var hit = scanFor(record._w, q.terms[i], q.whole[i]);

      if (!hit.n && q.lemmas[i]) {
        hit = scanFor(record._w, q.lemmas[i], true);
      }
      if (hit.n) {
        matched += q.weights[i];
      }
    }

    return matched ? E.keywords * Math.min(1, q.weightSum ? matched / q.weightSum : 0) : 0;
  }

  function scoreRecord(record, q) {
    if (q.filters.pkg && fold(record.p || "").indexOf(q.filters.pkg) === -1) {
      return 0;
    }
    if (q.filters.kind && fold(record.k || "") !== q.filters.kind) {
      return 0;
    }

    // Coverage floor. Matching ONE term of a four-term question is not a result:
    // "does @imqueue retry a failed call?" matched 57 answers and 151 sections,
    // most of them on the word "@imqueue" alone, which is in half the corpus. A
    // long query has to be met at least halfway.
    if (q.content >= 3) {
      var found = 0;

      for (var t = 0; t < q.terms.length; t++) {
        if (q.weights[t] === 1 &&
          (record._l.indexOf(q.terms[t]) !== -1 || record._s.indexOf(q.terms[t]) !== -1 ||
            (record._w && record._w.indexOf(q.terms[t]) !== -1))) {
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
      elementScore(E.body, record._s, record._sn, q, "");

    if (score < MIN_SCORE) {
      return 0;
    }

    if (record.g === G_API) {
      score += KIND_BONUS[record.k] || 0;
      // A question is almost never answered by a signature page.
      if (q.question) score *= 0.6;
      if (record.d) score *= 0.35;
    } else if (record.g === G_ANSWER) {
      score *= q.question ? 1.55 : 1.1;
    } else if (EDITORIAL[record.k] && !q.question) {
      score *= BLOG_WEIGHT;
    }

    return score;
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
    var hits = 0;
    var contentHits = 0;

    for (var i = 0; i < q.terms.length; i++) {
      var term = q.terms[i];

      var probe = q.lemmas[i] || term;

      if (scanFor(head, term, q.whole[i]).n || scanFor(text, term, q.whole[i]).n ||
        scanFor(section[S_FOLDEMPH], term, q.whole[i]).n ||
        scanFor(section[S_LEMBODY], probe, true).n || scanFor(section[S_LEMHEAD], probe, true).n) {
        hits++;

        if (q.weights[i] === 1) {
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
    collect(hits, state.x1, state.x2, q, PEER_WEIGHT, true);

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
      return b.score - a.score ||
        a.record.t.length - b.record.t.length ||
        a.record.u.length - b.record.u.length;
    });

    // At most MAX.perPage results from one page. Without this a query matching a
    // long comparison article returns that article eight times and buries
    // everything else — the list stops being a list of answers.
    var perPage = {};
    var seen = {};
    var kept = [];

    for (i = 0; i < hits.length; i++) {
      var hit = hits[i];
      var url = hit.key;
      var pageUrl = (hit.external ? "x" : "") + hit.record.u.split("#")[0];

      if (seen[url]) {
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
  function crumbs(record) {
    var path = record.u.split("#")[0].replace(/^\/+|\/+$/g, "");
    var parts = path ? path.split("/") : [];

    if (record.g === G_API) {
      // "api › core › latest › core.redisqueue.send" says the same thing three
      // times: the package is a field of the record and `latest` is an artefact of
      // the URL scheme, not information.
      return record.p + (parts.length > 2 ? " › " + parts[parts.length - 1] : "") +
        (record.d ? " · deprecated" : "");
    }

    return parts.length ? parts.join(" › ") : "imqueue.org";
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
    crumb.textContent = hit.external
      ? peerOrigin.replace(/^https?:\/\//, "") + " › " + crumbs(record)
      : crumbs(record);
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
      report(q, 0);

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
    report(q, hits.length);
  }

  // Zero-result queries are the most valuable output here: they are a ranked list
  // of documentation nobody has written yet. gtag only exists after a visitor has
  // accepted analytics (see _includes/consent.html), so this is consent-gated by
  // construction — there is no fallback path that sends anything without it.
  var reported = "";

  function report(q, count) {
    if (!window.gtag || q.raw.length < 3 || q.raw === reported) {
      return;
    }
    reported = q.raw;
    window.gtag("event", count ? "search" : "search_no_results", {
      search_term: q.raw,
      results: count,
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
        el.status.textContent = "Search index unavailable";
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
    var seen = {};
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
      var map = index.lemmas;

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
      }
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

  // The peer's tiers. Failures are SWALLOWED, not surfaced: a peer index that was not
  // built (production still on `build:org`, or a local single-edition build) is the normal
  // case, not an error, and "Search index unavailable" would be a lie about a search that
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

    dialog.addEventListener("close", function () {
      document.documentElement.classList.remove("s-open");
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
      report(q, 0);

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
    report(q, hits.length);
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
})();
