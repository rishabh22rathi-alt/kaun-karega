import { expect, Page, TestInfo, test } from "@playwright/test";
import { mkdirSync } from "fs";
import path from "path";

const AUDIT_SCREENSHOT_DIR = path.join("test-results", "audit");
const PUBLIC_ROUTES = ["/privacy-policy", "/terms", "/data-deletion"];
const AUTH_OR_REDIRECT_ROUTES = [
  "/dashboard/my-requests",
  "/provider/dashboard",
  "/admin/dashboard",
  "/chat/thread/test-audit?actor=user",
];
const VIEWPORTS = [
  { name: "mobile", width: 390, height: 844 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "desktop", width: 1400, height: 900 },
];
const SEVERE_CONSOLE_PATTERNS = [
  /ReferenceError/i,
  /TypeError/i,
  /Hydration failed/i,
  /Cannot read properties/i,
];

type GotoResult = {
  status: number | null;
  url: string;
  notFound: boolean;
};

async function gotoPath(page: Page, routePath: string, options: { allow404?: boolean } = {}): Promise<GotoResult> {
  const response = await page.goto(routePath, {
    waitUntil: "domcontentloaded",
    timeout: 15_000,
  });

  await page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => undefined);

  const status = response?.status() ?? null;
  const result = {
    status,
    url: page.url(),
    notFound: status === 404,
  };

  if (result.notFound && options.allow404) {
    console.log(`[audit] ${routePath} returned 404; continuing.`);
    return result;
  }

  if (status !== null) {
    expect(status, `${routePath} should not return a server error`).toBeLessThan(500);
  }

  return result;
}

async function assertNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => {
    const doc = document.documentElement;
    const body = document.body;
    return {
      viewportWidth: window.innerWidth,
      documentScrollWidth: doc.scrollWidth,
      bodyScrollWidth: body?.scrollWidth ?? 0,
      maxOverflow: Math.max(doc.scrollWidth - doc.clientWidth, (body?.scrollWidth ?? 0) - window.innerWidth),
    };
  });

  expect(overflow.maxOverflow, `horizontal overflow detected: ${JSON.stringify(overflow)}`).toBeLessThanOrEqual(2);
}

async function safeScreenshot(page: Page, testInfo: TestInfo, name: string) {
  mkdirSync(AUDIT_SCREENSHOT_DIR, { recursive: true });
  const safeName = `${testInfo.titlePath.join("-")}-${name}`
    .toLowerCase()
    .replace(/[^a-z0-9.-]+/g, "-")
    .replace(/(^-|-$)/g, "");

  try {
    await page.screenshot({
      path: path.join(AUDIT_SCREENSHOT_DIR, `${safeName}.png`),
      fullPage: true,
    });
  } catch (error) {
    console.log(`[audit] screenshot skipped for ${name}: ${String(error)}`);
  }
}

async function checkButtonsAndLinks(page: Page) {
  const buttons = page.locator("button:visible");
  const buttonCount = Math.min(await buttons.count(), 50);

  for (let i = 0; i < buttonCount; i += 1) {
    const button = buttons.nth(i);
    const isEnabled = await button.isEnabled();
    const disabledAttribute = await button.getAttribute("disabled");
    expect(isEnabled || disabledAttribute !== null, `visible button ${i} is disabled without disabled attribute`).toBeTruthy();
  }

  const links = page.locator("a:visible");
  const linkCount = Math.min(await links.count(), 50);

  for (let i = 0; i < linkCount; i += 1) {
    const href = await links.nth(i).getAttribute("href");
    expect(href, `visible link ${i} should have href`).toBeTruthy();
  }
}

function collectSevereConsoleErrors(page: Page) {
  const severeErrors: string[] = [];

  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const text = message.text();
    if (SEVERE_CONSOLE_PATTERNS.some((pattern) => pattern.test(text))) {
      severeErrors.push(text);
    }
  });

  page.on("pageerror", (error) => {
    const text = error.message;
    if (SEVERE_CONSOLE_PATTERNS.some((pattern) => pattern.test(text))) {
      severeErrors.push(text);
    }
  });

  return severeErrors;
}

