// scripts/security/run.ts — one assessment run over one or more targets. Wires the
// static and active checks to each target, then folds the accepted-exception ledger
// over the results so a deliberately-accepted gap (HSTS) is marked accepted rather
// than counted against the build. Both entry points (check-security.ts, pentest.ts)
// go through here so a finding means the same thing whichever one surfaced it.

import { Report } from "./lib.ts";
import { acceptedFor, ACCEPTED } from "./policy.ts";
import { runStaticChecks } from "./static.ts";
import { runActiveChecks } from "./active.ts";
import { discoverSurface } from "./discovery.ts";
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

    // Enumerate the attack surface once, for the report's Discovery inventory. The
    // first target's surface stands for the deployment (both editions share it).
    if (!report.discovery) {
      try {
        report.setDiscovery(await discoverSurface(target));
      } catch {
        /* an inventory failure must never stop the assessment */
      }
    }

    if (doStatic) await runStaticChecks(target, sink, report);
    if (doActive) await runActiveChecks(target, sink, report);
  }

  // Fold the exception ledger over every finding.
  for (const f of report.findings) {
    const exc = acceptedFor(f.id, f.target);
    if (exc) f.accepted = { reason: exc.reason, since: exc.since, review: exc.review };
  }

  // Enforce the accepted-risk review dates: an exception past its review date is
  // WARNED about (not failed), so a "temporary" acceptance cannot quietly become
  // permanent. One note per overdue rule, whether or not it produced a finding this run.
  const today = new Date().toISOString().slice(0, 10);
  for (const exc of ACCEPTED) {
    if (exc.review && exc.review < today) {
      report.note(
        `⚠ accepted-risk review overdue: \`${exc.id}\` was to be reviewed by ${exc.review} (today ${today}). Re-confirm the acceptance or fix the gap.`,
      );
    }
  }

  return report;
}
