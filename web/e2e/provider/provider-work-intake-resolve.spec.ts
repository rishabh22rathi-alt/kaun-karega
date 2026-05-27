/**
 * Provider Work Intake — Phase 2A resolve API (server-only, read-only).
 *
 * Route under test: POST /api/provider/work-intake/resolve
 *   - Gated by PROVIDER_WORK_INTAKE_AI_ENABLED.
 *   - Writes ZERO rows; only SELECTs active categories/aliases.
 *   - Deterministic deny-list RED backstop overrides the AI.
 *   - Server decides category membership (closed-set), not the AI.
 *
 * Flag/state is read from the SERVER env at boot, so these specs are
 * parameterized like the Phase-1 specs. To exercise both branches:
 *
 *   # AI disabled branch (test 1):
 *   #   server: (PROVIDER_WORK_INTAKE_AI_ENABLED unset)
 *   #   tests : PROVIDER_WORK_INTAKE_AI_ENABLED unset
 *
 *   # AI enabled branch (tests 2-7):
 *   #   server: PROVIDER_WORK_INTAKE_AI_ENABLED=true PROVIDER_WORK_INTAKE_TEST_HOOK=true
 *   #           (and NO ANTHROPIC_API_KEY, so the real AI path falls back)
 *   #   tests : PROVIDER_WORK_INTAKE_AI_ENABLED=true
 *
 * The enabled branch uses the route's test hook (honored only when the server
 * has PROVIDER_WORK_INTAKE_TEST_HOOK=true) to inject a deterministic AI result
 * (x-kk-ai-mock) and a deterministic active-category set (x-kk-categories-mock),
 * so no real model call or DB row is needed.
 */

import { bootstrapProviderSession } from "../_support/auth";
import { appUrl } from "../_support/runtime";
import { test, expect } from "../_support/test";

const AI_ON =
  String(process.env.PROVIDER_WORK_INTAKE_AI_ENABLED || "")
    .trim()
    .toLowerCase() === "true";

const RESOLVE_PATH = "/api/provider/work-intake/resolve";

// ── AI disabled ──────────────────────────────────────────────────────────────
test.describe("work-intake resolve — AI disabled", () => {
  test.skip(AI_ON, "runs only when PROVIDER_WORK_INTAKE_AI_ENABLED is OFF");

  test("1) flag off → AI_DISABLED fallback", async ({ page }) => {
    const res = await page.request.post(appUrl(RESOLVE_PATH), {
      data: { text: "main lohe aur welding ka kaam karta hu" },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      ok: false,
      fallbackToManual: true,
      reason: "AI_DISABLED",
    });
  });
});

// ── AI enabled (test hook) ───────────────────────────────────────────────────
test.describe("work-intake resolve — AI enabled (test hook)", () => {
  test.skip(!AI_ON, "runs only when PROVIDER_WORK_INTAKE_AI_ENABLED is ON");

  test.beforeEach(async ({ page }) => {
    await bootstrapProviderSession(page);
  });

  test("2) deny-list red term → blocked, no category", async ({ page }) => {
    const res = await page.request.post(appUrl(RESOLVE_PATH), {
      data: { text: "I provide escort service in the city" },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.safety).toBe("red");
    expect(body.blocked).toBe(true);
    expect(body.mainCategory).toBeNull();
    expect(body.reason).toBe("BLOCKED_UNSAFE");
    expect(body.workTags).toEqual([]);
  });

  test("3) existing active category → green", async ({ page }) => {
    const res = await page.request.post(appUrl(RESOLVE_PATH), {
      data: { text: "main alag alag tarah ka kaam karta hu jaroorat ke hisaab se" },
      headers: {
        "x-kk-categories-mock": "Welder,Electrician,Plumber",
        "x-kk-ai-mock": JSON.stringify({
          mainCategory: "Welder",
          isNew: false,
          confidence: 0.9,
          safety: "green",
          workTags: ["gate welding"],
        }),
      },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.safety).toBe("green");
    expect(body.blocked).toBe(false);
    expect(body.mainCategory).toMatchObject({
      canonical: "Welder",
      isExisting: true,
    });
    expect(body.requiresAdminReview).toBe(false);
    expect(body.workTags).toHaveLength(1);
    expect(body.workTags[0]).toMatchObject({
      label: "gate welding",
      isExistingAlias: false,
      canonical: "Welder",
    });
  });

  test("4) AI category not in active set → yellow, isExisting false, admin review", async ({
    page,
  }) => {
    const res = await page.request.post(appUrl(RESOLVE_PATH), {
      data: { text: "main kuch naya tarah ka kaam karta hu" },
      headers: {
        "x-kk-categories-mock": "Welder,Electrician",
        "x-kk-ai-mock": JSON.stringify({
          mainCategory: "Spaceship Repair",
          isNew: true,
          confidence: 0.85,
          safety: "green",
          workTags: [],
        }),
      },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.safety).toBe("yellow");
    expect(body.mainCategory).toMatchObject({
      canonical: "Spaceship Repair",
      isExisting: false,
    });
    expect(body.requiresAdminReview).toBe(true);
    expect(body.blocked).toBe(false);
  });

  test("5) AI unavailable (no mock, no API key) → fallbackToManual", async ({
    page,
  }) => {
    const res = await page.request.post(appUrl(RESOLVE_PATH), {
      data: { text: "main thoda alag kaam karta hu jo list me shayad na ho" },
      headers: {
        // categories mock keeps this off the DB; no x-kk-ai-mock → real AI path
        // → no ANTHROPIC_API_KEY on the test server → AI_UNAVAILABLE.
        "x-kk-categories-mock": "Welder,Electrician",
      },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.fallbackToManual).toBe(true);
    expect(body.reason).toBe("AI_UNAVAILABLE");
  });

  test("6) resolve exposes no write/created fields (zero-write contract)", async ({
    page,
  }) => {
    const res = await page.request.post(appUrl(RESOLVE_PATH), {
      data: { text: "welding aur gate banane ka kaam" },
      headers: {
        "x-kk-categories-mock": "Welder",
        "x-kk-ai-mock": JSON.stringify({
          mainCategory: "Welder",
          isNew: false,
          confidence: 0.92,
          safety: "green",
          workTags: ["gate welding", "gate welding", "  "],
        }),
      },
    });
    const body = await res.json();
    // No persistence side-channel in the response shape.
    expect(body.inserted).toBeUndefined();
    expect(body.created).toBeUndefined();
    expect(body.providerId).toBeUndefined();
    expect(body.requestId).toBeUndefined();
    // Dedupe + empty-drop applied to work tags.
    expect(body.workTags).toHaveLength(1);
  });

  test("7) empty/whitespace input → 400 NO_INPUT", async ({ page }) => {
    const empty = await page.request.post(appUrl(RESOLVE_PATH), {
      data: { text: "" },
    });
    expect(empty.status()).toBe(400);
    expect((await empty.json()).reason).toBe("NO_INPUT");

    const blank = await page.request.post(appUrl(RESOLVE_PATH), {
      data: { text: "    " },
    });
    expect(blank.status()).toBe(400);
    expect((await blank.json()).reason).toBe("NO_INPUT");
  });
});
