# Kaun Karega Migration Status

## Current Checkpoint
- Slice 27 progress
- `need_chat_get_threads_for_need` is now intercepted natively in `/api/kk`
- Reads from Supabase via `getNeedChatThreadsForNeedFromSupabase`
- Returns GAS-style response contract for existing frontend
- No GAS fallback in this branch
- Responses page and Sidebar compatibility validated PASS
- `get_my_needs` is now intercepted natively in `/api/kk`
- Reads from Supabase `needs`
- My Needs page and Sidebar compatibility validated PASS
- `get_needs` is now intercepted natively in `/api/kk`
- Reads from Supabase `needs`
- Public i-need page compatibility validated PASS
- `create_need` is now intercepted natively in `/api/kk`
- Writes to Supabase `needs`
- Post page compatibility validated PASS
- `mark_need_complete` is now intercepted natively in `/api/kk`
- Updates Supabase `needs`
- My Needs page compatibility validated PASS
- `close_need` is now intercepted natively in `/api/kk`
- Updates Supabase `needs`
- My Needs page compatibility validated PASS
- all user-side Need flows are now native
- `admin_get_needs` is now intercepted natively in `/api/kk`
- Reads from Supabase `needs`
- admin Needs page compatibility validated PASS

## Key Completed Native Need-Chat Flows
- `need_chat_get_threads_for_need`
- `need_chat_get_messages`
- `need_chat_mark_read`
- `need_chat_send_message`
- existing-thread path of `need_chat_create_or_get_thread`

## Newly Completed Native Needs Flows
- `get_my_needs`
- `get_needs`
- `create_need`
- `mark_need_complete`
- `close_need`
- `admin_get_needs`

## Remaining GAS-Dependent Need Flows
- `admin_close_need`
- `admin_hide_need`
- `admin_unhide_need`
- `admin_set_need_rank`

## Core Blocker
- user-side Need flows are no longer GAS-dependent
- admin Need mutations still remain native-pending: `admin_close_need`, `admin_hide_need`, `admin_unhide_need`, `admin_set_need_rank`
- `need_chat_create_or_get_thread` still depends on GAS for Need poster/status lookup on new-thread creation
- area canonicalization is not yet fully native-equivalent
- area-review side effect for unknown areas is not yet implemented natively

## Needs Source Schema (from GAS)
Columns:
- NeedID
- UserPhone
- DisplayName
- IsAnonymous
- Category
- Area
- Title
- Description
- Status
- ViewsCount
- ResponsesCount
- CreatedAt
- UpdatedAt
- ValidDays
- ExpiresAt
- CompletedAt
- ClosedAt
- ClosedBy
- AdminNote
- PriorityRank
- IsHidden

Derived/display-only:
- PosterLabel
- CurrentStatus
- _createdAtMs
- _expiresAtMs
- _sortRowNumber

## CurrentStatus Rules
- hidden overrides everything
- blank status behaves as open
- open + expired ExpiresAt => expired
- otherwise use stored status
- stored status currently centers on open / completed / closed

## First Native Needs Target
- Start with `get_my_needs`
- Reason: read-only, lower risk, powers My Needs page and Sidebar

## Minimal Native Needs Table Direction
Proposed table: `needs`

Minimal columns now:
- need_id
- user_phone
- display_name
- is_anonymous
- category
- area
- title
- description
- status
- created_at
- updated_at
- valid_days
- expires_at
- completed_at
- closed_at
- closed_by
- is_hidden

Deferred for later:
- views_count
- responses_count
- admin_note
- priority_rank

Keep derived in API:
- PosterLabel
- CurrentStatus

Timestamp recommendation:
- store as `timestamptz` and format in API for legacy contract compatibility

Recommended index:
- primary key / unique on `need_id`
- index on `(user_phone, created_at desc)`

## Next Recommended Step
- Inspect and migrate native `admin_hide_need`
- Then continue the remaining admin Need mutations
