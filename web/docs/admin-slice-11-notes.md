# Admin Migration — Slice 11 Notes

**Date:** 2026-04-19  
**Goal:** Migrate `assign_provider` and `close_request` admin task actions off GAS. After this slice, these two mutations write to Supabase instead of GAS.

---

## Files Changed

| File | Type | Change |
|---|---|---|
| `web/lib/admin/adminTaskMutations.ts` | **New** | `assignProviderToTask()`, `closeTask()` |
| `web/app/api/kk/route.ts` | **Updated** | Intercepts `assign_provider` and `close_request` before GAS proxy |

---

## Schema Prerequisite

Run once in the Supabase SQL editor before deploying this slice:

```sql
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS assigned_provider_id TEXT;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ;
```

Neither column exists in the current `tasks` table. Without these columns, the `assign_provider` intercept will fail with a Supabase column error (caught and returned as `{ ok: false, error }`).

---

## Actions Migrated

| Action | Handler function | Fields written |
|---|---|---|
| `assign_provider` | `assignProviderToTask(taskId, providerId)` | `tasks.assigned_provider_id`, `tasks.status = "assigned"` |
| `close_request` | `closeTask(taskId)` | `tasks.status = "closed"`, `tasks.closed_at` |

---

## Old Flow

```
POST /api/kk { action: "assign_provider", taskId, providerId }
  → GAS APPS_SCRIPT_URL
  → GAS updates Tasks sheet: AssignedProvider = providerId, Status = "Assigned"
  → { ok: true/false }

POST /api/kk { action: "close_request", taskId }
  → GAS APPS_SCRIPT_URL
  → GAS updates Tasks sheet: Status = "Closed"
  → { ok: true/false }
```

---

## New Flow

```
POST /api/kk { action: "assign_provider", taskId, providerId }
  → intercepted in /api/kk POST handler
  → assignProviderToTask(taskId, providerId)
      → adminSupabase.from("tasks").update({
          assigned_provider_id: providerId,
          status: "assigned"
        }).eq("task_id", taskId)
  → { ok: true } | { ok: false, error }

POST /api/kk { action: "close_request", taskId }
  → intercepted in /api/kk POST handler
  → closeTask(taskId)
      → adminSupabase.from("tasks").update({
          status: "closed",
          closed_at: new Date().toISOString()
        }).eq("task_id", taskId)
  → { ok: true } | { ok: false, error }
```

---

## Response Contract Preserved

`{ ok: boolean, error?: string }` — unchanged for both actions.

---

## Tables / Columns Updated

| Table | Column | assign_provider | close_request |
|---|---|---|---|
| `tasks` | `status` | `"assigned"` | `"closed"` |
| `tasks` | `assigned_provider_id` | set to `providerId` | not touched |
| `tasks` | `closed_at` | not touched | set to server timestamp |

---

## Auth Guard

Both actions are in `ADMIN_ONLY_ACTIONS` in `/api/kk/route.ts`. The existing `requireAdminSession()` check fires before the body is parsed — no auth changes required.

---

## ⚠ Read–Write Divergence

This is the critical caveat for Slice 11.

After a successful `assign_provider` or `close_request`, the dashboard calls `fetchAdminRequests()`:

```typescript
const fetchAdminRequests = async () => {
  const res = await fetch("/api/kk", {
    method: "POST",
    body: JSON.stringify({ action: "get_admin_requests" }),
  });
  ...
};
```

`get_admin_requests` is **not** in `ADMIN_ONLY_ACTIONS` — it is explicitly excluded (comment in `/api/kk/route.ts`) because it is also used by the provider chat page. It passes straight through to GAS.

**Consequence:** The mutations write to Supabase. The dashboard reads from GAS. Until `get_admin_requests` is also migrated to Supabase, the dashboard task list will not immediately reflect an assignment or closure performed via Slice 11.

The mutation will return `{ ok: true }` from Supabase, and `fetchAdminRequests()` will reload GAS data — which will still show the task as unassigned/open.

**This is known and by design for incremental migration:**
- Tasks created via `submit-request` → Supabase are correctly updated in Supabase
- The Supabase `tasks` table is the authoritative source for the new task flow
- Migrating `get_admin_requests` to Supabase is the next step (Slice 12) and will close this loop

Until Slice 12 is deployed, the admin dashboard task list will continue to show GAS state. These mutations only affect Supabase-tracked tasks.

---

## Deferred Side Effects

### GAS did more than status updates

The original GAS `assign_provider` action may have:
- Sent a WhatsApp notification to the assigned provider
- Updated matched provider state in the Tasks sheet

The original GAS `close_request` action may have:
- Sent a closure notification to the user
- Marked related provider match records

**None of these side effects are replicated in Slice 11.**

These are not included because:
1. The exact side effects are undocumented (GAS source not available)
2. Replicating them would require `sendProviderLeadMessage` / WhatsApp send calls — introducing network dependencies and failure modes outside the scope of a "smallest safe change" slice
3. Until the task read path is also migrated, there is no clear user-visible benefit

**Recommendation:** Add notification side effects in a future slice dedicated to task notification logic, once `get_admin_requests` is Supabase-backed and the full task lifecycle is visible from Supabase.

---

## Task Status Values (Confirmed from Codebase)

| Status | Set by |
|---|---|
| `"submitted"` | `submit-request` route |
| `"notified"` | `process-task-notifications` route |
| `"no_providers_matched"` | `process-task-notifications` route |
| `"provider_responded"` | `tasks/respond` route |
| `"assigned"` | **Slice 11** — `assign_provider` |
| `"closed"` | **Slice 11** — `close_request` |

---

## What Still Depends on GAS After Slice 11

| Feature | GAS dependency |
|---|---|
| Admin auth, stats | No |
| Category admin (all actions) | No |
| Provider admin (all actions) | No |
| Task mutations (assign, close) | **No — Supabase** (but read still shows GAS data) |
| Admin task list read (`get_admin_requests`) | Yes — still GAS via `/api/kk` → GAS |
| Area / alias management | Yes |
| Chat thread management | Yes |
| Notification logs | Yes |
| Issue reports | Yes |
| Team management | Yes |

---

## Recommended Next Slice (Slice 12)

**Migrate `get_admin_requests` (admin task list read) to Supabase.**

This is the direct dependency needed to close the read–write divergence introduced in Slice 11. Once the task list reads from Supabase:
- Assignment and closure will immediately appear in the admin dashboard
- The full task lifecycle (submitted → notified → responded → assigned → closed) is visible from Supabase
- The Supabase `tasks` table becomes the sole authoritative source for admin task management

Key work needed:
1. Confirm all `AdminRequest` fields can be sourced from Supabase (`tasks`, `provider_task_matches`, `providers`)
2. Identify computed fields (WaitingMinutes, ResponseWaitingMinutes, IsOverdue, etc.) — decide whether to compute in query or in the API handler
3. Build a `GET /api/admin/tasks` or equivalent route
4. Update `fetchAdminRequests()` in the dashboard to call the new route instead of `/api/kk { action: "get_admin_requests" }`
