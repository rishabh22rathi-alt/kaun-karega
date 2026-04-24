import { createClient } from "@supabase/supabase-js";
import type { Page } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";

import { bootstrapProviderSession } from "./_support/auth";
import { gotoPath } from "./_support/home";
import { test, expect } from "./_support/test";

type AreaDemandRow = {
  AreaName: string;
  RequestCount: number;
  IsSelectedByProvider?: boolean;
};

type DashboardProfileResponse = {
  ok: boolean;
  error?: string;
  provider?: {
    ProviderID?: string;
    ProviderName?: string;
    Phone?: string;
    Analytics?: {
      AreaDemand?: AreaDemandRow[];
      SelectedAreaDemand?: AreaDemandRow[];
      [key: string]: unknown;
    };
    [key: string]: unknown;
  };
};

type ProviderFixture = {
  providerId: string;
  phone: string;
  name: string;
  services: string[];
  areas: string[];
};

type TaskFixture = {
  taskId: string;
  phone: string;
  category: string;
  area: string;
  details: string;
  createdAt: string;
};

type ScenarioFixture = {
  label: string;
  provider: ProviderFixture;
  tasks: TaskFixture[];
};

type SupabaseErrorLike = {
  message?: string;
} | null;

let cachedEnvLocal: Record<string, string> | null = null;

function loadEnvLocal(): Record<string, string> {
  if (cachedEnvLocal) return cachedEnvLocal;

  const envPath = path.resolve(__dirname, "../.env.local");
  if (!fs.existsSync(envPath)) {
    cachedEnvLocal = {};
    return cachedEnvLocal;
  }

  const env: Record<string, string> = {};
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex === -1) continue;

    const key = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed.slice(separatorIndex + 1).trim().replace(/^["']|["']$/g, "");
    env[key] = value;
  }

  cachedEnvLocal = env;
  return cachedEnvLocal;
}

function getEnv(name: string): string {
  return process.env[name] || loadEnvLocal()[name] || "";
}

function createAdminSupabaseClient() {
  const url = getEnv("SUPABASE_URL") || getEnv("NEXT_PUBLIC_SUPABASE_URL");
  const serviceRoleKey = getEnv("SUPABASE_SERVICE_ROLE_KEY");

  if (!url || !serviceRoleKey) {
    throw new Error(
      "Missing Supabase admin env. Expected SUPABASE_URL or NEXT_PUBLIC_SUPABASE_URL plus SUPABASE_SERVICE_ROLE_KEY."
    );
  }

  return createClient(url, serviceRoleKey, {
    auth: { persistSession: false },
  });
}

function assertNoSupabaseError(label: string, error: SupabaseErrorLike): void {
  if (error) {
    throw new Error(`${label}: ${error.message || "Unknown Supabase error"}`);
  }
}

function makePhone(prefix: string, seed: string): string {
  const digits = seed.replace(/\D/g, "").slice(-8).padStart(8, "0");
  return `${prefix}${digits}`;
}

function makeSeed(): string {
  return `${Date.now()}${Math.floor(Math.random() * 1000)
    .toString()
    .padStart(3, "0")}`;
}

function nowIsoMinusMinutes(minutes: number): string {
  return new Date(Date.now() - minutes * 60_000).toISOString();
}

function areaDemandSection(page: Page) {
  return page.getByRole("heading", { name: "Area Demand Heat Table" }).locator("xpath=ancestor::section[1]");
}

function selectedAreasSection(page: Page) {
  return page
    .getByRole("heading", { name: "My Selected Areas Performance" })
    .locator("xpath=ancestor::section[1]");
}

function tableRowByArea(section: ReturnType<typeof areaDemandSection>, area: string) {
  // `filter({ has })` re-anchors the inner locator under each candidate `<tr>`.
  // A `section`-rooted inner (e.g. `section.getByRole(...)`) starts with the
  // page-level heading lookup, which cannot resolve under a `<tr>` — so every
  // row is filtered out. Root the inner locator at `page` so descendant-check
  // semantics apply cleanly.
  return section
    .locator("tbody tr")
    .filter({ has: section.page().getByRole("cell", { name: area, exact: true }) });
}

