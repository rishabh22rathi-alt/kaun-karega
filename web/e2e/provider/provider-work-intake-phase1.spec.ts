/**
 * Provider Work Intake — Phase 1 (UI foundation only).
 *
 * Under test (web/app/provider/register/page.tsx + web/hooks/
 * useTypewriterPlaceholder.ts + web/lib/featureFlags.ts):
 *   - Behind NEXT_PUBLIC_PROVIDER_WORK_INTAKE_ENABLED, the register page shows
 *     a "What work do you do?" block with a "Bol ke samjhaaye" button and an
 *     animated-placeholder textarea.
 *   - When the flag is OFF, none of that renders and the existing manual
 *     category selection is unchanged.
 *   - The intake textbox is local-only: it never submits and never touches the
 *     manual category flow (Phase 1 rule). We assert the manual flow still
 *     works while the flag is on.
 *
 * Flag is a NEXT_PUBLIC_* build-time constant, so a single running server is
 * pinned to one state. These specs are therefore PARAMETERIZED by the server's
 * env: each describe block skips itself when the running server is in the other
 * state. To exercise BOTH branches:
 *
 *   # OFF branch
 *   NEXT_PUBLIC_PROVIDER_WORK_INTAKE_ENABLED=  npm run dev   (then run this spec)
 *   # ON branch
 *   NEXT_PUBLIC_PROVIDER_WORK_INTAKE_ENABLED=true npm run dev (then run this spec)
 *
 * The test process must be started with the SAME env value as the server so
 * FLAG_ON below matches what the page actually rendered.
 *
 * No backend changes. All API calls are mocked exactly like the existing
 * provider-register specs.
 */

import type { Page } from "@playwright/test";

import { bootstrapProviderSession } from "../_support/auth";
import {
  COMMON_AREAS,
  COMMON_CATEGORIES,
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
// Phase 2B confirm flag — declared here so a Phase 1 spec can guarantee the
// trigger toggles in lockstep with the new flag without owning the rest of
// the Phase 2B suite.
const CONFIRM_FLAG_ON =
  String(process.env.NEXT_PUBLIC_PROVIDER_WORK_INTAKE_CONFIRM_ENABLED || "")
    .trim()
    .toLowerCase() === "true";
// Voice-first assistant flag. When ON, the inline Phase 2B UI is REPLACED by
// the assistant modal — the legacy testids (`kk-bol-ke-samjhaaye`,
// `kk-work-intake-trigger`, `kk-bol-explanation`) deliberately stop rendering.
// The flag-ON assertions in this Phase 1 spec are therefore skipped when the
// assistant flag is on; full voice-first behaviour is covered in
// provider-work-intake-assistant.spec.ts.
const ASSISTANT_FLAG_ON =
  String(process.env.NEXT_PUBLIC_PROVIDER_WORK_INTAKE_ASSISTANT_ENABLED || "")
    .trim()
    .toLowerCase() === "true";

// Mirrors the helper in provider-register-category-and-aliases.spec.ts: the
// register page reads the unsigned UI-hint cookie at mount; without it the page
// redirects to /login before the form renders.
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
  { region_code: "R-CENTRAL", region_name: "Central Jodhpur", areas: [COMMON_AREAS[0]] },
];

