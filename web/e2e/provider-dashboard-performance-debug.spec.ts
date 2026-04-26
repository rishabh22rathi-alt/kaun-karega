/**
 * Provider Dashboard Performance Debug
 *
 * Captures load timing for /provider/dashboard with a real Supabase-seeded
 * provider session. Records every network request, classifies its source,
 * and times each major UI section becoming visible.
 *
 * Read this test's console output to answer:
 *   - which API calls fire on dashboard load
 *   - their statuses + per-request elapsed time
 *   - which calls go to Apps Script vs Next API vs direct Supabase
 *   - section-by-section render timing (sidebar / profile header / Services /
 *     Area Coverage / Analytics / City Demand / network-idle)
 *
 * No production code is modified. Internal phase timings inside
 * /api/provider/dashboard-profile are emitted by perfLog() to dev-server
 * stdout (when NODE_ENV !== "production"). To attribute time inside that
 * single Next-API call, watch the `npm run dev` terminal alongside this test.
 */

import { mkdir } from "node:fs/promises";

import { createClient } from "@supabase/supabase-js";
import { config as loadEnv } from "dotenv";
import type { Page, Request } from "@playwright/test";

import { bootstrapProviderSession } from "./_support/auth";
import { QA_AREA, QA_CATEGORY } from "./_support/data";
import { test } from "./_support/test";

loadEnv({ path: ".env.local", quiet: true });

const seedSupabase = createClient(
  process.env.SUPABASE_URL || "",
  process.env.SUPABASE_SERVICE_ROLE_KEY || "",
  { auth: { persistSession: false } }
);

const DEBUG_DIR = "test-results/provider-dashboard-perf";
const SEEDED_PROVIDER_PHONE = "9888800003";
const SEEDED_PROVIDER_ID = "ZZ-DASHBOARD-PERF-0001";
const SEEDED_PROVIDER_NAME = "ZZ Dashboard Perf Provider";
// Non-ZZ provider id used purely to demonstrate the provider_metrics TTL
// cache hit path (which is bypassed for ZZ-prefixed test providers). Seeded
// and torn down within the test body — never referenced outside this file.
const CACHE_DEMO_PROVIDER_PHONE = "9888800004";
const CACHE_DEMO_PROVIDER_ID = "PR-DASHBOARD-PERF-CACHE-0001";
const CACHE_DEMO_PROVIDER_NAME = "ZZ Dashboard Perf Cache Demo Provider";

type NetworkSource =
  | "next-api-supabase-backed"
  | "next-api-other"
  | "apps-script"
  | "supabase-direct"
  | "static-asset"
  | "external"
  | "unknown";

type NetworkLog = {
  index: number;
  startedAtMs: number;
  finishedAtMs: number;
  durationMs: number;
  method: string;
  url: string;
  status?: number;
  failed?: string;
  source: NetworkSource;
  trackedKey?: string;
};

// Next-API endpoints we expect the dashboard to fan out to. All are
// Supabase-backed today (see audit). Any URL match here is classified as
// "next-api-supabase-backed" — but watch /api/kk specifically: unrecognized
// `action` values in /api/kk fall through to a GAS proxy at the bottom of the
// route, so an /api/kk call is "supabase-backed" only conditionally.
const TRACKED_NEXT_APIS = [
  "/api/provider/dashboard-profile",
  "/api/kk",
  "/api/areas",
  "/api/categories",
  "/api/find-provider",
  "/api/process-task-notifications",
];

function classifyNetworkSource(url: string): NetworkSource {
  if (/script\.google\.com|googleusercontent\.com\/macros\//.test(url)) {
    return "apps-script";
  }
  const supaHost = (process.env.SUPABASE_URL || "")
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "");
  if (supaHost && url.includes(supaHost)) return "supabase-direct";
  if (/\/_next\/static|\.(?:png|jpg|jpeg|svg|webp|woff2?|css|js|map|ico)(?:\?|$)/.test(url)) {
    return "static-asset";
  }
  if (TRACKED_NEXT_APIS.some((p) => url.includes(p))) {
    return "next-api-supabase-backed";
  }
  if (/\/api\//.test(url)) return "next-api-other";
  if (/^https?:\/\/(?:127\.0\.0\.1|localhost)/.test(url)) return "next-api-other";
  return "external";
}

function classifyTrackedKey(url: string): string | undefined {
  for (const p of TRACKED_NEXT_APIS) {
    if (url.includes(p)) return p;
  }
  if (/script\.google\.com/.test(url)) return "apps-script";
  return undefined;
}

