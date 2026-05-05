# Admin Slice 15 Notes

**Goal:** Ensure all currently backend-native, admin-relevant notification-producing paths write truthful results to Supabase `notification_logs`, without changing frontend behavior or inventing delivery results.

## Files Changed

| File | Change | Purpose |
|---|---|---|
| `web/lib/notificationLogStore.ts` | Updated | Clarifies that the shared store is for truthful task-linked notification attempts/results only |
| `docs/admin-slice-15-notes.md` | Added | Records the exact native notification-producing paths reviewed in this slice |

## Native Notification-Producing Paths Reviewed

| Path | Trigger | Actually sends? | Writes `notification_logs`? | Status |
|---|---|---|---|---|
| `web/app/api/process-task-notifications/route.ts` | Task creation success flow via `web/app/success/SuccessClient.tsx` | Yes, provider WhatsApp lead notifications | Yes | Already compliant |
| `web/lib/admin/adminReminderMutations.ts` via `/api/kk` `remind_providers` / `admin_remind_providers` | Admin reminder button | No confirmed send in native path; only match persistence and task state updates | No | Correctly not logged |
| GAS chat notification helpers (`sendUserFirstProviderMessageNotification_`, `sendProviderUserRepliedNotification_`) | Chat events | Yes in GAS | No native Supabase logging yet | Not yet native |
| `web/app/api/send-whatsapp-otp/route.ts` | Login / register / verify OTP | Yes | No | Intentionally excluded from admin task notification logs |
| `web/app/api/debug-whatsapp-otp/route.ts` | Debug utility | Yes | No | Intentionally excluded from admin task notification logs |
| `web/app/api/test-wa/route.ts` | Test utility | Yes | No | Intentionally excluded from admin task notification logs |
| `web/app/api/wa-test/route.ts` | Test utility | Yes | No | Intentionally excluded from admin task notification logs |

## Exact Paths Updated

No additional task-notification sender needed a behavioral change in this slice.

The only currently backend-native path that both:

1. produces real notification attempts for the admin task flow, and
2. should appear in the admin notification health/log UI

is:

- `web/app/api/process-task-notifications/route.ts`

That path was already writing truthful logs to Supabase from Slice 14, so Slice 15 confirms and documents it as the single migrated source of truth for current admin-visible notification delivery.

## Exact Fields / Statuses Logged

`process-task-notifications` writes these fields through `appendNotificationLog(...)`:

- `task_id`
- `display_id`
- `provider_id`
- `provider_phone`
- `category`
- `area`
- `service_time`
- `template_name`
- `status`
- `status_code`
- `message_id`
- `error_message`
- `raw_response`

Statuses currently written by the migrated native path:

- `accepted`
- `error`

These values are truthful reflections of the actual Meta send result or thrown error in the current native implementation.

## Old State

After Slice 14, admin notification reads were Supabase-native, but completeness depended on whether every migrated native sender wrote logs.

## New State

For migrated admin task flows, the picture is now explicit and consistent:

- `process-task-notifications` writes to `notification_logs`
- `remind_providers` does not create fake delivery logs because the native path does not actually send notifications
- chat notification events still do not appear because those sends are still handled in GAS
- OTP/test utilities remain outside the admin task notification dashboard on purpose

## Whether Admin Notification Health Is Complete

**Yes, for migrated admin task notification flows.**

**No, for the broader product notification surface.**

The admin dashboard text and UI currently describe task-notification delivery attempts from task creation. That flow is fully represented by the native `process-task-notifications` writer.

What is still outside this coverage:

- chat notification sends that still occur in GAS
- OTP flows
- debug/test WhatsApp endpoints

Those paths were not pulled into `notification_logs` here because doing so would either:

- mix unrelated traffic into the admin task-notification dashboard, or
- claim observability for sends that are not yet backend-native

## GAS Status

- Admin notification health/log reads remain GAS-free
- The migrated task-creation notification send path remains Supabase-logged
- Chat-related notification sends still touch GAS because those senders are not yet migrated

## Next Recommended Slice

Migrate the chat-related notification-producing paths off GAS and make those native send results write through `web/lib/notificationLogStore.ts`, so admin notification health becomes complete for chat-triggered task notifications as well.
