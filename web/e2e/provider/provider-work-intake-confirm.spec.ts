/**
 * Provider Work Intake — Phase 2B ("Mera kaam samjho" confirmation flow).
 *
 * Under test:
 *   - web/app/provider/register/page.tsx — trigger + intake state + handlers.
 *   - web/components/ProviderWorkIntakeConfirm.tsx — presentational panel.
 *   - web/lib/workIntake/clientResolve.ts — fetchResolve + AbortController.
 *   - web/lib/featureFlags.ts — isProviderWorkIntakeConfirmEnabled +
 *     Phase 1 precedence.
 *
 * Mocks /api/provider/work-intake/resolve via Playwright route mocks, so this
 * spec is independent of the server-side test hook env. The Phase 1 + confirm
 * flags are NEXT_PUBLIC_*, so the running server must be started with each
 * branch to exercise it (mirrors the Phase 1 spec convention).
 */

import type { Page, Route } from "@playwright/test";

import { bootstrapProviderSession } from "../_support/auth";
import {
  COMMON_AREAS,
  QA_CATEGORY,
  QA_PROVIDER_PHONE,
} from "../_support/data";
import { gotoPath } from "../_support/home";
import { jsonOk, mockJson, mockKkActions } from "../_support/routes";
import { appUrl } from "../_support/runtime";
import { test, expect } from "../_support/test";

const FLAG_ON =
  String(process.env.NEXT_PUBLIC_PROVIDER_WORK_INTAKE_ENABLED || "")
    .trim()
    .toLowerCase() === "true";
const CONFIRM_FLAG_ON =
  String(process.env.NEXT_PUBLIC_PROVIDER_WORK_INTAKE_CONFIRM_ENABLED || "")
    .trim()
    .toLowerCase() === "true";

// Mirror Phase 1 spec helper. The register page reads the unsigned UI-hint
// cookie at mount; without it, the page redirects to /login.
async function injectProviderUiHint(page: Page, phone: string) {
  await page.context().addCookies([
    {
      name: "kk_session_user",
      value: JSON.stringify({ phone, verified: true, createdAt: Date.now() }),
      url: appUrl("/"),
      sameSite: "Lax",
    },
  ]);
}

const REGIONS = [
  {
    region_code: "R-CENTRAL",
    region_name: "Central Jodhpur",
    areas: [COMMON_AREAS[0]],
  },
];

const CITY_ROW = {
  city_code: "JOD",
  city_name: "Jodhpur",
  state: "Rajasthan",
  country: "India",
  is_default: true,
};

function buildCategoriesPayload() {
  // The Phase 2B confirm panel applies whatever canonical the resolve API
  // returns. The aliases list is used by the existing work-tag chip strip
  // (so an alias-tagged green can highlight an active alias).
  return {
    data: [
      { name: QA_CATEGORY, active: "yes" }, // "Electrician"
      { name: "Plumber", active: "yes" },
      { name: "Carpenter", active: "yes" },
    ],
    suggestions: [
      { label: QA_CATEGORY, canonical: QA_CATEGORY, type: "canonical" as const, matchPriority: 1 },
      { label: "Plumber", canonical: "Plumber", type: "canonical" as const, matchPriority: 1 },
      { label: "Carpenter", canonical: "Carpenter", type: "canonical" as const, matchPriority: 1 },
      // Existing alias under Electrician — feeds workTagsByCanonical so the
      // existing chip strip can render the tag when the AI green tags it.
      {
        label: "fan repair",
        canonical: QA_CATEGORY,
        type: "alias" as const,
        matchPriority: 2,
        aliasType: "work_tag",
      },
    ],
  };
}

