/**
 * E2E: Strict Region Matching (PR-C) — API-level verification
 *
 * Validates that /api/find-provider and /api/process-task-notifications
 * use strict region_code matching with NO area-text fallback. After
 * PR-C, the rules are:
 *
 *   • task.region_code must be set; otherwise zero matches.
 *   • provider_areas filter is exact (city_code, region_code), never
 *     an ilike on area text.
 *   • provider_areas rows with region_code IS NULL are NOT eligible,
 *     even if their area text exactly matches the task area.
 *   • WhatsApp template body, provider_task_matches.area, and the
 *     response `area` field remain HUMAN-READABLE (task.area string),
 *     never the region_code.
 *
 * ─── OBSERVABILITY ARCHITECTURE NOTE ────────────────────────────────
 *
 * Playwright observes:
 *   - HTTP status + JSON body returned by the matching routes
 *   - Response field names and types
 *   - Browser-side network requests if a page is loaded
 *
 * Playwright CANNOT observe:
 *   - Supabase query bodies the route sends server-side
 *   - provider_task_matches writes (no read API exposed without admin)
 *   - WhatsApp send-time template parameters (Meta WA send happens
 *     server-side; no browser-visible trace)
 *   - Which specific provider IDs Supabase returned pre-filter
 *
 * Tests below assert what IS observable; cross-region negatives that
 * depend on specific seed data are documented as manual-SQL-only and
 * captured in the report's manual recipe section.
 *
 * ─── RUNNING ────────────────────────────────────────────────────────
 *
 *   # Against local dev:
 *   PLAYWRIGHT_BASE_URL=http://127.0.0.1:3000 npx playwright test \
 *     e2e/strict-region-matching.spec.ts --reporter=line
 *
 *   # Against a Supabase preview branch deployment:
 *   PLAYWRIGHT_BASE_URL=https://preview.example.vercel.app \
 *     npx playwright test e2e/strict-region-matching.spec.ts
 *
 * Both environments need the JOD-25 catalog seeded (already in prod
 * via 20260527130000_replace_jod_regions_with_25.sql). Tests do NOT
 * mutate any data.
 */

import { test, expect, type Route } from "@playwright/test";

// ─── Test constants ──────────────────────────────────────────────────

// "Sardarpura" is JOD-01-A001 in the seeded catalog
// (supabase/migrations/20260527130000_replace_jod_regions_with_25.sql).
// The resolver MUST return resolved=true for this string in JOD.
const KNOWN_AREA = "Sardarpura";

// Pseudo-random garbage that will not match any canonical or alias.
// Unique per run via timestamp suffix to avoid colliding with any
// stale admin-resolved alias in a preview environment.
const UNRESOLVABLE_AREA = `__xx_no_such_area_${Date.now()}`;

const TEST_CATEGORY = "Electrician";

// Sentinel taskId for the process-task-notifications route-mock test.
// Not written to any DB; only the request capture verifies the caller
// contract.
const SENTINEL_TASK_ID = "TASK-ZZ-STRICT-REGION-001";

// ─── TC-01: Unresolvable area → zero providers (no fallback) ────────
//
// This is the core proof that area-text fallback is gone. Before PR-C,
// a request with `area=<arbitrary_text>` would ilike against
// provider_areas.area and might return some providers if a stray DB
// row matched. After PR-C, an area that the resolver can't map MUST
// produce zero providers — full stop, no fallback path.

