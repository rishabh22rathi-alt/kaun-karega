# Admin Slice 17 Notes

**Goal:** Create the minimum Supabase-backed chat persistence needed to intercept `chat_send_message` locally, preserve the current response contract, and remove the main blocker for later chat-notification migration.

## Files Changed

| File | Change | Purpose |
|---|---|---|
| `web/lib/chat/chatPersistence.ts` | Added | Minimal native chat thread/message persistence, sender resolution, access checks, and GAS snapshot sync |
| `web/app/api/kk/route.ts` | Updated | Intercepts `chat_get_messages` and `chat_send_message` locally, with narrow GAS hydration for older threads |
| `docs/admin-slice-17-chat.sql` | Added | Minimal Supabase schema for `chat_threads` and `chat_messages` |
| `docs/admin-slice-17-notes.md` | Added | Records Slice 17 contract, storage, and remaining deferrals |

## Exact `chat_send_message` Contract Preserved

### Request shape used by the frontend

```txt
POST /api/kk
Body: {
  action: "chat_send_message",
  ActorType: "user" | "provider",
  ThreadID: string,
  MessageText: string,
  UserPhone?: string,
  loggedInProviderPhone?: string
}
```

### Current validations preserved

- `ThreadID` required
- `MessageText` required
- `MessageText` max length 2000
- only `"text"` messages are supported
- sender must resolve as `user` or `provider`
- sender must have access to the thread
- thread cannot be effectively `closed`
- thread cannot be effectively `locked`

### Response shape preserved

The native path returns the same top-level shape as GAS:

```json
{
  "ok": true,
  "status": "success",
  "thread": { "...": "..." },
  "message": { "...": "..." }
}
```

Error responses stay JSON payloads with:

```json
{
  "ok": false,
  "status": "error",
  "error": "..."
}
```

The route still returns HTTP 200 for these logical chat errors, matching the existing `/api/kk` caller expectations.

## Adjacent Chat Action Also Intercepted

To preserve visible chat behavior after sending, Slice 17 also intercepts:

- `chat_get_messages`

Reason:

- the chat page sends `chat_send_message`
- then immediately refreshes via `chat_get_messages`
- without a native read path, the just-sent native message would not appear in the UI

`chat_mark_read` was **not** migrated in this slice because it is not required for send-path parity.

## Tables / Fields Introduced

### `chat_threads`

- `thread_id`
- `task_id`
- `user_phone`
- `provider_id`
- `provider_phone`
- `category`
- `area`
- `status`
- `created_at`
- `updated_at`
- `last_message_at`
- `last_message_by`
- `unread_user_count`
- `unread_provider_count`
- `thread_status`
- `moderation_reason`
- `last_moderated_at`
- `last_moderated_by`

### `chat_messages`

- `message_id`
- `thread_id`
- `task_id`
- `sender_type`
- `sender_phone`
- `sender_name`
- `message_text`
- `message_type`
- `created_at`
- `read_by_user`
- `read_by_provider`
- `moderation_status`
- `flag_reason`
- `contains_blocked_word`

## Old Flow

```txt
Chat page
  → POST /api/kk { action: "chat_send_message", ... }
  → proxy to GAS
  → GAS appends chat message
  → GAS may send WhatsApp side effects
  → response returned

Chat page refresh
  → POST /api/kk { action: "chat_get_messages", ... }
  → proxy to GAS
```

## New Flow

```txt
Chat page initial load
  → POST /api/kk { action: "chat_get_messages", ... }
  → native Supabase read if thread already exists
  → otherwise one-time GAS read hydration into Supabase, then native read

Chat send
  → POST /api/kk { action: "chat_send_message", ... }
  → native Supabase write if thread exists
  → if thread has not been hydrated yet, perform one-time GAS read hydration first
  → native message insert + native thread update
  → return GAS-shaped success payload

Refresh after send
  → POST /api/kk { action: "chat_get_messages", ... }
  → native Supabase read
```

## Whether Chat Persistence Is Now Backend-Native

**Partially, yes.**

What is native now:

- `chat_send_message`
- `chat_get_messages`
- native storage for chat threads/messages in Supabase

What is still not native:

- `chat_create_or_get_thread`
- `chat_mark_read`
- chat thread listing actions
- admin chat actions

## Narrow GAS Fallback Still Present

The main chat send path no longer proxies `chat_send_message` to GAS on the normal path.

A **narrow read-only fallback** remains for older threads that exist only in GAS:

- `chat_get_messages` can hydrate a thread snapshot from GAS once
- `chat_send_message` can trigger that same read hydration if the thread has not been synced yet

This fallback is read-only and does **not** call GAS `chat_send_message`, so it does not create duplicate notification sends.

## Notification Side Effects

Still deferred in this slice.

The native `chat_send_message` path intentionally does **not** recreate:

- first-provider-message notification to user
- user-replied notification to provider

Those sends remain deferred so this slice does not accidentally double-send while old GAS-created threads are still being hydrated.

## Next Recommended Slice

Migrate the two chat notification side effects into native helpers on top of this new persistence layer, then write their real send outcomes through `notificationLogStore.ts`.

That follow-up slice should cover:

1. provider first message → user notification
2. user reply → provider notification
3. truthful `notification_logs` writes for accepted/error outcomes
