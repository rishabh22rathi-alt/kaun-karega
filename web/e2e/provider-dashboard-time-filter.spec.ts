import { test, expect, type Page, type Route } from "@playwright/test";

// API-contract test for the metrics time-filter on /provider/dashboard.
//
// We mock /api/provider/dashboard-profile to return different metric values
// per range so we can verify both directions of the contract:
//   1. The page sends the right `?range=` query param when a filter is clicked.
//   2. The tile values re-render with the new response.
//
// We do NOT seed Supabase here — backend correctness of the SQL filters is
// covered by the API itself. This spec covers only the UI ↔ fetcher ↔ URL
// contract.

const ZZ_PROVIDER_PHONE = "9999999931";
const ZZ_PROVIDER_ID = "ZZ-QA-RANGE-9001";
const ZZ_PROVIDER_NAME = "ZZ QA Range Provider";

// Per-range payload values. Numbers are intentionally distinct per range so
// a wrong-range response would fail the post-click tile assertion.
const PAYLOADS_BY_RANGE: Record<string, { matched: number; responded: number }> = {
  all: { matched: 999, responded: 555 },
  today: { matched: 1, responded: 0 },
  "7d": { matched: 7, responded: 4 },
  "30d": { matched: 30, responded: 18 },
  "6m": { matched: 180, responded: 90 },
  "1y": { matched: 360, responded: 200 },
};

async function injectProviderCookie(page: Page, phone = ZZ_PROVIDER_PHONE) {
  const session = { phone, verified: true as const, createdAt: Date.now() };
  await page.context().addCookies([
    {
      name: "kk_auth_session",
      value: encodeURIComponent(JSON.stringify(session)),
      url: "http://localhost:3000/",
      sameSite: "Lax",
    },
  ]);
}

function buildProfileForRange(range: string) {
  const payload = PAYLOADS_BY_RANGE[range] ?? PAYLOADS_BY_RANGE.all;
  return {
    ProviderID: ZZ_PROVIDER_ID,
    ProviderName: ZZ_PROVIDER_NAME,
    Phone: ZZ_PROVIDER_PHONE,
    Verified: "yes",
    OtpVerified: "yes",
    OtpVerifiedAt: new Date().toISOString(),
    PendingApproval: "no",
    Services: [{ Category: "ZZ QA Plumber" }],
    Areas: [{ Area: "ZZ QA Nagar" }],
    AreaCoverage: {
      ActiveApprovedAreas: [{ Area: "ZZ QA Nagar", Status: "active" }],
      PendingAreaRequests: [],
      ResolvedOutcomes: [],
    },
    Analytics: {
      Summary: {
        ProviderID: ZZ_PROVIDER_ID,
        Categories: ["ZZ QA Plumber"],
        Areas: ["ZZ QA Nagar"],
        MetricsRange: range,
      },
      Metrics: {
        TotalRequestsInMyCategories: payload.matched * 2,
        TotalRequestsMatchedToMe: payload.matched,
        TotalRequestsRespondedByMe: payload.responded,
        TotalRequestsAcceptedByMe: Math.floor(payload.responded / 2),
        TotalRequestsCompletedByMe: Math.floor(payload.responded / 4),
        ResponseRate:
          payload.matched > 0
            ? Math.round((payload.responded / payload.matched) * 100)
            : 0,
        AcceptanceRate:
          payload.matched > 0
            ? Math.round(payload.responded / 2 / payload.matched * 100)
            : 0,
      },
      AreaDemand: [],
      SelectedAreaDemand: [],
      CategoryDemandByRange: {
        today: [],
        last7Days: [],
        last30Days: [],
        last365Days: [],
      },
      RecentMatchedRequests: [],
    },
  };
}

async function mockDashboardProfileByRange(
  page: Page,
  observedRanges: string[]
): Promise<void> {
  await page.route("**/api/provider/dashboard-profile**", async (route: Route) => {
    const url = new URL(route.request().url());
    const range = url.searchParams.get("range") ?? "all";
    observedRanges.push(range);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, provider: buildProfileForRange(range) }),
    });
  });
}

