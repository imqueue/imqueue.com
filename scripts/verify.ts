#!/usr/bin/env node
// verify.ts — run the checks and the e2e suite, and answer the only question a
// regression run is actually asking: DID I BREAK THIS?
//
//   node scripts/verify.ts --save          record the current state as the baseline
//   node scripts/verify.ts                 run again and diff against that baseline
//   node scripts/verify.ts --scope=content  only the checks a copy edit can affect
//   node scripts/verify.ts --no-build      reuse the existing _site-* (faster, riskier)
//
// `npm test` answers "is anything broken?", which is the wrong question mid-task.
// A pre-existing failure then reads as your regression and you revert good work
// chasing it; worse, a real regression hides behind a failure you assumed was
// already there. The difference between the two is a BASELINE, and a baseline is
// only worth anything if it is an artefact rather than a memory — long sessions
// get their context compacted, and "I think 172 passed" is not evidence.
//
// So this writes .verify-baseline.json and, on the next run, prints three lists:
// what BROKE, what got FIXED, and what was ALREADY FAILING. It exits non-zero
// only for the first. A tree that was red when you arrived does not become your
// fault by inheritance, and a tool that cannot tell the difference trains people
// to ignore it.
//
// See AGENTS.md for the loop this belongs to.

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = path.join(import.meta.dirname, '..');
const BASELINE = path.join(ROOT, '.verify-baseline.json');
const E2E_JSON = path.join(ROOT, 'tests', 'e2e', '.artifacts', 'verify-results.json');

const argv = process.argv.slice(2);
/** One check's verdict, and the line that explains a failure. */
interface CheckResult {
  ok: boolean;
  gist: string;
}

/** What the e2e suite did, including whether it managed to start at all. */
interface E2eResult {
  ran: boolean;
  /** Whether this scope was supposed to run it. See failuresOf(). */
  expected: boolean;
  failing: string[];
  total: number;
  exit?: number | null;
}

/** One whole run, as .verify-baseline.json stores it. */
interface RunState {
  scope: string;
  checks: Record<string, CheckResult>;
  e2e: E2eResult;
}

/** One suite node of Playwright's JSON reporter output. */
interface PlaywrightSuite {
  title?: string;
  specs?: Array<{ title: string; ok: boolean }>;
  suites?: PlaywrightSuite[];
}

const has = (flag: string): boolean => argv.includes(flag);
const value = (name: string, fallback: string): string => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));

  return hit ? hit.slice(name.length + 3) : fallback;
};

// ---- what to run ----------------------------------------------------------

// The check list is DERIVED from the `test` script rather than duplicated here, so
// a check added to `npm test` is picked up by this without anybody remembering to.
const scripts = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'),
).scripts as Record<string, string>;

const allChecks = (scripts.test ?? '')
  .split('&&')
  .map((part) => part.trim().replace(/^npm run /, ''))
  .filter(Boolean);

// Scope tiers. The point is that a full run costs minutes — check:links alone
// builds both editions and crawls ~1900 pages — and a baseline too expensive to
// take is one that gets skipped, which is worse than a cheaper one taken every
// time. So a copy edit gets the checks a copy edit can break.
//
// Membership is by NAME, and anything not listed belongs to `full` only. A new
// check is therefore excluded from the narrow tiers until somebody classifies it,
// which is the safe direction — and the run says what it left out rather than
// quietly running less than it looks like.
const TIERS: Record<string, string[] | undefined> = {
  content: [
    'check:links',
    'check:sitemap',
    'check:dates',
    'check:llms',
    'check:jsonld',
    'check:mermaid',
    'check:email-literals',
  ],
  template: [
    'check:links',
    'check:sitemap',
    'check:dates',
    'check:llms',
    'check:jsonld',
    'check:mermaid',
    'check:email-literals',
    'check:search-ui',
    'check:agent-analytics',
    'check:search-index',
  ],
};

const scope = value('scope', 'full');

