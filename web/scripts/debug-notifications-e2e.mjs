// One-off read/write probe for the provider notification end-to-end test.
// Inserts a clearly-marked dummy provider_notifications row for PR-3131,
// checks notification-related tables across the stack, and reports.
//
// Run twice:
//   node scripts/debug-notifications-e2e.mjs            -> insert + probe
//   node scripts/debug-notifications-e2e.mjs cleanup    -> delete the dummy
//
// All test rows have type='test_notification' so cleanup is unambiguous.

import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in env.");
  process.exit(1);
}
const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const TEST_PROVIDER = "PR-3131";
const TEST_TYPE = "test_notification";

const print = (label, payload) => {
  console.log(`\n── ${label} ──`);
  console.log(JSON.stringify(payload, null, 2));
};

const mode = process.argv[2] === "cleanup" ? "cleanup" : "probe";

(async () => {
  if (mode === "cleanup") {
    const { data, error } = await sb
      .from("provider_notifications")
      .delete()
      .eq("provider_id", TEST_PROVIDER)
      .eq("type", TEST_TYPE)
      .select("id");
    print("CLEANUP — deleted test_notification rows for PR-3131", {
      error: error?.message || null,
      deleted: (data || []).length,
    });
    return;
  }

  // 1. Confirm PR-3131 exists and pull phone for session reference.
  const { data: providerRow, error: provErr } = await sb
    .from("providers")
    .select("provider_id, name, phone")
    .eq("provider_id", TEST_PROVIDER)
    .maybeSingle();
  print("1. providers row for PR-3131", {
    error: provErr?.message || null,
    row: providerRow,
  });

  // 2. Existing notifications for this provider (before inserting test).
  const { data: existing, error: existingErr } = await sb
    .from("provider_notifications")
    .select("id, type, title, seen_at, created_at")
    .eq("provider_id", TEST_PROVIDER)
    .order("created_at", { ascending: false })
    .limit(10);
  print("2. existing provider_notifications for PR-3131 (before)", {
    error: existingErr?.message || null,
    rows: existing || [],
  });

  // 3. Insert a clearly-marked test row.
  const { data: inserted, error: insertErr } = await sb
    .from("provider_notifications")
    .insert({
      provider_id: TEST_PROVIDER,
      type: TEST_TYPE,
      title: "Test provider notification",
      message: "This is a test notification for PR-3131.",
      href: "/provider/dashboard",
      payload_json: { test: true, inserted_at: new Date().toISOString() },
    })
    .select("id, seen_at, created_at")
    .single();
  print("3. INSERT dummy test_notification for PR-3131", {
    error: insertErr?.message || null,
    row: inserted,
  });

  // 4. notification_logs table — does it exist? what does it look like?
  const { data: logSample, error: logErr } = await sb
    .from("notification_logs")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(3);
  print("4. notification_logs table probe", {
    error: logErr?.message || null,
    columns:
      logSample && logSample[0] ? Object.keys(logSample[0]) : [],
    sample: logSample || [],
  });

  // 5. user_notifications / customer_notifications / etc.
  for (const table of [
    "user_notifications",
    "customer_notifications",
    "notifications",
  ]) {
    const { error } = await sb
      .from(table)
      .select("id", { count: "exact", head: true });
    print(`5. probe — does table "${table}" exist?`, {
      ok: !error,
      errorCode: error?.code || null,
      errorMessage: error?.message || null,
    });
  }

  // 6. PR-3131 matches and most recent task.
  const { data: matches, error: matchErr } = await sb
    .from("provider_task_matches")
    .select("task_id, match_status, created_at")
    .eq("provider_id", TEST_PROVIDER)
    .order("created_at", { ascending: false })
    .limit(5);
  print("6. provider_task_matches for PR-3131 (most recent 5)", {
    error: matchErr?.message || null,
    rows: matches || [],
  });

  if (matches && matches.length > 0) {
    const taskId = matches[0].task_id;
    const { data: task } = await sb
      .from("tasks")
      .select(
        "task_id, category, area, status, user_phone, customer_phone, created_at"
      )
      .eq("task_id", taskId)
      .maybeSingle();
    print("6a. task for most recent match", {
      task_id: taskId,
      task,
    });
  }

  // 7. WhatsApp dispatch artefacts — if notification_logs exists, did
  //    process-task-notifications log anything for PR-3131's recent matches?
  if (matches && matches.length > 0 && !logErr) {
    const taskIds = matches.map((m) => m.task_id);
    const { data: logs, error: rowErr } = await sb
      .from("notification_logs")
      .select("*")
      .in("task_id", taskIds)
      .order("created_at", { ascending: false })
      .limit(20);
    print("7. notification_logs rows for PR-3131's recent task IDs", {
      error: rowErr?.message || null,
      rowCount: (logs || []).length,
      sample: (logs || []).slice(0, 3),
    });
  }
})();
