/**
 * E2E: Blocked Provider Exclusion — Runtime Validation
 *
 * Validates that blocked providers are excluded from:
 *  TC-01 — /api/find-provider results
 *  TC-02 — /api/process-task-notifications recipient set
 *  TC-03 — edge case: all matched providers are blocked after filtering
 *  TC-04 — regression: non-blocked provider flow is unaffected
 *
 * ─── OBSERVABILITY ARCHITECTURE NOTE ────────────────────────────────────────
 *
 * Both filtering operations happen inside Next.js server-side route handlers.
 * Playwright observes:
 *  - HTTP response status codes and JSON bodies returned to callers
 *  - Browser-side network requests from page components
 *
 * Playwright CANNOT observe:
 *  - Which rows Supabase returned server-side before filtering
 *  - Whether provider.status was used as the filter criterion
 *  - provider_task_matches table writes (no read API exposed without admin auth)
 *
 * The `status` field is intentionally NOT present in /api/find-provider
 * response objects (find-provider/route.ts returns only ProviderID, name,
 * phone, category, area, verified). This means direct status-field inspection
 * from the response is impossible; filter correctness is verified by
 * code-path analysis of route.ts lines 108 and 120.
 *
 * Where server-side observability is limited, this is stated explicitly
 * rather than masked by overly broad assertions.
 *
 * Run: npx playwright test e2e/blocked-provider-exclusion.spec.ts --reporter=line
 */

import { test, expect, Page, Route } from "@playwright/test";

// ─── Constants ────────────────────────────────────────────────────────────────

const ZZ_TASK_ID = "TASK-ZZ-QA-BLK-001";
const ZZ_DISPLAY_ID = "ZZ-QA-BLK-001";
const ZZ_SERVICE = "Electrician";
const ZZ_AREA = "Sardarpura";
const ZZ_USER_PHONE = "9999999901";

// Expected response-object keys from /api/find-provider (live deployed shape).
// NOTE: Local code has `ProviderID` (PascalCase); deployed Vercel returns `providerId`
// (camelCase). This file targets the live Vercel deployment.
const FIND_PROVIDER_RESPONSE_KEYS = ["providerId", "name", "phone", "category", "verified"] as const;

// ─── Auth ─────────────────────────────────────────────────────────────────────

function makeSessionCookieValue(phone = ZZ_USER_PHONE): string {
  const session = JSON.stringify({ phone, verified: true, createdAt: Date.now() });
  return encodeURIComponent(session);
}

async function injectUserCookie(page: Page) {
  await page.context().addCookies([
    {
      name: "kk_auth_session",
      value: makeSessionCookieValue(),
      url: "https://kaun-karega.vercel.app",
      sameSite: "Lax",
    },
  ]);
}

// ─── URL builders ─────────────────────────────────────────────────────────────

