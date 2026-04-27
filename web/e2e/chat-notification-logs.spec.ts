/**
 * Chat → WhatsApp notification → notification_logs end-to-end pipeline.
 *
 * Validates the user-side "first reply after provider engagement" flow that
 * was unblocked by the chatPersistence.ts gate fix:
 *
 *   1. User sends FIRST chat message after provider has match_status='responded'
 *      → sendProviderUserRepliedNotification fires
 *      → a notification_logs row lands with template_name='provider_user_replied_message'
 *      → status is one of {accepted, failed, error} (Meta delivery is best-effort
 *        for the synthetic test phone, but a row MUST land either way)
 *
 *   2. SECOND user message in the same thread does NOT create a duplicate row.
 *
 *   3. Negative path — when the provider has NOT responded (match_status='matched'
 *      or no match), a user message produces NO notification_logs row.
 *
 * Real DB. Real /api/kk endpoint. Real Meta send (with a synthetic phone — the
 * regex passes, the WA API rejects, status='failed' but a row still lands).
 * No production code modified.
 *
 * Test-data prefix: "ZZ CHAT LOG TEST -"
 * Phone prefix:     "87" (matches existing convention)
 */

import { createClient } from "@supabase/supabase-js";
import * as fs from "fs";
import * as path from "path";

import { test, expect } from "./_support/test";

test.describe.configure({ mode: "serial" });

// ─── Env loading ─────────────────────────────────────────────────────────────
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
const PREFIX = "ZZ CHAT LOG TEST -";
const PHONE_PREFIX = "87";

const USER_PHONE = `${PHONE_PREFIX}55${RUN_ID}`.slice(0, 10);
// Two distinct synthetic provider phones so flows 1 and 3 don't collide on
// providers.phone (UNIQUE on this DB). Both shaped to PASS the local regex
// (/^91[6-9]\d{9}$/) so the Meta send is actually attempted — Meta will
// most likely reject the synthetic number with status='failed', but a row
// STILL lands either way (which is the assertion).
const PROVIDER_PHONE_RESPONDED = "8799000001";
const PROVIDER_PHONE_NEG = "8799000002";

const ZZ_TEST_PHONES = [
  USER_PHONE,
  PROVIDER_PHONE_RESPONDED,
  PROVIDER_PHONE_NEG,
];

// Two separate (task, provider) pairs — one for the happy path (tests 1+2),
// one for the negative path (test 3).
const TASK_RESPONDED = `TK-CL-RES-${RUN_ID}`;
const PROVIDER_RESPONDED = `ZZ-CL-RES-${RUN_ID}`;
const TASK_NEG = `TK-CL-NEG-${RUN_ID}`;
const PROVIDER_NEG = `ZZ-CL-NEG-${RUN_ID}`;

const CATEGORY = "Electrician";   // active in `categories` table
const AREA = "Sardarpura";        // active in `areas` table

// Module state across tests (serial mode is configured above so this is safe).
const seeded = {
  threadResponded: "",
  threadNeg: "",
};

// ─── Cleanup ─────────────────────────────────────────────────────────────────
async function deleteAllZzData(): Promise<void> {
  const c = makeAdminClient();
  await c.from("chat_messages").delete().like("thread_id", "TH-CL-%");
  await c.from("chat_threads").delete().like("thread_id", "TH-CL-%");
  await c.from("notification_logs").delete().in("task_id", [TASK_RESPONDED, TASK_NEG]);
  await c.from("provider_task_matches").delete().in("task_id", [TASK_RESPONDED, TASK_NEG]);
  await c.from("tasks").delete().in("task_id", [TASK_RESPONDED, TASK_NEG]);
  await c
    .from("provider_areas")
    .delete()
    .in("provider_id", [PROVIDER_RESPONDED, PROVIDER_NEG]);
  await c
    .from("provider_services")
    .delete()
    .in("provider_id", [PROVIDER_RESPONDED, PROVIDER_NEG]);
  await c
    .from("providers")
    .delete()
    .in("provider_id", [PROVIDER_RESPONDED, PROVIDER_NEG]);
  // Belt-and-braces by phone (in case the test invented variants).
  await c.from("tasks").delete().in("phone", ZZ_TEST_PHONES);
  await c.from("providers").delete().in("phone", ZZ_TEST_PHONES);
  // Sweep any stragglers prefixed with our body marker.
  await c.from("chat_messages").delete().like("message_text", `${PREFIX}%`);
  await c.from("notification_logs").delete().like("task_id", "TK-CL-%");
}

