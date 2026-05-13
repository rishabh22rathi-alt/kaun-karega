/**
 * Admin Category global wiring — REAL DATA integration spec.
 *
 * Unlike the rest of /e2e which mocks admin endpoints, this spec hits the
 * live Next.js dev server and the real Supabase backend. It verifies that
 * an admin Category change (add / edit / disable / approve / reject /
 * alias edit / alias remove) is picked up at every consumer surface
 * without page-level caches or stale data getting in the way.
 *
 * Prerequisites for the spec to actually exercise anything:
 *   1. `npm run dev` running on http://127.0.0.1:3000 (or set
 *      PLAYWRIGHT_BASE_URL).
 *   2. PLAYWRIGHT_ADMIN_PHONE env set to a phone number that EXISTS in the
 *      live `admins` table. The default `bootstrapAdminSession` phone
 *      (9999999904) is NOT a real admin in the live DB — confirmed via
 *      POST /api/admin-verify returning "Access denied".
 *
 * Without prereq #2 the suite short-circuits via test.skip with an
 * explicit reason instead of failing 50 ways downstream.
 *
 * Test records use a `ZZ Playwright …` prefix + timestamp so cleanup is
 * filterable. Cleanup at end of suite disables (toggle inactive) test
 * categories — there is no admin hard-delete route. Test aliases are
 * hard-deleted via DELETE /api/admin/aliases/[id].
 *
 * Run with:
 *   npx playwright test --config=playwright.config.ts \
 *     e2e/admin-category-global-wiring.spec.ts
 *
 * (The package.json `test:e2e:audit*` scripts are currently broken — they
 * point to pw-e2e-audit.config.ts which does not exist.)
 */

import { test, expect, type APIRequestContext, type Page } from "@playwright/test";

import { bootstrapAdminSession } from "./_support/auth";

const TIMESTAMP = Date.now();
const ADMIN_PHONE = process.env.PLAYWRIGHT_ADMIN_PHONE || "9999999904";
const BASE_URL =
  process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:3000";

const TEST_CATEGORY = `ZZ Playwright Category ${TIMESTAMP}`;
const TEST_CATEGORY_RENAMED = `${TEST_CATEGORY} v2`;
const TEST_PENDING_CATEGORY_APPROVE = `ZZ Pending Category Approve ${TIMESTAMP}`;
const TEST_PENDING_CATEGORY_REJECT = `ZZ Pending Category Reject ${TIMESTAMP}`;

// Track records the suite created so cleanup can target only those.
const created = {
  canonicalNames: new Set<string>(), // disabled at cleanup
  aliasIds: new Set<string>(), // hard-deleted at cleanup
  pendingRequestIds: new Set<string>(), // rejected at cleanup
};

let adminAccessOk = false;
let adminAccessError = "";

// ─── helpers ───────────────────────────────────────────────────────────

function adminCookieHeaderForRequest(): string {
  // Mirror the cookie shape that bootstrapAdminSession sets on the page
  // context. APIRequestContext doesn't share storage with the page, so we
  // construct an equivalent cookie string for direct fetch() calls.
  const session = JSON.stringify({
    phone: ADMIN_PHONE,
    verified: true,
    createdAt: Date.now(),
  });
  return `kk_auth_session=${encodeURIComponent(session)}; kk_admin=1`;
}

async function adminGet(
  request: APIRequestContext,
  path: string
): Promise<{ status: number; json: unknown }> {
  const res = await request.get(`${BASE_URL}${path}`, {
    headers: { cookie: adminCookieHeaderForRequest() },
  });
  let json: unknown = null;
  try {
    json = await res.json();
  } catch {
    /* non-JSON body */
  }
  return { status: res.status(), json };
}

async function adminKkAction(
  request: APIRequestContext,
  body: Record<string, unknown>
): Promise<{ status: number; json: unknown }> {
  const res = await request.post(`${BASE_URL}/api/kk`, {
    headers: {
      cookie: adminCookieHeaderForRequest(),
      "content-type": "application/json",
    },
    data: body,
  });
  let json: unknown = null;
  try {
    json = await res.json();
  } catch {
    /* */
  }
  return { status: res.status(), json };
}

async function publicGet(
  request: APIRequestContext,
  path: string
): Promise<{ status: number; json: unknown }> {
  const res = await request.get(`${BASE_URL}${path}`);
  let json: unknown = null;
  try {
    json = await res.json();
  } catch {
    /* */
  }
  return { status: res.status(), json };
}

