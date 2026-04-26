import { mkdir } from "node:fs/promises";

import { createClient } from "@supabase/supabase-js";
import { config as loadEnv } from "dotenv";
import type { Page, Request } from "@playwright/test";

import { bootstrapProviderSession } from "./_support/auth";
import { QA_AREA, QA_CATEGORY } from "./_support/data";
import { expect, test } from "./_support/test";

const DEBUG_DIR = "test-results/sidebar-debug";
const USER_WITHOUT_PROVIDER_PHONE = "9888800001";
const SEEDED_PROVIDER_PHONE = "9888800002";
const SEEDED_PROVIDER_ID = "ZZ-SIDEBAR-DEBUG-0001";
const SEEDED_PROVIDER_NAME = "ZZ Sidebar Debug Provider";

loadEnv({ path: ".env.local", quiet: true });

const seedSupabase = createClient(
  process.env.SUPABASE_URL || "",
  process.env.SUPABASE_SERVICE_ROLE_KEY || "",
  { auth: { persistSession: false } }
);

type NetworkLog = {
  method: string;
  url: string;
  status?: number;
  failed?: string;
  elapsedMs?: number;
};

const TRACKED_URL_PARTS = [
  "auth/session",
  "dashboard-profile",
  "profile",
  "verification",
  "/api/kk",
  "/api/provider",
  "/api/admin",
  "/api/areas",
];

function isTrackedRequest(url: string): boolean {
  return TRACKED_URL_PARTS.some((part) => url.includes(part));
}

function compactText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function normalizePhoneToTen(value: string): string {
  return String(value || "").replace(/\D/g, "").slice(-10);
}

function timelineText(timeline: Array<{ label: string; text: string }>, label: string): string {
  return timeline.find((entry) => entry.label === label)?.text || "";
}

function anyTimelineTextIncludes(
  timeline: Array<{ label: string; text: string }>,
  value: string
): boolean {
  return timeline.some((entry) => entry.text.includes(value));
}

function expectCoreLoggedInNav(text: string): void {
  expect(text).toContain("Post a Request");
  expect(text).toContain("My Requests");
  expect(text).toContain("Responses");
  expect(text).toContain("Report an Issue");
  expect(text).toContain("Logout");
}

function expectProviderNav(text: string): void {
  expect(text).toMatch(/Dashboard|Overview/);
  expect(text).toContain("Find Work");
  expect(text).toContain("My Work");
}

async function expandSidebar(page: Page): Promise<void> {
  const expandButton = page.getByRole("button", { name: /expand sidebar/i });
  if (await expandButton.isVisible().catch(() => false)) {
    await expandButton.click();
  }
}

async function logDirectSidebarApis(page: Page, label: string) {
  const result = await page.evaluate(async () => {
    const readCookie = (name: string) => {
      const match = document.cookie
        .split("; ")
        .find((entry) => entry.startsWith(`${name}=`));
      return match ? match.slice(name.length + 1) : "";
    };
    const rawAuthCookie = readCookie("kk_auth_session");
    let authSession: unknown = null;
    try {
      authSession = rawAuthCookie ? JSON.parse(decodeURIComponent(rawAuthCookie)) : null;
    } catch {
      authSession = null;
    }
    const authPhone =
      authSession && typeof authSession === "object" && "phone" in authSession
        ? String((authSession as { phone?: unknown }).phone || "")
        : "";
    const phone10 = authPhone.replace(/\D/g, "").slice(-10);

    const kkResponse = await fetch(
      `/api/kk?action=get_provider_by_phone&phone=${encodeURIComponent(phone10)}`,
      { cache: "no-store" }
    );
    const kkText = await kkResponse.text();

    const dashboardResponse = await fetch("/api/provider/dashboard-profile", {
      cache: "no-store",
    });
    const dashboardText = await dashboardResponse.text();

    const parseJson = (text: string) => {
      try {
        return text ? JSON.parse(text) : null;
      } catch {
        return text;
      }
    };

    return {
      rawAuthCookie,
      authSession,
      authPhone,
      phone10,
      kk: {
        status: kkResponse.status,
        body: parseJson(kkText),
      },
      dashboardProfile: {
        status: dashboardResponse.status,
        body: parseJson(dashboardText),
      },
    };
  });

  console.log(`[sidebar-debug][direct:${label}]`, JSON.stringify(result, null, 2));
  return result;
}

