import { adminSupabase } from "../supabase/admin";

/**
 * Admin "Chats" tab data layer.
 *
 * Read-only union over the two existing chat surfaces:
 *
 *   - chat_threads / chat_messages
 *       user ↔ provider chat attached to a Kaam (task_id).
 *
 *   - need_chat_threads / need_chat_messages
 *       poster ↔ responder chat attached to an i-need (need_id).
 *
 * The helpers in this file NEVER mutate. They power the read-only
 * monitor view exposed by /api/admin/chats and /api/admin/chats/
 * [threadId]. Existing user/provider chat flows (sendChatMessage,
 * markChatRead, need_chat_*, admin_update_chat_thread_status) are
 * untouched — this is a fresh, gated read path.
 *
 * Why a separate helper instead of reusing
 * lib/chat/chatPersistence.ts's getAdminChatThreadsFromSupabase:
 *   - That helper drives the legacy /admin/chats page and the
 *     `/api/kk` action `admin_list_chat_threads`, and is shared with
 *     the moderation surface. Extending its return shape to include
 *     `category`, `area`, `type`, and i-need rows would either change
 *     the action contract (breaking the legacy page) or add silent
 *     overrides. Cleaner to read the tables directly here.
 *   - The detail endpoint must work for BOTH task and need threads
 *     dispatching by `type`. The legacy helper only knows task chats.
 */

const TASK_THREAD_FETCH_LIMIT = 200;
const NEED_THREAD_FETCH_LIMIT = 200;
const MESSAGE_PREVIEW_MAX = 140;
// Per-thread message fan-out for the detail endpoint. Threads usually
// have <50 messages; cap defensively so a single thread can't exhaust
// memory.
const MESSAGE_PAGE_LIMIT = 1_000;

export type AdminChatThreadType = "task" | "need";

export type AdminChatThreadSummary = {
  threadId: string;
  type: AdminChatThreadType;
  // For task chats: tasks.task_id. For need chats: needs.need_id.
  // Always shown verbatim — display labels are computed UI-side.
  taskOrNeedId: string;
  displayId: string | null;
  userPhone: string;
  providerId: string | null;
  providerName: string | null;
  providerPhone: string | null;
  category: string | null;
  area: string | null;
  status: string;
  lastMessagePreview: string | null;
  lastMessageAt: string | null;
  lastMessageBy: string | null;
  createdAt: string | null;
  updatedAt: string | null;
};

export type AdminChatMessage = {
  messageId: string;
  threadId: string;
  // Sender role normalised across the two tables — task chat uses
  // "user"/"provider"/"system", need chat uses "poster"/"responder".
  // We surface the raw role too (`rawSender`) so the UI can render
  // the precise label the underlying table wrote.
  sender: "user" | "provider" | "system";
  rawSender: string;
  senderPhone: string | null;
  senderName: string | null;
  text: string;
  createdAt: string | null;
};

export type AdminChatSummaryStats = {
  total: number;
  active: number;
  closed: number;
  task: number;
  need: number;
};

export type AdminChatListResult = {
  threads: AdminChatThreadSummary[];
  stats: AdminChatSummaryStats;
};

type TaskThreadRow = {
  thread_id: string | null;
  task_id: string | null;
  user_phone: string | null;
  provider_id: string | null;
  provider_phone: string | null;
  category: string | null;
  area: string | null;
  status: string | null;
  thread_status: string | null;
  last_message_at: string | null;
  last_message_by: string | null;
  created_at: string | null;
  updated_at: string | null;
};

type NeedThreadRow = {
  thread_id: string | null;
  need_id: string | null;
  poster_phone: string | null;
  responder_phone: string | null;
  status: string | null;
  last_message_at: string | null;
  last_message_by: string | null;
  created_at: string | null;
  updated_at: string | null;
};

type TaskRow = {
  task_id: string | null;
  display_id: string | number | null;
  category: string | null;
  area: string | null;
};

type ProviderRow = {
  provider_id: string | null;
  full_name: string | null;
  phone: string | null;
};

type TaskMessageRow = {
  message_id: string | null;
  thread_id: string | null;
  sender_type: string | null;
  sender_phone: string | null;
  sender_name: string | null;
  message_text: string | null;
  created_at: string | null;
};

type NeedMessageRow = {
  message_id: string | null;
  thread_id: string | null;
  sender_role: string | null;
  sender_phone: string | null;
  message_text: string | null;
  created_at: string | null;
};

function s(v: unknown): string {
  return typeof v === "string" ? v.trim() : v == null ? "" : String(v).trim();
}

