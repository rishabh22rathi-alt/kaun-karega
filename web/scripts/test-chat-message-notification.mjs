// Phase 2b verification test. Simulates the new code path against PR-3131's
// existing chat thread (for TK-1778147402823) without requiring the dev
// server.
//
//   node scripts/test-chat-message-notification.mjs            -> insert + verify
//   node scripts/test-chat-message-notification.mjs cleanup    -> remove the test
//
// Idempotent: re-running mirrors the new dedupe — if an unseen chat_message
// for the same thread exists, the second insert is skipped.

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

// PR-3131 has no chat thread today. Falling back to a real plumber-side
// provider PR-1381 with a live thread for the verification test. Override
// via `PROVIDER_ID` env var when re-running.
const PROVIDER_ID = process.env.PROVIDER_ID || "PR-1381";

const print = (label, payload) => {
  console.log(`\n── ${label} ──`);
  console.log(JSON.stringify(payload, null, 2));
};

const mode = process.argv[2] === "cleanup" ? "cleanup" : "verify";

const normalizePhone10 = (raw) => {
  const digits = String(raw || "").replace(/\D/g, "");
  if (!digits) return "";
  return digits.length > 10 ? digits.slice(-10) : digits;
};

(async () => {
  // 1. Find a chat thread involving PR-3131.
  const { data: threads, error: threadErr } = await sb
    .from("chat_threads")
    .select(
      "thread_id, task_id, user_phone, provider_id, provider_phone, unread_provider_count, last_message_at"
    )
    .eq("provider_id", PROVIDER_ID)
    .order("last_message_at", { ascending: false })
    .limit(1);
  print("1. chat_threads for PR-3131 (most recent)", {
    error: threadErr?.message || null,
    rows: threads || [],
  });

  if (!threads || threads.length === 0) {
    console.error(
      "No chat thread found for PR-3131. Run after a chat thread exists or pick another provider."
    );
    process.exit(1);
  }
  const thread = threads[0];
  const threadId = String(thread.thread_id || "").trim();
  const taskId = String(thread.task_id || "").trim();

  if (mode === "cleanup") {
    const { data, error } = await sb
      .from("provider_notifications")
      .delete()
      .eq("provider_id", PROVIDER_ID)
      .eq("type", "chat_message")
      .contains("payload_json", { threadId })
      .select("id");
    print(
      `CLEANUP — deleted chat_message rows for ${PROVIDER_ID}/${threadId}`,
      {
        error: error?.message || null,
        deleted: (data || []).length,
      }
    );
    return;
  }

  // 2. Replicate the new dedupe pre-check exactly as chatPersistence does.
  const { data: existing, error: existingErr } = await sb
    .from("provider_notifications")
    .select("id, payload_json")
    .eq("provider_id", PROVIDER_ID)
    .eq("type", "chat_message")
    .is("seen_at", null);
  const alreadyHasUnseenForThread = (existing || []).some((row) => {
    const payload = row.payload_json;
    return payload?.threadId === threadId;
  });
  print("2. burst dedupe pre-check (unseen chat_message for this thread?)", {
    error: existingErr?.message || null,
    unseenForType: (existing || []).length,
    alreadyHasUnseenForThread,
  });

  if (alreadyHasUnseenForThread) {
    print(
      "3. INSERT skipped (burst dedupe)",
      "An unseen chat_message for this thread already exists. Mark it seen (open the bell), then re-run to test the after-seen insertion path. Or re-run with `cleanup` to wipe the test row."
    );
  } else {
    // 3a. Best-effort displayId lookup (mirrors the new code).
    let displayId = null;
    if (taskId) {
      const { data: taskRow } = await sb
        .from("tasks")
        .select("display_id")
        .eq("task_id", taskId)
        .maybeSingle();
      const dRaw = taskRow?.display_id;
      displayId =
        typeof dRaw === "number"
          ? dRaw
          : typeof dRaw === "string" && /^\d+$/.test(dRaw)
            ? Number(dRaw)
            : null;
    }
    const taskLabel = displayId
      ? `Kaam No. ${displayId}`
      : taskId || "your job";
    const senderPhone = normalizePhone10(thread.user_phone);

    const { data: inserted, error: insertErr } = await sb
      .from("provider_notifications")
      .insert({
        provider_id: PROVIDER_ID,
        type: "chat_message",
        title: "Customer replied",
        message: `Customer replied on ${taskLabel}.`,
        href: `/chat/thread/${encodeURIComponent(threadId)}`,
        payload_json: {
          threadId,
          taskId,
          displayId,
          senderPhone,
          providerId: PROVIDER_ID,
        },
      })
      .select(
        "id, type, title, message, href, payload_json, seen_at, created_at"
      )
      .single();
    print("3. INSERT chat_message notification", {
      error: insertErr?.message || null,
      row: inserted,
    });
  }

  // 4. Re-run dedupe to confirm a second insert would skip.
  const { data: existing2 } = await sb
    .from("provider_notifications")
    .select("id, payload_json")
    .eq("provider_id", PROVIDER_ID)
    .eq("type", "chat_message")
    .is("seen_at", null);
  const wouldDedupe = (existing2 || []).some((row) => {
    const payload = row.payload_json;
    return payload?.threadId === threadId;
  });
  print("4. dedupe re-check (simulates retry/burst)", {
    unseenRowsForProvider: (existing2 || []).length,
    secondInsertWouldSkip: wouldDedupe,
  });

  // 5. Show /api/provider/notifications shape.
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
  print("5. /api/provider/notifications response shape (PR-3131)", apiShape);

  // 6. Show dashboard memo dedupe outcome for chat group.
  const dbChatThreadIds = new Set(
    apiShape
      .filter((r) => r.type === "chat_message")
      .map((r) => String(r.payload?.threadId || ""))
      .filter(Boolean)
  );
  print("6. dashboard memo dedupe simulation", {
    dbChatThreadIds: Array.from(dbChatThreadIds),
    derivedItemForThisThreadWouldBeDropped: dbChatThreadIds.has(threadId),
  });

  // 7. After-seen test path: simulate the bell open marking the row seen,
  //    then a fresh customer message creating a new row.
  const { data: nowSeen } = await sb
    .from("provider_notifications")
    .update({ seen_at: new Date().toISOString() })
    .eq("provider_id", PROVIDER_ID)
    .eq("type", "chat_message")
    .is("seen_at", null)
    .contains("payload_json", { threadId })
    .select("id");
  print("7. SIMULATED: bell open marks chat_message rows seen for this thread", {
    markedCount: (nowSeen || []).length,
  });

  // 7b. Now another customer message would NOT find an unseen row, so a new
  //     notification can be inserted. Verify by re-running the dedupe check.
  const { data: existing3 } = await sb
    .from("provider_notifications")
    .select("id, payload_json")
    .eq("provider_id", PROVIDER_ID)
    .eq("type", "chat_message")
    .is("seen_at", null);
  const stillBlocked = (existing3 || []).some((row) => {
    const payload = row.payload_json;
    return payload?.threadId === threadId;
  });
  print("7b. after-seen: would a fresh customer reply create a new notif?", {
    unseenRowsForThisThread: stillBlocked ? "yes (unexpected)" : "no",
    nextInsertAllowed: !stillBlocked,
  });
})();
