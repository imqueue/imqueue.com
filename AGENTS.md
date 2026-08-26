# AGENTS.md

Instructions for any coding agent working in this repository. They are not
suggestions: the checks described here are the only thing standing between a
plausible-looking change and a documentation site that quietly stops answering
questions. Read `README.md` for what the repo *is*; this file is about how to
change it without breaking it.

---

## The loop

Every change follows the same cycle. Do not skip step 1, and do not stop before
step 6.

### 1. Establish a baseline — before touching anything

Run this **first**, while the tree is still untouched:

```bash
npm run verify:save
```

That builds both editions, runs all 15 checks and all 172 browser tests, and
records the result in `.verify-baseline.json`. Later, `npm run verify` runs the
same thing again and prints three lists — what **BROKE**, what got **FIXED**, and
what was **ALREADY FAILING** — exiting non-zero only for the first.

This is the step most likely to be skipped and the most expensive to skip. A
suite run *after* an edit answers "is anything broken?", which is the wrong
question — the useful one is "did **I** break it?", and only a baseline
separates the two. Without one, a pre-existing failure reads as your regression
and you revert good work chasing it; worse, a real regression hides behind a
failure you assumed was already there.

It is a saved file rather than something you read and remember on purpose. Long
sessions get their context compacted, and a remembered "I think 172 passed" is
not evidence. The file is.

**Scale the baseline to the blast radius.** A full run costs minutes here —
`check:links` alone builds both editions and crawls ~1900 pages — and a baseline
too expensive to take is one that gets skipped, which is worse than a cheaper one
taken every time:

| Change | Baseline |
|---|---|
| Prose, one page's copy, a blog post | `npm run verify:save -- --scope=content` |
| A template, CSS, or a shared include | `npm run verify:save -- --scope=template` |
| JS, a Pages Function, the ranker, anything in `scripts/` | `npm run verify:save` |

Every scope says out loud which checks it is *not* running, so a narrowed run can
never read as a full one. Compare at the same scope you saved at; mixing them is
reported but only what both runs covered is comparable.

The **full** pair is required before the commit regardless of what you ran at the
start — pre-commit runs much of it anyway, and finding out there is faster than
finding out from a failed deploy.

If the baseline is not green, say so explicitly and agree with the user whether
to fix it first or work around it. Never build silently on a red tree, and never
let a pre-existing failure become yours by inheritance — which is exactly why
`verify` reports inherited failures without failing on them.

### 2. Implement what was asked

The requested scope, no more. If you find something else worth fixing, note it
and finish the task first.

### 3. Close the coverage gap your change opened

New behaviour needs a test that would fail without it. Ask, concretely: *if I
reverted my change and left the tests, would anything go red?* If the honest
answer is no, the coverage is missing, whatever the totals say. When it is cheap,
actually try it — `git stash`, run the new test, confirm it fails, `git stash
pop`. A test that has never failed has never been shown to test anything.

**Not every change earns a test, and pretending otherwise is its own damage.**
Most changes in this repo are content. A test asserting that a blog post contains
a particular sentence fails on the next copy edit, teaches nobody anything, and
trains everyone to ignore red. Add a test when the change introduces *behaviour
or an invariant*: a branch, a state, a rule about what must always hold. For pure
content, the existing checks — links, sitemap, dates, mirrors, JSON-LD — already
are the coverage. Say which case you concluded it was, and why.

Where it goes:

| What you changed | Where the test belongs |
|---|---|
| Anything a browser does — a click, a keystroke, a form, a dialog, rendered state | `tests/e2e/specs/` |
| Redirect policy, headers, feeds, mirrors, anything at the HTTP level | `tests/e2e/specs/` (no browser is started for those files) |
| A build-time invariant — link graph, sitemap, dates, JSON-LD, index integrity | a `scripts/check-*.ts`, wired into `npm test` |
| Search ranking | **not** a test — measure it, `npm run kpi:compare`, and read the per-query deltas |

