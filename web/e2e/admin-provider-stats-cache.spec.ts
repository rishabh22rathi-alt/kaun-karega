/**
 * Verification — Admin Providers tab snapshot-cache request behaviour.
 *
 * Background:
 *   A regression report flagged that opening the Providers tab fires
 *   TWO `GET /api/admin/provider-stats` calls in rapid succession, even
 *   when Auto refresh is set to "Manual only". The duplicate was caused
 *   by a redundant `useEffect` in ProvidersTab that bumped
 *   `statsRefreshKey` on `isOpen → true`, on top of the read-through
 *   hook's own enable-driven fetch. This spec locks in the fixed
 *   behaviour:
 *
 *     • Open tab once  → exactly 1 cache-read GET, never `?refresh=1`.
 *     • Close/open ×3  → exactly 3 GETs total, never `?refresh=1`.
 *     • Manual + 10 s  → no auto-refresh fires.
 *     • Refresh button → exactly 1 `?refresh=1` GET fires per click.
 *
 * Mocking posture mirrors the other admin spec files in this folder
 * (e.g. admin-users-tab.spec.ts): bootstrap an admin session, stub
 * the cache-aware endpoint with a stable JSON payload that includes
 * a `cache` block, then assert against the network traffic.
 */

import { bootstrapAdminSession } from "./_support/auth";
import { gotoPath } from "./_support/home";
import { mockAdminDashboardApis } from "./_support/scenarios";
import { mockJson } from "./_support/routes";
import { test, expect } from "./_support/test";

const PROVIDER_STATS_URL_RE = /\/api\/admin\/provider-stats(\?|$)/;

// Fake "cached 27 minutes ago, 6-hour server TTL" snapshot — matches
// the scenario that surfaced the bug.
function buildCachedPayload(forceLabel: "cached" | "fresh") {
  const computedAtMs = Date.now() - 27 * 60 * 1000;
  const expiresAtMs = computedAtMs + 6 * 60 * 60 * 1000;
  return {
    ok: true,
    data: { total: 5277, verified: 5, underReview: 0 },
    cache: {
      cached: forceLabel === "cached",
      last_updated_at: new Date(computedAtMs).toISOString(),
      expires_at: new Date(expiresAtMs).toISOString(),
      ttl_seconds: 6 * 60 * 60,
      refresh_available: true,
      computed_by: forceLabel === "fresh" ? "9999999904" : null,
      computed_duration_ms: forceLabel === "fresh" ? 5400 : 200,
    },
  };
}

// Dev-server cold-compile (Next.js Turbopack) of /admin/dashboard +
// every nested route stub the dashboard touches can comfortably
// exceed the 60 s default on a first run. Bump per-test timeout so
// the first cold compile doesn't dominate the result; subsequent
// runs against a warm server complete in seconds.
test.describe.configure({ timeout: 180_000 });

test.describe("Admin Providers tab — snapshot-cache request behaviour", () => {
  test.beforeEach(async ({ page }) => {
    await bootstrapAdminSession(page);
    // Pre-set the interval preference BEFORE any page navigation so
    // the dropdown's lazy initializer reads it on first mount.
    await page.addInitScript(() => {
      window.localStorage.setItem(
        "kk_admin_cache_interval_provider_stats",
        "manual"
      );
    });
    // Stub every other admin endpoint so the dashboard renders cleanly.
    await mockAdminDashboardApis(page);
    // Stub provider-stats with a deterministic cached payload. Manual
    // refresh path (`?refresh=1`) gets the "fresh" variant so we can
    // tell the two response codes apart.
    await mockJson(page, "**/api/admin/provider-stats**", ({ request }) => {
      const url = new URL(request.url());
      const forced = url.searchParams.get("refresh") === "1";
      return { body: buildCachedPayload(forced ? "fresh" : "cached") };
    });
  });

  test("opening Providers tab fires exactly one cache-read GET; no refresh=1", async ({
    page,
  }) => {
    const calls: string[] = [];
    page.on("request", (req) => {
      const u = req.url();
      if (PROVIDER_STATS_URL_RE.test(u)) calls.push(u);
    });

    await gotoPath(page, "/admin/dashboard");
    const header = page.locator(
      'button[aria-controls="providers-tab-body"]'
    );
    await header.waitFor({ state: "visible" });
    // Register the response wait BEFORE clicking — the route mock
    // resolves synchronously, so a wait registered after the click
    // misses the response and times out.
    const responsePromise = page.waitForResponse(
      (r) => PROVIDER_STATS_URL_RE.test(r.url()) && r.ok()
    );
    await header.click();
    await responsePromise;
    // Give any duplicate effects a chance to fire before asserting.
    await page.waitForTimeout(750);

    const refreshCalls = calls.filter((u) => u.includes("refresh=1"));
    expect(refreshCalls).toEqual([]);
    expect(calls.length).toBe(1);
  });

  test("closing and reopening 3 times fires 3 GETs total, never refresh=1", async ({
    page,
  }) => {
    const calls: string[] = [];
    page.on("request", (req) => {
      const u = req.url();
      if (PROVIDER_STATS_URL_RE.test(u)) calls.push(u);
    });

    await gotoPath(page, "/admin/dashboard");
    const header = page.locator(
      'button[aria-controls="providers-tab-body"]'
    );

    await header.waitFor({ state: "visible" });
    for (let i = 0; i < 3; i++) {
      // Register response wait BEFORE click — same reason as above.
      const responsePromise = page.waitForResponse((r) =>
        PROVIDER_STATS_URL_RE.test(r.url())
      );
      await header.click(); // open
      await responsePromise;
      await header.click(); // close
      await page.waitForTimeout(200);
    }
    await page.waitForTimeout(500);

    const refreshCalls = calls.filter((u) => u.includes("refresh=1"));
    expect(refreshCalls).toEqual([]);
    expect(calls.length).toBe(3);
  });

  test("interval=Manual + 10 s wait does NOT auto-refresh", async ({
    page,
  }) => {
    await gotoPath(page, "/admin/dashboard");
    const header = page.locator(
      'button[aria-controls="providers-tab-body"]'
    );
    await header.waitFor({ state: "visible" });
    const responsePromise = page.waitForResponse((r) =>
      PROVIDER_STATS_URL_RE.test(r.url())
    );
    await header.click();
    await responsePromise;

    const refreshCalls: string[] = [];
    page.on("request", (req) => {
      if (req.url().includes("/api/admin/provider-stats?refresh=1")) {
        refreshCalls.push(req.url());
      }
    });
    await page.waitForTimeout(10_000);
    expect(refreshCalls).toEqual([]);
  });

  test("Refresh button fires exactly one ?refresh=1 GET", async ({ page }) => {
    await gotoPath(page, "/admin/dashboard");
    const header = page.locator(
      'button[aria-controls="providers-tab-body"]'
    );
    await header.waitFor({ state: "visible" });
    const initialResponse = page.waitForResponse((r) =>
      PROVIDER_STATS_URL_RE.test(r.url())
    );
    await header.click();
    await initialResponse;

    const refreshCalls: string[] = [];
    page.on("request", (req) => {
      if (req.url().includes("/api/admin/provider-stats?refresh=1")) {
        refreshCalls.push(req.url());
      }
    });

    const refreshResponse = page.waitForResponse(
      (r) =>
        r.url().includes("/api/admin/provider-stats?refresh=1") && r.ok()
    );
    await page
      .locator("#providers-tab-body")
      .getByRole("button", { name: /^Refresh$/i })
      .click();
    await refreshResponse;
    await page.waitForTimeout(300);

    expect(refreshCalls.length).toBe(1);
  });
});
