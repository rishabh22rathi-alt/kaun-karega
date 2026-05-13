/**
 * E2E: Admin Dashboard — Areas & Alias Management
 *
 * Uses route interception to bypass the GAS-based admin session check while
 * exercising the real Next.js UI and state management logic.
 *
 * All created entries are prefixed ZZ QA — safe to clean up later.
 */

import { test, expect, Page, Route } from "@playwright/test";

// ─── Auth cookie helpers ────────────────────────────────────────────────────

function makeSessionCookieValue(phone = "9999999999"): string {
  const session = JSON.stringify({ phone, verified: true, createdAt: Date.now() });
  return encodeURIComponent(session);
}

async function injectAdminCookies(page: Page) {
  // Set HTTP cookies for the Next.js middleware guard (kk_auth_session + kk_admin=1)
  await page.context().addCookies([
    {
      name: "kk_auth_session",
      value: makeSessionCookieValue(),
      url: "https://kaun-karega.vercel.app",
      sameSite: "Lax",
    },
    {
      name: "kk_admin",
      value: "1",
      url: "https://kaun-karega.vercel.app",
      sameSite: "Lax",
    },
  ]);

  // Set localStorage for the client-side AdminLayoutClient guard.
  // AdminLayoutClient reads localStorage("kk_admin_session") on mount and
  // redirects to /login if isAdmin !== true — must be injected before any
  // page script runs using addInitScript.
  await page.addInitScript(() => {
    localStorage.setItem(
      "kk_admin_session",
      JSON.stringify({ isAdmin: true, name: "QA Admin", role: "admin", permissions: [] })
    );
  });
}

// ─── In-memory state for mocked GAS backend ─────────────────────────────────

type AliasEntry = { AliasName: string; Active: string };
type AreaMapping = { CanonicalArea: string; Active: string; Aliases: AliasEntry[]; AliasCount: number };

const state = {
  areas: [] as AreaMapping[],

  getMapping(): AreaMapping[] {
    return this.areas.map((a) => ({
      ...a,
      AliasCount: a.Aliases.length,
    }));
  },

  addArea(name: string): { ok: boolean; error?: string } {
    const existing = this.areas.find(
      (a) => a.CanonicalArea.trim().toLowerCase() === name.trim().toLowerCase()
    );
    if (existing) return { ok: false, error: "Area already exists" };
    this.areas.push({
      CanonicalArea: name.trim(),
      Active: "yes",
      Aliases: [],
      AliasCount: 0,
    });
    return { ok: true };
  },

  addAlias(canonicalArea: string, aliasName: string): { ok: boolean; error?: string } {
    const area = this.areas.find(
      (a) => a.CanonicalArea.trim().toLowerCase() === canonicalArea.trim().toLowerCase()
    );
    if (!area) return { ok: false, error: "Canonical area not found" };
    const dup = area.Aliases.find(
      (al) => al.AliasName.trim().toLowerCase() === aliasName.trim().toLowerCase()
    );
    if (dup) return { ok: false, error: "Alias already exists" };
    area.Aliases.push({ AliasName: aliasName.trim(), Active: "yes" });
    return { ok: true };
  },

  updateAlias(
    oldAliasName: string,
    newAliasName: string,
    canonicalArea: string
  ): { ok: boolean; error?: string } {
    const area = this.areas.find(
      (a) => a.CanonicalArea.trim().toLowerCase() === canonicalArea.trim().toLowerCase()
    );
    if (!area) return { ok: false, error: "Canonical area not found" };
    // Duplicate check — does newAliasName already exist in any area?
    for (const a of this.areas) {
      if (a.Aliases.some((al) => al.AliasName.trim().toLowerCase() === newAliasName.trim().toLowerCase())) {
        return { ok: false, error: "Alias already exists" };
      }
    }
    const alias = area.Aliases.find(
      (al) => al.AliasName.trim().toLowerCase() === oldAliasName.trim().toLowerCase()
    );
    if (!alias) return { ok: false, error: "Alias not found" };
    alias.AliasName = newAliasName.trim();
    return { ok: true };
  },
};

// ─── Route interception setup ────────────────────────────────────────────────

