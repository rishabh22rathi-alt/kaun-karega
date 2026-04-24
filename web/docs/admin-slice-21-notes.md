# Admin Migration — Slice 21 Notes

**Date:** 2026-04-19  
**Goal:** Remove the remaining direct GAS dependency on the normal chat entry and chat close paths by intercepting `get_provider_by_phone` and `close_chat_thread` in `/api/kk`.

---

## Files Changed

| File | Type | Change |
|---|---|---|
| `web/lib/admin/adminProviderReads.ts` | **Updated** | Added `getProviderByPhoneFromSupabase()` + `ProviderByPhonePayload` type |
| `web/app/api/kk/route.ts` | **Updated** | Import `getProviderByPhoneFromSupabase`; added GET intercept for `get_provider_by_phone`; added POST intercept for `close_chat_thread` |
| `web/docs/admin-slice-21-notes.md` | **New** | This file |

---

## Actions Migrated

| Action | Transport | Handler |
|---|---|---|
| `get_provider_by_phone` | `GET /api/kk?action=get_provider_by_phone&phone=...` | `getProviderByPhoneFromSupabase(phone)` |
| `close_chat_thread` | `POST /api/kk { action: "close_chat_thread", ThreadID }` | `updateChatThreadStatusFromSupabase({ threadId, threadStatus: "closed" })` |

---

## Callers Audited

### `get_provider_by_phone` — callers through `/api/kk` (now Supabase-native):

| Caller | Fields consumed |
|---|---|
| `app/chat/[taskId]/page.tsx` | `provider.Phone` — provider identity before opening thread |
| `app/chat/thread/[threadId]/page.tsx` | `provider.Phone` — trusted phone for send/read |
| `app/provider/register/page.tsx` (pre-fill) | `provider.ProviderName`, `provider.Services[].Category`, `provider.Areas[].Area` |
| `app/provider/register/page.tsx` (post-register) | `provider.ProviderID`, `provider.Name`, `provider.Phone`, `provider.Verified`, `provider.PendingApproval`, `provider.Status` → stored in localStorage |
| `components/Sidebar.tsx` | Boolean check only (`data.ok === true && data.provider`) |

### `get_provider_by_phone` — callers that bypass `/api/kk` (still GAS, out of scope):

| Caller | How it calls GAS |
|---|---|
| `app/open-chat/page.tsx` | Direct `POST APPS_SCRIPT_URL` via `fetchAppsScriptJson()` |
| `app/api/report-issue/route.ts` | Direct `GET APPS_SCRIPT_URL?action=get_provider_by_phone` |

### `close_chat_thread` — no active UI callers

`close_chat_thread` is listed in `ADMIN_ONLY_ACTIONS` but no page in `app/` or `components/` calls it. Admin chat closing goes through `admin_update_chat_thread_status` (Slice 20). The intercept is implemented so any external call or future caller goes to Supabase rather than GAS.

---

## Old Flows

```
GET /api/kk?action=get_provider_by_phone&phone=XXXXXXXXXX
  → GAS APPS_SCRIPT_URL?action=get_provider_by_phone&phone=...
  → GAS reads Providers sheet
  → { ok: true, provider: { ProviderID, ProviderName, Phone, Verified, Status, Services, Areas, ... } }

POST /api/kk { action: "close_chat_thread", ThreadID }
  → GAS APPS_SCRIPT_URL
  → GAS closes chat thread in Chat Threads sheet
  → { ok: true/false }
```

---

## New Flows

```
GET /api/kk?action=get_provider_by_phone&phone=XXXXXXXXXX
  → intercepted in /api/kk GET handler (no auth required — public endpoint)
  → getProviderByPhoneFromSupabase(phone)
      → normalize phone to 10 digits
      → adminSupabase.from("providers").select(...).or("phone.eq.XXXXXXXXXX,phone.eq.91XXXXXXXXXX")
      → find row where phone.slice(-10) === phone10
      → if not found → { ok: false, error: "Provider not found" }
      → parallel: provider_services + provider_areas queries
      → { ok: true, provider: { ProviderID, ProviderName, Name, Phone, Verified, PendingApproval, Status, Services, Areas } }

POST /api/kk { action: "close_chat_thread", ThreadID, [Reason], [AdminActorPhone] }
  → auth check (close_chat_thread is in ADMIN_ONLY_ACTIONS)
  → intercepted in /api/kk POST handler
  → updateChatThreadStatusFromSupabase({ threadId, threadStatus: "closed", reason, adminActorPhone })
      → getChatThreadRow(threadId) — 500 if not found
      → adminSupabase.from("chat_threads").update({
          thread_status: "closed",
          moderation_reason, last_moderated_at, last_moderated_by, updated_at
        }).eq("thread_id", threadId)
  → { ok: true } | { ok: false, error }
```

