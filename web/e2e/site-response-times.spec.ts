import { createClient } from "@supabase/supabase-js";
import type { Page } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";

import { bootstrapAdminSession, bootstrapProviderSession, bootstrapUserSession } from "./_support/auth";
import { test, expect } from "./_support/test";

type ReadySignal =
  | { kind: "selector"; selector: string }
  | { kind: "role-heading"; name: string; exact?: boolean }
  | { kind: "text"; text: string; exact?: boolean };

type RouteCase = {
  id: string;
  label: string;
  path: string;
  session?: "user" | "provider" | "admin" | "none";
  apiUrlMatcher?: (url: string) => boolean;
  apiLabel?: string;
  readySignals: ReadySignal[]; // first signal that appears wins
  readyTimeoutMs?: number;
  // Optional page.route stubs applied before navigation (useful for chat
  // thread and other pages that require upstream state we don't want to fake
  // in the DB). Each entry is `{ pattern, body, status? }`.
  stubs?: Array<{
    pattern: string | RegExp;
    status?: number;
    contentType?: string;
    body: string;
  }>;
};

type Measurement = {
  id: string;
  label: string;
  path: string;
  pageLoadMs: number | null;
  apiMs: number | null;
  apiLabel: string | null;
  readyMs: number | null;
  status: "PASS" | "WARN" | "FAIL";
  notes: string[];
  appsScriptHits: string[];
  httpErrors: Array<{ url: string; status: number }>;
};

const PAGE_LOAD_THRESHOLD_MS = 3000;
const API_THRESHOLD_MS = 1500;

const PROVIDER_PHONE_PREFIX = "81";

function makeSeed(): string {
  return `${Date.now()}${Math.floor(Math.random() * 1000)
    .toString()
    .padStart(3, "0")}`;
}

