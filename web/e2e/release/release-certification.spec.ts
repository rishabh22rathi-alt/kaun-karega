/**
 * Release Certification Pack [@release] — STRUCTURE (Phase 1).
 *
 * This pack is the pre-launch gate. The full implementation (Phase 2) will
 * orchestrate the critical packs in order and emit a single certification
 * verdict. For now it ships the *structure*: it asserts the framework
 * scaffolding is present, then enumerates the ordered certification gates as
 * pending (`fixme`) so they appear in every report as not-yet-automated.
 *
 * Nothing here runs business logic or touches the database.
 */

import { test, expect } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";

const REPO_WEB = path.resolve(__dirname, "../..");
const REPO_ROOT = path.resolve(REPO_WEB, "..");

/** Ordered certification gates (mirrors the guide's execution order). */
const CERTIFICATION_GATES = [
  "Smoke",
  "Auth / Security guards",
  "User Journey",
  "Provider Journey",
  "Matching Engine",
  "Chat / Response",
  "Notifications",
  "Revenue / Payment / Invoice",
  "Admin Operations",
  "Data Integrity",
  "Mobile / PWA (manual)",
  "Final Security / PII gate",
];

test.describe("Release Certification Pack [@release]", () => {
  test("framework scaffolding is present", () => {
    const required = [
      path.join(REPO_ROOT, "docs/qa/KAUN_KAREGA_REGULAR_TESTING_GUIDE.md"),
      path.join(REPO_WEB, "pw-kk.config.ts"),
      path.join(REPO_WEB, "e2e/_support/kktest/personas.ts"),
      path.join(REPO_WEB, "e2e/_support/kktest/seedPersonas.ts"),
      path.join(REPO_WEB, "e2e/_support/kktest/resetPersonas.ts"),
      path.join(REPO_WEB, "e2e/_support/kktest/guard.ts"),
      path.join(REPO_WEB, "e2e/_support/kktest/report.ts"),
    ];
    const missing = required.filter((p) => !fs.existsSync(p));
    expect(missing, `missing scaffolding: ${missing.join(", ")}`).toEqual([]);
  });

  test("certification gates are defined in order", () => {
    expect(CERTIFICATION_GATES.length).toBeGreaterThanOrEqual(12);
    expect(CERTIFICATION_GATES[0]).toBe("Smoke");
    expect(CERTIFICATION_GATES.at(-1)).toBe("Final Security / PII gate");
  });

  // Phase 2: replace with real aggregation of each pack's verdict.
  test.fixme("aggregate all critical pack verdicts into one certification", () => {
    // Intentionally pending until Phase 2 wires per-pack results.
  });
});