async function sidebarSnapshot(
  page: Page,
  label: string,
  screenshotName: string,
  screenshotDir: string
) {
  const sidebar = page.locator("aside").first();
  const text = compactText((await sidebar.textContent().catch(() => "")) || "");

  console.log(`[sidebar-debug] ${label}: ${text || "<empty>"}`);
  console.log(
    `[sidebar-debug] ${label} storage/cookies:`,
    await page.evaluate(() => ({
      cookies: document.cookie,
      authSession: localStorage.getItem("kk_auth_session"),
      adminSession: localStorage.getItem("kk_admin_session"),
      providerProfile: localStorage.getItem("kk_provider_profile"),
      sessionStorageKeys: Object.keys(sessionStorage),
    }))
  );

  await page.screenshot({
    path: `${screenshotDir}/${screenshotName}`,
    fullPage: true,
  });

  return text;
}

async function seedProvider() {
  await cleanupSeededProvider();

  const { error: providerError } = await seedSupabase.from("providers").insert({
    provider_id: SEEDED_PROVIDER_ID,
    full_name: SEEDED_PROVIDER_NAME,
    phone: SEEDED_PROVIDER_PHONE,
    status: "active",
    verified: "yes",
  });
  if (providerError) throw new Error(`provider seed failed: ${providerError.message}`);

  const { error: servicesError } = await seedSupabase.from("provider_services").insert({
    provider_id: SEEDED_PROVIDER_ID,
    category: QA_CATEGORY,
  });
  if (servicesError) throw new Error(`provider_services seed failed: ${servicesError.message}`);

  const { error: areasError } = await seedSupabase.from("provider_areas").insert({
    provider_id: SEEDED_PROVIDER_ID,
    area: QA_AREA,
  });
  if (areasError) throw new Error(`provider_areas seed failed: ${areasError.message}`);
}

async function cleanupSeededProvider() {
  await seedSupabase.from("provider_services").delete().eq("provider_id", SEEDED_PROVIDER_ID);
  await seedSupabase.from("provider_areas").delete().eq("provider_id", SEEDED_PROVIDER_ID);
  await seedSupabase.from("providers").delete().eq("provider_id", SEEDED_PROVIDER_ID);
}

async function resetBrowserState(page: Page, phone: string) {
  await page.context().clearCookies();
  await page.goto("about:blank");
  await page.addInitScript(() => {
    window.localStorage.removeItem("kk_provider_profile");
    window.localStorage.removeItem("kk_admin_session");
    window.sessionStorage.clear();
  });
  await bootstrapProviderSession(page, phone);
}

async function runSidebarTimeline(
  page: Page,
  scenario: string,
  phone: string
): Promise<Array<{ label: string; text: string }>> {
  const screenshotDir = `${DEBUG_DIR}/${scenario}`;
  await mkdir(screenshotDir, { recursive: true });

  await resetBrowserState(page, phone);
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expandSidebar(page);

  const timeline: Array<{ label: string; text: string }> = [];
  timeline.push({
    label: "initial",
    text: await sidebarSnapshot(page, `${scenario}:initial`, "01-initial.png", screenshotDir),
  });

  await page.waitForTimeout(500);
  timeline.push({
    label: "500ms",
    text: await sidebarSnapshot(page, `${scenario}:500ms`, "02-500ms.png", screenshotDir),
  });

  await page.waitForTimeout(500);
  timeline.push({
    label: "1000ms",
    text: await sidebarSnapshot(page, `${scenario}:1000ms`, "03-1000ms.png", screenshotDir),
  });

  await page.waitForTimeout(1000);
  timeline.push({
    label: "2000ms",
    text: await sidebarSnapshot(page, `${scenario}:2000ms`, "04-2000ms.png", screenshotDir),
  });

  await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch((error) => {
    console.log(`[sidebar-debug][${scenario}] networkidle wait timed out: ${String(error)}`);
  });
  timeline.push({
    label: "network-idle",
    text: await sidebarSnapshot(
      page,
      `${scenario}:network-idle`,
      "05-network-idle.png",
      screenshotDir
    ),
  });

  console.log(`[sidebar-debug][${scenario}] timeline:`, JSON.stringify(timeline, null, 2));
  const directAfterTimeline = await logDirectSidebarApis(page, `${scenario}:after-timeline`);
  console.log(
    `[sidebar-debug][${scenario}] auth phone used in direct endpoint test: ${normalizePhoneToTen(
      String(directAfterTimeline.authPhone || "")
    )}`
  );
  return timeline;
}

