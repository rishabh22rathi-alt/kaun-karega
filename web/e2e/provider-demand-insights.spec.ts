import { createClient } from "@supabase/supabase-js";
import type { Page } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";

import { bootstrapProviderSession } from "./_support/auth";
import { gotoPath } from "./_support/home";
import { test, expect } from "./_support/test";

type DashboardMetrics = {
  TotalRequestsMatchedToMe?: number;
  TotalRequestsRespondedByMe?: number;
  ResponseRate?: number;
};

type DashboardProfileResponse = {
  ok: boolean;
  error?: string;
  provider?: {
    Analytics?: {
      Metrics?: DashboardMetrics;
      RecentMatchedRequests?: unknown[];
      AreaDemand?: unknown[];
      SelectedAreaDemand?: unknown[];
    };
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
  userPhone: string;
  status: "submitted" | "provider_responded";
  matchStatus: "matched" | "responded";
  details: string;
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

function metricCardByTitle(page: Page, title: string) {
  return page.getByRole("main").getByText(title, { exact: true }).locator("..");
}

function makePhone(prefix: string, seed: string): string {
  const digits = seed.replace(/\D/g, "").slice(-8).padStart(8, "0");
  return `${prefix}${digits}`;
}

function buildScenario(label: "filled" | "empty"): ScenarioFixture {
  const seed = `${Date.now()}${Math.floor(Math.random() * 1000)
    .toString()
    .padStart(3, "0")}`;
  const suffix = seed.slice(-6);
  const category = "Electrician";
  const area = "Sardarpura";
  const providerPhonePrefix = label === "filled" ? "81" : "82";

  const provider: ProviderFixture = {
    providerId: `ZZ-DI-${label.toUpperCase()}-${suffix}`,
    phone: makePhone(providerPhonePrefix, seed),
    name: `ZZ Demand Insights ${label.toUpperCase()} ${suffix}`,
    category,
    area,
  };

  if (label === "empty") {
    return {
      label,
      provider,
      tasks: [],
    };
  }

  return {
    label,
    provider,
    tasks: [
      {
        taskId: `ZZ-DI-TASK-${suffix}-1`,
        userPhone: makePhone("71", `${seed}1`),
        status: "provider_responded",
        matchStatus: "responded",
        details: `ZZ demand insights matched lead 1 for ${suffix}`,
      },
      {
        taskId: `ZZ-DI-TASK-${suffix}-2`,
        userPhone: makePhone("72", `${seed}2`),
        status: "provider_responded",
        matchStatus: "responded",
        details: `ZZ demand insights matched lead 2 for ${suffix}`,
      },
      {
        taskId: `ZZ-DI-TASK-${suffix}-3`,
        userPhone: makePhone("73", `${seed}3`),
        status: "submitted",
        matchStatus: "matched",
        details: `ZZ demand insights matched lead 3 for ${suffix}`,
      },
      {
        taskId: `ZZ-DI-TASK-${suffix}-4`,
        userPhone: makePhone("74", `${seed}4`),
        status: "submitted",
        matchStatus: "matched",
        details: `ZZ demand insights matched lead 4 for ${suffix}`,
      },
    ],
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
      category: provider.category,
      area: provider.area,
      details: task.details,
      phone: task.userPhone,
      selected_timeframe: "Today",
      status: task.status,
    }))
  );
  assertNoSupabaseError("tasks insert failed", tasksInsert.error);

  const matchesInsert = await client.from("provider_task_matches").insert(
    tasks.map((task) => ({
      task_id: task.taskId,
      provider_id: provider.providerId,
      category: provider.category,
      area: provider.area,
      match_status: task.matchStatus,
    }))
  );
  assertNoSupabaseError("provider_task_matches insert failed", matchesInsert.error);
}