function preview(text: string | null): string | null {
  const t = s(text);
  if (!t) return null;
  return t.length > MESSAGE_PREVIEW_MAX
    ? `${t.slice(0, MESSAGE_PREVIEW_MAX - 1)}…`
    : t;
}

// Normalise the assorted thread-status values we see across the two
// tables ("active", "open", "closed", "flagged", "muted", "locked")
// into the small set the admin UI buckets on. Anything unrecognised
// falls back to "active" — a thread that exists but has no
// recognisable terminal flag is treated as live.
function normaliseThreadStatus(...candidates: Array<string | null>): string {
  for (const candidate of candidates) {
    const value = s(candidate).toLowerCase();
    if (!value) continue;
    if (value === "closed" || value === "completed") return "closed";
    if (value === "open" || value === "active") return "active";
    if (value === "flagged" || value === "muted" || value === "locked") {
      return value;
    }
  }
  return "active";
}

function mapTaskSender(raw: string | null): AdminChatMessage["sender"] {
  const v = s(raw).toLowerCase();
  if (v === "provider") return "provider";
  if (v === "system" || v === "admin") return "system";
  return "user";
}

function mapNeedSender(raw: string | null): AdminChatMessage["sender"] {
  const v = s(raw).toLowerCase();
  // need_chat_messages.sender_role uses poster/responder. We
  // collapse them to user/provider so the admin UI has a consistent
  // two-party view — `rawSender` preserves the exact value for any
  // surfaces that need it.
  if (v === "responder") return "provider";
  if (v === "system" || v === "admin") return "system";
  return "user";
}

async function loadProviderLookup(
  providerIds: string[]
): Promise<{ names: Record<string, string>; phones: Record<string, string> }> {
  const ids = Array.from(
    new Set(providerIds.map((p) => s(p)).filter(Boolean))
  );
  const empty = { names: {}, phones: {} };
  if (ids.length === 0) return empty;

  const { data, error } = await adminSupabase
    .from("providers")
    .select("provider_id, full_name, phone")
    .in("provider_id", ids);
  if (error) return empty;

  const names: Record<string, string> = {};
  const phones: Record<string, string> = {};
  for (const row of (data ?? []) as ProviderRow[]) {
    const id = s(row.provider_id);
    if (!id) continue;
    const name = s(row.full_name);
    const phone = s(row.phone);
    if (name) names[id] = name;
    if (phone) phones[id] = phone;
  }
  return { names, phones };
}

async function loadTaskLookup(
  taskIds: string[]
): Promise<Record<string, TaskRow>> {
  const ids = Array.from(
    new Set(taskIds.map((t) => s(t)).filter(Boolean))
  );
  if (ids.length === 0) return {};
  const { data, error } = await adminSupabase
    .from("tasks")
    .select("task_id, display_id, category, area")
    .in("task_id", ids);
  if (error) return {};
  const out: Record<string, TaskRow> = {};
  for (const row of (data ?? []) as TaskRow[]) {
    const id = s(row.task_id);
    if (id) out[id] = row;
  }
  return out;
}

async function loadLatestPreviewLookup(
  threadIds: string[],
  table: "chat_messages" | "need_chat_messages"
): Promise<Record<string, { text: string; createdAt: string | null }>> {
  const ids = Array.from(
    new Set(threadIds.map((t) => s(t)).filter(Boolean))
  );
  if (ids.length === 0) return {};

  // Per-thread "latest message" lookups need to run per-id to avoid
  // returning hundreds of unrelated rows. Each thread row is tiny.
  // For 200 threads × 1 round-trip each this is acceptable — the
  // admin list endpoint is paged and rate-limited by the table caps
  // above.
  const out: Record<string, { text: string; createdAt: string | null }> = {};
  await Promise.all(
    ids.map(async (threadId) => {
      const { data, error } = await adminSupabase
        .from(table)
        .select("message_text, created_at")
        .eq("thread_id", threadId)
        .order("created_at", { ascending: false })
        .limit(1);
      if (error) return;
      const row = (data?.[0] ?? null) as
        | { message_text: string | null; created_at: string | null }
        | null;
      if (!row) return;
      out[threadId] = {
        text: s(row.message_text),
        createdAt: row.created_at ?? null,
      };
    })
  );
  return out;
}

type ListAdminChatsParams = {
  type?: "task" | "need" | "all";
  status?: string;
};