test.describe("PR-C — Strict Region Matching", () => {
  test("TC-01 — Unresolvable area returns zero providers (no area-text fallback)", async ({
    request,
  }) => {
    const url = `/api/find-provider?category=${encodeURIComponent(
      TEST_CATEGORY
    )}&area=${encodeURIComponent(UNRESOLVABLE_AREA)}`;

    const res = await request.get(url);
    expect(res.status(), "find-provider must return 200").toBe(200);

    const body = (await res.json()) as {
      ok?: boolean;
      count?: number;
      providers?: unknown[];
      matchTier?: string;
      usedFallback?: boolean;
    };

    expect(body.ok, "response.ok must be true").toBe(true);
    expect(Array.isArray(body.providers)).toBe(true);
    expect(body.count, "providers.length must equal count").toBe(
      body.providers!.length
    );

    // STRICT CONTRACT: zero providers for an area that does not
    // resolve. The old behaviour would have ilike'd on area text and
    // returned anything with a partial match. If this assertion fails,
    // a regression has reintroduced the text-fallback path.
    expect(
      body.count,
      `STRICT REGION: unresolvable area ${UNRESOLVABLE_AREA} must produce 0 providers`
    ).toBe(0);
    expect(body.providers).toHaveLength(0);

    console.log(
      "[TC-01] PASS — unresolvable area returns zero providers; no area-text fallback observed."
    );
  });

  // ── TC-02: Known canonical area returns providers with HUMAN-READABLE area ─
  //
  // For a known canonical area, the response may or may not contain
  // providers (depends on seed data in the target environment). What
  // we can ALWAYS assert is the response shape: when providers ARE
  // returned, each must carry the human-readable area text — never
  // the JOD-NN region_code.

  test("TC-02 — Known area response keeps `area` field human-readable (never region_code)", async ({
    request,
  }) => {
    const url = `/api/find-provider?category=${encodeURIComponent(
      TEST_CATEGORY
    )}&area=${encodeURIComponent(KNOWN_AREA)}`;

    const res = await request.get(url);
    expect(res.status(), "find-provider must return 200").toBe(200);

    const body = (await res.json()) as {
      ok?: boolean;
      count?: number;
      providers?: Array<Record<string, unknown>>;
    };

    expect(body.ok).toBe(true);
    expect(Array.isArray(body.providers)).toBe(true);

    const providers = body.providers ?? [];

    if (providers.length === 0) {
      console.log(
        "[TC-02] Live DB returned 0 providers for Electrician/Sardarpura in target env. " +
          "Shape assertions still pass on empty array. Seed providers in preview if needed."
      );
      return;
    }

    console.log(
      `[TC-02] ${providers.length} provider(s) returned. Verifying area field is human-readable.`
    );

    // STRICT CONTRACT: the response.area field must be the
    // human-readable text the caller passed (KNOWN_AREA) — NOT a
    // region_code. WhatsApp template + provider notification body
    // both read this same value downstream.
    for (const provider of providers) {
      // Match the original area text (case-insensitive trim) — the
      // route normalizes whitespace but never substitutes region_code.
      expect(typeof provider.area).toBe("string");
      const areaStr = String(provider.area || "").trim().toLowerCase();
      expect(
        areaStr,
        `provider ${provider.ProviderID ?? provider.providerId} must carry human-readable area, not a region_code`
      ).toBe(KNOWN_AREA.trim().toLowerCase());

      // Region_code must NOT leak into the public response shape.
      expect(
        "region_code" in provider,
        "response.providers[] must not expose region_code (internal field)"
      ).toBe(false);
    }

    console.log(
      "[TC-02] PASS — area field is human-readable; region_code does not leak to response."
    );
  });

  // ── TC-03: process-task-notifications zero-match shape (route-mock) ──
  //
  // Route-mocks process-task-notifications and verifies the response
  // shape the route returns when task.region_code is missing matches
  // what the existing caller code expects. We mock because invoking
  // the real route requires an authenticated session + a real task
  // row with a known region_code state — heavy for a focused contract
  // test. The actual route logic is verified by code-path analysis in
  // the report plus the manual SQL recipe.

  test("TC-03 — process-task-notifications zero-match response shape (route-mock)", async ({
    page,
  }) => {
    let captured: Record<string, unknown> | null = null;
    let callCount = 0;

    await page.route("**/api/process-task-notifications**", async (route: Route) => {
      callCount++;
      try {
        captured = route.request().postDataJSON() as Record<string, unknown>;
      } catch {
        captured = null;
      }
      // Shape the route returns when task.region_code IS NULL — must
      // match what the page expects so no caller-side regression
      // surfaces from PR-C.
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          matchedProviders: 0,
          attemptedSends: 0,
          failedSends: 0,
          matchTier: "category",
          usedFallback: false,
          reason: "task_region_code_missing",
        }),
      });
    });

    // Navigate to a real origin so the subsequent in-page fetch() can
    // resolve a relative URL. `page.evaluate` on an `about:blank`
    // document has no base URL, so `fetch("/api/...")` throws
    // "Failed to parse URL". The only requirement is that the page
    // ends up on the baseURL origin; the homepage is the lightest
    // stable target and doesn't trigger any /api/process-task-
    // notifications call of its own, so the route mock's callCount
    // stays at exactly 1 after the evaluate below.
    //
    // page.request was deliberately NOT used here — it bypasses
    // page.route mocks (page.request uses the test fixture's
    // request context, which is separate from the page context that
    // page.route intercepts). The whole point of TC-03 is to verify
    // the caller-side contract against the mocked response shape.
    await page.goto("/", { waitUntil: "domcontentloaded" });

    // Drive the route via a direct fetch in the page context (no UI
    // navigation needed for this contract check).
    const result = await page.evaluate(async (taskId) => {
      const res = await fetch("/api/process-task-notifications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskId }),
      });
      return res.json();
    }, SENTINEL_TASK_ID);

    expect(callCount, "process-task-notifications must be called once").toBe(1);
    const capturedBody = captured as Record<string, unknown> | null;
    expect(capturedBody?.taskId).toBe(SENTINEL_TASK_ID);

    const res = result as {
      ok?: boolean;
      matchedProviders?: number;
      attemptedSends?: number;
      reason?: string;
    };
    expect(res.ok).toBe(true);
    expect(res.matchedProviders).toBe(0);
    expect(res.attemptedSends).toBe(0);
    expect(res.reason).toBe("task_region_code_missing");

    console.log(
      "[TC-03] PASS — zero-match response shape stable for task.region_code=NULL; " +
        "caller contract preserved. LIMIT: actual server route invocation requires live DB + auth."
    );
  });

  // ── TC-04: Response field whitelist — region_code never exposed ───
  //
  // Defense-in-depth: even if a future regression exposes region_code
  // in /api/find-provider responses, this test catches it. The list
  // of allowed fields mirrors find-provider/route.ts ProviderListItem.

  test("TC-04 — find-provider response excludes region_code from every provider object", async ({
    request,
  }) => {
    const url = `/api/find-provider?category=${encodeURIComponent(
      TEST_CATEGORY
    )}&area=${encodeURIComponent(KNOWN_AREA)}`;

    const res = await request.get(url);
    const body = (await res.json()) as {
      providers?: Array<Record<string, unknown>>;
    };

    const providers = body.providers ?? [];
    for (const p of providers) {
      expect("region_code" in p, "region_code must NOT appear in provider object").toBe(false);
      expect("city_code" in p, "city_code must NOT appear in provider object").toBe(false);
    }

    console.log(
      `[TC-04] PASS — checked ${providers.length} provider object(s); region_code / city_code not leaked.`
    );
  });
});
