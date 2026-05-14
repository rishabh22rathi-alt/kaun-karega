# Kaun Karega — Supabase Import Format Guide

**Purpose:** Reference for importing legacy Google Sheets / Apps Script data into the live Supabase project. Covers exact column shapes, generated fields to skip, required transformations, dependency-aware import order, dry-run validation queries, and a pre-import risk checklist.

**Status:** Audit + documentation only. **No data is imported by following this guide.** Run the import yourself (psql / Supabase SQL editor / a one-shot script) after the dry-run queries in section G all pass.

**Sources of truth used to build this guide:**
- Committed SQL in `docs/admin-slice-areas.sql`, `docs/admin-slice-unmapped-areas.sql`, `docs/admin-slice-14-notification-logs.sql`, `docs/admin-slice-17-chat.sql`, `docs/admin-slice-27-needs.sql`, `docs/admin-slice-issue-reports.sql`, `docs/migrations/whatsapp-inbound.sql`.
- Committed SQL in `web/docs/migrations/duplicate-name-review.sql`, `web/docs/migrations/notification-logs-add-area.sql`, `web/docs/migrations/notification-logs-full-schema.sql`, `web/docs/migrations/add-task-closure-tracking.sql`.
- For tables **without** committed SQL — `providers`, `provider_services`, `provider_areas`, `tasks`, `provider_task_matches`, `categories`, `admins`, `profiles`, `otp_requests`, `pending_category_requests`, `need_chat_threads`, `need_chat_messages` — the column set was reconstructed from the live read/write code paths (`web/lib/admin/*.ts`, `web/lib/chat/chatPersistence.ts`, `web/app/api/**/route.ts`, `web/lib/notificationLogStore.ts`). See section H for the explicit "schema not in repo" warning list.

---

## A. Import Order (dependency-aware)

Run in this order. Every step's targets only depend on rows from earlier steps.

| # | Group | Tables | Why this position |
|---|---|---|---|
| 1 | **Identity / auth** | `admins`, `profiles` | No FK dependencies. Import admins first so admin-actor fields on later rows can resolve to a real admin. profiles seeds the user registry. |
| 2 | **Master taxonomies** | `categories`, `areas`, `area_aliases` | All downstream tables (`provider_services`, `provider_areas`, `tasks`, `needs`) reference category names + canonical area names. Aliases reference `areas.area_name` (validated app-side, not by FK). |
| 3 | **Review queues** | `area_review_queue`, `pending_category_requests` | `area_review_queue.source_ref` may point at a `provider_id` — import queue rows after providers if you want referential integrity, otherwise here is fine because the column is plain TEXT. `pending_category_requests` similarly references provider_id but is unenforced FK. |
| 4 | **Providers + child rows** | `providers`, `provider_services`, `provider_areas` | Service and area rows FK to `providers.provider_id` (TEXT). Both child tables reference category / area names from step 2. |
| 5 | **Tasks** | `tasks` | Phone column references the user (no FK), category and area reference master rows from step 2. |
| 6 | **Task matching + outbound logs** | `provider_task_matches`, `notification_logs` | Both reference `tasks.task_id` and `providers.provider_id`. `notification_logs.task_id` has no FK but `chat_messages.thread_id` later does. |
| 7 | **Needs** | `needs` | Phone column references a user (no FK), category and area reference master rows. |
| 8 | **Chat (task-driven)** | `chat_threads`, `chat_messages` | `chat_messages.thread_id` has a real FK with `ON DELETE CASCADE` → must import `chat_threads` first. |
| 9 | **Chat (need-driven)** | `need_chat_threads`, `need_chat_messages` | Same parent/child relationship pattern as step 8. |
| 10 | **Issue reports** | `issue_reports` | Standalone — phone is freeform, no FKs. |
| 11 | **Optional** | `whatsapp_inbound`, `otp_requests` | `whatsapp_inbound` is webhook-only — no need to backfill historical Apps Script data. `otp_requests` is short-lived (5-min TTL) — never backfill. |

---

## B. Table-by-table schema guide

For every table:
- "Generated" = do **not** include in the INSERT payload.
- "Required" = NOT NULL with no default, **must** be present.
- "Default" = NOT NULL **with** a default — omit and the default applies; pass explicitly only when migrating real legacy values.
- "Nullable" = optional, fine to omit.

### B.1 `admins`
Schema reconstructed from `web/lib/admin/adminVerifier.ts` and `web/lib/admin/adminTeamMembers.ts`. **No committed CREATE TABLE statement** — confirm in Supabase SQL editor before import.

| Column | Type | Required? | Format | Example | Sheet column | Import note |
|---|---|---|---|---|---|---|
| phone | text | Required (PK) | 12-digit `91XXXXXXXXXX` | `919876543210` | `Admins!phone` | Normalise before insert. Code matches with `.eq("phone", canonicalPhone)`; a 10-digit row will silently never log in. |
| name | text | Nullable | trimmed | `Kaun Karega Admin` | `Admins!name` | — |
| role | text | Default | "admin" / "owner" / etc. | `admin` | `Admins!role` | Application defaults to "admin" if blank. |
| permissions | text[] | Nullable | Postgres array | `{"providers:write","categories:write"}` | `Admins!permissions` (CSV) | Split CSV into array on import: `string_to_array(value, ',')`. |
| active | boolean | Default true | true / false | `true` | `Admins!active` | Inactive admins fail `verifyAdminByPhone`. |
| created_at | timestamptz | Default `now()` | ISO-8601 | `2026-04-01T10:00:00Z` | `Admins!created_at` | Pass legacy timestamp explicitly when backfilling, otherwise omit. |

### B.2 `profiles`
Reconstructed from `web/app/api/verify-otp/route.ts` (upsert) and `web/lib/admin/adminDashboardStats.ts` (count). **No committed CREATE TABLE statement.**

| Column | Type | Required? | Format | Example | Sheet column | Import note |
|---|---|---|---|---|---|---|
| phone | text | Required (PK or unique) | 12-digit `91XXXXXXXXXX` | `919876543210` | `Users!phone` | OTP system already writes 12-digit; legacy 10-digit rows must be normalised. |
| role | text | Default | `user` / `provider` / `admin` | `user` | `Users!role` | Dashboard counts only `role='user'` AND `is_active=true`. |
| last_login_at | timestamptz | Nullable | ISO-8601 | `2026-04-30T18:22:11Z` | `Users!last_login_at` | Powers the OTP-verified-within-30-days badge in `/api/my-requests`. |
| is_active | boolean | Default true | true / false | `true` | `Users!is_active` | Soft-delete flag — set false to hide from dashboard counts. |
| created_at | timestamptz | Default `now()` | ISO-8601 | — | — | Skip on import unless backfilling. |

