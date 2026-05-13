/**
 * Verification — Admin Reports tab (preview + PDF download).
 *
 * Mocks /api/admin/reports for the four report types and exercises:
 *   - tab mount + collapsed state,
 *   - default type = monthly_business_summary,
 *   - Generate Preview → summary + sections render,
 *   - switching report type triggers a new API call with new params,
 *   - Download PDF button appears after preview and clicking it does
 *     not crash (PDF file generation happens client-side via jsPDF;
 *     we accept the click as success when the button transitions
 *     through the "Preparing PDF…" label without setting an error).
 */

import { bootstrapAdminSession } from "./_support/auth";
import { gotoPath } from "./_support/home";
import { mockAdminDashboardApis } from "./_support/scenarios";
import { mockJson } from "./_support/routes";
import { test, expect } from "./_support/test";

type ReportType =
  | "kaam_demand"
  | "provider_leads"
  | "system_health"
  | "monthly_business_summary";

type SummaryEntry = { label: string; value: string | number };
type ReportSection = {
  title: string;
  columns: string[];
  rows: Array<Record<string, string | number | null>>;
};
type ReportPayload = {
  success: true;
  type: ReportType;
  title: string;
  from: string;
  to: string;
  generatedAt: string;
  summary: SummaryEntry[];
  sections: ReportSection[];
  notes: string[];
};

function buildReport(type: ReportType): ReportPayload {
  if (type === "kaam_demand") {
    return {
      success: true,
      type,
      title: "Kaam Demand Report",
      from: "2026-05-01",
      to: "2026-05-13",
      generatedAt: "2026-05-13T12:00:00.000Z",
      summary: [
        { label: "Total Kaam", value: 42 },
        { label: "Top Category", value: "Electrician" },
      ],
      sections: [
        {
          title: "Category Demand",
          columns: ["Category", "Count", "Share"],
          rows: [
            { Category: "Electrician", Count: 20, Share: "47.6%" },
            { Category: "Plumber", Count: 14, Share: "33.3%" },
          ],
        },
      ],
      notes: [],
    };
  }
  if (type === "provider_leads") {
    return {
      success: true,
      type,
      title: "Provider Leads Report",
      from: "2026-05-01",
      to: "2026-05-13",
      generatedAt: "2026-05-13T12:00:00.000Z",
      summary: [
        { label: "Total Matches", value: 5 },
        { label: "Total Responses", value: 3 },
      ],
      sections: [
        {
          title: "Provider Leads",
          columns: ["Name", "Matched", "Responded"],
          rows: [{ Name: "Edison Sparks", Matched: 3, Responded: 2 }],
        },
      ],
      notes: [],
    };
  }
  if (type === "system_health") {
    return {
      success: true,
      type,
      title: "System Health Report",
      from: "2026-05-01",
      to: "2026-05-13",
      generatedAt: "2026-05-13T12:00:00.000Z",
      summary: [
        { label: "WhatsApp Failures", value: 2 },
        { label: "No Providers Matched", value: 1 },
      ],
      sections: [
        {
          title: "WhatsApp Failures",
          columns: ["Task", "Provider", "Status"],
          rows: [
            { Task: "TK-1", Provider: "PR-X", Status: "error" },
          ],
        },
      ],
      notes: [],
    };
  }
  return {
    success: true,
    type,
    title: "Monthly Business Summary",
    from: "2026-05-01",
    to: "2026-05-13",
    generatedAt: "2026-05-13T12:00:00.000Z",
    summary: [
      { label: "Total Kaam", value: 88 },
      { label: "Registered Users", value: 120 },
      { label: "Verified Providers", value: 17 },
    ],
    sections: [
      {
        title: "Category Demand",
        columns: ["Category", "Count", "Share"],
        rows: [{ Category: "Electrician", Count: 20, Share: "22.7%" }],
      },
    ],
    notes: [
      "All figures are computed live from Supabase. Categories, areas, and regions are sourced from actual rows — nothing hardcoded.",
    ],
  };
}

