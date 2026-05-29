/**
 * Provider Work Intake — voice-first assistant modal (guided Q1+Q2 flow).
 *
 * Under test:
 *   - web/components/provider/ProviderWorkIntakeAssistant.tsx (modal).
 *   - web/hooks/useSpeechRecognition.ts (browser STT wrapper).
 *   - web/app/provider/register/page.tsx — assistant button, mount,
 *     assistant-adapter handlers, and the post-apply hint toast.
 *   - web/lib/featureFlags.ts — isProviderWorkIntakeAssistantEnabled().
 *
 * `SpeechRecognition` and `SpeechSynthesis` are both stubbed via Playwright
 * `addInitScript`. `/api/provider/work-intake/resolve` is fulfilled with route
 * mocks — this spec is independent of the server-side AI / test-hook env.
 *
 * Flag matrix (parameterised like Phase 1):
 *   - NEXT_PUBLIC_PROVIDER_WORK_INTAKE_ENABLED
 *   - NEXT_PUBLIC_PROVIDER_WORK_INTAKE_ASSISTANT_ENABLED
 *
 * Both must be ON for the assistant button to render.
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
const ASSISTANT_FLAG_ON =
  String(process.env.NEXT_PUBLIC_PROVIDER_WORK_INTAKE_ASSISTANT_ENABLED || "")
    .trim()
    .toLowerCase() === "true";

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
  return {
    data: [
      { name: QA_CATEGORY, active: "yes" }, // Electrician
      { name: "Plumber", active: "yes" },
      { name: "Carpenter", active: "yes" },
    ],
    suggestions: [
      {
        label: QA_CATEGORY,
        canonical: QA_CATEGORY,
        type: "canonical" as const,
        matchPriority: 1,
      },
      {
        label: "Plumber",
        canonical: "Plumber",
        type: "canonical" as const,
        matchPriority: 1,
      },
      {
        label: "Carpenter",
        canonical: "Carpenter",
        type: "canonical" as const,
        matchPriority: 1,
      },
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

/**
 * Install a controllable `webkitSpeechRecognition` AND a no-op
 * `SpeechSynthesis` stub. The synth stub avoids real audio and fires onend
 * immediately so the thanking screen always advances under deterministic
 * timing.
 */