async function setupRegisterPage(page: Page) {
  await bootstrapProviderSession(page);
  await injectProviderUiHint(page, QA_PROVIDER_PHONE);
  await mockJson(page, "**/api/categories**", jsonOk(buildCategoriesPayload()));
  await mockJson(page, "**/api/areas**", jsonOk({ areas: COMMON_AREAS }));
  await mockJson(
    page,
    "**/api/area-intelligence/regions**",
    jsonOk({ regions: REGIONS })
  );
  await mockJson(
    page,
    "**/api/cities**",
    jsonOk({ cities: [CITY_ROW], default_city_code: CITY_ROW.city_code })
  );
  await mockJson(
    page,
    "**/api/provider/plan**",
    jsonOk({
      plan: { code: "free", maxRegions: 1, ruleKind: "fixed" },
      remaining: { region_change: 999, category_change: 999 },
      monthlyLimit: 999,
    })
  );
  // New-registration mount looks up the provider and redirects to dashboard
  // if one exists; return null so the form renders.
  await mockKkActions(page, {
    get_provider_by_phone: () => jsonOk({ provider: null }),
    get_areas: () => jsonOk({ areas: COMMON_AREAS }),
  });
}

type ResolveResponse = Record<string, unknown>;

/**
 * Install a one-shot resolve mock that returns the given JSON. Optional delay
 * (ms) lets tests exercise the abort-during-resolving path without races.
 */
async function mockResolve(
  page: Page,
  response: ResolveResponse,
  options: { status?: number; delayMs?: number } = {}
) {
  await page.route("**/api/provider/work-intake/resolve", async (route: Route) => {
    if (options.delayMs && options.delayMs > 0) {
      await new Promise((r) => setTimeout(r, options.delayMs));
    }
    await route.fulfill({
      status: options.status ?? 200,
      contentType: "application/json",
      body: JSON.stringify(response),
    });
  });
}

const ECHO = { text: "ignored" }; // resolve route echoes the text; tests don't assert it

// ── Phase 1 flag OFF ─────────────────────────────────────────────────────────
test.describe("Phase 2B confirm — Phase 1 flag OFF", () => {
  test.skip(FLAG_ON, "runs only when NEXT_PUBLIC_PROVIDER_WORK_INTAKE_ENABLED is OFF");

  test.beforeEach(async ({ page }) => setupRegisterPage(page));

  test("2) confirm trigger absent even if confirm flag is on", async ({ page }) => {
    await gotoPath(page, "/provider/register");
    await expect(page.getByTestId("kk-category-search")).toBeVisible({ timeout: 5_000 });
    // The Phase 2B trigger lives inside the Phase 1 panel. With Phase 1 off,
    // the panel never renders → the trigger is unreachable regardless of the
    // confirm flag's value (precedence is encoded in featureFlags.ts).
    await expect(page.getByTestId("kk-work-intake-trigger")).toHaveCount(0);
    await expect(page.getByTestId("kk-work-intake-section")).toHaveCount(0);
  });
});

// ── Phase 1 ON, Confirm flag OFF ─────────────────────────────────────────────
test.describe("Phase 2B confirm — Phase 1 ON, confirm OFF", () => {
  test.skip(!FLAG_ON, "runs only when Phase 1 flag is ON");
  test.skip(
    CONFIRM_FLAG_ON,
    "runs only when NEXT_PUBLIC_PROVIDER_WORK_INTAKE_CONFIRM_ENABLED is OFF"
  );

  test.beforeEach(async ({ page }) => setupRegisterPage(page));

  test("1) confirm trigger absent; Phase 1 UI unchanged", async ({ page }) => {
    await gotoPath(page, "/provider/register");
    await expect(page.getByTestId("kk-work-intake-section")).toBeVisible({ timeout: 5_000 });
    // Phase 1 UI present:
    await expect(page.getByTestId("kk-bol-ke-samjhaaye")).toBeVisible();
    // Phase 2B trigger absent:
    await expect(page.getByTestId("kk-work-intake-trigger")).toHaveCount(0);
    // Confirm panel never mounts:
    await expect(page.getByTestId("kk-work-intake-confirm")).toHaveCount(0);
  });
});