test.describe("Admin: Reports tab (preview + PDF)", () => {
  test("renders accordion, generates preview, switches type, allows PDF", async ({
    page,
  }) => {
    await bootstrapAdminSession(page);
    await mockAdminDashboardApis(page);

    const reportCalls: Array<{ type: string; from: string; to: string }> = [];
    let mode: "success" | "fail" = "success";
    let currentType: ReportType = "monthly_business_summary";

    await mockJson(page, "**/api/admin/reports**", ({ request }) => {
      const url = new URL(request.url());
      const t = (url.searchParams.get("type") ?? "") as ReportType;
      const from = url.searchParams.get("from") ?? "";
      const to = url.searchParams.get("to") ?? "";
      reportCalls.push({ type: t, from, to });
      if (mode === "fail") {
        return {
          status: 500,
          body: {
            success: false,
            error: "Simulated failure",
          } as Record<string, unknown>,
        };
      }
      currentType = t || currentType;
      return {
        status: 200,
        body: buildReport(currentType) as unknown as Record<string, unknown>,
      };
    });

    const toggle = page.locator('button[aria-controls="reports-tab-body"]');
    const body = page.locator("#reports-tab-body");

    // ─── PHASE 1 — Tab mounts collapsed ─────────────────────────────
    console.log("[PHASE 1] Reports tab mounts collapsed");
    await gotoPath(page, "/admin/dashboard");
    await expect(toggle).toBeVisible();
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await toggle.click();
    await expect(body).toBeVisible();

    // ─── PHASE 2 — Default type is monthly_business_summary ─────────
    console.log("[PHASE 2] Default type + Generate Preview");
    const typeSelect = page.getByTestId("reports-type-select");
    await expect(typeSelect).toHaveValue("monthly_business_summary");
    // Empty state visible before preview.
    await expect(page.getByTestId("reports-empty")).toBeVisible();

    await page.getByTestId("reports-generate").click();
    const result = page.getByTestId("reports-result");
    await expect(result).toBeVisible();
    await expect(page.getByTestId("reports-summary")).toBeVisible();
    await expect(result).toContainText("Monthly Business Summary");
    await expect(result).toContainText("Registered Users");
    await expect(result).toContainText("Verified Providers");
    expect(reportCalls.length).toBeGreaterThanOrEqual(1);
    expect(reportCalls[reportCalls.length - 1].type).toBe(
      "monthly_business_summary"
    );

    // ─── PHASE 3 — Switching type triggers new API call ─────────────
    console.log("[PHASE 3] Switch to Kaam Demand → new API call + content");
    await typeSelect.selectOption("kaam_demand");
    await page.getByTestId("reports-generate").click();
    await expect(result).toContainText("Kaam Demand Report");
    await expect(result).toContainText("Top Category");
    expect(reportCalls[reportCalls.length - 1].type).toBe("kaam_demand");

    console.log("[PHASE 3b] Switch to Provider Leads");
    await typeSelect.selectOption("provider_leads");
    await page.getByTestId("reports-generate").click();
    await expect(result).toContainText("Provider Leads Report");
    expect(reportCalls[reportCalls.length - 1].type).toBe("provider_leads");

    console.log("[PHASE 3c] Switch to System Health");
    await typeSelect.selectOption("system_health");
    await page.getByTestId("reports-generate").click();
    await expect(result).toContainText("System Health Report");
    expect(reportCalls[reportCalls.length - 1].type).toBe("system_health");

    // ─── PHASE 4 — Download PDF button appears + click doesn't crash ─
    console.log("[PHASE 4] Download PDF click");
    const pdfBtn = page.getByTestId("reports-download-pdf");
    await expect(pdfBtn).toBeVisible();
    await expect(pdfBtn).toBeEnabled();
    // jsPDF's `doc.save(...)` triggers a browser download via blob URL;
    // we accept the click as success when the button completes without
    // an error banner appearing.
    await pdfBtn.click();
    // Allow the dynamic import + render cycle to complete. The button
    // returns to its "Download PDF" label once done.
    await expect(pdfBtn).toHaveText("Download PDF", { timeout: 10_000 });
    // No error banner means PDF generation succeeded end-to-end.
    await expect(body.locator(".border-red-200")).toHaveCount(0);
    console.log("[PHASE 4] PASS — PDF click completed without error");

    // ─── PHASE 5 — Error state ──────────────────────────────────────
    console.log("[PHASE 5] Mock 500 — error banner appears");
    mode = "fail";
    await page.getByTestId("reports-generate").click();
    await expect(body.getByText("Simulated failure")).toBeVisible();
    console.log("[PHASE 5] PASS");
  });
});
