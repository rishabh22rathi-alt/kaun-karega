# Admin Migration — Slice 25 Notes

**Date:** 2026-04-19  
**Goal:** Intercept `need_chat_create_or_get_thread` in `/api/kk` and upgrade the three Slice 24 need-chat fallbacks to self-heal by syncing into Supabase on first GAS hit. After this slice, i-need chat is fully backend-native for all threads created since deployment. Pre-migration GAS-only threads are handled by a self-healing fallback that syncs them into Supabase on first access.

---

## Files Changed

| File | Type | Change |
|---|---|---|
| `web/lib/chat/chatPersistence.ts` | **Updated** | Added `getNeedChatThreadByNeedAndResponder` (private), `findNeedChatThreadByNeedAndResponder`, `syncNeedChatThreadFromGasPayload`, `syncNeedChatSnapshotFromGasPayload` |
| `web/app/api/kk/route.ts` | **Updated** | Added import of 3 new functions; added POST intercept for `need_chat_create_or_get_thread`; upgraded 3 Slice 24 fallbacks with sync |
| `web/docs/admin-slice-25-notes.md` | **New** | This file |
| `web/docs/chat-gas-audit-after-slice-25.md` | **New** | Full chat GAS dependency audit |

---

## New Functions in `chatPersistence.ts`

| Function | Visibility | Purpose |
|---|---|---|
| `getNeedChatThreadByNeedAndResponder(needId, responderPhone10)` | private | DB lookup by (need_id, responder_phone) |
| `findNeedChatThreadByNeedAndResponder(needId, responderPhoneRaw)` | exported | Returns `NeedChatThreadPayload \| null` — used by create-or-get intercept |
| `syncNeedChatThreadFromGasPayload(gasThread)` | exported | Upserts a GAS thread row into `need_chat_threads` |
| `syncNeedChatSnapshotFromGasPayload(payload)` | exported | Upserts thread + all messages from a GAS `need_chat_get_messages` response |

---

## `need_chat_create_or_get_thread` — New Intercept

### Request contract (unchanged)

```
POST /api/kk { action: "need_chat_create_or_get_thread", NeedID, ResponderPhone }
```

Caller: `app/i-need/respond/[needId]/page.tsx` — reads only `data.ok === true` and `data.thread.ThreadID`.

### Logic

```
POST /api/kk { action: "need_chat_create_or_get_thread", NeedID, ResponderPhone }
  1. findNeedChatThreadByNeedAndResponder(NeedID, ResponderPhone)
       → adminSupabase.from("need_chat_threads").select("*").eq("need_id", NeedID)
       → find row where normalizePhone10(responder_phone) === responderPhone10
       → if found → { ok: true, status: "success", created: false, thread: NeedChatThreadPayload }
         (no GAS call — fully native)
  2. if not found → POST APPS_SCRIPT_URL (GAS validates need status, creates thread)
       → if GAS ok → syncNeedChatThreadFromGasPayload(gasThread) → upsert into Supabase
       → return GAS response as-is
```

### Why GAS is still called for new threads

`need_chat_create_or_get_thread` requires `PosterPhone` (the need owner's phone) to store in the thread. The caller only sends `NeedID` and `ResponderPhone`. `PosterPhone` lives in GAS needs data (not yet in Supabase). GAS validates: need exists, is "open", responder ≠ poster. This validation is delegated to GAS until needs are migrated.

After GAS creates the thread and returns the full thread object (including `PosterPhone`), the thread is immediately synced into Supabase. All subsequent requests for that thread (create-or-get + all message actions) are fully Supabase-native.

---

## Slice 24 Fallback Upgrades

The three Slice 24 message action intercepts had a GAS passthrough for "Thread not found" that discarded the GAS response after returning it. They now sync into Supabase after a successful GAS hit:

| Action | Before | After |
|---|---|---|
| `need_chat_get_messages` | GAS passthrough, no sync | GAS passthrough + `syncNeedChatSnapshotFromGasPayload(parsed)` — syncs thread + all messages |
| `need_chat_mark_read` | GAS passthrough, no sync | GAS passthrough + `syncNeedChatThreadFromGasPayload(parsed.thread)` — syncs thread |
| `need_chat_send_message` | GAS passthrough, no sync | GAS passthrough + `syncNeedChatThreadFromGasPayload(parsed.thread)` — syncs thread |

### Self-healing sequence for a pre-migration GAS-only thread

```
1. User opens chat → need_chat_get_messages → Thread not found in Supabase
     → GAS fallback → GAS returns thread + messages
     → syncNeedChatSnapshotFromGasPayload → thread + messages upserted into Supabase
     → GAS response returned to client

2. User marks read → need_chat_mark_read → Thread now found in Supabase
     → native path (no GAS)

3. User sends message → need_chat_send_message → Thread found in Supabase
     → native path (no GAS)

4. User reopens chat → need_chat_get_messages → Thread found in Supabase
     → native path (messages include any sent natively in step 3)
```

After step 1, the thread is permanently in Supabase. Subsequent calls are fully native.

---

## Response Contracts Preserved

| Action | Response | Change |
|---|---|---|
| `need_chat_create_or_get_thread` | `{ ok: true, status: "success", created: bool, thread: NeedChatThreadPayload }` | None — same shape for both Supabase hit and GAS passthrough |
| `need_chat_get_messages` | Unchanged | None |
| `need_chat_mark_read` | Unchanged | None |
| `need_chat_send_message` | Unchanged | None |

---

## What Still Depends on GAS After Slice 25

### i-need chat

| Action | GAS dependency |
|---|---|
| `need_chat_create_or_get_thread` | GAS for **new** threads only (need lookup + validation). Existing Supabase threads: fully native. |
| `need_chat_get_messages` | GAS fallback for pre-migration threads (self-healing: syncs on first hit) |
| `need_chat_mark_read` | GAS fallback for pre-migration threads (self-healing: syncs thread on first hit) |
| `need_chat_send_message` | GAS fallback for pre-migration threads (self-healing: syncs thread on first hit) |
| `need_chat_get_threads_for_need` | GAS passthrough — not intercepted |

### Everything else

See `docs/chat-gas-audit-after-slice-25.md` for a full audit.

---

## Recommended Next Slice

**Slice 26 — Intercept `need_chat_get_threads_for_need`.**

`app/i-need/my-needs/[needId]/responses/page.tsx` calls `need_chat_get_threads_for_need { NeedID, UserPhone }`. The Supabase query is straightforward: `need_chat_threads WHERE need_id = ? AND poster_phone IN (phone10, 91phone10)`. No needs lookup needed — `poster_phone` is already in the thread row. GAS fallback needed for old threads (returns threads without `PosterPhone`, so no sync possible).

After Slice 26, all five i-need chat actions are intercepted. The only remaining GAS calls are the `need_chat_create_or_get_thread` new-thread path (needs `PosterPhone` from GAS) and the pre-migration fallbacks.
