import { bootstrapProviderSession } from "../_support/auth";
import {
  QA_AREA,
  QA_PROVIDER_ID,
  QA_PROVIDER_NAME,
} from "../_support/data";
import { gotoPath } from "../_support/home";
import { mockProviderRegistrationApis } from "../_support/scenarios";
import { test, expect } from "../_support/test";

test.describe("Provider: registration", () => {
  test("provider registration keeps the service and area selection flow usable", async ({
    page,
    diag,
  }) => {
    await bootstrapProviderSession(page);
    await mockProviderRegistrationApis(page, {
      registerResponse: {
        providerId: QA_PROVIDER_ID,
        message: "Registration successful.",
        verified: "yes",
        pendingApproval: "no",
        requestedNewCategories: [],
        requestedNewAreas: [],
      },
    });

    // Purpose: keep the onboarding form focused and non-brittle while still validating the core path.
    await gotoPath(page, "/provider/register");

    await expect(
      page.getByRole("heading", { name: /list your service on kaun karega/i })
    ).toBeVisible();
    await expect(
      page.locator('input[placeholder*="Select at least 1 category"]').first()
    ).toBeDisabled();

    await page.locator('input[placeholder="Enter your full name"]').fill(QA_PROVIDER_NAME);
    await expect(page.locator('input[placeholder="Search categories"]')).toBeVisible();
    await page.getByRole("button", { name: /^electrician$/i }).click();
    await page
      .locator('input[placeholder*="Search and select areas"]')
      .fill(QA_AREA);
    await page.getByRole("button", { name: QA_AREA }).click();
    await page.getByRole("button", { name: /submit application/i }).click();

    await expect(page.getByText(/registration successful/i)).toBeVisible();
    await expect(page.getByText(`ProviderID: ${QA_PROVIDER_ID}`).last()).toBeVisible();
    await expect(page.getByText("Selected: 1 categories, 1 areas")).toBeVisible();

    diag.assertClean();
  });
});