async function seedProvider(): Promise<void> {
  await cleanupSeededProvider();

  const { error: providerError } = await seedSupabase.from("providers").insert({
    provider_id: SEEDED_PROVIDER_ID,
    full_name: SEEDED_PROVIDER_NAME,
    phone: SEEDED_PROVIDER_PHONE,
    status: "active",
    verified: "yes",
  });
  if (providerError) throw new Error(`provider seed failed: ${providerError.message}`);

  const { error: servicesError } = await seedSupabase.from("provider_services").insert({
    provider_id: SEEDED_PROVIDER_ID,
    category: QA_CATEGORY,
  });
  if (servicesError) throw new Error(`provider_services seed failed: ${servicesError.message}`);

  const { error: areasError } = await seedSupabase.from("provider_areas").insert({
    provider_id: SEEDED_PROVIDER_ID,
    area: QA_AREA,
  });
  if (areasError) throw new Error(`provider_areas seed failed: ${areasError.message}`);
}

async function cleanupSeededProvider(): Promise<void> {
  await seedSupabase.from("provider_services").delete().eq("provider_id", SEEDED_PROVIDER_ID);
  await seedSupabase.from("provider_areas").delete().eq("provider_id", SEEDED_PROVIDER_ID);
  await seedSupabase.from("providers").delete().eq("provider_id", SEEDED_PROVIDER_ID);
}

async function bootstrapAndClear(page: Page, phone: string): Promise<void> {
  await page.context().clearCookies();
  await page.goto("about:blank");
  await bootstrapProviderSession(page, phone);
}

type SectionTiming = { label: string; elapsedMs: number | null; error?: string };

