/**
 * Playwright coverage — Providers Under Review / Approval.
 *
 *   Five phases, each a separate `test()` so failures point at the
 *   exact assertion that regressed:
 *
 *     1. Mocked UI render — three tiles (Total / Under Review /
 *        Verified) with the correct counts, subtitle, and click-to-
 *        expand grouped cards. Mocks `/api/admin/provider-stats` +
 *        `/api/admin/providers-under-review` so the assertion never
 *        depends on the live DB.
 *
 *     2. Tile-to-API consistency — opens the section against the
 *        REAL backend, reads /api/admin/provider-stats with an admin
 *        session, and asserts the Under Review tile's rendered
 *        number equals `data.underReview`.
 *
 *     3. Security — anonymous, normal-user-session, and admin-session
 *        probes against `/api/admin/providers-under-review`. The
 *        admin probe must return 200; the other two must reject with
 *        401/403 and never include `providers`.
 *
 *     4. Live pending-alias flow — bootstraps the QA provider
 *        session, submits a custom alias via `/api/provider/aliases`,
 *        and verifies the provider appears in the under-review list
 *        with a Work Term pending. Then rejects the alias via the
 *        existing `/api/admin/aliases` endpoint and verifies the
 *        provider drops (or at least the probe alias is gone if the
 *        provider had other open items). Always cleans up the alias
 *        in a try/finally so a failure mid-flow leaves no residue.
 *        Skips gracefully when QA_PROVIDER_PHONE isn't seeded as a
 *        real provider on this environment.
 *
 *     5. Verified exclusion — same shape as Phase 4 but ALSO checks
 *        `provider-stats.verified` before / during / after. Requires
 *        an eligible-verified provider fixture (provider exists in
 *        `providers`, has an active-category service, and has logged
 *        in within the last 30 days). Honours the user's "skip with
 *        a clear message instead of failing" rule by detecting this
 *        precondition via `eligibleVerified=true` on the alias
 *        submitter and skipping otherwise.
 *
 *   Mutations: phases 4 and 5 create exactly one `category_aliases`
 *   row each (`active=false`, `alias_type='work_tag'`, alias prefixed
 *   with `under-review-audit-`) and immediately reject it through the
 *   existing admin endpoint. No other write paths are exercised; no
 *   schema changes; the cleanup is unconditional via try/finally.
 */

import type { APIRequestContext, Page } from "@playwright/test";

import {
  bootstrapAdminSession,
  bootstrapProviderSession,
  bootstrapUserSession,
} from "../_support/auth";
import { mockJson } from "../_support/routes";
import { appUrl } from "../_support/runtime";
import { test, expect } from "../_support/test";

// Live admin phone for phases 2-5. `bootstrapAdminSession` sets the
// kk_auth_session cookie for whatever phone is supplied; the server-
// side `requireAdminSession` then has to find that phone in the
// `admins` table with `active=true`. The QA fixture phone is not
// guaranteed to be seeded on every environment, so honour an env
// override and skip the live phases cleanly if neither works.
const LIVE_ADMIN_PHONE =
  process.env.QA_LIVE_ADMIN_PHONE || process.env.PLAYWRIGHT_ADMIN_PHONE || "";

// Tile + panel test ids declared on the ProvidersTab component. Keep
// these in sync with the data-testid strings in
// web/components/admin/ProvidersTab.tsx.
const TILE_TOTAL = "kk-admin-providers-total-tile";
const TILE_UNDER_REVIEW = "kk-admin-providers-under-review-tile";
const TILE_VERIFIED = "kk-admin-providers-verified-tile";
const PANEL_UNDER_REVIEW = "kk-admin-providers-under-review-panel";

const TILE_SUBTITLE =
  "Category, work-term, or area changes waiting for admin";

