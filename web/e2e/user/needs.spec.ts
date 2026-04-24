import { bootstrapUserSession } from "../_support/auth";
import { QA_AREA, QA_NEED_ID } from "../_support/data";
import { gotoPath } from "../_support/home";
import { mockNeedApis } from "../_support/scenarios";
import { test, expect } from "../_support/test";

test.describe("User: needs flows", () => {
  test("my needs lets users manage status and inspect response threads", async ({
    page,
    diag,
  }) => {
    await bootstrapUserSession(page);
    await mockNeedApis(page);

    // Purpose: keep the I NEED management surface responsive after backend migrations.
    await gotoPath(page, "/i-need/my-needs");

    await expect(page.getByRole("heading", { name: "My Needs" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Need an office assistant" })).toBeVisible();

    await page.getByRole("button", { name: /mark complete/i }).click();
    await expect(page.locator("article").first().getByText("Completed")).toBeVisible();

    await page.getByRole("link", { name: /view responses/i }).click();
    await expect(page).toHaveURL(new RegExp(`/i-need/my-needs/${QA_NEED_ID}/responses`));
    await expect(page.getByRole("heading", { name: "Responses" })).toBeVisible();
    await expect(page.getByText(/last message by responder/i)).toBeVisible();

    diag.assertClean();
  });

  test("posting a need routes back into My Needs with the protected flow intact", async ({
    page,
    diag,
  }) => {
    await bootstrapUserSession(page);
    await mockNeedApis(page);

    // Purpose: verify the primary I NEED creation route still submits through /api/kk.
    await gotoPath(page, "/i-need/post");

    await expect(page.getByRole("heading", { name: "Post Your Need" })).toBeVisible();
    await page.getByRole("button", { name: /^employee$/i }).click();
    await page.locator("#need-area").fill(QA_AREA);
    await page.getByRole("button", { name: /post anonymously/i }).click();
    await page.getByRole("button", { name: /post need/i }).click();

    await expect(page).toHaveURL(/\/i-need\/my-needs/);
    await expect(page.getByRole("heading", { name: "My Needs" })).toBeVisible();

    diag.assertClean();
  });
});
