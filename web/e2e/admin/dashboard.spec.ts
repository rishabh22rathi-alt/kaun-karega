import type { Locator } from "@playwright/test";

import { bootstrapAdminSession } from "../_support/auth";
import { QA_AREA } from "../_support/data";
import { gotoPath } from "../_support/home";
import { mockAdminDashboardApis } from "../_support/scenarios";
import { test, expect } from "../_support/test";
import { jsonOk, mockJson } from "../_support/routes";

async function ensureSectionOpen(trigger: Locator, content: Locator): Promise<void> {
  if (await content.isVisible().catch(() => false)) {
    return;
  }
  await trigger.click();
  await expect(content).toBeVisible();
}

test.describe("Admin: dashboard operations", () => {
  test("provider category breakdown only shows approved categories and separates unmapped rows", async ({
    page,
    diag,
  }) => {
    await bootstrapAdminSession(page);
    await mockAdminDashboardApis(page);
    await mockJson(
      page,
      "**/api/admin/provider-stats",
      jsonOk({ data: { total: 4, verified: 2 } })
    );
    await mockJson(
      page,
      "**/api/admin/provider-stats/by-category**",
      jsonOk({
        data: {
          byCategory: [
            { category: "Electrician", count: 2 },
            { category: "Plumber", count: 1 },
          ],
          unmappedCategories: [
            { category: "Mukut Shringar", count: 1, suggestedCategory: "" },
            { category: "Saree Showroom", count: 1, suggestedCategory: "" },
          ],
        },
      })
    );

    await gotoPath(page, "/admin/dashboard");

    await page.getByRole("button", { name: /providers/i }).click();
    await page.getByRole("button", { name: /total providers/i }).click();

    const approvedBreakdown = page
      .locator("#providers-breakdown table")
      .filter({ hasText: "Electrician" })
      .first();
    await expect(approvedBreakdown).toBeVisible();
    await expect(approvedBreakdown.getByText("Electrician", { exact: true })).toBeVisible();
    await expect(approvedBreakdown.getByText("Plumber", { exact: true })).toBeVisible();
    await expect(approvedBreakdown.getByText("Mukut Shringar", { exact: true })).toHaveCount(0);
    await expect(approvedBreakdown.getByText("Saree Showroom", { exact: true })).toHaveCount(0);

    const unmappedSection = page
      .locator("div")
      .filter({ has: page.getByText("Unmapped Provider Categories", { exact: true }) })
      .last();
    await expect(unmappedSection).toBeVisible();
    await expect(unmappedSection.getByText("Mukut Shringar", { exact: true })).toBeVisible();
    await expect(unmappedSection.getByText("Saree Showroom", { exact: true })).toBeVisible();

    diag.assertClean();
  });

  test("provider category breakdown verified card refetches on tab open and after category-changed event", async ({
    page,
    diag,
  }) => {
    await bootstrapAdminSession(page);
    await mockAdminDashboardApis(page);

    // Stateful provider-stats mock — flips from verified=8 to verified=5
    // after an archive-equivalent event. Mirrors the production wiring
    // where archive shrinks the verified-with-active-category set.
    let providerStatsCalls = 0;
    let verifiedSnapshot = 8;
    await mockJson(page, "**/api/admin/provider-stats", () => {
      providerStatsCalls += 1;
      return jsonOk({ data: { total: 10, verified: verifiedSnapshot } });
    });

    // Breakdown mock — not central to this test, just keeps the tile
    // body renderable without surprise.
    await mockJson(
      page,
      "**/api/admin/provider-stats/by-category**",
      jsonOk({
        data: {
          byCategory: [{ category: "Electrician", count: 1 }],
          unmappedCategories: [],
        },
      })
    );

    await gotoPath(page, "/admin/dashboard");

    // Open Providers section — first fetch reports verified=8.
    await page.getByRole("button", { name: /^providers/i }).click();
    const verifiedTile = page.getByRole("button", {
      name: /verified providers/i,
    });
    await expect(verifiedTile).toContainText("8");
    expect(providerStatsCalls).toBeGreaterThanOrEqual(1);

    // Simulate an archive-style category mutation. The event is what
    // CategoryTab dispatches after archive/restore; ProvidersTab must
    // refetch and update the tile in place.
    verifiedSnapshot = 5;
    const callsBeforeEvent = providerStatsCalls;
    await page.evaluate(() => {
      window.dispatchEvent(new CustomEvent("kk-admin-category-changed"));
    });
    await expect(verifiedTile).toContainText("5");
    expect(providerStatsCalls).toBeGreaterThan(callsBeforeEvent);

    diag.assertClean();
  });

  test("provider category breakdown drilldown expands to show provider rows and respects verified scope", async ({
    page,
    diag,
  }) => {
    await bootstrapAdminSession(page);
    await mockAdminDashboardApis(page);
    await mockJson(
      page,
      "**/api/admin/provider-stats",
      jsonOk({ data: { total: 4, verified: 2 } })
    );
    await mockJson(
      page,
      "**/api/admin/provider-stats/by-category**",
      jsonOk({
        data: {
          byCategory: [
            { category: "Electrician", count: 2 },
            { category: "Plumber", count: 1 },
          ],
          unmappedCategories: [],
        },
      })
    );

    const seenDrilldownRequests: string[] = [];
    await mockJson(
      page,
      "**/api/admin/provider-stats/category-providers**",
      ({ request }) => {
        const url = new URL(request.url());
        seenDrilldownRequests.push(url.search);
        const verifiedFlag = url.searchParams.get("verified") === "1";
        const category = url.searchParams.get("category") || "";
        const all = [
          {
            providerId: "PR-QA-ELEC-1",
            name: "Edison Sparks",
            phone: "9911000001",
            verified: "yes",
            status: "active",
            // Area resolved to a service region — Regions column should
            // surface the compact "<code> - <name>" label and hide the
            // raw area list.
            regions: ["R-04 - Marwar"],
            areas: ["Sardarpura"],
          },
          {
            providerId: "PR-QA-ELEC-2",
            name: "Watt Wright",
            phone: "9911000002",
            verified: "no",
            status: "pending",
            // No region resolved — UI must show the "Unmapped Region"
            // muted label, NOT the raw area string.
            regions: [],
            areas: ["Ratanada"],
          },
        ];
        const providers = verifiedFlag
          ? all.filter((p) => p.verified === "yes")
          : all;
        return jsonOk({ data: { category, providers } });
      }
    );

    await gotoPath(page, "/admin/dashboard");

    await page.getByRole("button", { name: /providers/i }).click();
    await page.getByRole("button", { name: /total providers/i }).click();

    // Click "Electrician" row — expansion lazy-loads the provider list.
    const electricianButton = page
      .locator("#providers-breakdown")
      .getByRole("button", { name: "Electrician", exact: true });
    await electricianButton.click();

    const drilldown = page.getByTestId("provider-drilldown-Electrician");
    await expect(drilldown).toBeVisible();
    await expect(drilldown.getByText("Edison Sparks")).toBeVisible();
    await expect(drilldown.getByText("Watt Wright")).toBeVisible();

    // Regions column is the only area-style surface — header check +
    // compact label + raw-area suppression + unmapped-region fallback.
    await expect(
      drilldown.locator("th").filter({ hasText: /^Regions$/ })
    ).toBeVisible();
    const edisonRow = drilldown
      .locator("tr")
      .filter({ hasText: "Edison Sparks" });
    await expect(
      edisonRow.getByText("R-04 - Marwar", { exact: true })
    ).toBeVisible();
    // Raw area "Sardarpura" must NOT render visibly anywhere now.
    await expect(edisonRow.getByText("Sardarpura")).toHaveCount(0);
    await expect(drilldown.getByText("Sardarpura")).toHaveCount(0);

    const wattRow = drilldown.locator("tr").filter({ hasText: "Watt Wright" });
    // No region match → "Unmapped Region" muted fallback; raw area
    // "Ratanada" stays hidden from the cell text.
    await expect(
      wattRow.getByText("Unmapped Region", { exact: true })
    ).toBeVisible();
    await expect(wattRow.getByText("Ratanada")).toHaveCount(0);

    // Click again to collapse.
    await electricianButton.click();
    await expect(drilldown).toHaveCount(0);

    // Switch to verified mode — drilldown should re-fetch with verified=1
    // and the unverified provider should drop out.
    await page.getByRole("button", { name: /verified providers/i }).click();
    const verifiedElectricianButton = page
      .locator("#providers-breakdown")
      .getByRole("button", { name: "Electrician", exact: true });
    await verifiedElectricianButton.click();

    const verifiedDrilldown = page.getByTestId("provider-drilldown-Electrician");
    await expect(verifiedDrilldown).toBeVisible();
    await expect(verifiedDrilldown.getByText("Edison Sparks")).toBeVisible();
    await expect(verifiedDrilldown.getByText("Watt Wright")).toHaveCount(0);
    // Compact region label survives the verified scope.
    await expect(
      verifiedDrilldown.getByText("R-04 - Marwar", { exact: true })
    ).toBeVisible();

    expect(
      seenDrilldownRequests.some(
        (search) =>
          search.includes("verified=1") &&
          search.includes("category=Electrician")
      )
    ).toBe(true);

    diag.assertClean();
  });

  test("admin can remove provider category from drilldown and provider stays in system", async ({
    page,
    diag,
  }) => {
    await bootstrapAdminSession(page);
    await mockAdminDashboardApis(page);

    // Confirm dialog auto-accepts so the click path under test stays
    // headless. Playwright tears the listener down with the page.
    page.on("dialog", (dialog) => void dialog.accept());

    await mockJson(
      page,
      "**/api/admin/provider-stats",
      jsonOk({ data: { total: 4, verified: 2 } })
    );
    await mockJson(
      page,
      "**/api/admin/provider-stats/by-category**",
      jsonOk({
        data: {
          byCategory: [{ category: "Electrician", count: 2 }],
          unmappedCategories: [],
        },
      })
    );

    // Drilldown returns two providers initially. After the remove call
    // succeeds the UI updates optimistically — the next mock invocation
    // (if any) is therefore not exercised by this test.
    await mockJson(
      page,
      "**/api/admin/provider-stats/category-providers**",
      jsonOk({
        data: {
          category: "Electrician",
          providers: [
            {
              providerId: "PR-QA-ELEC-1",
              name: "Edison Sparks",
              phone: "9911000001",
              verified: "yes",
              status: "active",
              regions: ["R-04 - Marwar"],
              areas: ["Sardarpura"],
            },
            {
              providerId: "PR-QA-ELEC-2",
              name: "Watt Wright",
              phone: "9911000002",
              verified: "yes",
              status: "active",
              regions: ["R-04 - Marwar"],
              areas: ["Ratanada"],
            },
          ],
        },
      })
    );

    // remove-category mock captures the payload + signals that the
    // removed provider lost their last category, so the UI surfaces
    // the "Needs category re-registration" badge.
    const removeCalls: Array<{ providerId: string; category: string }> = [];
    await mockJson(
      page,
      "**/api/admin/providers/remove-category**",
      ({ request }) => {
        let body: Record<string, unknown> = {};
        try {
          body = JSON.parse(request.postData() || "{}") as Record<
            string,
            unknown
          >;
        } catch {
          body = {};
        }
        removeCalls.push({
          providerId: String(body.providerId ?? ""),
          category: String(body.category ?? ""),
        });
        return jsonOk({
          removed: {
            providerId: String(body.providerId ?? ""),
            category: String(body.category ?? ""),
            removedServiceRows: 1,
            removedWorkTerms: 0,
            remainingCategoryCount: 0,
            providerStatusUpdated: true,
          },
        });
      }
    );

    await gotoPath(page, "/admin/dashboard");

    await page.getByRole("button", { name: /^providers/i }).click();
    await page.getByRole("button", { name: /total providers/i }).click();
    await page
      .locator("#providers-breakdown")
      .getByRole("button", { name: "Electrician", exact: true })
      .click();

    const drilldown = page.getByTestId("provider-drilldown-Electrician");
    await expect(drilldown).toBeVisible();
    await expect(drilldown.getByText("Edison Sparks")).toBeVisible();
    await expect(drilldown.getByText("Watt Wright")).toBeVisible();

    // Trigger the remove flow on Edison.
    await page
      .getByTestId("remove-provider-category-PR-QA-ELEC-1")
      .click();

    // Provider's table row disappears from the drilldown; Watt stays.
    // (We assert on the row testid rather than the text, because the
    // "Needs category re-registration" notice also includes the
    // removed provider's name.)
    await expect(
      page.getByTestId("provider-row-PR-QA-ELEC-1")
    ).toHaveCount(0);
    await expect(drilldown.getByText("Watt Wright")).toBeVisible();

    // The Electrician breakdown count decrements from 2 → 1.
    const electricianBreakdownRow = page
      .locator("#providers-breakdown tr")
      .filter({ hasText: "Electrician" });
    await expect(
      electricianBreakdownRow.locator("td").last()
    ).toHaveText(/^1$/);

    // Providers tile row count stays — Edison's account is still in
    // the system. Inspect by re-opening the drilldown for a still-listed
    // provider to make sure the row remains intact.
    await expect(
      page.getByTestId("provider-row-PR-QA-ELEC-2")
    ).toBeVisible();

    // "Needs category re-registration" badge surfaces for Edison since
    // providerStatusUpdated came back true.
    const notice = page.getByTestId(
      "reregistration-notice-Electrician"
    );
    await expect(notice).toBeVisible();
    await expect(notice).toContainText("Edison Sparks");
    await expect(notice).toContainText(/needs category re-registration/i);

    expect(removeCalls).toEqual([
      { providerId: "PR-QA-ELEC-1", category: "Electrician" },
    ]);

    diag.assertClean();
  });

  test("admin can remove provider category and the empty-state message appears when the last provider is removed", async ({
    page,
    diag,
  }) => {
    await bootstrapAdminSession(page);
    await mockAdminDashboardApis(page);

    page.on("dialog", (dialog) => void dialog.accept());

    await mockJson(
      page,
      "**/api/admin/provider-stats",
      jsonOk({ data: { total: 1, verified: 1 } })
    );
    await mockJson(
      page,
      "**/api/admin/provider-stats/by-category**",
      jsonOk({
        data: {
          byCategory: [{ category: "Electrician", count: 1 }],
          unmappedCategories: [],
        },
      })
    );
    await mockJson(
      page,
      "**/api/admin/provider-stats/category-providers**",
      jsonOk({
        data: {
          category: "Electrician",
          providers: [
            {
              providerId: "PR-QA-ONLY-1",
              name: "Only Provider",
              phone: "9911999991",
              verified: "yes",
              status: "active",
              regions: ["R-04 - Marwar"],
              areas: ["Sardarpura"],
            },
          ],
        },
      })
    );
    await mockJson(
      page,
      "**/api/admin/providers/remove-category**",
      jsonOk({
        removed: {
          providerId: "PR-QA-ONLY-1",
          category: "Electrician",
          removedServiceRows: 1,
          removedWorkTerms: 0,
          remainingCategoryCount: 0,
          providerStatusUpdated: true,
        },
      })
    );

    await gotoPath(page, "/admin/dashboard");
    await page.getByRole("button", { name: /^providers/i }).click();
    await page.getByRole("button", { name: /total providers/i }).click();
    await page
      .locator("#providers-breakdown")
      .getByRole("button", { name: "Electrician", exact: true })
      .click();

    const drilldown = page.getByTestId("provider-drilldown-Electrician");
    await expect(drilldown.getByText("Only Provider")).toBeVisible();

    await page
      .getByTestId("remove-provider-category-PR-QA-ONLY-1")
      .click();

    // Empty-state message takes over once the last provider leaves.
    await expect(
      drilldown.getByText("No providers in this category.")
    ).toBeVisible();

    diag.assertClean();
  });

  test("manage category bridge opens Category tab and highlights the approved row", async ({
    page,
    diag,
  }) => {
    await bootstrapAdminSession(page);
    await mockAdminDashboardApis(page);

    await mockJson(
      page,
      "**/api/admin/provider-stats",
      jsonOk({ data: { total: 4, verified: 2 } })
    );
    await mockJson(
      page,
      "**/api/admin/provider-stats/by-category**",
      jsonOk({
        data: {
          byCategory: [{ category: "Electrician", count: 2 }],
          unmappedCategories: [],
        },
      })
    );
    await mockJson(
      page,
      "**/api/admin/categories**",
      jsonOk({
        categories: [
          { name: "Electrician", active: true, aliases: [] },
          { name: "Plumber", active: true, aliases: [] },
        ],
      })
    );

    await gotoPath(page, "/admin/dashboard");

    await page.getByRole("button", { name: /providers/i }).click();
    await page.getByRole("button", { name: /total providers/i }).click();

    // Click "Manage category" on Electrician — Category tab opens and
    // the matching row gets the temporary highlight ring.
    const providersElectricianRow = page
      .locator("#providers-breakdown tr")
      .filter({ hasText: "Electrician" });
    await providersElectricianRow
      .getByRole("button", { name: "Manage category" })
      .click();

    await expect(page.locator("#category-tab-body")).toBeVisible();
    const electricianRow = page.getByTestId("category-row-electrician");
    await expect(electricianRow).toBeVisible();
    await expect(electricianRow).toHaveAttribute("data-highlighted", "true");

    diag.assertClean();
  });

  test("manage category bridge shows not-found banner when the unmapped category has no approved row", async ({
    page,
    diag,
  }) => {
    await bootstrapAdminSession(page);
    await mockAdminDashboardApis(page);

    await mockJson(
      page,
      "**/api/admin/provider-stats",
      jsonOk({ data: { total: 4, verified: 2 } })
    );
    await mockJson(
      page,
      "**/api/admin/provider-stats/by-category**",
      jsonOk({
        data: {
          byCategory: [],
          unmappedCategories: [
            { category: "Mukut Shringar", count: 1, suggestedCategory: "" },
          ],
        },
      })
    );
    // Approved list intentionally does NOT include "Mukut Shringar"
    // so the bridge falls back to the not-found banner.
    await mockJson(
      page,
      "**/api/admin/categories**",
      jsonOk({
        categories: [{ name: "Electrician", active: true, aliases: [] }],
      })
    );

    await gotoPath(page, "/admin/dashboard");

    await page.getByRole("button", { name: /providers/i }).click();
    await page.getByRole("button", { name: /total providers/i }).click();

    const unmappedRow = page
      .locator("#providers-breakdown tr")
      .filter({ hasText: "Mukut Shringar" });
    await unmappedRow
      .getByRole("button", { name: "Manage category" })
      .click();

    await expect(page.locator("#category-tab-body")).toBeVisible();
    await expect(page.getByTestId("category-bridge-message")).toHaveText(
      /category not found in approved list\./i
    );

    diag.assertClean();
  });

  test("admin rename of a category cascades to aliases and provider_services and keeps tags visible", async ({
    page,
    diag,
  }) => {
    await bootstrapAdminSession(page);

    // Stateful /api/admin/categories mock — returns "Painter" with one
    // alias and one work tag before the rename, then "Painting Service"
    // with the same alias/tag bundle (mirrors what the cascade produces
    // server-side: category_aliases.canonical_category re-pointed to the
    // new name and re-grouped on the next read).
    let renameApplied = false;
    await mockJson(page, "**/api/admin/categories**", () => {
      const name = renameApplied ? "Painting Service" : "Painter";
      return jsonOk({
        categories: [
          {
            name,
            active: true,
            aliases: [
              { id: "alias-painter-1", alias: "rang waala", aliasType: "local_name" },
              { id: "alias-painter-2", alias: "wall paint", aliasType: "work_tag" },
            ],
          },
        ],
      });
    });

    await mockAdminDashboardApis(page);

    // Layer a higher-priority /api/kk handler that intercepts
    // edit_category — flips the stateful flag above, asserts the
    // payload shape, and replies with the new propagation summary.
    // For all other actions, fall through to the dashboard mock.
    const kkEditCalls: Array<{ oldName: string; newName: string }> = [];
    await page.route("**/api/kk**", async (route) => {
      let body: Record<string, unknown> = {};
      try {
        body = JSON.parse(route.request().postData() || "{}") as Record<
          string,
          unknown
        >;
      } catch {
        body = {};
      }
      if (body.action === "edit_category") {
        const oldName = typeof body.oldName === "string" ? body.oldName : "";
        const newName = typeof body.newName === "string" ? body.newName : "";
        kkEditCalls.push({ oldName, newName });
        renameApplied = true;
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            ok: true,
            renamed: { oldName, newName },
            updatedAliases: 2,
            updatedProviderServices: 3,
          }),
        });
        return;
      }
      await route.fallback();
    });

    await gotoPath(page, "/admin/dashboard");

    // Open the Category section accordion.
    await page.locator('button[aria-controls="category-tab-body"]').click();

    const painterRow = page.locator("tr").filter({ hasText: "Painter" });
    await expect(painterRow).toBeVisible();

    // Aliases / work tags should be visible under "Painter" before rename.
    await painterRow
      .getByRole("button", { name: /aliases \/ work tags/i })
      .click();
    await expect(painterRow.getByText("rang waala")).toBeVisible();
    await expect(painterRow.getByText("wall paint")).toBeVisible();

    // Re-anchor the row by the alias chip — once Edit is active the
    // category cell turns into an <input> and "Painter" leaves the
    // visible text of the row.
    const aliasAnchoredRow = page
      .locator("tr")
      .filter({ has: page.getByText("rang waala", { exact: true }) });
    await aliasAnchoredRow.getByRole("button", { name: /^edit$/i }).click();
    const renameInput = aliasAnchoredRow.locator("input[type='text']");
    await renameInput.fill("Painting Service");
    await aliasAnchoredRow.getByRole("button", { name: /^save$/i }).click();

    // The new name appears, the old one is gone, and aliases/work tags
    // still hang off the renamed category. Anchor by the cell text — the
    // chip-expansion state is keyed by category name, so the renamed
    // row starts with aliases collapsed even though "Painter" was open.
    const renamedRow = page
      .locator("tbody tr")
      .filter({ has: page.getByText("Painting Service", { exact: true }) });
    await expect(renamedRow).toBeVisible();
    await expect(
      page
        .locator("tbody tr")
        .filter({ has: page.getByText("Painter", { exact: true }) })
    ).toHaveCount(0);

    await renamedRow
      .getByRole("button", { name: /aliases \/ work tags/i })
      .click();
    await expect(renamedRow.getByText("rang waala")).toBeVisible();
    await expect(renamedRow.getByText("wall paint")).toBeVisible();

    // The frontend sent exactly one edit_category call with the expected
    // payload — guards against the dashboard double-firing the mutation.
    expect(kkEditCalls).toEqual([
      { oldName: "Painter", newName: "Painting Service" },
    ]);

    diag.assertClean();
  });

  test("archive category flow archives an approved category and restores it from the Archived tab", async ({
    page,
    diag,
  }) => {
    await bootstrapAdminSession(page);
    await mockAdminDashboardApis(page);

    // The confirm() prompt in handleArchive must be auto-accepted under
    // test. Playwright tears down dialog listeners with the page.
    page.on("dialog", (dialog) => void dialog.accept());

    type ArchiveState = "active" | "archived" | "restored";
    let state: ArchiveState = "active";

    // /api/admin/categories — list endpoint. Regex-anchored so the
    // ".../categories/archive" and ".../categories/restore" handlers
    // below don't get shadowed.
    await mockJson(page, /\/api\/admin\/categories(?:\?[^/]*)?$/, () => {
      if (state === "archived") {
        // Archive hides Painter from the Approved list (server-side
        // filter that excludes any category whose lowercased name is
        // in category_archive_reviews with status='archived').
        return jsonOk({ categories: [] });
      }
      return jsonOk({
        categories: [
          {
            name: "Painter",
            active: true,
            aliases: [
              {
                id: "alias-painter-1",
                alias: "rang waala",
                aliasType: "local_name",
              },
            ],
          },
        ],
      });
    });

    // /api/admin/categories/archive — GET (list) + POST (archive action).
    const buildArchivedRow = (status: "archived" | "restored") => ({
      id: "ARCHIVE-QA-1",
      categoryName: "Painter",
      providerCount: 3,
      aliasCount: 1,
      archivedBy: "QA Admin",
      archivedAt: "2026-05-12T10:00:00Z",
      status,
      reviewedAt:
        status === "restored" ? "2026-05-12T11:00:00Z" : null,
    });
    await mockJson(
      page,
      /\/api\/admin\/categories\/archive(?:\?[^/]*)?$/,
      ({ request }) => {
        if (request.method() === "GET") {
          if (state === "archived")
            return jsonOk({ archives: [buildArchivedRow("archived")] });
          if (state === "restored")
            return jsonOk({ archives: [buildArchivedRow("restored")] });
          return jsonOk({ archives: [] });
        }
        // POST → archive Painter.
        state = "archived";
        return jsonOk({
          archived: {
            categoryName: "Painter",
            providerCount: 3,
            aliasCount: 1,
            archiveId: "ARCHIVE-QA-1",
          },
        });
      }
    );

    // /api/admin/categories/restore — POST only.
    await mockJson(page, /\/api\/admin\/categories\/restore/, () => {
      state = "restored";
      return jsonOk({
        restored: {
          categoryName: "Painter",
          archiveId: "ARCHIVE-QA-1",
          restoredAliases: 1,
        },
      });
    });

    // Provider-count side-channel — non-fatal, but keeps the diag
    // surface clean and seeds the Approved table's Providers column.
    await mockJson(
      page,
      "**/api/admin/provider-stats/by-category**",
      jsonOk({
        data: {
          byCategory: [{ category: "Painter", count: 3 }],
          unmappedCategories: [],
        },
      })
    );

    await gotoPath(page, "/admin/dashboard");
    await page.locator('button[aria-controls="category-tab-body"]').click();

    // Painter is in the Approved list before archiving.
    const painterRow = page
      .locator("tbody tr")
      .filter({ has: page.getByText("Painter", { exact: true }) });
    await expect(painterRow).toBeVisible();

    // Click Archive — confirm dialog auto-accepts; Painter disappears.
    await painterRow.getByTestId("archive-category-Painter").click();
    await expect(
      page
        .locator("tbody tr")
        .filter({ has: page.getByText("Painter", { exact: true }) })
    ).toHaveCount(0);

    // Switch to Archived tab — Painter shows with provider_count=3 and
    // status="archived".
    await page.getByTestId("kk-admin-category-archived-tab").click();
    const archivedRow = page.getByTestId("archive-row-painter");
    await expect(archivedRow).toBeVisible();
    await expect(archivedRow.getByText("Painter")).toBeVisible();
    await expect(archivedRow.getByText("3", { exact: true })).toBeVisible();
    await expect(archivedRow.getByText(/^archived$/)).toBeVisible();

    // Click Restore — status flips to "restored" and the Restore
    // button is replaced by the muted "Already restored" placeholder.
    await archivedRow.getByTestId("restore-archive-ARCHIVE-QA-1").click();
    await expect(archivedRow.getByText(/^restored$/)).toBeVisible();
    await expect(
      archivedRow.getByRole("button", { name: /^Restore$/ })
    ).toHaveCount(0);

    // Switch back to Approved — Painter is back with its alias intact.
    await page
      .getByRole("button", { name: "Approved Categories", exact: true })
      .click();
    const restoredRow = page
      .locator("tbody tr")
      .filter({ has: page.getByText("Painter", { exact: true }) });
    await expect(restoredRow).toBeVisible();
    await restoredRow
      .getByRole("button", { name: /aliases \/ work tags/i })
      .click();
    await expect(restoredRow.getByText("rang waala")).toBeVisible();

    diag.assertClean();
  });

  test("admin dashboard renders the major operational sections and health panels", async ({
    page,
    diag,
  }) => {
    await bootstrapAdminSession(page);
    await mockAdminDashboardApis(page);

    // Purpose: verify the admin control center still boots with the major review surfaces visible.
    await gotoPath(page, "/admin/dashboard");

    await expect(page.getByRole("heading", { name: "Control Center" })).toBeVisible();
    await expect(page.getByText("Dashboard snapshot")).toBeVisible();
    await expect(page.getByText("Pending Category Requests", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("Notification Health")).toBeVisible();
    await expect(page.getByText("Recent Attempts")).toBeVisible();
    await expect(page.getByText("Areas Management")).toBeVisible();
    await expect(page.getByText("Reported Issues")).toBeVisible();
    await expect(page.getByText("Chat Monitoring")).toBeVisible();

    diag.assertClean();
  });

  test("provider verification and category-review actions stay wired to the admin dashboard", async ({
    page,
    diag,
  }) => {
    await bootstrapAdminSession(page);
    await mockAdminDashboardApis(page);

    // Purpose: keep the highest-risk admin mutations covered without pulling in live data dependencies.
    await gotoPath(page, "/admin/dashboard");

    const pendingProviderRow = page.locator("tr").filter({ hasText: "PR-QA-PENDING" });
    const pendingProviderApproveButton = pendingProviderRow.getByRole("button", {
      name: /^approve$/i,
    });
    await ensureSectionOpen(
      page.getByRole("button", { name: /providers needing attention/i }),
      pendingProviderApproveButton
    );
    await pendingProviderApproveButton.click();
    await expect(
      pendingProviderRow.getByRole("button", { name: /^unverify$/i })
    ).toBeVisible();

    const categoryRow = page.locator("tr").filter({ hasText: "CAT-REQ-QA-0001" });
    await categoryRow.getByRole("button", { name: /^approve$/i }).click();
    await expect(categoryRow).toHaveCount(0);

    diag.assertClean();
  });

  test("area mapping, issue triage, and chat-monitoring affordances remain responsive", async ({
    page,
    diag,
  }) => {
    await bootstrapAdminSession(page);
    await mockAdminDashboardApis(page);

    // Purpose: audit the secondary admin controls that commonly regress when payloads change shape.
    await gotoPath(page, "/admin/dashboard");

    await ensureSectionOpen(
      page.getByRole("button", { name: /areas management/i }),
      page.getByRole("button", { name: /view aliases/i })
    );
    await page.getByRole("button", { name: /view aliases/i }).click();
    await page.locator('input[placeholder="e.g. Air Force Rd"]').fill("Sardarpura West");
    await page.getByRole("button", { name: /save alias/i }).click();
    await expect(page.getByText("Sardarpura West", { exact: true })).toBeVisible();

    const unmappedRow = page.locator("tr").filter({ hasText: "AREA-REVIEW-QA-0001" });
    await unmappedRow.locator('input[list="admin-area-canonical-options"]').fill(QA_AREA);
    await unmappedRow.getByRole("button", { name: /^map$/i }).click();
    await expect(unmappedRow).toHaveCount(0);

    const issueRow = page.locator("tr").filter({ hasText: "ISSUE-QA-0001" });
    await ensureSectionOpen(
      page.getByRole("button", { name: /reported issues/i }),
      issueRow.getByRole("button", { name: /mark resolved/i })
    );
    await issueRow.getByRole("button", { name: /mark resolved/i }).click();
    await expect(issueRow.locator("span").filter({ hasText: /^resolved$/i })).toBeVisible();

    const chatRow = page.locator("tr").filter({ hasText: "THREAD-QA-0001" });
    await ensureSectionOpen(
      page.getByRole("button", { name: /chat monitoring/i }),
      chatRow.getByRole("button", { name: /^open$/i })
    );
    await chatRow.getByRole("button", { name: /^open$/i }).click();
    await expect(page.getByText(new RegExp(`ThreadID:\\s*${"THREAD-QA-0001"}`))).toBeVisible();

    diag.assertClean();
  });
});
