# Admin Slice 16 Notes

**Goal:** Migrate chat-related notification-producing paths off Google Apps Script and write real send outcomes to Supabase `notification_logs` when that can be done safely without changing chat behavior.

## Files Changed

| File | Change | Purpose |
|---|---|---|
| `web/app/api/kk/route.ts` | Updated | Documents why `chat_send_message` still passes through to GAS |
| `docs/admin-slice-16-notes.md` | Added | Records the exact chat notification paths audited and the current migration blocker |

## Chat Notification-Producing Paths Identified

| Trigger event | Current action / helper | Still GAS-backed? | Who gets notified | Template / channel | Current send result returned to caller? | Status |
|---|---|---|---|---|---|---|
| First provider message in a chat thread | `chat_send_message` → `sendUserFirstProviderMessageNotification_()` | Yes | User | WhatsApp template `user_chat_first_provider_message` | No. `chat_send_message` returns only chat `{ ok, status, thread, message }` | Deferred |
| Any user reply in a chat thread | `chat_send_message` → `sendProviderUserRepliedNotification_()` | Yes | Provider | WhatsApp template `provider_user_replied_message` | No. `chat_send_message` returns only chat `{ ok, status, thread, message }` | Deferred |

## Repo-Confirmed Trigger Logic

From `web/Chat.js`:

- Provider send path:
  - `chatSendMessage_(data)` appends the chat message
  - counts provider messages in the thread
  - only when `providerMessageCount === 1` does it call `sendUserFirstProviderMessageNotification_(userPhone, displayId, threadId)`
- User send path:
  - `chatSendMessage_(data)` appends the chat message
  - then calls `sendProviderUserRepliedNotification_(providerPhone, displayId, threadId)`

Both side effects are wrapped in `try/catch` and do **not** change the success contract of `chat_send_message`.

## Why No Runtime Migration Was Safe In This Slice

The notification side effects are not isolated from chat persistence. They are embedded directly inside the GAS `chat_send_message` write path.

Repo evidence found in this slice:

- no native Next.js route currently implements `chat_send_message`
- no Supabase `chat_threads` / `chat_messages` storage or helper layer exists in this repo
- the frontend refresh after send still depends on GAS `chat_get_messages`
- adding a second native notification send after the GAS write would create duplicate WhatsApp sends

Because of that, there was **no clearly isolated chat notification path** that could be migrated off GAS in this slice without also taking on a broader chat persistence/read migration.

## Notification Logging Status

No new chat notification send now writes to Supabase in this slice, because no chat notification send was safely moved off GAS.

`notificationLogStore.ts` therefore remains the truthful store for:

- native task-creation provider lead notifications

and does **not** yet include:

- first-provider-message chat notifications
- user-replied chat notifications

This preserves the rule from Slices 14-15: only log real native attempts/results, never inferred or duplicated sends.

## Old Flow

```txt
Frontend chat page
  → POST /api/kk { action: "chat_send_message", ... }
  → /api/kk proxy
  → GAS chatSendMessage_()
  → GAS appends chat message
  → GAS may send WhatsApp chat notification
  → GAS returns chat response
```

## New Flow

Runtime behavior is intentionally unchanged in this slice:

```txt
Frontend chat page
  → POST /api/kk { action: "chat_send_message", ... }
  → /api/kk proxy
  → GAS chatSendMessage_()
  → GAS appends chat message
  → GAS may send WhatsApp chat notification
  → GAS returns chat response
```

What changed is the migration boundary is now explicit in code and docs, so a future slice can replace the whole coupled path instead of adding an unsafe duplicate sender.

## Whether Admin Notification Health Includes Chat Sends

Not yet.

Admin notification health remains complete for migrated native task-notification flows, but chat-triggered notification sends still live in GAS and therefore still sit outside the Supabase `notification_logs` source of truth.

## Next Recommended Slice

Create the minimum native chat message persistence slice for `chat_send_message`:

1. add Supabase-backed `chat_threads` / `chat_messages` storage
2. intercept `chat_send_message` locally with the same response contract
3. move the two chat notification sends into native helpers
4. write their real send outcomes through `notificationLogStore.ts`

That is the first slice where chat notifications can actually become GAS-free without duplicate sends or stale chat reads.
