/**
 * Scenario E — Provider changes region coverage (provider_update source).
 *
 * Mirrors Scenario D but uses source_type='provider_update' on the
 * area_review_queue row. Confirms that the reconcile call site fires
 * for both provider-source types (provider_register and provider_update).
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
} from "../_support/qaReconcile";
import { QA_ADMIN_PHONE } from "../_support/data";
import type { APIRequestContext } from "@playwright/test";
import crypto from "crypto";

// Local seed variant that explicitly uses provider_update source.
async function seedProviderUpdateAreaReview(
  request: APIRequestContext,
  providerId: string,
  rawArea: string
): Promise<{ reviewId: string }> {
  const url = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/area_review_queue`;
  const serviceKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SERVICE_KEY ||
    "";
  const response = await request.fetch(url, {
    method: "POST",
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    data: JSON.stringify([
      {
        raw_area: rawArea,
        source_type: "provider_update",
        source_ref: providerId,
        status: "pending",
      },
    ]),
  });
  const rows = (await response.json()) as Array<{ review_id: string }>;
  return { reviewId: rows[0].review_id };
}

test.describe("Scenario E — provider_update area review resolution", () => {
  test.skip(
    !isReconcileHarnessEnabled(),
    "Set QA_HARNESS_RECONCILE=1 to enable the reconcile suite"
  );

  test.afterEach(async ({ request }) => {
    await cleanupHarnessRows(request);
  });

  test("provider_update area resolve flips pending → active", async ({
    request,
    baseURL,
  }) => {
    const provider = await seedDummyProvider(request, {
      phoneSuffix: 106,
      status: "pending",
    });
    const { reviewId } = await seedProviderUpdateAreaReview(
      request,
      provider.providerId,
      `ZZ_QA_RawArea_E_${crypto.randomUUID().slice(0, 6)}`
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
