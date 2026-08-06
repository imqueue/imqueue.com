# Search relevance KPI

A number that says whether a change to the ranker made search better or worse, measured
before we have any query logs of our own.

```bash
npm run kpi:search          # the numbers — all three sets
npm run kpi:search:worst    # plus the 40 worst misses, with what was expected
npm run kpi:compare         # this working tree's ranker vs the pinned one, with significance
```

Both query sets are committed, so the measurement is reproducible and a change in the number
means a change in the ranker. Regenerate them only deliberately:

```bash
npm run kpi:search:harvest  # re-harvest natural queries from Google autocomplete, re-judge
npm run kpi:search:gen      # regenerate the 10,000 artificial queries from current content
```

## The metric

Position 1 scores 100%, and every position below it costs 10 points, so position 11 and
"not returned at all" both score 0. Nobody scrolls to the eleventh row of a site search.

**nDCG@10 is reported next to it**, and is the standard one. The linear −10 metric above is this
project's own and it overstates the difference between #5 and #7 while understating #1 against #2;
nDCG's log discount is closer to how clicks actually fall off. Both are printed because they
disagree in a useful direction: a change that lifts a query from #4 to #2 is +20 of 100 in accuracy
terms and a large nDCG move.

One relevant document per query, deliberately — `expect` lists *alternatives*, so the ideal ranking
puts one of them first, not all of them. Summing gains over the alternatives (textbook DCG) would
reward a ranker for returning three spellings of the same answer.

Position is read from the flat merged list — what `/search/` renders as "Everything". The
dialog also splits results into Answers/Docs/API groups, so a hit at flat position 4 can be
the first row of its own group there. Flat position is the pessimistic reading and the one
that stays comparable when grouping changes.

## Four sets, because they answer different questions

**Intent** (`data/intent-queries.json`, 19 queries across 12 topics — `npm run kpi:intent`).
**Flagged HIGH IMPORTANCE**, and the only set whose queries were not written to be a test: every
one was really sent to `search_docs` while building a working @imqueue application, in the order
it was sent, because the next line of code could not be written without the answer. See *The
intent set* below.

**Natural** (`data/natural-queries.json`, 3,367 harvested → 2,281 scored). Real completions
from Google's suggest endpoint, seeded from the site's topics and expanded a–z so the wording
is the public's, not ours. Ground truth is assigned by hand-written topic rules in
`judge-natural.js`, written by reading the page inventory — never by running a query and
keeping whatever came back.

**Artificial** (`data/artificial-queries.json`, 10,000 + 499 typo variants). Generated from
the site's own titles, headings, `keywords` front matter, summaries, API identifiers and
prose. Ground truth is free: a query built from page P should return P.

**Question** (`data/question-queries.json`, 115 across 18 topics — `npm run kpi:questions`).
Whole spoken questions: *"how do I make a method callable from another service?"* Written by an
assistant from the page inventory, because that is the population being measured — a developer
asks an assistant, and the assistant sends this to `search_docs`.

The artificial set is optimistic by construction — every query uses the site's own
vocabulary, so it cannot measure the thing that actually breaks a site search, which is a
reader who does not know the words. **Read natural as the real number and artificial as a
regression detector.**

### Why the question set had to exist

The first two sets cover two query *shapes*, and both were blind to a third. Neither contains a
single question word: natural is autocomplete keywords (2–5 words), artificial is identifiers.

That blindness had a cost. When `@imqueue/mcp` was moved onto this ranker, recall@6 on the
agent-shaped slice went **83.9% → 99.5%** and natural did not move — and on chat-shaped
questions the new ranker scored **65.8% against the 73.3%** of the ranker it replaced. A
regression that neither set could see, found only because the MCP server's smoke test happens to
hard-code two such questions.

That 12-case figure is now superseded, and this set is what superseded it: over 115 labelled
questions the switch is a **10.4-point gain**, not a loss. See *Both rankers, side by side* below
— the direction reversed, which is the whole reason a set of twelve is not allowed to decide
anything.

