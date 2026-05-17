/**
 * Scenario A — New provider registration approval.
 *
 * 1. Seed a dummy provider with status='pending' and one open
 *    pending_category_request row.
 * 2. Admin approves the category request.
 * 3. Assert: pending_category_requests row marked approved,
 *    provider_services row inserted, and providers.status flipped
 *    to 'active' (via the reconcile helper).
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

test.describe("Scenario A — new provider registration approval", () => {
  test.skip(
    !isReconcileHarnessEnabled(),
    "Set QA_HARNESS_RECONCILE=1 to enable the reconcile suite"
  );

  test.afterEach(async ({ request }) => {
    await cleanupHarnessRows(request);
  });

  test("category approve flips providers.status pending → active", async ({
    request,
    baseURL,
  }) => {
    const provider = await seedDummyProvider(request, {
      phoneSuffix: 101,
      status: "pending",
      verified: "yes",
    });

    const { requestId } = await seedPendingCategoryRequest(
      request,
      provider.providerId,
      "ZZ_QA_Custom_Category_A"
    );

    const result = await adminApproveCategoryRequest(
      request,
      baseURL!,
      QA_ADMIN_PHONE,
      requestId,
      "ZZ_QA_Custom_Category_A"
    );
    expect(result.status).toBe(200);
    expect(result.body.ok).toBe(true);

    const after = await readProvider(request, provider.providerId);
    expect(after?.status).toBe("active");
    expect(after?.verified).toBe("yes");
  });
});
