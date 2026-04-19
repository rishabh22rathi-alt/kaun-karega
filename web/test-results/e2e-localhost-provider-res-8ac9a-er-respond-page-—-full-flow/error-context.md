# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: e2e\localhost-provider-respond.spec.ts >> provider respond page — full flow
- Location: e2e\localhost-provider-respond.spec.ts:19:5

# Error details

```
Error: Success message not shown on page

expect(received).toBe(expected) // Object.is equality

Expected: true
Received: false
```

# Page snapshot

```yaml
- generic [active] [ref=e1]:
  - generic [ref=e2]:
    - complementary [ref=e3]:
      - generic [ref=e4]:
        - generic [ref=e5]:
          - paragraph [ref=e6]: Kaun Karega
          - paragraph [ref=e7]: Hi! +91 9509597100
        - button "Collapse sidebar" [ref=e9]:
          - img [ref=e10]
      - navigation [ref=e12]:
        - generic [ref=e13]:
          - button "I NEED" [ref=e15]:
            - img [ref=e16]
            - generic [ref=e19]: I NEED
            - img [ref=e20]
          - link "Home" [ref=e22] [cursor=pointer]:
            - /url: /
            - img [ref=e24]
            - generic [ref=e27]: Home
        - link "My Requests" [ref=e29] [cursor=pointer]:
          - /url: /dashboard/my-requests
          - img [ref=e31]
          - generic [ref=e34]: My Requests
        - link "My Needs" [ref=e36] [cursor=pointer]:
          - /url: /i-need/my-needs
          - img [ref=e38]
          - generic [ref=e41]: My Needs
        - link "Report an Issue" [ref=e43] [cursor=pointer]:
          - /url: /report-issue
          - img [ref=e45]
          - generic [ref=e47]: Report an Issue
        - button "Logout" [ref=e48]:
          - img [ref=e49]
          - generic [ref=e52]: Logout
    - main [ref=e54]:
      - generic [ref=e55]:
        - generic [ref=e56]:
          - paragraph [ref=e57]: Kaun Karega
          - heading "Job Response" [level=1] [ref=e58]
        - paragraph [ref=e59]: Task not found
  - generic [ref=e64] [cursor=pointer]:
    - button "Open Next.js Dev Tools" [ref=e65]:
      - img [ref=e66]
    - generic [ref=e69]:
      - button "Open issues overlay" [ref=e70]:
        - generic [ref=e71]:
          - generic [ref=e72]: "1"
          - generic [ref=e73]: "2"
        - generic [ref=e74]:
          - text: Issue
          - generic [ref=e75]: s
      - button "Collapse issues badge" [ref=e76]:
        - img [ref=e77]
  - alert [ref=e79]
```

# Test source