### B.3 `categories`
Reconstructed from `web/lib/admin/adminCategoryMutations.ts` (`onConflict: "name"`) and `web/lib/admin/adminDashboardStats.ts`. **No committed CREATE TABLE statement.**

| Column | Type | Required? | Format | Example | Sheet column | Import note |
|---|---|---|---|---|---|---|
| name | text | Required (UNIQUE) | canonical casing | `Plumber` | `Categories!name` | All matching paths now use `.ilike` (case-insensitive) but storing canonical casing keeps analytics readable. |
| active | boolean | Default true | true / false | `true` | `Categories!active` | Some legacy values are `"yes"`/`"no"` — the read-side handler accepts either. Convert to boolean on import. |

### B.4 `areas`
Committed in `docs/admin-slice-areas.sql`.

| Column | Type | Required? | Format | Example | Sheet column | Import note |
|---|---|---|---|---|---|---|
| id | bigserial | **Generated** | — | — | — | **Skip.** |
| area_name | text | Required (UNIQUE) | canonical casing | `Sardarpura` | `Areas!area_name` | Exact column the rest of the app filters on. |
| active | boolean | Default true | true / false | `true` | `Areas!active` | Inactive areas drop out of `/api/areas`. |
| created_at | timestamptz | Default `now()` | ISO-8601 | — | — | Skip unless backfilling. |
| updated_at | timestamptz | Default `now()` | ISO-8601 | — | — | Skip unless backfilling. |

### B.5 `area_aliases`
Committed in `docs/admin-slice-areas.sql`.

| Column | Type | Required? | Format | Example | Sheet column | Import note |
|---|---|---|---|---|---|---|
| id | bigserial | **Generated** | — | — | — | **Skip.** |
| alias_name | text | Required (UNIQUE) | as user-typed | `Boranada Jodhpur` | `AreaAliases!alias_name` | Must be unique. |
| canonical_area | text | Required | matches `areas.area_name` | `Boranada` | `AreaAliases!canonical_area` | No FK enforcement — typo here breaks alias resolution. Validate against `areas.area_name` before import. |
| active | boolean | Default true | true / false | `true` | `AreaAliases!active` | — |
| created_at / updated_at | timestamptz | Defaults | — | — | — | Skip. |

### B.6 `area_review_queue`
Committed in `docs/admin-slice-unmapped-areas.sql`.

| Column | Type | Required? | Format | Example | Sheet column | Import note |
|---|---|---|---|---|---|---|
| review_id | text | Required (PK) | `ARQ-{epoch}-{rand}` | `ARQ-1717000000-123` | `AreaReviewQueue!review_id` | App-generated string — preserve legacy IDs to avoid duplicate "first sightings". |
| raw_area | text | Required | as user typed | `Shastri Nagar` | `AreaReviewQueue!raw_area` | — |
| normalized_key | text | Required | lowercase, no spaces | `shastrinagar` | `AreaReviewQueue!normalized_key` | Compute as `regexp_replace(lower(raw_area),'[^a-z0-9]','','g')`. |
| status | text | Default `'pending'` | `pending` / `resolved` | `pending` | `AreaReviewQueue!status` | — |
| occurrences | integer | Default 1 | positive int | `3` | `AreaReviewQueue!occurrences` | — |
| source_type | text | Default `''` | `provider_register` / `task_post` | `provider_register` | `AreaReviewQueue!source_type` | — |
| source_ref | text | Default `''` | provider_id / task_id | `PRV-001` | `AreaReviewQueue!source_ref` | Plain text — no FK. |
| first_seen_at | timestamptz | Default `now()` | ISO-8601 | `2026-01-01T00:00:00Z` | `AreaReviewQueue!first_seen_at` | Pass legacy value explicitly. |
| last_seen_at | timestamptz | Default `now()` | ISO-8601 | `2026-01-02T00:00:00Z` | `AreaReviewQueue!last_seen_at` | — |
| resolved_canonical_area | text | Default `''` | empty until resolved | `''` | `AreaReviewQueue!resolved_canonical_area` | — |
| resolved_at | timestamptz | Nullable | NULL until resolved | NULL | `AreaReviewQueue!resolved_at` | — |

### B.7 `providers`
Reconstructed from `web/lib/admin/adminProviderReads.ts`, `web/app/api/kk/route.ts` (provider_register insert), and `web/docs/migrations/duplicate-name-review.sql`. **Base table has no committed CREATE statement** — duplicate-name columns do.

| Column | Type | Required? | Format | Example | Sheet column | Import note |
|---|---|---|---|---|---|---|
| provider_id | text | Required (PK) | `PRV-####` or legacy ID | `PRV-0123` | `Providers!ProviderID` | Code reads as text. Auto-generation pattern is application-side; if importing legacy values, preserve them. |
| full_name | text | Required | trimmed, often UPPERCASE | `RAJESH KUMAR` | `Providers!Name` | Provider register flow uppercases. Keep legacy casing if migrating. |
| phone | text | Required (UNIQUE constraint named `providers_phone_key`) | 10-digit OR 12-digit (mixed in current data) | `9876543210` | `Providers!Phone` | **HIGH RISK** — `getProviderByPhoneFromSupabase` already queries both `phone.eq.<10>` and `phone.eq.91<10>`. Pick one and stick with it; recommend 10-digit for `providers.phone` to match `tasks.phone`. |
| business_name | text | Nullable | trimmed | `Sharma Plumbing Works` | `Providers!business_name` | — |
| experience_years | text/numeric | Nullable | — | `5` | `Providers!experience_years` | Stored as text by the register insert (`null` when blank). |
| notes | text | Nullable | — | — | `Providers!notes` | — |
| status | text | Required | `active` / `pending` / `blocked` (lowercase) | `active` | `Providers!status` | Dashboard count filters `eq("status","pending")` literally — case matters. |
| verified | text | Required | `yes` / `no` (lowercase) | `yes` | `Providers!verified` | Dashboard count filters `eq("verified","yes")` literally. Stored as text, not boolean. |
| created_at | timestamptz | Default `now()` | ISO-8601 | — | `Providers!created_at` | Pass legacy timestamp; otherwise default applies. |
| duplicate_name_review_status | text | Nullable | NULL / `pending` / `cleared` / `separate` / `rejected` | NULL | n/a | Skip on import unless migrating an in-flight review. |
| duplicate_name_matches | text[] | Nullable | provider_id array | `{}` | n/a | Skip. |
| duplicate_name_flagged_at | timestamptz | Nullable | — | NULL | n/a | Skip. |
| duplicate_name_resolved_at | timestamptz | Nullable | — | NULL | n/a | Skip. |
| duplicate_name_admin_phone | text | Nullable | 12-digit | NULL | n/a | Skip. |
| duplicate_name_reason | text | Nullable | — | NULL | n/a | Skip. |