// Local mirror of the server-side shape from
// web/lib/admin/adminProviderReview.ts. Mirrored (not imported) so the
// spec stays an isolated e2e file. Includes the optional discriminator
// + audit fields the real endpoint emits so a literal mock payload
// passes structural matching without an `as unknown as` escape hatch.
type ProviderReviewGroup = {
  providerId: string;
  providerName: string;
  phone: string;
  eligibleVerified: boolean;
  pendingCategories: Array<{
    kind?: "category";
    requestId: string;
    requestedCategory: string;
    createdAt?: string | null;
  }>;
  pendingWorkTerms: Array<{
    kind?: "alias";
    alias: string;
    canonicalCategory: string;
    aliasType?: string | null;
    createdAt?: string | null;
  }>;
  pendingAreas: Array<{
    kind?: "area";
    reviewId: string;
    rawArea: string;
    sourceType: string;
    createdAt?: string | null;
  }>;
};

type ProviderStatsResponse = {
  ok?: boolean;
  data?: { total: number; verified: number; underReview: number };
};

type ProvidersUnderReviewResponse = {
  ok?: boolean;
  totalUnderReview?: number;
  providers?: ProviderReviewGroup[];
  error?: string;
};

async function openProvidersAccordion(page: Page): Promise<void> {
  const toggle = page.locator('button[aria-controls="providers-tab-body"]');
  await toggle.waitFor({ state: "visible", timeout: 15_000 });
  const expanded = await toggle.getAttribute("aria-expanded");
  if (expanded !== "true") {
    await toggle.click();
    await toggle
      .getAttribute("aria-expanded")
      .then(() => {})
      .catch(() => {});
  }
  // Wait for the body region itself to render so subsequent
  // testid queries don't race the React re-render.
  await page
    .locator("#providers-tab-body")
    .waitFor({ state: "visible", timeout: 15_000 });
}

// Cleanup helper — uses an admin session in a separate context so it
// doesn't disturb the calling test's page cookies. Soft-fails so a
// missing alias (already-rejected, never created) doesn't mask the
// real test failure.
async function rejectAliasAsAdmin(
  baseContext: APIRequestContext,
  page: Page,
  alias: string
): Promise<void> {
  try {
    const adminContext = await page.context().browser()!.newContext();
    const adminPage = await adminContext.newPage();
    await bootstrapAdminSession(adminPage);
    await adminPage.request
      .post(appUrl("/api/admin/aliases"), {
        data: { action: "reject", alias, reason: "Audit cleanup" },
      })
      .catch(() => undefined);
    await adminContext.close();
  } catch {
    /* swallow */
  }
}

// Provider-context REST helper — uses a freshly-bootstrapped session
// in an isolated context so the calling test's cookies are not
// disturbed by the bootstrap.
async function withProviderContext<T>(
  page: Page,
  phone: string,
  fn: (ctx: { page: Page; request: APIRequestContext }) => Promise<T>
): Promise<T> {
  const ctx = await page.context().browser()!.newContext();
  const p = await ctx.newPage();
  try {
    await bootstrapProviderSession(p, phone);
    return await fn({ page: p, request: p.request });
  } finally {
    await ctx.close();
  }
}

async function withAdminContext<T>(
  page: Page,
  fn: (ctx: { page: Page; request: APIRequestContext }) => Promise<T>
): Promise<T> {
  const ctx = await page.context().browser()!.newContext();
  const p = await ctx.newPage();
  try {
    const opts: Parameters<typeof bootstrapAdminSession>[1] = {};
    if (LIVE_ADMIN_PHONE) opts.phone = LIVE_ADMIN_PHONE;
    await bootstrapAdminSession(p, opts);
    return await fn({ page: p, request: p.request });
  } finally {
    await ctx.close();
  }
}

// Detect whether the bootstrapped admin session actually maps to a
// real `admins` row on this environment. The unread-summary endpoint
// is the cheapest admin-gated probe in the codebase — same gate as
// every other /api/admin route — so we lean on it as the canary.
// Falls back to /api/admin/provider-stats only if unread-summary 5xx.
// Caches the result on a module-level flag so phases 2-5 only pay
// the round-trip once.
let liveAdminAvailable: boolean | null = null;
async function ensureLiveAdminAvailable(page: Page): Promise<boolean> {
  if (liveAdminAvailable !== null) return liveAdminAvailable;
  liveAdminAvailable = await withAdminContext(page, async ({ request: req }) => {
    const res = await req.get(appUrl("/api/admin/provider-stats"));
    return res.status() === 200;
  });
  return liveAdminAvailable;
}

