import { QA_AREA, QA_PROVIDER_NAME, QA_TASK_ID } from "../_support/data";
import { gotoPath } from "../_support/home";
import { jsonOk, mockJson } from "../_support/routes";
import { test, expect } from "../_support/test";

test.describe("Matching: success page and notifications", () => {
  test("success page triggers downstream notifications and shows matched providers when requested", async ({
    page,
    diag,
  }) => {
    const notificationBodies: string[] = [];

    await mockJson(page, "**/api/process-task-notifications**", ({ body }) => {
      notificationBodies.push(JSON.stringify(body));
      return jsonOk({ matchedProviders: 1, attemptedSends: 1, failedSends: 0 });
    });
    await mockJson(
      page,
      "**/api/find-provider**",
      jsonOk({
        count: 1,
        providers: [
          {
            name: QA_PROVIDER_NAME,
            phone: "9999999902",
            verified: "yes",
          },
        ],
      })
    );

    // Purpose: verify the task success page still kicks off notifications and provider lookup through internal APIs.
    await gotoPath(
      page,
      `/success?service=Electrician&area=${encodeURIComponent(QA_AREA)}&taskId=${QA_TASK_ID}&displayId=101`
    );

    await expect(page.getByText("Task Submitted Successfully")).toBeVisible();
    await page.waitForTimeout(3200);
    expect(notificationBodies.some((payload) => payload.includes(QA_TASK_ID))).toBeTruthy();

    await page.getByRole("button", { name: /show service provider numbers/i }).click();
    await expect(page.getByText(QA_PROVIDER_NAME)).toBeVisible();

    diag.assertClean();
  });

  test("zero-match tasks stay functional and explain the empty provider state", async ({
    page,
    diag,
  }) => {
    await mockJson(
      page,
      "**/api/process-task-notifications**",
      jsonOk({ matchedProviders: 0, attemptedSends: 0, failedSends: 0 })
    );
    await mockJson(
      page,
      "**/api/find-provider**",
      jsonOk({
        count: 0,
        providers: [],
      })
    );

    // Purpose: keep the zero-match UX explicit instead of surfacing a blank or broken modal.
    await gotoPath(
      page,
      `/success?service=Electrician&area=${encodeURIComponent(QA_AREA)}&taskId=${QA_TASK_ID}&displayId=101`
    );

    await page.waitForTimeout(3200);
    await page.getByRole("button", { name: /show service provider numbers/i }).click();
    await expect(page.getByText("No providers found for this service and area.")).toBeVisible();

    diag.assertClean();
  });
});
