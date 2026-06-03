/**
 * Data Integrity Pack [@data] — read-only invariants.
 *
 * SELECT-only. Safe to run anywhere creds exist (including production, where
 * it is diagnostics-only and never writes). Scope:
 *   KK_INTEGRITY_SCOPE=kktest (default) — only KKTEST personas (post-seed).
 *   KK_INTEGRITY_SCOPE=all              — platform-wide invariant sweep.
 *
 * KK_INTEGRITY_REPORT_ONLY=1 logs findings without failing (useful for a
 * first production read-only pass before treating violations as gates).
 */

import { test, expect } from "@playwright/test";

import { hasServiceRoleCreds, makeAdminClient } from "../_support/kktest/env";
import { runIntegrityChecks, type IntegrityScope } from "../_support/kktest/integrity";

function scope(): IntegrityScope {
  return (process.env.KK_INTEGRITY_SCOPE || "").trim().toLowerCase() === "all"
    ? "all"
    : "kktest";
}
const reportOnly = process.env.KK_INTEGRITY_REPORT_ONLY === "1";

test.describe("Data Integrity Pack [@data]", () => {
  test("data integrity invariants (read-only)", async () => {
    test.skip(!hasServiceRoleCreds(), "SUPABASE service-role creds not available");

    const c = makeAdminClient();
    const findings = await runIntegrityChecks(c, scope(), new Date().toISOString());

    for (const f of findings) {
      console.log(`[integrity:${scope()}] ${f.ok ? "OK " : "FAIL"} — ${f.check}: ${f.detail}`);
    }

    const failed = findings.filter((f) => !f.ok);
    if (reportOnly) {
      console.log(`[integrity] report-only mode: ${failed.length} violation(s) (not failing run).`);
      return;
    }
    expect(failed, `integrity violations: ${failed.map((f) => f.check).join(", ")}`).toEqual([]);
  });
});