test.describe("Sidebar progressive-loading debug", () => {
  test("captures sidebar text, screenshots, and related network calls during load", async ({
    page,
  }) => {
    await mkdir(DEBUG_DIR, { recursive: true });

    const requestStarts = new Map<Request, number>();
    const networkLogs: NetworkLog[] = [];

    page.on("request", (request) => {
      const url = request.url();
      if (!isTrackedRequest(url)) return;
      requestStarts.set(request, Date.now());
      console.log(`[sidebar-debug][request] ${request.method()} ${url}`);
    });

    page.on("requestfinished", async (request) => {
      const url = request.url();
      if (!isTrackedRequest(url)) return;
      const response = await request.response();
      const entry = {
        method: request.method(),
        url,
        status: response?.status(),
        elapsedMs: Date.now() - (requestStarts.get(request) || Date.now()),
      };
      networkLogs.push(entry);
      console.log(
        `[sidebar-debug][response] ${entry.method} ${entry.status ?? "n/a"} ${entry.elapsedMs}ms ${entry.url}`
      );
    });

    page.on("requestfailed", (request) => {
      const url = request.url();
      if (!isTrackedRequest(url)) return;
      const entry = {
        method: request.method(),
        url,
        failed: request.failure()?.errorText || "unknown failure",
        elapsedMs: Date.now() - (requestStarts.get(request) || Date.now()),
      };
      networkLogs.push(entry);
      console.log(
        `[sidebar-debug][failed] ${entry.method} ${entry.failed} ${entry.elapsedMs}ms ${entry.url}`
      );
    });

    let userTimeline: Array<{ label: string; text: string }> = [];
    let providerTimeline: Array<{ label: string; text: string }> = [];

    try {
      userTimeline = await runSidebarTimeline(
        page,
        "user-without-provider",
        USER_WITHOUT_PROVIDER_PHONE
      );

      await seedProvider();
      providerTimeline = await runSidebarTimeline(
        page,
        "seeded-provider",
        SEEDED_PROVIDER_PHONE
      );
    } finally {
      await cleanupSeededProvider();
    }

    console.log("[sidebar-debug] network logs:", JSON.stringify(networkLogs, null, 2));
    console.log("[sidebar-debug] user timeline:", JSON.stringify(userTimeline, null, 2));
    console.log("[sidebar-debug] provider timeline:", JSON.stringify(providerTimeline, null, 2));
    console.log(
      `[sidebar-debug] seeded provider phone: ${SEEDED_PROVIDER_PHONE}, providerId: ${SEEDED_PROVIDER_ID}`
    );
    console.log(
      `[sidebar-debug] seeded provider Phone Verified visible: ${providerTimeline.some((entry) =>
        entry.text.includes("Phone Verified")
      )}`
    );

    const userFinalText = timelineText(userTimeline, "network-idle");
    const providerInitialText = timelineText(providerTimeline, "initial");
    const providerFinalText = timelineText(providerTimeline, "network-idle");

    expectCoreLoggedInNav(userFinalText);
    expect(userFinalText).toContain("Register as Service Provider");

    expect(providerTimeline.every((entry) => !entry.text.includes("Login"))).toBe(true);
    expect(providerInitialText).not.toContain("Login");
    expect(anyTimelineTextIncludes(providerTimeline, "Find Work")).toBe(true);
    expect(anyTimelineTextIncludes(providerTimeline, "My Work")).toBe(true);
    expectCoreLoggedInNav(providerFinalText);
    expectProviderNav(providerFinalText);
    expect(providerFinalText).toContain("Phone Verified");
    expect(providerFinalText).toContain(SEEDED_PROVIDER_NAME);
    expect(providerFinalText.trim().length).toBeGreaterThan(0);

    const sectionHeadersVisible = ["FOR YOUR NEEDS", "FOR PROVIDERS", "HELP"].some((header) =>
      anyTimelineTextIncludes(providerTimeline, header)
    );
    if (sectionHeadersVisible) {
      expect(providerFinalText).toContain("FOR YOUR NEEDS");
      expect(providerFinalText).toContain("FOR PROVIDERS");
      expect(providerFinalText).toContain("HELP");
    }

    console.log(
      [
        "[sidebar-debug] likely conditional inputs from Sidebar.tsx:",
        "- session is read after mount from getAuthSession(); guest nav renders until session state is set.",
        "- provider menu items depend on providerExists becoming true after /api/kk?action=get_provider_by_phone.",
        "- provider name and Phone Verified depend on providerProfile from kk_provider_profile or /api/provider/dashboard-profile.",
        "- admin menu depends on kk_admin_session in localStorage.",
        "- My Needs badge depends on /api/kk get_my_needs and need_chat_get_threads_for_need.",
        "- Sidebar also uses cookies indirectly through getAuthSession and provider dashboard APIs.",
      ].join("\n")
    );
  });
});
