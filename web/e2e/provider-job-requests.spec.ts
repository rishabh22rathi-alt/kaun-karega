import { createClient } from "@supabase/supabase-js";
import type { Locator, Page, Route } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";

import { bootstrapProviderSession } from "./_support/auth";
import { gotoPath } from "./_support/home";
import { test, expect } from "./_support/test";

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

type MatchFixture = {
  taskId: string;
  matchStatus: "matched" | "responded" | "accepted";
  category: string;
  area: string;
  createdAt: string;
};

type ScenarioFixture = {
  label: string;
  provider: ProviderFixture;
  tasks: TaskFixture[];
  matches: MatchFixture[];
};

type SupabaseErrorLike = { message?: string } | null;

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
    const value = trimmed
      .slice(separatorIndex + 1)
      .trim()
      .replace(/^["']|["']$/g, "");
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

function makeSeed(): string {
  return `${Date.now()}${Math.floor(Math.random() * 1000)
    .toString()
    .padStart(3, "0")}`;
}

function makePhone(prefix: string, seed: string): string {
  const digits = seed.replace(/\D/g, "").slice(-8).padStart(8, "0");
  return `${prefix}${digits}`;
}

function nowIsoMinusMinutes(minutes: number): string {
  return new Date(Date.now() - minutes * 60_000).toISOString();
}

function buildProvider(label: string, seed: string, service: string, area: string): ProviderFixture {
  const suffix = seed.slice(-6);
  return {
    providerId: `ZZ-PJR-${label.toUpperCase()}-${suffix}`,
    phone: makePhone("82", seed),
    name: `ZZ Job Requests ${label} ${suffix}`,
    services: [service],
    areas: [area],
  };
}

function buildScenarioOne(): ScenarioFixture {
  const seed = makeSeed();
  const suffix = seed.slice(-6);
  const category = `ZZ Electrician ${suffix}`;
  const area = `ZZ Sardarpura ${suffix}`;

  const tasks: TaskFixture[] = Array.from({ length: 3 }, (_, i) => ({
    taskId: `ZZ-PJR-TASK-${suffix}-${i + 1}`,
    phone: makePhone("74", `${seed}${i + 1}`),
    category,
    area,
    details: `ZZ job request populated ${i + 1}`,
    createdAt: nowIsoMinusMinutes(i + 1),
  }));

  const matches: MatchFixture[] = tasks.map((task, i) => ({
    taskId: task.taskId,
    // First two stay as "matched" (New), last one is "responded".
    matchStatus: i < 2 ? "matched" : "responded",
    category,
    area,
    createdAt: task.createdAt,
  }));

  return {
    label: "scenario-one-populated",
    provider: buildProvider("POPULATED", seed, category, area),
    tasks,
    matches,
  };
}

function buildScenarioTwo(): ScenarioFixture {
  const seed = makeSeed();
  const suffix = seed.slice(-6);
  const category = `ZZ Electrician ${suffix}`;
  const area = `ZZ Sardarpura ${suffix}`;

  return {
    label: "scenario-two-empty",
    provider: buildProvider("EMPTY", seed, category, area),
    tasks: [],
    matches: [],
  };
}

function buildScenarioThree(): ScenarioFixture {
  const seed = makeSeed();
  const suffix = seed.slice(-6);
  const electrician = `ZZ Electrician ${suffix}`;
  const plumber = `ZZ Plumber ${suffix}`;
  const sardarpura = `ZZ Sardarpura ${suffix}`;
  const chopasni = `ZZ Chopasni ${suffix}`;

  const tasks: TaskFixture[] = [];
  let counter = 1;
  const pushTasks = (category: string, area: string, count: number) => {
    for (let i = 0; i < count; i += 1) {
      tasks.push({
        taskId: `ZZ-PJR-TASK-${suffix}-${counter}`,
        phone: makePhone("74", `${seed}${counter}`),
        category,
        area,
        details: `ZZ job request filter ${category} ${area} ${counter}`,
        createdAt: nowIsoMinusMinutes(counter),
      });
      counter += 1;
    }
  };

  pushTasks(electrician, sardarpura, 2);
  pushTasks(electrician, chopasni, 3);
  pushTasks(plumber, sardarpura, 4);

  // Matches only for Electrician + Sardarpura — reflecting how the matcher
  // pipeline would populate provider_task_matches: pre-filtered to the
  // provider's service/area intersection. The other 7 tasks exist in the DB
  // but were never matched to this provider, so they must not appear in the
  // Job Requests list.
  const matches: MatchFixture[] = tasks
    .filter((t) => t.category === electrician && t.area === sardarpura)
    .map((task) => ({
      taskId: task.taskId,
      matchStatus: "matched",
      category: task.category,
      area: task.area,
      createdAt: task.createdAt,
    }));

  return {
    label: "scenario-three-filter",
    provider: buildProvider("FILTER", seed, electrician, sardarpura),
    tasks,
    matches,
  };
}

function buildScenarioFour(): ScenarioFixture {
  const seed = makeSeed();
  const suffix = seed.slice(-6);
  const category = `ZZ Electrician ${suffix}`;
  const area = `ZZ Sardarpura ${suffix}`;

  const task: TaskFixture = {
    taskId: `ZZ-PJR-TASK-${suffix}-1`,
    phone: makePhone("74", `${seed}1`),
    category,
    area,
    details: `ZZ job request chat action ${suffix}`,
    createdAt: nowIsoMinusMinutes(1),
  };

  return {
    label: "scenario-four-chat",
    provider: buildProvider("CHAT", seed, category, area),
    tasks: [task],
    matches: [
      {
        taskId: task.taskId,
        matchStatus: "matched",
        category,
        area,
        createdAt: task.createdAt,
      },
    ],
  };
}

function buildScenarioFive(): ScenarioFixture {
  const seed = makeSeed();
  const suffix = seed.slice(-6);
  const category = `ZZ Electrician ${suffix}`;
  const area = `ZZ Sardarpura ${suffix}`;

  const tasks: TaskFixture[] = Array.from({ length: 2 }, (_, i) => ({
    taskId: `ZZ-PJR-TASK-${suffix}-${i + 1}`,
    phone: makePhone("74", `${seed}${i + 1}`),
    category,
    area,
    details: `ZZ job request api verify ${i + 1}`,
    createdAt: nowIsoMinusMinutes(i + 1),
  }));

  return {
    label: "scenario-five-api",
    provider: buildProvider("API", seed, category, area),
    tasks,
    matches: tasks.map((task) => ({
      taskId: task.taskId,
      matchStatus: "matched",
      category: task.category,
      area: task.area,
      createdAt: task.createdAt,
    })),
  };
}

async function insertScenario(
  client: ReturnType<typeof createAdminSupabaseClient>,
  scenario: ScenarioFixture
) {
  const { provider, tasks, matches } = scenario;

  const providerInsert = await client.from("providers").insert({
    provider_id: provider.providerId,
    full_name: provider.name,
    phone: provider.phone,
    status: "active",
    verified: "yes",
  });
  assertNoSupabaseError("providers insert failed", providerInsert.error);

  if (provider.services.length > 0) {
    const servicesInsert = await client.from("provider_services").insert(
      provider.services.map((category) => ({
        provider_id: provider.providerId,
        category,
      }))
    );
    assertNoSupabaseError("provider_services insert failed", servicesInsert.error);
  }

  if (provider.areas.length > 0) {
    const areasInsert = await client.from("provider_areas").insert(
      provider.areas.map((area) => ({
        provider_id: provider.providerId,
        area,
      }))
    );
    assertNoSupabaseError("provider_areas insert failed", areasInsert.error);
  }

  if (tasks.length > 0) {
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

  if (matches.length > 0) {
    const matchesInsert = await client.from("provider_task_matches").insert(
      matches.map((match) => ({
        provider_id: provider.providerId,
        task_id: match.taskId,
        match_status: match.matchStatus,
        category: match.category,
        area: match.area,
        created_at: match.createdAt,
      }))
    );
    assertNoSupabaseError("provider_task_matches insert failed", matchesInsert.error);
  }
}

async function cleanupScenario(
  client: ReturnType<typeof createAdminSupabaseClient>,
  scenario: ScenarioFixture
) {
  const cleanupErrors: string[] = [];
  const providerId = scenario.provider.providerId;
  const taskIds = scenario.tasks.map((task) => task.taskId);

  const matchesDelete = await client
    .from("provider_task_matches")
    .delete()
    .eq("provider_id", providerId);
  if (matchesDelete.error) {
    cleanupErrors.push(`provider_task_matches delete failed: ${matchesDelete.error.message}`);
  }

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
      `[provider-job-requests] inserted ${JSON.stringify({
        label: scenario.label,
        provider: scenario.provider,
        tasks: scenario.tasks,
        matches: scenario.matches,
      })}`
    );
    await run();
  } catch (error) {
    primaryError = error;
    throw error;
  } finally {
    try {
      await cleanupScenario(client, scenario);
      console.log(`[provider-job-requests] cleaned ${JSON.stringify({ label: scenario.label })}`);
    } catch (cleanupError) {
      console.error("[provider-job-requests] cleanup failed", cleanupError);
      if (!primaryError) {
        throw cleanupError;
      }
    }
  }
}

function jobRequestsHeading(page: Page): Locator {
  return page.getByRole("heading", { name: "Find Work", exact: true });
}

function taskCards(page: Page): Locator {
  // Each matched request is an <article>. Filter to articles that have the
  // "Category in Area" line pattern, which all real cards carry.
  return page.locator("article").filter({ hasText: /\s+in\s+/ });
}

function cardForTask(page: Page, task: { category: string; area: string; details: string }): Locator {
  return page.locator("article").filter({ hasText: task.details });
}

test.describe("Provider dashboard: Job Requests / Recent Matched Requests", () => {
  test("scenario 1 — provider sees matched job requests with correct statuses", async ({
    page,
    diag,
  }) => {
    const scenario = buildScenarioOne();

    await runScenarioWithCleanup(scenario, async () => {
      await bootstrapProviderSession(page, scenario.provider.phone);
      await gotoPath(page, "/provider/job-requests");

      await expect(jobRequestsHeading(page)).toBeVisible();

      const cards = taskCards(page);
      await expect(cards).toHaveCount(scenario.tasks.length);

      for (const task of scenario.tasks) {
        await expect(cardForTask(page, task)).toHaveCount(1);
      }

      // Status filter pills expose the bucketed counts. 3 total = 2 new + 1 responded.
      await expect(page.getByRole("button", { name: /^All\s*3$/ })).toBeVisible();
      await expect(page.getByRole("button", { name: /^New\s*2$/ })).toBeVisible();
      await expect(page.getByRole("button", { name: /^Responded\s*1$/ })).toBeVisible();

      // Exactly one card carries the "Responded" pill; the other two show "New".
      // Scope to <article> descendants so we don't also match the "Responded"
      // filter-tab label outside the card list.
      await expect(page.locator("article").getByText("Responded", { exact: true })).toHaveCount(1);
      await expect(page.locator("article").getByText("New", { exact: true })).toHaveCount(2);

      await expect(
        page.getByText(
          "No matched requests yet. As demand rises in your services and areas, leads will show up here.",
          { exact: true }
        )
      ).toHaveCount(0);

      diag.assertClean();
    });
  });

  test("scenario 2 — empty state when no matched requests exist", async ({ page, diag }) => {
    const scenario = buildScenarioTwo();

    await runScenarioWithCleanup(scenario, async () => {
      await bootstrapProviderSession(page, scenario.provider.phone);
      await gotoPath(page, "/provider/job-requests");

      await expect(jobRequestsHeading(page)).toBeVisible();

      await expect(
        page.getByText(
          "No matched requests yet. As demand rises in your services and areas, leads will show up here.",
          { exact: true }
        )
      ).toBeVisible();

      await expect(taskCards(page)).toHaveCount(0);
      await expect(page.getByRole("button", { name: /^All\s*0$/ })).toBeVisible();

      diag.assertClean();
    });
  });

  test("scenario 3 — only service+area-matching tasks appear (Chopasni / Plumber excluded)", async ({
    page,
    diag,
  }) => {
    const scenario = buildScenarioThree();
    const matchedTaskIds = new Set(scenario.matches.map((m) => m.taskId));
    const shownTasks = scenario.tasks.filter((t) => matchedTaskIds.has(t.taskId));
    const hiddenTasks = scenario.tasks.filter((t) => !matchedTaskIds.has(t.taskId));

    await runScenarioWithCleanup(scenario, async () => {
      await bootstrapProviderSession(page, scenario.provider.phone);
      await gotoPath(page, "/provider/job-requests");

      await expect(jobRequestsHeading(page)).toBeVisible();

      await expect(taskCards(page)).toHaveCount(shownTasks.length);
      expect(shownTasks).toHaveLength(2);

      for (const task of shownTasks) {
        await expect(cardForTask(page, task)).toHaveCount(1);
      }

      for (const task of hiddenTasks) {
        await expect(cardForTask(page, task)).toHaveCount(0);
      }

      diag.assertClean();
    });
  });

  test("scenario 4 — Chat action routes to /chat/thread/<threadId> with a valid taskId (no undefined, no 404)", async ({
    page,
    diag,
  }) => {
    const scenario = buildScenarioFour();
    const task = scenario.tasks[0];
    const fakeThreadId = `ZZ-PJR-THREAD-${scenario.provider.providerId.slice(-6)}`;
    const kkRequestBodies: string[] = [];
    const respondRequestBodies: string[] = [];

    await runScenarioWithCleanup(scenario, async () => {
      await bootstrapProviderSession(page, scenario.provider.phone);

      // Stub the respond + chat-thread endpoints so the test isn't coupled to
      // the real chat infrastructure while still verifying the UI sends the
      // correct taskId (this is the bug the scenario exists to catch).
      await page.route("**/api/tasks/respond", async (route: Route) => {
        respondRequestBodies.push(route.request().postData() || "");
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ success: true }),
        });
      });

      await page.route("**/api/kk", async (route: Route) => {
        const body = route.request().postData() || "";
        let parsed: Record<string, unknown> = {};
        try {
          parsed = JSON.parse(body) as Record<string, unknown>;
        } catch {}
        if (parsed.action === "chat_create_or_get_thread") {
          kkRequestBodies.push(body);
          await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({ ok: true, ThreadID: fakeThreadId }),
          });
          return;
        }
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ ok: true, threads: [] }),
        });
      });

      // Stub the thread page so we don't depend on chat infrastructure — just
      // verify the URL we navigated to is well-formed (no "undefined", no 404).
      await page.route(`**/chat/thread/${fakeThreadId}**`, async (route: Route) => {
        await route.fulfill({
          status: 200,
          contentType: "text/html",
          body: `<!doctype html><html><body><main data-testid="stubbed-thread"><h1>Thread ${fakeThreadId}</h1></main></body></html>`,
        });
      });

      await gotoPath(page, "/provider/job-requests");
      await expect(jobRequestsHeading(page)).toBeVisible();

      const card = cardForTask(page, task);
      await expect(card).toHaveCount(1);

      const chatButton = card.getByRole("button", { name: /^Chat|Opening/ });
      await expect(chatButton).toBeVisible();

      await chatButton.click();
      await page.waitForURL(new RegExp(`/chat/thread/${fakeThreadId}`), { timeout: 10_000 });

      expect(page.url(), "scenario 4: URL must not contain 'undefined'").not.toContain("undefined");
      expect(page.url()).toMatch(new RegExp(`/chat/thread/${fakeThreadId}`));

      // Verify the UI sent the actual taskId to /api/kk — this is the guard
      // against the previous taskId=undefined regression.
      expect(kkRequestBodies.length, "scenario 4: /api/kk was not called").toBeGreaterThan(0);
      const kkPayload = JSON.parse(kkRequestBodies[0]) as Record<string, unknown>;
      expect(kkPayload.TaskID, "scenario 4: /api/kk was called with TaskID=undefined").toBe(
        task.taskId
      );

      // And the implicit respond call must carry a concrete taskId + providerId.
      expect(respondRequestBodies.length).toBeGreaterThan(0);
      const respondPayload = JSON.parse(respondRequestBodies[0]) as Record<string, unknown>;
      expect(respondPayload.taskId).toBe(task.taskId);
      expect(respondPayload.providerId).toBe(scenario.provider.providerId);

      diag.assertClean();
    });
  });

  test("scenario 5 — /api/provider/dashboard-profile exposes RecentMatchedRequests matching the UI", async ({
    page,
    diag,
  }) => {
    const scenario = buildScenarioFive();

    await runScenarioWithCleanup(scenario, async () => {
      await bootstrapProviderSession(page, scenario.provider.phone);

      const responsePromise = page.waitForResponse(
        (response) =>
          response.url().includes("/api/provider/dashboard-profile") &&
          response.request().method() === "GET"
      );

      await gotoPath(page, "/provider/job-requests");

      const response = await responsePromise;
      expect(response.status()).toBe(200);

      type DashboardProfileResponse = {
        ok?: boolean;
        provider?: {
          Analytics?: {
            RecentMatchedRequests?: Array<{ TaskID?: string }>;
          };
        };
      };
      const body = (await response.json()) as DashboardProfileResponse;
      const list = body.provider?.Analytics?.RecentMatchedRequests;
      expect(
        Array.isArray(list),
        "scenario 5: Analytics.RecentMatchedRequests must be an array"
      ).toBe(true);

      const apiTaskIds = (list || []).map((item) => String(item.TaskID || "").trim()).sort();
      const fixtureTaskIds = scenario.tasks.map((t) => t.taskId).sort();
      expect(apiTaskIds).toEqual(fixtureTaskIds);

      await expect(jobRequestsHeading(page)).toBeVisible();
      await expect(taskCards(page)).toHaveCount(fixtureTaskIds.length);

      diag.assertClean();
    });
  });
});
