/**
 * Scenario H — Idempotency & stale-UI refetch behavior.
 *
 * Server-side correctness for the "click-refresh-no-stale-row"
 * pattern: after admin approves the last open item, an immediate
 * re-call to /api/admin/providers-under-review must NOT include the
 * provider (because reconcile cleared the queue rows AND flipped
 * providers.status). A duplicate admin approve call on an already-
 * approved request must also be safe (idempotent) and reconcile
 * remains a no-op the second time.
 *
 * Real-DB integration. Gated by QA_HARNESS_RECONCILE=1.
 */

import { test, expect } from "@playwright/test";

import {
  adminApproveCategoryRequest,
  buildSignedAuthCookie,
  cleanupHarnessRows,
  isReconcileHarnessEnabled,
  readProvider,
  seedDummyProvider,
  seedPendingCategoryRequest,
} from "../_support/qaReconcile";
import { QA_ADMIN_PHONE } from "../_support/data";

test.describe("Scenario H — refetch + idempotency", () => {
  test.skip(
    !isReconcileHarnessEnabled(),
    "Set QA_HARNESS_RECONCILE=1 to enable the reconcile suite"
  );

  test.afterEach(async ({ request }) => {
    await cleanupHarnessRows(request);
  });

  test("under-review re-aggregation drops provider after approve", async ({
    request,
    baseURL,
  }) => {
    const provider = await seedDummyProvider(request, {
      phoneSuffix: 110,
      status: "pending",
    });
    const { requestId } = await seedPendingCategoryRequest(
      request,
      provider.providerId,
      "ZZ_QA_Custom_Category_H"
    );

    const cookie = `kk_auth_session=${encodeURIComponent(
      buildSignedAuthCookie(QA_ADMIN_PHONE)
    )}; kk_admin=1`;

    // Sanity: BEFORE approve, provider appears in the under-review list.
    const before = await request.get(`${baseURL}/api/admin/providers-under-review`, {
      headers: { Cookie: cookie },
    });
    const beforeJson = (await before.json()) as {
      ok: boolean;
      providers: Array<{ providerId: string }>;
    };
    expect(beforeJson.ok).toBe(true);
    expect(
      beforeJson.providers.some((p) => p.providerId === provider.providerId)
    ).toBe(true);

    const result = await adminApproveCategoryRequest(
      request,
      baseURL!,
      QA_ADMIN_PHONE,
      requestId,
      "ZZ_QA_Custom_Category_H"
    );
    expect(result.status).toBe(200);

    // AFTER approve, the same endpoint must not return this provider.
    const after = await request.get(`${baseURL}/api/admin/providers-under-review`, {
      headers: { Cookie: cookie },
    });
    const afterJson = (await after.json()) as {
      ok: boolean;
      providers: Array<{ providerId: string }>;
    };
    expect(afterJson.ok).toBe(true);
    expect(
      afterJson.providers.some((p) => p.providerId === provider.providerId)
    ).toBe(false);

    const dbAfter = await readProvider(request, provider.providerId);
    expect(dbAfter?.status).toBe("active");
  });

  test("duplicate approve call is idempotent and reconcile no-ops", async ({
    request,
    baseURL,
  }) => {
    const provider = await seedDummyProvider(request, {
      phoneSuffix: 111,
      status: "pending",
    });
    const { requestId } = await seedPendingCategoryRequest(
      request,
      provider.providerId,
      "ZZ_QA_Custom_Category_H2"
    );

    const first = await adminApproveCategoryRequest(
      request,
      baseURL!,
      QA_ADMIN_PHONE,
      requestId,
      "ZZ_QA_Custom_Category_H2"
    );
    expect(first.status).toBe(200);

    // Provider is now active.
    let p = await readProvider(request, provider.providerId);
    expect(p?.status).toBe("active");

    // Second identical call. The category mutation is internally
    // idempotent (status='approved' already; categories upsert
    // ignoreDuplicates=true). Reconcile sees status='active' and
    // no-ops. No state regression should occur.
    const second = await adminApproveCategoryRequest(
      request,
      baseURL!,
      QA_ADMIN_PHONE,
      requestId,
      "ZZ_QA_Custom_Category_H2"
    );
    expect(second.status).toBe(200);

    p = await readProvider(request, provider.providerId);
    expect(p?.status).toBe("active");
  });
});
