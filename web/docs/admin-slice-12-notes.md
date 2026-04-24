# Admin Migration — Slice 12 Notes

**Date:** 2026-04-19  
**Goal:** Migrate `get_admin_requests` (admin task list read) off GAS. After this slice, the admin dashboard task list reads from Supabase instead of GAS, closing the read–write divergence introduced in Slice 11.

---

## Files Changed

| File | Type | Change |
|---|---|---|
| `web/lib/admin/adminTaskReads.ts` | **New** | `getAdminRequestsFromSupabase()` — full task list read with computed fields |
| `web/app/api/kk/route.ts` | **Updated** | Intercepts `get_admin_requests` and `admin_get_requests` before GAS proxy |

---

## Actions Migrated

| Action | Handler function | Notes |
|---|---|---|
| `get_admin_requests` | `getAdminRequestsFromSupabase()` | Also used by chat page — no auth guard on intercept |
| `admin_get_requests` | same | Admin dashboard variant |

---

## Schema Prerequisites (carried from Slice 11)

```sql
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS assigned_provider_id TEXT;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ;
```

---

## Old Flow

```
POST /api/kk { action: "get_admin_requests" }
  → GAS APPS_SCRIPT_URL
  → GAS reads Tasks sheet + Providers sheet
  → { ok: true, status: "success", requests: AdminRequest[], metrics: AdminRequestMetrics }
```

---

## New Flow

```
POST /api/kk { action: "get_admin_requests" }
  → intercepted in /api/kk POST handler (no auth guard — chat page also calls this)
  → getAdminRequestsFromSupabase()
      → adminSupabase.from("tasks").select(...).order("created_at", desc)
      → adminSupabase.from("provider_task_matches").select(...).in("task_id", taskIds)
      → adminSupabase.from("providers").select(...).in("provider_id", providerIds)
      → in-memory join → AdminRequest[]
      → compute metrics → AdminRequestMetrics
  → { ok: true, status: "success", requests: AdminRequest[], metrics: AdminRequestMetrics }
```

---

## Tables / Joins Used

| Table | Columns read | Usage |
|---|---|---|
| `tasks` | `task_id, display_id, category, area, details, phone, status, created_at, selected_timeframe, service_date, time_slot, assigned_provider_id, closed_at` | Base task row |
| `provider_task_matches` | `task_id, provider_id, match_status, created_at` | Notified providers, response status, notified_at |
| `providers` | `provider_id, full_name, phone, verified` | Provider name lookups for assigned/responded/matched providers |

---

## Response Contract Preserved

```typescript
{
  ok: true,
  status: "success",
  requests: AdminRequest[],
  metrics: AdminRequestMetrics
}
```

All `AdminRequest` fields populated:

| Field | Source |
|---|---|
| `TaskID` | `tasks.task_id` |
| `DisplayID` | `tasks.display_id` |
| `UserPhone` | `tasks.phone` |
| `Category` | `tasks.category` |
| `Area` | `tasks.area` |
| `Details` | `tasks.details` |
| `Status` | normalized from `tasks.status` (see below) |
| `RawStatus` | `tasks.status` raw value |
| `CreatedAt` | `tasks.created_at` (ISO) |
| `NotifiedAt` | earliest `provider_task_matches.created_at` for this task |
| `AssignedProvider` | `tasks.assigned_provider_id` |
| `AssignedProviderName` | `providers.full_name` for assigned provider |
| `ProviderResponseAt` | `provider_task_matches.created_at` for responded/accepted match |
| `RespondedProvider` | `provider_id` of responded match |
| `RespondedProviderName` | `providers.full_name` for responded provider |
| `LastReminderAt` | `""` — placeholder (reminder table not yet read here) |
| `CompletedAt` | `tasks.closed_at` (ISO) |
| `SelectedTimeframe` | normalized from `tasks.selected_timeframe` |
| `Priority` | derived from `SelectedTimeframe` (URGENT/PRIORITY/SAME_DAY/FLEXIBLE) |
| `Deadline` | computed from priority + `created_at` / `service_date` |
| `WaitingMinutes` | `Math.floor((now - created_at) / 60000)` |
| `ResponseWaitingMinutes` | `minutesSince(notifiedAt \|\| created_at)` |
| `IsOverdue` | `Deadline < now && status !== COMPLETED` |
| `IsExpired` | same as `IsOverdue` |
| `NeedsAttention` | `IsOverdue \|\| WaitingMinutes >= AttentionThresholdMinutes` |
| `AttentionThresholdMinutes` | per priority: URGENT=10, PRIORITY=30, SAME_DAY=60, FLEXIBLE=180 |
| `MinutesUntilDeadline` | `Math.floor((deadline - now) / 60000)` |
| `OverdueMinutes` | `\|MinutesUntilDeadline\|` when overdue |
| `ServiceDate` | `tasks.service_date` |
| `TimeSlot` | `tasks.time_slot` |
| `MatchedProviders` | `provider_id[]` from `provider_task_matches` |
| `MatchedProviderDetails` | full detail objects per matched provider |

