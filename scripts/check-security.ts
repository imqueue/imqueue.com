#!/usr/bin/env node
// scripts/check-security.ts — the security regression tripwire.
//
//   npm run check:security          # both built editions, local
//
// Runs the full assessment (static + active, non-destructive) against the BUILT
// local editions with the real Pages functions and _headers, and fails the build on
// any non-accepted finding at or above policy.FLOOR. It is wired into `npm test`
// after check:links (which builds both editions), so it runs on every commit via
// .githooks/pre-commit and in CI — the "runs on every build" the harness is for.
//
// No baseline snapshot: policy.ts is the baseline. A new gap is a finding the moment
// a check sees it; a deliberately-accepted one is recorded in policy.ACCEPTED and
// reported as an accepted risk. For the full, human-readable report — and for probing
// the LIVE sites — use `npm run pentest`.

import { existsSync } from "node:fs";
import path from "node:path";

import { REPO_ROOT } from "../tests/e2e/server/pages-core.ts";
import { FLOOR } from "./security/policy.ts";
import { printConsole } from "./security/lib.ts";
import { runAssessment } from "./security/run.ts";
import { runSelfTests } from "./security/selftest.ts";
import { createLocalTarget, type Target } from "./security/target.ts";

const EDITIONS: ("org" | "com")[] = ["org", "com"];

async function main(): Promise<void> {
  // Tests-of-the-tests FIRST: a check whose regex silently stopped matching would
  // record a pass and look clean. If a known-bad fixture goes green, fail here before
  // trusting the run below.
  const self = await runSelfTests();
  if (self.failed) {
    console.error(`check:security — self-tests FAILED (${self.failed}/${self.ran}); the checks themselves are broken:`);
    for (const f of self.failures) console.error(`  ✗ ${f}`);
    process.exit(1);
  }
  console.log(`check:security — self-tests passed (${self.ran} case(s)).`);

  for (const edition of EDITIONS) {
    if (!existsSync(path.join(REPO_ROOT, `_site-${edition}`, "index.html"))) {
      console.error(
        `check:security — _site-${edition} is not built. Run \`npm run build:all\` first ` +
          `(inside \`npm test\` this is done by check:links).`,
      );
      process.exit(1);
    }
  }

  const targets: Target[] = [];
  for (const edition of EDITIONS) targets.push(await createLocalTarget(edition));

  try {
    const report = await runAssessment(targets);

    printConsole(report, FLOOR);

    const blocking = report.blocking(FLOOR);

    if (blocking.length) {
      console.error(
        `\ncheck:security FAILED — ${blocking.length} finding(s) at or above ${FLOOR}. ` +
          `Fix them, or record a deliberate exception in scripts/security/policy.ts (ACCEPTED).`,
      );
      process.exit(1);
    }

    console.log(`\ncheck:security passed — no findings at or above ${FLOOR} on either edition.`);
    console.log(
      "Note: this is the LOCAL gate — it cannot see edge-only behaviour (zone Transform Rules such as a\n" +
        "re-injected Access-Control-Allow-Origin, TLS/HSTS, WAF/rate-limits, the CDN cache, and the\n" +
        "Pages-owned /_headers, /_redirects, /robots.txt). Run `npm run pentest -- --target remote`\n" +
        "after deploy to confirm the live edge.",
    );
  } finally {
    for (const t of targets) await t.close();
  }
}

main().catch((err) => {
  console.error("check:security crashed:", err);
  process.exit(1);
});