// ─── Schema preflight ────────────────────────────────────────────────────────
//
// appendNotificationLog (web/lib/notificationLogStore.ts) writes 14 columns
// on every insert. If the live `notification_logs` table is missing any of
// them, the insert silently fails (logged via console.warn inside chat
// pipeline) and our test would observe "row never landed" without knowing
// which column is the culprit. Probe each required column up-front and
// emit a single, actionable failure with a CREATE/ALTER list.
const REQUIRED_LOG_COLUMNS = [
  "log_id",
  "task_id",
  "display_id",
  "provider_id",
  "provider_phone",
  "category",
  "area",
  "service_time",
  "template_name",
  "status",
  "status_code",
  "message_id",
  "error_message",
  "raw_response",
];

async function assertNotificationLogsSchema(): Promise<void> {
  const c = makeAdminClient();
  const missing: string[] = [];
  for (const col of REQUIRED_LOG_COLUMNS) {
    const r = await c.from("notification_logs").select(col).limit(0);
    if (r.error && /column .*does not exist/i.test(r.error.message)) {
      missing.push(col);
    }
  }
  if (missing.length > 0) {
    throw new Error(
      `Schema mismatch: notification_logs is missing ${missing.length} column(s): ${missing.join(", ")}.\n` +
        `Apply the full schema in Supabase SQL editor before running this suite. ` +
        `appendNotificationLog (web/lib/notificationLogStore.ts) writes all of:\n  ${REQUIRED_LOG_COLUMNS.join(", ")}.`
    );
  }
}

