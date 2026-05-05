# Admin Migration — Slice 6 Notes

**Date:** 2026-04-19  
**Goal:** Remove the GAS fallback (`verifyAdminViaGAS`) from admin verification. Admin auth is now permanently backend-native.

---

## Files Changed

| File | Type | Change |
|---|---|---|
| `web/lib/admin/adminVerifier.ts` | **Updated** | Removed `verifyAdminViaGAS()`, `APPS_SCRIPT_URL` read, fallback call in `verifyAdminByPhone()`, and all transition comments |

`lib/adminAuth.ts` — no change. Its public surface (`checkAdminByPhone`, `requireAdminSession`, `AdminSession` re-export) is unaffected.

---

## Exact Fallback Removed

```typescript
// REMOVED from adminVerifier.ts:

const APPS_SCRIPT_URL = process.env.APPS_SCRIPT_URL || "";

async function verifyAdminViaGAS(phone: string): Promise<AdminVerifyResult> {
  if (!APPS_SCRIPT_URL) return { ok: false };
  try {
    const res = await fetch(APPS_SCRIPT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "admin_verify", phone }),
      cache: "no-store",
    });
    const text = await res.text();
    const data = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    if (data?.ok && data?.admin) {
      return { ok: true, admin: data.admin as AdminSession };
    }
    return { ok: false };
  } catch {
    return { ok: false };
  }
}

// Also removed from verifyAdminByPhone():
// return verifyAdminViaGAS(phone);
```

---

## Final Backend Source of Truth

**Supabase `admins` table** — queried via `adminSupabase` (service-role client).

```
verifyAdminByPhone(phone)
  → verifyAdminViaBackend(phone)
      → dynamic import adminSupabase
      → SELECT phone, name, role, permissions FROM admins
        WHERE phone = $phone AND active = true
        LIMIT 1
      → found: { ok: true, admin: AdminSession }
      → not found / error: { ok: false }
```

No GAS call. No fallback. No network call to `APPS_SCRIPT_URL` for admin auth.

---

## AdminSession Contract — Preserved Exactly

```typescript
type AdminSession = {
  phone: string;          // "91XXXXXXXXXX" — always present
  name?: string;          // from admins.name
  role?: string;          // from admins.role
  permissions?: string[]; // from admins.permissions (JSONB array)
}
```

All callers of `checkAdminByPhone()`, `requireAdminSession()`, and `verifyAdminByPhone()` receive the same shape as before. No frontend changes required.

---

## Failure Modes

| Condition | Result |
|---|---|
| Phone not in `admins` table | `{ ok: false }` |
| Admin row exists but `active = false` | `{ ok: false }` |
| Supabase returns a query error | `{ ok: false }` (caught internally) |
| `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` env vars missing | `{ ok: false }` (dynamic import throws, caught) |

In all failure cases `verifyAdminByPhone` returns `{ ok: false }` and never throws — the contract is unchanged.

---

## Admin Auth Is Now Fully GAS-Free

Every path that calls `verifyAdminByPhone()` is now GAS-free:

| Caller | Path | GAS? |
|---|---|---|
| `requireAdminSession()` (all `ADMIN_ONLY_ACTIONS` in `/api/kk`) | → `checkAdminByPhone` → `verifyAdminByPhone` → Supabase | **No** |
| `/api/admin/stats` auth guard | → `requireAdminSession` → Supabase | **No** |
| `/api/verify-otp` (login, admin detection) | → `checkAdminByPhone` → `verifyAdminByPhone` → Supabase | **No** |
| `/api/admin-verify` (re-verify endpoint) | → `verifyAdminByPhone` → Supabase | **No** |

---

## Prerequisite: admins Table Must Be Seeded

This slice assumes the `admins` table exists and contains all active admin records.
If not yet done, run the SQL from `docs/admin-slice-2-notes.md` before deploying.

If the table is empty or missing, `verifyAdminByPhone` returns `{ ok: false }` for every phone — **all admin logins will fail**. There is no longer a GAS safety net.

---

## Remaining Admin Dependencies on GAS

After Slice 6, GAS is **still used for all admin data mutations and reads** routed through `/api/kk`:

| Category | Still on GAS |
|---|---|
| Admin auth / identity | **No — fully Supabase** |
| Dashboard stats (`/api/admin/stats`) | **No — fully Supabase** |
| Category request mutations (approve/reject/close) | Yes — `/api/kk` → GAS |
| Provider mutations (verify, update, block) | Yes — `/api/kk` → GAS |
| Area / alias management | Yes — `/api/kk` → GAS |
| Task assignment, closure | Yes — `/api/kk` → GAS |
| Chat thread management | Yes — `/api/kk` → GAS |
| Notification logs | Yes — `/api/kk` → GAS |
| Issue reports | Yes — `/api/kk` → GAS |
| Team management | Yes — `/api/kk` → GAS |

---

## Recommended Next Slice (Slice 7)

**Migrate the first admin mutation group off GAS.**

Recommended starting point: **category request mutations** (`approve_category_request`, `reject_category_request`, `admin_close_category_request`, `admin_archive_category_request`, `admin_delete_category_request_soft`).

Why first:
- The read side (`pending_category_requests` table) is already in Supabase after Slice 5.
- Mutations only update `status`, `admin_action_by`, `admin_action_at`, `admin_action_reason` on existing rows.
- Approving also creates a row in `categories` — that table is already in Supabase.
- No WhatsApp side-effects, no matching logic, no cross-table complexity.
- Removes `/api/kk` → GAS dependency for the entire category approval flow.