### B.8 `provider_services`
Reconstructed from `web/lib/admin/adminProviderReads.ts` and `web/app/api/kk/route.ts`.

| Column | Type | Required? | Format | Example | Sheet column | Import note |
|---|---|---|---|---|---|---|
| provider_id | text | Required (FK → providers) | `PRV-####` | `PRV-0123` | derived | One row per provider × category. |
| category | text | Required | should match `categories.name` casing (case-insensitive lookup downstream) | `Plumber` | `Providers!Categories` (CSV) | Split CSV into multiple rows. Best-effort canonicalise to `categories.name` casing. |
| (no other columns observed in code) | | | | | | If real schema has `id` / `created_at` / etc., add them here. |

### B.9 `provider_areas`
Reconstructed from `web/lib/admin/adminProviderReads.ts` and `web/app/api/kk/route.ts`.

| Column | Type | Required? | Format | Example | Sheet column | Import note |
|---|---|---|---|---|---|---|
| provider_id | text | Required (FK → providers) | `PRV-####` | `PRV-0123` | derived | One row per provider × area. |
| area | text | Required | should match `areas.area_name` casing | `Sardarpura` | `Providers!Areas` (CSV) | Split CSV. Run any CSV value through alias resolution before insert (look up `area_aliases.alias_name`, write back the canonical area). |

### B.10 `tasks`
Reconstructed from `web/app/api/submit-request/route.ts`, `web/lib/admin/adminTaskReads.ts`, plus closure-tracking columns from `web/docs/migrations/add-task-closure-tracking.sql`. **Base table has no committed CREATE statement.**

| Column | Type | Required? | Format | Example | Sheet column | Import note |
|---|---|---|---|---|---|---|
| task_id | text | Required (PK) | `TK-{epoch_ms}` | `TK-1717000000000` | `Tasks!TaskID` | App generates with `Date.now()`. Preserve legacy IDs; do not regenerate. |
| display_id | bigint or sequence | **Generated** by DB | — | `1247` | `Tasks!display_id` | Code reads it back via `.select("display_id").single()` after insert — strongly suggests a Postgres sequence default. **Do not pass during import** unless your target schema has display_id without a default. Confirm in Supabase first. |
| category | text | Required | canonical casing | `Plumber` | `Tasks!Category` | Canonicalise via `categories.name` lookup before insert. |
| area | text | Required | canonical casing | `Sardarpura` | `Tasks!Area` | Resolve via alias if needed. |
| details | text | Default `'-'` | freeform | `Tap is leaking` | `Tasks!Details` | App writes `-` when blank — match that. |
| phone | text | Required | 10-digit (`session.phone` already normalised in code) | `9876543210` | `Tasks!UserPhone` | Match the casing chosen for `providers.phone`. Recommended 10-digit. |
| selected_timeframe | text | Nullable | `Today` / `Tomorrow` / `Schedule later` / `Flexible` / freeform | `Today` | `Tasks!SelectedTimeframe` | — |
| service_date | date | Nullable | `YYYY-MM-DD` | `2026-04-15` | `Tasks!ServiceDate` | Submit-request normalises both `YYYY-MM-DD` and `DD-MM-YYYY` inputs to `YYYY-MM-DD`. |
| time_slot | text | Nullable | freeform | `10:00 AM - 12:00 PM` | `Tasks!TimeSlot` | — |
| status | text | Required | `submitted` / `notified` / `responded` / `provider_responded` / `assigned` / `closed` / `completed` / `no_providers_matched` (all lowercase) | `submitted` | `Tasks!Status` | Application writes lowercase. Some downstream UI uppercases for display only. |
| created_at | timestamptz | Default `now()` | ISO-8601 | `2026-04-15T08:30:00Z` | `Tasks!CreatedAt` | Pass legacy timestamp. |
| closed_at | timestamptz | Nullable | ISO-8601 | NULL | `Tasks!ClosedAt` | Set only for closed/completed rows. |
| closed_by | text | Nullable | `user` / `admin` / `system` | NULL | `Tasks!ClosedBy` | — |
| close_reason | text | Nullable | freeform | `expired_no_progress` | `Tasks!CloseReason` | — |

### B.11 `provider_task_matches`
Reconstructed from `web/lib/admin/adminTaskReads.ts`, `web/app/api/process-task-notifications/route.ts`, and `web/lib/admin/adminTaskMutations.ts`.

| Column | Type | Required? | Format | Example | Sheet column | Import note |
|---|---|---|---|---|---|---|
| task_id | text | Required (composite PK) | matches `tasks.task_id` | `TK-1717000000000` | `ProviderTaskMatches!TaskID` | — |
| provider_id | text | Required (composite PK) | matches `providers.provider_id` | `PRV-0123` | `ProviderTaskMatches!ProviderID` | Composite uniqueness: `(task_id, provider_id)`. |
| category | text | Default `''` (NOT NULL inferred from a test) | matches `tasks.category` | `Plumber` | `ProviderTaskMatches!Category` | E2E test asserts category + area NOT NULL. |
| area | text | Default `''` (NOT NULL inferred from a test) | matches `tasks.area` | `Sardarpura` | `ProviderTaskMatches!Area` | — |
| match_status | text | Required | `matched` / `notified` / `responded` / `accepted` / `assigned` / `rejected` (lowercase) | `matched` | `ProviderTaskMatches!MatchStatus` | — |
| notified | boolean | Nullable | true/false | `true` | `ProviderTaskMatches!Notified` | — |
| created_at | timestamptz | Default `now()` | ISO-8601 | — | `ProviderTaskMatches!CreatedAt` | Pass legacy timestamp. |

### B.12 `notification_logs`
Schema = union of `docs/admin-slice-14-notification-logs.sql` + `web/docs/migrations/notification-logs-add-area.sql` + `web/docs/migrations/notification-logs-full-schema.sql`.

