# Admin Migration — Slice 22 Notes

**Date:** 2026-04-19  
**Goal:** Replace the two direct GAS calls in `app/open-chat/page.tsx` with existing Supabase-native helpers. No new helpers needed — both `getProviderByPhoneFromSupabase` (Slice 21) and `getChatThreadsFromSupabase` (chatPersistence) already exist.

---

## Files Changed

| File | Type | Change |
|---|---|---|
| `web/app/open-chat/page.tsx` | **Updated** | Removed `APPS_SCRIPT_URL`, `fetchAppsScriptJson`, `lookupProviderByPhone`, `lookupThreads`, local response types. Replaced with direct calls to `getProviderByPhoneFromSupabase` and `getChatThreadsFromSupabase`. |
| `web/docs/admin-slice-22-notes.md` | **New** | This file |

---

## Direct GAS Calls Removed

| Function removed | GAS payload | Replacement |
|---|---|---|
| `lookupProviderByPhone(phone10)` | `POST APPS_SCRIPT_URL { action: "get_provider_by_phone", phone }` | `getProviderByPhoneFromSupabase(sessionPhone)` from `lib/admin/adminProviderReads` |
| `lookupThreads(actorType, phone10)` | `POST APPS_SCRIPT_URL { action: "chat_get_threads", ActorType, [loggedInProviderPhone\|UserPhone] }` | `getChatThreadsFromSupabase({ ActorType, [loggedInProviderPhone\|UserPhone] })` from `lib/chat/chatPersistence` |

Also removed: `APPS_SCRIPT_URL` constant, `fetchAppsScriptJson` helper, local `ProviderLookupResponse`, `ChatThread`, `ChatThreadsResponse` types — all now unused.

`normalizePhone10` kept — still needed for phone normalization from session.

---

## Old Flow

```
Server component renders:
  1. getAuthSession() → sessionPhone (10-digit)
  2. lookupProviderByPhone(sessionPhone)
       → POST APPS_SCRIPT_URL { action: "get_provider_by_phone", phone: sessionPhone }
       → GAS reads Providers sheet
       → { ok: true, provider: { ProviderID, Phone } } or { ok: false }
       → if ok === true → actorType = "provider"
  3. lookupThreads(actorType, sessionPhone)
       → POST APPS_SCRIPT_URL { action: "chat_get_threads", ActorType, [loggedInProviderPhone|UserPhone] }
       → GAS reads Chat Threads sheet
       → { ok: true, threads: [{ ThreadID, LastMessageAt, ... }] }
       → if threads[0].ThreadID → redirect to /chat/thread/:threadId
  4. fallback → redirect to /provider/dashboard or /dashboard/my-requests
```

---

## New Flow

```
Server component renders:
  1. getAuthSession() → sessionPhone (10-digit)
  2. getProviderByPhoneFromSupabase(sessionPhone)
       → adminSupabase.from("providers").select(...).or("phone.eq.XXXXXXXXXX,phone.eq.91XXXXXXXXXX")
       → { ok: true, provider: { ... } } or { ok: false, error }
       → if ok === true → actorType = "provider"
  3. getChatThreadsFromSupabase({ ActorType, [loggedInProviderPhone|UserPhone] })
       → resolveChatActor(data) → actor
       → adminSupabase.from("chat_threads").select(...).eq("user_phone"|"provider_id", ...)
       → { ok: true, threads: ChatThreadPayload[] } or { ok: false, error }
       → if threads[0].ThreadID → redirect to /chat/thread/:threadId
  4. fallback → redirect to /provider/dashboard or /dashboard/my-requests
```

---

## Data Contracts Preserved

### Provider lookup — only field consumed

| Old field | New field | Source |
|---|---|---|
| `providerLookup?.ok === true && providerLookup.provider` | `providerLookup.ok === true` | Supabase `providers` table |

The page only checks presence (`ok === true`) — it does not read `ProviderID`, `Phone`, or any other field. The new response shape (`ProviderByPhonePayload`) satisfies this check identically.

### Thread lookup — only field consumed

| Old field | New field | Source |
|---|---|---|
| `threads[0]?.ThreadID` (string) | `threadsPayload.threads[0]?.ThreadID` (string) | Supabase `chat_threads` table |

`ChatThreadPayload.ThreadID` is a `string` — exact match to what the old `ChatThread.ThreadID` provided.

### Redirect logic — unchanged

| Condition | Redirect |
|---|---|
| No session phone | `/login?next=/open-chat` |
| Has thread, actorType = "user" | `/chat/thread/:threadId?actor=user` |
| Has thread, actorType = "provider" | `/chat/thread/:threadId` |
| No thread, actorType = "provider" | `/provider/dashboard` |
| No thread, actorType = "user" | `/dashboard/my-requests` |

---

## Known Behavioral Difference

The old page read threads from GAS (authoritative for all historical threads). The new page reads from Supabase. For users who have GAS-era threads that have never been hydrated into Supabase (i.e., were created before the chat migration and have never been accessed through `/api/kk` which triggers hydration), the thread list will be empty and the page will redirect to dashboard instead of to their most recent thread.

This is the same bounded regression present across all chat migration slices. Any user who has accessed their chat after the migration will have their threads in Supabase. The fallback (dashboard redirect) is a safe degradation — no data is lost and the user can navigate to their thread from the dashboard.

---

## Is open-chat Now GAS-Free?

**Yes.** `app/open-chat/page.tsx` no longer imports or references `APPS_SCRIPT_URL`. It makes no GAS calls on any path.

---

## What Still Depends on GAS After Slice 22

| Feature / Caller | GAS dependency |
|---|---|
| `app/api/report-issue/route.ts` | Direct `GET APPS_SCRIPT_URL?action=get_provider_by_phone` (for reporter role detection) |
| Area / alias management | `/api/kk` → GAS (all area CRUD actions) |
| Team management | `/api/kk` → GAS |
| Issue reports (`admin_get_issue_reports`, `admin_update_issue_report_status`) | `/api/kk` → GAS |
| Needs management (`admin_get_needs`, `admin_close_need`, etc.) | `/api/kk` → GAS |
| i-need chat (`need_chat_*`) | `/api/kk` → GAS |
| Chat hydration fallbacks (7 branches in route.ts) | GAS (intentional, not main-path) |

---

## Recommended Next Slice

**Slice 23 — Migrate `app/api/report-issue/route.ts` off direct GAS for provider lookup.**

`report-issue/route.ts` makes one direct GAS call — `GET APPS_SCRIPT_URL?action=get_provider_by_phone&phone=...` — to determine whether the reporter is a provider. `getProviderByPhoneFromSupabase` already exists. The fix is replacing the `getReporterRoleAndName` helper's GAS fetch with a call to `getProviderByPhoneFromSupabase`. The rest of the route (submitting the issue to GAS) is still GAS-dependent and out of scope.