```ts
  1  | /**
  2  |  * LOCALHOST TEST: Provider Response Flow (post-Supabase migration)
  3  |  *
  4  |  * Submits a real task via API, then opens the respond page and checks result.
  5  |  * Run: npx playwright test e2e/localhost-provider-respond.spec.ts --reporter=line
  6  |  */
  7  | 
  8  | import { test, expect } from "@playwright/test";
  9  | 
  10 | const BASE = "http://localhost:3000";
  11 | const PROVIDER_ID = "PR-TEST-1";
  12 | 
  13 | function makeSession(phone = "9509597100") {
  14 |   return encodeURIComponent(
  15 |     JSON.stringify({ phone, verified: true, createdAt: Date.now() })
  16 |   );
  17 | }
  18 | 
  19 | test("provider respond page — full flow", async ({ page }) => {
  20 |   const sessionCookie = makeSession();
  21 | 
  22 |   // ── Step 1: Submit a real task via API ──────────────────────────────────
  23 |   const submitRes = await page.request.post(`${BASE}/api/submit-request`, {
  24 |     data: {
  25 |       category: "Pre School",
  26 |       area: "Pratap Nagar",
  27 |       details: "Playwright test - provider respond flow. Please ignore.",
  28 |       time: "Flexible",
  29 |     },
  30 |     headers: {
  31 |       "Content-Type": "application/json",
  32 |       Cookie: `kk_auth_session=${sessionCookie}`,
  33 |     },
  34 |   });
  35 | 
  36 |   const submitBody = await submitRes.json() as { ok?: boolean; taskId?: string; displayId?: string; error?: string };
  37 |   console.log("\n[Step 1] submit-request status:", submitRes.status());
  38 |   console.log("[Step 1] submit-request body:", JSON.stringify(submitBody));
  39 | 
  40 |   expect(submitRes.status(), `submit-request returned non-200`).toBe(200);
  41 |   expect(submitBody.ok, `submit-request failed: ${submitBody.error}`).toBe(true);
  42 | 
  43 |   const taskId = submitBody.taskId ?? "";
  44 |   expect(taskId, "taskId missing from submit response").toMatch(/^TK-\d+$/);
  45 |   console.log("[Step 1] ✅ Task created. taskId:", taskId, "displayId:", submitBody.displayId);
  46 | 
  47 |   // ── Step 2: Intercept /api/tasks/respond network call ───────────────────
  48 |   let respondStatus = 0;
  49 |   let respondBody: Record<string, unknown> | null = null;
  50 | 
  51 |   page.on("response", async (res) => {
  52 |     if (res.url().includes("/api/tasks/respond")) {
  53 |       respondStatus = res.status();
  54 |       try {
  55 |         respondBody = await res.json() as Record<string, unknown>;
  56 |       } catch {
  57 |         respondBody = null;
  58 |       }
  59 |       console.log("\n[Step 2] /api/tasks/respond HTTP status:", respondStatus);
  60 |       console.log("[Step 2] /api/tasks/respond body:", JSON.stringify(respondBody));
  61 |     }
  62 |   });
  63 | 
  64 |   // ── Step 3: Open the respond page ───────────────────────────────────────
  65 |   const respondUrl = `${BASE}/respond/${taskId}/${PROVIDER_ID}`;
  66 |   console.log("\n[Step 3] Opening:", respondUrl);
  67 | 
  68 |   await page.context().addCookies([
  69 |     { name: "kk_auth_session", value: sessionCookie, url: BASE, sameSite: "Lax" },
  70 |   ]);
  71 |   await page.goto(respondUrl);
  72 | 
  73 |   // Wait for the page to fire the API call and settle
  74 |   await page.waitForTimeout(5_000);
  75 | 
  76 |   // ── Step 4: Inspect page state ──────────────────────────────────────────
  77 |   const bodyText = await page.locator("body").innerText();
  78 |   console.log("\n[Step 4] Page visible text:\n", bodyText.trim());
  79 | 
  80 |   const errorEl = page.locator("p").filter({ hasText: /task not found|provider not found|unable|error|failed/i });
  81 |   if (await errorEl.count() > 0) {
  82 |     const errText = await errorEl.first().innerText();
  83 |     console.error("[Step 4] ❌ Error text on page:", errText);
  84 |   }
  85 | 
  86 |   // ── Step 5: Assert success ───────────────────────────────────────────────
  87 |   const successEl = page.locator("text=Thanks, your response is recorded");
  88 |   const isSuccess = await successEl.isVisible().catch(() => false);
  89 | 
  90 |   console.log("\n[Step 5] Success message visible:", isSuccess);
  91 |   console.log("[Step 5] /api/tasks/respond success field:", respondBody ? (respondBody as { success?: boolean }).success : "not captured");
  92 | 
> 93 |   expect(isSuccess, "Success message not shown on page").toBe(true);
     |                                                          ^ Error: Success message not shown on page
  94 |   expect(respondBody, "/api/tasks/respond response not captured").not.toBeNull();
  95 |   expect((respondBody as { success?: boolean }).success, `/api/tasks/respond returned success=false. Body: ${JSON.stringify(respondBody)}`).toBe(true);
  96 | 
  97 |   console.log("\n✅ PASS: Provider response flow works end to end.");
  98 | });
  99 | 
```