function selectedAreaCard(section: ReturnType<typeof selectedAreasSection>, area: string) {
  return section
    .getByText(area, { exact: true })
    .locator("xpath=ancestor::div[contains(@class,'rounded-2xl')][1]");
}

function getAreaCount(rows: AreaDemandRow[] | undefined, area: string): number | null {
  if (!Array.isArray(rows)) return null;
  const match = rows.find((row) => String(row.AreaName || "").trim() === area);
  return match ? Number(match.RequestCount || 0) : null;
}

function buildScenarioOne(): ScenarioFixture {
  const seed = makeSeed();
  const suffix = seed.slice(-6);
  const mainCategory = `ZZ Electrician ${suffix}`;
  const otherCategory = `ZZ Plumber ${suffix}`;

  const provider: ProviderFixture = {
    providerId: `ZZ-PADP-ONE-${suffix}`,
    phone: makePhone("84", seed),
    name: `ZZ Area Demand One ${suffix}`,
    services: [mainCategory],
    areas: ["Sardarpura", "Chopasni", "Paota"],
  };

  const tasks: TaskFixture[] = [];
  let counter = 1;

  const pushTasks = (category: string, area: string, count: number) => {
    for (let index = 0; index < count; index += 1) {
      tasks.push({
        taskId: `ZZ-PADP-TASK-${suffix}-${counter}`,
        phone: makePhone("79", `${seed}${counter}`),
        category,
        area,
        details: `ZZ provider area demand ${category} ${area} ${counter}`,
        createdAt: nowIsoMinusMinutes(counter),
      });
      counter += 1;
    }
  };

  pushTasks(mainCategory, "Sardarpura", 5);
  pushTasks(mainCategory, "Chopasni", 3);
  pushTasks(mainCategory, "Paota", 1);
  pushTasks(otherCategory, "Sardarpura", 4);

  return {
    label: "scenario-one",
    provider,
    tasks,
  };
}

function buildScenarioTwo(): ScenarioFixture {
  const seed = makeSeed();
  const suffix = seed.slice(-6);
  const mainCategory = `ZZ Electrician ${suffix}`;
  const otherCategory = `ZZ Plumber ${suffix}`;

  return {
    label: "scenario-two",
    provider: {
      providerId: `ZZ-PADP-TWO-${suffix}`,
      phone: makePhone("85", seed),
      name: `ZZ Area Demand Two ${suffix}`,
      services: [mainCategory],
      areas: ["Sardarpura"],
    },
    tasks: Array.from({ length: 4 }, (_, index) => ({
      taskId: `ZZ-PADP-TASK-${suffix}-${index + 1}`,
      phone: makePhone("88", `${seed}${index + 1}`),
      category: otherCategory,
      area: "Sardarpura",
      details: `ZZ provider area demand plumber only ${index + 1}`,
      createdAt: nowIsoMinusMinutes(index + 1),
    })),
  };
}

function buildScenarioThree(): ScenarioFixture {
  const seed = makeSeed();
  const suffix = seed.slice(-6);
  const mainCategory = `ZZ Electrician ${suffix}`;

  const tasks: TaskFixture[] = [];
  let counter = 1;

  const pushTasks = (area: string, count: number) => {
    for (let index = 0; index < count; index += 1) {
      tasks.push({
        taskId: `ZZ-PADP-TASK-${suffix}-${counter}`,
        phone: makePhone("89", `${seed}${counter}`),
        category: mainCategory,
        area,
        details: `ZZ provider area demand filtering ${area} ${counter}`,
        createdAt: nowIsoMinusMinutes(counter),
      });
      counter += 1;
    }
  };

  pushTasks("Sardarpura", 2);
  pushTasks("Chopasni", 7);

  return {
    label: "scenario-three",
    provider: {
      providerId: `ZZ-PADP-THREE-${suffix}`,
      phone: makePhone("86", seed),
      name: `ZZ Area Demand Three ${suffix}`,
      services: [mainCategory],
      areas: ["Sardarpura"],
    },
    tasks,
  };
}

