/**
 * Operational Health Pack [@health] — production-safe read-only diagnostics.
 *
 * Designed to be the one pack you can point at PRODUCTION: it performs only
 * SELECT-style integrity reads (no writes, no seeding, no UI mutations) and
 * emits a markdown health report artifact. Scope defaults to "all" so it
 * reflects the real platform.
 *
 * It does NOT require KK_ALLOW_LIVE_SEED — that flag only gates writes.
 */

import { test, expect } from "@playwright/test";

import { hasServiceRoleCreds, makeAdminClient, resolveTarget } from "../_support/kktest/env";
import { runIntegrityChecks, type IntegrityScope } from "../_support/kktest/integrity";
import { formatHealthReport, type HealthReport } from "../_support/kktest/report";

function scope(): IntegrityScope {
  return (process.env.KK_INTEGRITY_SCOPE || "all").trim().toLowerCase() === "kktest"
    ? "kktest"
    : "all";
}
const reportOnly = process.env.KK_INTEGRITY_REPORT_ONLY === "1";

test.describe("Operational Health Pack [@health]", () => {
  test("platform health (read-only diagnostics)", async () => {
    test.skip(!hasServiceRoleCreds(), "SUPABASE service-role creds not available");

    const c = makeAdminClient();
    const integrity = await runIntegrityChecks(c, scope(), new Date().toISOString());

    const report: HealthReport = {
      generatedAt: new Date().toISOString(),
      target: resolveTarget() || "(read-only)",
      mode: "read-only",
      packs: [],
      integrity,
    };
    const md = formatHealthReport(report);
    await test.info().attach("operational-health-report.md", {
      body: md,
      contentType: "text/markdown",
    });
    console.log(md);

    const failed = integrity.filter((f) => !f.ok);
    if (reportOnly) return;
    expect(failed, `health violations: ${failed.map((f) => f.check).join(", ")}`).toEqual([]);
  });
});