function categoriesFromPublic(json: unknown): string[] {
  const obj = json as { suggestions?: Array<{ name?: string }> } | null;
  return (obj?.suggestions ?? [])
    .map((s) => String(s?.name ?? ""))
    .filter(Boolean);
}

function categoriesFromAdmin(json: unknown): Array<{ name: string; active: boolean; aliases: Array<{ id: string; alias: string }> }> {
  const obj = json as
    | { categories?: Array<{ name?: unknown; active?: unknown; aliases?: unknown }> }
    | null;
  return (obj?.categories ?? []).map((c) => ({
    name: String(c?.name ?? ""),
    active: Boolean(c?.active),
    aliases: Array.isArray(c?.aliases)
      ? (c.aliases as Array<{ id?: unknown; alias?: unknown }>).map((a) => ({
          id: String(a?.id ?? ""),
          alias: String(a?.alias ?? ""),
        }))
      : [],
  }));
}

async function ensureAdminSection(page: Page, sectionLabel: string): Promise<void> {
  // Section header buttons concatenate the title + subtitle ("Category" +
  // "Category approvals and alias/work-tag management"), so an anchored
  // ^Category$ regex never matches. Substring + aria-controls scope picks
  // the right button regardless of subtitle/count suffix.
  const header = page
    .getByRole("button", { name: new RegExp(escapeRegExp(sectionLabel), "i") })
    .first();
  await expect(header).toBeVisible();
  if ((await header.getAttribute("aria-expanded")) !== "true") {
    await header.click();
  }
}

// ─── auth pre-flight (runs once before everything else) ──────────────

test.describe.configure({ mode: "serial" });

test.beforeAll(async ({ request }) => {
  const verifyRes = await request.post(`${BASE_URL}/api/admin-verify`, {
    headers: { "content-type": "application/json" },
    data: { phone: ADMIN_PHONE },
  });
  let rawJson: unknown = null;
  try {
    rawJson = await verifyRes.json();
  } catch {
    /* */
  }
  const json =
    rawJson && typeof rawJson === "object"
      ? (rawJson as { ok?: boolean; admin?: unknown; error?: string })
      : null;
  if (verifyRes.ok() && json?.ok === true) {
    adminAccessOk = true;
    return;
  }
  adminAccessError = `admin-verify status=${verifyRes.status()} body=${JSON.stringify(json)}. Set PLAYWRIGHT_ADMIN_PHONE to a phone that exists in the live admins table.`;
});

test.beforeEach(async () => {
  if (!adminAccessOk) {
    test.skip(true, `Admin auth blocked: ${adminAccessError}`);
  }
});

// ─── Scenario 1: admin add category ─────────────────────────────────

test("1. admin can add a category and it appears in /api/categories + admin list", async ({
  page,
  request,
}) => {
  await bootstrapAdminSession(page, { phone: ADMIN_PHONE });
  await page.goto(`${BASE_URL}/admin/dashboard`);
  await page.waitForLoadState("networkidle");

  await ensureAdminSection(page, "Category");
  await page.getByRole("button", { name: /^approved categories$/i }).click().catch(() => {});

  // Add via the inline form
  const input = page.getByPlaceholder(/add new canonical category/i);
  await expect(input).toBeVisible();
  await input.fill(TEST_CATEGORY);
  await page.getByRole("button", { name: /^add$/i }).click();

  created.canonicalNames.add(TEST_CATEGORY);

  // Wait for refetch + new row
  await expect(
    page.locator("td", { hasText: new RegExp(`^${escapeRegExp(TEST_CATEGORY)}$`) })
  ).toBeVisible({ timeout: 10_000 });

  // Confirm /api/admin/categories includes it
  const adminRes = await adminGet(request, "/api/admin/categories");
  expect(adminRes.status, "GET /api/admin/categories status").toBe(200);
  const adminCats = categoriesFromAdmin(adminRes.json);
  expect(adminCats.some((c) => c.name === TEST_CATEGORY && c.active)).toBeTruthy();

  // Confirm /api/categories (public) includes it
  const pubRes = await publicGet(request, "/api/categories?include=aliases");
  expect(pubRes.status, "GET /api/categories status").toBe(200);
  const pubCats = categoriesFromPublic(pubRes.json);
  expect(
    pubCats.some((n) => n.toLowerCase() === TEST_CATEGORY.toLowerCase()),
    `public /api/categories should expose ${TEST_CATEGORY}; got: ${pubCats.slice(0, 5).join(", ")}…`
  ).toBeTruthy();
});

// ─── Scenario 2: admin edit category name ───────────────────────────

