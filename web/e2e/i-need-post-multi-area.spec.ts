/**
 * /i-need/post — multi-area chip selector behavior.
 *
 * Covers the recent fix that converted the single-area free-text input into
 * a chip-based multi-select with a hard cap of 5 areas:
 *   1. No "All Areas" option exists.
 *   2. Multi-select via chips with live "X of 5 selected" count.
 *   3. Selected areas appear as removable violet tags.
 *   4. Selecting a 6th area is blocked with the friendly error string.
 *   5. Submit is disabled when zero areas are selected.
 *   6. On submit, payload sends both `Area: "A, B, C"` and `Areas: [...]`.
 *
 * Uses fully mocked /api/kk so the test is self-contained — no Supabase
 * seeding, no provider session, no real backend.
 */

import { bootstrapUserSession } from "./_support/auth";
import { gotoPath } from "./_support/home";
import { jsonOk, mockJson, mockKkActions } from "./_support/routes";
import { test, expect } from "./_support/test";

const MAX_AREAS_ERROR = "You can select up to 5 areas only.";
const PHONE = "9999999911";

test.describe("/i-need/post — multi-area selection", () => {
  test("chip toggle, max-5 cap, removable tags, and create_need payload", async ({
    page,
    diag,
  }) => {
    // Capture the most recent create_need payload so the test can assert
    // both the comma-joined `Area` (back-compat) and the new `Areas[]` field.
    let capturedCreateNeedBody: Record<string, unknown> | null = null;

    // Sidebar auto-fetches the provider dashboard profile on every page —
    // for a non-provider user phone this 404s, which trips diag.assertClean.
    // Mock as ok with provider:null (matches other user-flow scenarios).
    await mockJson(page, "**/api/provider/dashboard-profile**", jsonOk({ provider: null }));
    await mockKkActions(page, {
      get_provider_by_phone: () => jsonOk({ provider: null }),
      get_my_needs: () => jsonOk({ needs: [] }),
      create_need: ({ body }) => {
        capturedCreateNeedBody = body;
        return jsonOk({ NeedID: "ND-QA-MULTI-AREA-0001" });
      },
    });

    await bootstrapUserSession(page, PHONE);
    await gotoPath(page, "/i-need/post");

    // Pick a category first so the rest of the form mounts.
    await page.getByRole("button", { name: "Employer", exact: true }).click();

    // Initial state: counter at "0 of 5 selected", no tags rendered.
    await expect(page.getByText("0 of 5 selected", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: /^Remove /i })).toHaveCount(0);

    // "All Areas" must NOT be one of the choices.
    await expect(page.getByRole("button", { name: "All Areas", exact: true })).toHaveCount(0);

    // Submit is disabled with zero areas (and a category picked).
    const submitButton = page.getByRole("button", { name: "Post Need", exact: true });
    await expect(submitButton).toBeDisabled();

    // Select 5 areas — each click increments the counter and renders a tag.
    const areasToPick = [
      "Sardarpura",
      "Shastri Nagar",
      "Ratanada",
      "Paota",
      "Basni",
    ];
    for (let i = 0; i < areasToPick.length; i++) {
      await page.getByRole("button", { name: areasToPick[i], exact: true }).click();
      await expect(
        page.getByText(`${i + 1} of 5 selected`, { exact: true })
      ).toBeVisible();
    }

    // All five tags rendered with × buttons.
    for (const area of areasToPick) {
      await expect(
        page.getByRole("button", { name: `Remove ${area}` })
      ).toBeVisible();
    }

    // Try to add a 6th — must be blocked with the friendly message and the
    // counter must NOT advance past 5/5.
    await page.getByRole("button", { name: "Pal Road", exact: true }).click();
    await expect(page.getByText(MAX_AREAS_ERROR, { exact: true })).toBeVisible();
    await expect(page.getByText("5 of 5 selected", { exact: true })).toBeVisible();

    // Remove one tag via its × button — counter falls back to 4/5 and the
    // error clears (set on next valid toggle).
    await page.getByRole("button", { name: "Remove Basni" }).click();
    await expect(page.getByText("4 of 5 selected", { exact: true })).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Remove Basni" })
    ).toHaveCount(0);

    // Now adding Pal Road should succeed (within the 5 cap).
    await page.getByRole("button", { name: "Pal Road", exact: true }).click();
    await expect(page.getByText("5 of 5 selected", { exact: true })).toBeVisible();
    await expect(page.getByText(MAX_AREAS_ERROR, { exact: true })).toHaveCount(0);

    // Submit is now enabled.
    await expect(submitButton).toBeEnabled();
    await submitButton.click();

    // Wait for the navigation away from /i-need/post — confirms the request
    // succeeded end-to-end.
    await page.waitForURL(/\/i-need\/my-needs/, { timeout: 10_000 });

    // Inspect the captured payload.
    expect(capturedCreateNeedBody, "create_need was not called").not.toBeNull();
    const body = capturedCreateNeedBody as unknown as Record<string, unknown>;
    expect(body.UserPhone).toBe(PHONE);
    expect(body.Category).toBe("Employer");

    const expectedFinalAreas = [
      "Sardarpura",
      "Shastri Nagar",
      "Ratanada",
      "Paota",
      "Pal Road",
    ];
    expect(body.Area).toBe(expectedFinalAreas.join(", "));
    expect(body.Areas).toEqual(expectedFinalAreas);

    diag.assertClean();
  });

  test("submit stays disabled with zero selected areas", async ({ page, diag }) => {
    // Different scenario, no category-level network expectations beyond the
    // baseline mocks. create_need should never fire.
    let createNeedCalls = 0;
    await mockJson(page, "**/api/provider/dashboard-profile**", jsonOk({ provider: null }));
    await mockKkActions(page, {
      get_provider_by_phone: () => jsonOk({ provider: null }),
      get_my_needs: () => jsonOk({ needs: [] }),
      create_need: () => {
        createNeedCalls += 1;
        return jsonOk({ NeedID: "ND-QA-NEVER-CALLED" });
      },
    });

    await bootstrapUserSession(page, PHONE);
    await gotoPath(page, "/i-need/post");

    await page.getByRole("button", { name: "Employer", exact: true }).click();

    const submitButton = page.getByRole("button", { name: "Post Need", exact: true });
    await expect(submitButton).toBeDisabled();
    await expect(page.getByText("0 of 5 selected", { exact: true })).toBeVisible();

    // Try clicking the disabled button — should be a no-op.
    await submitButton.click({ force: true }).catch(() => {});
    expect(createNeedCalls).toBe(0);
    expect(page.url()).toContain("/i-need/post");

    diag.assertClean();
  });
});
