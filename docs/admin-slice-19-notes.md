# Admin Slice 19 Notes

**Goal:** Migrate the remaining core chat actions off Google Apps Script, starting with thread create/get, mark-read, user/provider thread listing, and admin chat read paths.

## Files Changed

| File | Change | Purpose |
|---|---|---|
| `web/lib/chat/chatPersistence.ts` | Updated | Adds native thread create/get, user/provider thread lists, mark-read, and admin chat read helpers |
| `web/app/api/kk/route.ts` | Updated | Intercepts the remaining core chat actions and keeps legacy GAS hydration explicit |
| `docs/admin-slice-19-notes.md` | Added | Records Slice 19 contracts, unread semantics, and remaining GAS chat actions |

## Exact Chat Actions Migrated

These actions are now backend-native on the main `/api/kk` path:

- `chat_create_or_get_thread`
- `chat_get_threads`
- `chat_mark_read`
- `chat_get_messages` (already native from Slice 17, unchanged here)
- `chat_send_message` (already native from Slice 17, unchanged here)
- `admin_list_chat_threads`
- `get_admin_chat_threads`
- `admin_get_chat_thread`

## Exact Contracts Preserved

### `chat_create_or_get_thread`

Request shape preserved:

```txt
POST /api/kk
Body:
  { action: "chat_create_or_get_thread", ActorType: "provider", TaskID, loggedInProviderPhone }
  or
  { action: "chat_create_or_get_thread", ActorType: "user", TaskID, ProviderID, UserPhone }
```

Response shape preserved:

```json
{
  "ok": true,
  "status": "success",
  "created": true,
  "thread": {
    "ThreadID": "...",
    "TaskID": "...",
    "DisplayID": "...",
    "UserPhone": "...",
    "ProviderID": "...",
    "ProviderPhone": "...",
    "Category": "...",
    "Area": "...",
    "Status": "active",
    "CreatedAt": "...",
    "UpdatedAt": "...",
    "LastMessageAt": "",
    "LastMessageBy": "",
    "UnreadUserCount": 0,
    "UnreadProviderCount": 0,
    "ThreadStatus": "active",
    "ModerationReason": "",
    "LastModeratedAt": "",
    "LastModeratedBy": ""
  }
}
```

### `chat_get_threads`

Request shape preserved:

```txt
POST /api/kk
Body:
  { action: "chat_get_threads", ActorType: "user", UserPhone, TaskID?, Status? }
  or
  { action: "chat_get_threads", ActorType: "provider", loggedInProviderPhone, TaskID?, Status? }
```

Response shape preserved:

```json
{
  "ok": true,
  "status": "success",
  "threads": [...]
}
```

### `chat_mark_read`

Request shape preserved:

```txt
POST /api/kk
Body:
  { action: "chat_mark_read", ActorType, ThreadID, UserPhone? / loggedInProviderPhone? }
```

Response shape preserved:

```json
{
  "ok": true,
  "status": "success",
  "thread": { "...": "..." },
  "markedCount": 2
}
```

### Admin chat reads

Preserved:

- `admin_list_chat_threads` → `{ ok, status: "success", threads }`
- `admin_get_chat_thread` → `{ ok, status: "success", thread, messages }`

## Unread Semantics Preserved

- provider message increments `UnreadUserCount`
- user message increments `UnreadProviderCount`
- `chat_mark_read` for user:
  - sets thread `UnreadUserCount = 0`
  - marks provider-authored messages `ReadByUser = "yes"`
- `chat_mark_read` for provider:
  - sets thread `UnreadProviderCount = 0`
  - marks user-authored messages `ReadByProvider = "yes"`
- thread ordering remains based on `LastMessageAt`, then `UpdatedAt`, then `CreatedAt`

These semantics match the current user/provider chat list and alert behavior in the UI.

## Old Flow

```txt
Chat create/list/mark-read/admin reads
  → POST /api/kk
  → proxy to GAS
  → GAS chat sheets
```

## New Flow

```txt
Chat create/list/mark-read/admin reads
  → POST /api/kk
  → local intercept in /api/kk
  → Supabase chat_threads + chat_messages
  → return existing GAS-shaped payloads
```

For old unsynced threads, a narrow legacy fallback remains:

- `chat_create_or_get_thread` may sync thread summaries from GAS before native create to avoid duplicates
- `chat_get_threads` / `admin_list_chat_threads` may sync thread summaries from GAS when native storage is empty
- `chat_mark_read` / `chat_get_messages` / `admin_get_chat_thread` may sync thread+message detail from GAS when a thread is still missing locally

This fallback is explicit and hydration-only. It does not re-run GAS `chat_send_message`, so it does not duplicate message writes or chat notifications.

## Whether Core Chat Is Now GAS-Free

**Not fully, but the remaining dependency is narrow and legacy-oriented.**

Main-path chat read/write actions are now native:

- thread create/get
- thread list
- mark read
- get messages
- send message

Explicit remaining GAS chat actions:

- `admin_update_chat_thread_status`
- legacy hydration fallback for old unsynced threads
- server-side `/open-chat` page still calls GAS directly for `chat_get_threads`

## Next Recommended Slice

Migrate the remaining admin chat status mutation (`admin_update_chat_thread_status`) and remove the `/open-chat` direct GAS call by switching it to the native `/api/kk` thread-list path.

After that, the next cleanup slice should be retiring the legacy hydration fallback once existing chat history is backfilled into Supabase.