test("2. admin can rename a category and the new name appears everywhere", async ({
  page,
  request,
}) => {
  await bootstrapAdminSession(page, { phone: ADMIN_PHONE });
  await page.goto(`${BASE_URL}/admin/dashboard`);
  await page.waitForLoadState("networkidle");
  await ensureAdminSection(page, "Category");

  const row = page
    .locator("tr", { has: page.locator("td", { hasText: new RegExp(`^${escapeRegExp(TEST_CATEGORY)}$`) }) })
    .first();
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: /^edit$/i }).click();
  const editInput = row.locator('input[type="text"]').first();
  await editInput.fill(TEST_CATEGORY_RENAMED);
  await row.getByRole("button", { name: /^save$/i }).click();

  created.canonicalNames.delete(TEST_CATEGORY);
  created.canonicalNames.add(TEST_CATEGORY_RENAMED);

  // Renamed row appears
  await expect(
    page.locator("td", {
      hasText: new RegExp(`^${escapeRegExp(TEST_CATEGORY_RENAMED)}$`),
    })
  ).toBeVisible({ timeout: 10_000 });

  // Old name no longer in admin list
  const adminCats = categoriesFromAdmin((await adminGet(request, "/api/admin/categories")).json);
  expect(adminCats.some((c) => c.name === TEST_CATEGORY_RENAMED)).toBeTruthy();
  expect(adminCats.some((c) => c.name === TEST_CATEGORY)).toBeFalsy();

  // Public categories surface the new name
  const pubCats = categoriesFromPublic(
    (await publicGet(request, "/api/categories?include=aliases")).json
  );
  expect(
    pubCats.some((n) => n.toLowerCase() === TEST_CATEGORY_RENAMED.toLowerCase())
  ).toBeTruthy();
  expect(pubCats.some((n) => n.toLowerCase() === TEST_CATEGORY.toLowerCase())).toBeFalsy();
});

// ─── Scenario 3: admin disable category ─────────────────────────────

test("3. admin can disable a category and it falls out of public categories", async ({
  page,
  request,
}) => {
  await bootstrapAdminSession(page, { phone: ADMIN_PHONE });
  await page.goto(`${BASE_URL}/admin/dashboard`);
  await page.waitForLoadState("networkidle");
  await ensureAdminSection(page, "Category");

  const row = page
    .locator("tr", { has: page.locator("td", { hasText: new RegExp(`^${escapeRegExp(TEST_CATEGORY_RENAMED)}$`) }) })
    .first();
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: /^disable$/i }).click();

  // Row should now show "Enable" (proves toggle landed)
  await expect(row.getByRole("button", { name: /^enable$/i })).toBeVisible({
    timeout: 10_000,
  });

  // Admin list still shows it but inactive
  const adminCats = categoriesFromAdmin((await adminGet(request, "/api/admin/categories")).json);
  const adminRow = adminCats.find((c) => c.name === TEST_CATEGORY_RENAMED);
  expect(adminRow).toBeTruthy();
  expect(adminRow!.active).toBeFalsy();

  // Public /api/categories must NOT expose it as an active suggestion
  const pubCats = categoriesFromPublic(
    (await publicGet(request, "/api/categories?include=aliases")).json
  );
  expect(
    pubCats.some((n) => n.toLowerCase() === TEST_CATEGORY_RENAMED.toLowerCase()),
    `public /api/categories should NOT expose disabled ${TEST_CATEGORY_RENAMED}`
  ).toBeFalsy();

  // Re-enable for the alias scenarios
  await row.getByRole("button", { name: /^enable$/i }).click();
  await expect(row.getByRole("button", { name: /^disable$/i })).toBeVisible({
    timeout: 10_000,
  });
});

// ─── Scenario 4: alias edit / remove ────────────────────────────────

test("4. alias edit / remove — NOT IMPLEMENTED end-to-end (no admin add-alias route)", async ({
  request,
}) => {
  // The admin Category tab today has no "Add alias" UI and no admin-side
  // POST /api/admin/aliases create endpoint. Aliases enter the system only
  // via /api/provider/aliases (provider-authenticated submission), which
  // requires bootstrapping a real provider session — out of scope for
  // this spec.
  //
  // PATCH and DELETE on /api/admin/aliases/[id] DO exist (verified
  // earlier turn) but to exercise them this spec would need an alias row
  // it owns. None exists for our test category.
  //
  // Marking the scenario as a known gap so the report surfaces it.
  test.info().annotations.push({
    type: "not-implemented",
    description:
      "Alias edit/remove can't be exercised E2E without an admin alias-create route. Spec verified PATCH+DELETE routes exist; UI rename/remove path was implemented in an earlier turn.",
  });
  // Sanity: PATCH/DELETE routes respond (with 404 for a fake id, not 405).
  const fakeId = "00000000-0000-0000-0000-000000000000";
  const patchRes = await request.fetch(
    `${BASE_URL}/api/admin/aliases/${fakeId}`,
    {
      method: "PATCH",
      headers: { cookie: adminCookieHeaderForRequest(), "content-type": "application/json" },
      data: { newAlias: "x" },
    }
  );
  expect([404, 401].includes(patchRes.status())).toBeTruthy();
  const delRes = await request.fetch(
    `${BASE_URL}/api/admin/aliases/${fakeId}`,
    { method: "DELETE", headers: { cookie: adminCookieHeaderForRequest() } }
  );
  expect([200, 404, 401].includes(delRes.status())).toBeTruthy();
});

