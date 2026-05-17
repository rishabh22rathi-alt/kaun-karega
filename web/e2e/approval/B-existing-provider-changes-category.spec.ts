/**
 * Scenario B — Existing approved provider with a stale pending request.
 *
 * Tests the rule "reconcile is a no-op when status is not pending."
 * Seed an active provider plus an unrelated pending_category_request
 * row; approving it must NOT flip the provider's status (because it
 * never was 'pending' to begin with).
 *
 * The earlier audit found that /api/provider/update does not enqueue
 * a category request when an active provider switches categories. So
 * the realistic shape of this scenario is "provider is already active
 * but has a pending request hanging around from some other code path".
 * This test asserts the reconcile no-ops correctly.
 *
 * Real-DB integration. Gated by QA_HARNESS_RECONCILE=1.
 */

import { test, expect } from "@playwright/test";

import {
  adminApproveCategoryRequest,
  cleanupHarnessRows,
  isReconcileHarnessEnabled,
  readProvider,
  seedDummyProvider,
  seedPendingCategoryRequest,
} from "../_support/qaReconcile";
import { QA_ADMIN_PHONE } from "../_support/data";

test.describe("Scenario B — already-active provider, reconcile no-ops", () => {
  test.skip(
    !isReconcileHarnessEnabled(),
    "Set QA_HARNESS_RECONCILE=1 to enable the reconcile suite"
  );

  test.afterEach(async ({ request }) => {
    await cleanupHarnessRows(request);
  });

  test("approve on already-active provider does not regress status", async ({
    request,
    baseURL,
  }) => {
    const provider = await seedDummyProvider(request, {
      phoneSuffix: 102,
      status: "active",
      verified: "yes",
    });

    const { requestId } = await seedPendingCategoryRequest(
      request,
      provider.providerId,
      "ZZ_QA_Custom_Category_B"
    );

    const result = await adminApproveCategoryRequest(
      request,
      baseURL!,
      QA_ADMIN_PHONE,
      requestId,
      "ZZ_QA_Custom_Category_B"
    );
    expect(result.status).toBe(200);
    expect(result.body.ok).toBe(true);

    const after = await readProvider(request, provider.providerId);
    // Was already active; reconcile must not change anything.
    expect(after?.status).toBe("active");
    expect(after?.verified).toBe("yes");
  });
});
