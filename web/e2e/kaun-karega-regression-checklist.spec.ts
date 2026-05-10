/**
 * Kaun Karega — Living Regression Checklist (Playwright)
 *
 * Purpose
 * -------
 * One spec file that doubles as an automated QA checklist. Each
 * test.describe block maps to a product surface; each test inside is
 * either an ACTIVE smoke check (safe to run anywhere, no DB / OTP /
 * WhatsApp dependencies) or a SKIPPED placeholder describing a flow
 * that needs auth, seeded data, or external systems before it can run.
 *
 * Add new entries here whenever a new flow ships. Never delete entries —
 * convert "skip" to "active" once the prerequisites land. Skipped tests
 * carry inline TODO comments naming the missing piece (test data, mock
 * route, fixture user, etc.) so a future engineer can fill the gap
 * without spelunking through git history.
 *
 * Hard rules
 * ----------
 * - No live OTP — every authenticated flow either uses an injected
 *   signed-cookie helper (TODO below) or stays skipped.
 * - No external WhatsApp / Twilio / Supabase write dependencies.
 * - Active tests must work against a freshly-booted dev server with no
 *   prior state.
 * - Skipped tests must include a `// TODO:` line stating exactly what is
 *   needed to enable them.
 *
 * Run command
 * -----------
 *   npx playwright test e2e/kaun-karega-regression-checklist.spec.ts
 *
 * Add `--project=...` and `--headed` flags as needed; this file does
 * not configure projects of its own.
 */

import { test, expect } from "@playwright/test";

// ─── Helpers ────────────────────────────────────────────────────────────────

// TODO (shared): when a signed-cookie session helper lands in
// web/e2e/_support/auth.ts that does NOT require a real OTP round-trip,
// import it here and unskip the auth-gated blocks below. Pattern in the
// existing admin specs (`makeSessionCookieValue` in admin-areas.spec.ts)
// is unsigned and only good enough for the UI hint cookie — the signed
// `kk_auth_session` requires AUTH_SESSION_SECRET and an HMAC sign step
// that the test runner does not currently perform.

// ─── 1. Homepage smoke ──────────────────────────────────────────────────────

test.describe("Homepage smoke", () => {
  test("loads with the wordmark and search input visible", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText(/KAREGA/i).first()).toBeVisible();
    await expect(
      page.getByPlaceholder(/What service do you need\?/i)
    ).toBeVisible();
  });

  test("popular-search chips render under the search bar", async ({ page }) => {
    await page.goto("/");
    // The "Popular" label and at least one chip ("Electrician") are
    // statically rendered server-side and don't need any interaction.
    await expect(page.getByText(/Popular/i).first()).toBeVisible();
    await expect(
      page.getByRole("button", { name: /^Electrician$/ })
    ).toBeVisible();
  });

  test("how-it-works section is rendered for first-time visitors", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(page.getByText(/How it works/i)).toBeVisible();
    await expect(page.getByText(/Post your task/i)).toBeVisible();
  });

  test.skip("typing a service shows alias-aware suggestions", async () => {
    // TODO: stub /api/categories?include=aliases with a deterministic
    // suggestions[] payload (canonical "Welder" + alias "lohar" → "Welder")
    // before this can run reliably. Until then, the dropdown contents
    // depend on live DB rows and would flake across environments.
  });

  test.skip("submitting redirects unauthenticated users to /login with next param", async () => {
    // TODO: needs a stable session-less path. The current submit handler
    // saves a sessionStorage draft and redirects; assert query string is
    // exactly /login?next=/. Safe to enable once the homepage form
    // selectors are tagged with data-testid attributes (see selector
    // recommendations at the bottom of this file).
  });
});

// ─── 2. User disclaimer flow ────────────────────────────────────────────────

test.describe("User disclaimer flow", () => {
  test("/disclaimer page renders the legal text and version", async ({
    page,
  }) => {
    await page.goto("/disclaimer");
    await expect(page.getByRole("heading", { name: /Disclaimer/i })).toBeVisible();
    await expect(page.getByText(/Version v1/i)).toBeVisible();
    // Spot-check one verbatim phrase from DISCLAIMER_TEXT in lib/disclaimer.ts.
    await expect(
      page.getByText(/Kaun Karega is a platform that helps users connect/i)
    ).toBeVisible();
  });

  test.skip("soft modal appears ~1s after homepage mount when not fresh", async () => {
    // TODO: needs an authenticated session cookie + a profiles row whose
    // disclaimer_accepted_at is NULL or stale. Mock /api/user/disclaimer
    // GET to return { ok:true, isFresh:false } and assert the modal
    // heading "Disclaimer & Important Notice" appears within 1500ms.
  });

  test.skip("Later closes the soft modal and does not reopen during the same mount", async () => {
    // TODO: same prerequisites as above. Assert that after clicking
    // "Later", waiting another 2s does NOT re-show the modal. This
    // verifies the dismissedSoftRef behaviour.
  });

  test.skip("submit when not fresh opens the BLOCKING modal silently", async () => {
    // TODO: requires authenticated session + filled form (category, time,
    // area). Mock /api/submit-request to return 403 DISCLAIMER_REQUIRED.
    // Assert: no red "submission failed" banner, no debug pre tag, modal
    // opens with "I Understand & Continue" and NO "Later" button.
  });

  test.skip("Accept retries the queued submission on first click", async () => {
    // TODO: continuation of the above. After the modal opens via 403,
    // mock /api/user/disclaimer POST → 200 and /api/submit-request → 200.
    // Click I Understand exactly once and assert navigation to /success.
    // Regression test for the stale-closure bug (page.tsx acceptDisclaimer
    // retry path).
  });

  test.skip("localStorage drift is overridden by server", async () => {
    // TODO: pre-seed localStorage.kk_disclaimer_accepted with a fresh-looking
    // record. Mock /api/user/disclaimer GET to return isFresh:false. Reload
    // and assert the soft modal appears AND localStorage no longer contains
    // the key (Phase A drift fix).
  });
});

