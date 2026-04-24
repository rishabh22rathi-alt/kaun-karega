# Admin Migration — Slice 23 Notes

**Date:** 2026-04-19  
**Goal:** Replace the direct GAS provider lookup in `app/api/report-issue/route.ts` with the existing `getProviderByPhoneFromSupabase` helper. Issue submission itself remains on GAS — out of scope.

---

## Files Changed

| File | Type | Change |
|---|---|---|
| `web/app/api/report-issue/route.ts` | **Updated** | Removed `ProviderLookupResponse` type, replaced `getReporterRoleAndName(baseUrl, phone)` GAS fetch with `getProviderByPhoneFromSupabase(phone)` |
| `web/docs/admin-slice-23-notes.md` | **New** | This file |

---

## Direct GAS Call Removed

| Old | New |
|---|---|
| `GET APPS_SCRIPT_URL?action=get_provider_by_phone&phone=session.phone` | `getProviderByPhoneFromSupabase(session.phone)` from `lib/admin/adminProviderReads` |

---

## Old Flow

```
POST /api/report-issue { issueType, issuePage, description }
  1. getAuthSession() → session.phone
  2. getReporterRoleAndName(baseUrl, session.phone)
       → GET APPS_SCRIPT_URL?action=get_provider_by_phone&phone=session.phone
       → GAS reads Providers sheet
       → if ok && provider → { reporterRole: "provider", reporterName: provider.ProviderName }
       → else              → { reporterRole: "user", reporterName: "" }
  3. POST APPS_SCRIPT_URL { action: "submit_issue_report", ReporterPhone, ReporterRole, ReporterName, ... }
  4. → { ok: true, issueId } or { ok: false, error }
```

---

## New Flow

```
POST /api/report-issue { issueType, issuePage, description }
  1. getAuthSession() → session.phone
  2. getReporterRoleAndName(session.phone)
       → getProviderByPhoneFromSupabase(session.phone)
           → adminSupabase.from("providers").select(...).or("phone.eq.XXXXXXXXXX,phone.eq.91XXXXXXXXXX")
           → { ok: true, provider: { ProviderName, Name, ... } } or { ok: false }
       → if ok           → { reporterRole: "provider", reporterName: provider.ProviderName }
       → else            → { reporterRole: "user", reporterName: "" }
  3. POST APPS_SCRIPT_URL { action: "submit_issue_report", ReporterPhone, ReporterRole, ReporterName, ... }  ← unchanged
  4. → { ok: true, issueId } or { ok: false, error }                                                         ← unchanged
```

---

## Behavior Preserved

| Behavior | Preserved? |
|---|---|
| Reporter role = "provider" when phone matches a provider | Yes — `result.ok === true` maps directly |
| Reporter role = "user" as fallback | Yes — `result.ok === false` or exception |
| `reporterName` = `ProviderName \|\| Name` | Yes — `result.provider.ProviderName \|\| result.provider.Name` |
| Exception caught, falls back to user role | Yes — `try/catch` wrapper unchanged |
| `submit_issue_report` POST to GAS | Yes — untouched |
| Route response shape `{ ok, issueId }` | Yes — untouched |

---

## What Remains on GAS for Issue Reports After Slice 23

| Feature | GAS dependency |
|---|---|
| Issue submission (`submit_issue_report`) | Yes — `POST APPS_SCRIPT_URL` in `report-issue/route.ts` |
| Admin issue list (`admin_get_issue_reports`) | Yes — `/api/kk` → GAS |
| Admin issue status update (`admin_update_issue_report_status`) | Yes — `/api/kk` → GAS |

The provider lookup within `report-issue/route.ts` is now GAS-free. The actual issue data storage and admin read path remain on GAS.

---

## What Still Depends on GAS After Slice 23

| Feature / Caller | GAS dependency |
|---|---|
| Issue submission (`submit_issue_report`) | `report-issue/route.ts` → GAS |
| Admin issue list + status update | `/api/kk` → GAS |
| Area / alias management | `/api/kk` → GAS |
| Team management | `/api/kk` → GAS |
| Needs management (`admin_get_needs`, etc.) | `/api/kk` → GAS |
| i-need chat (`need_chat_*`) | `/api/kk` → GAS |
| Chat hydration fallbacks (7 branches) | GAS (intentional, not main-path) |

---

## Recommended Next Slice

**No direct GAS calls remain for any provider lookup anywhere in the codebase** (after Slices 21–23). The remaining GAS dependencies are:
- Area/alias management (needs Supabase area schema)
- Team management
- Issue report storage + admin reads
- Needs management
- i-need chat

The highest-value next target with the least schema work is likely **i-need chat** (`need_chat_get_messages`, `need_chat_mark_read`, `need_chat_send_message`) — a separate chat surface in `app/i-need/chat/[threadId]/page.tsx` that mirrors the main chat actions but uses different action names. The Supabase chat tables and `chatPersistence.ts` helpers already support the full message lifecycle; the migration is adding three intercepts in `route.ts` and verifying the i-need page sends compatible payloads.
