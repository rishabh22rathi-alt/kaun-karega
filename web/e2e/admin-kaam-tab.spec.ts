/**
 * Verification — Admin Dashboard Kaam tab.
 *
 * Covers, in one mock-driven Playwright test:
 *   - Lifecycle progress badges + progress bars ("N/5 <label>") for
 *     all five stages.
 *   - New Service Category attention badge with amber styling.
 *   - Reprocess Kaam button on flagged rows — POSTs /api/admin/kaam/reprocess
 *     and triggers a refetch of /api/admin/kaam.
 *   - Category-not-approved branch surfaces a precise error message.
 *   - Analytics block: 4 stat cards + monthly bar chart + category
 *     donut chart, all rendered above the table.
 *   - Empty + error fallbacks for the table.
 *
 * No mutation assertions on tasks/chat/categories — the spec exercises
 * only the dedicated reprocess endpoint; the read-only invariant is
 * checked by counting non-GET requests against the affected surfaces.
 */

import { bootstrapAdminSession } from "./_support/auth";
import { gotoPath } from "./_support/home";
import { mockAdminDashboardApis } from "./_support/scenarios";
import { mockJson } from "./_support/routes";
import { test, expect } from "./_support/test";

type LifecycleStatus =
  | "Task Created"
  | "Matched"
  | "Providers Notified"
  | "Provider Responded"
  | "Completed / Closed";

type KaamRow = {
  taskId: string;
  kaamNo: string | null;
  phone: string | null;
  category: string | null;
  area: string | null;
  rawStatus: string | null;
  lifecycleStatus: LifecycleStatus;
  lifecycleStep: number;
  lifecycleTotalSteps: number;
  isNewServiceCategory: boolean;
  statusAttentionLabel: string | null;
  created_at: string | null;
  whenRequired: string | null;
};

const MONTHLY = [
  { month: "Mar 2026", monthKey: "2026-03", count: 10 },
  { month: "Apr 2026", monthKey: "2026-04", count: 25 },
  { month: "May 2026", monthKey: "2026-05", count: 76 },
];

const CATEGORY = [
  { category: "Electrician", count: 30, percentage: 39.5 },
  { category: "Plumber", count: 20, percentage: 26.3 },
  { category: "Carpenter", count: 10, percentage: 13.2 },
];

const AREA_DEMAND = [
  {
    region: "Central Jodhpur",
    area: "Sardarpura",
    total: 18,
    categories: [
      { category: "Electrician", count: 12 },
      { category: "Plumber", count: 4 },
      { category: "Carpenter", count: 2 },
    ],
  },
  {
    region: "Central Jodhpur",
    area: "Ratanada",
    total: 10,
    categories: [
      { category: "Plumber", count: 6 },
      { category: "Electrician", count: 4 },
    ],
  },
  {
    region: "Unmapped",
    area: "Pal Road",
    total: 6,
    categories: [
      { category: "Carpenter", count: 4 },
      { category: "Plumber", count: 2 },
    ],
  },
];

const NEW_CATEGORY_ROW_BASE: KaamRow = {
  taskId: "TK-NEW-CAT",
  kaamNo: "201",
  phone: "9876543210",
  category: "Aquarium Cleaning",
  area: "Sardarpura",
  rawStatus: "pending_category_review",
  lifecycleStatus: "Task Created",
  lifecycleStep: 1,
  lifecycleTotalSteps: 5,
  isNewServiceCategory: true,
  statusAttentionLabel: "New Service Category",
  created_at: "2026-05-13T10:00:00.000Z",
  whenRequired: "Today",
};

const NEW_CATEGORY_ROW_REPROCESSED: KaamRow = {
  ...NEW_CATEGORY_ROW_BASE,
  rawStatus: "notified",
  lifecycleStatus: "Providers Notified",
  lifecycleStep: 3,
  isNewServiceCategory: false,
  statusAttentionLabel: null,
};

