import { adminSupabase } from "../supabase/admin";
import { appendNotificationLog } from "../notificationLogStore";
import {
  sendProviderUserRepliedNotification,
  sendUserFirstProviderMessageNotification,
  type SendTemplateResult,
} from "../whatsappTemplates";

type ProviderRow = {
  provider_id: string;
  full_name: string | null;
  phone: string | null;
};

type ChatThreadRow = {
  thread_id: string;
  task_id: string;
  user_phone: string;
  provider_id: string;
  provider_phone: string | null;
  category: string | null;
  area: string | null;
  status: string | null;
  created_at: string;
  updated_at: string;
  last_message_at: string | null;
  last_message_by: string | null;
  unread_user_count: number | null;
  unread_provider_count: number | null;
  thread_status: string | null;
  moderation_reason: string | null;
  last_moderated_at: string | null;
  last_moderated_by: string | null;
};

type ChatMessageRow = {
  message_id: string;
  thread_id: string;
  task_id: string;
  sender_type: string;
  sender_phone: string | null;
  sender_name: string | null;
  message_text: string;
  message_type: string | null;
  created_at: string;
  read_by_user: string | null;
  read_by_provider: string | null;
  moderation_status: string | null;
  flag_reason: string | null;
  contains_blocked_word: string | null;
};

type TaskDisplayRow = {
  display_id: string | number | null;
};

type TaskRow = {
  task_id: string;
  display_id: string | number | null;
  phone: string | null;
  category: string | null;
  area: string | null;
};

type ProviderMatchRow = {
  task_id: string;
  provider_id: string;
};

type ChatActor =
  | {
      ok: true;
      actorType: "user";
      userPhone: string;
      senderPhone: string;
      senderName: string;
    }
  | {
      ok: true;
      actorType: "provider";
      providerId: string;
      providerPhone: string;
      senderPhone: string;
      senderName: string;
    }
  | {
      ok: false;
      error: string;
    };

type ChatThreadPayload = {
  ThreadID: string;
  TaskID: string;
  DisplayID: string;
  UserPhone: string;
  ProviderID: string;
  ProviderPhone: string;
  Category: string;
  Area: string;
  Status: string;
  CreatedAt: string;
  UpdatedAt: string;
  LastMessageAt: string;
  LastMessageBy: string;
  UnreadUserCount: number;
  UnreadProviderCount: number;
  ThreadStatus: string;
  ModerationReason: string;
  LastModeratedAt: string;
  LastModeratedBy: string;
};

type ChatMessagePayload = {
  MessageID: string;
  ThreadID: string;
  TaskID: string;
  SenderType: string;
  SenderPhone: string;
  SenderName: string;
  MessageText: string;
  MessageType: string;
  CreatedAt: string;
  ReadByUser: string;
  ReadByProvider: string;
  ModerationStatus: string;
  FlagReason: string;
  ContainsBlockedWord: string;
};

export type ChatMessagesActionPayload =
  | {
      ok: true;
      status: "success";
      thread: ChatThreadPayload;
      messages: ChatMessagePayload[];
    }
  | {
      ok: false;
      status: "error";
      error: string;
      blocked?: boolean;
      blockedAttempts?: number;
      autoFlagged?: boolean;
    };

export type ChatSendMessageActionPayload =
  | {
      ok: true;
      status: "success";
      thread: ChatThreadPayload;
      message: ChatMessagePayload;
    }
  | {
      ok: false;
      status: "error";
      error: string;
      blocked?: boolean;
      blockedAttempts?: number;
      autoFlagged?: boolean;
    };

export type ChatCreateOrGetThreadActionPayload =
  | {
      ok: true;
      status: "success";
      created: boolean;
      thread: ChatThreadPayload;
    }
  | {
      ok: false;
      status: "error";
      error: string;
    };

export type ChatThreadsActionPayload =
  | {
      ok: true;
      status: "success";
      threads: ChatThreadPayload[];
    }
  | {
      ok: false;
      status: "error";
      error: string;
    };

export type ChatMarkReadActionPayload =
  | {
      ok: true;
      status: "success";
      thread: ChatThreadPayload;
      markedCount: number;
    }
  | {
      ok: false;
      status: "error";
      error: string;
    };

export type AdminChatThreadSummary = {
  ThreadID: string;
  TaskID: string;
  DisplayID: string;
  UserPhone: string;
  UserPhoneMasked: string;
  ProviderID: string;
  ProviderName: string;
  ProviderPhone: string;
  LastMessagePreview: string;
  LastMessageAt: string;
  LastMessageBy: string;
  ThreadStatus: string;
  ModerationReason: string;
  LastModeratedAt: string;
  LastModeratedBy: string;
  CreatedAt: string;
  UpdatedAt: string;
};

export type AdminChatThreadsActionPayload =
  | {
      ok: true;
      status: "success";
      threads: AdminChatThreadSummary[];
    }
  | {
      ok: false;
      status: "error";
      error: string;
    };

export type AdminChatThreadDetailActionPayload =
  | {
      ok: true;
      status: "success";
      thread: AdminChatThreadSummary;
      messages: ChatMessagePayload[];
    }
  | {
      ok: false;
      status: "error";
      error: string;
    };

function normalizePhone10(value: unknown): string {
  return String(value || "").replace(/\D/g, "").slice(-10);
}

function trimString(value: unknown): string {
  return String(value || "").trim();
}