function buildCategoriesPayload() {
  return {
    data: COMMON_CATEGORIES.map((c) => ({ name: c.name, active: c.active })),
    suggestions: [
      ...COMMON_CATEGORIES.map((c) => ({
        label: c.name,
        canonical: c.name,
        type: "canonical" as const,
        matchPriority: 1,
      })),
      {
        label: "AC Doctor",
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
  // New-registration mount looks up the provider and redirects to dashboard if
  // one exists; return null so the form renders.
  await mockKkActions(page, {
    get_provider_by_phone: () => jsonOk({ provider: null }),
    get_areas: () => jsonOk({ areas: COMMON_AREAS }),
  });
}

// ── Flag OFF ────────────────────────────────────────────────────────────────
test.describe("Provider work intake — flag OFF", () => {
  test.skip(FLAG_ON, "runs only when NEXT_PUBLIC_PROVIDER_WORK_INTAKE_ENABLED is OFF");

  test.beforeEach(async ({ page }) => setupRegisterPage(page));

  test("existing manual category selection renders; new intake UI does not", async ({
    page,
  }) => {
    await gotoPath(page, "/provider/register");

    // Manual flow present.
    await expect(page.getByTestId("kk-category-search")).toBeVisible({
      timeout: 5_000,
    });
    await expect(page.getByText(/Start typing your service/i)).toBeVisible();

    // Intake UI absent.
    await expect(page.getByTestId("kk-work-intake-section")).toHaveCount(0);
    await expect(page.getByTestId("kk-work-intake-textarea")).toHaveCount(0);
    await expect(page.getByTestId("kk-bol-ke-samjhaaye")).toHaveCount(0);
    await expect(page.getByText("What work do you do?")).toHaveCount(0);
  });
});

// ── Flag ON ─────────────────────────────────────────────────────────────────
// All assertions below pin the legacy inline Phase 1 / 2B surface. Skipped
// when the assistant flag is on — that surface is no longer rendered and the
// voice-first behaviour is covered by provider-work-intake-assistant.spec.ts.
test.describe("Provider work intake — flag ON", () => {
  test.skip(!FLAG_ON, "runs only when NEXT_PUBLIC_PROVIDER_WORK_INTAKE_ENABLED is ON");
  test.skip(
    ASSISTANT_FLAG_ON,
    "legacy inline surface — superseded by the assistant modal when ASSISTANT_FLAG is on"
  );

  test.beforeEach(async ({ page }) => setupRegisterPage(page));

  test("compact help header appears above the SINGLE category search input (no separate textarea)", async ({
    page,
  }) => {
    await gotoPath(page, "/provider/register");

    // Compact help header.
    await expect(page.getByTestId("kk-work-intake-section")).toBeVisible({
      timeout: 5_000,
    });
    await expect(page.getByText("What work do you do?")).toBeVisible();
    await expect(page.getByTestId("kk-bol-ke-samjhaaye")).toBeVisible();

    // The existing category search is the single intake input.
    await expect(page.getByTestId("kk-category-search")).toBeVisible();
    await expect(
      page.getByText(/Search a service or describe your work/i)
    ).toBeVisible();

    // No separate large work-intake textarea anymore.
    await expect(page.getByTestId("kk-work-intake-textarea")).toHaveCount(0);
  });

  test("manual category selection still works alongside the intake UI", async ({
    page,
  }) => {
    await gotoPath(page, "/provider/register");

    // Intake UI and manual search both present.
    await expect(page.getByTestId("kk-work-intake-section")).toBeVisible({
      timeout: 5_000,
    });
    const search = page.getByTestId("kk-category-search");
    await expect(search).toBeVisible();

    await search.fill("elec");
    const electricianChip = page.getByRole("button", { name: /^Electrician$/ });
    await expect(electricianChip).toBeVisible({ timeout: 3_000 });
    await electricianChip.click();

    // Selection took effect (single chip, search disabled at MAX_CATEGORIES=1).
    await expect(page.locator('button:has-text("Electrician")')).toHaveCount(1);
    await expect(search).toBeDisabled();
  });

  test("Bol ke samjhaaye reveals a dismissible explanation", async ({ page }) => {
    await gotoPath(page, "/provider/register");

    const button = page.getByTestId("kk-bol-ke-samjhaaye");
    await expect(button).toBeVisible({ timeout: 5_000 });

    await expect(page.getByTestId("kk-bol-explanation")).toHaveCount(0);
    await button.click();

    const explanation = page.getByTestId("kk-bol-explanation");
    await expect(explanation).toBeVisible();
    await expect(explanation).toContainText(/simple bhasha mein bataiye/i);

    // Dismiss.
    await explanation.getByRole("button", { name: /Theek hai/i }).click();
    await expect(page.getByTestId("kk-bol-explanation")).toHaveCount(0);
  });

  test("animated placeholder does not break typing in the category search input", async ({
    page,
  }) => {
    await gotoPath(page, "/provider/register");

    const search = page.getByTestId("kk-category-search");
    await expect(search).toBeVisible({ timeout: 5_000 });

    // Type character-by-character into the empty field (real keystrokes, while
    // the placeholder typewriter is actively running). If the animation wrote
    // into the value or stole focus, the result would not match. The input
    // applies capitalizeWords() on change, so the expected value is the
    // title-cased form of what we typed.
    await search.click();
    await search.pressSequentially("describe my work", { delay: 15 });
    await expect(search).toHaveValue("Describe My Work");
  });

  // ── Phase 2B confirm-flag interlock ────────────────────────────────────
  // Both branches share Phase 1's setup; we only assert the trigger's
  // presence to keep this spec focused. The full Phase 2B behaviour lives
  // in provider-work-intake-confirm.spec.ts.
  test("Phase 2B trigger absent when CONFIRM flag is off", async ({ page }) => {
    test.skip(CONFIRM_FLAG_ON, "runs only when confirm flag is OFF");
    await gotoPath(page, "/provider/register");
    await expect(page.getByTestId("kk-work-intake-section")).toBeVisible({
      timeout: 5_000,
    });
    await expect(page.getByTestId("kk-work-intake-trigger")).toHaveCount(0);
  });

  test("Phase 2B trigger present when CONFIRM flag is on", async ({ page }) => {
    test.skip(!CONFIRM_FLAG_ON, "runs only when confirm flag is ON");
    await gotoPath(page, "/provider/register");
    await expect(page.getByTestId("kk-work-intake-section")).toBeVisible({
      timeout: 5_000,
    });
    await expect(page.getByTestId("kk-work-intake-trigger")).toBeVisible();
  });
});