| Column | Type | Required? | Format | Example | Sheet column | Import note |
|---|---|---|---|---|---|---|
| log_id | text | Required (PK) | `LOG-{epoch}-{rand}` | `LOG-1717000000-A1B2C3` | `NotificationLogs!LogID` | App generates if blank. Preserve legacy IDs to keep audit links stable. |
| created_at | timestamptz | Default `now()` | ISO-8601 | `2026-04-15T08:31:00Z` | `NotificationLogs!CreatedAt` | — |
| task_id | text | Required | matches `tasks.task_id` | `TK-1717000000000` | `NotificationLogs!TaskID` | — |
| display_id | text | Nullable | matches `tasks.display_id` (as text) | `1247` | `NotificationLogs!DisplayID` | Stored as text in this table even though `tasks.display_id` is numeric. |
| provider_id | text | Required | matches `providers.provider_id` | `PRV-0123` | `NotificationLogs!ProviderID` | — |
| provider_phone | text | Default `''` | 10-digit or 12-digit | `9876543210` | `NotificationLogs!ProviderPhone` | Code writes whatever `providers.phone` was (no re-normalisation here). |
| category | text | Nullable | matches `tasks.category` | `Plumber` | `NotificationLogs!Category` | — |
| area | text | Nullable | matches `tasks.area` | `Sardarpura` | `NotificationLogs!Area` | — |
| service_time | text | Nullable | freeform | `Today` | `NotificationLogs!ServiceTime` | — |
| template_name | text | Nullable | Meta WA template name | `provider_job_alert` | `NotificationLogs!TemplateName` | — |
| status | text | Required | `accepted` / `error` / `pending` (lowercase) | `accepted` | `NotificationLogs!Status` | — |
| status_code | integer | Nullable | HTTP status | `200` | `NotificationLogs!StatusCode` | NULL on send failures. |
| message_id | text | Default `''` | Meta WAMID | `wamid.HBgM...` | `NotificationLogs!MessageID` | Empty string when send failed. |
| error_message | text | Default `''` | freeform | `''` | `NotificationLogs!ErrorMessage` | — |
| raw_response | text | Nullable | JSON string | `{"messages":[…]}` | `NotificationLogs!RawResponse` | Verbatim response body. |

### B.13 `chat_threads`
Committed in `docs/admin-slice-17-chat.sql`.

| Column | Type | Required? | Format | Example | Sheet column | Import note |
|---|---|---|---|---|---|---|
| thread_id | text | Required (PK) | `CHT-{taskId}-{providerId}` (legacy pattern) | `CHT-TK-1717-PRV-001` | `ChatThreads!ThreadID` | Preserve legacy IDs — referenced by `chat_messages.thread_id` FK. |
| task_id | text | Required | matches `tasks.task_id` | `TK-1717000000000` | `ChatThreads!TaskID` | No FK enforcement, but logically required. |
| user_phone | text | Default `''` | 10-digit | `9876543210` | `ChatThreads!UserPhone` | Match `tasks.phone` casing. |
| provider_id | text | Default `''` | `PRV-####` | `PRV-0123` | `ChatThreads!ProviderID` | — |
| provider_phone | text | Default `''` | 10-digit | `9123456780` | `ChatThreads!ProviderPhone` | Match `providers.phone` casing. |
| category | text | Nullable | matches `tasks.category` | `Plumber` | `ChatThreads!Category` | — |
| area | text | Nullable | matches `tasks.area` | `Sardarpura` | `ChatThreads!Area` | — |
| status | text | Default `'active'` | `active` / `closed` | `active` | `ChatThreads!Status` | — |
| created_at | timestamptz | Default `now()` | ISO-8601 | — | `ChatThreads!CreatedAt` | — |
| updated_at | timestamptz | Default `now()` | ISO-8601 | — | `ChatThreads!UpdatedAt` | — |
| last_message_at | timestamptz | Nullable | ISO-8601 | NULL | `ChatThreads!LastMessageAt` | — |
| last_message_by | text | Nullable | `user` / `provider` | NULL | `ChatThreads!LastMessageBy` | — |
| unread_user_count | integer | Default 0 | non-negative | `0` | `ChatThreads!UnreadUserCount` | — |
| unread_provider_count | integer | Default 0 | non-negative | `0` | `ChatThreads!UnreadProviderCount` | — |
| thread_status | text | Default `'active'` | `active` / `closed` / `archived` | `active` | `ChatThreads!ThreadStatus` | — |
| moderation_reason | text | Nullable | freeform | NULL | `ChatThreads!ModerationReason` | — |
| last_moderated_at | timestamptz | Nullable | ISO-8601 | NULL | `ChatThreads!LastModeratedAt` | — |
| last_moderated_by | text | Nullable | admin phone | NULL | `ChatThreads!LastModeratedBy` | — |

### B.14 `chat_messages`
Committed in `docs/admin-slice-17-chat.sql`. **`thread_id` has FK with `ON DELETE CASCADE` — import threads first.**

| Column | Type | Required? | Format | Example | Sheet column | Import note |
|---|---|---|---|---|---|---|
| message_id | text | Required (PK) | `MSG-{epoch}-{rand}` | `MSG-1717000001-XYZ` | `ChatMessages!MessageID` | Preserve legacy IDs to keep ordering stable. |
| thread_id | text | Required (FK → chat_threads) | matches `chat_threads.thread_id` | `CHT-TK-1717-PRV-001` | `ChatMessages!ThreadID` | FK enforced. |
| task_id | text | Required | matches `tasks.task_id` | `TK-1717000000000` | `ChatMessages!TaskID` | — |
| sender_type | text | Required | `user` / `provider` / `admin` (lowercase) | `user` | `ChatMessages!SenderType` | — |
| sender_phone | text | Default `''` | 10-digit | `9876543210` | `ChatMessages!SenderPhone` | — |
| sender_name | text | Nullable | trimmed | `Rajesh` | `ChatMessages!SenderName` | — |
| message_text | text | Required | freeform | `Aaj sham aana hai?` | `ChatMessages!MessageText` | — |
| message_type | text | Default `'text'` | `text` / `system` / future media | `text` | `ChatMessages!MessageType` | — |
| created_at | timestamptz | Default `now()` | ISO-8601 | — | `ChatMessages!CreatedAt` | Pass legacy timestamp — message ordering depends on it. |
| read_by_user | text | Default `'no'` | `yes` / `no` | `no` | `ChatMessages!ReadByUser` | Stored as text, not boolean. |
| read_by_provider | text | Default `'no'` | `yes` / `no` | `no` | `ChatMessages!ReadByProvider` | — |
| moderation_status | text | Default `'clear'` | `clear` / `flagged` | `clear` | `ChatMessages!ModerationStatus` | — |
| flag_reason | text | Nullable | freeform | NULL | `ChatMessages!FlagReason` | — |
| contains_blocked_word | text | Default `'no'` | `yes` / `no` | `no` | `ChatMessages!ContainsBlockedWord` | — |

### B.15 `needs`
Committed in `docs/admin-slice-27-needs.sql`. (NOTE: I-Need feature is publicly paused; backend tables remain.)