async function insertScenario(client: ReturnType<typeof createAdminSupabaseClient>, scenario: ScenarioFixture) {
  const { provider, tasks } = scenario;

  const providerInsert = await client.from("providers").insert({
    provider_id: provider.providerId,
    full_name: provider.name,
    phone: provider.phone,
    status: "active",
    verified: "yes",
  });
  assertNoSupabaseError("providers insert failed", providerInsert.error);

  const servicesInsert = await client.from("provider_services").insert(
    provider.services.map((category) => ({
      provider_id: provider.providerId,
      category,
    }))
  );
  assertNoSupabaseError("provider_services insert failed", servicesInsert.error);

  const areasInsert = await client.from("provider_areas").insert(
    provider.areas.map((area) => ({
      provider_id: provider.providerId,
      area,
    }))
  );
  assertNoSupabaseError("provider_areas insert failed", areasInsert.error);

  if (tasks.length === 0) {
    return;
  }

  const tasksInsert = await client.from("tasks").insert(
    tasks.map((task) => ({
      task_id: task.taskId,
      category: task.category,
      area: task.area,
      details: task.details,
      phone: task.phone,
      selected_timeframe: "Today",
      status: "submitted",
      created_at: task.createdAt,
    }))
  );
  assertNoSupabaseError("tasks insert failed", tasksInsert.error);
}

async function cleanupScenario(client: ReturnType<typeof createAdminSupabaseClient>, scenario: ScenarioFixture) {
  const cleanupErrors: string[] = [];
  const taskIds = scenario.tasks.map((task) => task.taskId);
  const providerId = scenario.provider.providerId;

  if (taskIds.length > 0) {
    const tasksDelete = await client.from("tasks").delete().in("task_id", taskIds);
    if (tasksDelete.error) {
      cleanupErrors.push(`tasks delete failed: ${tasksDelete.error.message}`);
    }
  }

  const servicesDelete = await client.from("provider_services").delete().eq("provider_id", providerId);
  if (servicesDelete.error) {
    cleanupErrors.push(`provider_services delete failed: ${servicesDelete.error.message}`);
  }

  const areasDelete = await client.from("provider_areas").delete().eq("provider_id", providerId);
  if (areasDelete.error) {
    cleanupErrors.push(`provider_areas delete failed: ${areasDelete.error.message}`);
  }

  const providersDelete = await client.from("providers").delete().eq("provider_id", providerId);
  if (providersDelete.error) {
    cleanupErrors.push(`providers delete failed: ${providersDelete.error.message}`);
  }

  if (cleanupErrors.length > 0) {
    throw new Error(`Cleanup failed for ${scenario.label}: ${cleanupErrors.join(" | ")}`);
  }
}

async function runScenarioWithCleanup(
  scenario: ScenarioFixture,
  run: () => Promise<void>
): Promise<void> {
  const client = createAdminSupabaseClient();
  let primaryError: unknown = null;

  try {
    await insertScenario(client, scenario);
    console.log(
      `[provider-area-demand-performance] inserted ${JSON.stringify({
        label: scenario.label,
        provider: scenario.provider,
        tasks: scenario.tasks,
      })}`
    );
    await run();
  } catch (error) {
    primaryError = error;
    throw error;
  } finally {
    try {
      await cleanupScenario(client, scenario);
      console.log(`[provider-area-demand-performance] cleaned ${JSON.stringify({ label: scenario.label })}`);
    } catch (cleanupError) {
      console.error("[provider-area-demand-performance] cleanup failed", cleanupError);
      if (!primaryError) {
        throw cleanupError;
      }
    }
  }
}

