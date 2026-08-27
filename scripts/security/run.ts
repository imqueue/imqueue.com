// scripts/security/run.ts — one assessment run over one or more targets. Wires the
// static and active checks to each target, then folds the accepted-exception ledger
// over the results so a deliberately-accepted gap (HSTS) is marked accepted rather
// than counted against the build. Both entry points (check-security.ts, pentest.ts)
// go through here so a finding means the same thing whichever one surfaced it.

import { Report } from "./lib.ts";
import { acceptedFor } from "./policy.ts";
import { runStaticChecks } from "./static.ts";
import { runActiveChecks } from "./active.ts";
import type { Target } from "./target.ts";

export interface RunOptions {
  /** Run passive/static analysis (default true). */
  static?: boolean;
  /** Run active probes (default true). */
  active?: boolean;
}

export async function runAssessment(targets: Target[], opts: RunOptions = {}): Promise<Report> {
  const report = new Report();
  const doStatic = opts.static !== false;
  const doActive = opts.active !== false;

  for (const target of targets) {
    const sink = report.on(target.label);
    report.note(`${target.label}: ${target.origin} (${target.kind})`);

    if (doStatic) await runStaticChecks(target, sink, report);
    if (doActive) await runActiveChecks(target, sink, report);
  }

  // Fold the exception ledger over every finding.
  for (const f of report.findings) {
    const exc = acceptedFor(f.id, f.target);
    if (exc) f.accepted = { reason: exc.reason, since: exc.since, review: exc.review };
  }

  return report;
}