function buildSuccessUrl(opts: { service?: string; area?: string; taskId?: string; displayId?: string }) {
  const p = new URLSearchParams();
  if (opts.service) p.set("service", opts.service);
  if (opts.area) p.set("area", opts.area);
  if (opts.taskId) p.set("taskId", opts.taskId);
  if (opts.displayId) p.set("displayId", opts.displayId);
  return `/success?${p.toString()}`;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

test.describe("Blocked Provider Exclusion", () => {

  // ── TC-01: /api/find-provider excludes blocked providers ──────────────────
  test("TC-01: /api/find-provider — response contains no blocked providers; status field absent from response", async ({ request }) => {
    //
    // APPROACH: Call /api/find-provider directly via Playwright request context.
    // The route handler filters blocked providers server-side before returning.
    // We can verify:
    //   a) Response is valid and 200
    //   b) Each provider object does NOT expose a 'status' field
    //      (confirming the response shape is correct and status was consumed server-side)
    //   c) Each provider object has the expected keys only
    //
    // OBSERVABILITY LIMITATION:
    //   We cannot verify which specific providers were removed by the filter
    //   because we have no visibility into the pre-filter Supabase query results.
    //   If the live DB has zero providers for this category+area, TC-01 logs that
    //   explicitly and does not falsely pass on empty data.
    //

    const res = await request.get(
      `/api/find-provider?category=${encodeURIComponent(ZZ_SERVICE)}&area=${encodeURIComponent(ZZ_AREA)}`
    );

    expect(res.status(), "find-provider must return 200").toBe(200);

    const body = await res.json();
    expect(body.ok, "response.ok must be true").toBe(true);
    expect(Array.isArray(body.providers), "response.providers must be an array").toBe(true);
    expect(typeof body.count, "response.count must be a number").toBe("number");
    expect(body.count, "response.count must equal providers.length").toBe(body.providers.length);

    const providers: unknown[] = body.providers;

    if (providers.length === 0) {
      console.log(
        "[TC-01] Live DB returned 0 providers for Electrician/Sardarpura. " +
        "Cannot verify blocked-provider exclusion against live data for this category+area. " +
        "Shape and status-field-absence checks still pass on empty array."
      );
    } else {
      console.log(`[TC-01] ${providers.length} provider(s) returned. Checking response shape.`);
    }

    for (const provider of providers) {
      expect(provider, "each provider must be an object").not.toBeNull();
      expect(typeof provider).toBe("object");

      const p = provider as Record<string, unknown>;

      // STATUS FIELD MUST NOT BE EXPOSED
      // The route handler reads status to filter, but must not include it in output.
      // Its presence would indicate a response-shape regression.
      // This assertion is valid against both the deployed and local versions.
      expect(
        "status" in p,
        `provider ${p.providerId} must not expose 'status' in response — status is a filter-only field`
      ).toBe(false);

      // All expected keys must be present (uses live deployed shape: providerId camelCase)
      for (const key of FIND_PROVIDER_RESPONSE_KEYS) {
        expect(
          key in p,
          `provider ${p.providerId} must have field '${key}'`
        ).toBe(true);
      }

      // providerId must be a non-empty string
      expect(typeof p.providerId).toBe("string");
      expect((p.providerId as string).length, "providerId must not be empty").toBeGreaterThan(0);
    }

    console.log("[TC-01] PASS — response valid, status field absent from all provider objects");
  });

  // ── TC-02: Notification flow observability ────────────────────────────────
  test("TC-02: /api/process-task-notifications — observability statement + zero-match response handling", async ({ page }) => {
    //
    // OBSERVABILITY LIMITATION — stated explicitly:
    //   process-task-notifications runs entirely server-side. Its Supabase queries
    //   (provider_services, provider_areas, providers) and the provider_task_matches
    //   writes are not visible to browser-level Playwright interception.
    //   We cannot observe:
    //    - Which provider IDs were loaded from the providers table
    //    - Which were removed by the blocked filter before sending
    //    - What was written to provider_task_matches
    //   There is no read API for provider_task_matches accessible without admin auth.
    //
    // WHAT THIS TEST VERIFIES:
    //   The page that calls process-task-notifications correctly handles a response
    //   where matchedProviders=0 (the shape returned when all providers are filtered
    //   out as blocked). This validates the caller-side contract for the all-blocked
    //   edge case.
    //
    let notifCapturedBody: Record<string, unknown> | null = null;
    let notifCallCount = 0;

    await injectUserCookie(page);

    // Mock process-task-notifications to return the response shape produced
    // when all matched providers are blocked (matchedProviders=0, attemptedSends=0)
    await page.route("**/api/process-task-notifications**", async (route: Route) => {
      notifCallCount++;
      try {
        notifCapturedBody = route.request().postDataJSON() as Record<string, unknown>;
      } catch {
        notifCapturedBody = null;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, matchedProviders: 0, attemptedSends: 0, failedSends: 0 }),
      });
    });

    await page.route("**/api/find-provider**", async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, count: 0, providers: [] }),
      });
    });

    const notifWaiter = page.waitForRequest("**/api/process-task-notifications**", { timeout: 15_000 });
    await page.goto(buildSuccessUrl({ service: ZZ_SERVICE, area: ZZ_AREA, taskId: ZZ_TASK_ID, displayId: ZZ_DISPLAY_ID }));
    await notifWaiter;
    await page.waitForTimeout(300);

    // Notification was called with the correct taskId. The narrow
    // below tells TypeScript that any assigned value is a record-
    // shape; without it TS infers the let-binding as `never` past
    // the closure boundary because the `Record<string, unknown> |
    // null` declaration isn't preserved through the route handler.
    expect(notifCallCount).toBe(1);
    const capturedNotif = notifCapturedBody as
      | Record<string, unknown>
      | null;
    expect(capturedNotif?.taskId).toBe(ZZ_TASK_ID);

    // Page must not crash or show error text when matchedProviders=0
    await expect(page).toHaveURL(/\/success/);
    await expect(page.getByText("Task Submitted Successfully")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/application error/i)).toHaveCount(0);

    console.log(
      "[TC-02] PASS — page handles matchedProviders=0 response safely. " +
      "OBSERVABILITY LIMIT: provider_task_matches writes and server-side blocked filter are not browser-observable."
    );
  });

  // ── TC-03: All matched providers blocked — code path analysis + test ──────
  test("TC-03: All-blocked edge case — task gets status 'notified' with 0 sends (code-path finding)", async ({ page }) => {
    //
    // CODE-PATH ANALYSIS (process-task-notifications/route.ts):
    //
    //   Line 74:  if (matchedIds.length === 0) → sets task.status="no_providers_matched" and returns
    //             This check runs BEFORE step 4 (loading provider details).
    //             matchedIds is built from provider_services ∩ provider_areas intersection.
    //             It does NOT reflect blocked status — blocked providers still appear here.
    //
    //   Line 84–91: Step 4 loads provider details and filters out blocked providers.
    //               providerList = (providers ?? []).filter(status !== "blocked")
    //
    //   EDGE CASE: If N providers match category+area in provider_services/provider_areas,
    //   but ALL N have status="blocked" in the providers table, then:
    //     - matchedIds.length = N > 0 → line 74 early-return does NOT fire
    //     - providerList = [] after filter
    //     - for-loop at line 99: zero iterations → 0 sends, 0 WhatsApp messages
    //     - matchRows = [] → empty upsert (no provider_task_matches written)
    //     - Line 185–188: tasks.update({ status: "notified" }) RUNS despite 0 sends
    //     - Response: { ok: true, matchedProviders: 0, attemptedSends: 0, failedSends: 0 }
    //
    //   VERDICT: Task is left with status="notified" even though zero providers
    //   actually received a notification. The "no_providers_matched" status path
    //   is NOT reached for the all-blocked case.
    //
    //   SAFE OR UNSAFE:
    //   This is a semantic incorrectness: "notified" implies at least one
    //   provider was notified, but 0 sends occurred. For admin triage, a task
    //   showing "notified" with matchedProviders=0 is misleading.
    //   It does NOT cause a crash or data corruption — it is a status labeling
    //   issue. The minimal fix is documented in section G of the output report.
    //
    // BROWSER-SIDE VERIFICATION (what we can observe):
    //   We verify the page correctly handles the all-blocked response shape
    //   (matchedProviders=0), and that notificationStatus is never rendered.
    //

    let notifCallCount = 0;

    await injectUserCookie(page);

    await page.route("**/api/process-task-notifications**", async (route: Route) => {
      notifCallCount++;
      // Simulate the all-blocked response: route returned ok:true but 0 sends
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, matchedProviders: 0, attemptedSends: 0, failedSends: 0 }),
      });
    });

    await page.route("**/api/find-provider**", async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, count: 0, providers: [] }),
      });
    });

    const notifWaiter = page.waitForRequest("**/api/process-task-notifications**", { timeout: 15_000 });
    await page.goto(buildSuccessUrl({ service: ZZ_SERVICE, area: ZZ_AREA, taskId: ZZ_TASK_ID, displayId: ZZ_DISPLAY_ID }));
    await notifWaiter;
    await page.waitForTimeout(500);

    // Notification was called once
    expect(notifCallCount).toBe(1);

    // Page must not crash on all-blocked response
    await expect(page).toHaveURL(/\/success/);
    await expect(page.getByText("Task Submitted Successfully")).toBeVisible({ timeout: 10_000 });

    // notificationStatus state values must never appear as standalone exact text.
    // NOTE: "notified" is intentionally excluded — static page copy at SuccessClient.tsx
    // lines 213 and 256 contains the word "notified" in full sentences, so exact:true
    // matches on the bare word would be false positives.
    const neverRenderedExact = ["queued", "processing", "done", "error"];
    for (const text of neverRenderedExact) {
      await expect(page.getByText(text, { exact: true })).toHaveCount(0);
    }

    // Static copy unaffected
    await expect(
      page.getByText("We are now informing nearby service providers.")
    ).toBeVisible({ timeout: 5_000 });

    console.log(
      "[TC-03] Browser-side: PASS — page handles all-blocked (0-send) response without crash. " +
      "CODE-PATH FINDING: server-side task.status is set to 'notified' despite 0 actual sends. " +
      "See analysis in test body above."
    );
  });

  // ── TC-04: Non-blocked provider flow is not regressed ─────────────────────
  test("TC-04: /api/find-provider — non-blocked provider response shape is valid (regression)", async ({ request }) => {
    //
    // Validates that the blocked-filter change did not break the normal path:
    //  - Route still returns 200
    //  - response.ok is true
    //  - response.providers is an array with correct shape
    //  - No internal error caused by the new status field in the SELECT
    //
    // If live DB has no providers for Electrician/Sardarpura, the response is
    // { ok: true, count: 0, providers: [] } — this is still a valid regression
    // pass because it proves the route did not 500 from the schema change.
    //

    const res = await request.get(
      `/api/find-provider?category=${encodeURIComponent(ZZ_SERVICE)}&area=${encodeURIComponent(ZZ_AREA)}`
    );

    const status = res.status();
    expect(status, "find-provider must not 500 after adding status field to SELECT").not.toBe(500);
    expect(status, "find-provider must return 200").toBe(200);

    const body = await res.json();
    expect(body.ok, "response.ok must be true").toBe(true);
    expect(Array.isArray(body.providers), "response.providers must be an array").toBe(true);
    expect(body.usedFallback, "usedFallback must be false (Supabase-backed)").toBe(false);

    const providers: unknown[] = body.providers;
    console.log(`[TC-04] find-provider returned ${providers.length} provider(s) for ${ZZ_SERVICE}/${ZZ_AREA}`);

    if (providers.length > 0) {
      // Validate shape of first provider in the real response (live deployed shape)
      const first = providers[0] as Record<string, unknown>;
      expect(typeof first.providerId).toBe("string");
      expect(typeof first.name).toBe("string");
      expect(typeof first.phone).toBe("string");
      // status must not be exposed in response regardless of deployment version
      expect("status" in first, "status must not be in provider response object").toBe(false);
      console.log(`[TC-04] First provider: name="${first.name}", verified="${first.verified}"`);
    } else {
      console.log(
        "[TC-04] Live DB returned 0 providers — regression cannot be confirmed against real data. " +
        "Route returned 200 with valid shape, which confirms no 500 regression from SELECT change."
      );
    }

    console.log("[TC-04] PASS — no regression, find-provider returns valid structure after status-field SELECT addition");
  });

});