What it measures: a long question is mostly words the corpus shares — *how, do, I, a, service,
imqueue* — so the one discriminating word has to carry it. When it does not, records whose
headings are themselves questions win on the question **template**. `rpc.expose` scores 1020 and
ranks **#1** for `expose`, 258 and #9 for "expose a method on a service", and **88 and #108** for
"How do I expose a method on an @imqueue service?".

**Why its labels can be trusted**, which is the hard part of any generated set:

1. Written from the **page inventory**, never from a ranker's output — the rule
   `judge-natural.js` states. A label taken from what the ranker returned would agree with the
   ranker by construction.
2. **Validated**: every `expect` URL must exist in the built index, and `questions.js` fails if
   one does not. A renamed page is a loud error instead of a permanent zero that reads as a
   ranking regression.
3. **Committed**, unlike `artificial-queries.json` — that set is reproducible from the index plus
   a fixed seed, so committing it would duplicate its input. An assistant's phrasings are not
   reproducible, so the file *is* the record.
4. **Macro-averaged over 18 topics**: `cli` alone has 16 queries, so without it one area could
   carry the score.

When a new page answers a question this set already asks, the label is what changes — not the
page. `/api/faq/` shipped on 2026-08-06 answering nineteen questions directly, and it is now
listed on the 14 queries whose answer it genuinely carries, judged by reading the answers. Two
guards keep that from turning into a metric that congratulates the corpus. It is added **only**
where the page answers, never merely where it ranks: four queries it now leads are deliberately
unlabelled, listed with their reasons in the file's own `rules`. And it is **not** accepted by
the intent set at all, where the reference page has to be the thing found — see below.

Known limit: the harness scores `!hit.external`, so a question answered on imqueue.com cannot
score here and none are included. The commercial half is asserted by
`scripts/check-search-ranking.js` instead — three named queries that must reach the commercial
edition, which is the right shape for that risk rather than an average.

### The intent set, and why it is flagged high importance

The other three sets are three ways of *guessing* what someone would type. This one is a
transcript. On 2026-08-05 an @imqueue application was built end to end through the MCP server —
a car-wash fleet deliberately stretched across **14 of the 17 packages** — and every
`search_docs` call it took is here verbatim, including the four clumsy ones and the four that
were retries.

It is high importance for one reason, and it is not that the queries are more realistic. The
server's own instruction #1 is *"Call `search_docs` before writing or changing @imqueue code…
Never infer an API name or signature"*. An agent obeying that asks by **describing** what it
needs, because it does not yet know the name. When the description misses, the agent does not
scroll and it does not retry — **it infers, and the inference compiles.** In that build, seven of
the fourteen packages were wired from guesses: a `new Logger()` and a `ttl` option key that exist
in no signature. A miss on this set is wrong code in someone's repository, and nothing else here
measures that.

The defect it isolates, in the two lines that name it:

```
expose                                               -> rpc.expose  #1
expose a service method so it can be called remotely -> rpc.expose  #7   (invisible: six are returned)
```

**Describing a symbol instead of naming it buries the symbol under prose.** The six that come
back instead are all reasonable pages for a human learning the framework, and not one carries
the signature.

Design points specific to this set:

- **17 of 19 queries want a reference page.** The other three sets are weakest on exactly the
  topics those pages cover, so this set agrees with them from the other direction.
- **A prose page is not accepted where a signature was needed.** That exclusion *is* the
  measurement — "six tutorial sections and no signature" is the failure, not a partial success.
- **`attempt: 2` marks the four retries** that only worked once the package or class was named,
  each paired to the intent-shaped query it replaced. `intent.js` prints the pairs. Discovery by
  name works, discovery by intent does not; when that is fixed, the gap in those four pairs
  closes.
- **`log` records what the two rankers returned during the build** — provenance only. Nothing in
  the harness reads it. Tuning toward it would make the metric agree with a ranker by
  construction.
- **`/api/faq/` is not an accepted answer here**, though the page was written from these 19
  queries and now leads 18 of them. Accepting it would score near 100% and retire the only
  measurement of whether the *reference page* is reachable — the thing that decides whether an
  agent writes a real signature or invents one. The cost is visible and deliberate: micro accuracy
  fell about ten points when the page shipped, because the FAQ answer takes position 1 and pushes
  the reference down a slot. recall@6 did not move. Read that drop as the page working.
