/**
 * KKTEST reset runner [@reset].
 *
 * Invoked via `npm run test:kk:reset` (Playwright `setup` project). Guarded
 * purge of all KKTEST rows, then reseed. Skips when writes are not allowed.
 */

import { test, expect } from "@playwright/test";

import { writeBlockReason, writesAllowed } from "../_support/kktest/env";
import { resetPersonas } from "../_support/kktest/resetPersonas";

test.describe("KKTEST reset [@reset]", () => {
  test("reset + reseed canonical KKTEST personas", async () => {
    test.skip(!writesAllowed(), `KKTEST writes not allowed: ${writeBlockReason()}`);

    const summary = await resetPersonas({ reseed: true });
    expect(summary.ok).toBe(true);
    expect(summary.reseeded).toBe(true);
    console.log(
      `[KKTEST reset] purged + reseeded ${summary.seed?.providersSeeded ?? 0} providers.`
    );
  });
});
