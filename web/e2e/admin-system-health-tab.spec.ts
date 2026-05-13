/**
 * Verification — Admin Dashboard System Health tab.
 *
 * Same mock-driven pattern as the other admin specs: bootstrap admin
 * cookies, layer mockAdminDashboardApis, then stateful mock the new
 * /api/admin/system-health endpoint across (alerts / empty / fail).
 * Confirms the read-only contract by tripwiring any non-GET request
 * against the affected admin/task/chat surfaces.
 */

import { bootstrapAdminSession } from "./_support/auth";
import { gotoPath } from "./_support/home";
import { mockAdminDashboardApis } from "./_support/scenarios";
import { mockJson } from "./_support/routes";
import { test, expect } from "./_support/test";

type Severity = "critical" | "warning" | "info";

type Alert = {
  id: string;
  severity: Severity;
  type: string;
  title: string;
  message: string;
  source: string;
  relatedId: string | null;
  created_at: string | null;
  status: "open" | "observed" | "resolved" | null;
};

// 8 alerts so the show-5/show-all toggle ("Show all issues (3 more)")
// is exercised end-to-end. Severity ordering is intentional —
// critical first, then warnings, then info — to mirror the backend
// sort the UI relies on.
const SAMPLE_ALERTS: Alert[] = [
  {
    id: "notif_log:LOG-1",
    severity: "critical",
    type: "whatsapp_send_failed",
    title: "WhatsApp send failed",
    message: "Meta API returned 132012: template parameter mismatch.",
    source: "notification_logs",
    relatedId: "TK-1700000001",
    created_at: "2026-05-13T11:00:00.000Z",
    status: "open",
  },
  {
    id: "task_no_providers:TK-1700000010",
    severity: "warning",
    type: "no_providers_matched",
    title: "No providers matched",
    message:
      "Kaam No. 215 in Sardarpura (Aquarium Cleaning) found no eligible providers.",
    source: "tasks",
    relatedId: "TK-1700000010",
    created_at: "2026-05-13T10:30:00.000Z",
    status: "open",
  },
  {
    id: "task_pending_category:TK-1700000020",
    severity: "warning",
    type: "pending_category_review",
    title: "Pending category review",
    message:
      'Kaam No. 220 requested category "Solar Panel Repair" — awaiting admin approval.',
    source: "tasks",
    relatedId: "TK-1700000020",
    created_at: "2026-05-13T09:30:00.000Z",
    status: "open",
  },
  {
    id: "issue_report:ISS-1",
    severity: "info",
    type: "user_issue_report",
    title: "Issue reported by user",
    message: "Chat thread not loading on first try.",
    source: "issue_reports",
    relatedId: "ISS-1",
    created_at: "2026-05-13T08:00:00.000Z",
    status: "open",
  },
  // 4 extra alerts so total = 8 — exercises show-5/show-all toggle.
  {
    id: "task_no_providers:TK-X1",
    severity: "warning",
    type: "no_providers_matched",
    title: "No providers matched",
    message: "Kaam No. 230 in Pal Road (Carpenter) had no matches.",
    source: "tasks",
    relatedId: "TK-X1",
    created_at: "2026-05-13T07:30:00.000Z",
    status: "open",
  },
  {
    id: "area_review:AR-1",
    severity: "warning",
    type: "area_review_pending",
    title: "Unmapped area awaiting review",
    message:
      '"Sardar Pura West" seen 5 times from providers — not yet mapped.',
    source: "area_review_queue",
    relatedId: "AR-1",
    created_at: "2026-05-13T07:00:00.000Z",
    status: "open",
  },
  {
    id: "pending_category:PCR-9",
    severity: "info",
    type: "pending_category_request",
    title: "Category awaiting admin review",
    message: '"Solar Panel Repair" requested for Chopasni.',
    source: "pending_category_requests",
    relatedId: "PCR-9",
    created_at: "2026-05-13T06:30:00.000Z",
    status: "open",
  },
  {
    id: "issue_report:ISS-2",
    severity: "info",
    type: "user_issue_report",
    title: "Issue reported by user",
    message: "Cannot find a provider in my area.",
    source: "issue_reports",
    relatedId: "ISS-2",
    created_at: "2026-05-13T06:00:00.000Z",
    status: "open",
  },
];