const LIFECYCLE_ROWS: KaamRow[] = [
  {
    taskId: "TK-CREATED",
    kaamNo: "202",
    phone: "9999999901",
    category: "Electrician",
    area: "Ratanada",
    rawStatus: "submitted",
    lifecycleStatus: "Task Created",
    lifecycleStep: 1,
    lifecycleTotalSteps: 5,
    isNewServiceCategory: false,
    statusAttentionLabel: null,
    created_at: "2026-05-12T09:30:00.000Z",
    whenRequired: "Tomorrow",
  },
  {
    taskId: "TK-MATCHED",
    kaamNo: "203",
    phone: "9999999902",
    category: "Plumber",
    area: "Pal Road",
    rawStatus: "submitted",
    lifecycleStatus: "Matched",
    lifecycleStep: 2,
    lifecycleTotalSteps: 5,
    isNewServiceCategory: false,
    statusAttentionLabel: null,
    created_at: "2026-05-12T10:00:00.000Z",
    whenRequired: "Within 2 hours",
  },
  {
    taskId: "TK-NOTIFIED",
    kaamNo: "204",
    phone: "9999999903",
    category: "Carpenter",
    area: "Shastri Nagar",
    rawStatus: "notified",
    lifecycleStatus: "Providers Notified",
    lifecycleStep: 3,
    lifecycleTotalSteps: 5,
    isNewServiceCategory: false,
    statusAttentionLabel: null,
    created_at: "2026-05-12T11:00:00.000Z",
    whenRequired: "Within 6 hours",
  },
  {
    taskId: "TK-RESPONDED",
    kaamNo: "205",
    phone: "9999999904",
    category: "Plumber",
    area: "Sardarpura",
    rawStatus: "provider_responded",
    lifecycleStatus: "Provider Responded",
    lifecycleStep: 4,
    lifecycleTotalSteps: 5,
    isNewServiceCategory: false,
    statusAttentionLabel: null,
    created_at: "2026-05-12T12:00:00.000Z",
    whenRequired: "Today",
  },
  {
    taskId: "TK-COMPLETED",
    kaamNo: "206",
    phone: "9999999905",
    category: "Electrician",
    area: "Ratanada",
    rawStatus: "responded",
    lifecycleStatus: "Completed / Closed",
    lifecycleStep: 5,
    lifecycleTotalSteps: 5,
    isNewServiceCategory: false,
    statusAttentionLabel: null,
    created_at: "2026-05-11T08:00:00.000Z",
    whenRequired: "Schedule later",
  },
  // Two extra rows so the table has 7 total entries — exercises the
  // show-5/show-all toggle ("Show all Kaam (2 more)") added to keep
  // the dashboard compact on dense data.
  {
    taskId: "TK-EXTRA-1",
    kaamNo: "207",
    phone: "9999999906",
    category: "Carpenter",
    area: "Pal Road",
    rawStatus: "submitted",
    lifecycleStatus: "Task Created",
    lifecycleStep: 1,
    lifecycleTotalSteps: 5,
    isNewServiceCategory: false,
    statusAttentionLabel: null,
    created_at: "2026-05-10T07:00:00.000Z",
    whenRequired: "Today",
  },
  {
    taskId: "TK-EXTRA-2",
    kaamNo: "208",
    phone: "9999999907",
    category: "Plumber",
    area: "Shastri Nagar",
    rawStatus: "matched",
    lifecycleStatus: "Matched",
    lifecycleStep: 2,
    lifecycleTotalSteps: 5,
    isNewServiceCategory: false,
    statusAttentionLabel: null,
    created_at: "2026-05-09T06:00:00.000Z",
    whenRequired: "Tomorrow",
  },
];

function rowsForPhase(
  phase: "rows" | "rows-reprocessed" | "empty" | "fail"
): KaamRow[] {
  if (phase === "rows-reprocessed") {
    return [NEW_CATEGORY_ROW_REPROCESSED, ...LIFECYCLE_ROWS];
  }
  return [NEW_CATEGORY_ROW_BASE, ...LIFECYCLE_ROWS];
}