export async function listAdminChatThreads(
  params: ListAdminChatsParams = {}
): Promise<AdminChatListResult> {
  const wantTask = params.type !== "need";
  const wantNeed = params.type !== "task";

  const [taskRowsResult, needRowsResult] = await Promise.all([
    wantTask
      ? adminSupabase
          .from("chat_threads")
          .select(
            "thread_id, task_id, user_phone, provider_id, provider_phone, category, area, status, thread_status, last_message_at, last_message_by, created_at, updated_at"
          )
          .order("last_message_at", {
            ascending: false,
            nullsFirst: false,
          })
          .limit(TASK_THREAD_FETCH_LIMIT)
      : Promise.resolve({ data: [], error: null }),
    wantNeed
      ? adminSupabase
          .from("need_chat_threads")
          .select(
            "thread_id, need_id, poster_phone, responder_phone, status, last_message_at, last_message_by, created_at, updated_at"
          )
          .order("last_message_at", {
            ascending: false,
            nullsFirst: false,
          })
          .limit(NEED_THREAD_FETCH_LIMIT)
      : Promise.resolve({ data: [], error: null }),
  ]);

  const taskRows = (taskRowsResult.data ?? []) as TaskThreadRow[];
  const needRows = (needRowsResult.data ?? []) as NeedThreadRow[];

  const taskThreadIds = taskRows.map((r) => s(r.thread_id)).filter(Boolean);
  const needThreadIds = needRows.map((r) => s(r.thread_id)).filter(Boolean);
  const providerIds = taskRows.map((r) => s(r.provider_id)).filter(Boolean);
  const taskIds = taskRows.map((r) => s(r.task_id)).filter(Boolean);

  const [providerLookup, taskLookup, taskPreviewLookup, needPreviewLookup] =
    await Promise.all([
      loadProviderLookup(providerIds),
      loadTaskLookup(taskIds),
      loadLatestPreviewLookup(taskThreadIds, "chat_messages"),
      loadLatestPreviewLookup(needThreadIds, "need_chat_messages"),
    ]);

  const summaries: AdminChatThreadSummary[] = [];

  for (const row of taskRows) {
    const threadId = s(row.thread_id);
    if (!threadId) continue;
    const taskId = s(row.task_id);
    const providerId = s(row.provider_id) || null;
    const task = taskId ? taskLookup[taskId] : undefined;
    const previewRow = taskPreviewLookup[threadId];
    summaries.push({
      threadId,
      type: "task",
      taskOrNeedId: taskId,
      displayId: task?.display_id != null ? String(task.display_id) : null,
      userPhone: s(row.user_phone),
      providerId,
      providerName: providerId
        ? providerLookup.names[providerId] || null
        : null,
      providerPhone:
        s(row.provider_phone) ||
        (providerId ? providerLookup.phones[providerId] || null : null),
      category: s(row.category) || s(task?.category ?? "") || null,
      area: s(row.area) || s(task?.area ?? "") || null,
      status: normaliseThreadStatus(row.thread_status, row.status),
      lastMessagePreview:
        preview(previewRow?.text ?? null) ?? null,
      lastMessageAt: previewRow?.createdAt ?? row.last_message_at ?? null,
      lastMessageBy: s(row.last_message_by) || null,
      createdAt: row.created_at ?? null,
      updatedAt: row.updated_at ?? null,
    });
  }

  for (const row of needRows) {
    const threadId = s(row.thread_id);
    if (!threadId) continue;
    const previewRow = needPreviewLookup[threadId];
    summaries.push({
      threadId,
      type: "need",
      taskOrNeedId: s(row.need_id),
      displayId: null,
      userPhone: s(row.poster_phone),
      providerId: null,
      providerName: null,
      providerPhone: s(row.responder_phone) || null,
      category: null,
      area: null,
      status: normaliseThreadStatus(row.status),
      lastMessagePreview: preview(previewRow?.text ?? null) ?? null,
      lastMessageAt: previewRow?.createdAt ?? row.last_message_at ?? null,
      lastMessageBy: s(row.last_message_by) || null,
      createdAt: row.created_at ?? null,
      updatedAt: row.updated_at ?? null,
    });
  }

  // Sort the merged list by most-recent activity. Threads with no
  // last_message_at fall to the bottom so admins see the most active
  // conversations first.
  summaries.sort((a, b) => {
    const av = a.lastMessageAt ? Date.parse(a.lastMessageAt) : 0;
    const bv = b.lastMessageAt ? Date.parse(b.lastMessageAt) : 0;
    return bv - av;
  });

  const statusFilter = s(params.status).toLowerCase();
  const filtered = statusFilter
    ? summaries.filter((row) => row.status === statusFilter)
    : summaries;

  const stats: AdminChatSummaryStats = {
    total: summaries.length,
    active: summaries.filter((r) => r.status === "active").length,
    closed: summaries.filter((r) => r.status === "closed").length,
    task: summaries.filter((r) => r.type === "task").length,
    need: summaries.filter((r) => r.type === "need").length,
  };

  return { threads: filtered, stats };
}