async function cleanupScenario(client: ReturnType<typeof createAdminSupabaseClient>, scenario: ScenarioFixture) {
  const cleanupErrors: string[] = [];
  const taskIds = scenario.tasks.map((task) => task.taskId);
  const providerId = scenario.provider.providerId;

  if (taskIds.length > 0) {
    const matchesDelete = await client.from("provider_task_matches").delete().in("task_id", taskIds);
    if (matchesDelete.error) {
      cleanupErrors.push(`provider_task_matches delete failed: ${matchesDelete.error.message}`);
    }

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

async function runScenarioWithCleanup(
  scenario: ScenarioFixture,
  run: () => Promise<void>
): Promise<void> {
  const client = createAdminSupabaseClient();
  let primaryError: unknown = null;

  try {
    await insertScenario(client, scenario);
    console.log(
      `[provider-demand-insights] inserted ${JSON.stringify({
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
      console.log(`[provider-demand-insights] cleaned ${JSON.stringify({ label: scenario.label })}`);
    } catch (cleanupError) {
      console.error("[provider-demand-insights] cleanup failed", cleanupError);
      if (!primaryError) {
        throw cleanupError;
      }
    }
  }
}

test.describe("Provider dashboard: My Demand Insights", () => {
  test("shows 4 matched leads, 2 responded leads, and a 50% response rate from real Supabase data", async ({
    page,
    diag,
  }) => {
    const scenario = buildScenario("filled");

    await runScenarioWithCleanup(scenario, async () => {
      await bootstrapProviderSession(page, scenario.provider.phone);
      const dashboardProfile = await gotoDashboardAndReadProfile(page);
      const metrics = dashboardProfile.provider?.Analytics?.Metrics || {};
      const recentMatchedRequests = dashboardProfile.provider?.Analytics?.RecentMatchedRequests || [];
      const areaDemand = dashboardProfile.provider?.Analytics?.AreaDemand;
      const selectedAreaDemand = dashboardProfile.provider?.Analytics?.SelectedAreaDemand;

      console.log(
        `[provider-demand-insights] analytics ${JSON.stringify({
          label: scenario.label,
          metrics,
          recentMatchedRequestsCount: Array.isArray(recentMatchedRequests)
            ? recentMatchedRequests.length
            : "not-an-array",
          hasAreaDemand: Array.isArray(areaDemand) ? areaDemand.length : null,
          hasSelectedAreaDemand: Array.isArray(selectedAreaDemand) ? selectedAreaDemand.length : null,
        })}`
      );

      expect(dashboardProfile.ok, dashboardProfile.error || "dashboard-profile returned ok:false").toBe(true);
      expect(metrics.TotalRequestsMatchedToMe).toBe(4);
      expect(metrics.TotalRequestsRespondedByMe).toBe(2);
      expect(metrics.ResponseRate).toBe(50);

      await expect(page.getByRole("heading", { name: "My Demand Insights" })).toBeVisible();
      await expect(metricCardByTitle(page, "Matched To You").locator("p").nth(1)).toHaveText("4");
      await expect(metricCardByTitle(page, "Responded By You").locator("p").nth(1)).toHaveText("2");
      await expect(metricCardByTitle(page, "Responded By You")).toContainText("Response rate 50%");
      await expect(page.getByText(/Response rate:\s*50%/)).toBeVisible();
      await expect(page.getByText("You have responded to 2 out of 4 matched leads.")).toBeVisible();
      await expect(
        page.getByText("Demand insights will appear once customer requests start coming in.", { exact: true })
      ).toHaveCount(0);

      diag.assertClean();
    });
  });

  test("shows the empty-state copy and a 0% response rate when the provider has no matched leads", async ({
    page,
    diag,
  }) => {
    const scenario = buildScenario("empty");

    await runScenarioWithCleanup(scenario, async () => {
      await bootstrapProviderSession(page, scenario.provider.phone);
      const dashboardProfile = await gotoDashboardAndReadProfile(page);
      const metrics = dashboardProfile.provider?.Analytics?.Metrics || {};
      const recentMatchedRequests = dashboardProfile.provider?.Analytics?.RecentMatchedRequests || [];

      console.log(
        `[provider-demand-insights] analytics ${JSON.stringify({
          label: scenario.label,
          metrics,
          recentMatchedRequestsCount: Array.isArray(recentMatchedRequests)
            ? recentMatchedRequests.length
            : "not-an-array",
        })}`
      );

      expect(dashboardProfile.ok, dashboardProfile.error || "dashboard-profile returned ok:false").toBe(true);
      expect(metrics.TotalRequestsMatchedToMe).toBe(0);
      expect(metrics.TotalRequestsRespondedByMe).toBe(0);
      expect(metrics.ResponseRate).toBe(0);

      await expect(page.getByRole("heading", { name: "My Demand Insights" })).toBeVisible();
      await expect(metricCardByTitle(page, "Matched To You").locator("p").nth(1)).toHaveText("0");
      await expect(metricCardByTitle(page, "Responded By You").locator("p").nth(1)).toHaveText("0");
      await expect(metricCardByTitle(page, "Responded By You")).toContainText("Response rate 0%");
      await expect(page.getByText(/Response rate:\s*0%/)).toBeVisible();
      await expect(
        page.getByText("Demand insights will appear once customer requests start coming in.", { exact: true })
      ).toBeVisible();
      await expect(page.getByText("You have responded to 0 out of 0 matched leads.")).toBeVisible();

      diag.assertClean();
    });
  });
});