async function gotoDashboardAndReadProfile(page: Page): Promise<DashboardProfileResponse> {
  const responsePromise = page.waitForResponse(
    (response) =>
      response.url().includes("/api/provider/dashboard-profile") &&
      response.request().method() === "GET"
  );

  await gotoPath(page, "/provider/dashboard");

  const response = await responsePromise;
  expect(response.status()).toBe(200);
  return (await response.json()) as DashboardProfileResponse;
}

function requireAreaAnalytics(
  response: DashboardProfileResponse,
  label: string
): { areaDemand: AreaDemandRow[]; selectedAreaDemand: AreaDemandRow[] } {
  const analytics = response.provider?.Analytics;
  const areaDemand = analytics?.AreaDemand;
  const selectedAreaDemand = analytics?.SelectedAreaDemand;

  expect(response.ok, response.error || `${label}: dashboard-profile returned ok:false`).toBe(true);
  expect(Array.isArray(areaDemand), `${label}: missing Analytics.AreaDemand array`).toBe(true);
  expect(Array.isArray(selectedAreaDemand), `${label}: missing Analytics.SelectedAreaDemand array`).toBe(true);

  return {
    areaDemand: areaDemand as AreaDemandRow[],
    selectedAreaDemand: selectedAreaDemand as AreaDemandRow[],
  };
}