---

## Response Contracts Preserved

### `get_provider_by_phone` — success

```typescript
{
  ok: true,
  provider: {
    ProviderID: string,       // providers.provider_id
    ProviderName: string,     // providers.full_name
    Name: string,             // alias — same as ProviderName (for localStorage compat)
    Phone: string,            // 10-digit, last 10 of stored phone
    Verified: string,         // providers.verified ("yes"/"no")
    PendingApproval: string,  // "yes" if status === "pending", else "no"
    Status: string,           // normalizeStatus() → "Active"/"Pending"/"Blocked"
    Services: [{ Category: string }],  // from provider_services
    Areas: [{ Area: string }],         // from provider_areas
  }
}
```

### `get_provider_by_phone` — not found

```typescript
{ ok: false, error: "Provider not found" }
```

### `close_chat_thread`

```typescript
{ ok: true } | { ok: false, error: string }
```

---

## Phone Normalization

Input `phone` may be 10 or 12 digits. DB stores `91XXXXXXXXXX` (12 digits). Query uses:
```sql
phone.eq.XXXXXXXXXX OR phone.eq.91XXXXXXXXXX
```
Result row is matched by `.slice(-10)` comparison so either format works.

---

## Normal Chat Entry Path: GAS-Free After Slice 21?

| Path | GAS-free? |
|---|---|
| `app/chat/[taskId]/page.tsx` load (provider identity) | **Yes** — `get_provider_by_phone` now Supabase-native |
| `app/chat/[taskId]/page.tsx` → `chat_create_or_get_thread` | Yes (Slice 20) |
| `app/chat/thread/[threadId]/page.tsx` load (provider identity) | **Yes** — `get_provider_by_phone` now Supabase-native |
| `app/chat/thread/[threadId]/page.tsx` → `chat_get_messages` / `chat_send_message` / `chat_mark_read` | Yes (Slice 20) — main path; hydration fallback remains |
| Admin chat list / detail | Yes (Slices 20) |
| Admin chat status update | Yes (Slice 20) |
| `close_chat_thread` | **Yes** — now Supabase-native (was GAS, now intercepted) |

The chat entry hydration fallbacks (for old unsynced threads) remain intentionally — they are not main-path GAS calls.

---

## What Still Depends on GAS After Slice 21

| Feature / Caller | GAS dependency |
|---|---|
| `app/open-chat/page.tsx` | Direct `POST APPS_SCRIPT_URL` for `get_provider_by_phone` + `chat_get_threads` |
| `app/api/report-issue/route.ts` | Direct `GET APPS_SCRIPT_URL?action=get_provider_by_phone` |
| Area / alias management | `/api/kk` → GAS (all area CRUD actions) |
| Team management | `/api/kk` → GAS |
| Issue reports (`admin_get_issue_reports`, `admin_update_issue_report_status`) | `/api/kk` → GAS |
| Needs management (`admin_get_needs`, `admin_close_need`, etc.) | `/api/kk` → GAS |
| i-need chat (`need_chat_*`) | `/api/kk` → GAS |
| Chat hydration fallbacks (7 branches) | GAS (intentional, not main-path) |

---

## Recommended Next Slice

**Slice 22 — Migrate `open-chat/page.tsx` off GAS**

`open-chat/page.tsx` is a server component that:
1. Calls `POST APPS_SCRIPT_URL` directly for `get_provider_by_phone` → can reuse `getProviderByPhoneFromSupabase`
2. Calls `POST APPS_SCRIPT_URL` directly for `chat_get_threads` → already native in `chatPersistence.ts`

Both Supabase helpers already exist. Migration is a direct replacement of the two `fetchAppsScriptJson` calls with the Supabase-native equivalents.
