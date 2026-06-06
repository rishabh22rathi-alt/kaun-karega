/**
 * Notification Completion Sprint — Phase 1, Events 2–4.
 *
 * Verifies the provider-facing in-app notifications added to
 * web/lib/admin/adminProviderMutations.ts:
 *   - provider_approved  when set_provider_verified(yes) succeeds
 *   - provider_rejected  when set_provider_verified(no)  succeeds
 *   - provider_blocked   when /api/admin/providers/block succeeds
 * plus the check-first dedupe (provider_id, type, seen_at IS NULL) and the
 * "no unblock notification" rule.
 *
 * Real-DB integration through the admin HTTP routes. Gated by
 * QA_HARNESS_RECONCILE=1 (and the env.ts write-guard upstream), so it
 * auto-skips on the prod-pointed default env and only runs against a
 * staging/local database. Cleanup is handled by cleanupHarnessRows, which
 * now also clears provider_notifications for harness providers.
 */

import { test, expect } from "@playwright/test";

import {
  blockProviderViaApi,
  cleanupHarnessRows,
  isReconcileHarnessEnabled,
  readProviderNotifications,
  seedDummyProvider,
  setProviderVerifiedViaApi,
  unblockProviderViaApi,
} from "../_support/qaReconcile";
import { QA_ADMIN_PHONE } from "../_support/data";

test.describe("Provider status notifications (Events 2–4)", () => {
  test.skip(
    !isReconcileHarnessEnabled(),
    "Set QA_HARNESS_RECONCILE=1 (staging DB) to enable the reconcile suite"
  );

  test.afterEach(async ({ request }) => {
    await cleanupHarnessRows(request);
  });

  test("approve → one provider_approved row, deduped on retry", async ({
    request,
    baseURL,
  }) => {
    const p = await seedDummyProvider(request, {
      phoneSuffix: 120,
      status: "pending",
      verified: "no",
    });

    const r1 = await setProviderVerifiedViaApi(
      request,
      baseURL!,
      QA_ADMIN_PHONE,
      p.providerId,
      "yes"
    );
    expect(r1.status).toBe(200);

    let notifs = await readProviderNotifications(
      request,
      p.providerId,
      "provider_approved"
    );
    expect(notifs.length).toBe(1);
    expect(notifs[0].title).toContain("approved");
    expect(notifs[0].seen_at).toBeNull();

    // Retry the same approve → check-first dedupe must NOT add a second row.
    const r2 = await setProviderVerifiedViaApi(
      request,
      baseURL!,
      QA_ADMIN_PHONE,
      p.providerId,
      "yes"
    );
    expect(r2.status).toBe(200);
    notifs = await readProviderNotifications(
      request,
      p.providerId,
      "provider_approved"
    );
    expect(notifs.length).toBe(1);
  });

  test("reject → one provider_rejected row", async ({ request, baseURL }) => {
    const p = await seedDummyProvider(request, {
      phoneSuffix: 121,
      status: "pending",
      verified: "no",
    });

    const r = await setProviderVerifiedViaApi(
      request,
      baseURL!,
      QA_ADMIN_PHONE,
      p.providerId,
      "no"
    );
    expect(r.status).toBe(200);

    const notifs = await readProviderNotifications(
      request,
      p.providerId,
      "provider_rejected"
    );
    expect(notifs.length).toBe(1);
    expect(notifs[0].title).toContain("not approved");
  });

  test("block → one provider_blocked row; unblock adds none", async ({
    request,
    baseURL,
  }) => {
    const p = await seedDummyProvider(request, {
      phoneSuffix: 122,
      status: "active",
    });

    const rb = await blockProviderViaApi(
      request,
      baseURL!,
      QA_ADMIN_PHONE,
      p.providerId
    );
    expect(rb.status).toBe(200);

    let notifs = await readProviderNotifications(
      request,
      p.providerId,
      "provider_blocked"
    );
    expect(notifs.length).toBe(1);

    // Unblock must NOT create a notification (no unblock alert by design).
    const ru = await unblockProviderViaApi(
      request,
      baseURL!,
      QA_ADMIN_PHONE,
      p.providerId
    );
    expect(ru.status).toBe(200);
    notifs = await readProviderNotifications(
      request,
      p.providerId,
      "provider_blocked"
    );
    expect(notifs.length).toBe(1);
  });
});
