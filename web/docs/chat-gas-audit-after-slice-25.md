# Chat GAS Dependency Audit — After Slice 25

**Date:** 2026-04-19  
**Scope:** All chat-related actions across all surfaces. Excludes area/alias, team, needs management, and issue reports (separate audit track).

---

## Normal Chat Actions

| Action | Entry point | Main path | GAS fallback? | Notes |
|---|---|---|---|---|
| `chat_create_or_get_thread` | `POST /api/kk` | **Supabase-native** | Yes — hydrates threads from GAS if none found in Supabase | Slice 20 |
| `chat_get_threads` | `POST /api/kk` | **Supabase-native** | Yes — hydrates threads from GAS if empty result | Slice 20 |
| `chat_get_messages` | `POST /api/kk` | **Supabase-native** | Yes — hydrates snapshot from GAS if Thread not found | Slice 20 |
| `chat_mark_read` | `POST /api/kk` | **Supabase-native** | Yes — hydrates snapshot from GAS if Thread not found | Slice 20 |
| `chat_send_message` | `POST /api/kk` | **Supabase-native** | Yes — hydrates snapshot from GAS if Thread not found | Slice 20 |
| `admin_list_chat_threads` / `get_admin_chat_threads` | `POST /api/kk` | **Supabase-native** | Yes — hydrates threads from GAS if empty result | Slice 20 |
| `admin_get_chat_thread` | `POST /api/kk` | **Supabase-native** | Yes — hydrates snapshot from GAS if Thread not found | Slice 20 |
| `admin_update_chat_thread_status` | `POST /api/kk` | **Supabase-native** | No | Slice 20 |
| `close_chat_thread` | `POST /api/kk` | **Supabase-native** | No | Slice 21 |

### Normal Chat — Direct Page GAS Calls

None. `app/open-chat/page.tsx` (Slice 22) and `app/api/report-issue/route.ts` (Slice 23) were both migrated off direct GAS calls.

### Normal Chat — Legacy Hydration Fallbacks

7 fallback branches exist in `/api/kk/route.ts`:
1. `chat_create_or_get_thread` — hydrates threads if no existing thread matches
2. `chat_get_threads` — hydrates threads if Supabase returns 0
3. `chat_get_messages` — hydrates snapshot if Thread not found
4. `chat_mark_read` — hydrates snapshot if Thread not found
5. `chat_send_message` — hydrates snapshot if Thread not found
6. `admin_list_chat_threads` — hydrates threads if Supabase returns 0
7. `admin_get_chat_thread` — hydrates snapshot if Thread not found

These are all **intentional**: they cover chat threads created in GAS before the Slice 20 migration. They are self-healing — once GAS data is synced into Supabase, the fallback never fires again for that thread.

---

## i-need Chat Actions

| Action | Entry point | Main path | GAS fallback? | Notes |
|---|---|---|---|---|
| `need_chat_create_or_get_thread` | `POST /api/kk` | **Supabase-native** for existing threads | Yes — GAS for new threads (need validation + PosterPhone lookup). Thread is synced into Supabase after creation. | Slice 25 |
| `need_chat_get_messages` | `POST /api/kk` | **Supabase-native** | Yes — GAS passthrough + sync (thread + messages) if Thread not found | Slice 24 + 25 |
| `need_chat_mark_read` | `POST /api/kk` | **Supabase-native** | Yes — GAS passthrough + sync (thread) if Thread not found | Slice 24 + 25 |
| `need_chat_send_message` | `POST /api/kk` | **Supabase-native** | Yes — GAS passthrough + sync (thread) if Thread not found | Slice 24 + 25 |
| `need_chat_get_threads_for_need` | `POST /api/kk` | **GAS passthrough** | — | Not intercepted |

### i-need Chat — Direct Page GAS Calls

None. `app/i-need/chat/[threadId]/page.tsx` and `app/i-need/respond/[needId]/page.tsx` both call through `/api/kk`.

### i-need Chat — Fallback Behavior Detail

**`need_chat_create_or_get_thread`:**
- If thread exists in Supabase → return from Supabase (no GAS)
- If thread not in Supabase → call GAS (validates need status + gets PosterPhone) → sync result into Supabase → return GAS response