// ─── 3. Provider registration pledge ────────────────────────────────────────

test.describe("Provider registration pledge", () => {
  test("unauthenticated visitor to /provider/register is redirected to login", async ({
    page,
  }) => {
    await page.goto("/provider/register");
    // The provider register page bounces unauthenticated users into the
    // login flow. Asserting on the URL avoids depending on the login
    // page's exact heading copy.
    await expect(page).toHaveURL(/\/login(\?|$)/);
  });

  test.skip("pledge card is rendered on a fresh registration", async () => {
    // TODO: needs authenticated session for a phone NOT yet in providers.
    // Assert: the pledge card heading "Provider Responsibility Pledge"
    // is visible, the checkbox is unchecked, the trust line "This helps
    // keep Kaun Karega safe and trustworthy for everyone." is visible.
  });

  test.skip("clicking Submit with the box unchecked shows inline red text", async () => {
    // TODO: same prereq. Fill name + category + area, leave checkbox
    // unchecked, click Submit. Assert: button is NOT disabled (still
    // clickable per Phase 3 UX rule), and the inline error
    // "Please accept the Provider Responsibility Pledge to continue."
    // appears. No /api/kk POST should fire — verify via request listener.
  });

  test.skip("ticking the box clears the inline error", async () => {
    // TODO: continuation. After triggering the inline error above, click
    // the checkbox. The red text should disappear immediately (handler
    // clears pledgeError on check).
  });

  test.skip("registering with the box ticked posts pledgeVersion:'v1'", async () => {
    // TODO: full happy path. Intercept /api/kk POST and assert the body
    // contains { action: 'provider_register', pledgeVersion: 'v1' } and
    // crucially does NOT contain pledgeAcceptedAt (server timestamps).
  });

  test.skip("edit-mode does NOT render the pledge card", async () => {
    // TODO: requires an authenticated session for a phone that ALREADY
    // exists in providers. Visit the edit URL and assert the pledge card
    // heading is NOT present, the edit save flow goes through
    // /api/provider/update (not /api/kk), and pledge_* columns are not
    // touched.
  });

  test.skip("backend rejects missing pledgeVersion with 400 pledge_required", async () => {
    // TODO: API-only check. Synthesize a /api/kk provider_register POST
    // with a brand-new phone but no pledgeVersion. Expect status 400 and
    // body { ok:false, error:'pledge_required' }. Existing-phone replays
    // must still 409 already_registered (verifies gate ordering).
  });
});

// ─── 4. Provider chat pledge gate ───────────────────────────────────────────

test.describe("Provider chat pledge gate", () => {
  test.skip("legacy provider opens chat from /provider/dashboard → modal appears", async () => {
    // TODO: needs a seeded provider row with NULL pledge_version /
    // pledge_accepted_at AND at least one matched task ID rendered on
    // the dashboard. Click Chat → assert ProviderPledgeModal heading
    // "Provider Responsibility Pledge" is visible. No /chat/thread/
    // navigation should have happened yet.
  });

  test.skip("Accept fires POST /api/provider/pledge {version:'v1'} with no client timestamp", async () => {
    // TODO: continuation. Intercept the request body and assert it
    // contains version:'v1' and DOES NOT contain pledge_accepted_at.
    // Server stamps the timestamp.
  });

  test.skip("Accept retries the queued chat-thread call on first click", async () => {
    // TODO: continuation. After Accept, assert navigation to
    // /chat/thread/<threadId>. Regression test for the
    // pendingChatRef closure pattern in openThreadAndNavigate.
  });

  test.skip("legacy provider on /respond/[taskId]/[providerId] dismiss → /provider/dashboard", async () => {
    // TODO: needs a deeplink-able task and seeded provider. Click X on
    // the modal and assert URL becomes /provider/dashboard (deeplink-
    // specific dismiss handling).
  });

  test.skip("403 PLEDGE_REQUIRED never surfaces 'Unable to open chat' toast", async () => {
    // TODO: across all four entry points (dashboard, my-jobs,
    // job-requests, respond/[taskId]/[providerId]) verify that the
    // existing per-task chatError text stays empty when the modal
    // opens. The pledge gate must be SILENT.
  });

  test.skip("after acceptance, subsequent chats fast-pass with no modal", async () => {
    // TODO: continuation. Open a second task's chat from any of the
    // four entry points and assert the modal does NOT appear. Server
    // returns 200 directly because pledge_* are now populated.
  });

  test.skip("forged chat_create_or_get_thread without UI gate still 403s", async () => {
    // TODO: API-only. With a legacy-provider session cookie, POST
    // /api/kk { action:'chat_create_or_get_thread', ActorType:'provider',
    // TaskID:'<seeded>' } and assert status 403, body
    // { ok:false, error:'PLEDGE_REQUIRED' }. Server-side enforcement
    // sanity check.
  });

  test.skip("/api/tasks/respond is NOT gated by pledge", async () => {
    // TODO: API-only. Same legacy provider, POST /api/tasks/respond.
    // Should succeed regardless of pledge state. Phase B comment
    // documents this asymmetry.
  });
});

