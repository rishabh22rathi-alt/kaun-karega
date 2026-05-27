/**
 * PWA Phase 1 installability checks.
 *
 * Verifies the things Chrome looks at to decide whether to expose
 * "Install app": manifest is served + well-formed, all referenced
 * icons resolve, and the service worker file is reachable. The
 * <link rel="manifest"> tag + apple-touch-icon + theme-color meta
 * are also asserted so iOS Safari and Android Chrome both get the
 * correct hints.
 *
 * The SW registration itself is gated to production
 * (`process.env.NODE_ENV === "production"`) in
 * web/components/PwaServiceWorkerRegister.tsx — we only assert the
 * /sw.js file is served, not that the browser activates it during
 * this dev-mode test run. A production-build regression test for
 * activation is a v2 task.
 */

import { gotoPath } from "../_support/home";
import { test, expect } from "../_support/test";

test.describe("PWA installability", () => {
  test("manifest is served at /manifest.webmanifest with valid shape", async ({
    page,
    diag,
  }) => {
    const res = await page.request.get("/manifest.webmanifest");
    expect(res.status()).toBe(200);
    const contentType = res.headers()["content-type"] ?? "";
    expect(contentType).toContain("manifest+json");

    const manifest = (await res.json()) as Record<string, unknown>;
    expect(manifest.name).toBe("Kaun Karega");
    expect(manifest.short_name).toBe("Kaun Karega");
    expect(manifest.start_url).toBe("/");
    expect(manifest.scope).toBe("/");
    expect(manifest.display).toBe("standalone");
    expect(manifest.theme_color).toBe("#003d20");
    expect(manifest.background_color).toBe("#ffffff");
    expect(manifest.orientation).toBe("portrait");

    const icons = manifest.icons as Array<{
      src: string;
      sizes: string;
      type: string;
      purpose?: string;
    }>;
    expect(Array.isArray(icons)).toBe(true);
    expect(icons.length).toBeGreaterThanOrEqual(3);
    // Required: at least one maskable icon (Android adaptive icons).
    expect(icons.some((i) => i.purpose === "maskable")).toBe(true);
    // Required: at least one 512x512 icon (Chrome installability gate).
    expect(icons.some((i) => i.sizes === "512x512")).toBe(true);

    diag.assertClean();
  });

  test("all manifest icons resolve with image/png", async ({ page, diag }) => {
    // Keep in sync with web/app/manifest.ts — these are the exact
    // paths the manifest declares so the test verifies every icon
    // Chrome / iOS will fetch is actually served.
    const paths = [
      "/icons/icon-192-v2.png",
      "/icons/icon-512-v2.png",
      "/icons/icon-512-maskable-v2.png",
    ];
    for (const path of paths) {
      const res = await page.request.get(path);
      expect(res.status(), `expected 200 for ${path}`).toBe(200);
      const contentType = res.headers()["content-type"] ?? "";
      expect(contentType, `expected image/png for ${path}`).toContain(
        "image/png"
      );
    }
    diag.assertClean();
  });

  test("<link rel='manifest'> is emitted in <head>", async ({ page, diag }) => {
    await gotoPath(page, "/");
    const manifestLink = page.locator('link[rel="manifest"]');
    await expect(manifestLink).toHaveAttribute(
      "href",
      "/manifest.webmanifest"
    );
    diag.assertClean();
  });

  test("apple-touch-icon link is emitted in <head>", async ({ page, diag }) => {
    await gotoPath(page, "/");
    // Next emits <link rel="apple-touch-icon"> when app/apple-icon.png
    // exists. Count >= 1 to tolerate additional rel-list variants.
    const appleIconLinks = page.locator('link[rel~="apple-touch-icon"]');
    expect(await appleIconLinks.count()).toBeGreaterThan(0);
    diag.assertClean();
  });

  test("theme-color meta is present with brand forest green", async ({
    page,
    diag,
  }) => {
    await gotoPath(page, "/");
    const themeColor = page.locator('meta[name="theme-color"]');
    await expect(themeColor).toHaveAttribute("content", "#003d20");
    diag.assertClean();
  });

  test("/sw.js is served as JavaScript with a fetch handler", async ({
    page,
    diag,
  }) => {
    const res = await page.request.get("/sw.js");
    expect(res.status()).toBe(200);
    const contentType = res.headers()["content-type"] ?? "";
    expect(contentType).toMatch(/javascript/);
    const body = await res.text();
    // Sanity — must register a fetch handler so Chrome's installability
    // gate counts it as "controls page".
    expect(body).toContain("addEventListener");
    expect(body).toContain('"fetch"');
    diag.assertClean();
  });
});
