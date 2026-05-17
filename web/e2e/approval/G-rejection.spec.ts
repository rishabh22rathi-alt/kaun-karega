/**
 * Scenario G — Rejection flow.
 *
 * Confirmed product decision: rejection of the last open queue item
 * still flips providers.status to 'active'. Reasoning: only that
 * specific request was rejected; the provider account itself should
 * remain usable.
 *
 * Three sub-cases covered:
 *   (1) category reject → status flips to active
 *   (2) alias reject    → status flips to active (covered in C)
 *   (3) duplicate_name_review_status='pending' provider rejection of
 *       a queue item → status stays pending (duplicate-name flow owns
 *       the lifecycle)
 *
 * Real-DB integration. Gated by QA_HARNESS_RECONCILE=1.
 */

import { test, expect } from "@playwright/test";

import {
  adminRejectCategoryRequest,
  cleanupHarnessRows,
  isReconcileHarnessEnabled,
  readProvider,
  seedDummyProvider,
  seedPendingCategoryRequest,
} from "../_support/qaReconcile";
import { QA_ADMIN_PHONE } from "../_support/data";

test.describe("Scenario G — rejection flow", () => {
  test.skip(
    !isReconcileHarnessEnabled(),
    "Set QA_HARNESS_RECONCILE=1 to enable the reconcile suite"
  );

  test.afterEach(async ({ request }) => {
    await cleanupHarnessRows(request);
  });

  test("category reject flips pending → active (last-item rule)", async ({
    request,
    baseURL,
  }) => {
    const provider = await seedDummyProvider(request, {
      phoneSuffix: 108,
      status: "pending",
    });
    const { requestId } = await seedPendingCategoryRequest(
      request,
      provider.providerId,
      "ZZ_QA_Custom_Category_G"
    );

    const result = await adminRejectCategoryRequest(
      request,
      baseURL!,
      QA_ADMIN_PHONE,
      requestId,
      "Rejected by QA Scenario G"
    );
    expect(result.status).toBe(200);
    expect(result.body.ok).toBe(true);

    const after = await readProvider(request, provider.providerId);
    expect(after?.status).toBe("active");
  });

  test("duplicate_name_review_status=pending suppresses reconcile", async ({
    request,
    baseURL,
  }) => {
    const provider = await seedDummyProvider(request, {
      phoneSuffix: 109,
      status: "pending",
      verified: "no",
      duplicateNameReviewStatus: "pending",
    });
    const { requestId } = await seedPendingCategoryRequest(
      request,
      provider.providerId,
      "ZZ_QA_Custom_Category_G2"
    );

    const result = await adminRejectCategoryRequest(
      request,
      baseURL!,
      QA_ADMIN_PHONE,
      requestId
    );
    expect(result.status).toBe(200);

    const after = await readProvider(request, provider.providerId);
    // duplicate-name flow owns this provider's lifecycle. Reconcile
    // must skip and leave status='pending' for the duplicate-name
    // helpers to resolve.
    expect(after?.status).toBe("pending");
    expect(after?.duplicate_name_review_status).toBe("pending");
  });
});
