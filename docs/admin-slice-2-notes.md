# Admin Migration — Slice 2 Notes

**Date:** 2026-04-19  
**Goal:** Replace GAS as the primary admin verification source with Supabase. Keep GAS as an explicit, labeled fallback during the seeding transition.

---

## Files Changed

| File | Type | Change |
|---|---|---|
| `web/lib/admin/adminVerifier.ts` | **Updated** | Implemented `verifyAdminViaBackend()` against Supabase `admins` table; `verifyAdminByPhone()` now tries backend first, GAS second |

No other files changed. `lib/adminAuth.ts`, all routes, all frontend code — untouched.

---

## Backend Source of Truth Used

**Supabase — service-role client (`lib/supabase/admin.ts → adminSupabase`)**

- Environment variables present in `.env.local`: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`
- Client already existed in repo, was unused for admin auth
- Table: `admins` — must be created manually (SQL below)

No new database client was created. The existing `adminSupabase` service-role client is used as-is.

---

## Required: Create admins Table in Supabase

Run this in the Supabase SQL editor for project `ovloeohrjmhrisjhykwj`:

```sql
CREATE TABLE IF NOT EXISTS admins (
  phone       TEXT        PRIMARY KEY,
  name        TEXT,
  role        TEXT        NOT NULL DEFAULT 'admin',
  permissions JSONB       NOT NULL DEFAULT '[]',
  active      BOOLEAN     NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Row-level security: this table is only accessed by the service role.
-- No anon or authenticated-role access needed.
ALTER TABLE admins ENABLE ROW LEVEL SECURITY;
```

## Required: Seed the Table

Export the current Admins sheet from the GAS spreadsheet
(`1xCgM4HnsnYj7XEH6786urLH-V2SmOdmi6koijia_zQo`) and insert rows in this format:

```sql
INSERT INTO admins (phone, name, role, permissions, active)
VALUES
  ('91XXXXXXXXXX', 'Admin Name', 'admin', '["approve_providers","approve_categories"]', true);
```

**Phone format:** `91` + 10-digit Indian mobile = 12 characters. This is the same format stored in `kk_auth_session` by the OTP login flow. Do not use `+91` or bare 10-digit format — it must match exactly.

---

## Exact New Flow

```
verifyAdminByPhone(phone)
  → verifyAdminViaBackend(phone)
      → dynamic import adminSupabase
      → SELECT phone, name, role, permissions FROM admins
        WHERE phone = $phone AND active = true
        LIMIT 1
      → if found: return { ok: true, admin: { phone, name, role, permissions[] } }
      → if not found OR any error: return { ok: false }
  → if ok=true: return backend result   ← GAS no longer called
  → if ok=false: verifyAdminViaGAS(phone)  ← fallback during transition
      → POST APPS_SCRIPT_URL { action: "admin_verify", phone }
      → return { ok: true, admin } or { ok: false }
```

---

## What Still Depends on GAS After This Slice

| Dependency | Location | Condition |
|---|---|---|
| `admin_verify` fallback | `adminVerifier.ts → verifyAdminViaGAS()` | Only called when backend returns `ok: false` (table unseeded, phone not found, or Supabase error) |
| All `admin_*` data actions | `app/api/kk/route.ts` proxy | Unchanged — not part of this slice |
| `/api/admin-verify` login endpoint | `app/api/admin-verify/route.ts` | Still proxies to `/api/kk` → GAS for the login response shape (data only — auth guard now hits Supabase first) |

---

## What No Longer Depends Directly on GAS

| What | Notes |
|---|---|
| Auth gate for all `ADMIN_ONLY_ACTIONS` | Once `admins` table is seeded: `requireAdminSession()` → `checkAdminByPhone()` → `verifyAdminByPhone()` → Supabase. GAS not called at all for verified admins. |
| Auth gate for `/api/admin/stats` | Same path — Supabase is primary |

---

## AdminSession Contract — Preserved Exactly

```typescript
type AdminSession = {
  phone: string;       // "91XXXXXXXXXX" — always present
  name?: string;       // from admins.name
  role?: string;       // from admins.role (default: "admin")
  permissions?: string[]; // from admins.permissions JSONB array
}
```

The shape is identical to what GAS returned. No callers need changes.

---

## Fallback Safety Logic

The GAS fallback fires when `verifyAdminViaBackend` returns `{ ok: false }`. This happens in three cases:

| Case | Behavior |
|---|---|
| `admins` table does not exist yet | Supabase returns error → fallback to GAS → admin can still log in |
| Table exists but phone not in it | Returns `ok: false` → fallback to GAS → admin can still log in via GAS |
| Supabase is down | Catches error → fallback to GAS → no admin lockout |

Once the table is seeded and confirmed, the fallback should be removed so that GAS removal from the admin auth path is clean and intentional.

---

## Risks & Assumptions

| Risk | Severity | Notes |
|---|---|---|
| `admins` table not yet created | Medium | Backend returns `ok: false`, GAS fallback keeps admins working |
| Phone format mismatch (e.g. `+91...` vs `91...`) | **High** | Must seed table with exact 12-char `91XXXXXXXXXX` format |
| GAS fallback allows entry if removed from Supabase but still in GAS | Low | Only relevant during the transition window; remove fallback after seeding |
| `adminSupabase` module-level throw if env missing | None in current env | Both `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` present in `.env.local` |

---

## Recommended Next Slice (Slice 3)

**Seed the `admins` table and remove the GAS fallback.**

Steps:
1. Create the `admins` table (SQL above).
2. Export admin records from the GAS Admins sheet and insert them.
3. Test: admin login → confirm Supabase is hit, GAS is not.
4. Remove `verifyAdminViaGAS()` call from `verifyAdminByPhone()` in `adminVerifier.ts`.
5. Remove `verifyAdminViaGAS()` function entirely (or keep as dead code for emergency reference).
6. Delete the `TODO(admin-slice-3)` comment.

After Slice 3, admin identity verification has zero GAS dependency.
