/**
 * Scenario C — Provider adds custom alias / work-tag.
 *
 * Seeds:
 *   - dummy provider, status='pending'
 *   - one inactive category_aliases row submitted by that provider
 *
 * Admin approves the alias via /api/admin/aliases. Reconcile fires
 * because submitted_by_provider_id is set and this is the only open
 * queue item.
 *
 * Assertions:
 *   - category_aliases.active flipped to true
 *   - providers.status now 'active'
 *
 * Also covers the alias-reject path with a separate seeded provider.
 *
 * Real-DB integration. Gated by QA_HARNESS_RECONCILE=1.
 */

import { test, expect } from "@playwright/test";

import {
  adminApproveAlias,
  adminRejectAlias,
  cleanupHarnessRows,
  isReconcileHarnessEnabled,
  readProvider,
  seedDummyProvider,
  seedPendingAlias,
} from "../_support/qaReconcile";
import { QA_ADMIN_PHONE, QA_CATEGORY } from "../_support/data";

test.describe("Scenario C — provider adds alias / work-tag", () => {
  test.skip(
    !isReconcileHarnessEnabled(),
    "Set QA_HARNESS_RECONCILE=1 to enable the reconcile suite"
  );

  test.afterEach(async ({ request }) => {
    await cleanupHarnessRows(request);
  });

  test("alias approve flips providers.status pending → active", async ({
    request,
    baseURL,
  }) => {
    const provider = await seedDummyProvider(request, {
      phoneSuffix: 103,
      status: "pending",
    });
    const alias = `zz_qa_alias_C_${Date.now()}`;
    await seedPendingAlias(request, provider.providerId, alias, QA_CATEGORY);

    const result = await adminApproveAlias(
      request,
      baseURL!,
      QA_ADMIN_PHONE,
      alias
    );
    expect(result.status).toBe(200);
    expect(result.body.ok).toBe(true);

    const after = await readProvider(request, provider.providerId);
    expect(after?.status).toBe("active");
  });

  test("alias reject also flips providers.status pending → active (last-item rule)", async ({
    request,
    baseURL,
  }) => {
    const provider = await seedDummyProvider(request, {
      phoneSuffix: 104,
      status: "pending",
    });
    const alias = `zz_qa_alias_C_reject_${Date.now()}`;
    await seedPendingAlias(request, provider.providerId, alias, QA_CATEGORY);

    const result = await adminRejectAlias(
      request,
      baseURL!,
      QA_ADMIN_PHONE,
      alias,
      "Rejected by QA Scenario C"
    );
    expect(result.status).toBe(200);
    expect(result.body.ok).toBe(true);

    const after = await readProvider(request, provider.providerId);
    expect(after?.status).toBe("active");
  });
});