// ── Phase 1 ON, Confirm flag ON ──────────────────────────────────────────────
test.describe("Phase 2B confirm — flags ON", () => {
  test.skip(!FLAG_ON, "runs only when Phase 1 flag is ON");
  test.skip(!CONFIRM_FLAG_ON, "runs only when confirm flag is ON");

  test.beforeEach(async ({ page }) => setupRegisterPage(page));

  test("3) manual category selection still works (regression)", async ({ page }) => {
    await gotoPath(page, "/provider/register");
    const search = page.getByTestId("kk-category-search");
    await expect(search).toBeVisible({ timeout: 5_000 });
    await search.fill("elec");
    const electricianChip = page.getByRole("button", { name: /^Electrician$/ });
    await expect(electricianChip).toBeVisible({ timeout: 3_000 });
    await electricianChip.click();
    // Selection took effect (manual flow unaffected by Phase 2B wiring).
    await expect(
      page.locator('button:has-text("Electrician")')
    ).toHaveCount(1);
  });

  test("4) trigger disabled when input has fewer than 3 chars", async ({ page }) => {
    await gotoPath(page, "/provider/register");
    const trigger = page.getByTestId("kk-work-intake-trigger");
    await expect(trigger).toBeVisible({ timeout: 5_000 });
    await expect(trigger).toBeDisabled();
    await page.getByTestId("kk-category-search").fill("ab");
    await expect(trigger).toBeDisabled();
    await page.getByTestId("kk-category-search").fill("abc");
    await expect(trigger).toBeEnabled();
  });

  test("5) trigger disabled when a category is already selected", async ({ page }) => {
    await gotoPath(page, "/provider/register");
    const search = page.getByTestId("kk-category-search");
    await search.fill("elec");
    await page.getByRole("button", { name: /^Electrician$/ }).click();
    // After selection the input is disabled at MAX_CATEGORIES=1; the trigger
    // must reflect the same cap so the provider can't re-resolve into the
    // single-category slot accidentally.
    await expect(page.getByTestId("kk-work-intake-trigger")).toBeDisabled();
  });

  test("6) green resolution: clicking Use this applies canonical + existing alias tag", async ({
    page,
  }) => {
    await mockResolve(page, {
      ok: true,
      safety: "green",
      blocked: false,
      fallbackToManual: false,
      reason: "OK",
      mainCategory: {
        canonical: QA_CATEGORY,
        isExisting: true,
        confidence: 0.92,
      },
      workTags: [
        {
          label: "fan repair",
          isExistingAlias: true,
          canonical: QA_CATEGORY,
        },
      ],
      requiresAdminReview: false,
      echo: ECHO,
    });

    await gotoPath(page, "/provider/register");
    const search = page.getByTestId("kk-category-search");
    await search.fill("main cooler aur fan repair karta hu");

    await page.getByTestId("kk-work-intake-trigger").click();

    const confirm = page.getByTestId("kk-work-intake-confirm");
    await expect(confirm).toBeVisible();
    await expect(
      page.locator('[data-testid="kk-work-intake-confirm"][data-kk-confirm-state="green"]')
    ).toBeVisible();
    await expect(page.getByTestId("kk-work-intake-confirm-canonical")).toHaveText(
      QA_CATEGORY
    );

    await page.getByTestId("kk-work-intake-confirm-use").click();

    // Panel cleared, input cleared, canonical chip applied.
    await expect(page.getByTestId("kk-work-intake-confirm")).toHaveCount(0);
    await expect(search).toHaveValue("");
    // The selected chip displays "fan repair (Electrician)" because the
    // existing alias was routed into selectedWorkTags, which the chip-suffix
    // logic surfaces.
    await expect(
      page.locator('button:has-text("fan repair (Electrician)")')
    ).toBeVisible();
  });

  test("7) green with isExistingAlias=false routes tag through workTags JSON, not chip suffix", async ({
    page,
  }) => {
    const captured: { body?: Record<string, unknown> } = {};
    await mockResolve(page, {
      ok: true,
      safety: "green",
      blocked: false,
      fallbackToManual: false,
      reason: "OK",
      mainCategory: {
        canonical: QA_CATEGORY,
        isExisting: true,
        confidence: 0.9,
      },
      workTags: [
        {
          label: "cooler repair",
          // Not yet an active alias under any canonical — should bucket into
          // pendingWorkTags, not selectedWorkTags. Chip strip stays "Electrician"
          // (no tag suffix), but the submit payload's workTags JSON merges it
          // in under the canonical key.
          isExistingAlias: false,
          canonical: QA_CATEGORY,
        },
      ],
      requiresAdminReview: false,
      echo: ECHO,
    });

    // Capture provider_register body so we can assert workTags JSON content.
    await mockKkActions(page, {
      get_provider_by_phone: () => jsonOk({ provider: null }),
      get_areas: () => jsonOk({ areas: COMMON_AREAS }),
      provider_register: ({ body }) => {
        captured.body = body;
        return jsonOk({
          providerId: "PR-TEST-7",
          verified: "yes",
          pendingApproval: "no",
          provider: { ProviderID: "PR-TEST-7", Status: "Active" },
        });
      },
    });

    await gotoPath(page, "/provider/register");
    await page.getByTestId("kk-category-search").fill("main cooler ka kaam");
    await page.getByTestId("kk-work-intake-trigger").click();
    await page.getByTestId("kk-work-intake-confirm-use").click();

    // Canonical chip — plain "Electrician" with NO tag suffix proves the new
    // tag stayed in pendingWorkTags (not selectedWorkTags).
    await expect(
      page.locator('button:has-text("Electrician")').first()
    ).toBeVisible();
    await expect(
      page.locator('button:has-text("cooler repair (Electrician)")')
    ).toHaveCount(0);

    // Drive submission so we can inspect the wire payload.
    await page.getByPlaceholder("Enter your full name").fill("Test Provider");
    await page.getByRole("button", { name: /^Pick Region$/ }).first().click();
    await page.getByTestId("kk-pledge-checkbox").check();
    await page.getByRole("button", { name: /^Submit Application$/ }).click();

    await expect.poll(() => Boolean(captured.body), { timeout: 5_000 }).toBe(true);
    const body = captured.body ?? {};
    expect(body.action).toBe("provider_register");
    const workTagsRaw = typeof body.workTags === "string" ? body.workTags : "";
    expect(workTagsRaw.length).toBeGreaterThan(0);
    const workTags = JSON.parse(workTagsRaw) as Record<string, string[]>;
    // The canonical key is lowercased "electrician" per categoryKey().
    expect(Object.keys(workTags)).toContain("electrician");
    expect(workTags["electrician"]).toContain("cooler repair");

    // Exactly the existing workTags field — no new wire field introduced.
    expect(body).not.toHaveProperty("pendingWorkTags");
    expect(body).not.toHaveProperty("aiWorkTags");
    // pendingNewCategories must NOT contain Electrician (green is not a
    // pending category request).
    const pendingNew = JSON.parse(
      typeof body.pendingNewCategories === "string"
        ? body.pendingNewCategories
        : "[]"
    ) as string[];
    expect(pendingNew).not.toContain(QA_CATEGORY);
  });

  test("8) yellow: panel renders guidance; selection state untouched", async ({
    page,
  }) => {
    await mockResolve(page, {
      ok: true,
      safety: "yellow",
      blocked: false,
      fallbackToManual: false,
      reason: "OK",
      mainCategory: {
        canonical: "Pet Grooming",
        isExisting: false,
        confidence: 0.6,
      },
      workTags: [],
      requiresAdminReview: true,
      echo: ECHO,
    });

    await gotoPath(page, "/provider/register");
    await page.getByTestId("kk-category-search").fill("main pet grooming karta hu");
    await page.getByTestId("kk-work-intake-trigger").click();

    await expect(
      page.locator('[data-testid="kk-work-intake-confirm"][data-kk-confirm-state="yellow"]')
    ).toBeVisible();
    await expect(
      page.getByText("We could not match this exactly yet.")
    ).toBeVisible();

    // No canonical chip applied. The provider must still use the existing
    // "+ Add as new service" affordance manually if they want to.
    await expect(
      page.locator('button:has-text("Pet Grooming (")')
    ).toHaveCount(0);
    await expect(
      page.locator('button:has-text("Electrician")')
    ).toHaveCount(0);

    // Dismiss returns to idle without mutating anything.
    await page.getByTestId("kk-work-intake-confirm-dismiss").click();
    await expect(page.getByTestId("kk-work-intake-confirm")).toHaveCount(0);
  });

  test("9) red: safety message renders; no category added", async ({ page }) => {
    await mockResolve(page, {
      ok: true,
      safety: "red",
      blocked: true,
      fallbackToManual: false,
      reason: "BLOCKED_UNSAFE",
      mainCategory: null,
      workTags: [],
      requiresAdminReview: false,
      echo: ECHO,
    });

    await gotoPath(page, "/provider/register");
    await page.getByTestId("kk-category-search").fill("unsafe content here");
    await page.getByTestId("kk-work-intake-trigger").click();

    await expect(
      page.locator('[data-testid="kk-work-intake-confirm"][data-kk-confirm-state="red"]')
    ).toBeVisible();
    await expect(
      page.getByText("This type of work cannot be listed on Kaun Karega.")
    ).toBeVisible();
    // No category added.
    await expect(page.locator('button:has-text("Electrician")')).toHaveCount(0);
  });

  test("10) fallback: manual copy renders; existing manual flow remains usable", async ({
    page,
  }) => {
    await mockResolve(page, {
      ok: false,
      fallbackToManual: true,
      reason: "AI_UNAVAILABLE",
    });

    await gotoPath(page, "/provider/register");
    const search = page.getByTestId("kk-category-search");
    await search.fill("anything that resolves to fallback");
    await page.getByTestId("kk-work-intake-trigger").click();

    await expect(
      page.locator('[data-testid="kk-work-intake-confirm"][data-kk-confirm-state="manual"]')
    ).toBeVisible();
    await expect(page.getByText("Smart help is not available right now.")).toBeVisible();

    // Dismiss and verify the manual typeahead still works.
    await page.getByTestId("kk-work-intake-confirm-dismiss").click();
    await search.fill("elec");
    await page.getByRole("button", { name: /^Electrician$/ }).click();
    await expect(
      page.locator('button:has-text("Electrician")')
    ).toBeVisible();
  });

  test("11) editing catQuery during resolving aborts; stale response is ignored", async ({
    page,
  }) => {
    // 800 ms delay so we have a clean window to edit the input before the
    // mocked response would otherwise arrive.
    await mockResolve(
      page,
      {
        ok: true,
        safety: "green",
        blocked: false,
        fallbackToManual: false,
        reason: "OK",
        mainCategory: {
          canonical: QA_CATEGORY,
          isExisting: true,
          confidence: 0.9,
        },
        workTags: [],
        requiresAdminReview: false,
        echo: ECHO,
      },
      { delayMs: 800 }
    );

    await gotoPath(page, "/provider/register");
    const search = page.getByTestId("kk-category-search");
    await search.fill("main fan repair karta hu");

    await page.getByTestId("kk-work-intake-trigger").click();
    // Resolving panel shows up immediately on click.
    await expect(
      page.locator('[data-testid="kk-work-intake-confirm"][data-kk-confirm-state="resolving"]')
    ).toBeVisible();

    // Edit text while in-flight — aborts the request + dismisses the panel.
    await search.fill("Different work entirely");
    await expect(page.getByTestId("kk-work-intake-confirm")).toHaveCount(0);

    // Wait past the mocked delay; stale response must not reopen the panel.
    await page.waitForTimeout(1_200);
    await expect(page.getByTestId("kk-work-intake-confirm")).toHaveCount(0);
  });

  test("12) edit mode (?edit=services): trigger is absent", async ({ page }) => {
    await gotoPath(page, "/provider/register?edit=services");
    await expect(page.getByTestId("kk-category-search")).toBeVisible({ timeout: 5_000 });
    await expect(page.getByTestId("kk-work-intake-trigger")).toHaveCount(0);
  });
});
