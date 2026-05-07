/**
 * /respond/<taskId>/<providerId> review-flow tests.
 *
 * Simulates the WhatsApp `provider_job_alert` button tap by navigating
 * directly to /respond/<TK>/<PR>. Confirms the page is now a confirmation
 * step (no DB writes on mount) and that the two action buttons drive the
 * downstream behaviour the audit + implementation specified.
 *
 * Real DB. Real /api/kk + /api/tasks/respond. No production code touched.
 *
 * Test-data prefix: "ZZ RESPOND TEST -"
 * Task prefix:      "TK-RP-"
 * Provider prefix:  "PR-RP-"
 * Phone prefix:     "8788"
 */

import { createClient } from "@supabase/supabase-js";
import * as fs from "fs";
import * as path from "path";

import { test, expect } from "./_support/test";
import { bootstrapProviderSession } from "./_support/auth";

test.describe.configure({ mode: "serial" });

// ─── Env loading (same shape as chat-notification-logs.spec) ─────────────────
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
    const sep = trimmed.indexOf("=");
    if (sep === -1) continue;
    env[trimmed.slice(0, sep).trim()] = trimmed
      .slice(sep + 1)
      .trim()
      .replace(/^["']|["']$/g, "");
  }
  cachedEnvLocal = env;
  return cachedEnvLocal;
}
function getEnv(name: string): string {
  return process.env[name] || loadEnvLocal()[name] || "";
}
function makeAdminClient() {
  const url = getEnv("SUPABASE_URL") || getEnv("NEXT_PUBLIC_SUPABASE_URL");
  const key = getEnv("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }
  return createClient(url, key, { auth: { persistSession: false } });
}

// ─── Test conventions ────────────────────────────────────────────────────────
const RUN_ID = String(Date.now()).slice(-7);
const PREFIX = "ZZ RESPOND TEST -";
const CATEGORY = "Electrician"; // active in `categories`
const AREA = "Sardarpura"; // active in `areas`

// One task + matched provider per test scenario so writes from one test
// can't leak into another. Test 1 (no-write) + Test 2 (Respond click) share
// a pair because Test 2 is the first thing that mutates it.
const TASK_NO_WRITE = `TK-RP-NW-${RUN_ID}`;
const PROVIDER_NO_WRITE = `PR-RP-NW-${RUN_ID}`;
const PHONE_NO_WRITE = "8788000001";

const TASK_RESPOND = TASK_NO_WRITE; // shared with Test 1; mutates here
const PROVIDER_RESPOND = PROVIDER_NO_WRITE;
const PHONE_RESPOND = PHONE_NO_WRITE;

const TASK_IGNORE = `TK-RP-IG-${RUN_ID}`;
const PROVIDER_IGNORE = `PR-RP-IG-${RUN_ID}`;
const PHONE_IGNORE = "8788000002";

const TASK_MISMATCH = `TK-RP-MM-${RUN_ID}`;
const PROVIDER_MISMATCH_RIGHT = `PR-RP-MM-RIGHT-${RUN_ID}`;
const PROVIDER_MISMATCH_WRONG = `PR-RP-MM-WRONG-${RUN_ID}`;
const PHONE_MISMATCH_RIGHT = "8788000003";
const PHONE_MISMATCH_WRONG = "8788000004";

const TASK_LOGGED_OUT = `TK-RP-LO-${RUN_ID}`;
const PROVIDER_LOGGED_OUT = `PR-RP-LO-${RUN_ID}`;
const PHONE_LOGGED_OUT = "8788000005";

const USER_PHONE = "8788000099"; // Customer phone — same for all tasks.

const ALL_TASK_IDS = [
  TASK_NO_WRITE,
  TASK_IGNORE,
  TASK_MISMATCH,
  TASK_LOGGED_OUT,
];
const ALL_PROVIDER_IDS = [
  PROVIDER_NO_WRITE,
  PROVIDER_IGNORE,
  PROVIDER_MISMATCH_RIGHT,
  PROVIDER_MISMATCH_WRONG,
  PROVIDER_LOGGED_OUT,
];
const ALL_PHONES = [
  PHONE_NO_WRITE,
  PHONE_IGNORE,
  PHONE_MISMATCH_RIGHT,
  PHONE_MISMATCH_WRONG,
  PHONE_LOGGED_OUT,
  USER_PHONE,
];

// ─── Cleanup ─────────────────────────────────────────────────────────────────
async function deleteAllZzData(): Promise<void> {
  const c = makeAdminClient();
  // chat_messages → chat_threads (FK order)
  await c.from("chat_messages").delete().in("task_id", ALL_TASK_IDS);
  await c.from("chat_threads").delete().in("task_id", ALL_TASK_IDS);
  // notification_logs (no FK; just by task)
  await c.from("notification_logs").delete().in("task_id", ALL_TASK_IDS);
  // provider_notifications — by phone-resolved provider_id; cleaned via the
  // ALL_PROVIDER_IDS list since payload_json doesn't have a FK
  await c.from("provider_notifications").delete().in("provider_id", ALL_PROVIDER_IDS);
  // provider_task_matches → providers, provider_areas, provider_services, tasks
  await c.from("provider_task_matches").delete().in("task_id", ALL_TASK_IDS);
  await c.from("tasks").delete().in("task_id", ALL_TASK_IDS);
  await c.from("provider_areas").delete().in("provider_id", ALL_PROVIDER_IDS);
  await c.from("provider_services").delete().in("provider_id", ALL_PROVIDER_IDS);
  await c.from("providers").delete().in("provider_id", ALL_PROVIDER_IDS);
  // Belt-and-braces by phone
  await c.from("tasks").delete().in("phone", ALL_PHONES);
  await c.from("providers").delete().in("phone", ALL_PHONES);
}

async function seedTask(taskId: string): Promise<void> {
  const c = makeAdminClient();
  await c.from("tasks").insert({
    task_id: taskId,
    category: CATEGORY,
    area: AREA,
    details: `${PREFIX}details ${taskId}`,
    phone: USER_PHONE,
    selected_timeframe: "Today",
    status: "submitted",
  });
}

async function seedProvider(providerId: string, phone: string): Promise<void> {
  const c = makeAdminClient();
  await c.from("providers").insert({
    provider_id: providerId,
    full_name: `${PREFIX}provider ${providerId}`,
    phone,
    status: "active",
    verified: "yes",
  });
  await c
    .from("provider_services")
    .insert({ provider_id: providerId, category: CATEGORY });
  await c.from("provider_areas").insert({ provider_id: providerId, area: AREA });
}

async function seedMatchedMatch(
  taskId: string,
  providerId: string,
  matchStatus: "matched" | "responded" = "matched"
): Promise<void> {
  const c = makeAdminClient();
  await c.from("provider_task_matches").insert({
    task_id: taskId,
    provider_id: providerId,
    category: CATEGORY,
    area: AREA,
    match_status: matchStatus,
    notified: true,
  });
}

async function getMatchStatus(
  taskId: string,
  providerId: string
): Promise<string | null> {
  const c = makeAdminClient();
  const { data } = await c
    .from("provider_task_matches")
    .select("match_status")
    .eq("task_id", taskId)
    .eq("provider_id", providerId)
    .maybeSingle();
  return data ? String(data.match_status || "") : null;
}

async function getThreadForPair(
  taskId: string,
  providerId: string
): Promise<{ thread_id: string } | null> {
  const c = makeAdminClient();
  const { data } = await c
    .from("chat_threads")
    .select("thread_id")
    .eq("task_id", taskId)
    .eq("provider_id", providerId)
    .maybeSingle();
  return data as { thread_id: string } | null;
}

// ─── Test suite ──────────────────────────────────────────────────────────────
test.describe("/respond/<taskId>/<providerId> review flow", () => {
  test.beforeAll(async () => {
    const probe = await fetch("http://127.0.0.1:3000/").catch(() => null);
    if (!probe || !probe.ok) {
      throw new Error("Dev server not reachable at :3000");
    }
    await deleteAllZzData();

    // Seed every scenario's data up front. Tests that mutate run against
    // their own (task, provider) so cross-test interference is impossible.
    await seedProvider(PROVIDER_NO_WRITE, PHONE_NO_WRITE);
    await seedTask(TASK_NO_WRITE);
    await seedMatchedMatch(TASK_NO_WRITE, PROVIDER_NO_WRITE, "matched");

    await seedProvider(PROVIDER_IGNORE, PHONE_IGNORE);
    await seedTask(TASK_IGNORE);
    await seedMatchedMatch(TASK_IGNORE, PROVIDER_IGNORE, "matched");

    await seedProvider(PROVIDER_MISMATCH_RIGHT, PHONE_MISMATCH_RIGHT);
    await seedProvider(PROVIDER_MISMATCH_WRONG, PHONE_MISMATCH_WRONG);
    await seedTask(TASK_MISMATCH);
    await seedMatchedMatch(TASK_MISMATCH, PROVIDER_MISMATCH_RIGHT, "matched");

    await seedProvider(PROVIDER_LOGGED_OUT, PHONE_LOGGED_OUT);
    await seedTask(TASK_LOGGED_OUT);
    await seedMatchedMatch(TASK_LOGGED_OUT, PROVIDER_LOGGED_OUT, "matched");
  });

  test.afterAll(async () => {
    await deleteAllZzData();
  });

  // ───────────────────────────────────────────────────────────────────────────
  // TEST 1 — mount-only, no DB writes
  // ───────────────────────────────────────────────────────────────────────────
  test("matched provider opens link → summary + buttons render, no DB writes", async ({
    page,
  }) => {
    await bootstrapProviderSession(page, PHONE_NO_WRITE);

    // Snapshot pre-mount state.
    const matchBefore = await getMatchStatus(TASK_NO_WRITE, PROVIDER_NO_WRITE);
    const threadBefore = await getThreadForPair(TASK_NO_WRITE, PROVIDER_NO_WRITE);
    expect(matchBefore).toBe("matched");
    expect(threadBefore).toBeNull();

    await page.goto(`/respond/${TASK_NO_WRITE}/${PROVIDER_NO_WRITE}`);

    // Summary card visible.
    await expect(page.getByText("Task Summary", { exact: true })).toBeVisible();
    await expect(
      page.getByRole("heading", { name: CATEGORY, exact: true })
    ).toBeVisible();
    await expect(page.getByText(AREA, { exact: true })).toBeVisible();

    // Both action buttons present and enabled.
    const respondBtn = page.getByRole("button", {
      name: /Respond \/ Chat with customer/i,
    });
    const ignoreBtn = page.getByRole("button", { name: /Not interested/i });
    await expect(respondBtn).toBeVisible();
    await expect(respondBtn).toBeEnabled();
    await expect(ignoreBtn).toBeVisible();
    await expect(ignoreBtn).toBeEnabled();

    // Allow any straggling fetches to settle, then re-assert no DB writes.
    await page.waitForLoadState("networkidle");
    expect(await getMatchStatus(TASK_NO_WRITE, PROVIDER_NO_WRITE)).toBe("matched");
    expect(await getThreadForPair(TASK_NO_WRITE, PROVIDER_NO_WRITE)).toBeNull();
  });

  // ───────────────────────────────────────────────────────────────────────────
  // TEST 2 — Respond / Chat → records response, creates thread, redirects
  // ───────────────────────────────────────────────────────────────────────────
  test("clicking Respond / Chat → /api/tasks/respond fires, thread created, redirects to /chat/thread", async ({
    page,
  }) => {
    await bootstrapProviderSession(page, PHONE_RESPOND);

    // Verify we're starting from the post-Test-1 unmutated baseline.
    expect(await getMatchStatus(TASK_RESPOND, PROVIDER_RESPOND)).toBe("matched");
    expect(await getThreadForPair(TASK_RESPOND, PROVIDER_RESPOND)).toBeNull();

    await page.goto(`/respond/${TASK_RESPOND}/${PROVIDER_RESPOND}`);

    // Watch /api/tasks/respond fire on the Respond click — proves the call
    // is gated to the user gesture, not the page mount.
    const respondCall = page.waitForRequest(
      (req) =>
        req.url().includes("/api/tasks/respond") && req.method() === "POST"
    );

    await page
      .getByRole("button", { name: /Respond \/ Chat with customer/i })
      .click();

    const respondReq = await respondCall;
    expect(respondReq.method()).toBe("POST");
    const respondBody = JSON.parse(respondReq.postData() || "{}") as {
      taskId?: string;
      providerId?: string;
    };
    expect(respondBody.taskId).toBe(TASK_RESPOND);
    expect(respondBody.providerId).toBe(PROVIDER_RESPOND);

    // Lands on the chat thread page.
    await page.waitForURL(/\/chat\/thread\//, { timeout: 15_000 });

    // DB confirms the side effects.
    expect(await getMatchStatus(TASK_RESPOND, PROVIDER_RESPOND)).toBe("responded");
    const thread = await getThreadForPair(TASK_RESPOND, PROVIDER_RESPOND);
    expect(thread).not.toBeNull();
    expect(thread?.thread_id).toMatch(/^TH-/);

    // The URL ends with the same thread id.
    expect(page.url()).toContain(`/chat/thread/${thread?.thread_id}`);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // TEST 3 — Not interested → no mutation, navigates to /provider/my-jobs
  // ───────────────────────────────────────────────────────────────────────────
  test("clicking Not interested → navigates to /provider/my-jobs, match unchanged, no thread", async ({
    page,
  }) => {
    await bootstrapProviderSession(page, PHONE_IGNORE);

    expect(await getMatchStatus(TASK_IGNORE, PROVIDER_IGNORE)).toBe("matched");
    expect(await getThreadForPair(TASK_IGNORE, PROVIDER_IGNORE)).toBeNull();

    await page.goto(`/respond/${TASK_IGNORE}/${PROVIDER_IGNORE}`);
    await expect(
      page.getByRole("button", { name: /Not interested/i })
    ).toBeEnabled();

    // Ignore should NOT fire /api/tasks/respond at any point.
    let respondFired = false;
    page.on("request", (req) => {
      if (req.url().includes("/api/tasks/respond")) respondFired = true;
    });

    await page.getByRole("button", { name: /Not interested/i }).click();
    await page.waitForURL(/\/provider\/my-jobs(?:$|\?|#|\/)/, {
      timeout: 15_000,
    });

    expect(respondFired).toBe(false);
    expect(await getMatchStatus(TASK_IGNORE, PROVIDER_IGNORE)).toBe("matched");
    expect(await getThreadForPair(TASK_IGNORE, PROVIDER_IGNORE)).toBeNull();
  });

  // ───────────────────────────────────────────────────────────────────────────
  // TEST 4 — Wrong provider → mismatch card, no mutation
  // ───────────────────────────────────────────────────────────────────────────
  test("wrong provider opens link → mismatch card, zero mutations", async ({
    page,
  }) => {
    // Logged in as the WRONG provider; URL points at the matched provider.
    await bootstrapProviderSession(page, PHONE_MISMATCH_WRONG);

    expect(await getMatchStatus(TASK_MISMATCH, PROVIDER_MISMATCH_RIGHT)).toBe(
      "matched"
    );
    expect(
      await getMatchStatus(TASK_MISMATCH, PROVIDER_MISMATCH_WRONG)
    ).toBeNull();
    expect(
      await getThreadForPair(TASK_MISMATCH, PROVIDER_MISMATCH_RIGHT)
    ).toBeNull();
    expect(
      await getThreadForPair(TASK_MISMATCH, PROVIDER_MISMATCH_WRONG)
    ).toBeNull();

    let respondFired = false;
    page.on("request", (req) => {
      if (req.url().includes("/api/tasks/respond")) respondFired = true;
    });

    await page.goto(
      `/respond/${TASK_MISMATCH}/${PROVIDER_MISMATCH_RIGHT}`
    );

    await expect(
      page.getByRole("heading", {
        name: /This job is for a different account/i,
      })
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /Respond \/ Chat with customer/i })
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: /Not interested/i })
    ).toHaveCount(0);

    await page.waitForLoadState("networkidle");
    expect(respondFired).toBe(false);
    // Neither provider's match row mutated; no thread for either.
    expect(await getMatchStatus(TASK_MISMATCH, PROVIDER_MISMATCH_RIGHT)).toBe(
      "matched"
    );
    expect(
      await getMatchStatus(TASK_MISMATCH, PROVIDER_MISMATCH_WRONG)
    ).toBeNull();
    expect(
      await getThreadForPair(TASK_MISMATCH, PROVIDER_MISMATCH_RIGHT)
    ).toBeNull();
    expect(
      await getThreadForPair(TASK_MISMATCH, PROVIDER_MISMATCH_WRONG)
    ).toBeNull();
  });

  // ───────────────────────────────────────────────────────────────────────────
  // TEST 5 — Logged-out → /login?next=/respond/...
  // ───────────────────────────────────────────────────────────────────────────
  test("logged-out provider opens link → redirect to /login?next=/respond/<task>/<provider>", async ({
    page,
  }) => {
    // No bootstrap call — context starts with no kk_auth_session cookie.
    await page.context().clearCookies();

    let respondFired = false;
    page.on("request", (req) => {
      if (req.url().includes("/api/tasks/respond")) respondFired = true;
    });

    await page.goto(
      `/respond/${TASK_LOGGED_OUT}/${PROVIDER_LOGGED_OUT}`
    );

    await page.waitForURL(/\/login\?next=/, { timeout: 15_000 });

    const url = new URL(page.url());
    expect(url.pathname).toBe("/login");
    const nextParam = url.searchParams.get("next") || "";
    expect(nextParam).toBe(
      `/respond/${TASK_LOGGED_OUT}/${PROVIDER_LOGGED_OUT}`
    );

    expect(respondFired).toBe(false);
    expect(
      await getMatchStatus(TASK_LOGGED_OUT, PROVIDER_LOGGED_OUT)
    ).toBe("matched");
    expect(
      await getThreadForPair(TASK_LOGGED_OUT, PROVIDER_LOGGED_OUT)
    ).toBeNull();
  });
});