Do **not** re-test in e2e what `npm test` already covers. Link crawling, sitemap
validity, index integrity, JSON-LD schema and ranking quality are all covered
there, cheaper and more thoroughly. The e2e suite exists for what only a browser
can see. Duplicating a cheap check as a slow one buys nothing and gives two
places to update.

### 4. Re-run and diff

```bash
npm run verify        # same scope you saved at
```

Read the **BROKE** list. That, and only that, is yours.

### 5. On a regression, find out which side is wrong

A failing test means the code and the test disagree. It does **not** tell you
which one is right, and that decision must be made from evidence — the source,
the git history, the rendered page — never from which one is more convenient to
change.

**The default suspicion belongs on the newer artefact, which is usually your
test.** When this suite was first written, nine assertions failed and all nine
were the test being wrong about a site that was right. Two worth remembering,
because both look exactly like product bugs:

- Searching `backpressure` highlighted nothing. The pages spell it
  *"Back-pressure"*; the highlighter correctly does not mark a string that is not
  in the text. The test was asserting a typo.
- The first `ArrowDown` in the search dialog landed on row **two**. `render()`
  pre-selects row one, so the shortest path through search is type-then-Enter.
  The test had assumed an off-by-one that was the feature.

Changing production behaviour to satisfy either would have made the site worse
while turning the suite green. So: **read the implementation before you edit the
assertion, and read it again before you edit the implementation.** Then fix
whichever side the evidence condemns, and say in the commit which it was.

A test that is merely *flaky* is a third case, and it needs a cause, not a
retry. Re-running until green is not a fix; it is a decision to ship the bug and
forget it. Every flake in this suite so far has been a real race with a real
explanation — see "Search is asynchronous" below.

**Two things are never an acceptable route to green:** weakening an assertion so
it stops noticing (loosening a matcher, dropping a case, widening a regex to
match whatever came out), and deleting or skipping a test you have not
diagnosed. If a test genuinely tests the wrong thing, say so explicitly and
replace it with one that tests the right thing — that is a different act, and it
belongs in the commit message.

### 6. Iterate to green — with a stopping rule

Repeat 4–5 until both suites pass. "Passes locally except for X" is not done.

**But the loop needs an exit, or it becomes the failure it was meant to
prevent.** An agent iterating without a stopping rule drifts, by small
reasonable-looking steps, into changing tests until they stop complaining. So:

- **After three iterations without the failure count going down, stop.** Do not
  start a fourth. Write up what you tried, what each attempt did, and what you
  now believe the cause is, and ask.
- **Stop immediately, whatever the iteration count, if the fix you are
  contemplating would weaken a check, change behaviour you were not asked to
  change, or you cannot explain why the failure happens.** "It passes now" is not
  an explanation.
- **If you are not sure whether the tree was green to begin with**, that is what
  the baseline is for — and if you skipped it, `git stash && npm run verify` still
  settles it. The alternative is debugging your own change against somebody
  else's breakage.

Report the outcome faithfully. If something is still failing, say so with the
output. If you skipped a step, say which and why. A green summary that required
an undisclosed assertion change is worse than an honest red one, because it
spends trust that the next report depends on.

---

## Running the suites

### `npm run verify` — both, diffed

```bash
npm run verify:save                       # record the current state
npm run verify                            # run again, report only what YOU broke
npm run verify:save -- --scope=content    # or a narrower tier — see step 1
npm run verify -- --no-build              # reuse the existing _site-* (faster, riskier)
```

Builds, runs the checks, runs the e2e suite, and compares against
`.verify-baseline.json` (gitignored — it describes one working tree and belongs
to nobody else). Exits non-zero **only** for regressions; inherited failures are
printed and forgiven, because a tool that blames you for somebody else's red is
one people learn to skip.