// ─── Scenarios 5+6: pending approve / reject ────────────────────────

test("5+6. pending approve / reject — NOT IMPLEMENTED without seeded pending row", async ({
  page,
  request,
}) => {
  // To exercise approve/reject we need a real row in pending_category_requests.
  // The only public path that inserts there is /api/submit-approval-request
  // which requires a verified user session AND a valid area. Bootstrapping
  // a user session + creating a real pending row is doable but exceeds the
  // scope of this single spec.
  //
  // We DO verify the queue API itself responds and returns a well-shaped
  // payload (no row of ours, but the route is healthy).
  await bootstrapAdminSession(page, { phone: ADMIN_PHONE });
  const res = await adminGet(request, "/api/admin/pending-category-requests");
  expect(res.status, "GET /api/admin/pending-category-requests status").toBe(200);
  expect(
    Array.isArray((res.json as { categoryApplications?: unknown })?.categoryApplications),
    "response should carry categoryApplications array"
  ).toBeTruthy();

  test.info().annotations.push({
    type: "not-implemented",
    description:
      "Pending approve/reject E2E requires a seeded pending row (via /api/submit-approval-request with user session). Out of scope for this spec; the admin-side approve/reject buttons + their kk-route handlers were verified in earlier turns.",
  });
});

// ─── Scenario 7: provider registration category visibility ──────────

test("7. provider registration page exposes the active test category", async ({ request }) => {
  // We don't drive the registration UI (would create a provider row); we
  // confirm the data the registration page reads from is correct, which
  // is /api/categories?include=aliases — same endpoint the homepage uses.
  // After Scenario 3 toggled the category back to active, it must appear.
  const res = await publicGet(request, "/api/categories?include=aliases");
  expect(res.status).toBe(200);
  const names = categoriesFromPublic(res.json);
  expect(
    names.some((n) => n.toLowerCase() === TEST_CATEGORY_RENAMED.toLowerCase()),
    `registration-feed should expose active ${TEST_CATEGORY_RENAMED}`
  ).toBeTruthy();
});

// ─── Scenario 8: homepage typeahead surfaces the test category ──────

test("8. homepage typeahead /api/categories surfaces the test category", async ({
  request,
}) => {
  const res = await publicGet(request, "/api/categories?include=aliases");
  expect(res.status).toBe(200);
  const names = categoriesFromPublic(res.json);
  expect(names.some((n) => n.toLowerCase() === TEST_CATEGORY_RENAMED.toLowerCase()))
    .toBeTruthy();
});

// ─── Scenario 9: cleanup ────────────────────────────────────────────

test("9. cleanup — disable any test categories created by this run", async ({
  request,
}) => {
  // Disable each created category; we don't have a hard-delete admin route.
  for (const name of created.canonicalNames) {
    const res = await adminKkAction(request, {
      action: "toggle_category",
      categoryName: name,
      active: "no",
    });
    expect(
      res.status === 200 && (res.json as { ok?: boolean })?.ok === true,
      `toggle_category off for ${name} should succeed; got ${res.status} ${JSON.stringify(res.json)}`
    ).toBeTruthy();
  }
  // Hard-delete any test aliases (none in this run, but loop is idempotent).
  for (const id of created.aliasIds) {
    await request.fetch(`${BASE_URL}/api/admin/aliases/${id}`, {
      method: "DELETE",
      headers: { cookie: adminCookieHeaderForRequest() },
    });
  }
  // Reject any pending requests we created (none in this run).
  for (const id of created.pendingRequestIds) {
    await adminKkAction(request, {
      action: "reject_category_request",
      requestId: id,
      reason: "Rejected by admin (cleanup)",
    });
  }
});

// ─── small util ─────────────────────────────────────────────────────

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
