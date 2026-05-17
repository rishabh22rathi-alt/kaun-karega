/**
 * Scenario F — Combined change: category + alias + area in one provider.
 *
 * Tests the "no early flip" invariant: providers.status must remain
 * 'pending' after the first two of three approvals, and flip to
 * 'active' only when the LAST open queue item is cleared.
 *
 * Real-DB integration. Gated by QA_HARNESS_RECONCILE=1.
 */

import { test, expect } from "@playwright/test";

import {
  adminApproveAlias,
  adminApproveCategoryRequest,
  adminResolveUnmappedArea,
  cleanupHarnessRows,
  isReconcileHarnessEnabled,
  readProvider,
  seedDummyProvider,
  seedPendingAlias,
  seedPendingAreaReview,
  seedPendingCategoryRequest,
} from "../_support/qaReconcile";
import { QA_ADMIN_PHONE, QA_CATEGORY } from "../_support/data";

test.describe("Scenario F — combined category + alias + area", () => {
  test.skip(
    !isReconcileHarnessEnabled(),
    "Set QA_HARNESS_RECONCILE=1 to enable the reconcile suite"
  );

  test.afterEach(async ({ request }) => {
    await cleanupHarnessRows(request);
  });

  test("status stays pending until the last open item is cleared", async ({
    request,
    baseURL,
  }) => {
    const provider = await seedDummyProvider(request, {
      phoneSuffix: 107,
      status: "pending",
    });

    const { requestId } = await seedPendingCategoryRequest(
      request,
      provider.providerId,
      "ZZ_QA_Custom_Category_F"
    );
    const alias = `zz_qa_alias_F_${Date.now()}`;
    await seedPendingAlias(request, provider.providerId, alias, QA_CATEGORY);
    const { reviewId } = await seedPendingAreaReview(
      request,
      provider.providerId,
      `ZZ_QA_RawArea_F_${Date.now()}`
    );

    // After step 1 (category approve): still pending — alias + area open.
    const r1 = await adminApproveCategoryRequest(
      request,
      baseURL!,
      QA_ADMIN_PHONE,
      requestId,
      "ZZ_QA_Custom_Category_F"
    );
    expect(r1.status).toBe(200);
    let p = await readProvider(request, provider.providerId);
    expect(p?.status).toBe("pending");

    // After step 2 (alias approve): still pending — area open.
    const r2 = await adminApproveAlias(
      request,
      baseURL!,
      QA_ADMIN_PHONE,
      alias
    );
    expect(r2.status).toBe(200);
    p = await readProvider(request, provider.providerId);
    expect(p?.status).toBe("pending");

    // After step 3 (area resolve): all clear → active.
    const r3 = await adminResolveUnmappedArea(
      request,
      baseURL!,
      QA_ADMIN_PHONE,
      reviewId
    );
    expect(r3.status).toBe(200);
    p = await readProvider(request, provider.providerId);
    expect(p?.status).toBe("active");
    expect(p?.verified).toBe("yes");
  });
});