test.describe("Provider dashboard: Area Demand analytics", () => {
  test("shows selected-service area demand in Area Demand Heat Table and My Selected Areas Performance", async ({
    page,
    diag,
  }) => {
    const scenario = buildScenarioOne();

    await runScenarioWithCleanup(scenario, async () => {
      await bootstrapProviderSession(page, scenario.provider.phone);
      const dashboardProfile = await gotoDashboardAndReadProfile(page);
      const { areaDemand, selectedAreaDemand } = requireAreaAnalytics(dashboardProfile, scenario.label);

      console.log(
        `[provider-area-demand-performance] analytics ${JSON.stringify({
          label: scenario.label,
          areaDemand,
          selectedAreaDemand,
        })}`
      );

      expect(getAreaCount(areaDemand, "Sardarpura")).toBe(5);
      expect(getAreaCount(areaDemand, "Chopasni")).toBe(3);
      expect(getAreaCount(areaDemand, "Paota")).toBe(1);
      expect(getAreaCount(selectedAreaDemand, "Sardarpura")).toBe(5);
      expect(getAreaCount(selectedAreaDemand, "Chopasni")).toBe(3);
      expect(getAreaCount(selectedAreaDemand, "Paota")).toBe(1);

      const heatTableSection = areaDemandSection(page);
      await expect(heatTableSection).toBeVisible();
      await expect(heatTableSection.getByText("No demand data yet for your selected services.", { exact: true }))
        .toHaveCount(0);

      const sardarpuraRow = tableRowByArea(heatTableSection, "Sardarpura");
      const chopasniRow = tableRowByArea(heatTableSection, "Chopasni");
      const paotaRow = tableRowByArea(heatTableSection, "Paota");

      await expect(sardarpuraRow).toHaveCount(1);
      await expect(chopasniRow).toHaveCount(1);
      await expect(paotaRow).toHaveCount(1);
      await expect(sardarpuraRow.locator("td").nth(1)).toHaveText("5");
      await expect(chopasniRow.locator("td").nth(1)).toHaveText("3");
      await expect(paotaRow.locator("td").nth(1)).toHaveText("1");

      const orderedAreas = await heatTableSection.locator("tbody tr td:first-child").allTextContents();
      expect(orderedAreas.indexOf("Sardarpura"), `Unexpected heat table order: ${orderedAreas.join(" | ")}`).toBeLessThan(
        orderedAreas.indexOf("Chopasni")
      );
      expect(orderedAreas.indexOf("Chopasni"), `Unexpected heat table order: ${orderedAreas.join(" | ")}`).toBeLessThan(
        orderedAreas.indexOf("Paota")
      );

      const selectedSection = selectedAreasSection(page);
      await expect(selectedSection).toBeVisible();
      await expect(
        selectedSection.getByText(
          "No selected area data yet. Add service areas to start comparing demand.",
          { exact: true }
        )
      ).toHaveCount(0);

      const sardarpuraCard = selectedAreaCard(selectedSection, "Sardarpura");
      const chopasniCard = selectedAreaCard(selectedSection, "Chopasni");
      const paotaCard = selectedAreaCard(selectedSection, "Paota");

      await expect(sardarpuraCard).toContainText("5 requests in your services");
      await expect(chopasniCard).toContainText("3 requests in your services");
      await expect(paotaCard).toContainText("1 request in your services");

      diag.assertClean();
    });
  });

  test("does not count non-selected-service demand for the provider", async ({ page, diag }) => {
    const scenario = buildScenarioTwo();

    await runScenarioWithCleanup(scenario, async () => {
      await bootstrapProviderSession(page, scenario.provider.phone);
      const dashboardProfile = await gotoDashboardAndReadProfile(page);
      const { areaDemand, selectedAreaDemand } = requireAreaAnalytics(dashboardProfile, scenario.label);

      console.log(
        `[provider-area-demand-performance] analytics ${JSON.stringify({
          label: scenario.label,
          areaDemand,
          selectedAreaDemand,
        })}`
      );

      expect(areaDemand).toEqual([]);
      expect(selectedAreaDemand).toEqual([]);

      const heatTableSection = areaDemandSection(page);
      await expect(heatTableSection).toBeVisible();
      await expect(heatTableSection.getByText("No demand data yet for your selected services.", { exact: true }))
        .toBeVisible();

      const selectedSection = selectedAreasSection(page);
      await expect(selectedSection).toBeVisible();
      await expect(
        selectedSection.getByText(
          "No selected area data yet. Add service areas to start comparing demand.",
          { exact: true }
        )
      ).toBeVisible();

      diag.assertClean();
    });
  });

  test("keeps My Selected Areas Performance filtered to selected areas only", async ({ page, diag }) => {
    const scenario = buildScenarioThree();

    await runScenarioWithCleanup(scenario, async () => {
      await bootstrapProviderSession(page, scenario.provider.phone);
      const dashboardProfile = await gotoDashboardAndReadProfile(page);
      const { areaDemand, selectedAreaDemand } = requireAreaAnalytics(dashboardProfile, scenario.label);

      console.log(
        `[provider-area-demand-performance] analytics ${JSON.stringify({
          label: scenario.label,
          areaDemand,
          selectedAreaDemand,
        })}`
      );

      expect(getAreaCount(areaDemand, "Sardarpura")).toBe(2);
      expect(getAreaCount(areaDemand, "Chopasni")).toBe(7);
      expect(getAreaCount(selectedAreaDemand, "Sardarpura")).toBe(2);
      expect(getAreaCount(selectedAreaDemand, "Chopasni")).toBeNull();

      const heatTableSection = areaDemandSection(page);
      await expect(heatTableSection).toBeVisible();
      await expect(tableRowByArea(heatTableSection, "Sardarpura").locator("td").nth(1)).toHaveText("2");
      await expect(tableRowByArea(heatTableSection, "Chopasni").locator("td").nth(1)).toHaveText("7");

      const orderedAreas = await heatTableSection.locator("tbody tr td:first-child").allTextContents();
      expect(orderedAreas.indexOf("Chopasni"), `Unexpected heat table order: ${orderedAreas.join(" | ")}`).toBeLessThan(
        orderedAreas.indexOf("Sardarpura")
      );

      const selectedSection = selectedAreasSection(page);
      await expect(selectedSection).toBeVisible();
      await expect(selectedAreaCard(selectedSection, "Sardarpura")).toContainText("2 requests in your services");
      await expect(selectedSection.getByText("Chopasni", { exact: true })).toHaveCount(0);

      diag.assertClean();
    });
  });
});