if (scope !== 'full' && !TIERS[scope]) {
  console.error(`verify: unknown scope "${scope}" — use content, template or full.`);
  process.exit(2);
}

const checks = scope === 'full'
  ? allChecks
  : allChecks.filter((c) => (TIERS[scope] ?? []).includes(c));
const skipped = allChecks.filter((c) => !checks.includes(c));

// e2e is browser-level and cannot be meaningfully narrowed by check name; a
// content-only change cannot alter behaviour, so the narrowest tier skips it.
const runE2e = scope !== 'content';

// ---- running --------------------------------------------------------------

const run = (
  command: string,
  args: string[],
  opts: Parameters<typeof spawnSync>[2] = {},
): ReturnType<typeof spawnSync> =>
  spawnSync(command, args, {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    ...opts,
  });

/** The last line that looks like a verdict, for the one-line-per-check summary. */
function gist(result: ReturnType<typeof spawnSync>): string {
  const text = `${result.stdout || ''}\n${result.stderr || ''}`;
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const failure = lines.find((l) => /^(FAIL|Error|error:|✗|✘)/i.test(l) || /\bFAIL\b/.test(l));

  return (failure || lines[lines.length - 1] || '').slice(0, 140);
}

function runChecks(): Record<string, CheckResult> {
  const results: Record<string, CheckResult> = {};

  for (const name of checks) {
    // The `check:links` script is `npm run build:all && node …`; the build is
    // hoisted out and done once, so running the command verbatim would rebuild
    // in the middle of a run that has already built.
    const command = (scripts[name] ?? '').replace(/^npm run build:all\s*&&\s*/, '');

    process.stdout.write(`  ${name.padEnd(24)}`);

    const result = run('sh', ['-c', command]);
    const ok = result.status === 0;

    const verdict: CheckResult = { ok, gist: ok ? '' : gist(result) };

    results[name] = verdict;
    console.log(ok ? 'ok' : `FAIL  ${verdict.gist}`);
  }

  return results;
}

function runE2eSuite(): E2eResult {
  fs.mkdirSync(path.dirname(E2E_JSON), { recursive: true });

  if (fs.existsSync(E2E_JSON)) {
    fs.unlinkSync(E2E_JSON);
  }

  console.log('  e2e                     running…');

  const result = run('tests/e2e/run.sh', ['--reporter=json'], {
    env: { ...process.env, PLAYWRIGHT_JSON_OUTPUT_NAME: E2E_JSON },
    stdio: ['ignore', 'ignore', 'inherit'],
  });

  if (!fs.existsSync(E2E_JSON)) {
    console.log('  e2e                     COULD NOT RUN — see the error above');

    return { ran: false, expected: true, failing: [], total: 0, exit: result.status };
  }

  const report = JSON.parse(fs.readFileSync(E2E_JSON, 'utf8')) as { suites?: PlaywrightSuite[] };
  const failing: string[] = [];
  let total = 0;

  const walk = (suites: PlaywrightSuite[] | undefined, trail: string[]): void => {
    for (const suite of suites || []) {
      const here = suite.title ? [...trail, suite.title] : trail;

      for (const spec of suite.specs || []) {
        total++;

        if (!spec.ok) {
          failing.push([...here, spec.title].join(' › '));
        }
      }

      walk(suite.suites, here);
    }
  };

  walk(report.suites, []);
  failing.sort();

  console.log(`  e2e                     ${total - failing.length}/${total} passed`);

  return { ran: true, expected: true, failing, total, exit: result.status };
}

// ---- comparing ------------------------------------------------------------