---

## Status Normalization

| Supabase value | Dashboard value |
|---|---|
| `"submitted"` | `"NEW"` |
| `"notified"` | `"NOTIFIED"` |
| `"no_providers_matched"` | `"NEW"` |
| `"provider_responded"` | `"RESPONDED"` |
| `"assigned"` | `"ASSIGNED"` |
| `"closed"` or `"completed"` | `"COMPLETED"` |

If `completedAt` is set, status is always `"COMPLETED"` regardless of the raw status value.  
If `assignedProvider` is set, status is `"ASSIGNED"` regardless of raw value.

---

## Auth Guard

**Not added** — `get_admin_requests` is explicitly excluded from `ADMIN_ONLY_ACTIONS`. The same action is called by `app/chat/[taskId]/page.tsx` (not admin-authenticated) to look up task details. Adding auth would break the chat page. This matches the existing GAS behavior.

---

## Metrics Computed

`AdminRequestMetrics` is computed in-memory over the `AdminRequest[]` array:

| Metric | Computation |
|---|---|
| `urgentRequestsOpen` | Priority=URGENT and status≠COMPLETED |
| `priorityRequestsOpen` | Priority=PRIORITY and status≠COMPLETED |
| `overdueRequests` | IsOverdue=true and status≠COMPLETED |
| `newRequestsToday` | Status=NEW and created today |
| `pendingProviderResponse` | Status=NOTIFIED and no AssignedProvider |
| `requestsCompletedToday` | Status=COMPLETED and completed today |
| `averageResponseTimeMinutes` | mean of (ProviderResponseAt - CreatedAt) for responded tasks |
| `needsAttentionCount` | NeedsAttention=true and status≠COMPLETED |

---

## Closing the Read–Write Divergence from Slice 11

After Slice 11:
- Task mutations (`assign_provider`, `close_request`) write to Supabase ✓
- Task reads (`get_admin_requests`) still read from GAS ✗ → dashboard showed stale data

After Slice 12:
- Task mutations write to Supabase ✓
- Task reads read from Supabase ✓ → dashboard immediately reflects assignment and closure

The Supabase `tasks` table is now the sole authoritative source for the admin task management lifecycle.

---

## What Still Depends on GAS After Slice 12

| Feature | GAS dependency |
|---|---|
| Admin auth, stats | No |
| Category admin (all actions) | No |
| Provider admin (all actions) | No |
| Task mutations (assign, close) | No — Supabase (Slice 11) |
| Admin task list read | **No — Supabase (Slice 12)** |
| Area / alias management | Yes |
| Chat thread management | Yes |
| Notification logs | Yes |
| Issue reports | Yes |
| Team management | Yes |

---

## Recommended Next Slice (Slice 20 — chat)

Migrate open-chat thread loading and `admin_update_chat_thread_status` to Supabase-native paths via `chatPersistence.ts`.
