// scripts/security/lib.ts — the mechanics of the security harness: the vocabulary
// (severities, the standards a finding cites), the collector every check writes to,
// and the three reporters. No I/O and no security knowledge live here — the checks
// hold the knowledge, policy.ts holds the rule catalogue, and target.ts holds the
// network. Keeping this layer pure is what lets check-security.ts and pentest.ts
// share one definition of "a finding" and disagree only about how loudly to print.

/* ---- severity -------------------------------------------------------------- */

export type Severity = "critical" | "high" | "medium" | "low" | "info";

// Highest first, so a smaller index is a worse problem. Used for sorting and for
// the tripwire's floor ("fail on medium and above").
export const SEVERITY_ORDER: readonly Severity[] = [
  "critical",
  "high",
  "medium",
  "low",
  "info",
] as const;

export const severityRank = (s: Severity): number => SEVERITY_ORDER.indexOf(s);

/** Is `s` at least as severe as `floor`? (critical meets a floor of low; info does not meet medium.) */
export const meetsFloor = (s: Severity, floor: Severity): boolean =>
  severityRank(s) <= severityRank(floor);

/* ---- the standards a finding is measured against --------------------------- */

// NIST SP 800-115 organises a technical assessment into four phases; the report is
// laid out by them, and every active/passive check declares the one it belongs to.
export type NistPhase = "Planning" | "Discovery" | "Attack" | "Reporting";

// PTES (the Penetration Testing Execution Standard) is cross-referenced too: every
// finding is annotated with the one PTES phase it belongs to. The report's own
// structure follows NIST SP 800-115; PTES is a per-finding tag, not a second layout.
export type PtesPhase =
  | "Intelligence Gathering"
  | "Threat Modeling"
  | "Vulnerability Analysis"
  | "Exploitation"
  | "Post Exploitation"
  | "Reporting";

/** The immutable part of a finding — its rule identity, from policy.ts's catalogue. */
export interface Rule {
  /** Stable id, e.g. "headers/csp-missing". Used in the report and the exception ledger. */
  id: string;
  title: string;
  severity: Severity;
  /** CWE ids, e.g. [1021] for clickjacking. */
  cwe?: number[];
  /** OWASP Top-10 2021 refs, e.g. ["A05:2021"]. */
  owasp?: string[];
  /** Free-form standard citations: "OWASP Secure Headers Project", "RFC 9116 §2.5.3", "Mozilla Observatory". */
  standards?: string[];
  nist: NistPhase;
  ptes: PtesPhase;
  /** The fix, phrased once here so every instance of the finding says the same thing. */
  remediation: string;
}

/** A concrete occurrence of a rule against one target. */
export interface Finding extends Rule {
  /** Which target this was seen on, e.g. "local:org" or "remote:imqueue.com". */
  target: string;
  /** The path, URL or file the finding is anchored to. */
  location?: string;
  /** What was actually observed — the proof. */
  evidence?: string;
  /**
   * Set when a deliberately-accepted exception (policy.ts) matches this finding.
   * Accepted findings are reported as accepted risks and never fail the tripwire.
   */
  accepted?: { reason: string; since?: string; review?: string };
}

/* ---- the collector --------------------------------------------------------- */

/**
 * A per-target writer handed to every check, so a check never has to know the
 * target label or repeat it. `report.on("local:org")` returns one of these.
 */
export interface Sink {
  target: string;
  /** Record a finding. `extra` carries the dynamic half (location/evidence). */
  add(rule: Rule, extra?: { location?: string; evidence?: string }): void;
  /** Record that a check ran, exercised the rule, and found nothing — feeds the coverage summary. */
  pass(ruleId: string): void;
  /**
   * Record that a rule was NOT exercised on this target (e.g. shadowed by the
   * honeypot, un-sendable from a browser client, or observable only over the edge).
   * Kept apart from pass() so the coverage number never counts an un-run check as a
   * clean one. `reason` explains why, for the report.
   */
  skip(ruleId: string, reason: string): void;
}

/** The enumerated attack surface, fed into the report's Discovery inventory (NIST §3). */
export interface DiscoveryInventory {
  endpoints: string[];
  apiPackages: string[];
  forms: { page: string; action: string; method: string }[];
  externalOrigins: string[];
}

