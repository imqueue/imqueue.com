# Search relevance KPI

A number that says whether a change to the ranker made search better or worse, measured
before we have any query logs of our own.

```bash
npm run kpi:search          # the numbers
npm run kpi:search:worst    # plus the 40 worst misses, with what was expected
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

Position is read from the flat merged list — what `/search/` renders as "Everything". The
dialog also splits results into Answers/Docs/API groups, so a hit at flat position 4 can be
the first row of its own group there. Flat position is the pessimistic reading and the one
that stays comparable when grouping changes.

## Three sets, because they answer different questions

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

Known limit: the harness scores `!hit.external`, so a question answered on imqueue.com cannot
score here and none are included. The commercial half is asserted by
`scripts/check-search-ranking.js` instead — three named queries that must reach the commercial
edition, which is the right shape for that risk rather than an average.

## Current baseline

| | natural | artificial | question |
|---|---|---|---|
| micro | **94.0%** | 89.9% | 64.1% |
| macro | **88.9%** | 94.5% | **61.1%** |
| recall@6 | — | — | 66.1% (micro) / 62.9% (macro) |
| never found | — | — | 19.1% |
| typos (reported apart) | — | 36.4% | — |

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

One ranker change has been made on the strength of these numbers: `IDF_POWER = 0.6` in
`vendor/search-ranker/search.js`, flattening the rarity curve toward 1. Natural macro 87.8% →
88.9%, artificial macro 93.5% → 94.5%, 75 natural queries improved against 36 worsened.

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
- **Typos are reported separately** and never folded into the headline, because the ranker
  has no fuzzy matching at all — mixing them in would move the KPI for a reason unrelated to
  relevance weighting.