// ─── 5. User chat unaffected ────────────────────────────────────────────────

test.describe("User chat is unaffected by provider pledge gate", () => {
  test.skip("user opens a chat with ActorType:'user' → no pledge modal", async () => {
    // TODO: seeded user (task owner) + a legacy provider on the same
    // task. Open the chat from the user side and assert NO pledge
    // modal appears. Phase B's gate is conditioned on
    // ActorType==='provider' AND identity.provider !== null.
  });

  test.skip("user with a provider account chatting their own task as user → no modal", async () => {
    // TODO: edge case — same human is both task owner and a registered
    // provider. Their user-actor chat must not be gated. ActorType:'user'
    // body field is honored even when the session also resolves as a
    // provider.
  });

  test.skip("user-side chat thread page renders quick replies for user role", async () => {
    // TODO: assert /chat/thread/<id> renders the USER_QUICK_REPLIES set
    // (not provider). Selector recommendations below.
  });
});

// ─── 6. Admin smoke ─────────────────────────────────────────────────────────

test.describe("Admin smoke", () => {
  test("/admin/login page renders without crashing", async ({ page }) => {
    await page.goto("/admin/login");
    // Don't assert on exact copy — admin login page may evolve. Just
    // verify the page didn't 500 and contains some authentication-
    // related affordance.
    await expect(page.locator("body")).toBeVisible();
    await expect(
      page.getByRole("textbox").or(page.getByPlaceholder(/phone|number/i))
    ).toBeVisible();
  });

  test.skip("/admin/dashboard renders Category and Providers tabs when admin-cookied", async () => {
    // TODO: needs an admin-injected cookie pair (kk_auth_session signed
    // with AUTH_SESSION_SECRET + kk_admin=1). Existing admin specs use
    // route interception to bypass the GAS check — replicate that
    // pattern in this file's helpers section once the signed-cookie
    // helper lands.
  });

  test.skip("CategoryTab '+ Add alias / work tag' surfaces on a category row", async () => {
    // TODO: continuation. With admin session, expand a category, click
    // the dashed "+ Add alias / work tag" pill, fill text, choose
    // alias_type, click Save. Assert /api/admin/aliases POST body has
    // action:'create' and the new chip appears on refresh.
  });

  test.skip("admin alias create with duplicate text returns DUPLICATE_ACTIVE_ALIAS inline", async () => {
    // TODO: continuation. Use a known-active alias text and assert the
    // inline error renders without leaving the form open in a stuck
    // state.
  });
});

// ─── 7. Mobile smoke ────────────────────────────────────────────────────────

test.describe("Mobile smoke (viewport 375×812)", () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test("homepage hero fits on a small screen and search input is reachable", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(page.getByText(/KAREGA/i).first()).toBeVisible();
    const searchInput = page.getByPlaceholder(/What service do you need\?/i);
    await expect(searchInput).toBeVisible();
    // Mobile sanity: input is interactable (not visually clipped behind
    // the typewriter overlay or the hero wordmark).
    await searchInput.click();
    await expect(searchInput).toBeFocused();
  });

  test("/disclaimer page is readable on mobile", async ({ page }) => {
    await page.goto("/disclaimer");
    await expect(page.getByRole("heading", { name: /Disclaimer/i })).toBeVisible();
  });

  test.skip("user disclaimer modal scrolls inside the card on mobile", async () => {
    // TODO: same prereqs as the desktop disclaimer modal tests. Once
    // enabled, assert that scrolling inside the modal body works and
    // that the page behind is locked (overflow:hidden on body).
  });

  test.skip("provider pledge modal scrolls inside the card on mobile", async () => {
    // TODO: same prereqs as the provider chat pledge tests. Assert
    // max-h-[80vh] body scroll behaviour on small viewports.
  });
});
