// Phase 2a verification test. Simulates the new code path against PR-3131's
// existing match (TK-1778147402823 / Plumber / Pratap Nagar) without
// requiring the dev server. Steps mirror what the new
// process-task-notifications insert + dedupe path will do at runtime.
//
//   node scripts/test-job-matched-notification.mjs            -> insert + verify
//   node scripts/test-job-matched-notification.mjs cleanup    -> remove the test
//
// Idempotent: re-running without cleanup just re-runs the dedupe check and
// confirms it skips.

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

const PROVIDER_ID = "PR-3131";
const TASK_ID = "TK-1778147402823";

const print = (label, payload) => {
  console.log(`\n── ${label} ──`);
  console.log(JSON.stringify(payload, null, 2));
};

const mode = process.argv[2] === "cleanup" ? "cleanup" : "verify";

(async () => {
  if (mode === "cleanup") {
    const { data, error } = await sb
      .from("provider_notifications")
      .delete()
      .eq("provider_id", PROVIDER_ID)
      .eq("type", "job_matched")
      .contains("payload_json", { taskId: TASK_ID })
      .select("id");
    print(`CLEANUP — deleted job_matched test rows for ${PROVIDER_ID}/${TASK_ID}`, {
      error: error?.message || null,
      deleted: (data || []).length,
    });
    return;
  }

  // 1. Confirm task + match exist (sanity).
  const { data: task } = await sb
    .from("tasks")
    .select("task_id, category, area, display_id, status")
    .eq("task_id", TASK_ID)
    .maybeSingle();
  print("1. task fixture", task);

  const { data: match } = await sb
    .from("provider_task_matches")
    .select("task_id, provider_id, match_status, created_at")
    .eq("provider_id", PROVIDER_ID)
    .eq("task_id", TASK_ID)
    .maybeSingle();
  print("2. match row fixture", match);

  if (!task || !match) {
    console.error(
      "Required fixture missing. PR-3131 must have a matched task to run this test."
    );
    process.exit(1);
  }

  // 3. Replicate the dedupe pre-check exactly as the new route does it.
  const { data: existing } = await sb
    .from("provider_notifications")
    .select("provider_id, payload_json")
    .eq("type", "job_matched")
    .in("provider_id", [PROVIDER_ID]);
  const alreadyNotified = new Set(
    (existing || [])
      .filter((row) => {
        const payload = row.payload_json;
        return payload?.taskId === TASK_ID;
      })
      .map((row) => String(row.provider_id || ""))
  );
  print("3. dedupe pre-check", {
    existingForType: (existing || []).length,
    alreadyNotifiedForThisTask: alreadyNotified.has(PROVIDER_ID),
  });

  if (alreadyNotified.has(PROVIDER_ID)) {
    print(
      "4. INSERT skipped (dedupe)",
      "Notification for (PR-3131, TK-1778147402823) already exists. Re-run with `cleanup` first if you want to retest insertion."
    );
  } else {
    const { data: inserted, error: insertErr } = await sb
      .from("provider_notifications")
      .insert({
        provider_id: PROVIDER_ID,
        type: "job_matched",
        title: "New job matched",
        message: `New ${task.category} request in ${task.area}.`,
        href: "/provider/my-jobs",
        payload_json: {
          taskId: TASK_ID,
          displayId: task.display_id ?? null,
          category: task.category,
          area: task.area,
        },
      })
      .select("id, type, title, message, href, payload_json, seen_at, created_at")
      .single();
    print("4. INSERT job_matched notification", {
      error: insertErr?.message || null,
      row: inserted,
    });
  }

  // 5. Re-run the dedupe pre-check to confirm a second insert would skip.
  const { data: existing2 } = await sb
    .from("provider_notifications")
    .select("provider_id, payload_json")
    .eq("type", "job_matched")
    .in("provider_id", [PROVIDER_ID]);
  const wouldDedupe = (existing2 || []).some((row) => {
    const payload = row.payload_json;
    return (
      String(row.provider_id || "") === PROVIDER_ID &&
      payload?.taskId === TASK_ID
    );
  });
  print("5. dedupe re-check (simulating retry)", {
    rowsForProvider: (existing2 || []).length,
    secondInsertWouldSkip: wouldDedupe,
  });

  // 6. Show what /api/provider/notifications would return for PR-3131.
  const { data: bellShape } = await sb
    .from("provider_notifications")
    .select("id, type, title, message, href, payload_json, seen_at, created_at")
    .eq("provider_id", PROVIDER_ID)
    .order("created_at", { ascending: false })
    .limit(10);
  const apiShape = (bellShape || []).map((row) => ({
    id: String(row.id),
    type: String(row.type),
    title: String(row.title),
    message: String(row.message || ""),
    href: row.href ? String(row.href) : undefined,
    createdAt: row.created_at ? String(row.created_at) : undefined,
    seen: Boolean(row.seen_at),
    payload: row.payload_json ?? null,
  }));
  print("6. /api/provider/notifications response shape (PR-3131)", apiShape);

  // 7. Show the dashboard memo dedupe outcome — given the persistentJobTaskIds
  //    set built from this response, would the derived job:TK-1778147402823
  //    item be filtered out?
  const dbJobTaskIds = new Set(
    apiShape
      .filter((r) => r.type === "job_matched")
      .map((r) => String(r.payload?.taskId || ""))
      .filter(Boolean)
  );
  print("7. dashboard memo dedupe simulation", {
    dbJobTaskIds: Array.from(dbJobTaskIds),
    derivedItemForThisTaskWouldBeDropped: dbJobTaskIds.has(TASK_ID),
  });
})();
