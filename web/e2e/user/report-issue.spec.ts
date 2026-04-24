import { bootstrapUserSession } from "../_support/auth";
import { gotoPath } from "../_support/home";
import { mockReportIssueApi } from "../_support/scenarios";
import { test, expect } from "../_support/test";

test.describe("User: report issue flow", () => {
  test("logged-in users can submit issue reports without client errors", async ({
    page,
    diag,
  }) => {
    await bootstrapUserSession(page);
    await mockReportIssueApi(page);

    // Purpose: keep the support/reporting path wired for real user-facing breakages.
    await gotoPath(page, "/report-issue");

    await expect(page.getByRole("heading", { name: "Report an Issue" })).toBeVisible();
    await page.getByRole("combobox").nth(0).selectOption("Chat/message problem");
    await page.getByRole("combobox").nth(1).selectOption("Chat");
    await page
      .locator('textarea[placeholder*="Please explain the issue"]')
      .fill("The first message did not load until the page was refreshed.");
    await page.getByRole("button", { name: /^submit$/i }).click();

    await expect(page.getByText(/issue submitted successfully/i)).toBeVisible();

    diag.assertClean();
  });
});
