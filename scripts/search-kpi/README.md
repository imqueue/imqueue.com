# Search relevance KPI

A number that says whether a change to the ranker made search better or worse, measured before we
have any query logs of our own.

```bash
npm run kpi                 # THE KPI — the gold set, one expected #1 per query
npm run kpi:build           # re-assemble the labels from judged/ after editing a decision
npm run kpi:worst           # plus the 40 worst misses, with what was expected
npm run kpi:topic delivery  # drill into one topic
npm run kpi:source peer     # one query shape only: natural | seo | question | intent | peer
npm run kpi:baseline        # freeze the current numbers as the comparison point
npm run kpi:compare         # the artificial tripwire against a ranker commit, per query
npm run kpi:tripwire        # the artificial set on its own
npm run kpi:search          # both of the above, in one go
npm run check:kpi           # the gate `npm test` runs — coverage, label integrity, floors
npm run check:kpi:labels    # the label half of the gate; no build needed
```

Read the two reports `kpi:search` prints as two different things, not as one long one. `kpi` is the
KPI; `kpi:tripwire` cannot measure relevance at all and its 92.7% is not a better version of the
KPI's 52.6% — see [The artificial tripwire](#the-artificial-tripwire).

Two ranker versions in one process, over one corpus:

```bash
node scripts/search-kpi/gold.js --ref <sha>   # the KPI, paired, with McNemar
```

`--ref` names a commit in the **ranker's** repository (the `vendor/search-ranker` submodule), not
this one, so `HEAD` is the pinned ranker and the working tree is your unstaged edits to it.
`harness.baseline()` tries `ranker.js` and then `search.js`, because the engine was split out of the
single file on 2026-08-06 and a comparison *across* that split is exactly the one worth being able to
run.

## The gold set

`data/gold.json` — **1,231 labels**, 86 topics. Every case names **one page that should be #1**
(`target`) and, sometimes, pages that answer defensibly but are not the best answer (`also`).

