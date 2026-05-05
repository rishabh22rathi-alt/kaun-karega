# Admin Slice 12 Notes

**Goal:** Migrate the admin task read action used by the dashboard off Google Apps Script while preserving the current `/api/kk` contract and frontend behavior.

## Files Changed

| File | Change | Purpose |
|---|---|---|
| `web/app/api/kk/route.ts` | Updated | Intercepts `get_admin_requests` and `admin_get_requests` before the GAS proxy |
| `web/lib/admin/adminTaskReads.ts` | Reworked | Loads admin task reads from Supabase and shapes the legacy response payload |
| `docs/admin-slice-12-notes.md` | Added | Records Slice 12 scope and outcomes |

## Exact Task Read Action Migrated

- Primary real frontend action: `get_admin_requests`
- Alias also migrated for parity: `admin_get_requests`

Both now resolve in `/api/kk` without proxying the main read path to GAS.

## Old Flow

```txt
Admin dashboard / provider chat
  → POST /api/kk { action: "get_admin_requests" }
  → /api/kk proxied to APPS_SCRIPT_URL
  → GAS Backend.js
  → getAdminRequests_()
  → response returned through /api/kk
```

## New Flow

```txt
Admin dashboard / provider chat
  → POST /api/kk { action: "get_admin_requests" } or { action: "admin_get_requests" }
  → /api/kk intercepts locally
  → getAdminRequestsFromSupabase()
  → Supabase queries tasks + provider_task_matches + providers
  → /api/kk returns the legacy-shaped payload directly
```

## Response Contract Preserved

The Supabase path now returns the same top-level envelope currently exposed by `/api/kk` for this action:

```json
{
  "ok": true,
  "status": "success",
  "requests": [...],
  "metrics": {...},
  "data": {
    "ok": true,
    "status": "success",
    "requests": [...],
    "metrics": {...}
  },
  "error": null
}
```

Per-request rows remain sorted by `CreatedAt` descending and preserve the existing admin dashboard fields, including:

- `TaskID`, `DisplayID`, `UserPhone`
- `Category`, `Area`, `Details`
- `Status`, `RawStatus`
- `CreatedAt`, `NotifiedAt`, `ProviderResponseAt`, `CompletedAt`
- `AssignedProvider`, `AssignedProviderName`
- `RespondedProvider`, `RespondedProviderName`
- `SelectedTimeframe`, `Priority`, `Deadline`
- `IsOverdue`, `IsExpired`, `NeedsAttention`
- `AttentionThresholdMinutes`, `MinutesUntilDeadline`, `OverdueMinutes`
- `WaitingMinutes`, `ResponseWaitingMinutes`
- `MatchedProviders`, `MatchedProviderDetails`

## Tables / Joins Used

| Table | Columns used | Purpose |
|---|---|---|
| `tasks` | `task_id`, `display_id`, `category`, `area`, `details`, `phone`, `status`, `created_at`, `selected_timeframe`, `service_date`, `time_slot`, `assigned_provider_id`, `closed_at` | Base admin request rows |
| `provider_task_matches` | `task_id`, `provider_id`, `match_status`, `created_at` | Notified/matched/responded provider state |
| `providers` | `provider_id`, `full_name`, `phone`, `verified` | Provider names/details for assigned/responded/matched rows |

No extra joins were added beyond what the current task card contract requires.

## GAS Status

- Admin task reads for `get_admin_requests` / `admin_get_requests` are now GAS-free on the main `/api/kk` path.
- Other admin task-related actions still touching GAS: `admin_remind_providers` / `remind_providers`
- Slice 11 read/write divergence is resolved for assignment and closure because both writes and the dashboard reload path now read Supabase-backed task state.

## Immediate Dashboard Behavior

- After `assign_provider`, `fetchAdminRequests()` now reloads Supabase-backed task rows.
- After `close_request`, `fetchAdminRequests()` now reloads Supabase-backed task rows.
- This means assignment/closure should now reflect immediately in the admin dashboard, assuming the Slice 11 schema columns already exist:
  - `tasks.assigned_provider_id`
  - `tasks.closed_at`

## Notes / Limits

- The requested `docs/admin-slice-11-notes.md` file was not present at the repo root during inspection; the existing Slice 11 notes live at `web/docs/admin-slice-11-notes.md`.
- Some GAS-only fields still do not have first-class Supabase columns, so they are derived or defaulted narrowly:
  - `NotifiedAt` is inferred from the earliest `provider_task_matches.created_at`
  - `MatchedProviderDetails.OtpVerified`, `OtpVerifiedAt`, and `PendingApproval` are returned as conservative defaults because those values are not sourced in this slice
  - `LastReminderAt` remains blank because reminder log state was not migrated in this slice

## Next Recommended Slice

Migrate `admin_remind_providers` / `remind_providers` off GAS, because task reads and assign/close writes are now aligned in Supabase and reminder dispatch is the next remaining task-management action still coupled to Apps Script.