The check list is derived from `package.json`'s `test` script rather than copied,
so a new check is picked up here without anyone remembering to add it — but it
starts life in the `full` tier only, and the narrow tiers say which checks they
are skipping.

### `npm test` — 16 offline checks

```
check:types            check:redirects        check:agent-analytics
check:dates            check:package-status   check:links
check:sitemap          check:llms             check:search-ranker
check:search-index     check:search-ranking   check:kpi
check:search-ui        check:jsonld           check:mermaid
check:email-literals
```

Traps worth knowing:

- **They read `_site-org/` and `_site-com/`, not `src/`.** Build first, or you
  are checking the previous change.
- **A running `eleventy --serve` makes them lie**, in either direction — it
  rebuilds the output concurrently while the checks read it. Stop watchers
  before you trust a result.
- **`check:dates` passes for the wrong reason at pre-commit.** New files are
  staged but uncommitted, so they read as untracked and are skipped. Run
  `npm run check:dates` explicitly after adding a page.
- **`check:kpi` is a gate, not a report.** Its floors sit one standard error
  below the measured value; a "small" ranking change can trip it legitimately.
  Never pick a target by looking at what the ranker currently does.
- **`check:api-versions` is deliberately not in `npm test`** — it needs the npm
  registry, and an unreachable registry must not block an unrelated commit.
- **`check:types` covers three projects, not one**, and running `tsc` bare only
  checks the first. See the TypeScript section below.

### `npm run test:e2e` — 172 browser tests

**Always through `tests/e2e/run.sh`** (which is what the npm script does). Never
invoke `playwright test` directly. The wrapper reaps browsers orphaned by an
interrupted run, caps the run in a cgroup, and isolates its network to loopback
— see `tests/e2e/README.md` for the kernel panic that made the last one
necessary, and why it costs the suite nothing.

```bash
npm run test:e2e                          # everything
npm run test:e2e -- --project=desktop     # or one project
npm run test:e2e -- --grep consent        # or one area
npm run test:e2e -- specs/blog.spec.js    # or one file
npm run test:e2e:reap                     # after a Ctrl-C
```

It tests the site **as built**. It never builds. `npm run build:all` first, or
you are testing yesterday.

The harness runs the **real Cloudflare Pages Functions** in front of `_site-org`
— `functions/_middleware.ts` and `lib/api-handler.ts`. That is deliberate: every
`/api/<pkg>/` version redirect, the `Link: …index.md` mirror header and the
`x-agent-analytics` note happen at the edge, so a plain file server would prove
nothing about the URLs readers and crawlers actually hold.

### Writing e2e tests

- **The fixtures fail a test on any console error, uncaught exception, or
  same-origin subresource ≥ 400.** If your test provokes one deliberately —
  stubbing an endpoint with a refusal, say — declare it:
  `test.use({ allowFailedRequests: [/\/api\/message$/] })`. Do not reach for
  `allowConsoleErrors` unless you mean it.
- **Search is asynchronous in two stages.** The index arrives in tiers, and the
  re-render a later tier causes resets the keyboard cursor. Use `searchFor()` and
  `settle()` from `support/site.js`; a bare "wait for a result" will pass
  locally and fail under load.
- **Nothing may leave the machine.** External hosts are intercepted in-process
  and answered locally. That is what makes the consent assertions possible at
  all — "which vendor was contacted, and when" is an assertable value here, not a
  claim about markup. Keep it that way.
- **Assert behaviour, not generated markup.** A test that pins the exact text of
  a heading will fail on the next copy edit and teach nobody anything.

---

## TypeScript

Everything here is TypeScript. Nothing is transpiled to run it — Node 24 strips
types at load, so `node scripts/check-links.ts` executes the file directly, and
that is the property the setup exists to protect: the moment a build step stands
between an edit and a result, the checks get slower and a slower check is one
that gets skipped.

Two consequences, both enforced rather than documented and hoped for:

