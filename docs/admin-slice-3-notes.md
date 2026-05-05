# Admin Migration — Slice 3 Notes

**Date:** 2026-04-19  
**Goal:** Migrate `/api/admin-verify` to call the backend-native verifier directly, removing its GAS proxy hop.

---

## Files Changed

| File | Type | Change |
|---|---|---|
| `web/app/api/admin-verify/route.ts` | **Updated** | Replaced `/api/kk` proxy with direct `verifyAdminByPhone()` call; stripped `+` prefix to match canonical phone format |
| `web/lib/admin/adminVerifier.ts` | **Updated** | Renamed TODO label from `admin-slice-3` to `admin-slice-4-remove-gas-login-fallback`; updated doc comment to "as of Slice 3" |

---

## Key Discovery: Admin Login Was Already Backend-Native

The main admin login path does **not** go through `/api/admin-verify`:

```
User enters OTP
  → frontend (app/verify/page.tsx or app/otp/page.tsx) → POST /api/verify-otp
  → /api/verify-otp/route.ts calls checkAdminByPhone(phone)
  → checkAdminByPhone → verifyAdminByPhone → Supabase (GAS fallback)
  → response includes { isAdmin, adminName, adminRole, permissions }
  → frontend sets kk_admin_session in localStorage
  → frontend sets kk_admin=1 cookie (via server Set-Cookie)
  → middleware.ts allows /admin/* access
```

`/api/admin-verify` had **zero live frontend callers** — it was a secondary endpoint previously used for explicit re-verification (e.g., an admin navigating to `/admin/*` while already logged in). Admin login was already using `checkAdminByPhone()` directly in `/api/verify-otp` since before Slice 1.

---

## Old `/api/admin-verify` Flow

```
POST /api/admin-verify { phone }
  → normalizePhone(phone) → "+91XXXXXXXXXX"
  → fetch POST /api/kk { action: "admin_verify", phone: "+91XXXXXXXXXX" }
      → /api/kk checks ADMIN_ONLY_ACTIONS (admin_verify is NOT in it — passes through)
      → /api/kk forwards to APPS_SCRIPT_URL
      → GAS Backend.js doPost() → admin_verify → getAdminByPhone_("+91XXXXXXXXXX")
      → returns { ok: true, admin: { phone, name, role, permissions } }
      → /api/kk applies normalizeAdminPayload():
         { ok: true, data: { ok: true, admin: {...} }, admin: {...}, error: null }
  → /api/admin-verify reads data.data?.admin || data.admin
  → returns { ok: true, data: { admin }, admin, error: null }
```

---

## New `/api/admin-verify` Flow

```
POST /api/admin-verify { phone }
  → normalizePhone(phone) → "+91XXXXXXXXXX" (or null → 400)
  → strip "+" → "91XXXXXXXXXX" (canonical format for admins table)
  → verifyAdminByPhone("91XXXXXXXXXX")
      → verifyAdminViaBackend("91XXXXXXXXXX")
          → adminSupabase.from("admins").select(...)
            .eq("phone", "91XXXXXXXXXX").eq("active", true).single()
          → if found: return { ok: true, admin: { phone, name, role, permissions } }
          → if not found or error: return { ok: false }
      → if ok=true: return backend result (GAS not called)
      → if ok=false: verifyAdminViaGAS("91XXXXXXXXXX") [fallback]
  → if result.ok: return { ok: true, data: { admin }, admin, error: null }
  → if !result.ok: return { ok: false, error: "Access denied" } status 403
```

GAS is only reached if Supabase returns `{ ok: false }` (table unseeded, phone not found, or Supabase error).

---

## Phone Format Note

`normalizePhone()` from `lib/utils/phone.ts` returns `+91XXXXXXXXXX` (with `+`).  
The `admins` table and `kk_auth_session` use `91XXXXXXXXXX` (without `+`).  
The route now strips the leading `+` before calling `verifyAdminByPhone()`.  
This is consistent with `normalizeIndianPhone()` used in `/api/verify-otp/route.ts`.

---

## Exact Response Contract Preserved

| Field | Type | Value |
|---|---|---|
| `ok` | boolean | `true` on success |
| `data.admin` | AdminSession | `{ phone, name?, role?, permissions? }` |
| `admin` | AdminSession | same as `data.admin` (dual-path for legacy callers) |
| `error` | null | always null on success |

Failure responses:
- `{ ok: false, error: "Invalid phone" }` → HTTP 400
- `{ ok: false, error: "Access denied" }` → HTTP 403
- `{ ok: false, error: "Internal error" }` → HTTP 500

---

## Is GAS Still in the Admin Login Path?

| Path | GAS involved? | Condition |
|---|---|---|
| Main login (`/api/verify-otp` → `checkAdminByPhone`) | Only as fallback | Only if Supabase `admins` table is unseeded or returns error |
| `/api/admin-verify` (re-verify endpoint) | Only as fallback | Same — inside `verifyAdminByPhone()` |
| Per-request auth guard (`requireAdminSession` → `checkAdminByPhone`) | Only as fallback | Same |
| All `ADMIN_ONLY_ACTIONS` data proxies | Yes, always | Not migrated yet — still in `/api/kk` → GAS |

The GAS fallback in `adminVerifier.ts` is labeled `TODO(admin-slice-4-remove-gas-login-fallback)`.

---

## Remaining Admin Auth Dependencies on GAS

After Slice 3, GAS remains in the **data layer** (all dashboard reads/writes via `/api/kk`). GAS is only in the **auth layer** as a fallback when Supabase returns `{ ok: false }`.

Once the `admins` table is seeded in production (see `docs/admin-slice-2-notes.md` for SQL), no admin phone lookup will fall through to GAS and the fallback becomes permanently inactive — ready to be deleted in Slice 4.

---

## Recommended Next Slice (Slice 4)

**Seed the admins table and remove the GAS auth fallback.**

Steps:
1. Run the SQL from `docs/admin-slice-2-notes.md` to create the `admins` table.
2. Insert all admin records with `91XXXXXXXXXX` phone format.
3. Test: admin login → confirm `verifyAdminViaBackend` returns `{ ok: true }`.
4. Remove the `verifyAdminViaGAS(phone)` fallback call from `verifyAdminByPhone()` in `lib/admin/adminVerifier.ts`.
5. Optionally remove the `verifyAdminViaGAS()` function entirely.
6. Remove the `APPS_SCRIPT_URL` reference from `adminVerifier.ts` (the URL will still be needed for data actions in `/api/kk`).

After Slice 4: admin identity verification has **zero GAS dependency** under any condition.