| Column | Type | Required? | Format | Example | Sheet column | Import note |
|---|---|---|---|---|---|---|
| need_id | text | Required (PK) | `ND-####` | `ND-0042` | `Needs!NeedID` | App generates 4-digit zero-padded sequential IDs; preserve legacy. |
| user_phone | text | Required | 10-digit | `9876543210` | `Needs!UserPhone` | — |
| display_name | text | Default `''` | trimmed | `Rajesh` | `Needs!DisplayName` | Empty string when `is_anonymous=true`. |
| is_anonymous | boolean | Default false | true / false | `false` | `Needs!IsAnonymous` | — |
| category | text | Default `''` | i-need taxonomy (Employer / Property Seller / etc.) | `Employer` | `Needs!Category` | NOT the same taxonomy as `categories` — i-need uses fixed types. |
| area | text | Default `''` | comma-separated canonical areas | `Sardarpura, Ratanada` | `Needs!Area` | App stores as comma-joined string from a multi-select. |
| title | text | Default `''` | trimmed | `Looking for plumber` | `Needs!Title` | — |
| description | text | Default `''` | freeform | — | `Needs!Description` | — |
| status | text | Default `'open'` (CHECK in `'open','completed','closed'`) | `open` / `completed` / `closed` | `open` | `Needs!Status` | CHECK constraint will reject other values. |
| created_at | timestamptz | Default `now()` | ISO-8601 | — | `Needs!CreatedAt` | — |
| updated_at | timestamptz | Default `now()` | ISO-8601 | — | `Needs!UpdatedAt` | — |
| valid_days | integer | Default 7 | 3 / 7 / 15 / 30 (app-validated) | `7` | `Needs!ValidDays` | App accepts only those four values. |
| expires_at | timestamptz | Nullable | ISO-8601 = `created_at + valid_days` | `2026-04-22T00:00:00Z` | `Needs!ExpiresAt` | Compute on import: `created_at + valid_days * interval '1 day'`. |
| completed_at | timestamptz | Nullable | ISO-8601 | NULL | `Needs!CompletedAt` | — |
| closed_at | timestamptz | Nullable | ISO-8601 | NULL | `Needs!ClosedAt` | — |
| closed_by | text | Default `''` | `user` / `admin` | `''` | `Needs!ClosedBy` | — |
| is_hidden | boolean | Default false | true / false | `false` | `Needs!IsHidden` | Admin "hide need" sets true. |

### B.16 `need_chat_threads`
Reconstructed from `web/lib/chat/chatPersistence.ts`. **No committed CREATE TABLE statement.**

| Column | Type | Required? | Format | Example | Sheet column | Import note |
|---|---|---|---|---|---|---|
| thread_id | text | Required (PK) | `NCT-{needId}-{responderPhone}` | `NCT-ND-0042-9876543210` | `NeedChatThreads!ThreadID` | Preserve legacy IDs. |
| need_id | text | Required | matches `needs.need_id` | `ND-0042` | `NeedChatThreads!NeedID` | — |
| poster_phone | text | Required | 10-digit | `9876543210` | `NeedChatThreads!PosterPhone` | — |
| responder_phone | text | Required | 10-digit | `9123456780` | `NeedChatThreads!ResponderPhone` | — |
| status | text | Nullable (default `'active'` from app) | `active` / `closed` | `active` | `NeedChatThreads!Status` | — |
| created_at | timestamptz | Required | ISO-8601 | — | `NeedChatThreads!CreatedAt` | App writes explicitly. |
| updated_at | timestamptz | Required | ISO-8601 | — | `NeedChatThreads!UpdatedAt` | App writes explicitly. |
| last_message_at | timestamptz | Nullable | ISO-8601 | NULL | `NeedChatThreads!LastMessageAt` | — |
| last_message_by | text | Nullable | `poster` / `responder` | NULL | `NeedChatThreads!LastMessageBy` | — |
| unread_poster_count | integer | Default 0 | non-negative | `0` | `NeedChatThreads!UnreadPosterCount` | — |
| unread_responder_count | integer | Default 0 | non-negative | `0` | `NeedChatThreads!UnreadResponderCount` | — |

### B.17 `need_chat_messages`
Reconstructed from `web/lib/chat/chatPersistence.ts`. **No committed CREATE TABLE statement.**

| Column | Type | Required? | Format | Example | Sheet column | Import note |
|---|---|---|---|---|---|---|
| message_id | text | Required (PK) | `MSG-{epoch}-{rand}` | `MSG-1717000050-ABC` | `NeedChatMessages!MessageID` | — |
| thread_id | text | Required | matches `need_chat_threads.thread_id` | `NCT-ND-0042-9876543210` | `NeedChatMessages!ThreadID` | FK presence not confirmed in repo — verify in DB. |
| need_id | text | Required | matches `needs.need_id` | `ND-0042` | `NeedChatMessages!NeedID` | — |
| sender_role | text | Required | `poster` / `responder` (lowercase) | `poster` | `NeedChatMessages!SenderRole` | App enforces lowercase. |
| sender_phone | text | Required | 10-digit | `9876543210` | `NeedChatMessages!SenderPhone` | — |
| message_text | text | Required | freeform | — | `NeedChatMessages!MessageText` | — |
| created_at | timestamptz | Required | ISO-8601 | — | `NeedChatMessages!CreatedAt` | — |
| read_by_poster | text | Default `'no'` | `yes` / `no` | `no` | `NeedChatMessages!ReadByPoster` | — |
| read_by_responder | text | Default `'no'` | `yes` / `no` | `no` | `NeedChatMessages!ReadByResponder` | — |

### B.18 `pending_category_requests`
Reconstructed from `web/lib/admin/adminCategoryMutations.ts` and `web/app/api/kk/route.ts` insert. **No committed CREATE TABLE statement.**

