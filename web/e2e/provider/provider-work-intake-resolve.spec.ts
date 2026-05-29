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
 * (x-kk-ai-mock), a deterministic active-category set (x-kk-categories-mock),
 * and (since the alias-augmented prompt change) a deterministic per-canonical
 * alias map (x-kk-aliases-mock). No real model call or DB row is needed.
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

  test("8) aliases mock + AI routes cooler/fan → Electrician (green, alias-marked tag)", async ({
    page,
  }) => {
    // Real-prod regression case: "main cooler aur fan repair karta hu" used to
    // surface as AC Repair 0.7 because the AI saw category names only and
    // guessed by surface semantics. With aliases inlined under each canonical,
    // the AI has the disambiguation cue to pick Electrician. We mock the AI to
    // return what the alias-augmented prompt should now produce, AND verify
    // the route honours the same alias map for isExistingAlias tagging.
    const res = await page.request.post(appUrl(RESOLVE_PATH), {
      data: { text: "main cooler aur fan repair karta hu" },
      headers: {
        "x-kk-categories-mock": "Electrician,AC Repair,Plumber",
        "x-kk-aliases-mock": JSON.stringify({
          Electrician: ["fan repair", "cooler wiring", "switch repair"],
          "AC Repair": ["ac gas filling", "ac installation"],
        }),
        "x-kk-ai-mock": JSON.stringify({
          mainCategory: "Electrician",
          isNew: false,
          confidence: 0.9,
          safety: "green",
          workTags: ["fan repair", "cooler repair"],
        }),
      },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.safety).toBe("green");
    expect(body.mainCategory).toMatchObject({
      canonical: "Electrician",
      isExisting: true,
    });
    expect(body.requiresAdminReview).toBe(false);
    // "fan repair" is in the alias mock → marked existing; "cooler repair" is
    // not → marked new. Confirms the same map drives both the prompt and the
    // post-AI alias tagging when running under the test hook.
    const byLabel = Object.fromEntries(
      (body.workTags as Array<{ label: string; isExistingAlias: boolean }>).map(
        (t) => [t.label, t.isExistingAlias]
      )
    );
    expect(byLabel["fan repair"]).toBe(true);
    expect(byLabel["cooler repair"]).toBe(false);
  });

  test("9) aliases mock entries under inactive canonicals are dropped", async ({
    page,
  }) => {
    // Defence-in-depth: an alias whose canonical isn't in the active set must
    // never leak into the prompt or the isExistingAlias check. Here "AC Repair"
    // is omitted from x-kk-categories-mock but supplied under aliases — the
    // route must drop it, so "fan repair" remains a new (not existing) tag.
    const res = await page.request.post(appUrl(RESOLVE_PATH), {
      data: { text: "main fan repair karta hu" },
      headers: {
        "x-kk-categories-mock": "Welder",
        "x-kk-aliases-mock": JSON.stringify({
          "AC Repair": ["fan repair", "ac gas filling"],
        }),
        "x-kk-ai-mock": JSON.stringify({
          mainCategory: "Welder",
          isNew: false,
          confidence: 0.9,
          safety: "green",
          workTags: ["fan repair"],
        }),
      },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.mainCategory).toMatchObject({
      canonical: "Welder",
      isExisting: true,
    });
    expect(body.workTags).toHaveLength(1);
    expect(body.workTags[0]).toMatchObject({
      label: "fan repair",
      // AC Repair isn't an active canonical here, so its alias map is dropped
      // and the tag is treated as new under Welder.
      isExistingAlias: false,
      canonical: "Welder",
    });
  });

  test("10) clamp: long-sentence mainCategory is dropped to null on yellow", async ({
    page,
  }) => {
    // The AI was told to propose a short Title-Case name when nothing fits.
    // If it ignores the prompt and echoes the provider's full sentence, the
    // server clamp must drop the proposal — the response carries
    // mainCategory=null instead of leaking the sentence as a "new category".
    const longSentence = "main packing shifting loading karta hu";
    const res = await page.request.post(appUrl(RESOLVE_PATH), {
      data: { text: longSentence },
      headers: {
        "x-kk-categories-mock": "Welder,Electrician",
        "x-kk-ai-mock": JSON.stringify({
          mainCategory: longSentence,
          isNew: true,
          confidence: 0.6,
          safety: "yellow",
          workTags: ["packing", "shifting"],
        }),
      },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.safety).toBe("yellow");
    expect(body.mainCategory).toBeNull();
    expect(body.requiresAdminReview).toBe(true);
    expect(body.blocked).toBe(false);
  });

  test("11) clamp: too-many-words mainCategory is dropped to null on yellow", async ({
    page,
  }) => {
    const res = await page.request.post(appUrl(RESOLVE_PATH), {
      data: { text: "some niche legal service" },
      headers: {
        "x-kk-categories-mock": "Welder,Electrician",
        "x-kk-ai-mock": JSON.stringify({
          // 5 words — exceeds the 3-word cap even though length is under 30.
          mainCategory: "Brand New Niche Service Type",
          isNew: true,
          confidence: 0.6,
          safety: "yellow",
          workTags: [],
        }),
      },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.mainCategory).toBeNull();
    expect(body.safety).toBe("yellow");
  });

  test("12) clamp: short clean proposal passes through on yellow", async ({
    page,
  }) => {
    // 16 chars, 3 words — within both bounds. Must NOT be dropped.
    const res = await page.request.post(appUrl(RESOLVE_PATH), {
      data: { text: "main packing aur shifting ka kaam" },
      headers: {
        "x-kk-categories-mock": "Welder,Electrician",
        "x-kk-ai-mock": JSON.stringify({
          mainCategory: "Packers & Movers",
          isNew: true,
          confidence: 0.6,
          safety: "yellow",
          workTags: ["packing", "shifting"],
        }),
      },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.safety).toBe("yellow");
    expect(body.mainCategory).toMatchObject({
      canonical: "Packers & Movers",
      isExisting: false,
    });
    expect(body.requiresAdminReview).toBe(true);
  });

  test("13) multi-category: ≥2 active matches → needsSingleCategoryChoice yellow, mainCategory null", async ({
    page,
  }) => {
    const res = await page.request.post(appUrl(RESOLVE_PATH), {
      data: { text: "main plumber electrician painting sab karta hu" },
      headers: {
        "x-kk-categories-mock": "Plumber,Electrician,Carpenter,Welder",
        "x-kk-ai-mock": JSON.stringify({
          mainCategory: "",
          isNew: false,
          confidence: 0.7,
          safety: "yellow",
          workTags: ["wiring", "painting", "pipes"],
          // Carpenter is not what the provider said; the route should still
          // accept it because the AI's claim is closed-set validated.
          possibleCategories: ["Plumber", "Electrician", "Carpenter"],
        }),
      },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.safety).toBe("yellow");
    expect(body.needsSingleCategoryChoice).toBe(true);
    expect(body.mainCategory).toBeNull();
    // Empty workTags on multi-category — never attribute tags to a canonical
    // the provider hasn't picked yet.
    expect(body.workTags).toEqual([]);
    expect(body.requiresAdminReview).toBe(false);
    expect(Array.isArray(body.possibleCategories)).toBe(true);
    expect(body.possibleCategories).toHaveLength(3);
    const names = (body.possibleCategories as Array<{ canonical: string }>)
      .map((p) => p.canonical)
      .sort();
    expect(names).toEqual(["Carpenter", "Electrician", "Plumber"]);
    for (const p of body.possibleCategories as Array<{ isExisting: boolean }>) {
      expect(p.isExisting).toBe(true);
    }
  });

  test("14) multi-category: inactive entries are filtered out", async ({
    page,
  }) => {
    // AI lists 4 names; only Painter is active. Route filters → 1 match →
    // falls through to single-canonical hoist (next test). Here we confirm the
    // filter drops the inactive names rather than echoing them back.
    const res = await page.request.post(appUrl(RESOLVE_PATH), {
      data: { text: "painting cleaning house help" },
      headers: {
        "x-kk-categories-mock": "Painter,Plumber",
        "x-kk-ai-mock": JSON.stringify({
          mainCategory: "",
          isNew: false,
          confidence: 0.7,
          safety: "yellow",
          workTags: [],
          possibleCategories: ["Painter", "Cleaning", "House Help"],
        }),
      },
    });
    const body = await res.json();
    // 1 valid match → hoist to mainCategory, not choose-category state.
    expect(body.needsSingleCategoryChoice).toBeFalsy();
    expect(body.mainCategory).toMatchObject({
      canonical: "Painter",
      isExisting: true,
    });
    // Cleaning / House Help are NOT active → must not appear anywhere on the
    // wire, must not become pending category proposals.
    const serialised = JSON.stringify(body);
    expect(serialised).not.toContain("Cleaning");
    expect(serialised).not.toContain("House Help");
  });

  test("15) multi-category: cap at 4 possibleCategories", async ({ page }) => {
    const res = await page.request.post(appUrl(RESOLVE_PATH), {
      data: { text: "many services" },
      headers: {
        "x-kk-categories-mock":
          "Plumber,Electrician,Carpenter,Painter,Welder,Hospital",
        "x-kk-ai-mock": JSON.stringify({
          mainCategory: "",
          isNew: false,
          confidence: 0.7,
          safety: "yellow",
          workTags: [],
          possibleCategories: [
            "Plumber",
            "Electrician",
            "Carpenter",
            "Painter",
            "Welder",
            "Hospital",
          ],
        }),
      },
    });
    const body = await res.json();
    expect(body.needsSingleCategoryChoice).toBe(true);
    expect(body.possibleCategories).toHaveLength(4);
  });

  test("16) multi-category: case-insensitive dedupe across AI repeats", async ({
    page,
  }) => {
    const res = await page.request.post(appUrl(RESOLVE_PATH), {
      data: { text: "dupes" },
      headers: {
        "x-kk-categories-mock": "Plumber,Electrician",
        "x-kk-ai-mock": JSON.stringify({
          mainCategory: "",
          isNew: false,
          confidence: 0.7,
          safety: "yellow",
          workTags: [],
          possibleCategories: ["plumber", "PLUMBER", "Electrician"],
        }),
      },
    });
    const body = await res.json();
    expect(body.needsSingleCategoryChoice).toBe(true);
    expect(body.possibleCategories).toHaveLength(2);
    const names = (body.possibleCategories as Array<{ canonical: string }>)
      .map((p) => p.canonical)
      .sort();
    expect(names).toEqual(["Electrician", "Plumber"]);
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
