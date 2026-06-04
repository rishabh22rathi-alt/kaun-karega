import { mockCommonCatalogRoutes, mockJson } from "../_support/routes";
import { gotoPath } from "../_support/home";
import { test, expect } from "../_support/test";

test.describe("Smoke: app shell", () => {
  test("guest homepage shell loads and the desktop sidebar shell stays visible", async ({
    page,
    diag,
  }) => {
    await mockCommonCatalogRoutes(page);
    // The shell polls /api/auth/whoami on mount to resolve logged-in vs guest.
    // A guest legitimately gets 401 { reason: "no-session" }; mock it so this
    // smoke test is hermetic (no live auth backend needed) and allow the 401
    // resource-load noise the browser logs for it, so assertClean() still
    // catches unrelated regressions.
    await mockJson(page, /\/api\/auth\/whoami/, {
      status: 401,
      body: { ok: false, reason: "no-session" },
    });
    diag.allowHttpError(/\/api\/auth\/whoami.*401/i);
    diag.allowConsoleError(
      /Failed to load resource: the server responded with a status of 401/i
    );

    await page.setViewportSize({ width: 1280, height: 900 });
    await gotoPath(page, "/");

    const sidebar = page.locator("aside");
    await expect(sidebar).toBeVisible();
    await expect(page.locator('input[type="text"]').first()).toBeVisible();
    await expect(page.getByText("How it works")).toBeVisible();
    await expect(
      page.getByRole("button", { name: /register as provider/i })
    ).toBeVisible();
    await expect(sidebar.getByRole("link", { name: "Home" })).toBeVisible();
    await expect(sidebar.getByRole("link", { name: "Login" })).toBeVisible();
    // Guests register via the page-level "Register as Provider" CTA asserted
    // above. The sidebar's "Register as Service Provider" action is gated
    // behind login (sidebar UX refactor 6abe788: the guest sidebar shows only
    // Home + Login), so it must NOT appear in the guest sidebar.
    await expect(
      sidebar.getByRole("button", { name: /register as service provider/i })
    ).toHaveCount(0);

    diag.assertClean();
  });
});