export class Report {
  readonly findings: Finding[] = [];
  /** ruleIds that ran and passed, per target — proof the check executed. */
  readonly passed = new Set<string>();
  /**
   * ruleIds that were NOT exercised on a target, with the reason. Kept apart from
   * `passed` so "N checks executed and passed" never absorbs a check that could not
   * run (honeypot-shadowed, browser-unsendable, edge-only). `${target}::${id}` → reason.
   */
  readonly skipped = new Map<string, string>();
  /** Free-text notes about what was discovered/enumerated, for the report's Discovery section. */
  readonly notes: string[] = [];
  /** The enumerated attack surface, rendered as the report's Discovery inventory. */
  discovery: DiscoveryInventory | null = null;

  on(target: string): Sink {
    return {
      target,
      add: (rule, extra) => {
        this.findings.push({ ...rule, target, ...extra });
      },
      pass: (ruleId) => {
        this.passed.add(`${target}::${ruleId}`);
      },
      skip: (ruleId, reason) => {
        this.skipped.set(`${target}::${ruleId}`, reason);
      },
    };
  }

  note(message: string): void {
    this.notes.push(message);
  }

  setDiscovery(inv: DiscoveryInventory): void {
    this.discovery = inv;
  }

  /** Findings sorted worst-first, then by target and id for stable output. */
  sorted(): Finding[] {
    return [...this.findings].sort(
      (a, b) =>
        severityRank(a.severity) - severityRank(b.severity) ||
        a.target.localeCompare(b.target) ||
        a.id.localeCompare(b.id),
    );
  }

  /** Findings that are NOT accepted and meet the floor — the set that fails a build. */
  blocking(floor: Severity): Finding[] {
    return this.sorted().filter((f) => !f.accepted && meetsFloor(f.severity, floor));
  }

  counts(): Record<Severity, number> {
    const c: Record<Severity, number> = {
      critical: 0,
      high: 0,
      medium: 0,
      low: 0,
      info: 0,
    };

    for (const f of this.findings) {
      if (!f.accepted) c[f.severity] += 1;
    }

    return c;
  }
}

/* ---- reporters ------------------------------------------------------------- */

const useColor = process.stdout.isTTY && !process.env.NO_COLOR;

const paint = (code: number, text: string): string =>
  useColor ? `\x1b[${code}m${text}\x1b[0m` : text;

const SEVERITY_COLOR: Record<Severity, number> = {
  critical: 41, // white on red
  high: 31, // red
  medium: 33, // yellow
  low: 36, // cyan
  info: 90, // grey
};

const tag = (s: Severity): string =>
  paint(SEVERITY_COLOR[s], ` ${s.toUpperCase().padEnd(8)} `);

const refs = (f: Finding): string => {
  const parts: string[] = [];

  if (f.cwe?.length) parts.push(f.cwe.map((n) => `CWE-${n}`).join(", "));
  if (f.owasp?.length) parts.push(f.owasp.join(", "));
  if (f.standards?.length) parts.push(...f.standards);

  return parts.join(" · ");
};

/** Human console output — grouped worst-first, accepted risks listed apart. */
export function printConsole(report: Report, floor: Severity): void {
  const findings = report.sorted();
  const open = findings.filter((f) => !f.accepted);
  const accepted = findings.filter((f) => f.accepted);

  for (const f of open) {
    console.log(`${tag(f.severity)} ${paint(1, f.title)}  ${paint(90, `[${f.id}]`)}`);
    console.log(`           target: ${f.target}${f.location ? `  ${f.location}` : ""}`);
    if (f.evidence) console.log(`           ${paint(90, "evidence:")} ${f.evidence}`);
    const r = refs(f);
    if (r) console.log(`           ${paint(90, r)}`);
    console.log(`           ${paint(90, "fix:")} ${f.remediation}`);
    console.log("");
  }

  if (accepted.length) {
    console.log(paint(90, `Accepted risks (${accepted.length}) — documented, not failing the build:`));
    for (const f of accepted) {
      console.log(
        paint(90, `  · [${f.id}] ${f.title} — ${f.accepted?.reason ?? ""}`),
      );
    }
    console.log("");
  }

  const c = report.counts();
  const blocking = report.blocking(floor).length;
  const summary =
    `critical ${c.critical}  high ${c.high}  medium ${c.medium}  low ${c.low}  info ${c.info}` +
    `  ·  ${blocking} at/above ${floor}`;

  console.log(paint(1, "Summary: ") + summary);
  console.log(
    paint(
      90,
      `Coverage: ${report.passed.size} check(s) exercised & passed, ` +
        `${report.skipped.size} not exercised in this mode (see the report for why).`,
    ),
  );
}

