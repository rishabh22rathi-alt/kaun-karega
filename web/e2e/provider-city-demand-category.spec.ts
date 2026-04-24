import { createClient } from "@supabase/supabase-js";
import type { Page, Route } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";

import { bootstrapProviderSession } from "./_support/auth";
import { gotoPath } from "./_support/home";
import { test, expect } from "./_support/test";

type CategoryDemandRow = {
  CategoryName: string;
  RequestCount: number;
};

type CategoryDemandByRange = {
  today?: CategoryDemandRow[];
  last7Days?: CategoryDemandRow[];
  last30Days?: CategoryDemandRow[];
  last365Days?: CategoryDemandRow[];
};

type DashboardProfileResponse = {
  ok: boolean;
  error?: string;
  provider?: {
    ProviderID?: string;
    ProviderName?: string;
    Phone?: string;
    Analytics?: {
      CategoryDemandByRange?: CategoryDemandByRange;
      [key: string]: unknown;
    };
    [key: string]: unknown;
  };
};

type ProviderFixture = {
  providerId: string;
  phone: string;
  name: string;
  category: string;
  area: string;
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

function cityDemandSection(page: Page) {
  return page
    .getByRole("heading", { name: "City Demand by Service Category" })
    .locator("xpath=ancestor::section[1]");
}

function categoryCard(section: ReturnType<typeof cityDemandSection>, categoryName: string) {
  return section
    .getByRole("heading", { level: 3, name: categoryName, exact: true })
    .locator("xpath=ancestor::article[1]");
}

function addDays(date: Date, deltaDays: number): Date {
  const next = new Date(date.getTime());
  next.setUTCDate(next.getUTCDate() + deltaDays);
  return next;
}

function isoAtUtc(date: Date, hour: number, minute: number): string {
  const next = new Date(date.getTime());
  next.setUTCHours(hour, minute, 0, 0);
  return next.toISOString();
}

function buildProvider(label: string, seed: string): ProviderFixture {
  const suffix = seed.slice(-6);
  return {
    providerId: `ZZ-PCDC-${label.toUpperCase()}-${suffix}`,
    phone: makePhone("83", seed),
    name: `ZZ City Demand ${label.toUpperCase()} ${suffix}`,
    category: "Electrician",
    area: "Sardarpura",
  };
}

function buildPopulatedScenario(): ScenarioFixture {
  const seed = `${Date.now()}${Math.floor(Math.random() * 1000)
    .toString()
    .padStart(3, "0")}`;
  const provider = buildProvider("filled", seed);
  const now = new Date();

  const tasks: TaskFixture[] = [];
  let counter = 1;

  const pushTasks = (category: string, count: number) => {
    for (let index = 0; index < count; index += 1) {
      tasks.push({
        taskId: `ZZ-PCDC-TASK-${seed.slice(-6)}-${counter}`,
        phone: makePhone("75", `${seed}${counter}`),
        category,
        area: "Sardarpura",
        details: `ZZ city demand populated ${category} ${counter}`,
        createdAt: new Date(now.getTime() - index * 60_000).toISOString(),
      });
      counter += 1;
    }
  };

  pushTasks("Electrician", 5);
  pushTasks("Plumber", 3);
  pushTasks("Carpenter", 1);

  return {
    label: "filled",
    provider,
    tasks,
  };
}

function buildDateFilterScenario(): ScenarioFixture {
  const seed = `${Date.now()}${Math.floor(Math.random() * 1000)
    .toString()
    .padStart(3, "0")}`;
  const suffix = seed.slice(-6);
  const provider = buildProvider("filters", seed);
  const now = new Date();

  return {
    label: "filters",
    provider,
    tasks: [
      {
        taskId: `ZZ-PCDC-DATE-${suffix}-1`,
        phone: makePhone("76", `${seed}1`),
        category: `ZZ Date Today ${suffix}`,
        area: "Sardarpura",
        details: `ZZ city demand today ${suffix}`,
        createdAt: isoAtUtc(now, 6, 0),
      },
      {
        taskId: `ZZ-PCDC-DATE-${suffix}-2`,
        phone: makePhone("77", `${seed}2`),
        category: `ZZ Date 10d ${suffix}`,
        area: "Sardarpura",
        details: `ZZ city demand 10d ${suffix}`,
        createdAt: isoAtUtc(addDays(now, -10), 6, 0),
      },
      {
        taskId: `ZZ-PCDC-DATE-${suffix}-3`,
        phone: makePhone("78", `${seed}3`),
        category: `ZZ Date 40d ${suffix}`,
        area: "Sardarpura",
        details: `ZZ city demand 40d ${suffix}`,
        createdAt: isoAtUtc(addDays(now, -40), 6, 0),
      },
    ],
  };
}

function buildEmptyScenario(): ScenarioFixture {
  const seed = `${Date.now()}${Math.floor(Math.random() * 1000)
    .toString()
    .padStart(3, "0")}`;
  return {
    label: "empty",
    provider: buildProvider("empty", seed),
    tasks: [],
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

  const servicesInsert = await client.from("provider_services").insert({
    provider_id: provider.providerId,
    category: provider.category,
  });
  assertNoSupabaseError("provider_services insert failed", servicesInsert.error);

  const areasInsert = await client.from("provider_areas").insert({
    provider_id: provider.providerId,
    area: provider.area,
  });
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
      `[provider-city-demand-category] inserted ${JSON.stringify({
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
      console.log(`[provider-city-demand-category] cleaned ${JSON.stringify({ label: scenario.label })}`);
    } catch (cleanupError) {
      console.error("[provider-city-demand-category] cleanup failed", cleanupError);
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

function requireCategoryDemandByRange(
  response: DashboardProfileResponse,
  label: string
): CategoryDemandByRange {
  const analytics = response.provider?.Analytics;
  const categoryDemandByRange = analytics?.CategoryDemandByRange;

  expect(response.ok, response.error || `${label}: dashboard-profile returned ok:false`).toBe(true);
  expect(
    categoryDemandByRange && typeof categoryDemandByRange === "object",
    `${label}: missing Analytics.CategoryDemandByRange in /api/provider/dashboard-profile response`
  ).toBeTruthy();

  return categoryDemandByRange as CategoryDemandByRange;
}

async function mockEmptyCityDemandApi(page: Page, provider: ProviderFixture) {
  await page.route("**/api/provider/dashboard-profile**", async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        provider: {
          ProviderID: provider.providerId,
          ProviderName: provider.name,
          Phone: provider.phone,
          Verified: "yes",
          OtpVerified: "yes",
          PendingApproval: "no",
          Status: "active",
          Services: [{ Category: provider.category }],
          Areas: [{ Area: provider.area }],
          Analytics: {
            Summary: {
              ProviderID: provider.providerId,
              Categories: [provider.category],
              Areas: [provider.area],
            },
            Metrics: {
              TotalRequestsInMyCategories: 0,
              TotalRequestsMatchedToMe: 0,
              TotalRequestsRespondedByMe: 0,
              TotalRequestsAcceptedByMe: 0,
              TotalRequestsCompletedByMe: 0,
              ResponseRate: 0,
              AcceptanceRate: 0,
            },
            AreaDemand: [],
            SelectedAreaDemand: [],
            CategoryDemandByRange: {
              today: [],
              last7Days: [],
              last30Days: [],
              last365Days: [],
            },
            RecentMatchedRequests: [],
          },
          AreaCoverage: {
            ActiveApprovedAreas: [{ Area: provider.area, Status: "active" }],
            PendingAreaRequests: [],
            ResolvedOutcomes: [],
          },
        },
      }),
    });
  });

  await page.route("**/api/kk**", async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, threads: [] }),
    });
  });
}

test.describe("Provider dashboard: City Demand by Service Category", () => {
  test("shows populated city-wide category demand from real Supabase data for the Today filter", async ({
    page,
    diag,
  }) => {
    const scenario = buildPopulatedScenario();

    await runScenarioWithCleanup(scenario, async () => {
      await bootstrapProviderSession(page, scenario.provider.phone);
      const dashboardProfile = await gotoDashboardAndReadProfile(page);
      const categoryDemandByRange = requireCategoryDemandByRange(dashboardProfile, "populated");
      const todayDemand = categoryDemandByRange.today;

      expect(Array.isArray(todayDemand), "populated: missing CategoryDemandByRange.today").toBe(true);

      console.log(
        `[provider-city-demand-category] analytics ${JSON.stringify({
          label: scenario.label,
          categoryDemandByRange,
        })}`
      );

      const section = cityDemandSection(page);
      await expect(section).toBeVisible();

      const todayButton = section.getByRole("button", { name: "Today", exact: true });
      await todayButton.click();

      await expect(categoryCard(section, "Electrician")).toBeVisible();
      await expect(categoryCard(section, "Plumber")).toBeVisible();
      await expect(categoryCard(section, "Carpenter")).toBeVisible();
      await expect(section.getByText("No category demand data yet.", { exact: true })).toHaveCount(0);
      await expect(
        section.getByText("No category demand data is available for the selected time range yet.", {
          exact: true,
        })
      ).toHaveCount(0);

      const cardOrder = await section.locator("article h3").allTextContents();
      const electricianIndex = cardOrder.indexOf("Electrician");
      const plumberIndex = cardOrder.indexOf("Plumber");
      const carpenterIndex = cardOrder.indexOf("Carpenter");

      expect(electricianIndex).toBeGreaterThanOrEqual(0);
      expect(plumberIndex).toBeGreaterThanOrEqual(0);
      expect(carpenterIndex).toBeGreaterThanOrEqual(0);
      expect(electricianIndex, `Unexpected card order: ${cardOrder.join(" | ")}`).toBeLessThan(plumberIndex);
      expect(plumberIndex, `Unexpected card order: ${cardOrder.join(" | ")}`).toBeLessThan(carpenterIndex);

      diag.assertClean();
    });
  });

  test("shows an empty-state message when the selected category-demand range has no data", async ({
    page,
    diag,
  }) => {
    const scenario = buildEmptyScenario();

    await runScenarioWithCleanup(scenario, async () => {
      await mockEmptyCityDemandApi(page, scenario.provider);
      await bootstrapProviderSession(page, scenario.provider.phone);
      await gotoPath(page, "/provider/dashboard");

      const section = cityDemandSection(page);
      await expect(section).toBeVisible();

      const last365DaysButton = section.getByRole("button", { name: "Last 365 Days", exact: true });
      await last365DaysButton.click();

      const hardEmpty = section.getByText("No category demand data yet.", { exact: true });
      const rangeEmpty = section.getByText(
        "No category demand data is available for the selected time range yet.",
        { exact: true }
      );

      await expect(hardEmpty).toBeVisible();
      await expect(rangeEmpty).toBeVisible();

      diag.assertClean();
    });
  });

  test("applies date filters so Today, Last 7 Days, Last 30 Days, and Last 365 Days show the correct buckets", async ({
    page,
    diag,
  }) => {
    const scenario = buildDateFilterScenario();
    const todayCategory = scenario.tasks[0].category;
    const tenDayCategory = scenario.tasks[1].category;
    const fortyDayCategory = scenario.tasks[2].category;

    await runScenarioWithCleanup(scenario, async () => {
      await bootstrapProviderSession(page, scenario.provider.phone);
      const dashboardProfile = await gotoDashboardAndReadProfile(page);
      const categoryDemandByRange = requireCategoryDemandByRange(dashboardProfile, "date-filters");

      expect(Array.isArray(categoryDemandByRange.today), "date-filters: missing CategoryDemandByRange.today").toBe(
        true
      );
      expect(
        Array.isArray(categoryDemandByRange.last7Days),
        "date-filters: missing CategoryDemandByRange.last7Days"
      ).toBe(true);
      expect(
        Array.isArray(categoryDemandByRange.last30Days),
        "date-filters: missing CategoryDemandByRange.last30Days"
      ).toBe(true);
      expect(
        Array.isArray(categoryDemandByRange.last365Days),
        "date-filters: missing CategoryDemandByRange.last365Days"
      ).toBe(true);

      console.log(
        `[provider-city-demand-category] analytics ${JSON.stringify({
          label: scenario.label,
          categoryDemandByRange,
        })}`
      );

      const section = cityDemandSection(page);
      await expect(section).toBeVisible();

      await section.getByRole("button", { name: "Today", exact: true }).click();
      await expect(categoryCard(section, todayCategory)).toBeVisible();
      await expect(categoryCard(section, tenDayCategory)).toHaveCount(0);
      await expect(categoryCard(section, fortyDayCategory)).toHaveCount(0);

      await section.getByRole("button", { name: "Last 7 Days", exact: true }).click();
      await expect(categoryCard(section, todayCategory)).toBeVisible();
      await expect(categoryCard(section, tenDayCategory)).toHaveCount(0);
      await expect(categoryCard(section, fortyDayCategory)).toHaveCount(0);

      await section.getByRole("button", { name: "Last 30 Days", exact: true }).click();
      await expect(categoryCard(section, todayCategory)).toBeVisible();
      await expect(categoryCard(section, tenDayCategory)).toBeVisible();
      await expect(categoryCard(section, fortyDayCategory)).toHaveCount(0);

      await section.getByRole("button", { name: "Last 365 Days", exact: true }).click();
      await expect(categoryCard(section, todayCategory)).toBeVisible();
      await expect(categoryCard(section, tenDayCategory)).toBeVisible();
      await expect(categoryCard(section, fortyDayCategory)).toBeVisible();

      diag.assertClean();
    });
  });
});