A query that no page on this site answers is **not in the set**. It is in `data/quarantine.json`,
which is not a leftovers bin — see [The quarantine](#the-quarantine-two-buckets-that-mean-different-things).

### Targets come from reading the page. Nothing else.

This is the one rule, and breaking it is the most instructive thing that has happened here — see
[the `/api/faq/` contamination](#the-apifaq-contamination-and-what-it-cost) below. Ranker behaviour,
metric saturation and convenience are **forbidden inputs**. A metric that would saturate is a reason
to add a metric, never a reason to write a label that says something untrue.

Precedence, when more than one page is defensible:

1. a page **dedicated** to the exact question wins — a tutorial chapter, an article, a CLI guide;
2. otherwise the **FAQ section** that answers it, because it carries runnable code, the failure modes
   and links to every symbol it names;
3. otherwise the **reference page**;
4. except a **bare symbol lookup**, which wants the signature and so wants the reference page.

### Section-level targets

The index is three tiers: **87 whole pages**, **1,152 API symbols**, and **110 anchored `#fragment`
sections**. 64 labels target a section, because the answer to "how do I mount HttpProtect as express
middleware" is one section, not a 5,455-word page.

That was available and unused for months. Both index checks built their known-set with
`String(url).split('#')[0]`, which was harmless while every target was a whole page and silently
rejected **every** anchored target the moment one existed. Both now remember the fragment *and* the
page it sits on.

### The labels are data, and they name themselves

`gold.json` carries a `fingerprint` — a 12-hex hash of every field that can move a score — so a
comparison can tell whether two runs scored the same labels and refuses when they did not. There is
no `built` date, because a date from `new Date()` made a re-run with no decision change produce a
diff. Queries are written one per line, so a relabelling is a readable `git diff` rather than one
179 KB line.

## Where the labels come from

`judged/*.js` holds **the decisions**. One module per cluster of the harvest; each entry is an
explicit per-query membership list plus the content reason it was judged that way. `build-gold.js`
only assembles them and stamps the fingerprint — it decides nothing.

```bash
npm run kpi:build   # edit a module, then run this, then `npm run check:kpi`
```

| module | decided | labelled | quarantined |
|---|---|---|---|
| `mcp.js` | 867 | 322 | 545 |
| `comparisons.js` | 524 | 126 | 398 |
| `core.js` | 412 | 199 | 213 |
| `noise-molecule.js` | 408 | 2 | 406 |
| `jobqueue.js` | 347 | 139 | 208 |
| `delivery-monolith-testing.js` | 346 | 182 | 164 |
| `mcp-spelled.js` | 242 | 49 | 193 |
| `infra.js` | 221 | 64 | 157 |
| **total** | **3,367** | **1,083** | **2,284** |

Plus `question.js` (115), `intent.js` (19) and `peer.js` (14), which are curated rather than
harvested.

### The four populations

| source | n | what it is | anchored |
|---|---|---|---|
| natural | 837 | keyword queries people really type into Google around this subject | 13 |
| **seo** | **246** | MCP-setup keywords, all answered by one page — **held out of the headline** | 0 |
| question | 115 | chat-shaped phrasings a developer would put to an assistant | 33 |
| intent | 19 | the `search_docs` calls an agent really made while building an app | 18 |
| peer | 14 | imqueue.com — commercial licensing, pricing and support | 0 |

**The natural harvest is an SEO keyword export, not a search log, and only 32% of it is
answerable.** That is worth stating because the wreckage is not guessable and has to be enumerated
rather than pattern-matched: `boss pg hinjewadi` is paying-guest accommodation in India,
`helluva boss pg rating` is a film rating, `molecule man vs galactus` arrived by stemming
*moleculer*, `trpc pigeon club` and `trpc 401k` are a TRPC ion channel and an Oklahoma retirement
company, and `imq clinica dental bilbao` is a Spanish health insurer.

### Why `seo` is reported apart

246 of the 1,083 natural labels are MCP setup keywords — `mcp installation`, one topic, one target
page. They are correctly judged; they are also 23% of the natural set all pointing at a page that
always wins, and they are keyword-harvest rather than anything a visitor types into the site's own
search box.

Held out, they proved the point: **81.3% P@1 against 61.6% for the headline.** Folding them in was
inflating micro-P@1 by four points. They are still measured, still printed, and still gated with
their own floor — held out of the average is not the same as unmeasured.

## The gate

`scripts/check-kpi.js`, wired into `npm test` between `check:search-ranking` and `check:search-ui`.
Before it existed, fourteen checks ran and none touched the gold set, while the only KPI with teeth
anywhere in the repo was a `recall@6` floor inside a script `npm test` does not run, over labels
since shown to call a verified improvement a significant regression. The build gated on the weakest
available number and the primary KPI gated on nothing.

It asserts five things, each of which has really gone wrong:

1. **Every harvested query is decided exactly once, and nothing is invented.** The labels are
   hand-written lists, so the failure mode is not a bad rule — it is a query silently leaving the
   measurement, or one that was never harvested being typed in from memory. On its first run this
   caught **18 queries that do not exist, 27 that had been missed and five judged in two places at
   once**. `mcp server config` was never harvested (only `mcp server configuration`);
   `claude code mcp registry ` had a trailing space; `mcp server opencode` sat in "install" while
   `install mcp server opencode` sat in "third-party". None of that was visible by inspection.
   All three query files are covered this way — `natural-queries.json` against `judged/*.js`,
   `question-queries.json` against `judged/question.js`, `intent-queries.json` against
   `judged/intent.js` — which is what keeps them inputs rather than souvenirs.
2. **The label set is self-consistent.** No query in both gold and quarantine, no query in both
   quarantine buckets, no `target` repeated in its own `also`, no duplicates.
3. **The committed file is what `judged/` assembles to.** Re-assembled in a subprocess and compared
   by fingerprint, so a stale build cannot hide a drift.
4. **Every labelled page is in the built index**, fragment or page. A page that moved would
   otherwise score 0 for ever and read as a ranking collapse.
5. **Seven numbers clear committed floors.** Each sits roughly one standard error below the measured
   value: a floor at the current number makes every run a coin toss on rounding, and one far below
   catches nothing.

```
  ok    P@1 macro 52.6%                          (floor 50.5%)
  ok    P@1 micro 61.6%                          (floor 59.5%)
  ok    recall@6 micro 90.4%                     (floor 88.5%)
  ok    intent recall@6 100.0%                   (floor 100.0%)
  ok    seo P@1 (held out, still gated) 81.3%    (floor 79.0%)
  ok    reference page in top 6 66.7%            (floor 61.0%)
  ok    targets never returned 3.8%              (ceiling 4.5%)
```

A floor is a tripwire, not a target. Moving one is a deliberate act that belongs in a commit message.

## The metrics, and which one to tune on

| | what it asks | why |
|---|---|---|
| **P@1** | is the `target` at #1 | the headline. A site search has one job at position 1. An `also` page at #1 scores **zero** here, deliberately |
| **MRR@target** | reciprocal rank of the `target` | the number to tune on: #4 → #2 is a large move here and nearly invisible in P@1 |
| **recall@6** | is any acceptable page in the first six | the agent metric — `search_docs` returns six and an agent reads all six, so membership is the question and rank inside the set is noise |
| **nDCG@10** | graded: `target` = 3, `also` = 1, log-discounted | the only one that can say "not the best answer, but not a miss either" |
| **reachability** | is the `mustReach` page in the top six | a second requirement, for pages that must stay findable even where something answers better. Its own number, because forcing it into `target` is what broke these labels once already |

Position is read from the flat merged list — what `/search/` renders as "Everything". The dialog also
splits results into Answers/Docs/API groups, so a hit at flat position 4 can be the first row of its
own group there. Flat position is the pessimistic reading and the one that stays comparable when
grouping changes.

**The 3:1 gain ratio is a presentation choice, not a hidden parameter** — checked rather than
assumed, with `--gains 2,3,5,10`. The absolute nDCG level moves across that range but the weakest
five topics come out in the same order every time, so no diagnosis depends on the number chosen.

**`confidence: 'low'` is supported and currently unused.** Before the rebuild, 65 labels carried it
for the hub-versus-article coin flip and the passing-mention target, and `gold.js` printed the
headline with and without them. The rebuild replaced it with something better — the reason each
decision was made is written next to it in `judged/*.js`, per query — so no label sets it today and
the report's confidence block does not fire. The field stays in the fingerprint because it can move a
score the moment one label uses it again.

**Two label regimes, and nDCG means two things unless you split them.** 1,130 cases have no `also`,
which asserts that nothing else is acceptable; they cannot score partial credit at all, so their nDCG
is on a different scale from the 101 that can. Both are printed, because a shift in the mix between
them moves nDCG with no ranking having changed.

### Macro is the headline, over pooled groups rather than raw topics

The set is uneven by construction, because that is the shape of the demand rather than of the site's
priorities. A plain mean over queries lets one topic carry the score; a plain mean over 86 raw topics
has the opposite disease, since 45 of them hold fewer than five queries and one query flipping inside
an n=2 topic moves the mean on its own — which is how a change once read as macro-neutral while
moving 55 queries.

So topics below **n = 5** pool into one `misc` group for the headline (**41 named groups + misc**),
keep their own identity in the diagnostic tables (marked `*`), and the macro mean is printed with a
**cluster-bootstrap 95% CI** — resampling the groups, not the queries, because the uncertainty is
about which subjects the site is measured on. That CI is about ±10 points wide, which is the real
precision of the absolute number and the reason the paired delta is what to read.

### Where the target actually is, in four exclusive buckets

"Never found" used to be one figure measured on the first *acceptable* hit, so a query whose
second-best page ranked #2 and whose best page ranked #400 counted as found. Now: in the top 10,
buried 11–50, deep 51+, or never returned at all. The last is an **indexing** defect and no amount of
weight tuning fixes it; the middle two are ranking defects.

## A delta is not a result until it is tested

A change of 0.1–0.5 macro points has been enough to keep or drop a ranker change here, and one change
moved the mean by **+0.0** while 260 queries churned. So every comparison reports the paired tests
from `lib/stats.js`:

- **McNemar** for P@1, because P@1 is not continuous — it is one bit per query, and its delta takes
  exactly three values. McNemar discards the agreements (a query whose target led both before and
  after says nothing) and asks only whether the two disagreement counts are balanced, with an exact
  two-sided binomial below 25 disagreements because the chi-square approximation is optimistic there.
- a **paired bootstrap 95% CI** on the mean delta, seeded so it is reproducible — if it straddles
  zero the change is *unmeasured*, whatever the point estimate says;
- a **Wilcoxon signed-rank** p-value, non-parametric because the per-query metric is discrete,
  bounded and mostly exactly zero, which is where a t-test misbehaves;
- the same test **over group means**, because the headline is a macro average and a claim about a
  macro has to be tested over groups rather than over queries.

**This is where most of the available power was sitting unused.** Unpaired, P@1's standard error at
n ≈ 1,000 is about 1.6 points, so a two-point move is one standard error and unfalsifiable. The same
move read as a paired disagreement — 27 queries gained against 1 lost — is χ² 22.3, **p < 0.0001**.
Same data, roughly forty times the power. For its first three months this harness printed the deltas
and ran no test at all.

Calibration worth keeping in mind: **19 better / 7 worse out of 2,281 is p = 0.019** — significant,
so the churn count is a better signal than it looks. **12 better / 10 worse is p = 0.68** and means
nothing.

**And the aggregate alone is a weak regression detector.** Halving the title weight (430 → 200) moved
micro-accuracy by **+0.0 points** while 150 queries got worse and 110 got better. A change with a
flat average and hundreds of queries churning is not a safe change; it is an unmeasured one. That is
why both comparison paths print per-query movement, and why `compare.js` exists at all.

## Fit and holdout

Every constant in the ranker was chosen by sweeping it against these sets, which makes every number
here a **training** score. The set is therefore cut in two and both halves are printed by default
(`lib/split.js`), on P@1 — for months `split.js` computed only the legacy linear `accuracy`, which
meant the single guard against overfitting was measuring a metric the headline had stopped using.

The cut is **by group, never by query.** The natural harvest expands each seed a–z, so `imqueue rpc`
and `imqueue rpc example` are near-twins answered by the same page, and splitting by query would put
twins on both sides and make the holdout agree with the fit by construction. The artificial set is
cut by **target page** for the same reason — its `bucket` field is a query *shape*, and cutting on
shape produced two halves made of different populations and read their difference as a 5.6-point
fitting gap on a ranker never tuned against it.

**Current reading: fit 60.7%, holdout 44.4%, gap +16.4 points.** That is large and it is flagged as
large. It is also not yet diagnosed: the label set more than doubled in the rebuild, so the two halves
now hold different subject mixes than the halves that last read a +2.4 gap. Read it as a question, not
as a measured overfitting result.

## The quarantine: two buckets that mean different things

`data/quarantine.json`, 2,284 queries no page here answers. Keeping them in one bucket makes both
numbers useless, so the verdict each judged module wrote is classified — by an explicit table in
`build-gold.js`, not by pattern-matching, because "another ecosystem's load balancing" and "a
balancer pattern we do not cover" differ by judgement and not by any substring. **A verdict in
neither list is a hard build error**, so a new one has to be classified deliberately rather than
defaulting into whichever bucket is larger.

**`negative` — 2,081 queries that are not this site's subject at all.** Another vendor's own API,
another language's ecosystem, or a name collision in the harvest. This is the population the
**restraint** measure samples: what comes back when there is genuinely nothing to return, reported as
a distribution rather than a score, because "how confident was it about a wrong answer" is the
interesting part and no single number carries it.

Currently **13.3% empty**, median top score **333** against **400** on the gold set. A negative-bucket
score close to the gold set's means the ranker cannot tell the two apart.

The sample is a **seeded shuffle, not a stride**. The bucket has ~330 consecutive entries beginning
"molecular", so a stride sample reported the ranker's behaviour on chemistry strings and called it
restraint.

**`contentGap` — 203 queries that ARE this site's subject and go unanswered.** This is a content
backlog, not a ranking fact, and it is worth reading:

| n | nothing here answers |
|---|---|
| 51 | test disciplines and tooling the layered approach does not cover |
| 27 | whether to adopt microservices at all — the extraction page assumes you have |
| 26 | scaling, microservices or TypeScript as a general concept |
| 20 | the site publishes no wire-level gRPC/REST measurements, and says so |
| 19 | load balancing in another ecosystem, or a balancer pattern not covered |
| 17 | a protocol the site never puts in the comparison |
| 11 | a vendor's gateway product, or the generic definition the site never gives |
| 9 | a tool the site never compares against |
| 8 | prompts and resources — MCP primitives this server does not expose |
| 8 | a client the setup page does not document |
| 7 | hunting for a Node circuit-breaker library; the site ships and documents none |

**Restraint is reported, never scored into the headline.** Mixing it into relevance would let a ranker
that returns nothing look excellent.

## The artificial tripwire

`data/artificial-queries.json` — 10,000 queries plus 499 typo variants, generated from the site's own
titles, headings, `keywords` front matter, summaries, API identifiers and prose, so ground truth is
free: a query built from page P should return P. Gitignored, because it regenerates exactly from the
index plus a fixed seed; `measure.js` and `compare.js` both say so out loud rather than measuring
nothing in silence.

**It is a tripwire and nothing else.** A failure means a page cannot be found by its own title, which
is an indexing defect, not a weighting one. It cannot measure the thing that actually breaks a site
search — a reader who does not know the words — because every query uses the site's vocabulary by
construction.

Currently **92.7% micro / 96.0% macro accuracy, 80.2% at #1, 0.7% never found**, and **92.1% strict**
— strict requires the exact `#anchor`, so the 0.6-point gap to micro is queries answered by the right
page but the wrong section of it. Its fit/holdout halves, cut by target page, read **98.9% / 98.8%**,
which is the one place in this harness where overfitting is convincingly absent.

**So do not tune against it.** Flattening every element weight to one value, destroying the
URL > keywords > title > header > emphasis > body hierarchy on purpose, moves it and the real set in
*opposite* directions:

| | natural | artificial |
|---|---|---|
| element hierarchy intact | **93.7%** | 89.7% |
| all weights flattened | 90.5% | **91.2%** |

The artificial set prefers the broken ranker. A third of it is generated from prose, so raising body
weight relative to title helps it by construction. A set generated from content rewards whatever
scores that content.

```bash
npm run kpi:search:gen      # regenerate the 10,000 from current content
npm run kpi:search:harvest  # re-harvest natural queries from Google autocomplete
```

Regenerating the harvest does **not** re-judge anything. `judged/*.js` is hand-written, and
`check:kpi` will fail on every new query until each one has a decision — which is the intended
behaviour, not an obstacle.

## Current baseline — labels `12336a824b18`

985 headline queries (+ 246 `seo`), 86 topics, 42 macro groups.

| | macro | micro |
|---|---|---|
| **P@1** | **52.6%**  95% CI [42.7, 62.5] | 61.6% |
| MRR@target | 64.5% | 72.5% |
| recall@6 | 85.9% | 90.4% |
| nDCG@10 | 63.8% | 74.3% |
| any acceptable page at #1 | — | 63.9% |
| target buried 11–50 | — | 3.8% |
| target never returned | — | 3.8% |
| **reference page in the top 6** | — | **66.7%** (12/18) |

By source: natural **63.1%**, seo **81.3%**, question **43.5%**, intent **100.0%**, peer **71.4%**.

The weakest groups, and they are where to work: `framework choice` 0% (n=8), `autoscaling` 0% (n=5),
`delayed work` 0% (n=5), `postgres as a queue` 0% (n=10), `background jobs` 0% (n=12),
`mcp troubleshooting` 0% (n=31).

Written to `data/gold-baseline.json` by `npm run kpi:baseline`. Compare with
`node scripts/search-kpi/gold.js --compare scripts/search-kpi/data/gold-baseline.json`, or against
another ranker commit with `--ref <sha>`.

**Not comparable with the 58.3% macro recorded before the rebuild**, and neither number is wrong.
Three things moved: the natural labels went 517 → 1,083 as the dropped queries came back, 18 of the
19 agent queries were retargeted from a reference page to the FAQ section that actually answers them,
and the aggregation now pools 86 topics into 42 groups. **A paired `--ref` test is the only reading
that survives a relabelling** — it is identical before and after a correct label fix, which is the
property a correct label fix has to have.

## The `/api/faq/` contamination, and what it cost

Worth recording in full, because it is the failure this whole set is now shaped around.

`/api/faq/` was `also` and **never** `target` on all 19 intent queries and 20 of the question
queries — 89 cases had it as `also` against exactly **one** that had it as `target`. The stated
reason: the FAQ was written from these queries and ranks #1 for 18 of the 19, so accepting it would
score ~100% and retire the only measurement of whether the *reference* page is reachable. The intent
set therefore read **P@1 5.3%**, and that number was explained in the docs as "the design".

It was not the design. It was **label contamination** — picking a target from the ranker's behaviour,
which is the one input a relevance label may never take. Refusing the page that wins breaks the rule
exactly as surely as accepting whatever wins would.

It was also wrong on the merits, which is what settled it. Every one of those 19 queries is a
near-verbatim restatement of an `/api/faq/` section heading, and each of those sections is a separate
indexed record with its own anchor. For `run a job later with a delay and retry it if it fails`, the
FAQ section carries the working `{ delay, ttl }` example, the table mapping each handler return value
to its re-scheduling effect, and the trap that a job pushed with no delay and then throwing is
*dropped* rather than retried. None of that is on `job.jobqueue/`, which documents a class.

**Judged from content, the intent set reads 100.0% P@1.** The 5.3% was never a search defect; it was
mislabelling.

**And the requirement the bad label was smuggling now has its own number.** `mustReach` names the
reference page that has to stay findable even where something else answers better, and it reports
separately — currently **66.7% in the top 6, 100% returned at all**. When the labels were false it
read 42.3% in the top six with 38.5% never returned at all, and that list of nine unreachable
reference pages was a real defect the mislabelled 5.3% had been hiding.

The six that are still outside the top six are named in the report, `/api/validation/latest/` and
`/api/pg-cache/latest/` at #8 among them.

## What was tried and rejected

Measured dead ends, so they are not re-proposed. **Synonym expansion was rejected 2026-08-05 and is
not to be raised again.**

### Content terms are anchored to word starts — shipped

Content terms used to match as free substrings, so `net` matched kuber**net**es, `cli` matched
**cli**ent, and `log` matched b**log** — inflating coverage, density and the corpus's own `df` table
together. It is also why `+ là gì` returned 111 hits: folding strips the diacritics to `la` and `gi`,
which sit inside a third of the words on the site.

A term now scores by where in a word it lands: full weight at a word start, `INFIX_WEIGHT` (0.75)
inside a word, and nothing inside a word for terms shorter than `INFIX_MIN_TERM` (5). Every setting
swept beat the unanchored control on every metric — natural micro +0.72 (p < 0.0001), artificial
+0.59 (p < 0.0001), question +1.13 (p 0.008).

**The cost, stated plainly: the `cron` topic went 67.5% → 51.5%.** Traced rather than guessed — every
page that lost score there scores through tier-2 prose sections, and every page that lost nothing
scores through a tier-1 record, so anchoring moves weight from long prose to short labels. Interior
matches live in long text. Kept, because three sets improve significantly and one topic of twenty
regresses with the article still inside the top ten.

**Rejected on the way: a third bucket for a term that ENDS a word without starting it** — the
camelCase case, `queue` of `redisQueue`. Swept at 0.6/0.75/0.9/1.0: +0.18 natural macro at best
against −0.19 question macro, −0.06 artificial and −0.5 on typos. A wash traded between sets, and the
direction refuted the hypothesis — the best suffix weight is *below* the interior weight, so the
bucket was damping short noisy suffixes (`log` of `blog`) rather than crediting camelCase.

### The hard coverage floor stays hard — rejected

`scoreRecord` and `scoreSection` reject a candidate outright when a query of three or more content
terms is met by fewer than two of them. Replacing that `return 0` with a discount looks obviously
right — `TOPIC_MISS` is the same situation and is a multiplier *because* "a filter is one typo away
from zero results". It was built and swept at 0.1 → 1.0, and the hard floor won:

| kept when thin | natural macro | question macro | artificial micro | typos |
|---|---|---|---|---|
| 0 (hard floor) | 89.24 | 62.73 | **91.35** | **57.8** |
| 0.10 / 0.15 | *identical to 0* — nothing survives `MIN_SCORE` | | | |
| 0.40 | 89.74 | 63.42 | 91.21 | 57.9 |
| 0.75 | **89.87** | **65.32** | 90.04 | 54.8 |
| 1.00 (no floor) | 89.64 | 64.31 | 88.79 | 53.8 |

Removing the floor entirely is the worst setting on artificial by 2.6 points, so the floor is
load-bearing. And 0.4, the best-balanced setting, fails on inspection even though its averages look
positive: artificial −0.15 micro at **p < 0.0001, 86 queries worse against 1 better**; the question
set's +0.69 macro comes from **one query** moving; and **eight `trpc` queries fell from #1 to #11,
#12 and #18**.

That last one is the whole answer. `trpc infinite query` returns *two* hits under the hard floor, both
the right page. Softened, twelve `pg-sequelize.query*` symbol pages score 102 on the single common
word "query" — a short API title matching one term of three at high density — and bury the right
answer at 48.

Two further costs: softening the floor **starves the relaxation pass**, which is gated on an empty
result set (it fires on 100 of 499 typo queries at 0.75 against 118 at both 0 and 0.4, so 18 queries
that had been corrected returned junk instead of nothing); and the floor is a **patch for a short
field saturating on one common term** — the same root cause as the `cron` regression above. Per-term
IDF with real length normalisation would make a common word's own contribution small, and then the
floor could go.

### IDF

`IDF_POWER = 0.6`, flattening the rarity curve toward 1. Natural macro 87.8% → 88.9%, artificial
93.5% → 94.5%. Two intuitive fixes were measured and rejected, both aimed at the symptom that a
common word derails a rare one (`idempotency` is #1 alone; `idempotency microservices` was absent):

| attempt | natural macro | verdict |
|---|---|---|
| discount a page record that never mentions the query's rarest term | **−4.7** (438 worse / 76 better) | rejected |
| sharpen IDF (`idf^1.5`, `^2`, `^3`) | −1.2 / −1.5 / −1.7 | rejected, monotonic |
| flatten IDF (`idf^0.6`) | **+1.1** | shipped |
| remove IDF entirely (`idf^0`) | −1.4 | rejected — the control |

The first is worth remembering because it sounds obviously right and is not: on a corpus this small,
the rarest word a reader types is often absent from the page that best answers them — "api gateway
nodejs" is answered by `/tutorial/api-service/`, which never says "gateway". The diagnosis that rarity
was *underweighted* was exactly backwards; it was overweighted.

### The relaxation pass, and why it could not regress anything

A query that returns **nothing** gets a second attempt: dotted compounds the corpus does not contain
are split into parts it does (`nestjs.microservices` → `nestjs microservices`), and unknown words are
corrected against the corpus vocabulary by *restricted* Damerau-Levenshtein distance — restricted,
because the measured typo class is one transposed key, which plain Levenshtein scores as two edits.

**The gate is the whole safety argument.** It runs only when the ranked list is empty, so any query
that returns at least one result today is scored by byte-identical code and cannot move. Measured
against that prediction when it shipped: typo accuracy 36.2% → **55.2%**, typo empty result set
29.1% → **5.8%**, natural +0.1 (2 queries improved, 0 worse), artificial and question **0 queries
changed**. `check-search-ranking.js` asserts the gate, because the safety argument is worth exactly as
much as that assertion.

The typo bucket now reads **63.9% accuracy, 47.5% at #1, 25.3% never found, 6.4% empty**. What moved
it between those two readings has not been attributed, so do not read the difference as a second win
for this pass.

Two design notes that cost a measurement each:

1. **Confident rewrites are tried before guesses.** A single combined pass also "corrected" `cqrs` to
   `cars` — one substitution, and `cars` is in five sections — and announced a query about CQRS as a
   query about cars.
2. **A df floor does not separate good corrections from bad ones.** `cars` has df 5, and 67% of the
   prose vocabulary has df ≤ 5, so any threshold that rejects `cars` rejects most legitimate
   corrections too. The ordering above is what fixes it.

Corrections are **announced** (`3 results for "nestjs microservices cqrs"` in the status line, already
an aria-live region) and the highlighter marks the corrected term, not the misspelling. A search that
quietly answers a different question is worse than one that finds nothing.

What this deliberately does **not** fix: a typo whose query still returned something irrelevant. That
is the larger half of the typo gap and it needs a change that can regress, so it needs to be measured
rather than argued.

## Honest limits

- **Ground truth is one person's judgement**, and the rebuild is what it is because the first attempt
  got it wrong in a way no metric could show. The labels are readable per query, with the reason
  attached, precisely so the judgement can be argued with.
- **Google autocomplete is not our traffic.** It is web-search intent, scored here as if it were
  site-search intent. Real logs will disagree.
- **The natural set is skewed** toward whatever Google has many completions for — which is why the
  headline is a macro average and why `seo` is held out of it.
- **19 queries will call almost any change unmeasured.** The intent set is a **named-case check**,
  closer to `check-search-ranking.js` than to an average — read the moves, not the mean. It is
  flagged high-importance for one reason: the MCP server's own instruction is *"never infer an API
  name or signature"*, so an agent obeying it asks by **describing** what it needs. When the
  description misses, the agent does not scroll and it does not retry — **it infers, and the
  inference compiles.**
- **Typos are reported separately** and never folded into the headline. A spelling correction moves
  the number for a reason unrelated to relevance weighting.
- **The same ranker serves imqueue.org, imqueue.com and `@imqueue/mcp`**, and only the MCP server
  asserts ordering properties against live feeds. A ranker change that passes every check here can
  still break it, so verify both.
- **One known defect this set is weak on:** long question-shaped queries are mostly words the corpus
  shares — *how, do, I, a, service* — so the one discriminating word has to carry it, and when it does
  not, records whose headings are themselves questions win on the question **template**. `rpc.expose`
  scores 1020 and ranks **#1** for `expose`, and **88 and #108** for "How do I expose a method on an
  @imqueue service?". The question set reads 43.5% and that is the mechanism.
