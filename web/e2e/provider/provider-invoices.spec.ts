/**
 * Provider "My Invoices" — menu entry + invoices page.
 *
 * Covers:
 *   1. Provider hamburger menu shows "My Invoices".
 *   2. Clicking it navigates to /provider/invoices.
 *   3-5. The page renders; empty state and populated list both work.
 *   6. A generated invoice shows an active Download button (per-invoice
 *      download route href).
 *   7. A pending invoice shows a status chip, NOT a download button.
 *   8. The client list request never sends provider_id (session-only).
 *   10. Existing menu items remain: Install Kaun Karega App, Notification
 *       Settings, Report an Issue, Logout.
 *
 * Server-side ownership enforcement on the download route (req 9) is a
 * 404-on-mismatch guard verified by code review of
 * /api/provider/invoices/[id]/download — it resolves provider_id from the
 * session and returns 404 for any invoice not owned by the caller, so it
 * cannot be exercised through API mocks (which replace the server).
 */

import { bootstrapProviderSession } from "../_support/auth";
import { gotoPath } from "../_support/home";
import { jsonOk, mockJson } from "../_support/routes";
import { test, expect } from "../_support/test";

const MOBILE_VIEWPORT = { width: 390, height: 844 };

async function hideNextDevOverlay(
  page: import("@playwright/test").Page
): Promise<void> {
  await page.addInitScript(() => {
    const css = "nextjs-portal { display: none !important; }";
    const inject = () => {
      if (!document.head) return;
      if (document.head.querySelector('style[data-test-hide-portal="1"]')) return;
      const style = document.createElement("style");
      style.setAttribute("data-test-hide-portal", "1");
      style.textContent = css;
      document.head.appendChild(style);
    };
    if (document.head) inject();
    else document.addEventListener("DOMContentLoaded", inject, { once: true });
  });
}

async function mockProviderLookup(
  page: import("@playwright/test").Page
): Promise<void> {
  // MobileBottomNav + MenuSheet gate the provider rows on this probe.
  await mockJson(page, "**/api/kk**", ({ request }) => {
    const action = new URL(request.url()).searchParams.get("action") || "";
    if (action === "get_provider_by_phone") {
      return jsonOk({ provider: { ProviderID: "P-TEST", Name: "QA Provider" } });
    }
    return jsonOk({});
  });
}

async function mockChrome(page: import("@playwright/test").Page): Promise<void> {
  await mockJson(
    page,
    "**/api/provider/dashboard-profile",
    jsonOk({ provider: { ProviderID: "P-TEST", Name: "QA Provider" } })
  );
  await mockJson(page, "**/api/auth/whoami", jsonOk({ phone: "9999999999" }));
  await mockJson(page, "**/api/provider/notifications", jsonOk({ notifications: [] }));
  await mockJson(page, "**/api/announcements/active", jsonOk({ announcement: null }));
  await mockJson(
    page,
    "**/api/notification-preferences",
    jsonOk({ preferences: { general: true } })
  );
}

type InvoicePayload = {
  id: number;
  invoice_number: string;
  invoice_date: string;
  plan_code: string;
  taxable_value_paise: number;
  total_tax_paise: number;
  total_paise: number;
  pdf_status: string;
};

async function mockProviderInvoices(
  page: import("@playwright/test").Page,
  invoices: InvoicePayload[],
  onRequest?: (url: string, method: string, postData: string | null) => void
): Promise<void> {
  // Exact path only — must not intercept the .../[id]/download route.
  await mockJson(page, /\/api\/provider\/invoices(\?.*)?$/, ({ request }) => {
    onRequest?.(request.url(), request.method(), request.postData());
    return jsonOk({ invoices });
  });
}

const GENERATED: InvoicePayload = {
  id: 1,
  invoice_number: "KK/FY2026-27/000001",
  invoice_date: "2026-06-01",
  plan_code: "all_jodhpur",
  taxable_value_paise: 10100,
  total_tax_paise: 1818,
  total_paise: 11918,
  pdf_status: "generated",
};

const PENDING: InvoicePayload = {
  id: 2,
  invoice_number: "KK/FY2026-27/000002",
  invoice_date: "2026-06-02",
  plan_code: "regions_5",
  taxable_value_paise: 3100,
  total_tax_paise: 558,
  total_paise: 3658,
  pdf_status: "pending",
};