async function installSpeechStub(
  page: Page,
  options: { supported?: boolean; autoErrorOnStart?: string } = {}
) {
  const supported = options.supported !== false;
  await page.addInitScript(
    ({ supported, autoErrorOnStart }) => {
      const w = window as unknown as Record<string, unknown>;

      // SpeechSynthesis no-op stub. We fire onend on the next tick so the
      // thanking effect closes the modal quickly under tests.
      const synthStub = {
        speak(utter: { onend?: () => void; onerror?: () => void }) {
          queueMicrotask(() => {
            try {
              utter.onend?.();
            } catch {
              /* ignore */
            }
          });
        },
        cancel() {
          /* no-op */
        },
      };
      class UtteranceStub {
        text: string;
        lang = "";
        rate = 1;
        onend: (() => void) | null = null;
        onerror: (() => void) | null = null;
        constructor(text: string) {
          this.text = text;
        }
      }
      (w as { speechSynthesis?: unknown }).speechSynthesis = synthStub;
      (w as { SpeechSynthesisUtterance?: unknown }).SpeechSynthesisUtterance =
        UtteranceStub;

      if (!supported) {
        delete w.SpeechRecognition;
        delete w.webkitSpeechRecognition;
        return;
      }
      type ResultEvent = {
        results: Array<{ 0: { transcript: string }; isFinal: boolean; length: number }>;
      };
      type ErrEvent = { error: string };
      type Instance = {
        lang: string;
        continuous: boolean;
        interimResults: boolean;
        onresult: ((e: ResultEvent) => void) | null;
        onerror: ((e: ErrEvent) => void) | null;
        onend: (() => void) | null;
        onstart: (() => void) | null;
        start(): void;
        stop(): void;
        abort(): void;
        _stopped?: boolean;
      };
      const liveInstances: Instance[] = [];
      function StubRecognition(this: Instance) {
        this.lang = "";
        this.continuous = false;
        this.interimResults = false;
        this.onresult = null;
        this.onerror = null;
        this.onend = null;
        this.onstart = null;
        this._stopped = false;
        // eslint-disable-next-line @typescript-eslint/no-this-alias
        const self = this;
        this.start = () => {
          self._stopped = false;
          liveInstances.push(self);
          queueMicrotask(() => {
            try {
              self.onstart?.();
            } catch {
              /* ignore */
            }
            if (autoErrorOnStart) {
              queueMicrotask(() => {
                try {
                  self.onerror?.({ error: autoErrorOnStart });
                } catch {
                  /* ignore */
                }
                try {
                  self.onend?.();
                } catch {
                  /* ignore */
                }
              });
            }
          });
        };
        this.stop = () => {
          if (self._stopped) return;
          self._stopped = true;
          queueMicrotask(() => {
            try {
              self.onend?.();
            } catch {
              /* ignore */
            }
          });
        };
        this.abort = () => {
          if (self._stopped) return;
          self._stopped = true;
          queueMicrotask(() => {
            try {
              self.onend?.();
            } catch {
              /* ignore */
            }
          });
        };
      }
      w.SpeechRecognition = StubRecognition;
      w.webkitSpeechRecognition = StubRecognition;

      (w as { __kkSpeechEmit?: (p: { partial?: string; final?: string }) => void }).__kkSpeechEmit =
        ({ partial, final }) => {
          const live = liveInstances[liveInstances.length - 1] as Instance | undefined;
          if (!live || live._stopped) return;
          const results: Array<{ 0: { transcript: string }; isFinal: boolean; length: number }> = [];
          if (partial !== undefined) {
            results.push({ 0: { transcript: partial }, isFinal: false, length: 1 });
          }
          if (final !== undefined) {
            results.push({ 0: { transcript: final }, isFinal: true, length: 1 });
          }
          try {
            live.onresult?.({ results });
          } catch {
            /* ignore */
          }
        };
    },
    { supported, autoErrorOnStart: options.autoErrorOnStart ?? "" }
  );
}

type ResolveResponse = Record<string, unknown>;

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
  await mockKkActions(page, {
    get_provider_by_phone: () => jsonOk({ provider: null }),
    get_areas: () => jsonOk({ areas: COMMON_AREAS }),
  });
}

const ECHO = { text: "ignored" };

async function emitFinal(page: Page, text: string) {
  await page.evaluate(
    (t) =>
      (window as unknown as { __kkSpeechEmit: (p: { final: string }) => void })
        .__kkSpeechEmit({ final: t }),
    text
  );
}

async function captureResolveCalls(page: Page): Promise<string[]> {
  const calls: string[] = [];
  await page.route("**/api/provider/work-intake/resolve", async (route) => {
    const post = route.request().postData() || "";
    try {
      const body = JSON.parse(post) as { text?: string };
      if (body && typeof body.text === "string") calls.push(body.text);
    } catch {
      /* ignore */
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
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
        workTags: [],
        requiresAdminReview: false,
        echo: ECHO,
      }),
    });
  });
  return calls;
}

// ── Assistant flag OFF ───────────────────────────────────────────────────────
test.describe("Assistant — flag OFF", () => {
  test.skip(!FLAG_ON, "needs Phase 1 flag ON");
  test.skip(
    ASSISTANT_FLAG_ON,
    "runs only when NEXT_PUBLIC_PROVIDER_WORK_INTAKE_ASSISTANT_ENABLED is OFF"
  );

  test.beforeEach(async ({ page }) => setupRegisterPage(page));

  test("1) assistant button absent; manual category flow still works", async ({
    page,
  }) => {
    await gotoPath(page, "/provider/register");
    await expect(
      page.getByTestId("kk-work-intake-open-assistant")
    ).toHaveCount(0);
    const search = page.getByTestId("kk-category-search");
    await search.fill("elec");
    await page.getByRole("button", { name: /^Electrician$/ }).click();
    await expect(
      page.locator('button:has-text("Electrician")')
    ).toBeVisible();
  });
});