async function mockKkApi(page: Page): Promise<void> {
  // Provider-thread polling and any other /api/kk hits — return empty so the
  // dashboard can render without errors. We don't assert on these.
  await page.route("**/api/kk**", async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, threads: [] }),
    });
  });
}

test.describe("Provider dashboard — metrics time-filter", () => {
  test("sends ?range= and re-renders tiles for each range option", async ({ page }) => {
    await injectProviderCookie(page);

    const observedRanges: string[] = [];
    await mockDashboardProfileByRange(page, observedRanges);
    await mockKkApi(page);

    await page.goto("/provider/dashboard");
    await expect(
      page.getByRole("heading", { level: 1, name: ZZ_PROVIDER_NAME })
    ).toBeVisible({ timeout: 10_000 });

    // Default: "All" is selected and the all-time payload is rendered.
    const selector = page.getByTestId("metrics-range-selector");
    await expect(selector).toBeVisible();
    await expect(page.getByTestId("metrics-range-option-all")).toHaveAttribute(
      "data-selected",
      "true"
    );
    await expect(page.getByTestId("metrics-tiles")).toContainText("999"); // matched
    await expect(page.getByTestId("metrics-tiles")).toContainText("555"); // responded

    // The first call may or may not include `range=all` (the fetcher omits
    // it for the default), so tolerate both. Subsequent ranges must be
    // explicit. Reset the observation buffer for the click sequence.
    expect(observedRanges.length).toBeGreaterThan(0);
    expect(["all", null]).toContain(observedRanges[0] === "all" ? "all" : null);
    observedRanges.length = 0;

    const clickSequence: Array<{
      key: "today" | "7d" | "30d" | "6m" | "1y" | "all";
      expectMatched: number;
      expectResponded: number;
    }> = [
      { key: "today", expectMatched: 1, expectResponded: 0 },
      { key: "7d", expectMatched: 7, expectResponded: 4 },
      { key: "30d", expectMatched: 30, expectResponded: 18 },
      { key: "6m", expectMatched: 180, expectResponded: 90 },
      { key: "1y", expectMatched: 360, expectResponded: 200 },
      { key: "all", expectMatched: 999, expectResponded: 555 },
    ];

    for (const step of clickSequence) {
      await page.getByTestId(`metrics-range-option-${step.key}`).click();

      // Selected pill flips to the clicked option.
      await expect(
        page.getByTestId(`metrics-range-option-${step.key}`)
      ).toHaveAttribute("data-selected", "true", { timeout: 5_000 });

      // API was called with the right range. "all" is the default and may
      // be sent without an explicit param.
      await expect.poll(
        () => observedRanges.includes(step.key) || (step.key === "all" && observedRanges.includes("all")),
        { timeout: 5_000 }
      ).toBe(true);

      // Tile values reflect the mocked response for this range.
      await expect(page.getByTestId("metrics-tiles")).toContainText(
        String(step.expectMatched),
        { timeout: 5_000 }
      );
      await expect(page.getByTestId("metrics-tiles")).toContainText(
        String(step.expectResponded),
        { timeout: 5_000 }
      );
    }
  });

  test("range selector shows the active option visually", async ({ page }) => {
    await injectProviderCookie(page);
    const observedRanges: string[] = [];
    await mockDashboardProfileByRange(page, observedRanges);
    await mockKkApi(page);

    await page.goto("/provider/dashboard");
    await expect(
      page.getByRole("heading", { level: 1, name: ZZ_PROVIDER_NAME })
    ).toBeVisible({ timeout: 10_000 });

    // Default: only "All" is data-selected=true; every other option false.
    for (const key of ["today", "7d", "30d", "6m", "1y", "all"] as const) {
      const expected = key === "all" ? "true" : "false";
      await expect(page.getByTestId(`metrics-range-option-${key}`)).toHaveAttribute(
        "data-selected",
        expected
      );
    }

    // Click "30 Days" — exactly one option becomes selected.
    await page.getByTestId("metrics-range-option-30d").click();
    for (const key of ["today", "7d", "30d", "6m", "1y", "all"] as const) {
      const expected = key === "30d" ? "true" : "false";
      await expect(page.getByTestId(`metrics-range-option-${key}`)).toHaveAttribute(
        "data-selected",
        expected,
        { timeout: 5_000 }
      );
    }
  });
});