function makePhone(prefix: string, seed: string): string {
  const digits = seed.replace(/\D/g, "").slice(-8).padStart(8, "0");
  return `${prefix}${digits}`;
}

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
    const i = trimmed.indexOf("=");
    if (i === -1) continue;
    env[trimmed.slice(0, i).trim()] = trimmed
      .slice(i + 1)
      .trim()
      .replace(/^["']|["']$/g, "");
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
  return createClient(url, serviceRoleKey, { auth: { persistSession: false } });
}

type ProviderFixture = {
  providerId: string;
  phone: string;
  name: string;
  service: string;
  area: string;
};

function buildProviderFixture(): ProviderFixture {
  const seed = makeSeed();
  const suffix = seed.slice(-6);
  return {
    providerId: `ZZ-PERF-${suffix}`,
    phone: makePhone(PROVIDER_PHONE_PREFIX, seed),
    name: `ZZ Perf Provider ${suffix}`,
    service: `ZZ Perf Service ${suffix}`,
    area: `ZZ Perf Area ${suffix}`,
  };
}

async function insertProviderFixture(
  client: ReturnType<typeof createAdminSupabaseClient>,
  fixture: ProviderFixture
): Promise<void> {
  const ins1 = await client.from("providers").insert({
    provider_id: fixture.providerId,
    full_name: fixture.name,
    phone: fixture.phone,
    status: "active",
    verified: "yes",
  });
  if (ins1.error) throw new Error(`providers insert: ${ins1.error.message}`);

  const ins2 = await client.from("provider_services").insert({
    provider_id: fixture.providerId,
    category: fixture.service,
  });
  if (ins2.error) throw new Error(`provider_services insert: ${ins2.error.message}`);

  const ins3 = await client.from("provider_areas").insert({
    provider_id: fixture.providerId,
    area: fixture.area,
  });
  if (ins3.error) throw new Error(`provider_areas insert: ${ins3.error.message}`);
}

async function cleanupProviderFixture(
  client: ReturnType<typeof createAdminSupabaseClient>,
  fixture: ProviderFixture
): Promise<void> {
  await client.from("provider_task_matches").delete().eq("provider_id", fixture.providerId);
  await client.from("provider_services").delete().eq("provider_id", fixture.providerId);
  await client.from("provider_areas").delete().eq("provider_id", fixture.providerId);
  await client.from("providers").delete().eq("provider_id", fixture.providerId);
}

async function applySession(page: Page, session: RouteCase["session"], providerPhone: string): Promise<void> {
  await page.context().clearCookies();
  try {
    await page.evaluate(() => {
      try {
        window.localStorage.removeItem("kk_admin_session");
        window.localStorage.removeItem("kk_provider_profile");
      } catch {}
    });
  } catch {
    // Evaluate fails if no page has been navigated yet — harmless.
  }

  // bootstrapAdminSession uses page.addInitScript, which persists across
  // navigations. For non-admin sessions we register a counter-script that
  // runs on every new navigation and removes kk_admin_session. Since init
  // scripts run in registration order, this neutralizes the admin script
  // registered earlier in the sweep.
  if (session !== "admin") {
    await page.addInitScript(() => {
      try {
        window.localStorage.removeItem("kk_admin_session");
      } catch {}
    });
  }

  if (!session || session === "none") return;
  if (session === "provider") {
    await bootstrapProviderSession(page, providerPhone);
    return;
  }
  if (session === "admin") {
    await bootstrapAdminSession(page);
    return;
  }
  await bootstrapUserSession(page);
}

function shouldPass(value: number | null, threshold: number): boolean {
  if (value === null) return true;
  return value <= threshold;
}

function classify(m: Measurement): "PASS" | "WARN" | "FAIL" {
  if (m.notes.some((n) => n.startsWith("crash") || n.startsWith("missing-required-ui"))) return "FAIL";
  const pageOk = shouldPass(m.readyMs, PAGE_LOAD_THRESHOLD_MS);
  const apiOk = shouldPass(m.apiMs, API_THRESHOLD_MS);
  if (pageOk && apiOk) return "PASS";
  return "WARN";
}

function formatMs(value: number | null): string {
  if (value === null) return "—";
  return `${value}ms`;
}

async function runRouteCase(
  page: Page,
  routeCase: RouteCase,
  providerPhone: string
): Promise<Measurement> {
  const notes: string[] = [];
  const appsScriptHits: string[] = [];
  const httpErrors: Array<{ url: string; status: number }> = [];
  const reqStart = new Map<string, number>();

  // Track Apps Script calls and non-2xx app/API responses for diagnostics.
  const onRequest = (req: import("@playwright/test").Request) => {
    const url = req.url();
    if (routeCase.apiUrlMatcher && routeCase.apiUrlMatcher(url)) {
      reqStart.set(url, Date.now());
    }
    if (/script\.google\.com|googleusercontent\.com\/macros/i.test(url)) {
      appsScriptHits.push(url);
    }
  };
  const onResponse = (res: import("@playwright/test").Response) => {
    const url = res.url();
    const status = res.status();
    if (status >= 400 && url.startsWith("http")) {
      // Drop noisy third-party favicon/font fetches.
      if (/\.(woff2?|ico|png|svg|map)(\?|$)/i.test(url)) return;
      httpErrors.push({ url, status });
    }
  };
  page.on("request", onRequest);
  page.on("response", onResponse);

  // Apply any per-case route stubs.
  if (routeCase.stubs?.length) {
    for (const stub of routeCase.stubs) {
      await page.route(stub.pattern, (route) =>
        route.fulfill({
          status: stub.status ?? 200,
          contentType: stub.contentType ?? "application/json",
          body: stub.body,
        })
      );
    }
  }

  await applySession(page, routeCase.session, providerPhone);

  let pageLoadMs: number | null = null;
  let apiMs: number | null = null;
  let readyMs: number | null = null;

  const apiResponsePromise = routeCase.apiUrlMatcher
    ? page
        .waitForResponse((r) => routeCase.apiUrlMatcher!(r.url()), { timeout: 15_000 })
        .catch(() => null)
    : Promise.resolve(null);

  const navStart = Date.now();
  try {
    await page.goto(routeCase.path, { waitUntil: "domcontentloaded", timeout: 20_000 });
    pageLoadMs = Date.now() - navStart;
  } catch (err) {
    notes.push(`crash-on-goto: ${err instanceof Error ? err.message : String(err)}`);
    page.off("request", onRequest);
    page.off("response", onResponse);
    return {
      id: routeCase.id,
      label: routeCase.label,
      path: routeCase.path,
      pageLoadMs,
      apiMs,
      apiLabel: routeCase.apiLabel ?? null,
      readyMs,
      status: "FAIL",
      notes,
      appsScriptHits,
      httpErrors,
    };
  }

  // Wait for whichever ready signal appears first.
  const readyStart = navStart;
  const timeout = routeCase.readyTimeoutMs ?? 10_000;
  const signalPromises = routeCase.readySignals.map(async (sig) => {
    if (sig.kind === "selector") {
      await page.locator(sig.selector).first().waitFor({ state: "visible", timeout });
      return sig;
    }
    if (sig.kind === "role-heading") {
      await page
        .getByRole("heading", { name: sig.name, exact: sig.exact })
        .first()
        .waitFor({ state: "visible", timeout });
      return sig;
    }
    await page.getByText(sig.text, { exact: sig.exact }).first().waitFor({ state: "visible", timeout });
    return sig;
  });

  try {
    await Promise.any(signalPromises);
    readyMs = Date.now() - readyStart;
  } catch {
    notes.push("missing-required-ui");
  }

  // Resolve API timing if we captured a request/response.
  const apiResponse = await apiResponsePromise;
  if (apiResponse) {
    const start = reqStart.get(apiResponse.url());
    if (start) {
      apiMs = Date.now() - start;
    } else {
      // Fallback: use response.timing() if our request listener missed the
      // event (e.g., already in-flight before we attached).
      try {
        const timing = apiResponse.request().timing();
        const latency = Math.max(0, Math.round(timing.responseEnd - timing.startTime));
        if (Number.isFinite(latency) && latency > 0) apiMs = latency;
      } catch {
        // ignore
      }
    }
  } else if (routeCase.apiUrlMatcher) {
    notes.push("api-not-observed");
  }

  page.off("request", onRequest);
  page.off("response", onResponse);

  const measurement: Measurement = {
    id: routeCase.id,
    label: routeCase.label,
    path: routeCase.path,
    pageLoadMs,
    apiMs,
    apiLabel: routeCase.apiLabel ?? null,
    readyMs,
    status: "PASS",
    notes,
    appsScriptHits,
    httpErrors,
  };
  measurement.status = classify(measurement);
  return measurement;
}

function dashboardProfileMatcher(url: string): boolean {
  return url.includes("/api/provider/dashboard-profile");
}

function buildRouteCases(providerPhone: string): RouteCase[] {
  void providerPhone;
  const fakeThreadId = "ZZ-PERF-THREAD-0001";
  return [
    {
      id: "home",
      label: "Home page",
      path: "/",
      session: "none",
      readySignals: [{ kind: "selector", selector: 'input[type="text"]' }],
    },
    {
      id: "user-my-requests",
      label: "User My Requests",
      path: "/dashboard/my-requests",
      session: "user",
      readySignals: [
        { kind: "role-heading", name: "My Requests", exact: true },
        { kind: "text", text: "Loading", exact: false },
      ],
    },
    {
      id: "user-my-needs",
      label: "User My Needs",
      path: "/i-need/my-needs",
      session: "user",
      readySignals: [
        { kind: "role-heading", name: "My Needs", exact: true },
        { kind: "text", text: "Loading your needs...", exact: true },
      ],
    },
    {
      id: "provider-dashboard",
      label: "Provider Dashboard",
      path: "/provider/dashboard",
      session: "provider",
      apiUrlMatcher: dashboardProfileMatcher,
      apiLabel: "GET /api/provider/dashboard-profile",
      readySignals: [
        { kind: "text", text: "Provider Intelligence Dashboard", exact: true },
        { kind: "text", text: "Requests In Your Services", exact: true },
      ],
    },
    {
      id: "provider-my-jobs",
      label: "Provider My Jobs",
      path: "/provider/my-jobs",
      session: "provider",
      apiUrlMatcher: dashboardProfileMatcher,
      apiLabel: "GET /api/provider/dashboard-profile",
      readySignals: [
        { kind: "role-heading", name: "My Jobs", exact: true },
        {
          kind: "text",
          text:
            "No matched jobs yet. When customers request your services in your areas, jobs will appear here.",
          exact: true,
        },
      ],
    },
    {
      id: "provider-job-requests",
      label: "Provider Job Requests",
      path: "/provider/job-requests",
      session: "provider",
      apiUrlMatcher: dashboardProfileMatcher,
      apiLabel: "GET /api/provider/dashboard-profile",
      readySignals: [
        { kind: "role-heading", name: "Job Requests", exact: true },
        {
          kind: "text",
          text:
            "No matched requests yet. As demand rises in your services and areas, leads will show up here.",
          exact: true,
        },
      ],
    },
    {
      id: "admin-dashboard",
      label: "Admin Dashboard",
      path: "/admin/dashboard",
      session: "admin",
      readySignals: [
        { kind: "role-heading", name: "Control Center", exact: true },
        { kind: "text", text: "Admin Control Center", exact: false },
      ],
      readyTimeoutMs: 15_000,
    },
    {
      id: "login",
      label: "Login / OTP page",
      path: "/login",
      session: "none",
      readySignals: [
        { kind: "role-heading", name: "Verify your phone", exact: true },
        { kind: "selector", selector: 'input[type="tel"], input[inputmode="numeric"]' },
      ],
    },
    {
      id: "post-task",
      label: "Task submission form",
      path: "/post-task",
      session: "user",
      readySignals: [
        { kind: "role-heading", name: "Post a Task", exact: false },
        { kind: "text", text: "Post a Task", exact: false },
      ],
    },
    {
      id: "chat-thread",
      label: "Chat thread page",
      // The chat page defaults actorType to "provider"; pass ?actor=user so
      // the user session we bootstrapped is accepted (otherwise the page
      // redirects to /provider/login).
      path: `/chat/thread/${fakeThreadId}?actor=user`,
      session: "user",
      apiUrlMatcher: (url) => url.includes("/api/kk"),
      apiLabel: "POST /api/kk (chat)",
      readySignals: [
        { kind: "selector", selector: 'textarea, input[type="text"]' },
        { kind: "text", text: "Thread", exact: false },
      ],
      stubs: [
        {
          pattern: "**/api/kk",
          body: JSON.stringify({
            ok: true,
            messages: [],
            thread: { ThreadID: fakeThreadId },
            threads: [],
          }),
        },
      ],
    },
  ];
}

function renderTable(rows: Measurement[]): string {
  const header = ["FUNCTION", "ROUTE", "PAGE LOAD", "API", "READY", "STATUS"];
  const lines = rows.map((r) => [
    r.label,
    r.path,
    formatMs(r.pageLoadMs),
    r.apiMs !== null ? `${r.apiMs}ms (${r.apiLabel || "api"})` : r.apiLabel ? `— (${r.apiLabel})` : "—",
    formatMs(r.readyMs),
    r.status,
  ]);
  const widths = header.map((h, i) =>
    Math.max(h.length, ...lines.map((row) => row[i].length))
  );
  const fmtRow = (row: string[]) => row.map((cell, i) => cell.padEnd(widths[i])).join(" | ");
  const sep = widths.map((w) => "-".repeat(w)).join("-+-");
  return [fmtRow(header), sep, ...lines.map(fmtRow)].join("\n");
}

test.describe.configure({ mode: "serial" });

test("site response-time sweep", async ({ page }, testInfo) => {
  testInfo.setTimeout(300_000);
  const client = createAdminSupabaseClient();
  const providerFixture = buildProviderFixture();
  const measurements: Measurement[] = [];
  let primaryError: unknown = null;

  try {
    await insertProviderFixture(client, providerFixture);

    const routeCases = buildRouteCases(providerFixture.phone);
    for (const routeCase of routeCases) {
      const m = await runRouteCase(page, routeCase, providerFixture.phone);
      measurements.push(m);
      console.log(
        `[site-response-times] ${m.id} status=${m.status} pageLoad=${formatMs(
          m.pageLoadMs
        )} api=${formatMs(m.apiMs)} ready=${formatMs(m.readyMs)} notes=${JSON.stringify(
          m.notes
        )} appsScriptHits=${m.appsScriptHits.length}`
      );
    }

    const table = renderTable(measurements);
    console.log("\n==== SITE RESPONSE-TIME REPORT ====\n" + table + "\n====================================\n");

    const slowest = [...measurements]
      .filter((m) => m.readyMs !== null)
      .sort((a, b) => (b.readyMs ?? 0) - (a.readyMs ?? 0))[0];
    if (slowest) {
      console.log(
        `[site-response-times] slowest route: ${slowest.label} (${slowest.path}) — readyMs=${slowest.readyMs}`
      );
    }

    const crashed = measurements.filter((m) => m.status === "FAIL");
    const appsScriptRoutes = measurements.filter((m) => m.appsScriptHits.length > 0);

    // Persist JSON report for diagnostics / CI artifact.
    const outDir = path.resolve(__dirname, "../test-results");
    try {
      fs.mkdirSync(outDir, { recursive: true });
    } catch {}
    const outPath = path.resolve(outDir, "site-response-times.json");
    const report = {
      generatedAt: new Date().toISOString(),
      thresholds: { pageReadyMs: PAGE_LOAD_THRESHOLD_MS, apiMs: API_THRESHOLD_MS },
      measurements,
      summary: {
        slowestRoute: slowest
          ? { id: slowest.id, label: slowest.label, path: slowest.path, readyMs: slowest.readyMs }
          : null,
        crashedOrMissingUi: crashed.map((m) => ({
          id: m.id,
          label: m.label,
          path: m.path,
          notes: m.notes,
        })),
        appsScriptRoutes: appsScriptRoutes.map((m) => ({
          id: m.id,
          label: m.label,
          path: m.path,
          hits: m.appsScriptHits,
        })),
      },
    };
    fs.writeFileSync(outPath, JSON.stringify(report, null, 2), "utf8");
    console.log(`[site-response-times] JSON report written: ${outPath}`);
    testInfo.annotations.push({ type: "site-response-times", description: outPath });

    // Hard-fail only on actual crashes or required-UI misses, per the brief.
    expect(
      crashed,
      `Routes that crashed or missed required UI: ${crashed
        .map((m) => `${m.id}(${m.notes.join(",")})`)
        .join(" | ")}`
    ).toHaveLength(0);
  } catch (err) {
    primaryError = err;
    throw err;
  } finally {
    try {
      await cleanupProviderFixture(client, providerFixture);
    } catch (cleanupErr) {
      if (!primaryError) throw cleanupErr;
      console.error("[site-response-times] cleanup failed", cleanupErr);
    }
  }
});