test.describe("Provider My Invoices", () => {
  test.use({ viewport: MOBILE_VIEWPORT });

  test("menu shows My Invoices alongside existing items and navigates", async ({
    page,
    diag,
  }) => {
    await bootstrapProviderSession(page);
    await hideNextDevOverlay(page);
    await mockProviderLookup(page);
    await mockChrome(page);
    await mockProviderInvoices(page, []);

    // Start on another provider page so clicking is a real navigation.
    await gotoPath(page, "/provider/notifications");

    // Page-content hydration anchor.
    await expect(page.getByTestId("notif-toggle-general")).toBeVisible();

    // The global bottom-nav hydrates on its own boundary, independent of
    // the page content, so a click can land before its onClick is wired
    // (the public-bar open race noted in alerts-vs-settings-split.spec.ts).
    // Retry the open, but only click while collapsed so a registered open
    // is never toggled back shut.
    const menuBtn = page.getByTestId("mobile-bottom-nav-menu");
    await expect(menuBtn).toBeVisible();
    const sheet = page.getByRole("dialog", { name: "Menu" });
    await expect(async () => {
      if ((await menuBtn.getAttribute("aria-expanded")) !== "true") {
        await menuBtn.click();
      }
      await expect(sheet).toBeVisible({ timeout: 1000 });
    }).toPass({ timeout: 15000 });

    // Req 10: existing items still present.
    await expect(sheet.getByTestId("pwa-install-menu-row")).toBeVisible();
    await expect(sheet.getByTestId("menu-notification-settings")).toBeVisible();
    await expect(sheet.getByRole("link", { name: "Report an Issue" })).toBeVisible();
    await expect(sheet.getByRole("button", { name: "Logout" })).toBeVisible();

    // Req 1: My Invoices present.
    const myInvoices = sheet.getByTestId("menu-my-invoices");
    await expect(myInvoices).toBeVisible();
    await expect(myInvoices).toContainText("My Invoices");

    // Req 2: navigates to /provider/invoices.
    await myInvoices.click();
    await expect(page).toHaveURL(/\/provider\/invoices$/);
    await expect(page.getByTestId("provider-invoices-page")).toBeVisible();

    diag.assertClean();
  });

  test("empty state renders when there are no invoices", async ({ page, diag }) => {
    await bootstrapProviderSession(page);
    await hideNextDevOverlay(page);
    await mockProviderLookup(page);
    await mockChrome(page);
    await mockProviderInvoices(page, []);

    await gotoPath(page, "/provider/invoices");

    await expect(page.getByTestId("provider-invoices-page")).toBeVisible();
    await expect(page.getByTestId("provider-invoices-empty")).toBeVisible();
    await expect(page.getByTestId("provider-invoices-empty")).toContainText(
      "No invoices yet."
    );

    diag.assertClean();
  });

  test("populated list shows download for generated and status for pending", async ({
    page,
    diag,
  }) => {
    await bootstrapProviderSession(page);
    await hideNextDevOverlay(page);
    await mockProviderLookup(page);
    await mockChrome(page);
    await mockProviderInvoices(page, [GENERATED, PENDING]);

    await gotoPath(page, "/provider/invoices");

    await expect(page.getByTestId("provider-invoices-list")).toBeVisible();
    await expect(page.getByText("KK/FY2026-27/000001")).toBeVisible();
    await expect(page.getByText("KK/FY2026-27/000002")).toBeVisible();

    // Req 6: generated → View (inline, new tab) + Download (attachment).
    const view = page.getByTestId(`provider-invoice-view-${GENERATED.id}`);
    await expect(view).toBeVisible();
    await expect(view).toHaveAttribute(
      "href",
      `/api/provider/invoices/${GENERATED.id}/download?disposition=inline`
    );
    await expect(view).toHaveAttribute("target", "_blank");

    const download = page.getByTestId(`provider-invoice-download-${GENERATED.id}`);
    await expect(download).toBeVisible();
    await expect(download).toHaveAttribute(
      "href",
      `/api/provider/invoices/${GENERATED.id}/download?disposition=attachment`
    );

    // Req 7: pending → status chip, NO download/view anchors.
    await expect(
      page.getByTestId(`provider-invoice-status-${PENDING.id}`)
    ).toBeVisible();
    await expect(
      page.getByTestId(`provider-invoice-download-${PENDING.id}`)
    ).toHaveCount(0);
    await expect(
      page.getByTestId(`provider-invoice-view-${PENDING.id}`)
    ).toHaveCount(0);

    // Total renders as Rs. amount.
    await expect(page.getByText("Rs. 119.18")).toBeVisible();

    diag.assertClean();
  });

  test("list request is session-scoped (no provider_id from client)", async ({
    page,
    diag,
  }) => {
    let seenUrl = "";
    let seenMethod = "";
    let seenBody: string | null = null;
    await bootstrapProviderSession(page);
    await hideNextDevOverlay(page);
    await mockProviderLookup(page);
    await mockChrome(page);
    await mockProviderInvoices(page, [], (url, method, body) => {
      seenUrl = url;
      seenMethod = method;
      seenBody = body;
    });

    await gotoPath(page, "/provider/invoices");
    await expect(page.getByTestId("provider-invoices-empty")).toBeVisible();

    // Req 8: the client never transmits provider_id — neither in the
    // query string nor a body. The server resolves it from the session.
    expect(seenMethod).toBe("GET");
    expect(seenUrl).not.toContain("provider_id");
    expect(seenBody).toBeNull();

    diag.assertClean();
  });
});
