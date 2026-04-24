# Admin Migration — Slice 8 Notes

**Date:** 2026-04-19  
**Goal:** Migrate all five category request mutation actions off GAS. After this slice, no category approval/reject action touches GAS.

---

## Files Changed

| File | Type | Change |
|---|---|---|
| `web/lib/admin/adminCategoryMutations.ts` | **New** | Backend-native helpers for all 5 category request actions |
| `web/app/api/kk/route.ts` | **Updated** | Intercepts all 5 category actions before GAS proxy; returns Supabase result |

---

## Actions Migrated

| Action | Handler function |
|---|---|
| `approve_category_request` | `approveCategoryRequest()` |
| `reject_category_request` | `rejectCategoryRequest()` |
| `admin_close_category_request` | `closeCategoryRequest()` |
| `admin_archive_category_request` | `archiveCategoryRequest()` |
| `admin_delete_category_request_soft` | `softDeleteCategoryRequest()` |

---

## Old Flow

```
POST /api/kk { action: "approve_category_request", requestId, categoryName, AdminActorPhone, AdminActorName, adminActionReason }
  → GAS APPS_SCRIPT_URL
  → GAS updates PendingCategories sheet, inserts into Categories sheet
  → { ok: true/false }

POST /api/kk { action: "reject_category_request", requestId, reason, AdminActorPhone, AdminActorName }
  → GAS APPS_SCRIPT_URL
  → GAS updates PendingCategories sheet status
  → { ok: true/false }
```

---

## New Flow

```
POST /api/kk { action: "approve_category_request", requestId, categoryName, ... }
  → intercepted in /api/kk POST handler (before GAS proxy)
  → approveCategoryRequest(requestId, categoryName, adminActorName, adminActorPhone, reason)
      → adminSupabase.from("categories").upsert({ name, active: true }, { onConflict: "name", ignoreDuplicates: true })
      → adminSupabase.from("pending_category_requests").update({ status: "approved", admin_action_by, admin_action_at, admin_action_reason })
  → { ok: true } | { ok: false, error }

POST /api/kk { action: "reject_category_request", requestId, reason, ... }
  → intercepted in /api/kk POST handler
  → rejectCategoryRequest(...)
      → adminSupabase.from("pending_category_requests").update({ status: "rejected", ... })
  → { ok: true } | { ok: false, error }
```

The GAS proxy is never reached for these 5 actions.

---

## Tables / Columns Updated

### `pending_category_requests`

All 5 actions update these columns:

| Column | Value |
|---|---|
| `status` | `"approved"` / `"rejected"` / `"closed"` / `"archived"` / `"deleted_by_admin"` |
| `admin_action_by` | `AdminActorName` (fallback to `AdminActorPhone`, or null if both absent) |
| `admin_action_at` | `new Date().toISOString()` — server timestamp |
| `admin_action_reason` | reason / adminActionReason from payload (null if empty) |

### `categories`

Only on `approve_category_request`:

| Column | Value |
|---|---|
| `name` | `categoryName` from payload |
| `active` | `true` |

Uses `upsert` with `onConflict: "name", ignoreDuplicates: true` — safe if the category already exists.

---

## Payload Shapes (Preserved Exactly)

### approve_category_request
```typescript
{
  action: "approve_category_request",
  requestId: string,
  categoryName: string,         // category to add/ensure exists
  AdminActorName: string,       // from getAdminActor()
  AdminActorPhone: string,      // from getAdminActor()
  adminActionReason: string,    // "" for approve (no reason required)
}
```

### reject / close / archive / soft-delete
```typescript
{
  action: "reject_category_request" | "admin_close_category_request" | "admin_archive_category_request" | "admin_delete_category_request_soft",
  requestId: string,
  reason: string,               // required — frontend prompts before calling
  AdminActorName: string,
  AdminActorPhone: string,
}
```

---

## Response Contract Preserved

`{ ok: boolean, error?: string }` — unchanged. Frontend checks `!res.ok || !data.ok` and calls `fetchDashboard()` on success.

`fetchDashboard()` calls `GET /api/admin/stats` which is fully Supabase-backed (Slice 5). Updated statuses in `pending_category_requests` and new rows in `categories` are immediately reflected in the next stats load.

---

## Duplicate Category Prevention

`approveCategoryRequest` uses:
```typescript
adminSupabase.from("categories").upsert(
  { name: categoryName, active: true },
  { onConflict: "name", ignoreDuplicates: true }
)
```

Re-approving a request for a category that already exists is safe — the existing row is left unchanged. The pending request status update proceeds regardless.

---

## Auth Guard

These 5 actions are listed in `ADMIN_ONLY_ACTIONS` in `/api/kk/route.ts`. The existing `requireAdminSession()` check fires before the body is parsed — no auth changes required.

---

## Failure Modes

| Condition | Result |
|---|---|
| `requestId` not in `pending_category_requests` | `{ ok: true }` — Supabase updates 0 rows silently |
| `categoryName` missing on approve | HTTP 400 |
| Supabase upsert error on `categories` | `{ ok: false, error }` — request status not updated |
| Supabase update error on `pending_category_requests` | `{ ok: false, error }` |

---

## Category Admin Actions: GAS-Free After Slice 8

| Action | GAS? |
|---|---|
| `approve_category_request` | **No — fully Supabase** |
| `reject_category_request` | **No — fully Supabase** |
| `admin_close_category_request` | **No — fully Supabase** |
| `admin_archive_category_request` | **No — fully Supabase** |
| `admin_delete_category_request_soft` | **No — fully Supabase** |

---

## What Still Depends on GAS After Slice 8

| Feature | GAS dependency |
|---|---|
| Admin auth | **No** |
| Dashboard stats | **No** |
| Provider verify/approve/reject | **No** |
| Provider block/unblock | **No** |
| Category request mutations | **No** |
| Category management (add/edit/toggle) | Yes — `add_category`, `edit_category`, `toggle_category` via `/api/kk` → GAS |
| Provider reads (`getProviderById`) | Yes — `lib/api/providers.ts` → GAS |
| All other admin data actions | Yes — `/api/kk` → GAS |

---

## Recommended Next Slice (Slice 9)

**Migrate category management mutations** (`add_category`, `edit_category`, `toggle_category`).

Why next:
- The `categories` table is already in Supabase and used for reads.
- `add_category` is a simple insert; `edit_category` is a name update; `toggle_category` flips `active`.
- These are low-complexity, table-only operations with no cross-table side effects.
- After this slice, the entire categories section of the admin dashboard is GAS-free.