// ── Assistant flag ON ────────────────────────────────────────────────────────
test.describe("Assistant — flags ON", () => {
  test.skip(!FLAG_ON, "needs Phase 1 flag ON");
  test.skip(!ASSISTANT_FLAG_ON, "needs assistant flag ON");

  test("2) 'Apna kaam bol ke samjhaaye' button opens the assistant modal", async ({
    page,
  }) => {
    await installSpeechStub(page);
    await setupRegisterPage(page);
    await gotoPath(page, "/provider/register");
    const trigger = page.getByTestId("kk-work-intake-open-assistant");
    await expect(trigger).toBeVisible({ timeout: 5_000 });
    await trigger.click();
    await expect(page.getByTestId("kk-work-intake-assistant")).toBeVisible();
    await expect(page.getByTestId("kk-work-intake-assistant-mic")).toBeVisible();
    // Step 1 question is the first thing the provider sees.
    await expect(
      page.getByTestId("kk-work-intake-assistant-q1-prompt")
    ).toContainText("Aap apne mukhya kaam ke baare mein batayein");
    // Legacy inline UI absent.
    await expect(page.getByTestId("kk-work-intake-trigger")).toHaveCount(0);
    await expect(page.getByTestId("kk-bol-ke-samjhaaye")).toHaveCount(0);
  });

  test("3) guided Q1 + Q2 → green: combined transcript sent, confirm applies", async ({
    page,
  }) => {
    await installSpeechStub(page);
    const calls = await captureResolveCalls(page);
    await setupRegisterPage(page);
    await gotoPath(page, "/provider/register");
    await page.getByTestId("kk-work-intake-open-assistant").click();

    // Answer Q1.
    await page.getByTestId("kk-work-intake-assistant-mic").click();
    await emitFinal(page, "Main electrician ka kaam karta hu.");
    await page.getByTestId("kk-work-intake-assistant-mic").click(); // stop
    await page.getByTestId("kk-work-intake-assistant-next").click();

    // Q2 prompt now visible; the A1 echo persists above as a small bubble.
    await expect(
      page.getByTestId("kk-work-intake-assistant-q2-prompt")
    ).toContainText("Aapke is kaam ke daayre mein kya-kya kaam aate hain");
    await expect(page.getByTestId("kk-work-intake-assistant-a1")).toContainText(
      "Main electrician ka kaam karta hu"
    );

    // Answer Q2.
    await page.getByTestId("kk-work-intake-assistant-mic").click();
    await emitFinal(page, "Fan repair, cooler repair, wiring karta hu.");
    await page.getByTestId("kk-work-intake-assistant-mic").click();
    await page.getByTestId("kk-work-intake-assistant-process").click();

    // Combined payload sanity-check.
    await expect.poll(() => calls.length, { timeout: 5_000 }).toBeGreaterThan(0);
    expect(calls[calls.length - 1]).toContain("Mukhya kaam:");
    expect(calls[calls.length - 1]).toContain("Kaam ke daayre:");
    expect(calls[calls.length - 1]).toContain("Main electrician ka kaam karta hu");
    expect(calls[calls.length - 1]).toContain("Fan repair, cooler repair, wiring");

    // Green summary + Confirm closes the modal via the thanking screen.
    await expect(page.getByTestId("kk-work-intake-assistant-green")).toBeVisible();
    await page.getByTestId("kk-work-intake-assistant-confirm").click();
    // Thanking screen with the fixed message appears, then auto-closes.
    await expect(
      page.getByTestId("kk-work-intake-assistant-thanking-message")
    ).toContainText("Shukriya. Humne aapka kaam samajh liya hai");
    await expect(
      page.getByTestId("kk-work-intake-assistant-thanking-message")
    ).toContainText("Ab registration complete karne ke liye form submit karein");
    await expect(page.getByTestId("kk-work-intake-assistant")).toHaveCount(0, {
      timeout: 5_000,
    });
    // Canonical applied.
    await expect(
      page.locator('button:has-text("Electrician")').first()
    ).toBeVisible();
  });

  test("4) yellow clean proposal applies clean name; raw transcript stays off the wire", async ({
    page,
  }) => {
    const captured: { body?: Record<string, unknown> } = {};
    const A1 = "Main packing shifting ka kaam karta hu.";
    const A2 = "Ghar shifting, loading, unloading, packing karta hu.";
    await installSpeechStub(page);
    await mockResolve(page, {
      ok: true,
      safety: "yellow",
      blocked: false,
      fallbackToManual: false,
      reason: "OK",
      mainCategory: {
        canonical: "Packers & Movers",
        isExisting: false,
        confidence: 0.6,
      },
      workTags: [],
      requiresAdminReview: true,
      echo: ECHO,
    });
    await setupRegisterPage(page);
    await mockKkActions(page, {
      get_provider_by_phone: () => jsonOk({ provider: null }),
      get_areas: () => jsonOk({ areas: COMMON_AREAS }),
      provider_register: ({ body }) => {
        captured.body = body;
        return jsonOk({
          providerId: "PR-TEST-4",
          verified: "yes",
          pendingApproval: "yes",
          provider: { ProviderID: "PR-TEST-4", Status: "Pending Admin Approval" },
        });
      },
    });

    await gotoPath(page, "/provider/register");
    await page.getByTestId("kk-work-intake-open-assistant").click();
    await page.getByTestId("kk-work-intake-assistant-mic").click();
    await emitFinal(page, A1);
    await page.getByTestId("kk-work-intake-assistant-mic").click();
    await page.getByTestId("kk-work-intake-assistant-next").click();
    await page.getByTestId("kk-work-intake-assistant-mic").click();
    await emitFinal(page, A2);
    await page.getByTestId("kk-work-intake-assistant-mic").click();
    await page.getByTestId("kk-work-intake-assistant-process").click();

    await expect(page.getByTestId("kk-work-intake-assistant-yellow")).toBeVisible();
    await expect(
      page.getByTestId("kk-work-intake-assistant-proposal")
    ).toHaveText("Packers & Movers");

    await page.getByTestId("kk-work-intake-assistant-use-proposal").click();
    // Thanking screen, then auto-close.
    await expect(
      page.getByTestId("kk-work-intake-assistant-thanking")
    ).toBeVisible();
    await expect(page.getByTestId("kk-work-intake-assistant")).toHaveCount(0, {
      timeout: 5_000,
    });
    await expect(
      page.locator('button:has-text("Packers & Movers")')
    ).toBeVisible();

    // Submit and inspect payload.
    await page.getByPlaceholder("Enter your full name").fill("Test Provider");
    await page.getByRole("button", { name: /^Pick Region$/ }).first().click();
    await page.getByTestId("kk-pledge-checkbox").check();
    await page.getByRole("button", { name: /^Submit Application$/ }).click();
    await expect.poll(() => Boolean(captured.body), { timeout: 5_000 }).toBe(true);
    const body = captured.body ?? {};
    const pendingNew = JSON.parse(
      typeof body.pendingNewCategories === "string"
        ? body.pendingNewCategories
        : "[]"
    ) as string[];
    expect(pendingNew).toContain("Packers & Movers");
    expect(pendingNew).not.toContain(A1);
    expect(pendingNew).not.toContain(A2);
    const categoriesWire = JSON.parse(
      typeof body.categories === "string" ? body.categories : "[]"
    ) as string[];
    expect(categoriesWire).toContain("Packers & Movers");
  });

  test("5) multi-category: provider must choose ONE; only that canonical lands", async ({
    page,
  }) => {
    const captured: { body?: Record<string, unknown> } = {};
    await installSpeechStub(page);
    await mockResolve(page, {
      ok: true,
      safety: "yellow",
      blocked: false,
      fallbackToManual: false,
      reason: "OK",
      mainCategory: null,
      workTags: [],
      requiresAdminReview: false,
      possibleCategories: [
        { canonical: "Plumber", isExisting: true, confidence: 0.8 },
        { canonical: QA_CATEGORY, isExisting: true, confidence: 0.8 },
        { canonical: "Carpenter", isExisting: true, confidence: 0.8 },
      ],
      needsSingleCategoryChoice: true,
      echo: ECHO,
    });
    await setupRegisterPage(page);
    await mockKkActions(page, {
      get_provider_by_phone: () => jsonOk({ provider: null }),
      get_areas: () => jsonOk({ areas: COMMON_AREAS }),
      provider_register: ({ body }) => {
        captured.body = body;
        return jsonOk({
          providerId: "PR-TEST-5",
          verified: "yes",
          pendingApproval: "no",
          provider: { ProviderID: "PR-TEST-5", Status: "Active" },
        });
      },
    });

    await gotoPath(page, "/provider/register");
    await page.getByTestId("kk-work-intake-open-assistant").click();
    await page.getByTestId("kk-work-intake-assistant-mic").click();
    await emitFinal(page, "Main plumber electrician painting sab karta hu.");
    await page.getByTestId("kk-work-intake-assistant-mic").click();
    await page.getByTestId("kk-work-intake-assistant-next").click();
    await page.getByTestId("kk-work-intake-assistant-mic").click();
    await emitFinal(page, "Pipe repair, wiring aur wall painting karta hu.");
    await page.getByTestId("kk-work-intake-assistant-mic").click();
    await page.getByTestId("kk-work-intake-assistant-process").click();

    await expect(page.getByTestId("kk-work-intake-assistant-choose")).toBeVisible();
    await expect(
      page.getByTestId("kk-work-intake-assistant-choice")
    ).toHaveCount(3);

    await page
      .locator(
        '[data-testid="kk-work-intake-assistant-choice"][data-canonical="Electrician"]'
      )
      .click();

    // Thanking screen + auto-close.
    await expect(
      page.getByTestId("kk-work-intake-assistant-thanking")
    ).toBeVisible();
    await expect(page.getByTestId("kk-work-intake-assistant")).toHaveCount(0, {
      timeout: 5_000,
    });
    await expect(
      page.locator('button:has-text("Electrician")')
    ).toBeVisible();
    await expect(page.locator('button:has-text("Plumber")')).toHaveCount(0);
    await expect(page.locator('button:has-text("Carpenter")')).toHaveCount(0);

    await page.getByPlaceholder("Enter your full name").fill("Test Provider");
    await page.getByRole("button", { name: /^Pick Region$/ }).first().click();
    await page.getByTestId("kk-pledge-checkbox").check();
    await page.getByRole("button", { name: /^Submit Application$/ }).click();
    await expect.poll(() => Boolean(captured.body), { timeout: 5_000 }).toBe(true);
    const body = captured.body ?? {};
    const pendingNew = JSON.parse(
      typeof body.pendingNewCategories === "string"
        ? body.pendingNewCategories
        : "[]"
    ) as string[];
    expect(pendingNew).toEqual([]);
    const categoriesWire = JSON.parse(
      typeof body.categories === "string" ? body.categories : "[]"
    ) as string[];
    expect(categoriesWire).toEqual(["Electrician"]);
  });

  test("6) red unsafe: safety message renders; no category applied", async ({
    page,
  }) => {
    await installSpeechStub(page);
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
    await setupRegisterPage(page);
    await gotoPath(page, "/provider/register");
    await page.getByTestId("kk-work-intake-open-assistant").click();
    await page.getByTestId("kk-work-intake-assistant-mic").click();
    await emitFinal(page, "unsafe content");
    await page.getByTestId("kk-work-intake-assistant-mic").click();
    await page.getByTestId("kk-work-intake-assistant-next").click();
    await page.getByTestId("kk-work-intake-assistant-mic").click();
    await emitFinal(page, "more unsafe content");
    await page.getByTestId("kk-work-intake-assistant-mic").click();
    await page.getByTestId("kk-work-intake-assistant-process").click();

    await expect(page.getByTestId("kk-work-intake-assistant-red")).toBeVisible();
    // No thanking screen on red.
    await expect(
      page.getByTestId("kk-work-intake-assistant-thanking")
    ).toHaveCount(0);
    await page.getByTestId("kk-work-intake-assistant-close").click();
    await expect(page.getByTestId("kk-work-intake-assistant")).toHaveCount(0);
    await expect(page.locator('button:has-text("Electrician")')).toHaveCount(0);
  });

  test("7) permission denied: typed fallback follows the SAME Q1 + Q2 structure", async ({
    page,
  }) => {
    await installSpeechStub(page, { autoErrorOnStart: "not-allowed" });
    const calls = await captureResolveCalls(page);
    await setupRegisterPage(page);
    await gotoPath(page, "/provider/register");
    await page.getByTestId("kk-work-intake-open-assistant").click();

    // Q1 typed fallback.
    await page.getByTestId("kk-work-intake-assistant-mic").click();
    await expect(
      page.getByTestId("kk-work-intake-assistant-typed-fallback")
    ).toBeVisible();
    const typed1 = page.getByTestId("kk-work-intake-assistant-typed-input");
    await typed1.fill("Main electrician ka kaam karta hu");
    await page.getByTestId("kk-work-intake-assistant-typed-next").click();

    // Q2 typed fallback shown automatically (permission still denied).
    await expect(
      page.getByTestId("kk-work-intake-assistant-q2-prompt")
    ).toBeVisible();
    await expect(
      page.getByTestId("kk-work-intake-assistant-typed-fallback")
    ).toBeVisible();
    const typed2 = page.getByTestId("kk-work-intake-assistant-typed-input");
    await typed2.fill("Fan repair, cooler repair");
    await page.getByTestId("kk-work-intake-assistant-typed-process").click();

    await expect.poll(() => calls.length, { timeout: 5_000 }).toBeGreaterThan(0);
    const sent = calls[calls.length - 1];
    expect(sent).toContain("Mukhya kaam: Main electrician ka kaam karta hu");
    expect(sent).toContain("Kaam ke daayre: Fan repair, cooler repair");
    await expect(page.getByTestId("kk-work-intake-assistant-green")).toBeVisible();
  });

  test("8) unsupported browser: typed fallback follows the SAME Q1 + Q2 structure", async ({
    page,
  }) => {
    await installSpeechStub(page, { supported: false });
    const calls = await captureResolveCalls(page);
    await setupRegisterPage(page);
    await gotoPath(page, "/provider/register");
    await page.getByTestId("kk-work-intake-open-assistant").click();

    // No mic button at all on this path.
    await expect(
      page.getByTestId("kk-work-intake-assistant-mic")
    ).toHaveCount(0);

    const typed1 = page.getByTestId("kk-work-intake-assistant-typed-input");
    await typed1.fill("Main electrician ka kaam karta hu");
    await page.getByTestId("kk-work-intake-assistant-typed-next").click();
    const typed2 = page.getByTestId("kk-work-intake-assistant-typed-input");
    await typed2.fill("Fan repair, cooler repair, wiring");
    await page.getByTestId("kk-work-intake-assistant-typed-process").click();

    await expect.poll(() => calls.length, { timeout: 5_000 }).toBeGreaterThan(0);
    expect(calls[calls.length - 1]).toContain("Mukhya kaam:");
    expect(calls[calls.length - 1]).toContain("Kaam ke daayre:");
    await expect(page.getByTestId("kk-work-intake-assistant-green")).toBeVisible();
  });

  test("9) speak again clears the current step's answer", async ({ page }) => {
    await installSpeechStub(page);
    await setupRegisterPage(page);
    await gotoPath(page, "/provider/register");
    await page.getByTestId("kk-work-intake-open-assistant").click();
    await page.getByTestId("kk-work-intake-assistant-mic").click();
    await emitFinal(page, "first attempt");
    await page.getByTestId("kk-work-intake-assistant-mic").click();
    // Captured — speak-again wipes it back to idle so we can re-record.
    await expect(
      page.getByTestId("kk-work-intake-assistant-a1-preview")
    ).toBeVisible();
    await page.getByTestId("kk-work-intake-assistant-speak-again").click();
    await expect(
      page.getByTestId("kk-work-intake-assistant-a1-preview")
    ).toHaveCount(0);
    await expect(page.getByTestId("kk-work-intake-assistant-next")).toHaveCount(0);
  });

  test("10) edit transcript pre-fills the typed fallback with the captured speech", async ({
    page,
  }) => {
    await installSpeechStub(page);
    await setupRegisterPage(page);
    await gotoPath(page, "/provider/register");
    await page.getByTestId("kk-work-intake-open-assistant").click();
    await page.getByTestId("kk-work-intake-assistant-mic").click();
    await emitFinal(page, "main eletrician kaam");
    await page.getByTestId("kk-work-intake-assistant-mic").click();
    await page.getByTestId("kk-work-intake-assistant-edit").click();
    const typed = page.getByTestId("kk-work-intake-assistant-typed-input");
    await expect(typed).toHaveValue("main eletrician kaam");
    await typed.fill("main electrician kaam");
    await page.getByTestId("kk-work-intake-assistant-typed-next").click();
    await expect(
      page.getByTestId("kk-work-intake-assistant-a1")
    ).toContainText("main electrician kaam");
  });

  test("11) close without applying: form state unchanged", async ({ page }) => {
    await installSpeechStub(page);
    await setupRegisterPage(page);
    await gotoPath(page, "/provider/register");
    await page.getByTestId("kk-work-intake-open-assistant").click();
    await page.getByTestId("kk-work-intake-assistant-close").click();
    await expect(page.getByTestId("kk-work-intake-assistant")).toHaveCount(0);
    await expect(page.locator('button:has-text("Electrician")')).toHaveCount(0);
  });

  test("12) manual category search remains usable outside the assistant", async ({
    page,
  }) => {
    await installSpeechStub(page);
    await setupRegisterPage(page);
    await gotoPath(page, "/provider/register");
    await page.getByTestId("kk-category-search").fill("elec");
    await page.getByRole("button", { name: /^Electrician$/ }).click();
    await expect(
      page.locator('button:has-text("Electrician")')
    ).toBeVisible();
  });

  test("13) sentence guard still hides '+ Add as new service' under the assistant flag", async ({
    page,
  }) => {
    await installSpeechStub(page);
    await setupRegisterPage(page);
    await gotoPath(page, "/provider/register");
    await page
      .getByTestId("kk-category-search")
      .fill("main plumber electrician painting sab karta hu");
    await expect(
      page.getByTestId("kk-work-intake-sentence-hint")
    ).toBeVisible();
    await expect(
      page.getByTestId("kk-work-intake-sentence-hint")
    ).toContainText("Apna kaam bol ke samjhaaye");
    await expect(page.locator('button:has-text("+ Add")')).toHaveCount(0);

    // Short clean name remains addable.
    await page.getByTestId("kk-category-search").fill("Pet Grooming");
    await expect(page.locator('button:has-text("+ Add")')).toBeVisible();
  });

  test("14) thanking screen renders the fixed Hinglish message + post-submit reminder toast", async ({
    page,
  }) => {
    await installSpeechStub(page);
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
      workTags: [],
      requiresAdminReview: false,
      echo: ECHO,
    });
    await setupRegisterPage(page);
    await gotoPath(page, "/provider/register");
    await page.getByTestId("kk-work-intake-open-assistant").click();
    await page.getByTestId("kk-work-intake-assistant-mic").click();
    await emitFinal(page, "Main electrician ka kaam karta hu");
    await page.getByTestId("kk-work-intake-assistant-mic").click();
    await page.getByTestId("kk-work-intake-assistant-next").click();
    await page.getByTestId("kk-work-intake-assistant-mic").click();
    await emitFinal(page, "Fan repair");
    await page.getByTestId("kk-work-intake-assistant-mic").click();
    await page.getByTestId("kk-work-intake-assistant-process").click();
    await page.getByTestId("kk-work-intake-assistant-confirm").click();

    // Thanking screen visible with the exact message + pre-submit closer.
    await expect(
      page.getByTestId("kk-work-intake-assistant-thanking-message")
    ).toContainText("Shukriya. Humne aapka kaam samajh liya hai");
    await expect(
      page.getByTestId("kk-work-intake-assistant-thanking-message")
    ).toContainText("Kaun Karega jald hi aapko aise logon se jodne mein madad karega");
    await expect(
      page.getByTestId("kk-work-intake-assistant-thanking-message")
    ).toContainText("Ab registration complete karne ke liye form submit karein");

    // Modal auto-closes, page does NOT navigate, and the reminder toast
    // surfaces the same line.
    await expect(page.getByTestId("kk-work-intake-assistant")).toHaveCount(0, {
      timeout: 5_000,
    });
    await expect(page).toHaveURL(/\/provider\/register/);
    await expect(
      page.getByText("Ab registration complete karne ke liye form submit karein.")
    ).toBeVisible();
  });
});
