/**
 * Operational health report formatter.
 *
 * Pure functions only — no IO. Test packs and the seeder produce
 * `PackResult` / `IntegrityFinding` objects; this turns them into the
 * markdown health report defined in
 * docs/qa/KAUN_KAREGA_REGULAR_TESTING_GUIDE.md (§13). A future Admin →
 * Testing dashboard can consume the same `HealthReport` object directly.
 */

export type PackStatus = "pass" | "fail" | "skipped" | "pending";

export interface PackResult {
  pack: string;
  status: PackStatus;
  passed: number;
  failed: number;
  skipped: number;
  /** Names of failed scenarios, for the report's failure list. */
  failures?: string[];
  notes?: string;
}

export interface IntegrityFinding {
  check: string;
  ok: boolean;
  detail: string;
}

export interface HealthReport {
  /** ISO timestamp — passed in by the caller (clock is not read here). */
  generatedAt: string;
  target: string;
  mode: "full" | "read-only";
  packs: PackResult[];
  integrity?: IntegrityFinding[];
  manualChecklistPending?: string[];
}

const STATUS_ICON: Record<PackStatus, string> = {
  pass: "✅",
  fail: "🔴",
  skipped: "⚪",
  pending: "🟡",
};

export function overallStatus(report: HealthReport): PackStatus {
  if (report.packs.some((p) => p.status === "fail")) return "fail";
  if (report.integrity?.some((i) => !i.ok)) return "fail";
  if (report.packs.some((p) => p.status === "pending")) return "pending";
  if (report.packs.length && report.packs.every((p) => p.status === "skipped"))
    return "skipped";
  return "pass";
}

export function formatHealthReport(report: HealthReport): string {
  const lines: string[] = [];
  const overall = overallStatus(report);

  lines.push(`# Kaun Karega — Operational Health Report`);
  lines.push("");
  lines.push(`- **Overall:** ${STATUS_ICON[overall]} ${overall.toUpperCase()}`);
  lines.push(`- **Generated:** ${report.generatedAt}`);
  lines.push(`- **Target:** ${report.target || "<unset>"}`);
  lines.push(`- **Mode:** ${report.mode}`);
  lines.push("");

  lines.push(`## Pack results`);
  lines.push("");
  lines.push(`| Pack | Status | Pass | Fail | Skip |`);
  lines.push(`|------|--------|------|------|------|`);
  for (const p of report.packs) {
    lines.push(
      `| ${p.pack} | ${STATUS_ICON[p.status]} ${p.status} | ${p.passed} | ${
        p.failed
      } | ${p.skipped} |`
    );
  }
  lines.push("");

  const failures = report.packs.flatMap((p) =>
    (p.failures ?? []).map((f) => `- [${p.pack}] ${f}`)
  );
  if (failures.length) {
    lines.push(`## Failed scenarios`);
    lines.push("");
    lines.push(...failures);
    lines.push("");
  }

  if (report.integrity?.length) {
    lines.push(`## Data integrity`);
    lines.push("");
    for (const i of report.integrity) {
      lines.push(`- ${i.ok ? "✅" : "🔴"} **${i.check}** — ${i.detail}`);
    }
    lines.push("");
  }

  if (report.manualChecklistPending?.length) {
    lines.push(`## Manual checklist (pending)`);
    lines.push("");
    for (const item of report.manualChecklistPending) {
      lines.push(`- [ ] ${item}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}