// ─── Test suite ──────────────────────────────────────────────────────────────
test.describe("Chat → WhatsApp notification → notification_logs", () => {
  test.beforeAll(async () => {
    const probe = await fetch("http://127.0.0.1:3000/").catch(() => null);
    if (!probe || !probe.ok) {
      throw new Error("Dev server not reachable at :3000");
    }
    await assertNotificationLogsSchema();
    await deleteAllZzData();
  });

  test.afterAll(async () => {
    await deleteAllZzData();
  });

  // ─────────────────────────────────────────────────────────────────────────
  // FLOW 1 — first user message creates exactly one notification_logs row
  // ─────────────────────────────────────────────────────────────────────────
  test("Flow 1 — first user message creates one notification_logs row", async ({
    page,
  }) => {
    const c = makeAdminClient();

    // Seed task + provider + service + area + responded match
    await c.from("tasks").insert({
      task_id: TASK_RESPONDED,
      category: CATEGORY,
      area: AREA,
      details: `${PREFIX}happy path ${RUN_ID}`,
      phone: USER_PHONE,
      status: "submitted",
    });
    await c.from("providers").insert({
      provider_id: PROVIDER_RESPONDED,
      full_name: `${PREFIX}provider ${RUN_ID}`,
      phone: PROVIDER_PHONE_RESPONDED,
      status: "active",
      verified: "yes",
    });
    await c
      .from("provider_services")
      .insert({ provider_id: PROVIDER_RESPONDED, category: CATEGORY });
    await c
      .from("provider_areas")
      .insert({ provider_id: PROVIDER_RESPONDED, area: AREA });
    await c.from("provider_task_matches").insert({
      task_id: TASK_RESPONDED,
      provider_id: PROVIDER_RESPONDED,
      category: CATEGORY,
      area: AREA,
      match_status: "responded",
    });

    // Create the chat thread via the same /api/kk action the UI uses.
    const createRes = await page.request.post("/api/kk", {
      data: {
        action: "chat_create_or_get_thread",
        ActorType: "user",
        TaskID: TASK_RESPONDED,
        ProviderID: PROVIDER_RESPONDED,
        UserPhone: USER_PHONE,
      },
    });
    expect(createRes.status()).toBe(200);
    const createBody = (await createRes.json()) as {
      ok?: boolean;
      thread?: { ThreadID?: string };
    };
    expect(createBody.ok).toBe(true);
    expect(createBody.thread?.ThreadID).toMatch(/^TH-/);
    seeded.threadResponded = String(createBody.thread!.ThreadID);

    // Send the first user message
    const sendRes = await page.request.post("/api/kk", {
      data: {
        action: "chat_send_message",
        ActorType: "user",
        ThreadID: seeded.threadResponded,
        UserPhone: USER_PHONE,
        MessageText: `${PREFIX}first message`,
      },
    });
    expect(sendRes.status()).toBe(200);
    const sendBody = (await sendRes.json()) as { ok?: boolean };
    expect(sendBody.ok).toBe(true);

    // Wait for the side-effect (Meta call + log write).
    await new Promise((r) => setTimeout(r, 5000));

    // Look up the row by task_id (notification_logs has no thread_id column —
    // the spec asked for thread_id but the schema doesn't carry it; task_id
    // uniquely identifies our seeded fixture).
    const log = await c
      .from("notification_logs")
      .select(
        "log_id, template_name, status, status_code, message_id, error_message, provider_phone, task_id, area, category"
      )
      .eq("task_id", TASK_RESPONDED)
      .order("log_id", { ascending: false });

    expect(log.error?.message ?? "").toBe("");
    expect(log.data?.length ?? 0).toBe(1);

    const row = log.data![0];
    expect(row.template_name).toBe("provider_user_replied_message");
    expect(["accepted", "failed", "error"]).toContain(
      String(row.status || "").toLowerCase()
    );

    // If accepted → message_id is set. If failed/error → error_message is set.
    const status = String(row.status || "").toLowerCase();
    if (status === "accepted") {
      expect(String(row.message_id || "").length).toBeGreaterThan(0);
    } else {
      expect(String(row.error_message || "").length).toBeGreaterThan(0);
    }

    // Sanity: provider_phone, area, category copied through
    expect(String(row.provider_phone || "")).toBe(PROVIDER_PHONE_RESPONDED);
    expect(String(row.area || "")).toBe(AREA);
    expect(String(row.category || "")).toBe(CATEGORY);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // FLOW 2 — second user message does NOT add a second log row
  // ─────────────────────────────────────────────────────────────────────────
  test("Flow 2 — second user message in same thread creates no duplicate", async ({
    page,
  }) => {
    expect(seeded.threadResponded, "Flow 1 must run first").toBeTruthy();

    const sendRes = await page.request.post("/api/kk", {
      data: {
        action: "chat_send_message",
        ActorType: "user",
        ThreadID: seeded.threadResponded,
        UserPhone: USER_PHONE,
        MessageText: `${PREFIX}second message`,
      },
    });
    expect(sendRes.status()).toBe(200);
    expect(((await sendRes.json()) as { ok?: boolean }).ok).toBe(true);

    await new Promise((r) => setTimeout(r, 5000));

    const c = makeAdminClient();
    const { count, error } = await c
      .from("notification_logs")
      .select("log_id", { count: "exact", head: true })
      .eq("task_id", TASK_RESPONDED)
      .eq("template_name", "provider_user_replied_message");

    expect(error?.message ?? "").toBe("");
    expect(
      count,
      "exactly 1 notification_logs row expected after the 2nd user message"
    ).toBe(1);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // FLOW 3 — provider has NOT responded → no notification logged
  // ─────────────────────────────────────────────────────────────────────────
  test("Flow 3 — no provider response (match_status='matched') → no notification log", async ({
    page,
  }) => {
    const c = makeAdminClient();

    // Seed task + provider + service + area + match WITHOUT 'responded' status.
    await c.from("tasks").insert({
      task_id: TASK_NEG,
      category: CATEGORY,
      area: AREA,
      details: `${PREFIX}negative ${RUN_ID}`,
      phone: USER_PHONE,
      status: "submitted",
    });
    await c.from("providers").insert({
      provider_id: PROVIDER_NEG,
      full_name: `${PREFIX}provider neg ${RUN_ID}`,
      phone: PROVIDER_PHONE_NEG,
      status: "active",
      verified: "yes",
    });
    await c
      .from("provider_services")
      .insert({ provider_id: PROVIDER_NEG, category: CATEGORY });
    await c
      .from("provider_areas")
      .insert({ provider_id: PROVIDER_NEG, area: AREA });
    // 'matched' (not 'responded') — chat_create_or_get_thread requires SOME
    // match row to exist (route at lib/chat/chatPersistence.ts:1020-1023);
    // 'matched' allows the thread to be created but the user-reply gate
    // should still skip because providerHasResponded === false.
    await c.from("provider_task_matches").insert({
      task_id: TASK_NEG,
      provider_id: PROVIDER_NEG,
      category: CATEGORY,
      area: AREA,
      match_status: "matched",
    });

    const createRes = await page.request.post("/api/kk", {
      data: {
        action: "chat_create_or_get_thread",
        ActorType: "user",
        TaskID: TASK_NEG,
        ProviderID: PROVIDER_NEG,
        UserPhone: USER_PHONE,
      },
    });
    expect(createRes.status()).toBe(200);
    const createBody = (await createRes.json()) as {
      ok?: boolean;
      thread?: { ThreadID?: string };
    };
    expect(createBody.ok).toBe(true);
    seeded.threadNeg = String(createBody.thread!.ThreadID);

    const sendRes = await page.request.post("/api/kk", {
      data: {
        action: "chat_send_message",
        ActorType: "user",
        ThreadID: seeded.threadNeg,
        UserPhone: USER_PHONE,
        MessageText: `${PREFIX}message into non-responded thread`,
      },
    });
    expect(sendRes.status()).toBe(200);
    expect(((await sendRes.json()) as { ok?: boolean }).ok).toBe(true);

    await new Promise((r) => setTimeout(r, 5000));

    const { count, error } = await c
      .from("notification_logs")
      .select("log_id", { count: "exact", head: true })
      .eq("task_id", TASK_NEG);

    expect(error?.message ?? "").toBe("");
    expect(
      count,
      "no notification log should land when provider hasn't responded"
    ).toBe(0);
  });
});