/** Every failing thing in a run, as one flat set of stable names. */
function failuresOf(state: RunState): Set<string> {
  const names = Object.entries(state.checks)
    .filter(([, r]) => !r.ok)
    .map(([name]) => name);

  const failures = new Set([...names, ...state.e2e.failing.map((t) => `e2e: ${t}`)]);

  // A harness that could not START reports zero failing tests, and zero failing
  // tests is not the same thing as no failures. Without this it reads as green:
  // an unresolvable import in pages-server.ts took the whole suite out and this
  // script printed "no regressions" and exited 0. The one outcome a regression
  // runner must never produce is a clean bill of health for a suite that did not
  // run, so the non-start is recorded as a failure in its own right.
  //
  // `expected` is absent from baselines written before this existed, which reads
  // as false and changes nothing about how they compare.
  if (state.e2e.expected && !state.e2e.ran) {
    failures.add('e2e: the suite could not run');
  }

  return failures;
}

function list(title: string, items: readonly string[]): void {
  if (!items.length) {
    return;
  }

  console.log(`\n${title} (${items.length})`);

  for (const item of items) {
    console.log(`  ${item}`);
  }
}

// ---- main -----------------------------------------------------------------

console.log(`verify: scope=${scope}${has('--no-build') ? ' (no build)' : ''}`);

if (skipped.length) {
  // Never silently. A narrowed run that reads like a full one is how a scope
  // becomes a lie.
  console.log(`verify: NOT running ${skipped.length} check(s) at this scope: ${skipped.join(', ')}`);
}

if (!runE2e) {
  console.log('verify: NOT running the e2e suite at this scope');
}

if (!has('--no-build')) {
  console.log('verify: building both editions…');

  const build = run('npm', ['run', 'build:all'], { stdio: ['ignore', 'ignore', 'inherit'] });

  if (build.status !== 0) {
    console.error('verify: the build failed — nothing downstream of it is meaningful.');
    process.exit(1);
  }
}

const state: RunState = {
  // Recorded so a stale baseline can be spotted: comparing a full run against a
  // content-scoped baseline would report every unrun check as "fixed".
  scope,
  checks: runChecks(),
  e2e: runE2e ? runE2eSuite() : { ran: false, expected: false, failing: [], total: 0 },
};

const failures = failuresOf(state);

if (has('--save')) {
  fs.writeFileSync(BASELINE, `${JSON.stringify(state, null, 2)}\n`);
  console.log(`\nverify: baseline saved to ${path.relative(ROOT, BASELINE)} — ${failures.size} failing.`);

  if (failures.size) {
    list('ALREADY FAILING — before you changed anything', [...failures]);
    console.log('\nDecide with the user whether to fix these first. Do not build silently on a red tree.');
  }

  process.exit(0);
}

if (!fs.existsSync(BASELINE)) {
  console.log(`\nverify: no baseline recorded. ${failures.size} failing now.`);
  list('FAILING', [...failures]);
  console.log('\nRun `npm run verify:save` BEFORE your next change to get a comparison.');
  process.exit(failures.size ? 1 : 0);
}

const before = JSON.parse(fs.readFileSync(BASELINE, 'utf8')) as RunState;
const was = failuresOf(before);

if (before.scope !== scope) {
  console.log(
    `\nverify: the baseline was taken at scope=${before.scope} and this run is scope=${scope}.`
    + ' Only what both runs covered is comparable.',
  );
}

const broke = [...failures].filter((f) => !was.has(f));
const fixed = [...was].filter((f) => !failures.has(f));
const persisted = [...failures].filter((f) => was.has(f));

console.log('');
list('BROKE — not failing in the baseline, failing now', broke);
list('FIXED — failing in the baseline, passing now', fixed);
list('ALREADY FAILING — inherited, not yours', persisted);

if (!broke.length && !fixed.length && !persisted.length) {
  console.log('No change: everything passed in the baseline and everything passes now.');
}

// The exit code answers the question in the header, and only that question.
// Inherited failures are reported and do not fail the run — a tool that blames
// you for someone else's red is a tool people learn to skip.
if (broke.length) {
  console.log(`\nverify: ${broke.length} regression(s). Read AGENTS.md §5 before changing either side.`);
  process.exit(1);
}

console.log('\nverify: no regressions.');
process.exit(0);
