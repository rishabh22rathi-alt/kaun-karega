# Admin Migration — Slice 5 Notes

**Date:** 2026-04-19  
**Goal:** Replace the last GAS dependency in `/api/admin/stats` by migrating `categoryApplications` / `pendingCategoryRequests` to Supabase. After this slice, `/api/admin/stats` has zero GAS dependency.

---

## Files Changed

| File | Type | Change |
|---|---|---|
| `web/lib/admin/adminDashboardStats.ts` | **Updated** | Replaced `getCategoryApplicationsFromGAS()` with `getCategoryApplicationsFromSupabase()`; removed all GAS code from this file |

`app/api/admin/stats/route.ts` — no change needed; it already calls `getAdminDashboardStats()`.

---

## Exact Fields Required by the Dashboard

The admin dashboard (`app/admin/dashboard/page.tsx`) reads these fields per `CategoryApplication` row:

| Field | Displayed | Used in mutation |
|---|---|---|
| `RequestID` | Yes — row key, table cell | Yes — sent as `requestId` in all mutation payloads |
| `ProviderName` | Yes — table cell | No |
| `Phone` | Yes — table cell | No |
| `RequestedCategory` | Yes — table cell | Yes — sent as `categoryName` in approve payload |
| `Status` | Yes — badge | Yes — filtered to `"pending"` for the pending list |
| `CreatedAt` | Yes — table cell | No |
| `ProviderID` | No | No (optional, stored for future use) |
| `AdminActionBy` | No | No (optional, stored for audit) |
| `AdminActionAt` | No | No (optional, stored for audit) |
| `AdminActionReason` | No | No (optional, stored for audit) |

---

## Supabase Table Required

### Create Statement

Run this in the Supabase SQL editor for project `ovloeohrjmhrisjhykwj`:

```sql
CREATE TABLE IF NOT EXISTS pending_category_requests (
  request_id          TEXT        PRIMARY KEY,
  provider_id         TEXT,
  provider_name       TEXT        NOT NULL DEFAULT '',
  phone               TEXT        NOT NULL DEFAULT '',
  requested_category  TEXT        NOT NULL DEFAULT '',
  status              TEXT        NOT NULL DEFAULT 'pending',
  -- status values: pending | approved | rejected | closed | archived | deleted_by_admin
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  admin_action_by     TEXT,
  admin_action_at     TIMESTAMPTZ,
  admin_action_reason TEXT
);

-- Service role only — no public or anon access needed.
ALTER TABLE pending_category_requests ENABLE ROW LEVEL SECURITY;
```

### Column Mapping from GAS PendingCategories Sheet

| GAS Sheet Column | Supabase Column | Notes |
|---|---|---|
| `RequestID` | `request_id` | PK — keep same value |
| `ProviderID` | `provider_id` | optional |
| `ProviderName` | `provider_name` | |
| `Phone` | `phone` | keep as-is (10-digit or 12-digit format from sheet) |
| `RequestedCategory` | `requested_category` | |
| `Status` | `status` | lowercase: `pending`, `approved`, etc. |
| `CreatedAt` | `created_at` | parse as ISO timestamp |
| `AdminActionBy` | `admin_action_by` | nullable |
| `AdminActionAt` | `admin_action_at` | nullable ISO timestamp |
| `AdminActionReason` | `admin_action_reason` | nullable |

---

## Seed / Backfill from GAS

Export the `PendingCategories` sheet from spreadsheet `1xCgM4HnsnYj7XEH6786urLH-V2SmOdmi6koijia_zQo` as CSV and run:

```sql
-- Example seed — adjust values from the exported sheet
INSERT INTO pending_category_requests
  (request_id, provider_id, provider_name, phone, requested_category, status, created_at, admin_action_by, admin_action_at, admin_action_reason)
VALUES
  ('REQ-001', 'PR-001', 'Ramesh Kumar', '9876543210', 'Plumbing', 'pending', '2025-01-15T10:30:00Z', NULL, NULL, NULL),
  ('REQ-002', 'PR-002', 'Suresh Babu', '9123456789', 'Electrical', 'approved', '2025-01-20T14:00:00Z', 'Admin', '2025-01-21T09:00:00Z', 'Meets requirements')
ON CONFLICT (request_id) DO NOTHING;
```

Rows with `status != 'pending'` (approved, rejected, closed, archived) are historical — include them for audit completeness but they won't appear in the dashboard pending list.

---

## Is `/api/admin/stats` Now Fully Backend-Native?

**Yes.** After this slice:

| Data | Source |
|---|---|
| `providers` list | Supabase `providers` + `provider_services` + `provider_areas` |
| `categories` list | Supabase `categories` |
| `categoryApplications` list | Supabase `pending_category_requests` |
| `stats.totalProviders` | Derived from Supabase providers |
| `stats.verifiedProviders` | Derived from Supabase providers |
| `stats.pendingAdminApprovals` | Derived from Supabase providers |
| `stats.pendingCategoryRequests` | Derived from Supabase `pending_category_requests` |

`lib/admin/adminDashboardStats.ts` contains **no GAS code** after this slice. The `APPS_SCRIPT_URL` env var is no longer referenced in this file.

---

## What Still Depends on GAS After Slice 5

| Feature | GAS dependency | Notes |
|---|---|---|
| Admin auth (per-request guard) | GAS fallback only | `verifyAdminViaGAS` fires only if Supabase admins table is empty/unseeded |
| Admin login flow | GAS fallback only | Same — via `verifyAdminByPhone()` |
| Category request mutations | **Yes — active** | `approve_category_request`, `reject_category_request`, `admin_close_*`, etc. all go through `/api/kk` → GAS |
| All other admin data actions | **Yes — active** | Providers, areas, tasks, chat, notifications, etc. all still via `/api/kk` → GAS |

---

## Recommended Next Slice (Slice 6)

**Remove the GAS auth fallback** (seeds `admins` table → `TODO(admin-slice-4-remove-gas-login-fallback)`).

This is lower risk than migrating mutations and removes GAS from the auth path permanently:
1. Create + seed the `admins` table (SQL in `docs/admin-slice-2-notes.md`).
2. Verify admin login works end-to-end via Supabase.
3. Remove `verifyAdminViaGAS()` call from `verifyAdminByPhone()` in `lib/admin/adminVerifier.ts`.
4. Remove the `verifyAdminViaGAS()` function.
5. Remove `APPS_SCRIPT_URL` reference from `adminVerifier.ts`.

After Slice 6: GAS is only used for admin data mutations. The auth path is fully GAS-free.