- **It gates.** `floor.recall6` (94.7% — every move, up or down, is logged in `floor.note`) makes
  `intent.js` exit non-zero below it, and `compare.js` prints a distinct warning when a query on
  this set regresses. A high-importance label with no consequence is decoration. It reached 100%
  on 2026-08-06 and came back down the same day, to a content edit rather than a ranker change:
  cutting two paragraphs from /api/faq/ moved corpus-wide BM25 statistics enough to flip a
  198-against-198 tie, and `/api/job/latest/` left the six an agent sees for one query.

Its honest limit is size: 19 queries will call almost any change *unmeasured*, and the
significance line says so rather than pretending. It is a **named-case check**, closer to
`check-search-ranking.js` than to the 2,281-query average — read the moves, not the mean.

The set's own numbers are not comparable to the build log's "13 of 19": the log counted what
`search_docs` returned in six slots after its own filtering, while the harness scores the flat
merged list against a label that also accepts a package index page.

## Both rankers, side by side

`recall.js` scores this ranker **and the ranker `@imqueue/mcp` publishes today** on one corpus, so
"would the switch help?" has an answer instead of an opinion:

```
npm run kpi:recall              # ~3,400 agent-shaped identifier queries (the default)
npm run kpi:recall:question     # 115 chat-shaped questions, per topic
npm run kpi:recall:intent       # 19 real search_docs calls, per topic
```

Scoring the MCP side needs its **old** ranker, which no longer exists on its working branch —
Phase 2 replaced `rankEntries` with this one, so a build of `search/shared-ranker` would have the
script compare this ranker against itself and report a flawless dead heat. It refuses instead of
guessing; point `--mcp` at a checkout of the server's `main`:

```
git -C ../mcp worktree add /tmp/mcp-main main
ln -s "$PWD/../mcp/node_modules" /tmp/mcp-main/node_modules
npm --prefix /tmp/mcp-main run build
node scripts/search-kpi/recall.js --set question --mcp /tmp/mcp-main --list
```

Measured 2026-08-06 against a frozen snapshot, this ranker at `05b81ad`, MCP at `main` (`46eebe2`):

| set | this ranker | MCP's | delta | paired |
|---|---|---|---|---|
| agent-shaped (n = 3,657) | **99.5%** | 83.9% | +15.6 | p < 0.0001 · 569 better / **0 worse** |
| question (n = 115) | **66.1%** | 55.7% | +10.4 | p = 0.0241 · 20 better / 8 worse |
| intent (n = 19, high) | **78.9%** | 73.7% | +5.3 | unmeasured · 4 better / 3 worse |

Identical at `--ref 2d999d9`, so none of Phase 1's five ranker commits moved either labelled set's
recall@6 — the pin does not change this decision.

**Read the third row, not the average.** The three intent queries the switch loses are the three
the build log named as the framework's worst failures, and MCP answers all three near the top:

| query | MCP | this ranker |
|---|---|---|
| `expose a service method so it can be called remotely` | **#1** | #7 |
| `classType property decorators complex return type over RPC` | **#1** | #9 |
| `run a job later with a delay and retry it if it fails` | **#3** | #7 |

All three are the described-not-named shape that the MCP server's instruction #1 *requires* an
agent to produce, and this ranker's answer for the first is four blog sections and a tutorial:

```
How do I expose a method on an @imqueue service?
  1. /blog/load-balancing-microservices-without-a-load-balancer/#how-do-i-scale-an-imqueue-service
  2. /blog/versioning-microservices-without-breaking-callers/#can-i-run-two-versions-…
  3. /blog/imqueue-vs-nestjs/#does-nestjs-s-redis-transporter-do-the-same-thing-as-imqueue
  4. /compare/#can-i-use-imqueue-alongside-grpc-or-nats
  5. /tutorial/user-service/
  6. /blog/imqueue-vs-trpc/#what-imqueue-is-for
```