/**
 * The Planning-phase scope statement (NIST SP 800-115 §3.1 / PTES Pre-engagement):
 * what is in and out of scope, the rules of engagement, and the standing assumptions.
 * Coded once in policy.ts so the deliverable carries an explicit RoE rather than an
 * implicit one.
 */
export interface ScopeInfo {
  inScope: string[];
  outOfScope: string[];
  rulesOfEngagement: string[];
  assumptions: string[];
  limitations: string[];
}

export interface ReportMeta {
  /** "Local build" or "Live" etc. */
  mode: string;
  targets: string[];
  startedISO: string;
  finishedISO: string;
  floor: Severity;
  /** Planning-phase scope; rendered as §2 when present. */
  scope?: ScopeInfo;
}

/** Machine-readable dump, for diffing runs or feeding other tools. */
export function toJson(report: Report, meta: ReportMeta): string {
  return JSON.stringify(
    {
      meta,
      counts: report.counts(),
      notes: report.notes,
      findings: report.sorted(),
    },
    null,
    2,
  );
}

/**
 * The deliverable report, laid out by NIST SP 800-115 phase and cross-referenced to
 * PTES — an assessment write-up rather than a log. Written by pentest.ts.
 */
export function toMarkdown(report: Report, meta: ReportMeta): string {
  const findings = report.sorted();
  const open = findings.filter((f) => !f.accepted);
  const accepted = findings.filter((f) => f.accepted);
  const c = report.counts();
  const L: string[] = [];

  L.push(`# Penetration test report — @imqueue websites`);
  L.push("");
  L.push(`- **Assessment type:** ${meta.mode} (non-destructive, automated)`);
  L.push(`- **Targets:** ${meta.targets.join(", ")}`);
  L.push(`- **Window:** ${meta.startedISO} → ${meta.finishedISO}`);
  L.push(
    `- **Standards:** NIST SP 800-115 · PTES · OWASP Top 10 (2021) · OWASP Secure Headers Project · CWE · Mozilla Observatory / securityheaders.com · RFC 9116`,
  );
  L.push("");

  L.push(`## 1. Executive summary`);
  L.push("");
  L.push(
    `Automated assessment produced **${open.length} open finding(s)** ` +
      `(critical ${c.critical}, high ${c.high}, medium ${c.medium}, low ${c.low}, info ${c.info}) ` +
      `and **${accepted.length} accepted risk(s)**.`,
  );
  L.push("");
  L.push(`| Severity | Open |`);
  L.push(`|---|---|`);
  for (const s of SEVERITY_ORDER) L.push(`| ${s} | ${c[s]} |`);
  L.push("");

  L.push(`## 2. Planning & scope (NIST SP 800-115 §3.1 · PTES Pre-engagement)`);
  L.push("");
  L.push(
    `This assessment follows the four NIST SP 800-115 phases — Planning, Discovery, ` +
      `Attack, Reporting. Every finding is additionally annotated with its PTES phase. ` +
      `It is fully automated and non-destructive: no data is modified, no mail is ` +
      `actually sent, and no availability test (load/DoS) is performed.`,
  );
  L.push("");
  if (meta.scope) {
    const block = (title: string, items: string[]): void => {
      if (!items.length) return;
      L.push(`**${title}**`);
      L.push("");
      for (const i of items) L.push(`- ${i}`);
      L.push("");
    };
    block("In scope", meta.scope.inScope);
    block("Out of scope", meta.scope.outOfScope);
    block("Rules of engagement", meta.scope.rulesOfEngagement);
    block("Assumptions", meta.scope.assumptions);
    block("Known limitations", meta.scope.limitations);
  } else {
    L.push(`Targets in scope: ${meta.targets.join(", ")}.`);
    L.push("");
  }

  L.push(`## 3. Discovery (attack surface)`);
  L.push("");
  const inv = report.discovery;
  if (inv) {
    L.push(`Enumerated from the repository artefacts (not a hard-coded list):`);
    L.push("");
    L.push(`- **Endpoints (${inv.endpoints.length}):** ${inv.endpoints.length ? inv.endpoints.map((e) => `\`${e}\``).join(", ") : "—"}`);
    L.push(`- **\`/api/\` packages (${inv.apiPackages.length}):** ${inv.apiPackages.length ? inv.apiPackages.join(", ") : "—"}`);
    L.push(`- **Forms (${inv.forms.length}):** ${inv.forms.length ? inv.forms.map((f) => `${f.method} ${f.action || "(self)"} @ ${f.page}`).join("; ") : "—"}`);
    L.push(`- **External origins referenced (${inv.externalOrigins.length}):** ${inv.externalOrigins.length ? inv.externalOrigins.join(", ") : "—"}`);
    L.push("");
  }
  if (report.notes.length) {
    for (const n of report.notes) L.push(`- ${n}`);
  } else if (!inv) {
    L.push(`- (no discovery notes recorded)`);
  }
  L.push("");

  // Every NIST phase, so a finding classed Planning or Reporting is rendered rather
  // than counted-but-hidden. A heading appears only when its phase has open findings.
  const phases: NistPhase[] = ["Planning", "Discovery", "Attack", "Reporting"];
  L.push(`## 4. Findings`);
  L.push("");
  if (!open.length) {
    L.push(`No open findings at or above the reporting threshold.`);
    L.push("");
  }
  let sub = 0;
  for (const phase of phases) {
    const inPhase = open.filter((f) => f.nist === phase);
    if (!inPhase.length) continue;
    sub += 1;
    L.push(`### 4.${sub} ${phase}-phase findings`);
    L.push("");
    for (const f of inPhase) {
      L.push(`#### [${f.severity.toUpperCase()}] ${f.title}`);
      L.push("");
      L.push(`- **Rule:** \`${f.id}\``);
      L.push(`- **Target:** ${f.target}${f.location ? ` — \`${f.location}\`` : ""}`);
      if (f.cwe?.length) L.push(`- **CWE:** ${f.cwe.map((n) => `CWE-${n}`).join(", ")}`);
      if (f.owasp?.length) L.push(`- **OWASP:** ${f.owasp.join(", ")}`);
      if (f.standards?.length) L.push(`- **References:** ${f.standards.join("; ")}`);
      L.push(`- **PTES phase:** ${f.ptes}`);
      if (f.evidence) L.push(`- **Evidence:** ${f.evidence}`);
      L.push(`- **Remediation:** ${f.remediation}`);
      L.push("");
    }
  }

  L.push(`## 5. Accepted risks`);
  L.push("");
  if (!accepted.length) {
    L.push(`None.`);
  } else {
    L.push(`| Rule | Finding | Reason | Since | Review by |`);
    L.push(`|---|---|---|---|---|`);
    for (const f of accepted) {
      L.push(
        `| \`${f.id}\` | ${f.title} | ${f.accepted?.reason ?? ""} | ${f.accepted?.since ?? "—"} | ${f.accepted?.review ?? "—"} |`,
      );
    }
  }
  L.push("");

  L.push(`## 6. Coverage`);
  L.push("");
  L.push(
    `**${report.passed.size} check(s) exercised and passed** across ${meta.targets.length} target(s). ` +
      `A passing check that later regresses becomes a finding here on the next build.`,
  );
  L.push("");
  if (report.skipped.size) {
    L.push(
      `**${report.skipped.size} check(s) not exercised in this mode** — counted apart from the ` +
        `passing set so the coverage number reflects only checks that actually ran:`,
    );
    L.push("");
    L.push(`| Target · rule | Why it was not exercised |`);
    L.push(`|---|---|`);
    for (const [key, reason] of [...report.skipped].sort((a, b) => a[0].localeCompare(b[0]))) {
      L.push(`| \`${key}\` | ${reason} |`);
    }
    L.push("");
  }

  return L.join("\n");
}