test.describe("Admin Dashboard — Providers Under Review / Approval", () => {
  // Suite-level serial mode — phase 4 and phase 5 share underReview /
  // verified state via the live DB, so running them in parallel could
  // double-count or race. The repo's playwright.config already pins
  // workers:1, but this guard keeps the contract explicit at the file
  // level too.
  test.describe.configure({ mode: "serial" });
  // ────────────────────────────────────────────────────────────────
  // PHASE 1 — Mocked UI render. Deterministic; no DB dependency.
  // ────────────────────────────────────────────────────────────────
  test("PHASE 1 — renders three tiles, counts, subtitle, and expands grouped cards", async ({
    page,
  }) => {
    await bootstrapAdminSession(page);

    // Mocks for the two endpoints the tile + panel consume. Other
    // dashboard endpoints (unread, notifications, ...) are NOT mocked
    // here — those calls fall through to the live server but don't
    // influence the Providers tab assertions below.
    await mockJson(page, "**/api/admin/provider-stats**", {
      status: 200,
      body: {
        ok: true,
        data: { total: 123, verified: 50, underReview: 2 },
      },
    });
    await mockJson(page, "**/api/admin/providers-under-review**", {
      status: 200,
      body: {
        ok: true,
        totalUnderReview: 2,
        providers: [
          {
            providerId: "PR-MOCK-A",
            providerName: "Alpha Co",
            phone: "9876543210",
            eligibleVerified: true,
            pendingCategories: [
              {
                kind: "category",
                requestId: "PCR-1",
                requestedCategory: "plumbing",
                createdAt: "2026-05-01T00:00:00Z",
              },
            ],
            pendingWorkTerms: [
              {
                kind: "alias",
                alias: "alpha-tag",
                canonicalCategory: "plumbing",
                aliasType: "work_tag",
                createdAt: "2026-05-02T00:00:00Z",
              },
            ],
            pendingAreas: [],
          },
          {
            providerId: "PR-MOCK-B",
            providerName: "Beta Inc",
            phone: "9876543211",
            eligibleVerified: false,
            pendingCategories: [],
            pendingWorkTerms: [
              {
                kind: "alias",
                alias: "beta-tag",
                canonicalCategory: "electrician",
                aliasType: "work_tag",
                createdAt: "2026-05-03T00:00:00Z",
              },
            ],
            pendingAreas: [],
          },
        ],
      } as ProvidersUnderReviewResponse,
    });

    await page.goto(appUrl("/admin/dashboard"), {
      waitUntil: "domcontentloaded",
    });
    await openProvidersAccordion(page);

    // All three tiles visible.
    const totalTile = page.getByTestId(TILE_TOTAL);
    const underTile = page.getByTestId(TILE_UNDER_REVIEW);
    const verifiedTile = page.getByTestId(TILE_VERIFIED);
    await expect(totalTile).toBeVisible();
    await expect(underTile).toBeVisible();
    await expect(verifiedTile).toBeVisible();

    // Counts. We anchor on the locale-formatted string the component
    // emits via toLocaleString() — "123", "2", "50" all stay the same
    // under either locale at these sizes.
    await expect(totalTile).toContainText("123");
    await expect(underTile).toContainText("2");
    await expect(verifiedTile).toContainText("50");

    // Subtitle text exact per spec.
    await expect(underTile).toContainText(TILE_SUBTITLE);

    // Click the under-review tile to expand the grouped panel.
    await underTile.click();
    const panel = page.getByTestId(PANEL_UNDER_REVIEW);
    await expect(panel).toBeVisible();

    // Group cards keyed by providerId.
    const groupA = page.getByTestId("kk-admin-under-review-PR-MOCK-A");
    const groupB = page.getByTestId("kk-admin-under-review-PR-MOCK-B");
    await expect(groupA).toBeVisible();
    await expect(groupB).toBeVisible();

    // Alpha: 1 category + 1 work term → both chips.
    await expect(groupA).toContainText("Alpha Co");
    await expect(groupA).toContainText("Categories · 1");
    await expect(groupA).toContainText("Work Terms · 1");
    // Beta: only Work Terms chip (no categories, no areas).
    await expect(groupB).toContainText("Beta Inc");
    await expect(groupB).toContainText("Work Terms · 1");
    // Beta has no categories → the Categories chip must NOT appear
    // on Beta's card. Strict scoping prevents the assertion from
    // matching Alpha's chip.
    await expect(
      groupB.getByText("Categories ·", { exact: false })
    ).toHaveCount(0);
    await expect(
      groupB.getByText("Areas ·", { exact: false })
    ).toHaveCount(0);
  });

  // ────────────────────────────────────────────────────────────────
  // PHASE 2 — Live tile-vs-API consistency. Reads the real backend.
  // ────────────────────────────────────────────────────────────────
  test("PHASE 2 — Under Review tile count matches /api/admin/provider-stats.underReview (live)", async ({
    page,
  }) => {
    if (!(await ensureLiveAdminAvailable(page))) {
      test.skip(
        true,
        "Live admin auth not available on this environment — set QA_LIVE_ADMIN_PHONE to a phone seeded in the `admins` table to run live phases."
      );
      return;
    }

    const adminOpts: Parameters<typeof bootstrapAdminSession>[1] = {};
    if (LIVE_ADMIN_PHONE) adminOpts.phone = LIVE_ADMIN_PHONE;
    await bootstrapAdminSession(page, adminOpts);

    // Read the live stats first so we know what the rendered tile
    // should display.
    const statsRes = await page.request.get(appUrl("/api/admin/provider-stats"));
    expect(
      statsRes.status(),
      "Admin session should be able to read /api/admin/provider-stats"
    ).toBe(200);
    const statsBody = (await statsRes.json()) as ProviderStatsResponse;
    expect(statsBody.ok).toBe(true);
    const underReview = Number(statsBody.data?.underReview ?? -1);
    expect(underReview).toBeGreaterThanOrEqual(0);

    // Render the dashboard and confirm the tile shows the same value.
    // Listen for the live stats request triggered by the providers
    // accordion opening so the test only proceeds once the tile data
    // has actually arrived. This avoids relying on the default 5s
    // toBeVisible timeout, which is too tight for a cold dev server
    // doing the verified-set intersection on every refresh.
    const statsRequestP = page.waitForResponse(
      (resp) =>
        resp.url().includes("/api/admin/provider-stats") &&
        resp.request().method() === "GET" &&
        resp.status() === 200,
      { timeout: 30_000 }
    );
    await page.goto(appUrl("/admin/dashboard"), {
      waitUntil: "domcontentloaded",
    });
    await openProvidersAccordion(page);
    await statsRequestP;
    const underTile = page.getByTestId(TILE_UNDER_REVIEW);
    await expect(underTile).toBeVisible({ timeout: 15_000 });
    await expect(underTile).toContainText(underReview.toLocaleString());

    // Clicking the tile must trigger /api/admin/providers-under-review
    // and render the panel. We listen for the request promise BEFORE
    // the click so a fast response doesn't escape the listener.
    const reviewReq = page.waitForRequest(
      (req) =>
        req.url().includes("/api/admin/providers-under-review") &&
        req.method() === "GET"
    );
    await underTile.click();
    await reviewReq;
    await expect(page.getByTestId(PANEL_UNDER_REVIEW)).toBeVisible();
  });

  // ────────────────────────────────────────────────────────────────
  // PHASE 3 — Security: anon / user / admin probes (live).
  // ────────────────────────────────────────────────────────────────
  test("PHASE 3 — security: anon and user sessions denied, admin allowed", async ({
    request,
    page,
  }) => {
    // 3a — Anonymous.
    const anonRes = await request.get(
      appUrl("/api/admin/providers-under-review")
    );
    expect(
      [401, 403],
      `Anonymous returned ${anonRes.status()} (expected 401 or 403)`
    ).toContain(anonRes.status());
    const anonBody = (await anonRes
      .json()
      .catch(() => ({}))) as ProvidersUnderReviewResponse;
    expect(anonBody.ok).not.toBe(true);
    expect(anonBody.providers).toBeUndefined();

    // 3b — Non-admin user session.
    await bootstrapUserSession(page);
    const userRes = await page.request.get(
      appUrl("/api/admin/providers-under-review")
    );
    expect(
      [401, 403],
      `User session returned ${userRes.status()} (expected 401 or 403)`
    ).toContain(userRes.status());
    const userBody = (await userRes
      .json()
      .catch(() => ({}))) as ProvidersUnderReviewResponse;
    expect(userBody.providers).toBeUndefined();

    // 3c — Admin session positive control. Only runs when a live
    // admin phone resolves; otherwise the security boundary is still
    // verified by 3a + 3b above and we record the gap as INFO.
    if (await ensureLiveAdminAvailable(page)) {
      await withAdminContext(page, async ({ request: adminReq }) => {
        const adminRes = await adminReq.get(
          appUrl("/api/admin/providers-under-review")
        );
        expect(
          adminRes.status(),
          `Admin session returned ${adminRes.status()} (expected 200)`
        ).toBe(200);
        const adminBody = (await adminRes.json()) as ProvidersUnderReviewResponse;
        expect(adminBody.ok).toBe(true);
        expect(Array.isArray(adminBody.providers)).toBe(true);
      });
    } else {
      console.log(
        "[PHASE 3c] Admin positive control skipped — no live admin fixture available. 3a + 3b still enforce the security boundary for anon + user sessions."
      );
    }
  });

  // ────────────────────────────────────────────────────────────────
  // PHASE 4 — Live pending-alias flow. Skips if QA provider phone is
  // not seeded as a real provider.
  // ────────────────────────────────────────────────────────────────
  test("PHASE 4 — pending alias surfaces provider, reject removes them (live)", async ({
    page,
    request,
  }) => {
    if (!(await ensureLiveAdminAvailable(page))) {
      test.skip(
        true,
        "Live admin auth not available on this environment — set QA_LIVE_ADMIN_PHONE to a phone seeded in the `admins` table to run live phases."
      );
      return;
    }

    const phone = process.env.QA_LIVE_PROVIDER_PHONE || "9999999902";

    // Verify the QA provider phone is bound to a real provider in
    // this environment. If not, skip with a clear note instead of
    // failing — exactly as the user requested.
    const profile = await withProviderContext(
      page,
      phone,
      async ({ request: req }) => {
        const res = await req.get(appUrl("/api/provider/work-terms"));
        const body = (await res.json().catch(() => ({}))) as {
          ok?: boolean;
          providerId?: string;
        };
        return { status: res.status(), ok: Boolean(body.ok), body };
      }
    );
    if (!profile.ok || !profile.body.providerId) {
      test.skip(
        true,
        `QA provider phone (${phone}) is not currently a registered provider on this environment. Set QA_LIVE_PROVIDER_PHONE to a seeded provider phone to run this flow.`
      );
      return;
    }
    const providerId = profile.body.providerId;

    // Find an approved canonical category the provider offers, so the
    // alias submit can pass the "must offer" gate in
    // /api/provider/aliases.
    const dash = await withProviderContext(
      page,
      phone,
      async ({ request: req }) => {
        const res = await req.get(appUrl("/api/provider/dashboard-profile"));
        return (await res.json().catch(() => ({}))) as {
          ok?: boolean;
          provider?: {
            Services?: Array<{ Category?: string; Status?: string }>;
          };
        };
      }
    );
    const approvedService = (dash.provider?.Services || []).find(
      (s) => String(s.Status || "").toLowerCase() === "approved"
    );
    if (!approvedService?.Category) {
      test.skip(
        true,
        `Provider ${providerId} has no approved canonical category in this environment; skipping live flow.`
      );
      return;
    }
    const canonical = String(approvedService.Category);

    const probeAlias = `under-review-audit-${Date.now()}`;
    let cleanedUp = false;
    try {
      // (1) Provider submits a custom alias via the existing endpoint.
      const submit = await withProviderContext(
        page,
        phone,
        async ({ request: req }) =>
          req.post(appUrl("/api/provider/aliases"), {
            data: { alias: probeAlias, canonicalCategory: canonical },
          })
      );
      expect(
        submit.status(),
        `Custom alias submission returned ${submit.status()}`
      ).toBe(200);

      // (2) Provider now appears in the under-review list with a Work
      // Term entry whose `alias` matches our probe (case-insensitive).
      const afterSubmit = await withAdminContext(page, async ({ request: req }) => {
        const res = await req.get(appUrl("/api/admin/providers-under-review"));
        expect(res.status()).toBe(200);
        return (await res.json()) as ProvidersUnderReviewResponse;
      });
      const group = (afterSubmit.providers || []).find(
        (g) => g.providerId === providerId
      );
      expect(
        group,
        `Provider ${providerId} should appear in the under-review list after submitting a pending alias`
      ).toBeDefined();
      const matchedAlias = group!.pendingWorkTerms.find(
        (wt) => wt.alias.toLowerCase() === probeAlias.toLowerCase()
      );
      expect(
        matchedAlias,
        "The probe alias should be present on the provider's pendingWorkTerms"
      ).toBeDefined();

      // (3) Admin rejects via the existing endpoint.
      const reject = await withAdminContext(page, async ({ request: req }) =>
        req.post(appUrl("/api/admin/aliases"), {
          data: {
            action: "reject",
            alias: probeAlias,
            reason: "Audit reject",
          },
        })
      );
      expect(reject.status()).toBe(200);
      cleanedUp = true;

      // (4) The probe alias is gone. If the provider had OTHER open
      // items they may still appear in the list — what we strictly
      // assert is that our probe alias is no longer on their card.
      const afterReject = await withAdminContext(page, async ({ request: req }) => {
        const res = await req.get(appUrl("/api/admin/providers-under-review"));
        return (await res.json()) as ProvidersUnderReviewResponse;
      });
      const stillThere = (afterReject.providers || []).find(
        (g) => g.providerId === providerId
      );
      if (stillThere) {
        const stillHasProbe = stillThere.pendingWorkTerms.some(
          (wt) => wt.alias.toLowerCase() === probeAlias.toLowerCase()
        );
        expect(
          stillHasProbe,
          "Probe alias should be gone from pendingWorkTerms after admin reject"
        ).toBe(false);
      }
    } finally {
      // Belt-and-braces cleanup: if anything threw between submit and
      // reject, rejectAliasAsAdmin is safe to call (soft-fails on a
      // missing row).
      if (!cleanedUp) {
        await rejectAliasAsAdmin(request, page, probeAlias);
      }
    }
  });

  // ────────────────────────────────────────────────────────────────
  // PHASE 5 — Verified exclusion (live, fixture-dependent).
  // ────────────────────────────────────────────────────────────────
  test("PHASE 5 — pending review item drops verified count by 1, reject restores it (live, skips without fixture)", async ({
    page,
    request,
  }) => {
    if (!(await ensureLiveAdminAvailable(page))) {
      test.skip(
        true,
        "Live admin auth not available on this environment — set QA_LIVE_ADMIN_PHONE to a phone seeded in the `admins` table to run live phases."
      );
      return;
    }

    const phone = process.env.QA_LIVE_PROVIDER_PHONE || "9999999902";

    // Detect eligibleVerified: a provider counts only when they have
    // (a) an active-category service AND (b) a recent profile login.
    // The cheapest signal is to fetch the under-review surface as
    // them once an alias is pending — but we can't yet (we haven't
    // submitted). Instead, query the dashboard-profile, then poke
    // the provider-stats endpoint pre/during/post.
    const profile = await withProviderContext(
      page,
      phone,
      async ({ request: req }) => {
        const res = await req.get(appUrl("/api/provider/work-terms"));
        const body = (await res.json().catch(() => ({}))) as {
          ok?: boolean;
          providerId?: string;
        };
        return { status: res.status(), ok: Boolean(body.ok), body };
      }
    );
    if (!profile.ok || !profile.body.providerId) {
      test.skip(
        true,
        `QA provider phone (${phone}) is not currently a registered provider. Set QA_LIVE_PROVIDER_PHONE to a seeded provider phone to run the verified-exclusion check.`
      );
      return;
    }
    const providerId = profile.body.providerId;

    // Baseline stats.
    const baselineStatsBody = await withAdminContext(page, async ({ request: req }) => {
      const res = await req.get(appUrl("/api/admin/provider-stats"));
      expect(res.status()).toBe(200);
      return (await res.json()) as ProviderStatsResponse;
    });
    const baselineVerified = Number(baselineStatsBody.data?.verified ?? 0);
    const baselineUnderReview = Number(
      baselineStatsBody.data?.underReview ?? 0
    );

    // Find an approved canonical for the submit.
    const dash = await withProviderContext(
      page,
      phone,
      async ({ request: req }) => {
        const res = await req.get(appUrl("/api/provider/dashboard-profile"));
        return (await res.json().catch(() => ({}))) as {
          ok?: boolean;
          provider?: {
            Services?: Array<{ Category?: string; Status?: string }>;
          };
        };
      }
    );
    const approvedService = (dash.provider?.Services || []).find(
      (s) => String(s.Status || "").toLowerCase() === "approved"
    );
    if (!approvedService?.Category) {
      test.skip(
        true,
        `Provider ${providerId} has no approved canonical category; cannot demonstrate verified exclusion. Skipping.`
      );
      return;
    }
    const canonical = String(approvedService.Category);

    const probeAlias = `under-review-audit-${Date.now()}-vexcl`;
    let cleanedUp = false;
    try {
      // Submit pending alias.
      const submit = await withProviderContext(
        page,
        phone,
        async ({ request: req }) =>
          req.post(appUrl("/api/provider/aliases"), {
            data: { alias: probeAlias, canonicalCategory: canonical },
          })
      );
      expect(submit.status()).toBe(200);

      // Pull stats + the under-review group so we can branch on the
      // provider's eligibleVerified status.
      const duringStats = await withAdminContext(page, async ({ request: req }) => {
        const statsRes = await req.get(appUrl("/api/admin/provider-stats"));
        const stats = (await statsRes.json()) as ProviderStatsResponse;
        const listRes = await req.get(
          appUrl("/api/admin/providers-under-review")
        );
        const list = (await listRes.json()) as ProvidersUnderReviewResponse;
        return { stats, list };
      });

      expect(
        Number(duringStats.stats.data?.underReview ?? 0),
        "underReview should bump by 1 after the probe alias is pending"
      ).toBe(baselineUnderReview + 1);

      const group = (duringStats.list.providers || []).find(
        (g) => g.providerId === providerId
      );
      expect(group, "Provider should appear in the under-review list").toBeDefined();

      const isEligibleVerified = Boolean(group!.eligibleVerified);
      const duringVerified = Number(duringStats.stats.data?.verified ?? 0);

      if (!isEligibleVerified) {
        test.skip(
          true,
          `Provider ${providerId} is not eligibleVerified on this environment (no recent profile login OR no active-category service). Verified-count exclusion math is unobservable for this fixture; skipping.`
        );
        return;
      }

      // Provider IS eligibleVerified — they should be excluded from
      // the verified count while under review.
      expect(
        duringVerified,
        "verified count should decrease by 1 for an eligibleVerified provider entering review"
      ).toBe(Math.max(0, baselineVerified - 1));

      // Reject and check verified restores.
      const reject = await withAdminContext(page, async ({ request: req }) =>
        req.post(appUrl("/api/admin/aliases"), {
          data: {
            action: "reject",
            alias: probeAlias,
            reason: "Audit reject (verified-exclusion test)",
          },
        })
      );
      expect(reject.status()).toBe(200);
      cleanedUp = true;

      const restoredStats = await withAdminContext(page, async ({ request: req }) => {
        const res = await req.get(appUrl("/api/admin/provider-stats"));
        return (await res.json()) as ProviderStatsResponse;
      });
      expect(
        Number(restoredStats.data?.underReview ?? 0),
        "underReview should drop back to baseline after reject"
      ).toBe(baselineUnderReview);
      expect(
        Number(restoredStats.data?.verified ?? 0),
        "verified count should restore to baseline after the pending item is resolved"
      ).toBe(baselineVerified);
    } finally {
      if (!cleanedUp) {
        await rejectAliasAsAdmin(request, page, probeAlias);
      }
    }
  });
});
