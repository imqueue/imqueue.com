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

## Two sets, because they answer different questions

**Natural** (`data/natural-queries.json`, 3,367 harvested → 2,281 scored). Real completions
from Google's suggest endpoint, seeded from the site's topics and expanded a–z so the wording
is the public's, not ours. Ground truth is assigned by hand-written topic rules in
`judge-natural.js`, written by reading the page inventory — never by running a query and
keeping whatever came back.

**Artificial** (`data/artificial-queries.json`, 10,000 + 499 typo variants). Generated from
the site's own titles, headings, `keywords` front matter, summaries, API identifiers and
prose. Ground truth is free: a query built from page P should return P.

The artificial set is optimistic by construction — every query uses the site's own
vocabulary, so it cannot measure the thing that actually breaks a site search, which is a
reader who does not know the words. **Read natural as the real number and artificial as a
regression detector.**

## Do not tune against the artificial set

Flattening every element weight to one value — destroying the URL > keywords > title >
header > emphasis > body hierarchy on purpose — moves the two sets in *opposite* directions:

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