export type AdminChatDetailResult = {
  thread: AdminChatThreadSummary;
  messages: AdminChatMessage[];
};

export async function getAdminChatThreadDetail(
  threadId: string,
  type: AdminChatThreadType
): Promise<AdminChatDetailResult | null> {
  const id = s(threadId);
  if (!id) return null;

  if (type === "task") {
    const { data: rows, error } = await adminSupabase
      .from("chat_threads")
      .select(
        "thread_id, task_id, user_phone, provider_id, provider_phone, category, area, status, thread_status, last_message_at, last_message_by, created_at, updated_at"
      )
      .eq("thread_id", id)
      .limit(1);
    if (error || !rows || rows.length === 0) return null;
    const row = rows[0] as TaskThreadRow;
    const taskId = s(row.task_id);
    const providerId = s(row.provider_id) || null;
    const [providerLookup, taskLookup] = await Promise.all([
      loadProviderLookup(providerId ? [providerId] : []),
      loadTaskLookup(taskId ? [taskId] : []),
    ]);
    const task = taskId ? taskLookup[taskId] : undefined;

    const { data: msgRows, error: msgErr } = await adminSupabase
      .from("chat_messages")
      .select(
        "message_id, thread_id, sender_type, sender_phone, sender_name, message_text, created_at"
      )
      .eq("thread_id", id)
      .order("created_at", { ascending: true })
      .limit(MESSAGE_PAGE_LIMIT);
    if (msgErr) return null;

    const messages = ((msgRows ?? []) as TaskMessageRow[]).map((m) => ({
      messageId: s(m.message_id),
      threadId: s(m.thread_id),
      sender: mapTaskSender(m.sender_type),
      rawSender: s(m.sender_type) || "user",
      senderPhone: s(m.sender_phone) || null,
      senderName: s(m.sender_name) || null,
      text: s(m.message_text),
      createdAt: m.created_at ?? null,
    }));

    return {
      thread: {
        threadId: id,
        type: "task",
        taskOrNeedId: taskId,
        displayId: task?.display_id != null ? String(task.display_id) : null,
        userPhone: s(row.user_phone),
        providerId,
        providerName: providerId
          ? providerLookup.names[providerId] || null
          : null,
        providerPhone:
          s(row.provider_phone) ||
          (providerId ? providerLookup.phones[providerId] || null : null),
        category: s(row.category) || s(task?.category ?? "") || null,
        area: s(row.area) || s(task?.area ?? "") || null,
        status: normaliseThreadStatus(row.thread_status, row.status),
        lastMessagePreview: null,
        lastMessageAt: row.last_message_at ?? null,
        lastMessageBy: s(row.last_message_by) || null,
        createdAt: row.created_at ?? null,
        updatedAt: row.updated_at ?? null,
      },
      messages,
    };
  }

  // need type
  const { data: rows, error } = await adminSupabase
    .from("need_chat_threads")
    .select(
      "thread_id, need_id, poster_phone, responder_phone, status, last_message_at, last_message_by, created_at, updated_at"
    )
    .eq("thread_id", id)
    .limit(1);
  if (error || !rows || rows.length === 0) return null;
  const row = rows[0] as NeedThreadRow;

  const { data: msgRows, error: msgErr } = await adminSupabase
    .from("need_chat_messages")
    .select(
      "message_id, thread_id, sender_role, sender_phone, message_text, created_at"
    )
    .eq("thread_id", id)
    .order("created_at", { ascending: true })
    .limit(MESSAGE_PAGE_LIMIT);
  if (msgErr) return null;

  const messages = ((msgRows ?? []) as NeedMessageRow[]).map((m) => ({
    messageId: s(m.message_id),
    threadId: s(m.thread_id),
    sender: mapNeedSender(m.sender_role),
    rawSender: s(m.sender_role) || "user",
    senderPhone: s(m.sender_phone) || null,
    senderName: null,
    text: s(m.message_text),
    createdAt: m.created_at ?? null,
  }));

  return {
    thread: {
      threadId: id,
      type: "need",
      taskOrNeedId: s(row.need_id),
      displayId: null,
      userPhone: s(row.poster_phone),
      providerId: null,
      providerName: null,
      providerPhone: s(row.responder_phone) || null,
      category: null,
      area: null,
      status: normaliseThreadStatus(row.status),
      lastMessagePreview: null,
      lastMessageAt: row.last_message_at ?? null,
      lastMessageBy: s(row.last_message_by) || null,
      createdAt: row.created_at ?? null,
      updatedAt: row.updated_at ?? null,
    },
    messages,
  };
}
