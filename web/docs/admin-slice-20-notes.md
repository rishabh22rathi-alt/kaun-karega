# Admin Migration — Slice 20 Notes

**Date:** 2026-04-19  
**Goal:** Migrate open-chat thread loading and `admin_update_chat_thread_status` to Supabase-native paths via `chatPersistence.ts`. After this slice, no chat action proxies to GAS.

---

## Files Changed

| File | Type | Change |
|---|---|---|
| `web/lib/chat/chatPersistence.ts` | **Updated** | Added `updateChatThreadStatusFromSupabase()` + `UpdateChatThreadStatusPayload` type |
| `web/app/api/kk/route.ts` | **Updated** | Added import + intercept for `admin_update_chat_thread_status` |

---

## Context: What Was Already Migrated Before Slice 20

The following chat actions were already intercepted in `route.ts` via `chatPersistence.ts` before this slice:

| Action | Handler |
|---|---|
| `chat_get_threads` | `getChatThreadsFromSupabase` |
| `chat_create_or_get_thread` | `createOrGetChatThreadFromSupabase` |
| `chat_get_messages` | `getChatMessagesFromSupabase` |
| `chat_mark_read` | `markChatReadFromSupabase` |
| `chat_send_message` | `sendChatMessageFromSupabase` |
| `admin_list_chat_threads` / `get_admin_chat_threads` | `getAdminChatThreadsFromSupabase` |
| `admin_get_chat_thread` | `getAdminChatThreadFromSupabase` |

Slice 20 adds the one remaining missing action: `admin_update_chat_thread_status`.

---

## Action Migrated

| Action | Handler function | Fields written |
|---|---|---|
| `admin_update_chat_thread_status` | `updateChatThreadStatusFromSupabase()` | `chat_threads.thread_status`, `moderation_reason`, `last_moderated_at`, `last_moderated_by`, `updated_at` |

---

## Old Flow

```
POST /api/kk { action: "admin_update_chat_thread_status", ThreadID, ThreadStatus, Reason, AdminActorPhone }
  → GAS APPS_SCRIPT_URL
  → GAS updates chat thread status in Chat Threads sheet
  → { ok: true/false }
```

---

## New Flow

```
POST /api/kk { action: "admin_update_chat_thread_status", ThreadID, ThreadStatus, Reason, AdminActorPhone }
  → intercepted (auth guard already applied via ADMIN_ONLY_ACTIONS)
  → updateChatThreadStatusFromSupabase({ threadId, threadStatus, reason, adminActorPhone })
      → getChatThreadRow(threadId) — returns 404 error if thread not found
      → adminSupabase.from("chat_threads").update({
          thread_status: threadStatus.toLowerCase(),
          moderation_reason: reason || null,
          last_moderated_at: now(),
          last_moderated_by: adminActorPhone || null,
          updated_at: now()
        }).eq("thread_id", threadId)
  → { ok: true, status: "success" } | { ok: false, status: "error", error }
```

---

## Request Fields

| Field | Type | Required | Notes |
|---|---|---|---|
| `ThreadID` | string | Yes | The chat thread to update |
| `ThreadStatus` | string | Yes | New status — "closed", "locked", "active", "flagged", "muted" |
| `Reason` | string | No | Moderation reason — stored as `moderation_reason` |
| `AdminActorPhone` | string | No | Phone of the admin performing the action — stored as `last_moderated_by` |

---

## Response Contract Preserved

`{ ok: boolean, error?: string }` — unchanged from GAS behavior.

---

## Table / Columns Updated

| Table | Column | Behavior |
|---|---|---|
| `chat_threads` | `thread_status` | Set to `ThreadStatus.toLowerCase()` |
| `chat_threads` | `moderation_reason` | Set to `Reason` (or null if empty) |
| `chat_threads` | `last_moderated_at` | Set to server timestamp |
| `chat_threads` | `last_moderated_by` | Set to `AdminActorPhone` (or null if empty) |
| `chat_threads` | `updated_at` | Set to server timestamp |

---

## Auth Guard

`admin_update_chat_thread_status` is in `ADMIN_ONLY_ACTIONS` — the existing `requireAdminSession()` check fires before the body is parsed. No auth changes required.

---

## Callers

| Caller | Action | Trigger |
|---|---|---|
| `app/admin/chats/page.tsx` | `admin_update_chat_thread_status` | "Close Chat" button on thread list |
| `app/admin/chats/[threadId]/page.tsx` | `admin_update_chat_thread_status` | "Close Chat" button on thread detail |

Both callers only set `ThreadStatus: "closed"` — the function is generic and handles any valid status value.

---

## What Still Depends on GAS After Slice 20

| Feature | GAS dependency |
|---|---|
| Admin auth, stats | No |
| Category admin (all actions) | No |
| Provider admin (all actions) | No |
| Task mutations (assign, close) | No — Supabase (Slice 11) |
| Admin task list read | No — Supabase (Slice 12) |
| Chat reads (threads, messages) | **No — Supabase (pre-Slice 20)** |
| Chat writes (send, mark read) | **No — Supabase (pre-Slice 20)** |
| Admin chat list + detail | **No — Supabase (pre-Slice 20)** |
| Admin chat status update | **No — Supabase (Slice 20)** |
| Area / alias management | Yes |
| Notification logs | Yes |
| Issue reports | Yes |
| Team management | Yes |
