/**
 * Scenario D — Provider adds custom area, admin resolves it.
 *
 * Seeds:
 *   - dummy provider, status='pending'
 *   - one pending area_review_queue row with source_type=provider_register
 *
 * Admin calls admin_resolve_unmapped_area. Reconcile runs (because
 * source_type is in the provider set). With no other open items,
 * providers.status flips to 'active'.
 *
 * Real-DB integration. Gated by QA_HARNESS_RECONCILE=1.
 */

import { test, expect } from "@playwright/test";

import {
  adminResolveUnmappedArea,
  cleanupHarnessRows,
  isReconcileHarnessEnabled,
  readProvider,
  seedDummyProvider,
  seedPendingAreaReview,
} from "../_support/qaReconcile";
import { QA_ADMIN_PHONE } from "../_support/data";

test.describe("Scenario D — provider area review resolution", () => {
  test.skip(
    !isReconcileHarnessEnabled(),
    "Set QA_HARNESS_RECONCILE=1 to enable the reconcile suite"
  );

  test.afterEach(async ({ request }) => {
    await cleanupHarnessRows(request);
  });

  test("area resolve flips providers.status pending → active", async ({
    request,
    baseURL,
  }) => {
    const provider = await seedDummyProvider(request, {
      phoneSuffix: 105,
      status: "pending",
    });
    const { reviewId } = await seedPendingAreaReview(
      request,
      provider.providerId,
      `ZZ_QA_RawArea_D_${Date.now()}`
    );

    const result = await adminResolveUnmappedArea(
      request,
      baseURL!,
      QA_ADMIN_PHONE,
      reviewId
    );
    expect(result.status).toBe(200);
    expect(result.body.ok).toBe(true);

    const after = await readProvider(request, provider.providerId);
    expect(after?.status).toBe("active");
  });
});