async function setupRouteInterception(page: Page) {
  // Mock admin stats (GET /api/admin/stats → proxies to /api/kk with admin_get_dashboard)
  await page.route("**/api/admin/stats", async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        stats: {
          totalProviders: 0,
          verifiedProviders: 0,
          pendingAdminApprovals: 0,
          pendingCategoryRequests: 0,
        },
        providers: [],
        categoryApplications: [],
        categories: [],
        areas: [],
      }),
    });
  });

  // Mock all /api/kk POST calls
  await page.route("**/api/kk", async (route: Route, request) => {
    let body: Record<string, unknown> = {};
    try {
      body = JSON.parse(request.postData() || "{}");
    } catch {
      // ignore parse errors
    }
    const action = (body.action as string) || "";

    if (action === "admin_get_requests") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, requests: [], metrics: {} }),
      });
      return;
    }

    if (action === "admin_get_notification_logs") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, logs: [] }),
      });
      return;
    }

    if (action === "get_admin_area_mappings" || action === "admin_get_area_mappings") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, mappings: state.getMapping() }),
      });
      return;
    }

    if (action === "admin_get_unmapped_areas") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, reviews: [] }),
      });
      return;
    }

    if (action === "add_area" || action === "admin_add_area") {
      const result = state.addArea(body.areaName as string);
      await route.fulfill({
        status: result.ok ? 200 : 400,
        contentType: "application/json",
        body: JSON.stringify(result),
      });
      return;
    }

    if (action === "admin_add_area_alias") {
      const result = state.addAlias(body.canonicalArea as string, body.aliasName as string);
      await route.fulfill({
        status: result.ok ? 200 : 400,
        contentType: "application/json",
        body: JSON.stringify(result),
      });
      return;
    }

    if (action === "admin_update_area_alias") {
      const result = state.updateAlias(
        body.oldAliasName as string,
        body.newAliasName as string,
        body.canonicalArea as string
      );
      await route.fulfill({
        status: result.ok ? 200 : 400,
        contentType: "application/json",
        body: JSON.stringify(result),
      });
      return;
    }

    if (action === "admin_toggle_area_alias") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true }),
      });
      return;
    }

    // Catch-all for unknown admin actions
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true }),
    });
  });
}

// ─── Shared helpers ──────────────────────────────────────────────────────────

async function openAreasSection(page: Page) {
  const sectionButton = page.locator("button", { hasText: /Areas Management/ }).first();
  await sectionButton.waitFor({ state: "visible", timeout: 15_000 });
  const isExpanded = await sectionButton.getAttribute("aria-expanded");
  if (isExpanded === "false") {
    await sectionButton.click();
  }
  await expect(page.locator("button", { hasText: "Add Area" })).toBeVisible({ timeout: 10_000 });
}

async function addCanonicalArea(page: Page, areaName: string) {
  await page.locator("button", { hasText: "Add Area" }).click();
  await page.locator('input[placeholder="Enter area name"]').fill(areaName);
  await page.locator("button", { hasText: "Save" }).first().click();
  // Wait for the area row to appear
  await expect(page.locator("td", { hasText: areaName })).toBeVisible({ timeout: 10_000 });
}

async function findAreaRow(page: Page, areaName: string) {
  return page.locator("tr").filter({ has: page.locator("td p.font-medium", { hasText: areaName }) });
}

// ─── Tests ───────────────────────────────────────────────────────────────────