test.describe("Admin: Kaam tab (lifecycle + reprocess + analytics)", () => {
  test("renders progress bars, reprocess flow, analytics, and fallbacks", async ({
    page,
  }) => {
    await bootstrapAdminSession(page);
    await mockAdminDashboardApis(page);

    type Mode = "rows" | "rows-reprocessed" | "empty" | "fail";
    let mode: Mode = "rows";
    let reprocessMode: "success" | "category_not_approved" = "success";
    const mutationProbes: string[] = [];
    const reprocessCalls: Array<{ taskId: string }> = [];

    // Trip-wire: count non-GET requests that touch tasks/chat/admin
    // categories — none should fire for read-only flows. Reprocess is
    // its own POST and tracked separately.
    page.on("request", (request) => {
      const url = request.url();
      if (
        request.method() !== "GET" &&
        /\/api\/(?:admin\/(?:categories|kaam(?!\/reprocess))|tasks|chat)/.test(
          url
        )
      ) {
        mutationProbes.push(`${request.method()} ${url}`);
      }
    });

    await mockJson(page, "**/api/admin/kaam", () => {
      if (mode === "fail") {
        return {
          status: 500,
          body: {
            success: false,
            error: "Simulated downstream failure",
          } as Record<string, unknown>,
        };
      }
      if (mode === "empty") {
        return {
          status: 200,
          body: {
            success: true,
            totalKaam: 0,
            monthlyKaam: [],
            categoryKaam: [],
            areaCategoryDemand: [],
            regionsCovered: 0,
            areasCovered: 0,
            analyticsTruncated: false,
            kaam: [],
          } as Record<string, unknown>,
        };
      }
      const rows = rowsForPhase(mode);
      return {
        status: 200,
        body: {
          success: true,
          totalKaam: 111,
          monthlyKaam: MONTHLY,
          categoryKaam: CATEGORY,
          areaCategoryDemand: AREA_DEMAND,
          regionsCovered: 2,
          areasCovered: AREA_DEMAND.length,
          analyticsTruncated: false,
          kaam: rows,
        } as Record<string, unknown>,
      };
    });

    await mockJson(page, "**/api/admin/kaam/reprocess", ({ body }) => {
      reprocessCalls.push({
        taskId: typeof body.taskId === "string" ? body.taskId : "",
      });
      if (reprocessMode === "category_not_approved") {
        return {
          status: 409,
          body: {
            success: false,
            reason: "category_not_approved",
            message: "Category is still not approved.",
          } as Record<string, unknown>,
        };
      }
      // Success: flip the kaam mock to its reprocessed view so the
      // refetch returns lifecycleStep=3.
      mode = "rows-reprocessed";
      return {
        status: 200,
        body: {
          success: true,
          taskId: NEW_CATEGORY_ROW_BASE.taskId,
          kaamNo: NEW_CATEGORY_ROW_BASE.kaamNo,
          category: NEW_CATEGORY_ROW_BASE.category,
          area: NEW_CATEGORY_ROW_BASE.area,
          matchedCount: 2,
          notifiedCount: 2,
          skippedExistingCount: 0,
          status: "notified",
        } as Record<string, unknown>,
      };
    });

    const kaamToggle = page.locator(
      'button[aria-controls="kaam-tab-body"]'
    );
    const kaamBody = page.locator("#kaam-tab-body");
    const tableRows = kaamBody.locator("tbody tr");

    const openKaamAccordion = async (label: string): Promise<void> => {
      const expanded = await kaamToggle.getAttribute("aria-expanded");
      if (expanded !== "true") {
        await kaamToggle.click();
      }
      await expect(
        kaamBody,
        `${label}: accordion body should be visible`
      ).toBeVisible();
      await expect(
        kaamBody.getByText("Loading Kaam…"),
        `${label}: loading placeholder should clear`
      ).toHaveCount(0, { timeout: 5_000 });
    };

    // ─── PHASE 1 — accordion exists, collapsed ────────────────────────
    console.log("[PHASE 1] Dashboard loads, Kaam accordion collapsed");
    await gotoPath(page, "/admin/dashboard");
    await expect(kaamToggle).toBeVisible();
    await expect(kaamToggle).toHaveAttribute("aria-expanded", "false");

    // ─── PHASE 2 — open: lifecycle + analytics + badge ────────────────
    console.log(
      "[PHASE 2] Opening — expect lifecycle bars, analytics, and badge"
    );
    await openKaamAccordion("Phase 2");

    // Analytics — 4 stat cards visible with expected values.
    await expect(page.getByTestId("kaam-stat-total")).toHaveText("111");
    await expect(page.getByTestId("kaam-stat-this-month")).toHaveText(
      "76"
    );
    await expect(page.getByTestId("kaam-stat-last-month")).toHaveText(
      "25"
    );
    // Growth = 76 - 25 = +51 (+204%); we only assert the +51 prefix
    // since exact rounding may vary by locale.
    await expect(page.getByTestId("kaam-stat-growth")).toContainText(
      "+51"
    );

    // Monthly chart — section visible with all three month bars.
    const monthlyChart = page.getByTestId("kaam-monthly-chart");
    await expect(monthlyChart).toBeVisible();
    await expect(monthlyChart).toContainText(
      "Month-wise Kaam Generated"
    );
    for (const m of MONTHLY) {
      await expect(
        page.getByTestId(`kaam-monthly-bar-${m.monthKey}`)
      ).toBeVisible();
      await expect(monthlyChart).toContainText(m.month);
      await expect(monthlyChart).toContainText(String(m.count));
    }

    // Category donut — section visible with legend entries.
    const categoryChart = page.getByTestId("kaam-category-chart");
    await expect(categoryChart).toBeVisible();
    await expect(categoryChart).toContainText(
      "Category-wise Kaam Allocation"
    );
    for (const c of CATEGORY) {
      const legendItem = page.getByTestId(
        `kaam-category-legend-${c.category}`
      );
      await expect(legendItem).toBeVisible();
      await expect(legendItem).toContainText(c.category);
      await expect(legendItem).toContainText(String(c.count));
      await expect(legendItem).toContainText(`${c.percentage}%`);
    }

    // Area-wise Category Demand matrix is intentionally NOT rendered
    // anymore — confirm its absence so future regressions reintroducing
    // it would fail this test.
    await expect(
      page.getByTestId("kaam-area-demand")
    ).toHaveCount(0);

    // Show-more toggle: with 1 NEW_CATEGORY_ROW_BASE + LIFECYCLE_ROWS
    // = 8 rows total, the table collapses to 5 and offers
    // "Show all Kaam (3 more)". Click to expand so the lifecycle
    // assertions below cover every label.
    const totalRowsCount = 1 + LIFECYCLE_ROWS.length;
    const kaamShowToggle = page.getByTestId("kaam-show-toggle");
    await expect(tableRows).toHaveCount(5);
    await expect(kaamShowToggle).toHaveText(
      `Show all Kaam (${totalRowsCount - 5} more)`
    );
    await kaamShowToggle.click();
    await expect(tableRows).toHaveCount(totalRowsCount);
    await expect(kaamShowToggle).toHaveText("Show less");

    // Column headers including the renamed "When Required". Scoped to
    // the kaam (lifecycle) table — without this the "Area" header
    // collides with the same-named column in the demand matrix below.
    const kaamTable = kaamBody.locator("table", {
      has: page.locator("th", { hasText: /^Kaam No$/ }),
    });
    for (const header of [
      "Kaam No",
      "Phone",
      "Category",
      "Area",
      "Status",
      "Created",
      "When Required",
    ]) {
      await expect(
        kaamTable.locator("th", { hasText: new RegExp(`^${header}$`) })
      ).toBeVisible();
    }

    // Lifecycle "N/5 <label>" text per row (anchored by unique phone
    // because the formatted "2026..." date string would otherwise
    // collide with kaam-number substring matches).
    const lifecycleExpectations: Array<{ phone: string; text: string }> = [
      { phone: "9999999901", text: "1/5 Task Created" },
      { phone: "9999999902", text: "2/5 Matched" },
      { phone: "9999999903", text: "3/5 Providers Notified" },
      { phone: "9999999904", text: "4/5 Provider Responded" },
      { phone: "9999999905", text: "5/5 Completed / Closed" },
    ];
    for (const { phone, text } of lifecycleExpectations) {
      const tr = kaamBody.locator("tbody tr", { hasText: phone });
      await expect(tr, `Row ${phone} shows "${text}"`).toContainText(text);
    }

    // Raw DB statuses must not appear as primary cell text.
    for (const rawValue of [
      "pending_category_review",
      "submitted",
      "notified",
      "provider_responded",
    ]) {
      await expect(
        kaamBody.getByText(rawValue, { exact: true })
      ).toHaveCount(0);
    }

    // New Service Category badge appears once, with amber theme.
    const badges = kaamBody.getByTestId("kaam-new-service-category-badge");
    await expect(badges).toHaveCount(1);
    await expect(badges.first()).toHaveText("New Service Category");
    await expect(badges.first()).toHaveClass(/bg-amber-100/);
    await expect(badges.first()).toHaveClass(/border-amber-500/);

    // Flagged row still shows lifecycle subtext.
    const newCategoryRow = kaamBody.locator("tbody tr", {
      hasText: "9876543210",
    });
    await expect(newCategoryRow).toContainText("1/5 Task Created");

    console.log("[PHASE 2] PASS — analytics + lifecycle + badge rendered");

    // Monthly Report panel — verify it renders and the Generate button
    // calls the new endpoint. The endpoint is mocked here per the
    // first-pass UI spec; the response payload mirrors what
    // /api/admin/reports/monthly-demand returns. Switches to "rows"
    // collapsed first so we don't fight Phase 2's `showAllKaam=true`.
    await kaamShowToggle.click();
    await expect(kaamShowToggle).toContainText("Show all Kaam");
    const reportPanel = page.getByTestId("kaam-monthly-report");
    await expect(reportPanel).toBeVisible();
    await expect(reportPanel).toContainText("Monthly Report");
    // Mock the report endpoint just-in-time for this assertion.
    await mockJson(page, "**/api/admin/reports/monthly-demand**", {
      status: 200,
      body: {
        success: true,
        month: "2026-05",
        summary: {
          totalKaam: 42,
          topCategory: "Electrician",
          topArea: "Sardarpura",
          topRegion: "Central Jodhpur",
          noProviderMatchedCount: 1,
          newCategoryRequestsCount: 2,
        },
        categoryDemand: [
          { category: "Electrician", count: 20, percentage: 47.6 },
          { category: "Plumber", count: 14, percentage: 33.3 },
        ],
        areaDemand: [
          { area: "Sardarpura", region: "Central Jodhpur", count: 18 },
        ],
        regionDemand: [{ region: "Central Jodhpur", count: 18 }],
        regionCategoryDemand: [
          { region: "Central Jodhpur", category: "Electrician", count: 12 },
        ],
        operationalIssues: [],
      } as Record<string, unknown>,
    });
    await page
      .getByTestId("kaam-monthly-report-month-input")
      .fill("2026-05");
    await page.getByTestId("kaam-monthly-report-generate").click();
    const reportResult = page.getByTestId("kaam-monthly-report-result");
    await expect(reportResult).toBeVisible();
    await expect(
      page.getByTestId("kaam-monthly-report-summary-total")
    ).toHaveText("42");
    await expect(
      page.getByTestId("kaam-monthly-report-summary-top-category")
    ).toHaveText("Electrician");
    console.log("[PHASE 2b] PASS — Monthly Report rendered with API data");

    // ─── PHASE 3 — Reprocess error path: category_not_approved ───────
    console.log("[PHASE 3] Reprocess with category_not_approved error");
    reprocessMode = "category_not_approved";
    const reprocessBtn = kaamBody.getByTestId(
      `kaam-reprocess-${NEW_CATEGORY_ROW_BASE.taskId}`
    );
    await expect(reprocessBtn).toBeVisible();
    await expect(reprocessBtn).toHaveText("Reprocess Kaam");

    // The button should only exist on the new-category row.
    await expect(
      kaamBody.locator('button:has-text("Reprocess Kaam")')
    ).toHaveCount(1);

    await reprocessBtn.click();
    const feedback = kaamBody.getByTestId(
      `kaam-reprocess-feedback-${NEW_CATEGORY_ROW_BASE.taskId}`
    );
    await expect(feedback).toBeVisible();
    await expect(feedback).toContainText(
      "Category is still not approved. Approve it first, then reprocess."
    );
    expect(reprocessCalls).toEqual([
      { taskId: NEW_CATEGORY_ROW_BASE.taskId },
    ]);
    // Lifecycle still 1/5 because no refetch was triggered.
    await expect(newCategoryRow).toContainText("1/5 Task Created");
    console.log("[PHASE 3] PASS — error message rendered, no refetch");

    // ─── PHASE 4 — Reprocess success: refetch → 3/5 Providers Notified
    console.log("[PHASE 4] Reprocess success → status advances to 3/5");
    reprocessMode = "success";
    await reprocessBtn.click();

    // Wait for the success feedback line to appear.
    await expect(feedback).toContainText(
      /Matched 2 providers, notified 2/i,
      { timeout: 5_000 }
    );

    // Refetch should land — the new-category row's lifecycle moves
    // forward and the badge disappears (the refetched row no longer
    // satisfies isNewServiceCategory).
    const refetchedRow = kaamBody.locator("tbody tr", {
      hasText: "9876543210",
    });
    await expect(refetchedRow).toContainText("3/5 Providers Notified");
    await expect(
      kaamBody.getByTestId("kaam-new-service-category-badge")
    ).toHaveCount(0);
    expect(
      reprocessCalls.length,
      "Phase 4 should have added a second reprocess call"
    ).toBe(2);
    console.log(
      "[PHASE 4] PASS — refetch updated lifecycle, badge cleared"
    );

    // ─── PHASE 5 — empty state ───────────────────────────────────────
    console.log("[PHASE 5] Reload empty — table empty state");
    mode = "empty";
    await page.reload({ waitUntil: "domcontentloaded" });
    await openKaamAccordion("Phase 5");
    await expect(page.getByTestId("kaam-stat-total")).toHaveText("0");
    await expect(kaamBody.getByText("No Kaam found yet.")).toBeVisible();
    await expect(tableRows).toHaveCount(0);
    // Charts show their own empty states.
    await expect(kaamBody.getByText("No monthly data yet.")).toBeVisible();
    await expect(kaamBody.getByText("No category data yet.")).toBeVisible();
    console.log("[PHASE 5] PASS");

    // ─── PHASE 6 — error state ───────────────────────────────────────
    console.log("[PHASE 6] Reload 500 — red error banner");
    mode = "fail";
    await page.reload({ waitUntil: "domcontentloaded" });
    await openKaamAccordion("Phase 6");
    await expect(
      kaamBody.getByText("Simulated downstream failure")
    ).toBeVisible();
    await expect(tableRows).toHaveCount(0);
    console.log("[PHASE 6] PASS");

    // ─── Invariant — no unexpected mutations against task/chat APIs ──
    expect(
      mutationProbes,
      `Read-only contract violated — unexpected mutations: ${mutationProbes.join(", ")}`
    ).toEqual([]);
    console.log(
      "[INVARIANT] PASS — only /api/admin/kaam/reprocess (POST) used; no task/chat mutations"
    );
  });

  // ──────────────────────────────────────────────────────────────────
  // Dynamic-update test: prove the analytics surfaces are wired to
  // the live /api/admin/kaam response and not to hardcoded frontend
  // arrays. Flips three stateful snapshots across reloads, then
  // asserts each one is reflected verbatim in the rendered UI.
  // ──────────────────────────────────────────────────────────────────

  test("analytics surfaces update dynamically from /api/admin/kaam snapshots", async ({
    page,
  }) => {
    await bootstrapAdminSession(page);
    await mockAdminDashboardApis(page);

    type Snapshot = {
      totalKaam: number;
      regionsCovered: number;
      areasCovered: number;
      monthlyKaam: Array<{ month: string; monthKey: string; count: number }>;
      categoryKaam: Array<{
        category: string;
        count: number;
        percentage: number;
      }>;
      areaCategoryDemand: Array<{
        region: string;
        area: string;
        total: number;
        categories: Array<{ category: string; count: number }>;
      }>;
    };

    const BASELINE: Snapshot = {
      totalKaam: 2,
      regionsCovered: 2,
      areasCovered: 2,
      monthlyKaam: [
        { month: "Apr 2026", monthKey: "2026-04", count: 1 },
        { month: "May 2026", monthKey: "2026-05", count: 1 },
      ],
      categoryKaam: [
        { category: "Electrician", count: 1, percentage: 50.0 },
        { category: "Plumber", count: 1, percentage: 50.0 },
      ],
      areaCategoryDemand: [
        {
          region: "Central Jodhpur",
          area: "Sardarpura",
          total: 1,
          categories: [{ category: "Electrician", count: 1 }],
        },
        {
          region: "North Jodhpur",
          area: "Paota",
          total: 1,
          categories: [{ category: "Plumber", count: 1 }],
        },
      ],
    };

    const INCREMENTED: Snapshot = {
      totalKaam: 3,
      regionsCovered: 2,
      areasCovered: 2,
      monthlyKaam: [
        { month: "Apr 2026", monthKey: "2026-04", count: 1 },
        { month: "May 2026", monthKey: "2026-05", count: 2 },
      ],
      categoryKaam: [
        { category: "Electrician", count: 2, percentage: 66.7 },
        { category: "Plumber", count: 1, percentage: 33.3 },
      ],
      areaCategoryDemand: [
        {
          region: "Central Jodhpur",
          area: "Sardarpura",
          total: 2,
          categories: [{ category: "Electrician", count: 2 }],
        },
        {
          region: "North Jodhpur",
          area: "Paota",
          total: 1,
          categories: [{ category: "Plumber", count: 1 }],
        },
      ],
    };

    const NEW_CATEGORY: Snapshot = {
      totalKaam: 4,
      regionsCovered: 3,
      areasCovered: 3,
      monthlyKaam: [
        { month: "Apr 2026", monthKey: "2026-04", count: 1 },
        { month: "May 2026", monthKey: "2026-05", count: 3 },
      ],
      categoryKaam: [
        { category: "Electrician", count: 2, percentage: 50.0 },
        { category: "Plumber", count: 1, percentage: 25.0 },
        { category: "Solar Panel Repair", count: 1, percentage: 25.0 },
      ],
      areaCategoryDemand: [
        {
          region: "Central Jodhpur",
          area: "Sardarpura",
          total: 2,
          categories: [{ category: "Electrician", count: 2 }],
        },
        {
          region: "North Jodhpur",
          area: "Paota",
          total: 1,
          categories: [{ category: "Plumber", count: 1 }],
        },
        // Brand-new area arrives without a region mapping in admin —
        // backend buckets it into the Unmapped region; UI must surface
        // both the area and the Unmapped group header dynamically.
        {
          region: "Unmapped",
          area: "Chopasni",
          total: 1,
          categories: [{ category: "Solar Panel Repair", count: 1 }],
        },
      ],
    };

    let snapshot: Snapshot = BASELINE;
    await mockJson(page, "**/api/admin/kaam", () => ({
      status: 200,
      body: {
        success: true,
        totalKaam: snapshot.totalKaam,
        monthlyKaam: snapshot.monthlyKaam,
        categoryKaam: snapshot.categoryKaam,
        areaCategoryDemand: snapshot.areaCategoryDemand,
        regionsCovered: snapshot.regionsCovered,
        areasCovered: snapshot.areasCovered,
        analyticsTruncated: false,
        // Empty kaam list — this test focuses on analytics; the lifecycle
        // table is exercised elsewhere.
        kaam: [],
      } as Record<string, unknown>,
    }));

    const kaamToggle = page.locator(
      'button[aria-controls="kaam-tab-body"]'
    );
    const kaamBody = page.locator("#kaam-tab-body");
    const openKaam = async (label: string) => {
      const expanded = await kaamToggle.getAttribute("aria-expanded");
      if (expanded !== "true") await kaamToggle.click();
      await expect(kaamBody).toBeVisible();
      await expect(
        kaamBody.getByText("Loading Kaam…"),
        `${label}: loading clears`
      ).toHaveCount(0, { timeout: 5_000 });
    };

    // ─── PHASE 1 — Baseline ─────────────────────────────────────────
    console.log("[PHASE 1] Baseline analytics");
    await gotoPath(page, "/admin/dashboard");
    await openKaam("Phase 1");

    await expect(page.getByTestId("kaam-stat-total")).toHaveText("2");
    for (const m of BASELINE.monthlyKaam) {
      await expect(
        page.getByTestId(`kaam-monthly-bar-${m.monthKey}`)
      ).toBeVisible();
      await expect(kaamBody).toContainText(m.month);
    }
    for (const c of BASELINE.categoryKaam) {
      await expect(
        page.getByTestId(`kaam-category-legend-${c.category}`)
      ).toBeVisible();
    }
    // Anti-hardcoding: "Solar Panel Repair" / "Chopasni" must NOT
    // appear in the baseline — only the later phases' API snapshots
    // include them.
    await expect(
      kaamBody.getByText("Solar Panel Repair", { exact: false })
    ).toHaveCount(0);
    await expect(
      kaamBody.getByText("Chopasni", { exact: false })
    ).toHaveCount(0);
    console.log("[PHASE 1] PASS — baseline rendered, unseen names absent");

    // ─── PHASE 2 — Counts increment after a new Kaam ────────────────
    console.log("[PHASE 2] Simulate new Kaam → counts increment");
    snapshot = INCREMENTED;
    await page.reload({ waitUntil: "domcontentloaded" });
    await openKaam("Phase 2");
    await expect(page.getByTestId("kaam-stat-total")).toHaveText("3");
    const mayBar = page.getByTestId("kaam-monthly-bar-2026-05");
    await expect(mayBar).toContainText("2");
    const electricianLegend = page.getByTestId(
      "kaam-category-legend-Electrician"
    );
    await expect(electricianLegend).toContainText("2");
    console.log("[PHASE 2] PASS — totals + month + category updated");

    // ─── PHASE 3 — Brand new category surfaces ──────────────────────
    console.log(
      "[PHASE 3] Simulate new category + new unmapped area → appear in UI"
    );
    snapshot = NEW_CATEGORY;
    await page.reload({ waitUntil: "domcontentloaded" });
    await openKaam("Phase 3");
    await expect(page.getByTestId("kaam-stat-total")).toHaveText("4");
    await expect(
      page.getByTestId("kaam-category-legend-Solar Panel Repair")
    ).toBeVisible();
    console.log(
      "[PHASE 3] PASS — new category surfaced from API response"
    );

    // ─── PHASE 4 — Dynamic-source invariants ────────────────────────
    // Two consecutive snapshots ago, "Solar Panel Repair" wasn't in
    // the API response and therefore wasn't visible. After PHASE 3
    // it IS in the response and IS visible. Combining PHASE 1's
    // absence with PHASE 3's presence is the proof that the UI is
    // sourced from the API, not from a hardcoded list.
    await expect(
      kaamBody.getByText("Solar Panel Repair").first()
    ).toBeVisible();
    console.log("[PHASE 4] PASS — dynamic-source invariants hold");
  });
});
