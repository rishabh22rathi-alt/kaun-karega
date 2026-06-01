/**
 * Admin dashboard — GST Invoices tab.
 *
 * Verifies the admin invoice list UI and that it drives the EXISTING
 * generate/download routes. The list + generate endpoints are mocked so
 * the tests are hermetic (no DB / PDF engine), mirroring
 * admin-mobile-bottom-nav.spec.ts. The 401 test hits the real route with
 * no admin session (requireAdminSession rejects before any DB access).
 */

import { bootstrapAdminSession } from "../_support/auth";
import { gotoPath } from "../_support/home";
import { mockAdminDashboardApis } from "../_support/scenarios";
import { jsonOk, mockJson } from "../_support/routes";
import { test, expect } from "../_support/test";

const DESKTOP_VIEWPORT = { width: 1280, height: 900 };

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

// Admin chrome endpoints not covered by mockAdminDashboardApis (left
// unmocked they 404 and trip diag.assertClean / the dev overlay).
async function mockAdminChrome(
  page: import("@playwright/test").Page
): Promise<void> {
  await hideNextDevOverlay(page);
  await mockJson(page, "**/api/admin/notifications", {
    status: 200,
    body: { success: true, unreadCount: 0, notifications: [] },
  });
  await mockJson(page, "**/api/admin/unread-summary", jsonOk({ unread: {} }));
  await mockJson(page, "**/api/admin-verify", {
    status: 200,
    body: { ok: true, admin: { name: "QA Admin", role: "admin", permissions: [] } },
  });
  await mockJson(
    page,
    "**/api/admin/provider-stats",
    jsonOk({ data: { total: 0, verified: 0, underReview: 0 } })
  );
  await mockJson(
    page,
    "**/api/admin/notification-preferences",
    jsonOk({ preferences: {} })
  );
  await mockJson(page, "**/api/announcements/active", jsonOk({ announcement: null }));
}

type InvoicePayload = Record<string, unknown>;

const GENERATED: InvoicePayload = {
  id: 1,
  invoice_number: "KK/FY2026-27/000001",
  provider_id: "PR-3131",
  buyer_name: "QA Provider",
  buyer_phone: "9999999902",
  plan_code: "all_jodhpur",
  invoice_date: "2026-06-01",
  issued_at: "2026-06-01T10:00:00.000Z",
  taxable_value_paise: 10100,
  total_tax_paise: 1818,
  total_paise: 11918,
  pdf_status: "generated",
  pdf_last_error: null,
  pdf_storage_path: "FY2026-27/KK-FY2026-27-000001.pdf",
  pdf_generated_at: "2026-06-01T10:05:00.000Z",
  pdf_attempts: 1,
};

const PENDING: InvoicePayload = {
  id: 2,
  invoice_number: "KK/FY2026-27/000002",
  provider_id: "PR-3200",
  buyer_name: "Pending Provider",
  buyer_phone: "9999999903",
  plan_code: "regions_5",
  invoice_date: "2026-06-02",
  issued_at: "2026-06-02T10:00:00.000Z",
  taxable_value_paise: 3100,
  total_tax_paise: 558,
  total_paise: 3658,
  pdf_status: "pending",
  pdf_last_error: null,
  pdf_storage_path: null,
  pdf_generated_at: null,
  pdf_attempts: 0,
};

const FAILED: InvoicePayload = {
  id: 3,
  invoice_number: "KK/FY2026-27/000003",
  provider_id: "PR-3300",
  buyer_name: "Failed Provider",
  buyer_phone: "9999999904",
  plan_code: "regions_5",
  invoice_date: "2026-06-03",
  issued_at: "2026-06-03T10:00:00.000Z",
  taxable_value_paise: 3100,
  total_tax_paise: 558,
  total_paise: 3658,
  pdf_status: "failed",
  pdf_last_error: "RENDER_FAILED: boom",
  pdf_storage_path: null,
  pdf_generated_at: null,
  pdf_attempts: 2,
};

async function mockInvoiceList(
  page: import("@playwright/test").Page,
  invoices: InvoicePayload[],
  onCall?: () => void
): Promise<void> {
  await mockJson(page, /\/api\/admin\/invoices(\?.*)?$/, () => {
    onCall?.();
    return jsonOk({ invoices, fetchedAt: "2026-06-04T12:00:00.000Z" });
  });
}

async function mockInvoiceGenerate(
  page: import("@playwright/test").Page,
  onCall?: (body: string | null) => void,
  response: Record<string, unknown> = {
    enabled: true,
    rendered: 1,
    skipped: 0,
    failed: 0,
    failures: [],
  }
): Promise<void> {
  await mockJson(page, "**/api/admin/invoices/pdf", ({ request }) => {
    onCall?.(request.postData());
    return jsonOk(response);
  });
}