| Column | Type | Required? | Format | Example | Sheet column | Import note |
|---|---|---|---|---|---|---|
| id | uuid | **Generated** | — | — | — | **Skip.** Default Supabase UUID. |
| request_id | text | Required (UNIQUE) | `PCR-{uuid}` | `PCR-7b3b…` | `PendingCategories!request_id` | Mutation code matches by both `id` and `request_id` for backwards compat. |
| provider_id | text | Nullable | matches `providers.provider_id` | `PRV-0123` | `PendingCategories!ProviderID` | — |
| provider_name | text | Nullable | trimmed | `Sharma Plumbing` | `PendingCategories!ProviderName` | — |
| user_phone | text | Nullable | 10-digit | `9876543210` | `PendingCategories!Phone` | The route inserts `phone` column, but the read accepts both `user_phone` and `phone`. **Confirm the actual DB column name** before bulk insert. |
| requested_category | text | Required | trimmed | `Welding` | `PendingCategories!RequestedCategory` | Cannot duplicate-detect on case here — store as user typed. |
| area | text | Nullable | matches `areas.area_name` | `Sardarpura` | `PendingCategories!Area` | Read code surfaces it; write code does not always include it. |
| status | text | Default `'pending'` | `pending` / `approved` / `rejected` / `closed` / `archived` / `deleted_by_admin` | `pending` | `PendingCategories!Status` | — |
| created_at | timestamptz | Default `now()` | ISO-8601 | — | `PendingCategories!CreatedAt` | Pass legacy timestamp explicitly. |
| admin_action_by | text | Nullable | admin name or phone | NULL | `PendingCategories!AdminActionBy` | — |
| admin_action_at | timestamptz | Nullable | ISO-8601 | NULL | `PendingCategories!AdminActionAt` | — |
| admin_action_reason | text | Nullable | freeform | NULL | `PendingCategories!AdminActionReason` | — |

### B.19 `issue_reports`
Committed in `docs/admin-slice-issue-reports.sql`.

| Column | Type | Required? | Format | Example | Sheet column | Import note |
|---|---|---|---|---|---|---|
| issue_id | text | Required (PK) | `ISS-{epoch}-{rand}` | `ISS-1717000099-AAA` | `IssueReports!IssueID` | App-generated text — preserve legacy IDs. |
| created_at | timestamptz | Default `now()` | ISO-8601 | — | `IssueReports!CreatedAt` | — |
| reporter_role | text | Default `'user'` | `user` / `provider` / `admin` | `user` | `IssueReports!ReporterRole` | — |
| reporter_phone | text | Default `''` | 10-digit (session phone passes through) | `9876543210` | `IssueReports!ReporterPhone` | Match the format chosen for users. |
| reporter_name | text | Nullable | trimmed | `Rajesh` | `IssueReports!ReporterName` | — |
| issue_type | text | Default `''` | `bug` / `payment` / `other` etc. | `bug` | `IssueReports!IssueType` | — |
| issue_page | text | Default `''` | route path | `/i-need/post` | `IssueReports!IssuePage` | — |
| description | text | Default `''` | freeform (≥10 chars enforced app-side) | — | `IssueReports!Description` | — |
| status | text | Default `'open'` | `open` / `in_progress` / `resolved` / `closed` | `open` | `IssueReports!Status` | — |
| priority | text | Default `'normal'` | `low` / `normal` / `high` / `critical` | `normal` | `IssueReports!Priority` | — |
| admin_notes | text | Nullable | freeform | NULL | `IssueReports!AdminNotes` | — |
| resolved_at | timestamptz | Nullable | ISO-8601 | NULL | `IssueReports!ResolvedAt` | — |

### B.20 `whatsapp_inbound`
Committed in `docs/migrations/whatsapp-inbound.sql`. **Optional table — no Apps Script source data exists; only forward-only data from new webhook.**

| Column | Type | Required? | Format | Example | Sheet column | Import note |
|---|---|---|---|---|---|---|
| id | uuid | **Generated** | `gen_random_uuid()` | — | n/a | Skip. |
| received_at | timestamptz | Default `now()` | ISO-8601 | — | n/a | Skip. |
| source | text | Required | `meta_webhook` | `meta_webhook` | n/a | — |
| message_id | text | Nullable | WAMID | NULL | n/a | — |
| status | text | Nullable | `delivered` / `read` / `failed` | NULL | n/a | — |
| from_phone | text | Nullable | E.164 | NULL | n/a | — |
| to_phone | text | Nullable | E.164 | NULL | n/a | — |
| template_name | text | Nullable | template id | NULL | n/a | — |
| payload | jsonb | Required | full Meta payload | `{...}` | n/a | — |

---

## C. Google Sheets → Supabase field mapping (compact)

| Google Sheet → tab → column | Supabase target | Transformation |
|---|---|---|
| Admins → phone | `admins.phone` | normalise to 12-digit `91…` |
| Admins → permissions (CSV) | `admins.permissions` | `string_to_array(value, ',')` |
| Users → phone | `profiles.phone` | normalise to 12-digit `91…` |
| Categories → name | `categories.name` | trim, preserve casing |
| Categories → active | `categories.active` | `'yes'` → true, `'no'` → false |
| Areas → area_name | `areas.area_name` | trim, preserve casing |
| AreaAliases → alias_name + canonical_area | `area_aliases.*` | validate canonical against `areas.area_name` |
| Providers → ProviderID | `providers.provider_id` | preserve verbatim |
| Providers → Name | `providers.full_name` | preserve casing (app uppercases new entries) |
| Providers → Phone | `providers.phone` | normalise to 10-digit (recommended) |
| Providers → Verified ("yes"/"no") | `providers.verified` | keep as `'yes'`/`'no'` text — **not boolean** |
| Providers → Status (Active/Pending/Blocked) | `providers.status` | lowercase to `'active'`/`'pending'`/`'blocked'` |
| Providers → Categories (CSV) | `provider_services` (one row per item) | split CSV; canonicalise to `categories.name` casing |
| Providers → Areas (CSV) | `provider_areas` (one row per item) | split CSV; resolve via `area_aliases` first |
| Tasks → TaskID | `tasks.task_id` | preserve verbatim |
| Tasks → DisplayID | **skip** | DB sequence generates it |
| Tasks → UserPhone | `tasks.phone` | normalise to 10-digit |
| Tasks → Status | `tasks.status` | lowercase |
| ProviderTaskMatches → MatchStatus | `provider_task_matches.match_status` | lowercase |
| NotificationLogs → LogID | `notification_logs.log_id` | preserve |
| ChatThreads → ThreadID | `chat_threads.thread_id` | preserve (cascades to messages) |
| ChatMessages → ThreadID | `chat_messages.thread_id` | preserve (FK enforced) |
| ChatMessages → ReadByUser/Provider | `read_by_user` / `read_by_provider` | `'yes'`/`'no'` text — **not boolean** |
| Needs → NeedID | `needs.need_id` | preserve `ND-####` |
| Needs → ExpiresAt | `needs.expires_at` | compute = created_at + valid_days days if missing |
| NeedChat* → SenderRole | `need_chat_*.sender_role` | lowercase to `poster`/`responder` |
| PendingCategories → request_id | `pending_category_requests.request_id` | preserve `PCR-…`; also let `id` UUID auto-generate |
| IssueReports → IssueID | `issue_reports.issue_id` | preserve |

---

## D. Fields to skip during import