- **`erasableSyntaxOnly`.** Node STRIPS types, it does not TRANSFORM them.
  `enum`, `namespace`, parameter properties and `export =` all parse and then
  throw `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX` at runtime. The flag makes each one a
  type error instead.
- **ESM, not CommonJS.** `export =` is how CJS publishes types and is exactly
  what the flag above forbids. The repo root is still CommonJS, so each converted
  tree carries its own `package.json` marker: `lib/`, `scripts/`, `functions/`,
  `src/`, `tests/`, and `eleventy.config.mts` uses the unambiguous extension.
  The root *had* to stay CommonJS while `vendor/search-ranker` was a submodule
  with no `package.json` of its own; the ranker's TypeScript rewrite ended that
  constraint — it ships a manifest now, and pins its own `dist/` to
  `"type": "commonjs"` — so flipping the root is possible but has not been done,
  and would be a change of its own rather than a consequence of anything here.

**Three tsconfig projects, because three runtimes.** `npm run check:types` runs
all three; `tsc` on its own runs only the first.

| Project | Covers | Why it is separate |
|---|---|---|
| `tsconfig.json` | `lib/ scripts/ functions/ src/ eleventy.config.mts` | Node: `types: ["node"]`, no DOM, `moduleResolution: nodenext` so the checker resolves exactly as the runtime does |
| `tests/tsconfig.json` | `tests/` | Needs `lib.dom` for `page.evaluate` callbacks; Playwright is the loader, so extensionless relative imports and `moduleResolution: bundler` |
| `src/_shared/js/tsconfig.json` | `consent.ts`, `site.ts` | The only files a BROWSER runs, so the only ones actually COMPILED — see below |

**The two browser files are the exception to everything above.** A browser cannot
strip types, so `src/_shared/js/*.ts` is emitted to `.browser-js/` (gitignored)
before anything is content-hashed — the hash has to be over the bytes the browser
receives. `scripts/lib/asset-manifest.ts` runs that compile at Eleventy config
load and re-runs it on watch. Traps:

- **They are classic scripts, not modules.** `moduleDetection: "legacy"` in their
  tsconfig is what keeps `export {}` off the end of the emit; without it every
  page logs `Unexpected token 'export'` and the consent banner and theme switch
  are dead. The e2e suite catches this; `npm test` does not.
- **Edit the `.ts`, never `.browser-js/`.** It is regenerated on every build.

**Eleventy's config is `eleventy.config.mts`**, and Eleventy only auto-discovers
`eleventy.config.{js,cjs,mjs}` — so the `edition:*` and `serve:*` scripts pass
`--config=eleventy.config.mts` explicitly. A new script that runs `eleventy` needs
that flag or it will build with no config at all.

**Untyped dependencies get a hand-written declaration**, not a blanket
`declare module`: `types/untyped-modules.d.ts` and `types/eleventy.d.ts` spell
only the surface this repo calls, so an upstream signature change fails at the
call site instead of being absorbed by an `any`.

## Repository rules

- **`promotion/` is never committed.** It is local-only draft and outreach
  material in a public repo. Do not `git add` it, ever.
- **The search ranker is a submodule** at `vendor/search-ranker`. Changes go in
  *that* repo, then the moved pointer is committed here. `npm run kpi:compare`
  before and after, and read the per-query deltas — never the summary alone.
- **Never hand-edit generated files.** `functions/api/<pkg>/`, `lib/api-versions.ts`
  and the API reference under `src/org/api/` all come from generators; edit the
  generator. The files say so in their first line.
- **Commits are authored by the human contributor.** No tool or assistant
  attribution in commit messages, PR text, code comments, or any file.
- **Verify before committing, not after.** Build, run the relevant checks, show
  the evidence, then commit and push in the same breath — a verified commit left
  unpushed helps nobody.
- **Pre-commit is not free.** The hook runs the redirect, analytics, link and
  sitemap checks, which includes building both editions and crawling ~1900
  pages. Expect a commit here to take a while; do not assume it hung.