test.describe("Admin: System Health tab", () => {
  test("renders alerts, summary stats, empty + error states (read-only)", async ({
    page,
  }) => {
    await bootstrapAdminSession(page);
    await mockAdminDashboardApis(page);

    type Mode = "alerts" | "empty" | "fail";
    let mode: Mode = "alerts";
    const mutationProbes: string[] = [];

    page.on("request", (request) => {
      const url = request.url();
      if (
        request.method() !== "GET" &&
        /\/api\/(?:admin\/(?:system-health|categories|kaam|tasks)|tasks|chat)/.test(
          url
        )
      ) {
        mutationProbes.push(`${request.method()} ${url}`);
      }
    });

    await mockJson(page, "**/api/admin/system-health", () => {
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
            summary: { critical: 0, warning: 0, info: 0, total: 0 },
            alerts: [],
          } as Record<string, unknown>,
        };
      }
      return {
        status: 200,
        body: {
          success: true,
          summary: { critical: 1, warning: 3, info: 4, total: 8 },
          alerts: SAMPLE_ALERTS,
        } as Record<string, unknown>,
      };
    });

    const toggle = page.locator(
      'button[aria-controls="system-health-tab-body"]'
    );
    const body = page.locator("#system-health-tab-body");
    const tableRows = body.locator("tbody tr");

    const openAccordion = async (label: string) => {
      const expanded = await toggle.getAttribute("aria-expanded");
      if (expanded !== "true") await toggle.click();
      await expect(body, `${label}: accordion visible`).toBeVisible();
      await expect(
        body.getByText("Checking system health…"),
        `${label}: loading clears`
      ).toHaveCount(0, { timeout: 5_000 });
    };

    // ─── PHASE 1 — Accordion mounts collapsed ────────────────────────
    console.log("[PHASE 1] System Health accordion mounts collapsed");
    await gotoPath(page, "/admin/dashboard");
    await expect(toggle).toBeVisible();
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(toggle).toContainText(/^System Health/);

    // ─── PHASE 2 — Open, verify alerts + summary + severity styling ─
    console.log("[PHASE 2] Open — expect 4 alerts and summary");
    await openAccordion("Phase 2");

    await expect(
      page.getByTestId("system-health-stat-critical")
    ).toHaveText("1");
    await expect(
      page.getByTestId("system-health-stat-warning")
    ).toHaveText("3");
    await expect(page.getByTestId("system-health-stat-info")).toHaveText(
      "4"
    );
    await expect(page.getByTestId("system-health-stat-total")).toHaveText(
      "8"
    );

    // Collapsed subtitle (visible even when open) reflects counts.
    await expect(toggle).toContainText(/1 critical/);
    await expect(toggle).toContainText(/3 warnings/);

    // Show-more toggle: with 8 alerts the table collapses to 5 and
    // offers "Show all issues (3 more)". Expand to verify every row
    // renders, then collapse to confirm the toggle's two-way state.
    const showToggle = page.getByTestId("system-health-show-toggle");
    await expect(tableRows).toHaveCount(5);
    await expect(showToggle).toHaveText(
      `Show all issues (${SAMPLE_ALERTS.length - 5} more)`
    );
    await showToggle.click();
    await expect(tableRows).toHaveCount(SAMPLE_ALERTS.length);
    await expect(showToggle).toHaveText("Show less");

    for (const alert of SAMPLE_ALERTS) {
      const row = page.getByTestId(`system-health-alert-${alert.id}`);
      await expect(row).toBeVisible();
      await expect(row).toHaveAttribute("data-severity", alert.severity);
      await expect(row).toContainText(alert.title);
      await expect(row).toContainText(alert.message);
      await expect(row).toContainText(alert.source);
    }

    // Collapse again — back to 5 visible.
    await showToggle.click();
    await expect(tableRows).toHaveCount(5);
    await expect(showToggle).toContainText("Show all issues");

    // Severity pills render the expected labels inside their row.
    const criticalRow = page.getByTestId(
      "system-health-alert-notif_log:LOG-1"
    );
    await expect(
      criticalRow.getByText("Critical", { exact: true })
    ).toBeVisible();
    const warningRow = page.getByTestId(
      "system-health-alert-task_no_providers:TK-1700000010"
    );
    await expect(
      warningRow.getByText("Warning", { exact: true })
    ).toBeVisible();
    const infoRow = page.getByTestId("system-health-alert-issue_report:ISS-1");
    await expect(infoRow.getByText("Info", { exact: true })).toBeVisible();

    console.log("[PHASE 2] PASS — alerts + summary rendered");

    // ─── PHASE 3 — Empty state ───────────────────────────────────────
    console.log("[PHASE 3] Reload empty — expect empty state");
    mode = "empty";
    await page.reload({ waitUntil: "domcontentloaded" });
    await openAccordion("Phase 3");
    await expect(
      page.getByTestId("system-health-stat-total")
    ).toHaveText("0");
    await expect(
      body.getByTestId("system-health-empty")
    ).toContainText("No active system issues found.");
    await expect(tableRows).toHaveCount(0);
    console.log("[PHASE 3] PASS — empty state visible");

    // ─── PHASE 4 — Error state ───────────────────────────────────────
    console.log("[PHASE 4] Reload 500 — expect red error banner");
    mode = "fail";
    await page.reload({ waitUntil: "domcontentloaded" });
    await openAccordion("Phase 4");
    await expect(
      body.getByText("Simulated downstream failure")
    ).toBeVisible();
    await expect(tableRows).toHaveCount(0);
    console.log("[PHASE 4] PASS — error banner visible");

    // ─── Read-only invariant ─────────────────────────────────────────
    expect(
      mutationProbes,
      `Read-only violated: ${mutationProbes.join(", ")}`
    ).toEqual([]);
    console.log(
      "[INVARIANT] PASS — no mutation requests fired against admin/task/chat APIs"
    );
  });
});