These are auto-generated or maintained by the database/application and should **not** appear in your INSERT payloads (or you risk constraint violations / duplicate sequences / shifted IDs):

| Table | Column | Why |
|---|---|---|
| `areas` | `id` | `BIGSERIAL` — Postgres assigns. |
| `area_aliases` | `id` | `BIGSERIAL`. |
| `pending_category_requests` | `id` | `uuid` default. |
| `whatsapp_inbound` | `id` | `gen_random_uuid()` default. |
| `tasks` | `display_id` | Inferred to be a `BIGSERIAL` / sequence-default — code reads it back via `.select("display_id")` after insert. **Confirm in Supabase before any bulk insert; if you pass a value, the sequence will not advance and future inserts will collide.** |
| ALL tables | `created_at` (when default `now()`) | Only pass an explicit value when you need to preserve a legacy timestamp. Otherwise omit. |
| ALL tables | `updated_at` (when default `now()`) | Same. |
| `providers` | `duplicate_name_review_status`, `duplicate_name_matches`, `duplicate_name_flagged_at`, `duplicate_name_resolved_at`, `duplicate_name_admin_phone`, `duplicate_name_reason` | All nullable — only set when migrating an in-flight review. Default NULL means "never flagged". |
| `notification_logs` | n/a | All columns are imported, but `log_id` should always be the legacy value. |

---

## E. Required cleanup / normalisation rules

### E.1 Phone numbers (HIGHEST risk)
| Where | Canonical form |
|---|---|
| `admins.phone` | **12-digit `91XXXXXXXXXX`** — `verifyAdminByPhone` matches by exact equality. |
| `profiles.phone` | **12-digit `91XXXXXXXXXX`** — OTP verify route writes 12-digit; legacy 10-digit rows must be normalised. |
| `providers.phone` | **10-digit** recommended — `getProviderByPhoneFromSupabase` queries both `phone.eq.<10>` and `phone.eq.91<10>`, but `tasks.phone` is 10-digit, so picking 10-digit eliminates a hot-path mismatch. |
| `tasks.phone` | **10-digit** (`session.phone` already normalised before insert). |
| `chat_threads.user_phone`, `chat_threads.provider_phone`, `chat_messages.sender_phone` | Same as `tasks.phone` / `providers.phone` — keep consistent. |
| `notification_logs.provider_phone` | Whatever `providers.phone` is — code does not re-normalise. |
| `needs.user_phone`, `need_chat_threads.poster_phone`, `need_chat_threads.responder_phone`, `need_chat_messages.sender_phone` | **10-digit** (app explicitly normalises with `.slice(-10)` everywhere). |
| `whatsapp_inbound.from_phone`, `whatsapp_inbound.to_phone` | E.164 (with `+91…` from Meta) — leave as-received. |
| `issue_reports.reporter_phone` | Match the format used for users (12-digit if you take from `profiles`, 10-digit if from sessions). |

**Recommendation:** before import, write a one-shot SQL audit:

```sql
-- After import, run this. Should return zero rows.
select 'providers' as t, count(*) from providers where length(regexp_replace(phone,'\D','','g')) not in (10,12)
union all
select 'tasks',     count(*) from tasks     where length(regexp_replace(phone,'\D','','g')) not in (10,12)
union all
select 'profiles',  count(*) from profiles  where length(regexp_replace(phone,'\D','','g')) not in (10,12)
union all
select 'admins',    count(*) from admins    where length(phone) <> 12 or phone not like '91%';
```

### E.2 Category casing
- All matching paths now use `.ilike("name", value)` so case mismatches no longer break matching.
- However: store in `categories.name` with a **single canonical casing** (e.g. Title Case) so analytics and dashboard read clean.
- For `provider_services.category`, `tasks.category`, `provider_task_matches.category`, `notification_logs.category`, `chat_threads.category` — best-effort canonicalise to the matching `categories.name` casing. The active matching code accepts any casing, so legacy rows are not blockers, but consistency helps the eye.

### E.3 Area canonicalisation
- All `areas.area_name` values should be the canonical form.
- Every area-bearing field (`provider_areas.area`, `tasks.area`, `needs.area`, `provider_task_matches.area`, `chat_threads.area`, `notification_logs.area`) should have been resolved through `area_aliases` first. If a legacy row contains an alias (e.g. "Boranada Jodhpur"), look it up in `area_aliases` and write the canonical (`"Boranada"`) instead.
- Multi-area columns (`needs.area`) are stored as comma-joined canonical names: `"Sardarpura, Ratanada"`.

### E.4 Boolean vs string flags
| Column | Storage |
|---|---|
| `categories.active` | **boolean** (legacy reads tolerate `"yes"`/`"no"` strings — write as boolean). |
| `areas.active`, `area_aliases.active` | **boolean** |
| `admins.active` | **boolean** |
| `providers.verified` | **text** `'yes'` / `'no'` — write/read code uses string literals. **Do not migrate to boolean.** |
| `chat_messages.read_by_user`, `read_by_provider`, `contains_blocked_word` | **text** `'yes'` / `'no'`. |
| `need_chat_messages.read_by_poster`, `read_by_responder` | **text** `'yes'` / `'no'`. |
| `needs.is_anonymous`, `needs.is_hidden` | **boolean**. |
| `profiles.is_active` | **boolean**. |

### E.5 Status enums (lowercase)
Every `status` column in this database stores lowercase strings. Apps Script may have stored mixed-case (`Active`, `PENDING`). Lowercase before insert.

### E.6 Identifier mappings
| Sheet column | Supabase column |
|---|---|
| `ProviderID` | `provider_id` |
| `TaskID` | `task_id` |
| `NeedID` | `need_id` |
| `ThreadID` | `thread_id` |
| `MessageID` | `message_id` |
| `LogID` | `log_id` |
| `IssueID` | `issue_id` |
| `RequestID` | `request_id` (PCR-…) — distinct from auto-uuid `id` |
| `ReviewID` | `review_id` |