**`need_chat_get_messages` / `need_chat_mark_read` / `need_chat_send_message`:**
- Thread found in Supabase → fully native (no GAS)
- Thread not found → GAS fallback → on success, sync thread (and all messages for `get_messages`) into Supabase → return GAS response
- After first sync: all subsequent calls are fully native

---

## Remaining GAS-Dependent Modules (Corrected)

### Chat surfaces — GAS-free on main path

- `app/open-chat/page.tsx` — fully native (Slice 22)
- `app/api/report-issue/route.ts` — provider lookup is native; issue submit still GAS (in scope, separate action)
- `app/chat/[taskId]/page.tsx` — fully native (Slices 20–21)
- `app/chat/thread/[threadId]/page.tsx` — fully native (Slices 20–21)
- `app/i-need/chat/[threadId]/page.tsx` — fully native for Supabase threads (Slices 24–25)
- `app/i-need/respond/[needId]/page.tsx` — native for existing threads; GAS for new threads (Slice 25)
- Admin chat management — fully native (Slices 20–21)

### Chat surfaces — still GAS-dependent

- `need_chat_create_or_get_thread` — new thread creation calls GAS (needs PosterPhone from GAS needs data)
- `need_chat_get_threads_for_need` — full GAS passthrough (not intercepted)

### Non-chat GAS-dependent modules

- **Area/alias management** — `/api/kk` → GAS (all area CRUD actions)
- **Team management** — `/api/kk` → GAS
- **Issue report storage + admin reads** — `/api/kk` → GAS (`admin_get_issue_reports`, `admin_update_issue_report_status`, `submit_issue_report` in `report-issue/route.ts`)
- **Needs management** — `/api/kk` → GAS (`admin_get_needs`, `admin_close_need`, `admin_hide_need`, `admin_unhide_need`, `admin_set_need_rank`, `get_needs`, `get_my_needs`, `post_need`, `mark_need_complete`, `close_need`)
- **Normal chat legacy hydration** — 7 fallback branches in `/api/kk` (intentional, self-healing for pre-migration threads)
- **Need-chat legacy hydration** — 3 fallback branches in `/api/kk` (self-healing, narrowed in Slice 25)

---

## Recommendation

### Should the normal-chat legacy hydration fallback be removed next?

**No — not yet.** The hydration fallbacks are safe to leave in place. They cost nothing unless an old GAS-only thread is accessed, and each hit self-heals by syncing into Supabase. Removing them requires confidence that zero GAS-only threads remain, which can only be verified from production data (compare GAS thread IDs vs. Supabase). This is a one-time cleanup task that belongs after a production data audit, not as a development slice.

### Recommended next slice

**Slice 26 — Intercept `need_chat_get_threads_for_need`.**

This is the last unintercepted i-need chat action. The Supabase query is: `need_chat_threads WHERE need_id = ? AND poster_phone IN (phone10, 91phone10)`. No needs lookup required — `poster_phone` is already in the thread row. GAS fallback is still needed for old threads; however the GAS response for this action omits `PosterPhone`, so syncing is not possible. After Slice 26, all five i-need chat actions are intercepted and the main path is Supabase-native.

**After Slice 26**, the remaining highest-value target is **needs management** (`get_needs`, `get_my_needs`, `post_need`, admin needs actions). This requires a `needs` Supabase table. That migration would also unblock removing the GAS call in `need_chat_create_or_get_thread` (currently needed for PosterPhone lookup and status validation).

---

## Summary Table

| Surface | GAS-free on main path? | Fallback remaining? |
|---|---|---|
| Normal chat (user ↔ provider) | **Yes** | Legacy hydration (7 branches, self-healing) |
| Admin chat management | **Yes** | None |
| i-need chat — get/mark/send | **Yes** | Pre-migration hydration (3 branches, self-healing) |
| i-need chat — create/get thread | **Partial** — native for existing threads | GAS for new threads (PosterPhone constraint) |
| i-need chat — get threads for need | **No** | Full GAS passthrough |
| Issue submission | **No** | — |
| Needs management | **No** | — |
| Area/alias management | **No** | — |
| Team management | **No** | — |