async function pageCanLoadOrRedirect(page: Page, routePath: string, testInfo: TestInfo) {
  const result = await gotoPath(page, routePath, { allow404: true });
  if (result.notFound) return;

  const currentPath = new URL(page.url()).pathname;
  const expectedPath = routePath.split("?")[0];
  const redirectedToLogin = /\/login|\/admin\/login|\/provider\/login/.test(currentPath);
  const loadedTarget = currentPath === expectedPath || currentPath.startsWith(`${expectedPath}/`);

  expect(loadedTarget || redirectedToLogin, `${routePath} should load or redirect to login; landed on ${page.url()}`).toBeTruthy();
  await expect(page.locator("body")).toBeVisible();
  await safeScreenshot(page, testInfo, routePath.replace(/^\//, "") || "home");
}

async function findFirstVisibleEditable(page: Page) {
  const candidates = [
    page.getByPlaceholder(/service|need|category|what|search/i),
    page.locator('input[type="search"]:visible'),
    page.locator('input[type="text"]:visible'),
    page.locator("textarea:visible"),
  ];

  for (const candidate of candidates) {
    const count = await candidate.count();
    for (let i = 0; i < count; i += 1) {
      const field = candidate.nth(i);
      if ((await field.isVisible()) && (await field.isEnabled())) {
        return field;
      }
    }
  }

  return null;
}

test.describe("Full Platform UI Health Audit", () => {
  test("homepage loads, responds within budget, and has sane controls", async ({ page }, testInfo) => {
    const severeErrors = collectSevereConsoleErrors(page);

    await test.step("load homepage", async () => {
      const startedAt = Date.now();
      const result = await gotoPath(page, "/");
      const loadMs = Date.now() - startedAt;

      expect(result.notFound, "homepage must exist").toBeFalsy();
      expect(new URL(page.url()).pathname).toBe("/");

      if (loadMs > 3_000) {
        console.log(`[audit] homepage load was slow: ${loadMs}ms`);
      }
      expect(loadMs, "homepage load should stay below 10 seconds").toBeLessThan(10_000);
    });

    await test.step("basic UI sanity", async () => {
      await expect(page.locator("body")).toBeVisible();
      await checkButtonsAndLinks(page);
      await safeScreenshot(page, testInfo, "homepage");
    });

    expect(severeErrors).toEqual([]);
  });

  for (const viewport of VIEWPORTS) {
    test(`homepage has no horizontal overflow on ${viewport.name}`, async ({ page }, testInfo) => {
      const severeErrors = collectSevereConsoleErrors(page);
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await gotoPath(page, "/");
      await assertNoHorizontalOverflow(page);
      await safeScreenshot(page, testInfo, viewport.name);
      expect(severeErrors).toEqual([]);
    });
  }

  test("mobile hamburger or sidebar control is usable when present", async ({ page }, testInfo) => {
    const severeErrors = collectSevereConsoleErrors(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await gotoPath(page, "/");

    const menuButton = page
      .getByRole("button", { name: /menu|navigation|sidebar|open|toggle/i })
      .first();

    if (await menuButton.isVisible().catch(() => false)) {
      await menuButton.click();
      await page.waitForTimeout(250);
      await checkButtonsAndLinks(page);
    } else {
      console.log("[audit] no mobile hamburger/sidebar button found on homepage; continuing.");
    }

    await assertNoHorizontalOverflow(page);
    await safeScreenshot(page, testInfo, "mobile-menu");
    expect(severeErrors).toEqual([]);
  });

  test("category input accepts typing and suggestions do not crash", async ({ page }, testInfo) => {
    const severeErrors = collectSevereConsoleErrors(page);
    await gotoPath(page, "/");

    const field = await findFirstVisibleEditable(page);
    expect(field, "expected a visible editable service/category field on homepage").not.toBeNull();

    await field!.click();
    await field!.fill("Electrician audit");
    await page.waitForTimeout(500);

    await expect(field!).toHaveValue(/Electrician audit/i);
    await checkButtonsAndLinks(page);
    await safeScreenshot(page, testInfo, "category-suggestions");
    expect(severeErrors).toEqual([]);
  });

  test("area step can be attempted without requiring full submission", async ({ page }, testInfo) => {
    const severeErrors = collectSevereConsoleErrors(page);
    await gotoPath(page, "/");

    const categoryField = await findFirstVisibleEditable(page);
    if (!categoryField) {
      console.log("[audit] category field not found; area attempt skipped.");
      return;
    }

    await categoryField.fill("Electrician");
    await categoryField.press("Tab");
    await page.waitForTimeout(300);

    const areaField = page.getByPlaceholder(/area|location|locality/i).first();
    if (await areaField.isVisible().catch(() => false)) {
      await areaField.fill("Sardarpura");
      await page.waitForTimeout(300);
    } else {
      console.log("[audit] area field is gated by homepage flow; continuing.");
    }

    await checkButtonsAndLinks(page);
    await safeScreenshot(page, testInfo, "area-attempt");
    expect(severeErrors).toEqual([]);
  });

  test("public legal pages load when routes exist", async ({ page }, testInfo) => {
    const severeErrors = collectSevereConsoleErrors(page);

    for (const routePath of PUBLIC_ROUTES) {
      await test.step(routePath, async () => {
        await pageCanLoadOrRedirect(page, routePath, testInfo);
        await checkButtonsAndLinks(page);
        await assertNoHorizontalOverflow(page);
      });
    }

    expect(severeErrors).toEqual([]);
  });

  test("auth-required and chat routes load or redirect cleanly", async ({ page }, testInfo) => {
    const severeErrors = collectSevereConsoleErrors(page);

    for (const routePath of AUTH_OR_REDIRECT_ROUTES) {
      await test.step(routePath, async () => {
        await pageCanLoadOrRedirect(page, routePath, testInfo);
        await checkButtonsAndLinks(page);
        await assertNoHorizontalOverflow(page);
      });
    }

    expect(severeErrors).toEqual([]);
  });
});