MCP returns `rpc.expose` at #1 and `/tutorial/user-service/` at #2 for the same query. Its corpus
holds no section anchors and only 112 curated pages, so it cannot make this mistake — and it also
cannot answer anything a section anchor answers, which is where its 27% *neither* comes from. The
two rankers fail in **opposite directions**, and the aggregate hides that.

Generalised over the sets: of the 71 questions whose answer is not a blog page, **17 get a blog
post at #1 and 13 of those lose the answer from the top 6 entirely**. Blog FAQ headings are
themselves questions, so they win the question *template*. This is live on imqueue.org today, and
it is the same defect from the other side of the corpus.

## Current baseline

| | intent (high) | natural | artificial | question |
|---|---|---|---|---|
| micro | 71.6% | **95.0%** | 91.4% | 65.7% |
| macro | 74.3% | **89.2%** | 95.4% | **62.7%** |
| nDCG@10 | 56.5% | 91.6% | 87.2% | 60.8% |
| recall@6 | **78.9%** | — | — | 66.1% (micro) / 62.9% (macro) |
| never found | 5.3% | 0.9% | 1.9% | 18.3% |
| typos (reported apart) | — | — | **57.8%** | — |

Intent-set detail at that baseline: **attempt 1 scores 66.7% and the four named retries score
90.0%** — the gap is the defect, measured. `expose a service method so it can be called remotely`
sits at **#7** and `classType property decorators complex return type over RPC` at **#9**, both
outside the six an agent sees, and `write structured JSON logs from a service to a file` is
absent from the first fifty.

**Phase 0 and Phase 1 did not move this set.** recall@6 is 78.9% at every ranker commit from
`2d999d9` (the extraction) to `05b81ad`; micro accuracy went 69.5% → 71.6%, entirely from
`3a43ea0`'s page-focus change, and unmeasured at n = 19. Anchoring (`365e21e`) moved nothing
here, and the two flagship failures above are exactly the ones the build log named. That is the
argument for Phase 2 and Phase 3 rather than another constant.

## Is that delta real?

A change of 0.1–0.5 macro points has been enough to keep or drop a ranker change here, and the
section below records one that moved the mean by **+0.0** while 260 queries churned. So every
comparison now reports the same per-query deltas three ways (`lib/stats.js`):

- a **paired bootstrap 95% CI** on the mean delta, seeded so it is reproducible — if it straddles
  zero the change is *unmeasured*, whatever the point estimate says;
- a **Wilcoxon signed-rank** p-value, non-parametric because the per-query metric is discrete,
  bounded and mostly exactly zero, which is where a t-test misbehaves;
- the same test **over topic means**, because the headline is a macro average and a claim about a
  macro has to be tested over topics rather than over queries.

Paired is the load-bearing word: both rankers see the same queries, so the variance that matters is
the variance of the *differences*. Comparing two independent CIs on the means would call almost
everything a tie.

Calibration worth keeping in mind: **19 better / 7 worse out of 2,281, at equal magnitudes, is
p = 0.019** — significant. The churn count was a better signal than it looked. **12 better / 10
worse is p = 0.68** and means nothing.

## Fit and holdout

Every constant in the ranker was chosen by sweeping it against these sets, which makes every number
above a **training** score. Each set is therefore cut in two and both halves are printed by default
(`lib/split.js`).

The cut is **by topic, never by query**: the natural harvest expands each seed a–z, so
`imqueue rpc` and `imqueue rpc example` are near-twins answered by the same page, and splitting by
query would put twins on both sides and make the holdout agree with the fit by construction. The
artificial set is cut by **target page** for the same reason — its `bucket` field is a query *shape*
(title-salient, body-salient), and cutting on shape produced two halves made of different
populations and read their difference as a 5.6-point fitting gap on a ranker never tuned against it.

Measured, and it is good news that was not guaranteed:

| set | fit | holdout | gap |
|---|---|---|---|
| natural (55 topics) | 88.1% | **90.5%** | −2.4 |
| artificial (1,237 pages) | 98.7% | 98.6% | +0.0 |
| question (18 topics) | 64.4% | 61.1% | +3.3 |

