/**
 * KKTEST seed runner [@seed].
 *
 * Invoked via `npm run test:kk:seed` (Playwright `setup` project). Runs the
 * idempotent seeder, but only when writes are explicitly allowed on a
 * non-prod target. Otherwise it SKIPS with the block reason — it never fails
 * the run just because creds/opt-in are absent.
 */

import { test, expect } from "@playwright/test";

import { writeBlockReason, writesAllowed } from "../_support/kktest/env";
import { seedPersonas } from "../_support/kktest/seedPersonas";

test.describe("KKTEST seed [@seed]", () => {
  test("seed canonical KKTEST personas (idempotent)", async () => {
    test.skip(!writesAllowed(), `KKTEST writes not allowed: ${writeBlockReason()}`);

    const summary = await seedPersonas();
    expect(summary.ok).toBe(true);
    expect(summary.providersSeeded).toBeGreaterThan(0);
    console.log(
      `[KKTEST seed] ${summary.providersSeeded} providers seeded; ` +
        `${summary.regionsResolved} active regions (known=${summary.knownRegion}, alt=${summary.altRegion}).`
    );
  });
});
