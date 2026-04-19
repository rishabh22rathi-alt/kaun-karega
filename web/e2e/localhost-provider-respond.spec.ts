/**
 * LOCALHOST TEST: Provider Response Flow (post-Supabase migration)
 *
 * Submits a real task via API, then opens the respond page and checks result.
 * Run: npx playwright test e2e/localhost-provider-respond.spec.ts --reporter=line
 */

import { test, expect } from "@playwright/test";

const BASE = "http://localhost:3000";
const PROVIDER_ID = "PR-TEST-1";

function makeSession(phone = "9509597100") {
  return encodeURIComponent(
    JSON.stringify({ phone, verified: true, createdAt: Date.now() })
  );
}

test("provider respond page — full flow", async ({ page }) => {
  const sessionCookie = makeSession();

  // ── Step 1: Submit a real task via API ──────────────────────────────────
  const submitRes = await page.request.post(`${BASE}/api/submit-request`, {
    data: {
      category: "Pre School",
      area: "Pratap Nagar",
      details: "Playwright test - provider respond flow. Please ignore.",
      time: "Flexible",
    },
    headers: {
      "Content-Type": "application/json",
      Cookie: `kk_auth_session=${sessionCookie}`,
    },
  });

  const submitBody = await submitRes.json() as { ok?: boolean; taskId?: string; displayId?: string; error?: string };
  console.log("\n[Step 1] submit-request status:", submitRes.status());
  console.log("[Step 1] submit-request body:", JSON.stringify(submitBody));

  expect(submitRes.status(), `submit-request returned non-200`).toBe(200);
  expect(submitBody.ok, `submit-request failed: ${submitBody.error}`).toBe(true);

  const taskId = submitBody.taskId ?? "";
  expect(taskId, "taskId missing from submit response").toMatch(/^TK-\d+$/);
  console.log("[Step 1] ✅ Task created. taskId:", taskId, "displayId:", submitBody.displayId);

  // ── Step 2: Intercept /api/tasks/respond network call ───────────────────
  let respondStatus = 0;
  let respondBody: Record<string, unknown> | null = null;

  page.on("response", async (res) => {
    if (res.url().includes("/api/tasks/respond")) {
      respondStatus = res.status();
      try {
        respondBody = await res.json() as Record<string, unknown>;
      } catch {
        respondBody = null;
      }
      console.log("\n[Step 2] /api/tasks/respond HTTP status:", respondStatus);
      console.log("[Step 2] /api/tasks/respond body:", JSON.stringify(respondBody));
    }
  });

  // ── Step 3: Open the respond page ───────────────────────────────────────
  const respondUrl = `${BASE}/respond/${taskId}/${PROVIDER_ID}`;
  console.log("\n[Step 3] Opening:", respondUrl);

  await page.context().addCookies([
    { name: "kk_auth_session", value: sessionCookie, url: BASE, sameSite: "Lax" },
  ]);
  await page.goto(respondUrl);

  // Wait for the page to fire the API call and settle
  await page.waitForTimeout(5_000);

  // ── Step 4: Inspect page state ──────────────────────────────────────────
  const bodyText = await page.locator("body").innerText();
  console.log("\n[Step 4] Page visible text:\n", bodyText.trim());

  const errorEl = page.locator("p").filter({ hasText: /task not found|provider not found|unable|error|failed/i });
  if (await errorEl.count() > 0) {
    const errText = await errorEl.first().innerText();
    console.error("[Step 4] ❌ Error text on page:", errText);
  }

  // ── Step 5: Assert success ───────────────────────────────────────────────
  const successEl = page.locator("text=Thanks, your response is recorded");
  const isSuccess = await successEl.isVisible().catch(() => false);

  console.log("\n[Step 5] Success message visible:", isSuccess);
  console.log("[Step 5] /api/tasks/respond success field:", respondBody ? (respondBody as { success?: boolean }).success : "not captured");

  expect(isSuccess, "Success message not shown on page").toBe(true);
  expect(respondBody, "/api/tasks/respond response not captured").not.toBeNull();
  expect((respondBody as { success?: boolean }).success, `/api/tasks/respond returned success=false. Body: ${JSON.stringify(respondBody)}`).toBe(true);

  console.log("\n✅ PASS: Provider response flow works end to end.");
});
