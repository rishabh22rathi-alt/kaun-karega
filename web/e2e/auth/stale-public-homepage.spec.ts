import { test, expect } from "../_support/test";
import { gotoPath } from "../_support/home";
import { mockCommonCatalogRoutes, mockJson } from "../_support/routes";
import { appUrl } from "../_support/runtime";

function allowExpectedWhoami401(diag: {
  allowHttpError: (p: RegExp) => void;
  allowConsoleError: (p: RegExp) => void;
}): void {
  diag.allowHttpError(/\/api\/auth\/whoami.*401/i);
  diag.allowHttpError(/\/api\/provider\/notifications.*401/i);
  diag.allowConsoleError(
    /Failed to load resource: the server responded with a status of 401/i
  );
}

async function mockWhoamiNoSession(page: Parameters<typeof mockJson>[0]): Promise<void> {
  await mockJson(page, /\/api\/auth\/whoami/, {
    status: 401,
    body: { ok: false, reason: "no-session" },
  });
}

async function mockWhoamiStale(page: Parameters<typeof mockJson>[0]): Promise<void> {
  await mockJson(page, /\/api\/auth\/whoami/, {
    status: 401,
    body: { ok: false, reason: "stale" },
  });
}

async function mockLogoutOk(page: Parameters<typeof mockJson>[0]): Promise<void> {
  await mockJson(page, /\/api\/auth\/logout/, {
    status: 200,
    body: { ok: true },
  });
}

async function expectHomepageRendered(page: Parameters<typeof gotoPath>[0]): Promise<void> {
  await expect(page).not.toHaveURL(/\/login(\?|$)/);
  await expect(page.getByText("JODHPUR LOCAL SERVICES")).toBeVisible();
  await expect(page.getByText(/Application error/i)).toHaveCount(0);
}

test.describe("Auth: stale public homepage state", () => {
  test.use({
    baseURL: "http://127.0.0.1:3000",
    viewport: { width: 390, height: 844 },
  });

  test("mobile anonymous homepage loads with cleared cookies and storage", async ({
    page,
    diag,
  }) => {
    allowExpectedWhoami401(diag);
    await page.context().clearCookies();
    await page.addInitScript(() => {
      window.localStorage.clear();
      window.sessionStorage.clear();
    });
    await mockCommonCatalogRoutes(page);
    await mockWhoamiNoSession(page);

    await gotoPath(page, "/");
    await expectHomepageRendered(page);

    diag.assertClean();
  });

  test("mobile homepage with corrupted localStorage and sessionStorage renders guest", async ({
    page,
    diag,
  }) => {
    allowExpectedWhoami401(diag);
    await page.context().clearCookies();
    await page.addInitScript(() => {
      window.localStorage.setItem("kk_admin_session", "{bad-json");
      window.localStorage.setItem("kk_provider_profile", "{bad-json");
      window.localStorage.setItem("kk_disclaimer_accepted_v1", "{bad-json");
      window.localStorage.setItem("kk_last_area", "Sardarpura");
      window.sessionStorage.setItem("kk_task_draft_v1", "{bad-json");
    });
    await mockCommonCatalogRoutes(page);
    await mockWhoamiNoSession(page);

    await gotoPath(page, "/");
    await expectHomepageRendered(page);

    diag.assertClean();
  });

  test("homepage stale whoami repairs browser auth state without login redirect", async ({
    page,
    diag,
  }) => {
    allowExpectedWhoami401(diag);
    await mockCommonCatalogRoutes(page);
    await mockWhoamiStale(page);
    await mockLogoutOk(page);
    await page.context().addCookies([
      {
        name: "kk_session_user",
        value: JSON.stringify({
          phone: "9999999999",
          verified: true,
          createdAt: Date.now(),
          sver: 1,
        }),
        url: appUrl("/"),
        sameSite: "Lax",
      },
      {
        name: "kk_admin",
        value: "1",
        url: appUrl("/"),
        sameSite: "Lax",
      },
    ]);
    await page.addInitScript(() => {
      window.localStorage.setItem(
        "kk_admin_session",
        JSON.stringify({ isAdmin: true, name: "Stale Admin" })
      );
      window.localStorage.setItem(
        "kk_provider_profile",
        JSON.stringify({ Phone: "9999999999", Name: "Stale Provider" })
      );
    });

    await gotoPath(page, "/");
    await page.waitForTimeout(500);
    await expectHomepageRendered(page);

    const remainingState = await page.evaluate(() => ({
      adminSession: window.localStorage.getItem("kk_admin_session"),
      providerProfile: window.localStorage.getItem("kk_provider_profile"),
    }));
    expect(remainingState).toEqual({
      adminSession: null,
      providerProfile: null,
    });
    const cookies = await page.context().cookies(appUrl("/"));
    expect(cookies.find((c) => c.name === "kk_session_user")?.value || "").toBe("");
    expect(cookies.find((c) => c.name === "kk_admin")?.value || "").toBe("");

    diag.assertClean();
  });
});
