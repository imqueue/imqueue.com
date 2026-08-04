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

  // Groups, as written by the generator.
  var G_DOC = 0;
  var G_API = 1;
  var G_ANSWER = 2;

  var W = {
    exact: 1000,      // the whole name/title IS the query
    lastSeg: 700,     // "send" for RedisQueue.send
    prefix: 500,
    substring: 320,
    squashed: 250,   // "backpressure" vs "Back-pressure": real, but weaker evidence
    allTerms: 240,    // every query term present, in any order
    someTerms: 90,    // partial coverage, scaled
    summaryTerm: 22,
    summaryCap: 60,   // rule 1: one field cannot outrank a whole-name match
    headingTerm: 90,
    bodyTerm: 14,
    bodyCap: 130,
    phrase: 80,       // the query appears verbatim
    allTermsBonus: 55,
  };

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

  // Dropped from term matching, kept in the phrase. Without this, "does @imqueue
  // retry a failed call?" scored 170 prose sections — every section containing
  // "does", "a" or "call" — and the third result was an author page that happened
  // to contain the word "does". The interrogative words are in here too: they
  // decide the query's SHAPE (see `question` below), they are not content.
  var STOP = {};

  ("a an and are as at be been but by can could did do does for from had has have how i if in into is it its "
    + "must my no not of on or should so than that the their then there these they this to was we what when where "
    + "which who why will with would you your").split(" ").forEach(function (word) { STOP[word] = 1; });

  var GROUPS = [
    { key: "answers", label: "Answers" },
    { key: "docs", label: "Guides & articles" },
    { key: "api", label: "API reference" },
  ];

  // Ten per group in the dialog; anything beyond that is behind a link to /search/,
  // which pages through the whole group. At most two results from one page, or a
  // query matching a long comparison article returns that article eight times and
  // buries everything else.
  var PER_GROUP = 10;
  var PER_PAGE = 20;
  var MAX = { perPage: 2 };

  // Below this a "match" is one weak term hit and showing it costs more than the
  // blank space it fills.
  var MIN_SCORE = 34;

  var state = { t1: null, t2: null, p1: null, p2: null, q: "", results: null, active: -1 };
  var el = {};

  // Set at the bottom, once the DOM is there (this script is deferred). Non-null
  // only on /search/, where the page owns a search field of its own and the modal
  // would be a second one stacked on top of it.
  var pageHost = null;

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
    var content = t.filter(function (term) { return !STOP[term]; });

    return {
      raw: text,
      joined: fold(text).replace(/\s+/g, " ").trim(),
      squashed: squash(fold(text)),
      // Falling back to the unfiltered list matters for a query that is ALL
      // stopwords — "how do I" — which should still search rather than go blank.
      terms: content.length ? content : t,
      filters: filters,
      question: /\?\s*$/.test(text) || QUESTION_WORD.test(fold(text)),
    };
  }

  // ---- scoring ------------------------------------------------------------

  function nameScore(record, q) {
    var lower = record._l;
    var direct = 0;

    if (lower === q.joined) {
      direct = W.exact;
    } else if (fold(lastSegment(lower)) === q.joined) {
      direct = W.lastSeg;
    } else if (lower.indexOf(q.joined) === 0) {
      direct = W.prefix;
    } else if (q.joined.length > 2 && lower.indexOf(q.joined) !== -1) {
      direct = W.substring;
    } else if (q.squashed.length > 4 && record._q.indexOf(q.squashed) !== -1) {
      // Scored below a literal substring hit: it is a weaker kind of evidence.
      direct = W.squashed;
    }

    // Per-term coverage over the identifier's own tokens. Prefix counts as a hit
    // (typing "watcher" should reach watcherCheckDelay) but scores below exact.
    var hits = 0;
    var tokens = record._t;

    for (var i = 0; i < q.terms.length; i++) {
      var term = q.terms[i];
      var exact = false;
      var prefix = false;

      for (var j = 0; j < tokens.length; j++) {
        if (tokens[j] === term) { exact = true; break; }
        if (tokens[j].indexOf(term) === 0) { prefix = true; }
      }

      if (exact) hits += 1;
      else if (prefix) hits += 0.8;
      else if (lower.indexOf(term) !== -1) hits += 0.45;
    }

    var coverage = q.terms.length ? hits / q.terms.length : 0;
    var byTerms = coverage >= 1
      ? W.allTerms + W.allTermsBonus
      : coverage * W.someTerms;

    return Math.max(direct, byTerms);
  }

  // Takes text that is ALREADY folded (prepare() does it once per record), because
  // this runs 1,325 times per keystroke and folding here made it 1,325 normalize()
  // calls per keystroke instead of once per build of the index.
  function fieldScore(lower, q, perTerm, cap) {
    if (!lower) {
      return 0;
    }

    var score = 0;

    for (var i = 0; i < q.terms.length; i++) {
      if (lower.indexOf(q.terms[i]) !== -1) {
        score += perTerm;
      }
    }
    if (q.joined.length > 3 && lower.indexOf(q.joined) !== -1) {
      score += W.phrase;
    }

    return Math.min(score, cap);
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
    if (q.terms.length >= 3) {
      var found = 0;

      for (var t = 0; t < q.terms.length; t++) {
        if (record._l.indexOf(q.terms[t]) !== -1 || record._s.indexOf(q.terms[t]) !== -1) {
          found++;
        }
      }
      if (found < 2) {
        return 0;
      }
    }

    var score = nameScore(record, q) + fieldScore(record._s, q, W.summaryTerm, W.summaryCap);

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

  function scoreSection(section, q, pageKind) {
    var lowerText = section[5];
    var lowerHead = fold(section[2]);
    var hits = 0;
    var score = 0;

    for (var i = 0; i < q.terms.length; i++) {
      var term = q.terms[i];
      var inHead = lowerHead.indexOf(term) !== -1;
      var at = lowerText.indexOf(term);

      if (inHead) {
        score += W.headingTerm;
      }
      if (at !== -1) {
        // Damped frequency: a section that says "queue" nine times is not nine
        // times more relevant, and without damping long pages win everything.
        var occurrences = lowerText.split(term).length - 1;

        score += W.bodyTerm * (1 + Math.log(Math.min(occurrences, 12)));
      }
      if (inHead || at !== -1) {
        hits += 1;
      }
    }

    // Hyphenation, in the body this time: the back-pressure article says
    // "back-pressure" throughout and nobody types the hyphen. Only consulted when
    // the ordinary term pass found nothing, because it cannot report WHERE it
    // matched and so contributes no snippet position.
    if (!hits && q.squashed.length > 4 && section[4].indexOf(q.squashed) !== -1) {
      return W.squashed * 0.5;
    }

    // Same coverage floor as scoreRecord, for the same reason.
    if (!hits || (q.terms.length >= 3 && hits < 2)) {
      return 0;
    }
    // Every term present, and better still present verbatim.
    if (hits === q.terms.length && q.terms.length > 1) {
      score *= 1.5;
    }
    if (q.joined.length > 3 && lowerText.indexOf(q.joined) !== -1) {
      score += W.phrase;
    }

    score = Math.min(score, W.bodyCap + W.headingTerm * q.terms.length + W.phrase);

    if (EDITORIAL[pageKind] && !q.question) {
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
    }

    return index;
  }

  function search(q) {
    var hits = [];
    var i;

    if (state.t1) {
      for (i = 0; i < state.t1.records.length; i++) {
        var record = state.t1.records[i];
        var score = scoreRecord(record, q);

        if (score > 0) {
          hits.push({ score: score, record: record, section: null });
        }
      }
    }

    if (state.t2 && !q.filters.pkg && !q.filters.kind) {
      for (i = 0; i < state.t2.sections.length; i++) {
        var section = state.t2.sections[i];
        var page = state.t2.pages[section[0]];
        var sectionScore = scoreSection(section, q, page[2]);

        if (sectionScore > 0) {
          hits.push({
            score: sectionScore,
            section: section,
            record: {
              g: G_DOC,
              t: section[2] || page[1],
              u: section[1] ? page[0] + "#" + section[1] : page[0],
              s: "",
              k: page[2],
              _page: page[1],
            },
          });
        }
      }
    }

    // One URL, one result — but an ANSWER and a prose section can be the same
    // heading seen twice, and then the answer's presentation is the one that
    // helps: it is the record that renders under "Answers" with the answer text.
    // Before this, the section outscored it and "Does @imqueue retry a failed RPC
    // call?" was returned as an ordinary article hit with the Answers group empty.
    var byUrl = {};

    for (i = 0; i < hits.length; i++) {
      var previous = byUrl[hits[i].record.u];

      if (!previous) {
        byUrl[hits[i].record.u] = hits[i];
        continue;
      }

      var winner = hits[i].record.g === G_ANSWER && previous.record.g !== G_ANSWER ? hits[i] : previous;

      winner.score = Math.max(hits[i].score, previous.score);
      byUrl[hits[i].record.u] = winner;
    }

    hits = Object.keys(byUrl).map(function (url) { return byUrl[url]; });

    hits.sort(function (a, b) { return b.score - a.score || a.record.u.length - b.record.u.length; });

    // At most MAX.perPage results from one page. Without this a query matching a
    // long comparison article returns that article eight times and buries
    // everything else — the list stops being a list of answers.
    var perPage = {};
    var seen = {};
    var kept = [];

    for (i = 0; i < hits.length; i++) {
      var hit = hits[i];
      var url = hit.record.u;
      var pageUrl = url.split("#")[0];

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
    var at;

    for (i = 0; i < q.terms.length; i++) {
      var term = q.terms[i];

      if (term.length < 2) {
        continue;
      }
      at = lower.indexOf(term);

      while (at !== -1) {
        marks.push([at, at + term.length]);
        at = lower.indexOf(term, at + term.length);
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

  function groupKey(record) {
    return record.g === G_ANSWER ? "answers" : record.g === G_API ? "api" : "docs";
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

    a.className = "s-hit s-hit--" + groupKey(record);
    a.href = record.u;

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
    crumb.textContent = crumbs(record);
    a.appendChild(crumb);

    var body = hit.section ? snippet(hit.section[3], q, 190) : record.s;

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

    var buckets = { answers: [], docs: [], api: [] };
    var extra = { answers: 0, docs: 0, api: 0 };

    for (var i = 0; i < hits.length; i++) {
      var key = groupKey(hits[i].record);

      if (buckets[key].length < PER_GROUP) {
        buckets[key].push(hits[i]);
      } else {
        extra[key]++;
      }
    }

    var groups = GROUPS.map(function (def) { return [def, buckets[def.key], extra[def.key]]; });

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
    return load(TIER1, 1, function (index) {
      state.t1 = prepare(index);
      if (el.input && el.input.value) run();
    });
  }

  function loadTier2() {
    return load(TIER2, 2, function (index) {
      // Folded and squashed once here, not once per keystroke: this is 640 KB of
      // prose and doing it in the scorer made every keystroke re-normalize the
      // whole corpus. Stored as extra slots on each section tuple.
      for (var i = 0; i < index.sections.length; i++) {
        var folded = fold(index.sections[i][3]);

        index.sections[i][4] = squash(folded);
        index.sections[i][5] = folded;
      }
      state.t2 = index;
      if (el.input && el.input.value) run();
    });
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
  // The dialog shows the best ten per group, which is the right size for "find the
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
    var counts = { answers: 0, docs: 0, api: 0 };

    for (var i = 0; i < hits.length; i++) {
      counts[groupKey(hits[i].record)]++;
    }

    var shown = key ? hits.filter(function (hit) { return groupKey(hit.record) === key; }) : hits;
    var pages = Math.max(1, Math.ceil(shown.length / PER_PAGE));

    page = Math.min(page, pages);

    var all = document.createElement("a");

    all.className = "s-tab" + (key ? "" : " is-active");
    all.href = resultsUrl("", raw);
    all.textContent = "Everything " + hits.length;
    tabs.appendChild(all);

    for (i = 0; i < GROUPS.length; i++) {
      if (counts[GROUPS[i].key]) {
        tabs.appendChild(tab(GROUPS[i], counts[GROUPS[i].key], key === GROUPS[i].key, raw));
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

  pageHost = document.querySelector("[data-search-page]");

  if (pageHost) {
    // Both tiers, because this page shows everything and a half-loaded list that
    // silently grows would be worse than a moment's wait.
    pageEl(pageHost, "status").textContent = "Searching…";
    Promise.all([loadTier1(), loadTier2()]).then(function () {
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