test.describe("Admin GST Invoices tab", () => {
  test.use({ viewport: DESKTOP_VIEWPORT });

  test("?tab=invoices opens the tab and renders invoice rows", async ({
    page,
    diag,
  }) => {
    await bootstrapAdminSession(page);
    await mockAdminChrome(page);
    await mockAdminDashboardApis(page);
    await mockInvoiceList(page, [GENERATED, PENDING, FAILED]);
    await mockInvoiceGenerate(page);

    await gotoPath(page, "/admin/dashboard?tab=invoices");

    // Req 1: deep-link opens the accordion body.
    await expect(page.getByTestId("invoices-tab-body")).toBeVisible();
    // Req 2: rows render from the API.
    await expect(page.getByTestId("invoices-list")).toBeVisible();
    await expect(page.getByTestId("invoice-row-1")).toBeVisible();
    await expect(page.getByText("KK/FY2026-27/000001")).toBeVisible();
    await expect(page.getByText("Rs. 119.18")).toBeVisible();

    diag.assertClean();
  });

  test("empty state renders when there are no invoices", async ({ page, diag }) => {
    await bootstrapAdminSession(page);
    await mockAdminChrome(page);
    await mockAdminDashboardApis(page);
    await mockInvoiceList(page, []);
    await mockInvoiceGenerate(page);

    await gotoPath(page, "/admin/dashboard?tab=invoices");

    await expect(page.getByTestId("invoices-empty")).toBeVisible();
    await expect(page.getByTestId("invoices-empty")).toContainText("No invoices yet.");

    diag.assertClean();
  });

  test("generated row shows Download, pending shows Generate, failed shows error + Regenerate", async ({
    page,
    diag,
  }) => {
    await bootstrapAdminSession(page);
    await mockAdminChrome(page);
    await mockAdminDashboardApis(page);
    await mockInvoiceList(page, [GENERATED, PENDING, FAILED]);
    await mockInvoiceGenerate(page);

    await gotoPath(page, "/admin/dashboard?tab=invoices");
    await expect(page.getByTestId("invoices-list")).toBeVisible();

    // Req 4: generated → Download with correct href.
    const download = page.getByTestId("invoice-download-1");
    await expect(download).toBeVisible();
    await expect(download).toHaveAttribute(
      "href",
      "/api/admin/invoices/1/download"
    );

    // Req 5: pending → Generate PDF button, no download anchor.
    await expect(page.getByTestId("invoice-generate-2")).toHaveText(/Generate PDF/);
    await expect(page.getByTestId("invoice-download-2")).toHaveCount(0);

    // Req 6: failed → error text + Regenerate PDF.
    await expect(page.getByTestId("invoice-error-3")).toContainText(
      "RENDER_FAILED: boom"
    );
    await expect(page.getByTestId("invoice-generate-3")).toHaveText(/Regenerate PDF/);

    diag.assertClean();
  });

  test("per-row Generate POSTs { invoice_id }", async ({ page, diag }) => {
    let body: string | null = null;
    await bootstrapAdminSession(page);
    await mockAdminChrome(page);
    await mockAdminDashboardApis(page);
    await mockInvoiceList(page, [PENDING]);
    await mockInvoiceGenerate(page, (b) => {
      body = b;
    });

    await gotoPath(page, "/admin/dashboard?tab=invoices");
    await expect(page.getByTestId("invoices-list")).toBeVisible();

    page.on("dialog", (d) => void d.accept());
    await page.getByTestId("invoice-generate-2").click();

    await expect.poll(() => body).not.toBeNull();
    const parsed = JSON.parse(body ?? "{}") as { invoice_id?: number };
    expect(parsed.invoice_id).toBe(2);

    diag.assertClean();
  });

  test("shows success message when a PDF is rendered", async ({ page, diag }) => {
    await bootstrapAdminSession(page);
    await mockAdminChrome(page);
    await mockAdminDashboardApis(page);
    await mockInvoiceList(page, [PENDING]);
    await mockInvoiceGenerate(page, undefined, {
      enabled: true,
      rendered: 1,
      skipped: 0,
      failed: 0,
      failures: [],
    });

    await gotoPath(page, "/admin/dashboard?tab=invoices");
    await expect(page.getByTestId("invoices-list")).toBeVisible();

    page.on("dialog", (d) => void d.accept());
    await page.getByTestId("invoice-generate-2").click();

    const msg = page.getByTestId("invoices-action-message");
    await expect(msg).toBeVisible();
    await expect(msg).toContainText("PDF generated successfully.");
    await expect(msg).toHaveAttribute("data-kind", "success");

    diag.assertClean();
  });

  test("shows disabled-flag message when server returns enabled:false", async ({
    page,
    diag,
  }) => {
    await bootstrapAdminSession(page);
    await mockAdminChrome(page);
    await mockAdminDashboardApis(page);
    await mockInvoiceList(page, [PENDING]);
    await mockInvoiceGenerate(page, undefined, {
      enabled: false,
      rendered: 0,
      skipped: 0,
      failed: 0,
      failures: [],
    });

    await gotoPath(page, "/admin/dashboard?tab=invoices");
    await expect(page.getByTestId("invoices-list")).toBeVisible();

    page.on("dialog", (d) => void d.accept());
    await page.getByTestId("invoice-generate-2").click();

    const msg = page.getByTestId("invoices-action-message");
    await expect(msg).toBeVisible();
    await expect(msg).toContainText(
      "Invoice PDF generation is disabled by server flag."
    );
    await expect(msg).toHaveAttribute("data-kind", "error");

    diag.assertClean();
  });

  test("shows failure details when generation fails", async ({ page, diag }) => {
    await bootstrapAdminSession(page);
    await mockAdminChrome(page);
    await mockAdminDashboardApis(page);
    await mockInvoiceList(page, [PENDING]);
    await mockInvoiceGenerate(page, undefined, {
      enabled: true,
      rendered: 0,
      skipped: 0,
      failed: 1,
      failures: [{ error_code: "RENDER_FAILED", error_message: "boom" }],
    });

    await gotoPath(page, "/admin/dashboard?tab=invoices");
    await expect(page.getByTestId("invoices-list")).toBeVisible();

    page.on("dialog", (d) => void d.accept());
    await page.getByTestId("invoice-generate-2").click();

    const msg = page.getByTestId("invoices-action-message");
    await expect(msg).toBeVisible();
    await expect(msg).toContainText("PDF generation failed");
    await expect(msg).toContainText("RENDER_FAILED");
    await expect(msg).toHaveAttribute("data-kind", "error");

    diag.assertClean();
  });

  test("bulk Generate pending PDFs POSTs an empty body", async ({ page, diag }) => {
    let body: string | null = null;
    await bootstrapAdminSession(page);
    await mockAdminChrome(page);
    await mockAdminDashboardApis(page);
    await mockInvoiceList(page, [PENDING]);
    await mockInvoiceGenerate(page, (b) => {
      body = b;
    });

    await gotoPath(page, "/admin/dashboard?tab=invoices");
    await expect(page.getByTestId("invoices-bulk-generate-button")).toBeVisible();

    page.on("dialog", (d) => void d.accept());
    await page.getByTestId("invoices-bulk-generate-button").click();

    await expect.poll(() => body).not.toBeNull();
    const parsed = JSON.parse(body ?? "null") as { invoice_id?: number };
    expect(parsed.invoice_id).toBeUndefined();

    diag.assertClean();
  });

  test("Refresh re-fetches the invoice list", async ({ page, diag }) => {
    let calls = 0;
    await bootstrapAdminSession(page);
    await mockAdminChrome(page);
    await mockAdminDashboardApis(page);
    await mockInvoiceList(page, [GENERATED], () => {
      calls += 1;
    });
    await mockInvoiceGenerate(page);

    await gotoPath(page, "/admin/dashboard?tab=invoices");
    await expect(page.getByTestId("invoices-list")).toBeVisible();
    await expect.poll(() => calls).toBeGreaterThanOrEqual(1);

    const before = calls;
    await page.getByTestId("invoices-refresh-button").click();
    await expect.poll(() => calls).toBeGreaterThan(before);

    diag.assertClean();
  });

  test("existing dashboard tabs still render alongside Invoices", async ({
    page,
    diag,
  }) => {
    await bootstrapAdminSession(page);
    await mockAdminChrome(page);
    await mockAdminDashboardApis(page);
    await mockInvoiceList(page, []);
    await mockInvoiceGenerate(page);

    await gotoPath(page, "/admin/dashboard?tab=invoices");

    await expect(page.getByTestId("invoices-tab-toggle")).toBeVisible();
    await expect(page.getByTestId("scheduled-plans-tab-toggle")).toBeVisible();

    diag.assertClean();
  });

  test("admin invoice API returns 401 without an admin session", async ({
    page,
  }) => {
    // No bootstrapAdminSession, no list mock → hits the real route, which
    // rejects in requireAdminSession before any DB access.
    const res = await page.request.get("/api/admin/invoices");
    expect(res.status()).toBe(401);
  });
});
