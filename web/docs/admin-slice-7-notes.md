# Admin Migration — Slice 7 Notes

**Date:** 2026-04-19  
**Goal:** Migrate provider verification/approval and block/unblock mutations off Google Apps Script. All provider status mutations are now backed by Supabase.

---

## Files Changed

| File | Type | Change |
|---|---|---|
| `web/lib/admin/adminProviderMutations.ts` | **New** | Backend-native helpers: `setProviderVerified()`, `setProviderBlockStatus()` |
| `web/app/api/kk/route.ts` | **Updated** | Intercepts `set_provider_verified` action before GAS proxy; returns Supabase result |
| `web/app/api/admin/providers/block/route.ts` | **New** | `POST /api/admin/providers/block` — sets `providers.status = "Blocked"` |
| `web/app/api/admin/providers/unblock/route.ts` | **New** | `POST /api/admin/providers/unblock` — sets `providers.status = "Active"` |
| `web/lib/api/providers.ts` | **Updated** | `blockProvider()` and `unblockProvider()` now call new Next.js routes instead of GAS |

---

## Mutations Migrated

### 1. `set_provider_verified` (dashboard verify/approve/reject)

**Old flow:**
```
POST /api/kk { action: "set_provider_verified", providerId, verified }
  → GAS APPS_SCRIPT_URL
  → GAS sets Providers sheet
  → { ok: true/false }
```

**New flow:**
```
POST /api/kk { action: "set_provider_verified", providerId, verified }
  → setProviderVerified(providerId, verified)    ← intercepted in /api/kk before GAS
      → adminSupabase.from("providers").update(...)
      → verified = "yes": sets verified = "yes", status = "active"
      → verified = "no":  sets verified = "no"; transitions status pending → rejected
  → { ok: true } | { ok: false, error }
```

**Response contract preserved:** `{ ok: boolean, error?: string }` — unchanged.

### 2. `blockProvider` / `unblockProvider` (provider profile page)

**Old flow:**
```
lib/api/providers.ts blockProvider(id)
  → appsScriptPost("providers/block", { id })
      → fetch GAS directly with ?path=providers/block
      → GAS sets provider blocked
      → { status: "Blocked" }
```

**New flow:**
```
lib/api/providers.ts blockProvider(id)
  → fetch POST /api/admin/providers/block { id }
      → requireAdminSession() guard
      → setProviderBlockStatus(id, true)
          → adminSupabase.from("providers").update({ status: "Blocked" })
      → { status: "Blocked" }
```

**Response contract preserved:** `{ status: ProviderStatus }` where `ProviderStatus = "Active" | "Pending" | "Blocked"` — unchanged.

---

## Status Transition Logic

| Action | verified field | status field |
|---|---|---|
| Approve provider (verified = "yes") | → `"yes"` | → `"active"` |
| Reject provider (verified = "no", was pending) | → `"no"` | `"pending"` → `"rejected"` |
| Toggle unverify (verified = "no", not pending) | → `"no"` | unchanged |
| Block provider | unchanged | → `"Blocked"` |
| Unblock provider | unchanged | → `"Active"` |

`PendingApproval` in the dashboard is derived as `status.toLowerCase() === "pending"`. After approve/reject, `status` is no longer "pending", so `PendingApproval` correctly becomes `"no"` on the next data refresh.

---

## Auth Guard

| Route | Guard |
|---|---|
| `POST /api/kk` (set_provider_verified) | `requireAdminSession()` via `ADMIN_ONLY_ACTIONS` set (pre-existing) |
| `POST /api/admin/providers/block` | `requireAdminSession()` — explicit guard in route |
| `POST /api/admin/providers/unblock` | `requireAdminSession()` — explicit guard in route |

---

## Failure Modes

| Condition | Result |
|---|---|
| `provider_id` not in `providers` table | `{ ok: true }` / `{ status }` — Supabase updates 0 rows silently |
| Supabase returns error | `{ ok: false, error }` / HTTP 500 |
| Missing required field (`providerId` / `id`) | HTTP 400 |
| Not authenticated | HTTP 401 |

---

## What Still Depends on GAS After Slice 7

| Feature | GAS dependency |
|---|---|
| Admin auth | **No — fully Supabase** |
| Dashboard stats | **No — fully Supabase** |
| Provider verify/approve/reject | **No — fully Supabase** |
| Provider block/unblock | **No — fully Supabase** |
| Provider reads (getProviderById, getAllProviders) | Yes — `lib/api/providers.ts` still uses GAS |
| Category request mutations (approve/reject/close) | Yes — `/api/kk` → GAS |
| All other admin data actions | Yes — `/api/kk` → GAS |

---

## Recommended Next Slice (Slice 8)

**Migrate category request mutations off GAS.**

Actions: `approve_category_request`, `reject_category_request`, `admin_close_category_request`, `admin_archive_category_request`, `admin_delete_category_request_soft`.

Why next:
- `pending_category_requests` table already exists in Supabase (created in Slice 5).
- Mutations only update `status`, `admin_action_by`, `admin_action_at`, `admin_action_reason` on existing rows.
- Approving also creates a row in `categories` — that table is already in Supabase.
- Removes the last high-value mutation group from the GAS dependency in the admin dashboard.