Natural's holdout is *better* than its fit, and artificial's halves are identical. **There is no
detectable overfitting** in twenty rounds of hand-tuning — the weights generalise across topics they
were not fitted on. The question set's gap is the one to keep an eye on: 9 topics of 56 queries per
side is small enough that it moves several points on a change that touches nothing topic-specific,
which is a statement about the set's size rather than about the ranker.

The question set's weakest topics, and they point the same way the diagnosis above does — every
one of them is answered by an API symbol page, which has no question-shaped text to compete with:

| topic | n | accuracy | recall@6 |
|---|---|---|---|
| hardening | 3 | 0.0% | 0% |
| service definition | 7 | 20.0% | 29% |
| caching | 4 | 22.5% | 25% |
| postgres | 4 | 25.0% | 25% |
| observability | 5 | 28.0% | 20% |

**This is a real, live defect on imqueue.org, not only in the MCP server** — the same ranker
serves both.

## What has been changed, and what was tried and rejected

### Content terms are anchored to word starts

Content terms used to match as free substrings, so `net` matched kuber**net**es and inter**net**,
`cli` matched **cli**ent, and `log` matched b**log** and cata**log** — inflating coverage, density
and the corpus's own `df` table together. It is also why `+ là gì` returned 111 hits: folding strips
the diacritics to `la` and `gi`, which sit inside a third of the words on the site.

A term is now scored by where in a word it lands: full weight at a word start, `INFIX_WEIGHT` (0.75)
inside a word, and nothing inside a word for terms shorter than `INFIX_MIN_TERM` (5). The coverage
*floors* still accept either, so this changed what things score without changing what is admitted.

**Every setting swept beat the unanchored control on every metric** — all three sets and the typo
bucket agreeing, which is rare enough here to be worth stating. Tested with `kpi:compare`:

| set | micro | macro |
|---|---|---|
| natural | **+0.72** CI [0.41, 1.09] p < 0.0001 | +0.19 CI [−0.76, 1.09] p 0.17 |
| artificial | **+0.59** CI [0.49, 0.70] p < 0.0001 | **+0.13** CI [0.04, 0.24] p 0.014 |
| question | **+1.13** CI [0.35, 2.00] p 0.008 | **+1.26** CI [0.31, 2.58] p 0.024 |

**The cost, stated plainly: the `cron` topic went 67.5% → 51.5%** across its 20 queries, which is
why natural *macro* is the one average that does not clear zero. The mechanism was traced rather
than guessed — for "cron job node js example", every page that lost 12–16% scores through tier-2
prose sections and every page that lost 0% scores through a tier-1 record, so anchoring moves weight
from long prose to short labels. Interior matches live in long text.

That asymmetry is a symptom of length normalisation being effectively `b = 1` (density divides by
raw section length, with no `avgdl`), and it belongs to the scoring-core work rather than to another
constant here. It was kept because three sets improve significantly and one topic of twenty queries
regresses, with the article still inside the top ten.

Rejected on the way: **a third bucket for a term that ENDS a word** without starting it — the
camelCase case, `queue` of `redisQueue`. Built and swept at 0.6/0.75/0.9/1.0: +0.18 natural macro at
best against −0.19 question macro, −0.06 artificial and −0.5 on typos. A wash traded between sets,
and the direction refuted the hypothesis — the best suffix weight is *below* the interior weight, so
the bucket was damping short noisy suffixes (`log` of `blog`) rather than crediting camelCase.

### The hard coverage floor stays hard

`scoreRecord` and `scoreSection` reject a candidate outright when a query of three or more content
terms is met by fewer than two of them. Replacing that `return 0` with a discount looks obviously
right — `TOPIC_MISS` is the same situation and is a multiplier *because* "a filter is one typo away
from zero results", and this floor has twice been caught rejecting what the scorer would have ranked
first. It was built and swept at 0.1 → 1.0, and the hard floor won:

