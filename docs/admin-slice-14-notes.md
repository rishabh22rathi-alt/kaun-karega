# Admin Slice 14 Notes

**Goal:** Migrate admin notification log and notification summary reads off Google Apps Script while preserving the current `/api/kk` response contracts and admin dashboard behavior.

## Files Changed

| File | Change | Purpose |
|---|---|---|
| `web/app/api/kk/route.ts` | Updated | Intercepts notification log/summary read actions before the GAS proxy |
| `web/lib/admin/adminNotificationReads.ts` | Added | Supabase-native readers for admin notification logs and per-task summaries |
| `web/lib/notificationLogStore.ts` | Added | Minimal Supabase log writer used by native notification delivery |
| `web/app/api/process-task-notifications/route.ts` | Updated | Writes truthful forward-going notification logs into Supabase |
| `docs/admin-slice-14-notification-logs.sql` | Added | One-time SQL to create the Supabase notification log table |
| `docs/admin-slice-14-notes.md` | Added | Records Slice 14 scope and outcomes |

## Exact Actions Migrated

- `admin_notification_logs`
- `admin_get_notification_logs`
- `admin_notification_summary`
- `admin_get_notification_summary`

These actions now resolve locally in `/api/kk` and no longer use the GAS `NotificationLogs` sheet on the main path.

## Exact Contracts Confirmed

### Notification Logs

**Caller**

- `web/app/admin/dashboard/page.tsx`

**Route / payload**

```txt
POST /api/kk
Body: { action: "admin_notification_logs", limit: 25 }
```

Alias supported for parity:

```txt
POST /api/kk
Body: { action: "admin_get_notification_logs", limit }
```

**Response shape**

```json
{
  "ok": true,
  "status": "success",
  "logs": [
    {
      "LogID": "LOG-...",
      "CreatedAt": "...",
      "TaskID": "TK-...",
      "DisplayID": "123",
      "ProviderID": "PR-...",
      "ProviderPhone": "...",
      "Category": "...",
      "Area": "...",
      "ServiceTime": "...",
      "TemplateName": "...",
      "Status": "accepted|failed|error",
      "StatusCode": 200,
      "MessageId": "...",
      "ErrorMessage": "...",
      "RawResponse": "..."
    }
  ]
}
```

### Notification Summary

**Caller**

- `web/app/admin/dashboard/page.tsx`

**Route / payload**

```txt
POST /api/kk
Body: { action: "admin_notification_summary", taskId }
```

Alias supported for parity:

```txt
POST /api/kk
Body: { action: "admin_get_notification_summary", taskId }
```

**Response shape**

```json
{
  "ok": true,
  "status": "success",
  "summary": {
    "taskId": "TK-...",
    "DisplayID": "123",
    "total": 0,
    "accepted": 0,
    "failed": 0,
    "error": 0,
    "latestCreatedAt": ""
  }
}
```

## Old Flow

```txt
Admin dashboard
  → POST /api/kk { action: "admin_notification_logs", limit }
  → /api/kk proxied to APPS_SCRIPT_URL
  → GAS NotificationLogs.js / Backend.js
  → NotificationLogs sheet read

Admin dashboard
  → POST /api/kk { action: "admin_notification_summary", taskId }
  → /api/kk proxied to APPS_SCRIPT_URL
  → GAS NotificationLogs.js / Backend.js
  → NotificationLogs sheet aggregation
```

## New Flow

```txt
Admin dashboard
  → POST /api/kk { action: "admin_notification_logs", limit }
  → /api/kk intercepts locally
  → getAdminNotificationLogsFromSupabase(limit)
  → Supabase notification_logs read

Admin dashboard
  → POST /api/kk { action: "admin_notification_summary", taskId }
  → /api/kk intercepts locally
  → getAdminNotificationSummaryFromSupabase(taskId)
  → Supabase notification_logs aggregation + tasks.display_id lookup
```

## Tables / Fields Used

### Read Path

| Table | Columns used | Purpose |
|---|---|---|
| `notification_logs` | `log_id`, `created_at`, `task_id`, `display_id`, `provider_id`, `provider_phone`, `category`, `area`, `service_time`, `template_name`, `status`, `status_code`, `message_id`, `error_message`, `raw_response` | Admin log rows and summary aggregation |
| `tasks` | `display_id` | Preserve GAS-like summary `DisplayID` even when no logs exist yet |

### Write Foundation

| Route | Table | Columns written |
|---|---|---|
| `web/app/api/process-task-notifications/route.ts` | `notification_logs` | all current admin log fields listed above |

## Response Contracts Preserved

- `admin_notification_logs` still returns `{ ok, status: "success", logs }`
- `admin_notification_summary` still returns `{ ok, status: "success", summary }`
- `/api/kk` still applies the same admin payload normalization wrapper with `data` and `error`
- Admin dashboard behavior is unchanged:
  - logs panel remains non-blocking
  - selected-task summary still loads on request selection
  - notification health cards still derive counts from log rows in the UI

## What Is Truthfully Logged

The new Supabase store only records results that the current native backend can actually prove:

- successful provider lead sends from `process-task-notifications` are logged as `Status: "accepted"`
- thrown send errors are logged as `Status: "error"`
- `MessageId` is captured from the Meta success payload when present
- `RawResponse` stores the serialized success payload or the caught error text

This slice does **not** fabricate historical rows or claim delivery outcomes for paths that do not currently write logs natively.

## GAS Status

- Notification health/log reads are now GAS-free on the main `/api/kk` path
- The old GAS notification sheet is no longer used for these admin read actions once the Supabase table exists and native writers are producing rows

## Backfill Requirement

**Yes. Backfill is required** if you want pre-Slice-14 historical notification data to appear in the dashboard.

What this slice provides:

- forward-going Supabase log storage for the existing native `process-task-notifications` path
- Supabase-native reads for logs and summaries

What it does **not** provide:

- automatic migration of historical GAS `NotificationLogs` sheet data
- fake historical entries

Run the one-time table creation SQL first:

- `docs/admin-slice-14-notification-logs.sql`

Historical backfill from GAS to Supabase remains a separate one-time ops task.

## Next Recommended Slice

Migrate the remaining notification-producing paths that still exist outside this Supabase log store, especially chat-related notification events and any future reminder delivery path, so the admin notification dashboard becomes a complete source of truth instead of only a forward-going partial feed.