### E.7 Timestamps
- All `*_at` columns are `timestamptz`. Use ISO-8601 with timezone: `2026-04-15T08:30:00Z` or `2026-04-15T14:00:00+05:30`.
- Apps Script likely has IST timestamps as `15/04/2026 14:00:00` — convert to ISO-8601 before insert (Postgres won't parse IST format in COPY).
- `service_date` is a plain `date` column — `YYYY-MM-DD`.

### E.8 Arrays vs joined rows
| Source pattern | Target |
|---|---|
| `Providers!Categories` = `"Plumber, Electrician"` | One row in `provider_services` per category. |
| `Providers!Areas` = `"Sardarpura, Ratanada"` | One row in `provider_areas` per area. |
| `Admins!permissions` = `"providers:write,categories:write"` | Postgres `text[]` array — split on comma. |
| `Needs!Area` (multi-select) | Single `needs.area` column with comma-joined string (NOT a separate table). |

---

## F. Pre-import risk checklist

Tick every box before running any insert:

- [ ] `APPS_SCRIPT_URL` is **unset** in production env (or you've decided to leave it set — see prior audit report).
- [ ] Schema for tables in section H ("missing/unknown") confirmed by reading the live `information_schema.columns` in Supabase.
- [ ] `tasks.display_id` confirmed as sequence/serial (so you know to skip it on import).
- [ ] Phone-format decision made and documented (12-digit vs 10-digit per table).
- [ ] Category names from sheets cross-checked against `categories.name`. Any unknown categories: either added to master, or routed into `pending_category_requests`.
- [ ] Area names from sheets cross-checked against `areas.area_name` and `area_aliases.alias_name`. Aliases resolved.
- [ ] Foreign keys identified: `chat_messages.thread_id → chat_threads.thread_id` cascade. No orphan messages.
- [ ] All status values lowercased.
- [ ] All timestamps converted to ISO-8601.
- [ ] CSVs exploded into multiple rows (provider_services, provider_areas).
- [ ] Backup of the target Supabase project taken (use `pg_dump` or Supabase point-in-time restore).
- [ ] Dry-run on a copy of the project, NOT production, with the queries in section G.
- [ ] Smoke-test plan ready: post a request, confirm `/api/find-provider` matches a migrated provider, confirm `/api/my-requests` lists the new task.

---

## G. Suggested dry-run validation queries

Run **after** import but **before** opening to traffic.

### G.1 Row-count parity (sheet vs db)
```sql
select 'providers'         as t, count(*) from providers
union all select 'provider_services', count(*) from provider_services
union all select 'provider_areas',    count(*) from provider_areas
union all select 'tasks',             count(*) from tasks
union all select 'provider_task_matches', count(*) from provider_task_matches
union all select 'notification_logs', count(*) from notification_logs
union all select 'categories',        count(*) from categories
union all select 'areas',             count(*) from areas
union all select 'area_aliases',      count(*) from area_aliases
union all select 'area_review_queue', count(*) from area_review_queue
union all select 'needs',             count(*) from needs
union all select 'chat_threads',      count(*) from chat_threads
union all select 'chat_messages',     count(*) from chat_messages
union all select 'need_chat_threads', count(*) from need_chat_threads
union all select 'need_chat_messages',count(*) from need_chat_messages
union all select 'pending_category_requests', count(*) from pending_category_requests
union all select 'issue_reports',     count(*) from issue_reports
union all select 'admins',            count(*) from admins
union all select 'profiles',          count(*) from profiles
order by t;
```

### G.2 Phone format audit (must return zero rows)
```sql
select 'providers'  as t, provider_id, phone from providers
where length(regexp_replace(phone,'\D','','g')) not in (10, 12)
union all
select 'tasks',  task_id, phone from tasks
where length(regexp_replace(phone,'\D','','g')) not in (10, 12)
union all
select 'admins', phone, phone from admins
where phone !~ '^91[0-9]{10}$';
```

### G.3 FK orphan checks (must return zero rows)
```sql
-- chat_messages without parent thread (FK should already prevent this; sanity check).
select message_id, thread_id from chat_messages
where thread_id not in (select thread_id from chat_threads);

-- provider_task_matches whose provider doesn't exist
select task_id, provider_id from provider_task_matches
where provider_id not in (select provider_id from providers);

-- provider_services without provider
select provider_id, category from provider_services
where provider_id not in (select provider_id from providers);

-- provider_areas without provider
select provider_id, area from provider_areas
where provider_id not in (select provider_id from providers);

-- tasks with phone that has no profile (warning, not blocker — guests post)
select task_id, phone from tasks
where right(regexp_replace(phone,'\D','','g'), 10)
   not in (select right(regexp_replace(phone,'\D','','g'), 10) from profiles);
```

### G.4 Category / area canonical drift (rows to investigate)
```sql
-- Tasks whose category is not in master
select task_id, category from tasks
where lower(category) not in (select lower(name) from categories);

-- provider_services whose category is not in master
select provider_id, category from provider_services
where lower(category) not in (select lower(name) from categories);

-- provider_areas whose area is not a canonical area or known alias
select provider_id, area from provider_areas
where lower(area) not in (select lower(area_name) from areas)
  and lower(area) not in (select lower(canonical_area) from area_aliases);
```

### G.5 Status sanity (every status value should be lowercase / known)
```sql
select distinct status from tasks;
select distinct status from providers;
select distinct match_status from provider_task_matches;
select distinct status from chat_threads;
select distinct status from notification_logs;
select distinct status from needs;
```

### G.6 Display-ID monotonicity (proves you didn't accidentally insert a value)
```sql
-- After import, the next insert should produce display_id = max(display_id) + 1.
-- If your sheet's largest DisplayID is 1247, the sequence should now be at >=1248.
select max(display_id::int) from tasks;
-- Compare against:
select last_value from pg_sequences where sequencename like 'tasks_display_id_seq%';
```

### G.7 OTP table is empty
```sql
-- Should be 0 — OTPs are short-lived and never backfilled.
select count(*) from otp_requests;
```

---

## H. Tables with NO committed schema (audit warning)

The following tables are referenced extensively by application code but have **no committed `CREATE TABLE` statement** in the repo. The schemas in section B were reconstructed from the columns the code reads/writes — they may be incomplete (the live DB may have additional columns / constraints).

**Before importing into any of these, run `\d table_name` (psql) or use the Supabase Table Editor to confirm the live shape:**

1. `admins`
2. `profiles`
3. `categories`
4. `providers` (base columns; duplicate-name columns ARE in committed SQL)
5. `provider_services`
6. `provider_areas`
7. `tasks` (closure columns ARE in committed SQL; base columns are not)
8. `provider_task_matches`
9. `pending_category_requests`
10. `need_chat_threads`
11. `need_chat_messages`
12. `otp_requests`

For tables 1–9, recommend creating retroactive `CREATE TABLE` migration files in `docs/migrations/` once you've confirmed the live schema, so future imports / disaster recovery have a single source of truth.

Tables WITH committed CREATE statements (safe — schemas are authoritative): `areas`, `area_aliases`, `area_review_queue`, `notification_logs`, `chat_threads`, `chat_messages`, `needs`, `issue_reports`, `whatsapp_inbound`, `local_needs`, `local_need_comments`.

---

*End of import format guide. Audit only — no data was imported.*
