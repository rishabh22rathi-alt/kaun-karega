/**
 * Phase B Step 6 — admin test-push route auth gate.
 *
 * The route requires an admin session and NO x-kk-test-secret. Without a
 * session it must reject before any push work. (The authenticated send
 * path needs a real admin session + Firebase + a registered device, so it
 * is verified manually on a device — see the report.)
 */

import { test, expect } from "@playwright/test";

test.describe("Admin test-push route", () => {
  test("POST /api/admin/push/test → 401 without an admin session", async ({
    page,
  }) => {
    const res = await page.request.post("/api/admin/push/test");
    expect(res.status()).toBe(401);
  });
});
