import type { Locator } from "@playwright/test";

import { bootstrapAdminSession } from "../_support/auth";
import { QA_AREA } from "../_support/data";
import { gotoPath } from "../_support/home";
import { mockAdminDashboardApis } from "../_support/scenarios";
import { test, expect } from "../_support/test";

async function ensureSectionOpen(trigger: Locator, content: Locator): Promise<void> {
  if (await content.isVisible().catch(() => false)) {
    return;
  }
  await trigger.click();
  await expect(content).toBeVisible();
}

test.describe("Admin: dashboard operations", () => {
  test("admin dashboard renders the major operational sections and health panels", async ({
    page,
    diag,
  }) => {
    await bootstrapAdminSession(page);
    await mockAdminDashboardApis(page);

    // Purpose: verify the admin control center still boots with the major review surfaces visible.
    await gotoPath(page, "/admin/dashboard");

    await expect(page.getByRole("heading", { name: "Control Center" })).toBeVisible();
    await expect(page.getByText("Dashboard snapshot")).toBeVisible();
    await expect(page.getByText("Pending Category Requests", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("Notification Health")).toBeVisible();
    await expect(page.getByText("Recent Attempts")).toBeVisible();
    await expect(page.getByText("Areas Management")).toBeVisible();
    await expect(page.getByText("Reported Issues")).toBeVisible();
    await expect(page.getByText("Chat Monitoring")).toBeVisible();

    diag.assertClean();
  });

  test("provider verification and category-review actions stay wired to the admin dashboard", async ({
    page,
    diag,
  }) => {
    await bootstrapAdminSession(page);
    await mockAdminDashboardApis(page);

    // Purpose: keep the highest-risk admin mutations covered without pulling in live data dependencies.
    await gotoPath(page, "/admin/dashboard");

    const pendingProviderRow = page.locator("tr").filter({ hasText: "PR-QA-PENDING" });
    const pendingProviderApproveButton = pendingProviderRow.getByRole("button", {
      name: /^approve$/i,
    });
    await ensureSectionOpen(
      page.getByRole("button", { name: /providers needing attention/i }),
      pendingProviderApproveButton
    );
    await pendingProviderApproveButton.click();
    await expect(
      pendingProviderRow.getByRole("button", { name: /^unverify$/i })
    ).toBeVisible();

    const categoryRow = page.locator("tr").filter({ hasText: "CAT-REQ-QA-0001" });
    await categoryRow.getByRole("button", { name: /^approve$/i }).click();
    await expect(categoryRow).toHaveCount(0);

    diag.assertClean();
  });

  test("area mapping, issue triage, and chat-monitoring affordances remain responsive", async ({
    page,
    diag,
  }) => {
    await bootstrapAdminSession(page);
    await mockAdminDashboardApis(page);

    // Purpose: audit the secondary admin controls that commonly regress when payloads change shape.
    await gotoPath(page, "/admin/dashboard");

    await ensureSectionOpen(
      page.getByRole("button", { name: /areas management/i }),
      page.getByRole("button", { name: /view aliases/i })
    );
    await page.getByRole("button", { name: /view aliases/i }).click();
    await page.locator('input[placeholder="e.g. Air Force Rd"]').fill("Sardarpura West");
    await page.getByRole("button", { name: /save alias/i }).click();
    await expect(page.getByText("Sardarpura West", { exact: true })).toBeVisible();

    const unmappedRow = page.locator("tr").filter({ hasText: "AREA-REVIEW-QA-0001" });
    await unmappedRow.locator('input[list="admin-area-canonical-options"]').fill(QA_AREA);
    await unmappedRow.getByRole("button", { name: /^map$/i }).click();
    await expect(unmappedRow).toHaveCount(0);

    const issueRow = page.locator("tr").filter({ hasText: "ISSUE-QA-0001" });
    await ensureSectionOpen(
      page.getByRole("button", { name: /reported issues/i }),
      issueRow.getByRole("button", { name: /mark resolved/i })
    );
    await issueRow.getByRole("button", { name: /mark resolved/i }).click();
    await expect(issueRow.locator("span").filter({ hasText: /^resolved$/i })).toBeVisible();

    const chatRow = page.locator("tr").filter({ hasText: "THREAD-QA-0001" });
    await ensureSectionOpen(
      page.getByRole("button", { name: /chat monitoring/i }),
      chatRow.getByRole("button", { name: /^open$/i })
    );
    await chatRow.getByRole("button", { name: /^open$/i }).click();
    await expect(page.getByText(new RegExp(`ThreadID:\\s*${"THREAD-QA-0001"}`))).toBeVisible();

    diag.assertClean();
  });
});