| kept when thin | natural macro | question macro | artificial micro | typos |
|---|---|---|---|---|
| 0 (hard floor) | 89.24 | 62.73 | **91.35** | **57.8** |
| 0.10 / 0.15 | *identical to 0* — nothing survives against `MIN_SCORE` | | | |
| 0.40 | 89.74 | 63.42 | 91.21 | 57.9 |
| 0.75 | **89.87** | **65.32** | 90.04 | 54.8 |
| 1.00 (no floor) | 89.64 | 64.31 | 88.79 | 53.8 |

Removing the floor entirely is the worst setting on artificial by 2.6 points, so the floor is
load-bearing. And 0.4, the best-balanced setting, fails on inspection even though its averages look
positive:

- artificial −0.15 micro, **p < 0.0001, 86 queries worse against 1 better**;
- the question set's +0.69 macro comes from **one query** moving;
- **eight `trpc` queries fell from #1 to #11, #12 and #18.**

That last one is the whole answer, and it is the exact failure `--compare` exists to catch.
`trpc infinite query` returns *two* hits under the hard floor, both the right page. Softened, twelve
`pg-sequelize.query*` symbol pages score 102 on the single common word "query" — a short API title
matching one term of three at high density — and bury the right answer at 48.

Two costs also worth knowing:

1. **Softening the floor starves the relaxation pass**, which is gated on an empty result set.
   Measured: it fires on 100 of 499 typo queries at 0.75 against 118 at both 0 and 0.4, so 18
   queries that had been corrected returned junk instead of nothing.
2. The floor is a **patch for a short field saturating on one common term** — the same root cause as
   the `cron` regression above. Per-term IDF with real length normalisation would make a common
   word's own contribution small, and then the floor could go.

So "make the floor a soft discount" is a measured dead end rather than an untried idea. Two of this
round's three findings point at the scoring core, not at another constant.

### IDF

`IDF_POWER = 0.6` in `vendor/search-ranker/search.js`, flattening the rarity curve toward 1. Natural
macro 87.8% → 88.9%, artificial macro 93.5% → 94.5%, 75 natural queries improved against 36
worsened.

