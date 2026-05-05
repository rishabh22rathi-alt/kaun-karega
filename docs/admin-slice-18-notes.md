# Admin Slice 18 Notes

**Goal:** Move chat-triggered notification side effects onto the native `chat_send_message` persistence path and log real outcomes to Supabase `notification_logs`, without changing frontend chat behavior.

## Files Changed

| File | Change | Purpose |
|---|---|---|
| `web/lib/whatsappTemplates.ts` | Added | Native Meta WhatsApp template sender plus the two chat notification wrappers |
| `web/lib/chat/chatPersistence.ts` | Updated | Runs native chat notification side effects after real message writes and logs truthful send outcomes |
| `docs/admin-slice-18-notes.md` | Added | Records Slice 18 trigger rules, templates, and logging behavior |

## Chat Notification Side Effects Migrated

Both repo-confirmed chat side effects are now backend-native on top of the Supabase chat persistence layer:

1. first provider message in a thread → notify user
2. user reply in a thread → notify provider

These sends now happen from the native `chat_send_message` write path, not from GAS `chatSendMessage_()`.

## Exact Trigger Rules Implemented

### `user_chat_first_provider_message`

Repo evidence from `web/Chat.js` showed:

- only provider-authored messages can trigger it
- it fires only when `providerMessageCount === 1`
- recipient is the thread user phone
- body parameter is `displayId`
- button URL parameter is `threadId`

Native Slice 18 preserves that rule by:

- inserting the chat message first
- counting provider messages in `chat_messages` for that thread
- sending only when the count is exactly `1`

### `provider_user_replied_message`

Repo evidence from `web/Chat.js` showed:

- any user-authored chat message triggers it
- recipient is the thread provider phone
- body parameter is `displayId`
- button URL parameter is `threadId`

Native Slice 18 preserves that rule by:

- sending on every successful native user message write

## Templates / Channel Used

All provable from repo evidence:

- channel: Meta WhatsApp Cloud API template send
- provider first message → user template: `user_chat_first_provider_message`
- user reply → provider template: `provider_user_replied_message`
- language code used: `en`
- body params: `[displayId]`
- button URL suffix params: `[threadId]`

## Logging to `notification_logs`

Every real native chat notification attempt now writes through `notificationLogStore.ts`.

Fields written:

- `task_id`
- `display_id`
- `provider_id`
- `provider_phone`
- `category`
- `area`
- `template_name`
- `status`
- `status_code`
- `message_id`
- `error_message`
- `raw_response`

Statuses logged are truthful values returned by the native Meta template sender:

- `accepted`
- `failed`
- `error`

Notes:

- `provider_id` stays tied to the thread provider so task-level admin summaries remain grouped correctly
- `provider_phone` stores the actual recipient phone for the attempt, including user-recipient sends

## Chat Response Behavior Preserved

`chat_send_message` still succeeds when:

- chat persistence succeeds
- but the WhatsApp notification send fails

This matches the existing GAS behavior where notification failures were swallowed inside `try/catch` and did not fail the chat message itself.

## Old Flow

```txt
Native /api/kk chat_send_message
  → Supabase message persistence
  → no native chat notification side effects
  → GAS still owned chat-triggered notification behavior only on old GAS path
```

## New Flow

```txt
Native /api/kk chat_send_message
  → Supabase message persistence
  → native trigger evaluation
  → native Meta WhatsApp template send when rule matches
  → truthful notification_logs write
  → return same chat success payload
```

## Whether Any Chat Notification Path Still Touches GAS

For the two repo-confirmed `chat_send_message` side effects, no.

What still touches GAS elsewhere in chat:

- `chat_create_or_get_thread`
- `chat_mark_read`
- chat thread listing actions
- admin chat actions

Those are separate chat migration items, but the chat-triggered WhatsApp side effects tied to `chat_send_message` are now native.

## Next Recommended Slice

Migrate the remaining core chat actions that still depend on GAS, starting with:

1. `chat_create_or_get_thread`
2. `chat_mark_read`
3. thread listing / admin chat reads

That would remove the remaining operational GAS dependency from the main chat flow instead of only the notification side effects.
