import { expect, type Locator, type Page } from "@playwright/test";

export function getHomeCategoryInput(page: Page): Locator {
  return page.locator('input[type="text"]').first();
}

export async function gotoPath(page: Page, path: string): Promise<void> {
  await page.goto(path, { waitUntil: "domcontentloaded" });
  // Don't wait for networkidle — the app polls/streams continuously and
  // would never reach idle. Waiting for <body> guarantees the document is
  // hydrated enough for subsequent locator queries.
  await page.waitForSelector("body", { state: "attached", timeout: 10_000 });
}

export async function openMobileMenu(page: Page): Promise<void> {
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByLabel("Open menu")).toBeVisible();
  await page.getByLabel("Open menu").click();
}

export async function selectHomeService(page: Page, service: string): Promise<void> {
  const input = getHomeCategoryInput(page);
  await expect(input).toBeVisible();
  await input.click();
  await input.fill(service);
  const suggestion = page.getByRole("button", { name: new RegExp(service, "i") }).first();
  if (await suggestion.isVisible().catch(() => false)) {
    await suggestion.click();
  } else {
    await input.press("Escape");
    await input.press("Tab");
  }
}

export async function selectHomeTime(page: Page, label: string): Promise<void> {
  const chip = page.getByRole("button", { name: new RegExp(`^${label}$`, "i") }).first();
  await expect(chip).toBeVisible();
  await chip.click();
}

export async function selectHomeArea(page: Page, area: string): Promise<void> {
  const areaButton = page.getByRole("button", { name: new RegExp(area, "i") }).first();
  await expect(areaButton).toBeVisible();
  await areaButton.click();
}

export async function fillHomeDetails(page: Page, details: string): Promise<void> {
  const textarea = page.locator('textarea[placeholder*="Describe"]').first();
  await expect(textarea).toBeVisible();
  await textarea.fill(details);
}

export async function submitHomeForm(page: Page): Promise<void> {
  const submitButton = page.getByRole("button", { name: /find providers/i });
  await expect(submitButton).toBeVisible();
  await expect(submitButton).toBeEnabled();
  await submitButton.click();
}

export async function completeHomeRequestFlow(
  page: Page,
  {
    service,
    time,
    area,
    details,
  }: {
    service: string;
    time: string;
    area: string;
    details?: string;
  }
): Promise<void> {
  await selectHomeService(page, service);
  await selectHomeTime(page, time);
  await selectHomeArea(page, area);
  if (details) {
    await fillHomeDetails(page, details);
  }
}
