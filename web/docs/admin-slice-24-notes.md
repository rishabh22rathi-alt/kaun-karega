# Admin Migration — Slice 24 Notes

**Date:** 2026-04-19  
**Goal:** Intercept `need_chat_get_messages`, `need_chat_mark_read`, and `need_chat_send_message` in `/api/kk` so they read/write from Supabase instead of forwarding to GAS. A GAS passthrough fallback is kept for "Thread not found" (threads created before this migration).

---

## Files Changed

| File | Type | Change |
|---|---|---|
| `web/lib/chat/chatPersistence.ts` | **Updated** | Added need-chat row types, payload types, private helpers, and three public functions |
| `web/app/api/kk/route.ts` | **Updated** | Imported three new functions; added POST intercepts for three need_chat actions |
| `web/docs/admin-slice-24-notes.md` | **New** | This file |

---

## Schema Prerequisites

Two new Supabase tables are required before this slice is deployed. Run in Supabase SQL editor:

```sql
CREATE TABLE IF NOT EXISTS public.need_chat_threads (
  thread_id            TEXT PRIMARY KEY,
  need_id              TEXT NOT NULL,
  poster_phone         TEXT NOT NULL DEFAULT '',
  responder_phone      TEXT NOT NULL DEFAULT '',
  status               TEXT NOT NULL DEFAULT 'active',
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_message_at      TIMESTAMPTZ NULL,
  last_message_by      TEXT NULL,
  unread_poster_count  INTEGER NOT NULL DEFAULT 0,
  unread_responder_count INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS public.need_chat_messages (
  message_id      TEXT PRIMARY KEY,
  thread_id       TEXT NOT NULL REFERENCES public.need_chat_threads (thread_id) ON DELETE CASCADE,
  need_id         TEXT NOT NULL,
  sender_role     TEXT NOT NULL,
  sender_phone    TEXT NOT NULL DEFAULT '',
  message_text    TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  read_by_poster  TEXT NOT NULL DEFAULT 'no',
  read_by_responder TEXT NOT NULL DEFAULT 'no'
);
```

---

## Actions Migrated

| Action | Transport | Handler |
|---|---|---|
| `need_chat_get_messages` | `POST /api/kk { action, ThreadID, ActorRole, UserPhone }` | `getNeedChatMessagesFromSupabase(body)` |
| `need_chat_mark_read` | `POST /api/kk { action, ThreadID, ActorRole, UserPhone }` | `markNeedChatReadFromSupabase(body)` |
| `need_chat_send_message` | `POST /api/kk { action, ThreadID, ActorRole, UserPhone, MessageText }` | `sendNeedChatMessageFromSupabase(body)` |

---

## GAS Passthrough Fallback

All three intercepts fall back to GAS when the Supabase result is `{ ok: false, error: "Thread not found" }`. This covers need-chat threads that exist in GAS but have never been written to Supabase (pre-migration threads).

`need_chat_create_or_get_thread` (thread creation) is **not** in scope for this slice — it remains on GAS. This means new threads continue to be created in GAS, and the passthrough fallback covers all existing threads until a thread-creation migration is done.

---

## Old Flow

```
POST /api/kk { action: "need_chat_get_messages", ThreadID, ActorRole, UserPhone }
  → forwarded to APPS_SCRIPT_URL
  → GAS reads need_chat_threads + need_chat_messages
  → { ok: true, thread: { ThreadID, NeedID, PosterPhone, ResponderPhone, ... }, messages: [...] }

POST /api/kk { action: "need_chat_mark_read", ThreadID, ActorRole, UserPhone }
  → forwarded to APPS_SCRIPT_URL (fire-and-forget on client)
  → GAS marks messages read

POST /api/kk { action: "need_chat_send_message", ThreadID, ActorRole, UserPhone, MessageText }
  → forwarded to APPS_SCRIPT_URL
  → GAS inserts message, updates thread
  → { ok: true, thread: NeedChatThread, message: NeedChatMessage }
```

---

## New Flow

```
POST /api/kk { action: "need_chat_get_messages", ThreadID, ActorRole, UserPhone }
  → intercepted in /api/kk POST handler
  → getNeedChatMessagesFromSupabase(body)
      → adminSupabase.from("need_chat_threads").select("*").eq("thread_id", ThreadID)
      → verify ActorRole + UserPhone matches poster_phone or responder_phone
      → adminSupabase.from("need_chat_messages").select("*").eq("thread_id", ThreadID).order("created_at")
      → { ok: true, thread: NeedChatThreadPayload, messages: NeedChatMessagePayload[] }
  → if "Thread not found" → GAS passthrough

POST /api/kk { action: "need_chat_mark_read", ThreadID, ActorRole, UserPhone }
  → intercepted → markNeedChatReadFromSupabase(body)
      → mark unread messages read (read_by_poster or read_by_responder = "yes")
      → reset unread_poster_count or unread_responder_count = 0 on thread
      → { ok: true }
  → if "Thread not found" → GAS passthrough

POST /api/kk { action: "need_chat_send_message", ThreadID, ActorRole, UserPhone, MessageText }
  → intercepted → sendNeedChatMessageFromSupabase(body)
      → insert into need_chat_messages
      → update need_chat_threads (last_message_at, unread counts)
      → { ok: true, thread: NeedChatThreadPayload, message: NeedChatMessagePayload }
  → if "Thread not found" → GAS passthrough
```

---

## Response Contracts Preserved

### `need_chat_get_messages`

```typescript
{
  ok: true,
  thread: {
    ThreadID: string, NeedID: string, PosterPhone: string, ResponderPhone: string,
    Status: string, LastMessageAt: string
  },
  messages: [{ MessageID: string, SenderRole: string, MessageText: string, CreatedAt: string }]
}
```

### `need_chat_mark_read`

Fire-and-forget on client (`void fetch(...)`). Response shape not consumed. Returns `{ ok: true }`.

### `need_chat_send_message`

```typescript
{
  ok: true,
  thread: NeedChatThreadPayload,
  message: { MessageID: string, SenderRole: string, MessageText: string, CreatedAt: string }
}
```

---

## Auth / Access Control

The Supabase intercept enforces identity by comparing `UserPhone` (10-digit normalized) against `poster_phone` or `responder_phone` in the thread row, depending on `ActorRole`. Both phones are stored with `normalizePhone10` at send time. Access is denied if the phone does not match.

---

## What Still Depends on GAS After Slice 24

| Feature / Caller | GAS dependency |
|---|---|
| `need_chat_create_or_get_thread` | `/api/kk` → GAS — thread creation not migrated |
| Area / alias management | `/api/kk` → GAS |
| Team management | `/api/kk` → GAS |
| Issue report storage + admin reads | `/api/kk` → GAS |
| Needs management (`admin_get_needs`, etc.) | `/api/kk` → GAS |
| i-need chat (for pre-migration threads) | GAS passthrough fallback in all 3 actions |
| Regular chat hydration fallbacks (7 branches) | GAS (intentional, not main-path) |

---

## Recommended Next Slice

**Slice 25 — Migrate `need_chat_create_or_get_thread`** off GAS. Once threads are created in Supabase the passthrough fallback in this slice becomes dead code for all new conversations. Schema is already in place from this slice.