test.describe("Admin Dashboard — Areas & Alias Management", () => {
  test.beforeEach(async ({ page }) => {
    // Reset in-memory state between tests
    state.areas = [];
    await injectAdminCookies(page);
    await setupRouteInterception(page);
    // NOTE: Do NOT navigate here — each test pre-populates state THEN navigates,
    // so the initial fetchDashboard mock gets the correct area data.
  });

  async function gotoAndWait(page: Page) {
    await page.goto("/admin/dashboard");
    await page.waitForLoadState("networkidle");
  }

  // ───────────────────────────────────────────────────────────────────────────
  // TC-01: Add canonical area
  // ───────────────────────────────────────────────────────────────────────────
  test("TC-01: Add canonical area ZZ QA Area 1", async ({ page }) => {
    await gotoAndWait(page);
    await openAreasSection(page);
    await addCanonicalArea(page, "ZZ QA Area 1");

    const row = await findAreaRow(page, "ZZ QA Area 1");
    await expect(row).toBeVisible();
    await expect(row.locator("span", { hasText: "yes" })).toBeVisible();
  });

  // ───────────────────────────────────────────────────────────────────────────
  // TC-02: Add alias ZZ QA Alias 1
  // ───────────────────────────────────────────────────────────────────────────
  test("TC-02: Add alias ZZ QA Alias 1 under ZZ QA Area 1", async ({ page }) => {
    state.addArea("ZZ QA Area 1");
    await gotoAndWait(page);
    await openAreasSection(page);

    // Wait for the area row to appear
    const row = await findAreaRow(page, "ZZ QA Area 1");
    await expect(row).toBeVisible({ timeout: 10_000 });

    // Open the alias panel by clicking "Add Alias" in the row actions
    await row.locator("button", { hasText: "Add Alias" }).click();

    // Find the expanded alias panel and fill the input
    const aliasInput = page.locator('input[placeholder="e.g. Air Force Rd"]').first();
    await expect(aliasInput).toBeVisible({ timeout: 5_000 });
    await aliasInput.fill("ZZ QA Alias 1");
    await page.locator("button", { hasText: "Save Alias" }).first().click();

    // Verify alias count updates — check the "mapped aliases" label (unambiguous)
    await expect(row.locator("td p.text-xs", { hasText: "mapped aliases" })).toBeVisible({ timeout: 10_000 });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // TC-03: Add alias ZZ QA Alias 2
  // ───────────────────────────────────────────────────────────────────────────
  test("TC-03: Add alias ZZ QA Alias 2 under ZZ QA Area 1", async ({ page }) => {
    state.addArea("ZZ QA Area 1");
    state.addAlias("ZZ QA Area 1", "ZZ QA Alias 1");
    await gotoAndWait(page);
    await openAreasSection(page);
    const row = await findAreaRow(page, "ZZ QA Area 1");
    await expect(row).toBeVisible({ timeout: 10_000 });

    await row.locator("button", { hasText: "Add Alias" }).click();
    const aliasInput = page.locator('input[placeholder="e.g. Air Force Rd"]').first();
    await expect(aliasInput).toBeVisible();
    await aliasInput.fill("ZZ QA Alias 2");
    await page.locator("button", { hasText: "Save Alias" }).first().click();

    // Verify count went from 1 → 2: the "mapped aliases" label stays; check alias count column
    await expect(row.locator("td").nth(1).locator("p.font-medium").getByText("2", { exact: true })).toBeVisible({ timeout: 10_000 });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // TC-04: Rename ZZ QA Alias 1 → ZZ QA Alias 1 Renamed
  // ───────────────────────────────────────────────────────────────────────────
  test("TC-04: Rename ZZ QA Alias 1 to ZZ QA Alias 1 Renamed", async ({ page }) => {
    state.addArea("ZZ QA Area 1");
    state.addAlias("ZZ QA Area 1", "ZZ QA Alias 1");
    state.addAlias("ZZ QA Area 1", "ZZ QA Alias 2");
    await gotoAndWait(page);
    await openAreasSection(page);
    const row = await findAreaRow(page, "ZZ QA Area 1");
    await expect(row).toBeVisible({ timeout: 10_000 });

    // View Aliases to expand the alias panel
    await row.locator("button", { hasText: "View Aliases" }).click();

    // Find the alias card by its visible p.font-medium text (not hasText which matches nested),
    // then click its Edit button.
    // aliasCard is scoped to the card BEFORE edit mode — locator is re-evaluated each time.
    const aliasCard = page.locator("div.rounded-lg").filter({
      has: page.locator("p.font-medium", { hasText: "ZZ QA Alias 1" }),
    }).first();
    await expect(aliasCard).toBeVisible({ timeout: 5_000 });
    await aliasCard.locator("button", { hasText: "Edit" }).click();

    // After clicking Edit, the card switches to edit form — use page-level locator
    // (aliasCard's hasText filter would break because p.font-medium is replaced by inputs).
    const aliasNameInput = page.locator('input[placeholder="Alias name"]').first();
    await expect(aliasNameInput).toBeVisible({ timeout: 5_000 });
    await aliasNameInput.fill("ZZ QA Alias 1 Renamed");

    // Save — use page-level Save button (within the alias edit form, not the area-level Save)
    await page.locator("div.rounded-lg button", { hasText: "Save" }).first().click();

    // After save the alias panel refreshes and shows the new name
    await expect(page.locator("p.font-medium", { hasText: "ZZ QA Alias 1 Renamed" })).toBeVisible({
      timeout: 10_000,
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // TC-05: UI update after save — alias count and alias list consistency
  // ───────────────────────────────────────────────────────────────────────────
  test("TC-05: UI updates correctly after saving alias", async ({ page }) => {
    state.addArea("ZZ QA Area 1");
    await gotoAndWait(page);
    await openAreasSection(page);
    const row = await findAreaRow(page, "ZZ QA Area 1");
    await expect(row).toBeVisible({ timeout: 10_000 });

    // Initially 0 aliases
    await expect(row.locator("td p.font-medium", { hasText: "0" })).toBeVisible();
    await expect(row.locator("td p.text-xs", { hasText: "no aliases" })).toBeVisible();

    // Add alias
    await row.locator("button", { hasText: "Add Alias" }).click();
    const aliasInput = page.locator('input[placeholder="e.g. Air Force Rd"]').first();
    await aliasInput.fill("ZZ QA Alias 1");
    await page.locator("button", { hasText: "Save Alias" }).first().click();

    // After save: count = 1, text = "mapped aliases"
    await expect(row.locator("td p.font-medium", { hasText: "1" })).toBeVisible({ timeout: 10_000 });
    await expect(row.locator("td p.text-xs", { hasText: "mapped aliases" })).toBeVisible();
  });

  // ───────────────────────────────────────────────────────────────────────────
  // TC-06: Duplicate area protection
  // ───────────────────────────────────────────────────────────────────────────
  test("TC-06: Duplicate area protection — second ZZ QA Area 1 is rejected", async ({ page }) => {
    state.addArea("ZZ QA Area 1");
    await gotoAndWait(page);
    await openAreasSection(page);

    // Try to add the same area again
    await page.locator("button", { hasText: "Add Area" }).click();
    await page.locator('input[placeholder="Enter area name"]').fill("ZZ QA Area 1");
    await page.locator("button", { hasText: "Save" }).first().click();

    // Should show an error feedback or the form should remain open with an error
    // The dashboard shows a feedback div with text "Failed to update" for API errors
    await expect(page.locator("text=Failed to update")).toBeVisible({ timeout: 8_000 });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // TC-07: Duplicate alias protection
  // ───────────────────────────────────────────────────────────────────────────
  test("TC-07: Duplicate alias protection — second ZZ QA Alias 1 is rejected", async ({ page }) => {
    state.addArea("ZZ QA Area 1");
    state.addAlias("ZZ QA Area 1", "ZZ QA Alias 1");
    await gotoAndWait(page);
    await openAreasSection(page);
    const row = await findAreaRow(page, "ZZ QA Area 1");
    await expect(row).toBeVisible({ timeout: 10_000 });

    await row.locator("button", { hasText: "Add Alias" }).click();
    const aliasInput = page.locator('input[placeholder="e.g. Air Force Rd"]').first();
    await aliasInput.fill("ZZ QA Alias 1");
    await page.locator("button", { hasText: "Save Alias" }).first().click();

    await expect(page.locator("text=Failed to update")).toBeVisible({ timeout: 8_000 });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // TC-08: Refresh/reload consistency
  // ───────────────────────────────────────────────────────────────────────────
  test("TC-08: Area and alias state persists after page reload", async ({ page }) => {
    state.addArea("ZZ QA Area 1");
    state.addAlias("ZZ QA Area 1", "ZZ QA Alias 1");
    state.addAlias("ZZ QA Area 1", "ZZ QA Alias 2");
    await gotoAndWait(page);

    // First load
    await openAreasSection(page);
    const row = await findAreaRow(page, "ZZ QA Area 1");
    await expect(row).toBeVisible({ timeout: 10_000 });
    await expect(row.locator("td p.font-medium", { hasText: "2" })).toBeVisible();

    // Reload — re-inject cookies (context persists but just to be safe)
    await page.reload();
    await page.waitForLoadState("networkidle");

    // Open section again after reload
    await openAreasSection(page);

    const rowAfterReload = await findAreaRow(page, "ZZ QA Area 1");
    await expect(rowAfterReload).toBeVisible({ timeout: 10_000 });
    await expect(rowAfterReload.locator("td p.font-medium", { hasText: "2" })).toBeVisible();
  });

  // ───────────────────────────────────────────────────────────────────────────
  // TC-09: No stale state — edit modal clears on cancel
  // ───────────────────────────────────────────────────────────────────────────
  test("TC-09: Edit alias modal state clears on cancel", async ({ page }) => {
    state.addArea("ZZ QA Area 1");
    state.addAlias("ZZ QA Area 1", "ZZ QA Alias 1");
    await gotoAndWait(page);
    await openAreasSection(page);
    const row = await findAreaRow(page, "ZZ QA Area 1");
    await row.locator("button", { hasText: "View Aliases" }).click();

    // Locate alias card by p.font-medium text (before edit mode)
    const aliasCard = page.locator("div.rounded-lg").filter({
      has: page.locator("p.font-medium", { hasText: "ZZ QA Alias 1" }),
    }).first();
    await expect(aliasCard).toBeVisible();
    await aliasCard.locator("button", { hasText: "Edit" }).click();

    // After clicking Edit, use page-level locator for inputs
    const aliasNameInput = page.locator('input[placeholder="Alias name"]').first();
    await expect(aliasNameInput).toBeVisible({ timeout: 5_000 });
    await aliasNameInput.fill("ZZ QA Stale Value");

    // Cancel — the Cancel button is within the alias edit form
    await page.locator("div.rounded-lg button", { hasText: "Cancel" }).first().click();

    // After cancel, the edit form should close; the original p.font-medium name reappears
    await expect(page.locator("p.font-medium", { hasText: "ZZ QA Alias 1" })).toBeVisible({ timeout: 5_000 });
    // The alias name input should be gone
    await expect(page.locator('input[placeholder="Alias name"]')).not.toBeVisible();
  });

  // ───────────────────────────────────────────────────────────────────────────
  // TC-10: Full flow — add area, add two aliases, rename one, verify state
  // ───────────────────────────────────────────────────────────────────────────
  test("TC-10: Full flow — add area, add 2 aliases, rename alias 1", async ({ page }) => {
    await gotoAndWait(page);
    await openAreasSection(page);

    // Step 1: Add ZZ QA Area 1
    await addCanonicalArea(page, "ZZ QA Area 1");
    const row = await findAreaRow(page, "ZZ QA Area 1");
    await expect(row).toBeVisible({ timeout: 10_000 });

    // Step 2: Add ZZ QA Alias 1
    await row.locator("button", { hasText: "Add Alias" }).click();
    let aliasInput = page.locator('input[placeholder="e.g. Air Force Rd"]').first();
    await expect(aliasInput).toBeVisible();
    await aliasInput.fill("ZZ QA Alias 1");
    await page.locator("button", { hasText: "Save Alias" }).first().click();
    await expect(row.locator("td p.text-xs", { hasText: "mapped aliases" })).toBeVisible({ timeout: 10_000 });

    // Step 3: Add ZZ QA Alias 2
    await row.locator("button", { hasText: "Add Alias" }).click();
    aliasInput = page.locator('input[placeholder="e.g. Air Force Rd"]').first();
    await expect(aliasInput).toBeVisible();
    await aliasInput.fill("ZZ QA Alias 2");
    await page.locator("button", { hasText: "Save Alias" }).first().click();
    await expect(row.locator("td").nth(1).locator("p.font-medium").getByText("2", { exact: true })).toBeVisible({ timeout: 10_000 });

    // Step 4: Ensure aliases panel is expanded (it auto-expands after each add-alias save).
    // Button reads "Hide Aliases" when expanded, "View Aliases" when collapsed.
    const viewOrHideBtn = row.locator("button").filter({ hasText: /View Aliases|Hide Aliases/ }).first();
    const btnText = await viewOrHideBtn.textContent();
    if (btnText?.trim() === "View Aliases") {
      await viewOrHideBtn.click();
    }
    // Now the aliases panel is visible — find and edit Alias 1
    const aliasCard = page.locator("div.rounded-lg").filter({
      has: page.locator("p.font-medium", { hasText: "ZZ QA Alias 1" }),
    }).first();
    await expect(aliasCard).toBeVisible({ timeout: 5_000 });
    await aliasCard.locator("button", { hasText: "Edit" }).click();

    // After click, use page-level input locator (aliasCard's filter breaks after edit mode)
    const aliasNameInput = page.locator('input[placeholder="Alias name"]').first();
    await expect(aliasNameInput).toBeVisible({ timeout: 5_000 });
    await aliasNameInput.fill("ZZ QA Alias 1 Renamed");
    await page.locator("div.rounded-lg button", { hasText: "Save" }).first().click();

    // Step 5: Verify renamed alias appears
    await expect(
      page.locator("p.font-medium", { hasText: "ZZ QA Alias 1 Renamed" })
    ).toBeVisible({ timeout: 10_000 });

    // Step 6: Old alias name "ZZ QA Alias 1" (exact) should be gone.
    // Use exact:true to avoid substring match with "ZZ QA Alias 1 Renamed".
    await expect(page.getByText("ZZ QA Alias 1", { exact: true })).not.toBeVisible();

    // Step 7: Alias 2 should still be there
    await expect(
      page.locator("p.font-medium", { hasText: "ZZ QA Alias 2" })
    ).toBeVisible();
  });
});