Two intuitive fixes were measured **and rejected**, both aimed at the symptom that a common
word derails a rare one (`idempotency` is #1 alone; `idempotency microservices` was absent):

| attempt | natural macro | verdict |
|---|---|---|
| discount a page record that never mentions the query's rarest term | **−4.7** (438 worse / 76 better) | rejected |
| sharpen IDF (`idf^1.5`, `^2`, `^3`) | −1.2 / −1.5 / −1.7 | rejected, monotonic |
| flatten IDF (`idf^0.6`) | **+1.1** | shipped |
| remove IDF entirely (`idf^0`) | −1.4 | rejected — the control |

The first is worth remembering because it sounds obviously right and is not: on a corpus this
small, the rarest word a reader types is often absent from the page that best answers them —
"api gateway nodejs" is answered by `/tutorial/api-service/`, which never says "gateway". The
diagnosis that rarity was *underweighted* was exactly backwards; it was overweighted.

## Do not tune against the artificial set

Flattening every element weight to one value — destroying the URL > keywords > title >
header > emphasis > body hierarchy on purpose — moves the two sets in *opposite* directions
(measured before the `IDF_POWER` change, so against a 93.7% / 89.7% baseline):

| | natural | artificial |
|---|---|---|
| element hierarchy intact | **93.7%** | 89.7% |
| all weights flattened | 90.5% | **91.2%** |

The artificial set prefers the broken ranker. Its composition is why: a third of it is
`body-salient`, generated from prose, so raising body weight relative to title helps it by
construction. A set generated from content rewards whatever scores that content.

## The aggregate alone is a weak regression detector

Halving the title weight (430 → 200) moved natural micro-accuracy by **+0.0 points** — while
150 queries got worse and 110 got better. The average cancelled out almost exactly.

So `--compare` reports per-query movement as well, and that is the sensitive signal:

```bash
npm run kpi:search -- --json after.json --compare before.json
```

A change with a flat average and hundreds of queries churning is not a safe change; it is an
unmeasured one.

## Three averages

- **micro** — mean over every query. What a visitor gets, given this query mix.
- **macro** — mean over topics, each weighted equally. The number to watch when tuning,
  because the harvest is skewed (Google returns far more completions for "mcp server" than
  for "back-pressure") and micro can be moved by one popular topic alone.
- **balanced** — micro over a set capped at 40 queries per topic. A cross-check on macro.

## What is excluded from the natural set, and why

Scoring a query that has no correct answer measures the harvest, not the ranker. Each bucket
is counted and printed rather than silently dropped.

| bucket | n | why |
|---|---|---|
| scored | 2,281 | in scope, with a ground-truth page |
| out of scope | 911 | another language's ecosystem, or not software at all |
| competitor how-to | 145 | "rabbitmq nodejs consumer example" — we compare with it, we don't teach it |
| on topic, no page | 30 | a real content gap, not a ranking failure |

Two name collisions caused most of the out-of-scope drift, and both are worth knowing about:
`pg-boss` is one letter from "boss pg", which is a category of hostel listing, and **IMQ is
also a Basque healthcare group** — the harvest is full of "imq clinica dental". TRPC is
additionally a family of ion-channel genes.

## Honest limits

- **Ground truth is one person's judgement.** The rules were written from page titles, and
  in four rounds of auditing I corrected rules that had scored a *correct* answer as a miss
  (delivery-guarantee queries labelled by the broker they named, `kubernetes` claiming
  "cursor mcp server kubernetes" before MCP did, and so on). Each correction is commented at
  its rule with the wrong answer it produced. This raised natural macro from 78.9% to 87.8%,
  and every point of that came from fixing the *measurement*, not the ranker. The risk that
  some of it was over-fitting is real and is not fully excluded.
- **Google autocomplete is not our traffic.** It is web-search intent, scored here as if it
  were site-search intent. Real logs will disagree.
- **The natural set is skewed** toward whatever Google has many completions for.
- **Typos are reported separately** and never folded into the headline. They are now partly
  answered — see below — but a spelling correction moves the number for a reason unrelated to
  relevance weighting, so mixing them in would make the headline mean two things.

## The relaxation pass, and why it could not regress anything

A query that returns **nothing** gets a second attempt: dotted compounds the corpus does not
contain are split into parts it does (`nestjs.microservices` → `nestjs microservices`), and unknown
words are corrected against the corpus vocabulary by restricted Damerau-Levenshtein distance —
restricted, because the measured typo class is one transposed key, which plain Levenshtein scores as
two edits.

**The gate is the whole safety argument.** It runs only when the ranked list is empty, so any query
that returns at least one result today is scored by byte-identical code and cannot move. Measured
against that prediction:

| | before | after |
|---|---|---|
| typo accuracy | 36.2% | **55.2%** |
| typo empty result set | 29.1% | **5.8%** |
| typo never found | 54.3% | 34.3% |
| natural | 94.2% | 94.3% (2 queries improved, 0 worse) |
| artificial | 90.8% | 90.8% (**0 queries changed**) |
| question | 64.5% | 64.5% (0 changed) |

The two natural queries that moved were returning nothing before. `check-search-ranking.js` asserts
the gate, because the safety argument is worth exactly as much as that assertion.

Two design notes that cost a measurement each:

1. **Confident rewrites are tried before guesses.** `nestjs.microservices cqrs` is answered by
   splitting alone. A single combined pass also "corrected" `cqrs` to `cars` — one substitution, and
   `cars` is in five sections — and announced a query about CQRS as a query about cars.
2. **A df floor does not separate good corrections from bad ones.** `cars` has df 5, and 67% of the
   prose vocabulary has df ≤ 5, so any threshold that rejects `cars` rejects most legitimate
   corrections too. The ordering above is what fixes it.

Corrections are **announced** (`3 results for “nestjs microservices cqrs”` in the status line, which
is already an aria-live region) and the highlighter marks the corrected term, not the misspelling.
A search that quietly answers a different question is worse than one that finds nothing.

What this deliberately does **not** fix: a typo whose query still returned something irrelevant.
That is the larger half of the typo gap (34.3% still never found) and it needs a change that can
regress, so it needs to be measured rather than argued.