function formatChatTimestamp(value: string | null | undefined): string {
  const parsed = value ? new Date(value) : null;
  if (!parsed || Number.isNaN(parsed.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(parsed);
  const lookup = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${lookup.day || "01"}/${lookup.month || "01"}/${lookup.year || "1970"} ${lookup.hour || "00"}:${lookup.minute || "00"}:${lookup.second || "00"}`;
}

function parseChatTimestamp(value: unknown): string | null {
  const raw = trimString(value);
  if (!raw) return null;

  const direct = new Date(raw);
  if (!Number.isNaN(direct.getTime())) {
    return direct.toISOString();
  }

  const match = raw.match(
    /^(\d{2})\/(\d{2})\/(\d{4})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/
  );
  if (!match) return null;

  const [, dd, mm, yyyy, hh = "00", min = "00", ss = "00"] = match;
  const iso = `${yyyy}-${mm}-${dd}T${hh}:${min}:${ss}+05:30`;
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function buildMessageId(): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `MSG-${timestamp}-${random}`;
}

function buildThreadId(): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `TH-${timestamp}-${random}`;
}

function normalizeYesNo(value: unknown, fallback: "yes" | "no"): "yes" | "no" {
  return trimString(value).toLowerCase() === "yes" ? "yes" : fallback;
}

function getEffectiveThreadStatus(thread: ChatThreadRow): string {
  const threadStatus = trimString(thread.thread_status).toLowerCase();
  const status = trimString(thread.status).toLowerCase();
  return threadStatus || status || "active";
}

async function getTaskDisplayId(taskId: string): Promise<string> {
  if (!taskId) return "";

  const { data } = await adminSupabase
    .from("tasks")
    .select("display_id")
    .eq("task_id", taskId)
    .maybeSingle();

  const row = (data ?? null) as TaskDisplayRow | null;
  return row && row.display_id !== null ? trimString(row.display_id) : "";
}

function maskPhoneForAdmin(value: unknown): string {
  const phone = normalizePhone10(value);
  return phone ? `******${phone.slice(-4)}` : "";
}

function parseSortableTime(value: unknown): number {
  const raw = trimString(value);
  if (!raw) return 0;
  const direct = Date.parse(raw);
  if (!Number.isNaN(direct)) return direct;
  const parsed = parseChatTimestamp(raw);
  return parsed ? Date.parse(parsed) : 0;
}

function sortThreadsByRecentActivity<T extends { LastMessageAt?: string; UpdatedAt?: string; CreatedAt?: string }>(
  items: T[]
): T[] {
  return [...items].sort((a, b) => {
    const aMs = Math.max(
      parseSortableTime(a.LastMessageAt),
      parseSortableTime(a.UpdatedAt),
      parseSortableTime(a.CreatedAt)
    );
    const bMs = Math.max(
      parseSortableTime(b.LastMessageAt),
      parseSortableTime(b.UpdatedAt),
      parseSortableTime(b.CreatedAt)
    );
    return bMs - aMs;
  });
}

async function countMessagesBySenderType(
  threadId: string,
  senderType: "user" | "provider"
): Promise<number> {
  const { count, error } = await adminSupabase
    .from("chat_messages")
    .select("message_id", { count: "exact", head: true })
    .eq("thread_id", threadId)
    .eq("sender_type", senderType);

  if (error) {
    throw new Error(error.message);
  }

  return Number(count || 0);
}

async function logChatNotificationResult(params: {
  thread: ChatThreadRow;
  recipientPhone: string;
  templateName: string;
  sendResult: SendTemplateResult;
}): Promise<void> {
  const displayId = await getTaskDisplayId(trimString(params.thread.task_id));
  const logResult = await appendNotificationLog({
    taskId: trimString(params.thread.task_id),
    displayId,
    providerId: trimString(params.thread.provider_id),
    providerPhone: normalizePhone10(params.recipientPhone),
    category: trimString(params.thread.category),
    area: trimString(params.thread.area),
    serviceTime: "",
    templateName: params.templateName,
    status: params.sendResult.status,
    statusCode: params.sendResult.statusCode,
    messageId: params.sendResult.messageId,
    errorMessage: params.sendResult.errorMessage,
    rawResponse: params.sendResult.responseText,
  });

  if (!logResult.ok) {
    console.warn("[chatPersistence] notification log insert failed", {
      threadId: trimString(params.thread.thread_id),
      templateName: params.templateName,
      error: logResult.error,
    });
  }
}

async function runChatNotificationSideEffects(
  threadRow: ChatThreadRow,
  actor: Extract<ChatActor, { ok: true }>
): Promise<void> {
  const threadId = trimString(threadRow.thread_id);
  const taskId = trimString(threadRow.task_id);
  const displayId = await getTaskDisplayId(taskId);

  if (!displayId || !threadId) {
    return;
  }

  if (actor.actorType === "provider") {
    const providerMessageCount = await countMessagesBySenderType(threadId, "provider");
    if (providerMessageCount !== 1) {
      return;
    }

    const userPhone = normalizePhone10(threadRow.user_phone);
    if (!userPhone) {
      return;
    }

    try {
      const sendResult = await sendUserFirstProviderMessageNotification(
        userPhone,
        displayId,
        threadId
      );
      if (!sendResult.ok) {
        console.warn("[chatPersistence] first provider message notification returned non-ok", {
          threadId,
          taskId,
          status: sendResult.status,
          error: sendResult.errorMessage,
        });
      }
      await logChatNotificationResult({
        thread: threadRow,
        recipientPhone: userPhone,
        templateName: sendResult.templateName,
        sendResult,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await logChatNotificationResult({
        thread: threadRow,
        recipientPhone: userPhone,
        templateName: "user_chat_first_provider_message",
        sendResult: {
          ok: false,
          status: "error",
          statusCode: null,
          messageId: "",
          errorMessage: message,
          responseText: message,
          data: null,
          templateName: "user_chat_first_provider_message",
        },
      });
      console.warn("[chatPersistence] first provider message notification failed", {
        threadId,
        taskId,
        error: message,
      });
    }
    return;
  }

  const providerPhone = normalizePhone10(threadRow.provider_phone);
  if (!providerPhone) {
    return;
  }

  // Only notify on the first qualifying user reply after provider engagement:
  //   (1) provider has posted at least one message in this thread, and
  //   (2) this is the first user message chronologically after the earliest provider message.
  try {
    const providerMessageCount = await countMessagesBySenderType(threadId, "provider");
    if (providerMessageCount < 1) {
      return;
    }

    const { data: earliestProviderRows, error: earliestError } = await adminSupabase
      .from("chat_messages")
      .select("created_at")
      .eq("thread_id", threadId)
      .eq("sender_type", "provider")
      .order("created_at", { ascending: true })
      .limit(1);

    if (earliestError || !earliestProviderRows || earliestProviderRows.length === 0) {
      return;
    }

    const earliestProviderAt = String(earliestProviderRows[0]?.created_at || "");
    if (!earliestProviderAt) {
      return;
    }

    const { count: userRepliesAfterCount, error: repliesCountError } = await adminSupabase
      .from("chat_messages")
      .select("message_id", { count: "exact", head: true })
      .eq("thread_id", threadId)
      .eq("sender_type", "user")
      .gt("created_at", earliestProviderAt);

    if (repliesCountError) {
      console.warn("[chatPersistence] user reply count lookup failed", {
        threadId,
        taskId,
        error: repliesCountError.message,
      });
      return;
    }

    if (Number(userRepliesAfterCount || 0) !== 1) {
      return;
    }
  } catch (error) {
    console.warn("[chatPersistence] user reply eligibility check failed", {
      threadId,
      taskId,
      error: error instanceof Error ? error.message : String(error),
    });
    return;
  }

  try {
    const sendResult = await sendProviderUserRepliedNotification(
      providerPhone,
      displayId,
      threadId
    );
    if (!sendResult.ok) {
      console.warn("[chatPersistence] user reply notification returned non-ok", {
        threadId,
        taskId,
        status: sendResult.status,
        error: sendResult.errorMessage,
      });
    }
    await logChatNotificationResult({
      thread: threadRow,
      recipientPhone: providerPhone,
      templateName: sendResult.templateName,
      sendResult,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await logChatNotificationResult({
      thread: threadRow,
      recipientPhone: providerPhone,
      templateName: "provider_user_replied_message",
      sendResult: {
        ok: false,
        status: "error",
        statusCode: null,
        messageId: "",
        errorMessage: message,
        responseText: message,
        data: null,
        templateName: "provider_user_replied_message",
      },
    });
    console.warn("[chatPersistence] user reply notification failed", {
      threadId,
      taskId,
      error: message,
    });
  }
}

async function resolveProviderActor(data: Record<string, unknown>): Promise<ChatActor> {
  const providerPhone = normalizePhone10(
    data.ProviderPhone ||
      data.providerPhone ||
      data.phone ||
      data.requesterPhone ||
      data.loggedInProviderPhone
  );
  const requestedProviderId = trimString(data.ProviderID || data.providerId);

  if (!providerPhone) {
    return {
      ok: false,
      error: "Trusted logged-in provider phone is required for provider context",
    };
  }

  const { data: providerRows, error } = await adminSupabase
    .from("providers")
    .select("provider_id, full_name, phone")
    .or(`phone.eq.${providerPhone},phone.eq.91${providerPhone}`)
    .limit(5);

  if (error) {
    return { ok: false, error: error.message };
  }

  const provider = ((providerRows ?? []) as ProviderRow[]).find(
    (row) => normalizePhone10(row.phone) === providerPhone
  );

  if (!provider || !trimString(provider.provider_id)) {
    return { ok: false, error: "Logged-in provider not found" };
  }

  const resolvedProviderId = trimString(provider.provider_id);
  if (requestedProviderId && requestedProviderId !== resolvedProviderId) {
    return { ok: false, error: "ProviderID does not match logged-in provider context" };
  }

  return {
    ok: true,
    actorType: "provider",
    providerId: resolvedProviderId,
    providerPhone,
    senderPhone: providerPhone,
    senderName:
      trimString(data.SenderName || data.senderName || provider.full_name || "Provider") ||
      "Provider",
  };
}

async function resolveChatActor(data: Record<string, unknown>): Promise<ChatActor> {
  const actorType = trimString(data.ActorType || data.actorType).toLowerCase();

  if (actorType !== "user" && actorType !== "provider") {
    return { ok: false, error: "ActorType must be user or provider" };
  }

  if (actorType === "user") {
    const userPhone = normalizePhone10(
      data.UserPhone || data.userPhone || data.phone || data.requesterPhone
    );
    if (!userPhone) {
      return { ok: false, error: "UserPhone required for user context" };
    }

    return {
      ok: true,
      actorType: "user",
      userPhone,
      senderPhone: userPhone,
      senderName: trimString(data.SenderName || data.senderName || "User") || "User",
    };
  }

  return resolveProviderActor(data);
}

function canChatActorAccessThread(actor: Extract<ChatActor, { ok: true }>, thread: ChatThreadRow): boolean {
  if (actor.actorType === "user") {
    return normalizePhone10(thread.user_phone) === normalizePhone10(actor.userPhone);
  }

  const sameProviderId = trimString(thread.provider_id) === trimString(actor.providerId);
  const sameProviderPhone =
    normalizePhone10(thread.provider_phone) === normalizePhone10(actor.providerPhone);
  return sameProviderId || sameProviderPhone;
}

async function getChatThreadRow(threadId: string): Promise<ChatThreadRow | null> {
  const { data, error } = await adminSupabase
    .from("chat_threads")
    .select(
      "thread_id, task_id, user_phone, provider_id, provider_phone, category, area, status, created_at, updated_at, last_message_at, last_message_by, unread_user_count, unread_provider_count, thread_status, moderation_reason, last_moderated_at, last_moderated_by"
    )
    .eq("thread_id", threadId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? null) as ChatThreadRow | null;
}

async function getTaskRow(taskId: string): Promise<TaskRow | null> {
  const { data, error } = await adminSupabase
    .from("tasks")
    .select("task_id, display_id, phone, category, area")
    .eq("task_id", taskId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? null) as TaskRow | null;
}

async function getProviderById(providerId: string): Promise<ProviderRow | null> {
  const { data, error } = await adminSupabase
    .from("providers")
    .select("provider_id, full_name, phone")
    .eq("provider_id", providerId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? null) as ProviderRow | null;
}

async function getTaskProviderMatch(taskId: string, providerId: string): Promise<ProviderMatchRow | null> {
  const { data, error } = await adminSupabase
    .from("provider_task_matches")
    .select("task_id, provider_id")
    .eq("task_id", taskId)
    .eq("provider_id", providerId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? null) as ProviderMatchRow | null;
}

async function getChatThreadByTaskProvider(
  taskId: string,
  providerId: string
): Promise<ChatThreadRow | null> {
  const { data, error } = await adminSupabase
    .from("chat_threads")
    .select(
      "thread_id, task_id, user_phone, provider_id, provider_phone, category, area, status, created_at, updated_at, last_message_at, last_message_by, unread_user_count, unread_provider_count, thread_status, moderation_reason, last_moderated_at, last_moderated_by"
    )
    .eq("task_id", taskId)
    .eq("provider_id", providerId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? null) as ChatThreadRow | null;
}

async function getChatMessageRows(threadId: string): Promise<ChatMessageRow[]> {
  const { data, error } = await adminSupabase
    .from("chat_messages")
    .select(
      "message_id, thread_id, task_id, sender_type, sender_phone, sender_name, message_text, message_type, created_at, read_by_user, read_by_provider, moderation_status, flag_reason, contains_blocked_word"
    )
    .eq("thread_id", threadId)
    .order("created_at", { ascending: true });

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []) as ChatMessageRow[];
}

async function mapThreadRow(row: ChatThreadRow): Promise<ChatThreadPayload> {
  return {
    ThreadID: trimString(row.thread_id),
    TaskID: trimString(row.task_id),
    DisplayID: await getTaskDisplayId(trimString(row.task_id)),
    UserPhone: normalizePhone10(row.user_phone),
    ProviderID: trimString(row.provider_id),
    ProviderPhone: normalizePhone10(row.provider_phone),
    Category: trimString(row.category),
    Area: trimString(row.area),
    Status: trimString(row.status),
    CreatedAt: formatChatTimestamp(row.created_at),
    UpdatedAt: formatChatTimestamp(row.updated_at),
    LastMessageAt: formatChatTimestamp(row.last_message_at),
    LastMessageBy: trimString(row.last_message_by),
    UnreadUserCount: Number(row.unread_user_count || 0),
    UnreadProviderCount: Number(row.unread_provider_count || 0),
    ThreadStatus: trimString(row.thread_status),
    ModerationReason: trimString(row.moderation_reason),
    LastModeratedAt: formatChatTimestamp(row.last_moderated_at),
    LastModeratedBy: trimString(row.last_moderated_by),
  };
}

function mapMessageRow(row: ChatMessageRow): ChatMessagePayload {
  return {
    MessageID: trimString(row.message_id),
    ThreadID: trimString(row.thread_id),
    TaskID: trimString(row.task_id),
    SenderType: trimString(row.sender_type).toLowerCase(),
    SenderPhone: normalizePhone10(row.sender_phone),
    SenderName: trimString(row.sender_name),
    MessageText: trimString(row.message_text),
    MessageType: trimString(row.message_type || "text").toLowerCase() || "text",
    CreatedAt: formatChatTimestamp(row.created_at),
    ReadByUser: normalizeYesNo(row.read_by_user, "no"),
    ReadByProvider: normalizeYesNo(row.read_by_provider, "no"),
    ModerationStatus: trimString(row.moderation_status || "clear").toLowerCase() || "clear",
    FlagReason: trimString(row.flag_reason),
    ContainsBlockedWord:
      trimString(row.contains_blocked_word || "no").toLowerCase() === "yes" ? "yes" : "no",
  };
}

async function upsertChatThreadSnapshot(thread: Record<string, unknown>): Promise<void> {
  const threadId = trimString(thread.ThreadID || thread.threadId);
  const taskId = trimString(thread.TaskID || thread.taskId);
  if (!threadId || !taskId) return;

  const { error } = await adminSupabase.from("chat_threads").upsert(
    {
      thread_id: threadId,
      task_id: taskId,
      user_phone: normalizePhone10(thread.UserPhone || thread.userPhone),
      provider_id: trimString(thread.ProviderID || thread.providerId),
      provider_phone: normalizePhone10(thread.ProviderPhone || thread.providerPhone),
      category: trimString(thread.Category || thread.category) || null,
      area: trimString(thread.Area || thread.area) || null,
      status: trimString(thread.Status || thread.status) || "active",
      created_at: parseChatTimestamp(thread.CreatedAt || thread.createdAt) || new Date().toISOString(),
      updated_at: parseChatTimestamp(thread.UpdatedAt || thread.updatedAt) || new Date().toISOString(),
      last_message_at: parseChatTimestamp(thread.LastMessageAt || thread.lastMessageAt),
      last_message_by: trimString(thread.LastMessageBy || thread.lastMessageBy) || null,
      unread_user_count: Number(thread.UnreadUserCount ?? thread.unreadUserCount ?? 0) || 0,
      unread_provider_count:
        Number(thread.UnreadProviderCount ?? thread.unreadProviderCount ?? 0) || 0,
      thread_status: trimString(thread.ThreadStatus || thread.threadStatus) || "active",
      moderation_reason: trimString(thread.ModerationReason || thread.moderationReason) || null,
      last_moderated_at: parseChatTimestamp(
        thread.LastModeratedAt || thread.lastModeratedAt
      ),
      last_moderated_by: trimString(thread.LastModeratedBy || thread.lastModeratedBy) || null,
    },
    { onConflict: "thread_id" }
  );

  if (error) {
    throw new Error(error.message);
  }
}

async function upsertChatMessageSnapshots(messages: unknown[]): Promise<void> {
  const rows = messages
    .filter((message): message is Record<string, unknown> => Boolean(message && typeof message === "object"))
    .map((message) => {
      const messageId = trimString(message.MessageID || message.messageId);
      const threadId = trimString(message.ThreadID || message.threadId);
      const taskId = trimString(message.TaskID || message.taskId);
      if (!messageId || !threadId || !taskId) return null;

      return {
        message_id: messageId,
        thread_id: threadId,
        task_id: taskId,
        sender_type: trimString(message.SenderType || message.senderType).toLowerCase() || "user",
        sender_phone: normalizePhone10(message.SenderPhone || message.senderPhone),
        sender_name: trimString(message.SenderName || message.senderName) || null,
        message_text: trimString(message.MessageText || message.messageText),
        message_type: trimString(message.MessageType || message.messageType || "text")
          .toLowerCase() || "text",
        created_at:
          parseChatTimestamp(message.CreatedAt || message.createdAt) || new Date().toISOString(),
        read_by_user: normalizeYesNo(message.ReadByUser || message.readByUser, "no"),
        read_by_provider: normalizeYesNo(
          message.ReadByProvider || message.readByProvider,
          "no"
        ),
        moderation_status:
          trimString(message.ModerationStatus || message.moderationStatus || "clear")
            .toLowerCase() || "clear",
        flag_reason: trimString(message.FlagReason || message.flagReason) || null,
        contains_blocked_word:
          trimString(message.ContainsBlockedWord || message.containsBlockedWord || "no")
            .toLowerCase() === "yes"
            ? "yes"
            : "no",
      };
    })
    .filter((row): row is NonNullable<typeof row> => Boolean(row));

  if (rows.length === 0) return;

  const { error } = await adminSupabase
    .from("chat_messages")
    .upsert(rows, { onConflict: "message_id" });

  if (error) {
    throw new Error(error.message);
  }
}

export async function syncChatSnapshotFromGasPayload(payload: unknown): Promise<void> {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return;
  const source = payload as Record<string, unknown>;
  const thread =
    source.thread && typeof source.thread === "object" && !Array.isArray(source.thread)
      ? (source.thread as Record<string, unknown>)
      : null;
  const messages = Array.isArray(source.messages) ? source.messages : [];

  if (thread) {
    await upsertChatThreadSnapshot(thread);
  }
  if (messages.length > 0) {
    await upsertChatMessageSnapshots(messages);
  }
}

export async function syncChatThreadsFromGasPayload(payload: unknown): Promise<void> {
  const threads =
    payload && typeof payload === "object" && !Array.isArray(payload)
      ? Array.isArray((payload as { threads?: unknown[] }).threads)
        ? ((payload as { threads?: unknown[] }).threads as unknown[])
        : []
      : Array.isArray(payload)
        ? (payload as unknown[])
        : [];

  for (const item of threads) {
    if (item && typeof item === "object" && !Array.isArray(item)) {
      await upsertChatThreadSnapshot(item as Record<string, unknown>);
    }
  }
}

export async function getChatThreadsFromSupabase(
  data: Record<string, unknown>
): Promise<ChatThreadsActionPayload> {
  try {
    const actor = await resolveChatActor(data);
    if (!actor.ok) return { ok: false, status: "error", error: actor.error };

    const taskIdFilter = trimString(data.TaskID || data.taskId);
    const statusFilter = trimString(data.Status || data.status).toLowerCase();

    let query = adminSupabase
      .from("chat_threads")
      .select(
        "thread_id, task_id, user_phone, provider_id, provider_phone, category, area, status, created_at, updated_at, last_message_at, last_message_by, unread_user_count, unread_provider_count, thread_status, moderation_reason, last_moderated_at, last_moderated_by"
      );

    if (actor.actorType === "user") {
      query = query.eq("user_phone", actor.userPhone);
    } else {
      query = query.eq("provider_id", actor.providerId);
    }

    if (taskIdFilter) {
      query = query.eq("task_id", taskIdFilter);
    }
    if (statusFilter) {
      query = query.eq("status", statusFilter);
    }

    const { data: rows, error } = await query;
    if (error) {
      return { ok: false, status: "error", error: error.message };
    }

    const threads = await Promise.all(((rows ?? []) as ChatThreadRow[]).map((row) => mapThreadRow(row)));
    return {
      ok: true,
      status: "success",
      threads: sortThreadsByRecentActivity(threads),
    };
  } catch (error) {
    return {
      ok: false,
      status: "error",
      error: error instanceof Error ? error.message : "Failed to load chat threads",
    };
  }
}

export async function createOrGetChatThreadFromSupabase(
  data: Record<string, unknown>
): Promise<ChatCreateOrGetThreadActionPayload> {
  try {
    const taskId = trimString(data.TaskID || data.taskId);
    if (!taskId) return { ok: false, status: "error", error: "TaskID required" };

    const actor = await resolveChatActor(data);
    if (!actor.ok) return { ok: false, status: "error", error: actor.error };

    const task = await getTaskRow(taskId);
    if (!task) return { ok: false, status: "error", error: "Task not found" };

    const taskUserPhone = normalizePhone10(task.phone);
    if (!taskUserPhone) {
      return { ok: false, status: "error", error: "Task user phone missing" };
    }

    let providerId = "";
    let providerPhone = "";

    if (actor.actorType === "user") {
      providerId = trimString(data.ProviderID || data.providerId);
      if (!providerId) {
        return { ok: false, status: "error", error: "ProviderID required for user flow" };
      }
      const provider = await getProviderById(providerId);
      if (!provider || !trimString(provider.provider_id)) {
        return { ok: false, status: "error", error: "Provider not found" };
      }
      if (normalizePhone10(actor.userPhone) !== taskUserPhone) {
        return { ok: false, status: "error", error: "Access denied for this task" };
      }
      providerPhone = normalizePhone10(provider.phone);
    } else {
      providerId = trimString(actor.providerId);
      if (!providerId) {
        return { ok: false, status: "error", error: "Logged-in provider context missing" };
      }
      providerPhone = normalizePhone10(actor.providerPhone);
    }

    const match = await getTaskProviderMatch(taskId, providerId);
    if (!match) {
      return { ok: false, status: "error", error: "Provider is not matched to this task" };
    }

    const existing = await getChatThreadByTaskProvider(taskId, providerId);
    if (existing) {
      if (!canChatActorAccessThread(actor, existing)) {
        return { ok: false, status: "error", error: "Access denied" };
      }
      return {
        ok: true,
        status: "success",
        created: false,
        thread: await mapThreadRow(existing),
      };
    }

    const nowIso = new Date().toISOString();
    const threadId = buildThreadId();
    const insertRow = {
      thread_id: threadId,
      task_id: taskId,
      user_phone: taskUserPhone,
      provider_id: providerId,
      provider_phone: providerPhone,
      category: trimString(task.category),
      area: trimString(task.area),
      status: "active",
      created_at: nowIso,
      updated_at: nowIso,
      last_message_at: null,
      last_message_by: null,
      unread_user_count: 0,
      unread_provider_count: 0,
      thread_status: "active",
      moderation_reason: null,
      last_moderated_at: null,
      last_moderated_by: null,
    };

    const { error: insertError } = await adminSupabase.from("chat_threads").insert(insertRow);
    if (insertError) {
      return { ok: false, status: "error", error: insertError.message };
    }

    const created = await getChatThreadRow(threadId);
    if (!created) {
      return { ok: false, status: "error", error: "Thread not found" };
    }

    return {
      ok: true,
      status: "success",
      created: true,
      thread: await mapThreadRow(created),
    };
  } catch (error) {
    return {
      ok: false,
      status: "error",
      error: error instanceof Error ? error.message : "Failed to create chat thread",
    };
  }
}

export async function markChatReadFromSupabase(
  data: Record<string, unknown>
): Promise<ChatMarkReadActionPayload> {
  try {
    const threadId = trimString(data.ThreadID || data.threadId);
    if (!threadId) return { ok: false, status: "error", error: "ThreadID required" };

    const actor = await resolveChatActor(data);
    if (!actor.ok) return { ok: false, status: "error", error: actor.error };

    const threadRow = await getChatThreadRow(threadId);
    if (!threadRow) return { ok: false, status: "error", error: "Thread not found" };
    if (!canChatActorAccessThread(actor, threadRow)) {
      return { ok: false, status: "error", error: "Access denied" };
    }

    const nowIso = new Date().toISOString();
    let markedCount = 0;

    if (actor.actorType === "user") {
      const { count, error: countError } = await adminSupabase
        .from("chat_messages")
        .select("message_id", { count: "exact", head: true })
        .eq("thread_id", threadId)
        .eq("sender_type", "provider")
        .neq("read_by_user", "yes");
      if (countError) return { ok: false, status: "error", error: countError.message };
      markedCount = Number(count || 0);

      const { error: updateMessagesError } = await adminSupabase
        .from("chat_messages")
        .update({ read_by_user: "yes" })
        .eq("thread_id", threadId)
        .eq("sender_type", "provider");
      if (updateMessagesError) return { ok: false, status: "error", error: updateMessagesError.message };

      const { error: updateThreadError } = await adminSupabase
        .from("chat_threads")
        .update({ updated_at: nowIso, unread_user_count: 0 })
        .eq("thread_id", threadId);
      if (updateThreadError) return { ok: false, status: "error", error: updateThreadError.message };
    } else {
      const { count, error: countError } = await adminSupabase
        .from("chat_messages")
        .select("message_id", { count: "exact", head: true })
        .eq("thread_id", threadId)
        .eq("sender_type", "user")
        .neq("read_by_provider", "yes");
      if (countError) return { ok: false, status: "error", error: countError.message };
      markedCount = Number(count || 0);

      const { error: updateMessagesError } = await adminSupabase
        .from("chat_messages")
        .update({ read_by_provider: "yes" })
        .eq("thread_id", threadId)
        .eq("sender_type", "user");
      if (updateMessagesError) return { ok: false, status: "error", error: updateMessagesError.message };

      const { error: updateThreadError } = await adminSupabase
        .from("chat_threads")
        .update({ updated_at: nowIso, unread_provider_count: 0 })
        .eq("thread_id", threadId);
      if (updateThreadError) return { ok: false, status: "error", error: updateThreadError.message };
    }

    const updatedThread = await getChatThreadRow(threadId);
    if (!updatedThread) return { ok: false, status: "error", error: "Thread not found" };

    return {
      ok: true,
      status: "success",
      thread: await mapThreadRow(updatedThread),
      markedCount,
    };
  } catch (error) {
    return {
      ok: false,
      status: "error",
      error: error instanceof Error ? error.message : "Failed to mark chat read",
    };
  }
}

async function getLatestMessagePreviewLookup(threadIds: string[]): Promise<Record<string, ChatMessageRow>> {
  if (threadIds.length === 0) return {};
  const { data, error } = await adminSupabase
    .from("chat_messages")
    .select(
      "message_id, thread_id, task_id, sender_type, sender_phone, sender_name, message_text, message_type, created_at, read_by_user, read_by_provider, moderation_status, flag_reason, contains_blocked_word"
    )
    .in("thread_id", threadIds)
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(error.message);
  }

  const lookup: Record<string, ChatMessageRow> = {};
  for (const row of (data ?? []) as ChatMessageRow[]) {
    const threadId = trimString(row.thread_id);
    if (threadId && !lookup[threadId]) {
      lookup[threadId] = row;
    }
  }
  return lookup;
}

async function getProviderNameLookup(providerIds: string[]): Promise<Record<string, string>> {
  const ids = providerIds.map((item) => trimString(item)).filter(Boolean);
  if (ids.length === 0) return {};

  const { data, error } = await adminSupabase
    .from("providers")
    .select("provider_id, full_name")
    .in("provider_id", ids);

  if (error) {
    throw new Error(error.message);
  }

  return ((data ?? []) as Array<{ provider_id: string; full_name: string | null }>).reduce(
    (acc, row) => {
      acc[trimString(row.provider_id)] = trimString(row.full_name);
      return acc;
    },
    {} as Record<string, string>
  );
}

async function buildAdminThreadSummary(threadRow: ChatThreadRow, previewLookup: Record<string, ChatMessageRow>): Promise<AdminChatThreadSummary> {
  const mapped = await mapThreadRow(threadRow);
  const preview = previewLookup[mapped.ThreadID] || null;
  const providerNames = await getProviderNameLookup([mapped.ProviderID]);
  const effectiveStatus = getEffectiveThreadStatus(threadRow);

  return {
    ThreadID: mapped.ThreadID,
    TaskID: mapped.TaskID,
    DisplayID: mapped.DisplayID,
    UserPhone: mapped.UserPhone,
    UserPhoneMasked: maskPhoneForAdmin(mapped.UserPhone),
    ProviderID: mapped.ProviderID,
    ProviderName: providerNames[mapped.ProviderID] || "",
    ProviderPhone: mapped.ProviderPhone,
    LastMessagePreview: preview ? trimString(preview.message_text).slice(0, 120) : "",
    LastMessageAt: preview ? formatChatTimestamp(preview.created_at) : mapped.LastMessageAt,
    LastMessageBy: preview ? trimString(preview.sender_type) : mapped.LastMessageBy,
    ThreadStatus: effectiveStatus,
    ModerationReason: mapped.ModerationReason,
    LastModeratedAt: mapped.LastModeratedAt,
    LastModeratedBy: mapped.LastModeratedBy,
    CreatedAt: mapped.CreatedAt,
    UpdatedAt: mapped.UpdatedAt,
  };
}

export async function getAdminChatThreadsFromSupabase(
  data: Record<string, unknown>
): Promise<AdminChatThreadsActionPayload> {
  try {
    const statusFilter = trimString(data.Status || data.status).toLowerCase();
    const taskIdFilter = trimString(data.TaskID || data.taskId);

    let query = adminSupabase
      .from("chat_threads")
      .select(
        "thread_id, task_id, user_phone, provider_id, provider_phone, category, area, status, created_at, updated_at, last_message_at, last_message_by, unread_user_count, unread_provider_count, thread_status, moderation_reason, last_moderated_at, last_moderated_by"
      );

    if (taskIdFilter) {
      query = query.eq("task_id", taskIdFilter);
    }

    const { data: rows, error } = await query;
    if (error) {
      return { ok: false, status: "error", error: error.message };
    }

    const threadRows = ((rows ?? []) as ChatThreadRow[]).filter((row) => {
      const effectiveStatus = getEffectiveThreadStatus(row);
      return !statusFilter || effectiveStatus === statusFilter;
    });

    const previewLookup = await getLatestMessagePreviewLookup(
      threadRows.map((row) => trimString(row.thread_id)).filter(Boolean)
    );
    const providerNameLookup = await getProviderNameLookup(
      threadRows.map((row) => trimString(row.provider_id))
    );

    const summaries = await Promise.all(
      threadRows.map(async (threadRow) => {
        const mapped = await mapThreadRow(threadRow);
        const preview = previewLookup[mapped.ThreadID] || null;
        return {
          ThreadID: mapped.ThreadID,
          TaskID: mapped.TaskID,
          DisplayID: mapped.DisplayID,
          UserPhone: mapped.UserPhone,
          UserPhoneMasked: maskPhoneForAdmin(mapped.UserPhone),
          ProviderID: mapped.ProviderID,
          ProviderName: providerNameLookup[mapped.ProviderID] || "",
          ProviderPhone: mapped.ProviderPhone,
          LastMessagePreview: preview ? trimString(preview.message_text).slice(0, 120) : "",
          LastMessageAt: preview ? formatChatTimestamp(preview.created_at) : mapped.LastMessageAt,
          LastMessageBy: preview ? trimString(preview.sender_type) : mapped.LastMessageBy,
          ThreadStatus: getEffectiveThreadStatus(threadRow),
          ModerationReason: mapped.ModerationReason,
          LastModeratedAt: mapped.LastModeratedAt,
          LastModeratedBy: mapped.LastModeratedBy,
          CreatedAt: mapped.CreatedAt,
          UpdatedAt: mapped.UpdatedAt,
        };
      })
    );

    return {
      ok: true,
      status: "success",
      threads: sortThreadsByRecentActivity(summaries),
    };
  } catch (error) {
    return {
      ok: false,
      status: "error",
      error: error instanceof Error ? error.message : "Failed to load admin chat threads",
    };
  }
}

export async function getAdminChatThreadFromSupabase(
  data: Record<string, unknown>
): Promise<AdminChatThreadDetailActionPayload> {
  try {
    const threadId = trimString(data.ThreadID || data.threadId);
    if (!threadId) return { ok: false, status: "error", error: "ThreadID required" };

    const threadRow = await getChatThreadRow(threadId);
    if (!threadRow) return { ok: false, status: "error", error: "Thread not found" };

    const messages = await getChatMessageRows(threadId);
    const previewLookup = await getLatestMessagePreviewLookup([threadId]);
    const thread = await buildAdminThreadSummary(threadRow, previewLookup);

    return {
      ok: true,
      status: "success",
      thread,
      messages: messages.map(mapMessageRow),
    };
  } catch (error) {
    return {
      ok: false,
      status: "error",
      error: error instanceof Error ? error.message : "Failed to load admin chat thread",
    };
  }
}

export async function getChatMessagesFromSupabase(
  data: Record<string, unknown>
): Promise<ChatMessagesActionPayload> {
  try {
    const threadId = trimString(data.ThreadID || data.threadId);
    if (!threadId) return { ok: false, status: "error", error: "ThreadID required" };

    const actor = await resolveChatActor(data);
    if (!actor.ok) return { ok: false, status: "error", error: actor.error };

    const threadRow = await getChatThreadRow(threadId);
    if (!threadRow) return { ok: false, status: "error", error: "Thread not found" };
    if (!canChatActorAccessThread(actor, threadRow)) {
      return { ok: false, status: "error", error: "Access denied" };
    }

    const messageRows = await getChatMessageRows(threadId);
    return {
      ok: true,
      status: "success",
      thread: await mapThreadRow(threadRow),
      messages: messageRows.map(mapMessageRow),
    };
  } catch (error) {
    return {
      ok: false,
      status: "error",
      error: error instanceof Error ? error.message : "Failed to load chat messages",
    };
  }
}

export type UpdateChatThreadStatusPayload =
  | { ok: true; status: "success" }
  | { ok: false; status: "error"; error: string };

export async function updateChatThreadStatusFromSupabase(params: {
  threadId: string;
  threadStatus: string;
  reason: string;
  adminActorPhone: string;
}): Promise<UpdateChatThreadStatusPayload> {
  try {
    const { threadId, threadStatus, reason, adminActorPhone } = params;
    if (!threadId) return { ok: false, status: "error", error: "ThreadID required" };
    if (!threadStatus) return { ok: false, status: "error", error: "ThreadStatus required" };

    const threadRow = await getChatThreadRow(threadId);
    if (!threadRow) return { ok: false, status: "error", error: "Thread not found" };

    const nowIso = new Date().toISOString();
    const { error } = await adminSupabase
      .from("chat_threads")
      .update({
        thread_status: threadStatus.toLowerCase(),
        moderation_reason: reason || null,
        last_moderated_at: nowIso,
        last_moderated_by: adminActorPhone || null,
        updated_at: nowIso,
      })
      .eq("thread_id", threadId);

    if (error) return { ok: false, status: "error", error: error.message };
    return { ok: true, status: "success" };
  } catch (error) {
    return {
      ok: false,
      status: "error",
      error: error instanceof Error ? error.message : "Failed to update chat thread status",
    };
  }
}

export async function sendChatMessageFromSupabase(
  data: Record<string, unknown>
): Promise<ChatSendMessageActionPayload> {
  try {
    const threadId = trimString(data.ThreadID || data.threadId);
    const messageText = trimString(data.MessageText || data.messageText);
    const messageType = trimString(data.MessageType || data.messageType || "text").toLowerCase();

    if (!threadId) return { ok: false, status: "error", error: "ThreadID required" };
    if (!messageText) return { ok: false, status: "error", error: "MessageText required" };
    if (messageText.length > 2000) {
      return { ok: false, status: "error", error: "MessageText too long" };
    }
    if (messageType !== "text") {
      return { ok: false, status: "error", error: "Only text messages are supported" };
    }

    const actor = await resolveChatActor(data);
    if (!actor.ok) return { ok: false, status: "error", error: actor.error };

    const threadRow = await getChatThreadRow(threadId);
    if (!threadRow) return { ok: false, status: "error", error: "Thread not found" };
    if (!canChatActorAccessThread(actor, threadRow)) {
      return { ok: false, status: "error", error: "Access denied" };
    }

    const effectiveThreadStatus = getEffectiveThreadStatus(threadRow);
    if (effectiveThreadStatus === "closed") {
      return { ok: false, status: "error", error: "Thread is closed" };
    }
    if (effectiveThreadStatus === "locked") {
      return { ok: false, status: "error", error: "This thread has been locked by admin." };
    }

    const nowIso = new Date().toISOString();
    const messageId = buildMessageId();
    const insertedMessage = {
      message_id: messageId,
      thread_id: trimString(threadRow.thread_id),
      task_id: trimString(threadRow.task_id),
      sender_type: actor.actorType,
      sender_phone:
        actor.actorType === "user"
          ? normalizePhone10(threadRow.user_phone)
          : normalizePhone10(actor.providerPhone || threadRow.provider_phone),
      sender_name: actor.senderName,
      message_text: messageText,
      message_type: "text",
      created_at: nowIso,
      read_by_user: actor.actorType === "user" ? "yes" : "no",
      read_by_provider: actor.actorType === "provider" ? "yes" : "no",
      moderation_status: "clear",
      flag_reason: "",
      contains_blocked_word: "no",
    };

    const { error: insertError } = await adminSupabase.from("chat_messages").insert(insertedMessage);
    if (insertError) {
      return { ok: false, status: "error", error: insertError.message };
    }

    const threadUpdates = {
      updated_at: nowIso,
      last_message_at: nowIso,
      last_message_by: actor.actorType,
      unread_user_count:
        actor.actorType === "provider"
          ? Number(threadRow.unread_user_count || 0) + 1
          : Number(threadRow.unread_user_count || 0),
      unread_provider_count:
        actor.actorType === "user"
          ? Number(threadRow.unread_provider_count || 0) + 1
          : Number(threadRow.unread_provider_count || 0),
    };

    const { error: updateError } = await adminSupabase
      .from("chat_threads")
      .update(threadUpdates)
      .eq("thread_id", threadId);

    if (updateError) {
      return { ok: false, status: "error", error: updateError.message };
    }

    const updatedThreadRow = await getChatThreadRow(threadId);
    if (!updatedThreadRow) {
      return { ok: false, status: "error", error: "Thread not found" };
    }

    await runChatNotificationSideEffects(updatedThreadRow, actor);

    return {
      ok: true,
      status: "success",
      thread: await mapThreadRow(updatedThreadRow),
      message: mapMessageRow(insertedMessage),
    };
  } catch (error) {
    return {
      ok: false,
      status: "error",
      error: error instanceof Error ? error.message : "Failed to send chat message",
    };
  }
}

// ─── Need-chat persistence ────────────────────────────────────────────────────

type NeedChatThreadRow = {
  thread_id: string;
  need_id: string;
  poster_phone: string;
  responder_phone: string;
  status: string | null;
  created_at: string;
  updated_at: string;
  last_message_at: string | null;
  last_message_by: string | null;
  unread_poster_count: number;
  unread_responder_count: number;
};

type NeedChatMessageRow = {
  message_id: string;
  thread_id: string;
  need_id: string;
  sender_role: string;
  sender_phone: string;
  message_text: string;
  created_at: string;
  read_by_poster: string;
  read_by_responder: string;
};

type NeedChatThreadPayload = {
  ThreadID: string;
  NeedID: string;
  PosterPhone: string;
  ResponderPhone: string;
  Status: string;
  LastMessageAt: string;
};

type NeedChatMessagePayload = {
  MessageID: string;
  SenderRole: string;
  MessageText: string;
  CreatedAt: string;
};

export type NeedChatMessagesActionPayload =
  | { ok: true; status: "success"; thread: NeedChatThreadPayload; messages: NeedChatMessagePayload[] }
  | { ok: false; status: "error"; error: string };

export type NeedChatMarkReadActionPayload =
  | { ok: true; status: "success" }
  | { ok: false; status: "error"; error: string };

export type NeedChatSendMessageActionPayload =
  | { ok: true; status: "success"; thread: NeedChatThreadPayload; message: NeedChatMessagePayload }
  | { ok: false; status: "error"; error: string };

async function getNeedChatThreadRow(threadId: string): Promise<NeedChatThreadRow | null> {
  const { data, error } = await adminSupabase
    .from("need_chat_threads")
    .select("*")
    .eq("thread_id", threadId)
    .single();
  if (error || !data) return null;
  return data as NeedChatThreadRow;
}

function mapNeedChatThreadRow(row: NeedChatThreadRow): NeedChatThreadPayload {
  return {
    ThreadID: trimString(row.thread_id),
    NeedID: trimString(row.need_id),
    PosterPhone: normalizePhone10(row.poster_phone),
    ResponderPhone: normalizePhone10(row.responder_phone),
    Status: trimString(row.status || "active"),
    LastMessageAt: formatChatTimestamp(row.last_message_at),
  };
}

function mapNeedChatMessageRow(row: NeedChatMessageRow): NeedChatMessagePayload {
  return {
    MessageID: trimString(row.message_id),
    SenderRole: trimString(row.sender_role),
    MessageText: trimString(row.message_text),
    CreatedAt: formatChatTimestamp(row.created_at),
  };
}

function canNeedChatActorAccessThread(
  actorRole: string,
  userPhone10: string,
  thread: NeedChatThreadRow
): boolean {
  if (actorRole === "poster") return normalizePhone10(thread.poster_phone) === userPhone10;
  if (actorRole === "responder") return normalizePhone10(thread.responder_phone) === userPhone10;
  return false;
}

export async function getNeedChatMessagesFromSupabase(
  data: Record<string, unknown>
): Promise<NeedChatMessagesActionPayload> {
  try {
    const threadId = trimString(String(data.ThreadID || ""));
    const actorRole = trimString(String(data.ActorRole || "")).toLowerCase();
    const userPhone10 = normalizePhone10(String(data.UserPhone || ""));

    if (!threadId) return { ok: false, status: "error", error: "ThreadID required" };
    if (actorRole !== "poster" && actorRole !== "responder") {
      return { ok: false, status: "error", error: "ActorRole must be poster or responder" };
    }
    if (!userPhone10) return { ok: false, status: "error", error: "UserPhone required" };

    const threadRow = await getNeedChatThreadRow(threadId);
    if (!threadRow) return { ok: false, status: "error", error: "Thread not found" };
    if (!canNeedChatActorAccessThread(actorRole, userPhone10, threadRow)) {
      return { ok: false, status: "error", error: "Access denied" };
    }

    const { data: messageRows, error } = await adminSupabase
      .from("need_chat_messages")
      .select("*")
      .eq("thread_id", threadId)
      .order("created_at", { ascending: true });

    if (error) return { ok: false, status: "error", error: error.message };

    return {
      ok: true,
      status: "success",
      thread: mapNeedChatThreadRow(threadRow),
      messages: (messageRows ?? []).map((r) => mapNeedChatMessageRow(r as NeedChatMessageRow)),
    };
  } catch (error) {
    return {
      ok: false,
      status: "error",
      error: error instanceof Error ? error.message : "Failed to get need chat messages",
    };
  }
}

export async function markNeedChatReadFromSupabase(
  data: Record<string, unknown>
): Promise<NeedChatMarkReadActionPayload> {
  try {
    const threadId = trimString(String(data.ThreadID || ""));
    const actorRole = trimString(String(data.ActorRole || "")).toLowerCase();
    const userPhone10 = normalizePhone10(String(data.UserPhone || ""));

    if (!threadId) return { ok: false, status: "error", error: "ThreadID required" };
    if (actorRole !== "poster" && actorRole !== "responder") {
      return { ok: false, status: "error", error: "ActorRole must be poster or responder" };
    }
    if (!userPhone10) return { ok: false, status: "error", error: "UserPhone required" };

    const threadRow = await getNeedChatThreadRow(threadId);
    if (!threadRow) return { ok: false, status: "error", error: "Thread not found" };
    if (!canNeedChatActorAccessThread(actorRole, userPhone10, threadRow)) {
      return { ok: false, status: "error", error: "Access denied" };
    }

    const nowIso = new Date().toISOString();

    if (actorRole === "poster") {
      await adminSupabase
        .from("need_chat_messages")
        .update({ read_by_poster: "yes" })
        .eq("thread_id", threadId)
        .eq("read_by_poster", "no");
      await adminSupabase
        .from("need_chat_threads")
        .update({ unread_poster_count: 0, updated_at: nowIso })
        .eq("thread_id", threadId);
    } else {
      await adminSupabase
        .from("need_chat_messages")
        .update({ read_by_responder: "yes" })
        .eq("thread_id", threadId)
        .eq("read_by_responder", "no");
      await adminSupabase
        .from("need_chat_threads")
        .update({ unread_responder_count: 0, updated_at: nowIso })
        .eq("thread_id", threadId);
    }

    return { ok: true, status: "success" };
  } catch (error) {
    return {
      ok: false,
      status: "error",
      error: error instanceof Error ? error.message : "Failed to mark need chat read",
    };
  }
}

export async function sendNeedChatMessageFromSupabase(
  data: Record<string, unknown>
): Promise<NeedChatSendMessageActionPayload> {
  try {
    const threadId = trimString(String(data.ThreadID || ""));
    const actorRole = trimString(String(data.ActorRole || "")).toLowerCase();
    const userPhone10 = normalizePhone10(String(data.UserPhone || ""));
    const messageText = trimString(String(data.MessageText || ""));

    if (!threadId) return { ok: false, status: "error", error: "ThreadID required" };
    if (actorRole !== "poster" && actorRole !== "responder") {
      return { ok: false, status: "error", error: "ActorRole must be poster or responder" };
    }
    if (!userPhone10) return { ok: false, status: "error", error: "UserPhone required" };
    if (!messageText) return { ok: false, status: "error", error: "MessageText required" };

    const threadRow = await getNeedChatThreadRow(threadId);
    if (!threadRow) return { ok: false, status: "error", error: "Thread not found" };
    if (!canNeedChatActorAccessThread(actorRole, userPhone10, threadRow)) {
      return { ok: false, status: "error", error: "Access denied" };
    }

    const nowIso = new Date().toISOString();
    const messageId = buildMessageId();
    const insertedMessage: NeedChatMessageRow = {
      message_id: messageId,
      thread_id: trimString(threadRow.thread_id),
      need_id: trimString(threadRow.need_id),
      sender_role: actorRole,
      sender_phone: userPhone10,
      message_text: messageText,
      created_at: nowIso,
      read_by_poster: actorRole === "poster" ? "yes" : "no",
      read_by_responder: actorRole === "responder" ? "yes" : "no",
    };

    const { error: insertError } = await adminSupabase
      .from("need_chat_messages")
      .insert(insertedMessage);
    if (insertError) return { ok: false, status: "error", error: insertError.message };

    const threadUpdates = {
      updated_at: nowIso,
      last_message_at: nowIso,
      last_message_by: actorRole,
      unread_poster_count:
        actorRole === "responder"
          ? Number(threadRow.unread_poster_count || 0) + 1
          : Number(threadRow.unread_poster_count || 0),
      unread_responder_count:
        actorRole === "poster"
          ? Number(threadRow.unread_responder_count || 0) + 1
          : Number(threadRow.unread_responder_count || 0),
    };

    const { error: updateError } = await adminSupabase
      .from("need_chat_threads")
      .update(threadUpdates)
      .eq("thread_id", threadId);
    if (updateError) return { ok: false, status: "error", error: updateError.message };

    const updatedThreadRow = await getNeedChatThreadRow(threadId);
    if (!updatedThreadRow) return { ok: false, status: "error", error: "Thread not found after update" };

    return {
      ok: true,
      status: "success",
      thread: mapNeedChatThreadRow(updatedThreadRow),
      message: mapNeedChatMessageRow(insertedMessage),
    };
  } catch (error) {
    return {
      ok: false,
      status: "error",
      error: error instanceof Error ? error.message : "Failed to send need chat message",
    };
  }
}

// ─── Need-chat GAS sync helpers ───────────────────────────────────────────────

export async function getNeedChatThreadsForNeedFromSupabase(
  needId: string,
  userPhone: string
): Promise<NeedChatThreadRow[]> {
  const safeNeedId = trimString(needId);
  const phone10 = normalizePhone10(userPhone);
  const phone91 = phone10 ? `91${phone10}` : "";

  if (!safeNeedId || !phone10) return [];

  const { data, error } = await adminSupabase
    .from("need_chat_threads")
    .select("*")
    .eq("need_id", safeNeedId)
    .or(`poster_phone.eq.${phone10},poster_phone.eq.${phone91}`)
    .order("last_message_at", { ascending: false })
    .order("updated_at", { ascending: false });

  if (error || !data) return [];
  return data as NeedChatThreadRow[];
}

async function getNeedChatThreadByNeedAndResponder(
  needId: string,
  responderPhone10: string
): Promise<NeedChatThreadRow | null> {
  const { data, error } = await adminSupabase
    .from("need_chat_threads")
    .select("*")
    .eq("need_id", needId)
    .limit(20);
  if (error || !data) return null;
  return (
    (data as NeedChatThreadRow[]).find(
      (r) => normalizePhone10(r.responder_phone) === responderPhone10
    ) ?? null
  );
}

export async function findNeedChatThreadByNeedAndResponder(
  needId: string,
  responderPhoneRaw: string
): Promise<NeedChatThreadPayload | null> {
  const responderPhone10 = normalizePhone10(String(responderPhoneRaw || ""));
  if (!needId || !responderPhone10) return null;
  try {
    const row = await getNeedChatThreadByNeedAndResponder(needId, responderPhone10);
    if (!row) return null;
    return mapNeedChatThreadRow(row);
  } catch {
    return null;
  }
}

export async function createOrGetNeedChatThreadFromSupabase(
  needId: string,
  responderPhoneRaw: string
): Promise<
  | { ok: true; status: "success"; created: boolean; thread: NeedChatThreadPayload }
  | { ok: false; status: "error"; error: string }
> {
  const safeNeedId = trimString(needId);
  const responderPhone10 = normalizePhone10(String(responderPhoneRaw || ""));

  if (!safeNeedId) return { ok: false, status: "error", error: "NeedID required" };
  if (!responderPhone10) return { ok: false, status: "error", error: "ResponderPhone required" };

  // Return existing thread if already in Supabase
  const existing = await findNeedChatThreadByNeedAndResponder(safeNeedId, responderPhone10);
  if (existing) {
    return { ok: true, status: "success", created: false, thread: existing };
  }

  // Look up poster_phone from the needs table (Supabase — fully migrated)
  const { data: needRow, error: needError } = await adminSupabase
    .from("needs")
    .select("user_phone")
    .eq("need_id", safeNeedId)
    .maybeSingle();

  if (needError) return { ok: false, status: "error", error: needError.message };
  if (!needRow) return { ok: false, status: "error", error: "Need not found" };

  const posterPhone10 = normalizePhone10(String(needRow.user_phone || ""));
  if (!posterPhone10) return { ok: false, status: "error", error: "Need has no poster phone" };

  const nowIso = new Date().toISOString();
  const threadId = buildThreadId();

  const { error: insertError } = await adminSupabase
    .from("need_chat_threads")
    .insert({
      thread_id: threadId,
      need_id: safeNeedId,
      poster_phone: posterPhone10,
      responder_phone: responderPhone10,
      status: "active",
      created_at: nowIso,
      updated_at: nowIso,
      last_message_at: null,
      last_message_by: null,
      unread_poster_count: 0,
      unread_responder_count: 0,
    });

  if (insertError) return { ok: false, status: "error", error: insertError.message };

  const newThreadRow = await getNeedChatThreadRow(threadId);
  if (!newThreadRow) return { ok: false, status: "error", error: "Thread created but not retrievable" };

  return { ok: true, status: "success", created: true, thread: mapNeedChatThreadRow(newThreadRow) };
}

export async function syncNeedChatThreadFromGasPayload(
  gasThread: Record<string, unknown>
): Promise<void> {
  const threadId = trimString(String(gasThread.ThreadID || ""));
  const needId = trimString(String(gasThread.NeedID || ""));
  if (!threadId || !needId) return;

  await adminSupabase.from("need_chat_threads").upsert(
    {
      thread_id: threadId,
      need_id: needId,
      poster_phone: normalizePhone10(String(gasThread.PosterPhone || "")),
      responder_phone: normalizePhone10(String(gasThread.ResponderPhone || "")),
      status: trimString(String(gasThread.Status || "active")) || "active",
      created_at: parseChatTimestamp(gasThread.CreatedAt) || new Date().toISOString(),
      updated_at: parseChatTimestamp(gasThread.UpdatedAt) || new Date().toISOString(),
      last_message_at: parseChatTimestamp(gasThread.LastMessageAt) || null,
      last_message_by: trimString(String(gasThread.LastMessageBy || "")) || null,
      unread_poster_count: Number(gasThread.UnreadPosterCount) || 0,
      unread_responder_count: Number(gasThread.UnreadResponderCount) || 0,
    },
    { onConflict: "thread_id" }
  );
}

export async function syncNeedChatSnapshotFromGasPayload(
  payload: unknown
): Promise<void> {
  if (!payload || typeof payload !== "object") return;
  const p = payload as Record<string, unknown>;

  const gasThread =
    p.thread && typeof p.thread === "object" ? (p.thread as Record<string, unknown>) : null;
  if (!gasThread) return;

  await syncNeedChatThreadFromGasPayload(gasThread);

  const messages = Array.isArray(p.messages) ? p.messages : [];
  if (messages.length === 0) return;

  const threadId = trimString(String(gasThread.ThreadID || ""));
  const needId = trimString(String(gasThread.NeedID || ""));
  if (!threadId || !needId) return;

  const rows = messages
    .filter((m): m is Record<string, unknown> => Boolean(m && typeof m === "object"))
    .map((m) => {
      const messageId = trimString(String(m.MessageID || ""));
      if (!messageId) return null;
      return {
        message_id: messageId,
        thread_id: threadId,
        need_id: needId,
        sender_role: trimString(String(m.SenderRole || "")).toLowerCase(),
        sender_phone: normalizePhone10(String(m.SenderPhone || "")),
        message_text: trimString(String(m.MessageText || "")),
        created_at: parseChatTimestamp(m.CreatedAt) || new Date().toISOString(),
        read_by_poster:
          trimString(String(m.ReadByPoster || "no")).toLowerCase() === "yes" ? "yes" : "no",
        read_by_responder:
          trimString(String(m.ReadByResponder || "no")).toLowerCase() === "yes" ? "yes" : "no",
      };
    })
    .filter((row): row is NonNullable<typeof row> => row !== null);

  if (rows.length > 0) {
    await adminSupabase
      .from("need_chat_messages")
      .upsert(rows, { onConflict: "message_id" });
  }
}