async function timeUntilVisible(
  page: Page,
  label: string,
  buildLocator: () => ReturnType<Page["locator"]>,
  startMs: number,
  timeoutMs = 30_000
): Promise<SectionTiming> {
  try {
    await buildLocator().first().waitFor({ state: "visible", timeout: timeoutMs });
    return { label, elapsedMs: Date.now() - startMs };
  } catch (err) {
    return {
      label,
      elapsedMs: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

test.describe("Provider Dashboard performance debug", () => {
  test.use({ baseURL: "http://127.0.0.1:3000" });

  test("captures dashboard load timings and network call attribution", async ({
    page,
  }) => {
    test.setTimeout(120_000);

    await mkdir(DEBUG_DIR, { recursive: true });

    let counter = 0;
    const requestStarts = new Map<Request, number>();
    const networkLogs: NetworkLog[] = [];

    page.on("request", (request) => {
      requestStarts.set(request, Date.now());
    });

    page.on("requestfinished", async (request) => {
      const startedAt = requestStarts.get(request) || Date.now();
      const finishedAt = Date.now();
      let status: number | undefined;
      try {
        const response = await request.response();
        status = response?.status();
      } catch {
        // response may already be discarded; status remains undefined
      }
      const url = request.url();
      networkLogs.push({
        index: ++counter,
        startedAtMs: startedAt,
        finishedAtMs: finishedAt,
        durationMs: finishedAt - startedAt,
        method: request.method(),
        url,
        status,
        source: classifyNetworkSource(url),
        trackedKey: classifyTrackedKey(url),
      });
    });

    page.on("requestfailed", (request) => {
      const startedAt = requestStarts.get(request) || Date.now();
      const finishedAt = Date.now();
      const url = request.url();
      networkLogs.push({
        index: ++counter,
        startedAtMs: startedAt,
        finishedAtMs: finishedAt,
        durationMs: finishedAt - startedAt,
        method: request.method(),
        url,
        failed: request.failure()?.errorText || "unknown failure",
        source: classifyNetworkSource(url),
        trackedKey: classifyTrackedKey(url),
      });
    });

    try {
      await seedProvider();
      await bootstrapAndClear(page, SEEDED_PROVIDER_PHONE);

      const navStart = Date.now();
      await page.goto("/provider/dashboard", { waitUntil: "domcontentloaded" });
      const domContentLoadedMs = Date.now() - navStart;
      console.log(`[dashboard-perf] DOMContentLoaded after ${domContentLoadedMs}ms`);

      // Section visibility — record each section as it becomes visible. Run
      // sequentially so the first marker (sidebar) doesn't suppress the
      // page-level layout race conditions of the later ones.
      const sectionTimings: SectionTiming[] = [];
      sectionTimings.push(
        await timeUntilVisible(
          page,
          "sidebar-aside",
          () => page.locator("aside"),
          navStart,
          15_000
        )
      );
      sectionTimings.push(
        await timeUntilVisible(
          page,
          "profile-header (Provider Intelligence Dashboard)",
          () => page.getByText("Provider Intelligence Dashboard"),
          navStart,
          25_000
        )
      );
      sectionTimings.push(
        await timeUntilVisible(
          page,
          "services-card",
          () => page.getByText(/^Services \(/),
          navStart,
          25_000
        )
      );
      sectionTimings.push(
        await timeUntilVisible(
          page,
          "area-coverage-card",
          () => page.getByText("Area Coverage"),
          navStart,
          25_000
        )
      );
      sectionTimings.push(
        await timeUntilVisible(
          page,
          "analytics-stats (Requests In Your Services)",
          () => page.getByText("Requests In Your Services"),
          navStart,
          25_000
        )
      );
      sectionTimings.push(
        await timeUntilVisible(
          page,
          "city-demand-section",
          () => page.getByText("City Demand by Service Category"),
          navStart,
          25_000
        )
      );

      let networkIdleMs: number | null = null;
      try {
        await page.waitForLoadState("networkidle", { timeout: 30_000 });
        networkIdleMs = Date.now() - navStart;
      } catch (err) {
        console.log(
          `[dashboard-perf] networkidle wait timed out: ${
            err instanceof Error ? err.message : String(err)
          }`
        );
      }

      // Hit the debug endpoint twice in quick succession so we can observe
      // the provider_metrics cache hit/miss signal across both requests.
      // NOTE: the seeded provider is ZZ-prefixed, which intentionally
      // bypasses the in-process city-analytics caches AND the new
      // provider_metrics cache (test isolation — ZZ providers must always
      // observe their own writes). For ZZ providers, both calls report
      // provider_metrics_cache_hit=0. To verify a real cache hit, hit the
      // endpoint twice within 60s using a non-ZZ provider session.
      const debugCallTimings: Array<{
        index: number;
        requestRoundTripMs: number | null;
        requestStatus: number | null;
        xDebugTimingsHeader: Record<string, number> | null;
      }> = [];
      for (const callIndex of [1, 2]) {
        let debugTimings: Record<string, number> | null = null;
        let debugRequestMs: number | null = null;
        let debugStatus: number | null = null;
        try {
          const debugStart = Date.now();
          const debugResponse = await page.request.get(
            "/api/provider/dashboard-profile?debugTiming=1",
            { failOnStatusCode: false }
          );
          debugRequestMs = Date.now() - debugStart;
          debugStatus = debugResponse.status();
          const headerValue = debugResponse.headers()["x-debug-timings"];
          if (headerValue) {
            try {
              debugTimings = JSON.parse(headerValue);
            } catch {
              debugTimings = null;
            }
          }
        } catch (err) {
          console.log(
            `[dashboard-perf] debugTiming request ${callIndex} failed: ${
              err instanceof Error ? err.message : String(err)
            }`
          );
        }
        debugCallTimings.push({
          index: callIndex,
          requestRoundTripMs: debugRequestMs,
          requestStatus: debugStatus,
          xDebugTimingsHeader: debugTimings,
        });
      }
      console.log(
        `[dashboard-perf] ─── DEBUG TIMING (debugTiming=1, x2 — ZZ test provider, cache bypassed) ───\n${JSON.stringify(
          debugCallTimings,
          null,
          2
        )}`
      );

      // Cache-hit demonstration: seed a temporary non-ZZ provider whose
      // provider_id does NOT trigger the bypass, then issue two debug
      // calls back-to-back. The second call should report
      // provider_metrics_cache_hit=1 and complete materially faster than
      // the first. Cleanup is done in finally, alongside the ZZ provider.
      const cacheDemoCalls: Array<{
        index: number;
        requestRoundTripMs: number;
        requestStatus: number;
        cacheHit: number | null;
        providerMetricsMs: number | null;
      }> = [];
      try {
        // Defensive cleanup in case a prior failed run left orphans.
        await seedSupabase
          .from("provider_services")
          .delete()
          .eq("provider_id", CACHE_DEMO_PROVIDER_ID);
        await seedSupabase
          .from("provider_areas")
          .delete()
          .eq("provider_id", CACHE_DEMO_PROVIDER_ID);
        await seedSupabase
          .from("providers")
          .delete()
          .eq("provider_id", CACHE_DEMO_PROVIDER_ID);

        await seedSupabase.from("providers").insert({
          provider_id: CACHE_DEMO_PROVIDER_ID,
          full_name: CACHE_DEMO_PROVIDER_NAME,
          phone: CACHE_DEMO_PROVIDER_PHONE,
          status: "active",
          verified: "yes",
        });
        await seedSupabase.from("provider_services").insert({
          provider_id: CACHE_DEMO_PROVIDER_ID,
          category: QA_CATEGORY,
        });
        await seedSupabase.from("provider_areas").insert({
          provider_id: CACHE_DEMO_PROVIDER_ID,
          area: QA_AREA,
        });

        await bootstrapAndClear(page, CACHE_DEMO_PROVIDER_PHONE);

        for (const callIndex of [1, 2]) {
          const start = Date.now();
          const res = await page.request.get(
            "/api/provider/dashboard-profile?debugTiming=1",
            { failOnStatusCode: false }
          );
          const elapsed = Date.now() - start;
          let cacheHit: number | null = null;
          let metricsMs: number | null = null;
          const headerValue = res.headers()["x-debug-timings"];
          if (headerValue) {
            try {
              const parsed = JSON.parse(headerValue) as Record<string, number>;
              cacheHit = parsed["provider_metrics_cache_hit"] ?? null;
              metricsMs = parsed["provider_metrics"] ?? null;
            } catch {
              // ignore
            }
          }
          cacheDemoCalls.push({
            index: callIndex,
            requestRoundTripMs: elapsed,
            requestStatus: res.status(),
            cacheHit,
            providerMetricsMs: metricsMs,
          });
        }
      } finally {
        await seedSupabase
          .from("provider_services")
          .delete()
          .eq("provider_id", CACHE_DEMO_PROVIDER_ID);
        await seedSupabase
          .from("provider_areas")
          .delete()
          .eq("provider_id", CACHE_DEMO_PROVIDER_ID);
        await seedSupabase
          .from("providers")
          .delete()
          .eq("provider_id", CACHE_DEMO_PROVIDER_ID);
      }
      console.log(
        `[dashboard-perf] ─── CACHE-HIT DEMO (non-ZZ provider, cache active) ───\n${JSON.stringify(
          cacheDemoCalls,
          null,
          2
        )}`
      );

      // Visual reference. Lives under test-results/ which is git-ignored.
      await page.screenshot({
        path: `${DEBUG_DIR}/dashboard.png`,
        fullPage: true,
      });

      // ── Reports ────────────────────────────────────────────────────────────

      const trackedCalls = networkLogs
        .filter((entry) => entry.trackedKey)
        .sort((a, b) => b.durationMs - a.durationMs);

      const sourceRollup: Record<NetworkSource, { count: number; totalMs: number }> = {
        "next-api-supabase-backed": { count: 0, totalMs: 0 },
        "next-api-other": { count: 0, totalMs: 0 },
        "apps-script": { count: 0, totalMs: 0 },
        "supabase-direct": { count: 0, totalMs: 0 },
        "static-asset": { count: 0, totalMs: 0 },
        external: { count: 0, totalMs: 0 },
        unknown: { count: 0, totalMs: 0 },
      };
      for (const entry of networkLogs) {
        sourceRollup[entry.source].count += 1;
        sourceRollup[entry.source].totalMs += entry.durationMs;
      }

      const appsScriptCalls = networkLogs.filter((e) => e.source === "apps-script");

      console.log(
        `[dashboard-perf] ─── PAGE TIMINGS ───\n${JSON.stringify(
          {
            provider: { phone: SEEDED_PROVIDER_PHONE, providerId: SEEDED_PROVIDER_ID },
            domContentLoadedMs,
            networkIdleMs,
            sections: sectionTimings,
          },
          null,
          2
        )}`
      );

      console.log(
        `[dashboard-perf] ─── TRACKED CALLS (sorted by duration desc) ───\n${JSON.stringify(
          trackedCalls.map((c) => ({
            trackedKey: c.trackedKey,
            method: c.method,
            status: c.status,
            durationMs: c.durationMs,
            source: c.source,
            url: c.url,
          })),
          null,
          2
        )}`
      );

      console.log(
        `[dashboard-perf] ─── SOURCE ROLLUP ───\n${JSON.stringify(sourceRollup, null, 2)}`
      );

      console.log(
        `[dashboard-perf] ─── APPS-SCRIPT CALLS (${appsScriptCalls.length}) ───\n${JSON.stringify(
          appsScriptCalls.map((c) => ({
            method: c.method,
            status: c.status,
            durationMs: c.durationMs,
            url: c.url,
          })),
          null,
          2
        )}`
      );

      console.log(
        `[dashboard-perf] ─── FULL NETWORK LOG (${networkLogs.length} entries) ───\n${JSON.stringify(
          networkLogs,
          null,
          2
        )}`
      );

      console.log(
        [
          "[dashboard-perf] note: /api/provider/dashboard-profile internal phases (provider lookup,",
          "provider-scoped parallel, categoryDemand query/cache, areaDemand query/cache, analytics",
          "parallel block, recent-matched tasks lookup, handler total) are logged to dev-server stdout",
          "via perfLog() when NODE_ENV !== \"production\". Watch the `npm run dev` terminal alongside",
          "this test to attribute time *inside* that single Next-API call.",
        ].join(" ")
      );
    } finally {
      await cleanupSeededProvider();
    }
  });
});
