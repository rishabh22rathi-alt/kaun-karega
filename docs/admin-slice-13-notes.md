# Admin Slice 13 Notes

**Goal:** Migrate the admin provider reminder action off Google Apps Script while preserving the current `/api/kk` contract and admin dashboard behavior.

## Files Changed

| File | Change | Purpose |
|---|---|---|
| `web/app/api/kk/route.ts` | Updated | Intercepts `remind_providers` and `admin_remind_providers` before the GAS proxy |
| `web/lib/admin/adminReminderMutations.ts` | Added | Implements the backend-native reminder action against Supabase |
| `docs/admin-slice-13-notes.md` | Added | Records Slice 13 scope and outcomes |

## Exact Reminder Action Migrated

- Primary frontend action: `remind_providers`
- Alias also migrated for parity: `admin_remind_providers`

## Exact Caller Contract

**Route called by frontend**

```txt
POST /api/kk
Content-Type: application/json
Body: { action: "remind_providers", taskId }
```

**Frontend caller**

- `web/app/admin/dashboard/page.tsx`
- `handleRemindProviders(taskId)` posts the action, checks only `!res.ok || !data.ok`, then:
  - calls `fetchAdminRequests()`
  - shows success toast `"Reminder sent to providers"`

**Response shape expected by UI**

- Minimum required by UI: `{ ok: boolean, error?: string }`
- Previous GAS action also returned:
  - `status: "success"`
  - `taskId`
  - `matchedProviders`
  - `placeholderNotificationTriggered: true`
  - `reminderAt`

The backend-native path preserves that richer response shape.

## What GAS Actually Does

From `web/Tasks.js:remindProviders_()` the current action is provably:

1. Validate `taskId`
2. Load the task from admin task state
3. Reuse existing `MatchedProviders` if present
4. If no matches exist:
   - call `matchProviders_(category, area, 20)`
   - call `saveProviderMatches_(...)` when providers are found
5. Update the task row with:
   - `Status: "NOTIFIED"`
   - `notified_at: now`
   - `LastReminderAt: now`
6. Return:
   - `{ ok: true, status: "success", taskId, matchedProviders, placeholderNotificationTriggered: true, reminderAt }`

### Unconfirmed

The older migration inventory described this action as sending WhatsApp reminders and writing notification logs, but that is **not provable from `remindProviders_()` itself**. No direct WhatsApp send or notification-log write appears in that function body.

## Old Flow

```txt
Admin dashboard
  → POST /api/kk { action: "remind_providers", taskId }
  → /api/kk proxied to APPS_SCRIPT_URL
  → GAS Backend.js
  → remindProviders_()
  → response returned through /api/kk
```

## New Flow

```txt
Admin dashboard
  → POST /api/kk { action: "remind_providers", taskId }
  → /api/kk intercepts locally
  → remindProvidersForTask(taskId)
  → Supabase reads tasks + provider_task_matches
  → if needed, matches providers via provider_services + provider_areas
  → upserts provider_task_matches when new matches are found
  → updates tasks.status = "notified"
  → returns legacy-shaped reminder payload
```

## Tables / Fields Used

| Table | Columns used | Purpose |
|---|---|---|
| `tasks` | `task_id`, `category`, `area`, `status` | Load task and mark it notified |
| `provider_task_matches` | `task_id`, `provider_id`, `category`, `area`, `match_status`, `notified` | Reuse existing matches or save new ones |
| `provider_services` | `provider_id`, `category` | Category-side provider matching |
| `provider_areas` | `provider_id`, `area` | Area-side provider matching |

## Response Contract Preserved

The backend-native path returns:

```json
{
  "ok": true,
  "status": "success",
  "taskId": "TK-...",
  "matchedProviders": 3,
  "placeholderNotificationTriggered": true,
  "reminderAt": "2026-04-19T..."
}
```

Through `/api/kk` normalization, admin callers still receive the existing wrapped envelope with `data` and `error` fields as before.

## Deferred Side Effects

Notification delivery remains **deferred** in this slice.

- Migrated safely:
  - provider matching
  - provider-task match persistence
  - task state transition to `"notified"`
- Deferred intentionally:
  - WhatsApp reminder delivery
  - notification log writes
  - reminder timestamp persistence equivalent to GAS `LastReminderAt`

These were not silently recreated because:

1. direct reminder delivery is not provable from `remindProviders_()` itself
2. no Supabase-native notification log table is confirmed in this repo
3. no confirmed `tasks.last_reminder_at` or equivalent column is present in the migrated schema

## GAS Status

- `remind_providers` / `admin_remind_providers` are now GAS-free on the main `/api/kk` path
- Notification sending for this action was **not** migrated in Slice 13

## Next Recommended Slice

Migrate admin notification logs / summaries (`admin_notification_logs`, `admin_get_notification_logs`, `admin_notification_summary`, `admin_get_notification_summary`) to a Supabase-native notification log store, then decide whether reminder delivery should be connected to that store in a dedicated notification slice.
