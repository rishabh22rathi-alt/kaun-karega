# Admin Migration — Slice 1 Notes

**Date:** 2026-04-19  
**Goal:** Isolate GAS admin verification behind a stable abstraction. Fix open admin stats endpoint.

---

## Files Changed

| File | Type | Change |
|---|---|---|
| `web/lib/admin/adminVerifier.ts` | **New** | Owns `AdminSession` type, `verifyAdminViaGAS()`, stub for `verifyAdminViaBackend()`, and public `verifyAdminByPhone()` interface |
| `web/lib/adminAuth.ts` | **Updated** | `checkAdminByPhone()` now delegates to `verifyAdminByPhone()`; re-exports `AdminSession` for backward compat; removed direct GAS fetch |
| `web/app/api/admin/stats/route.ts` | **Fixed** | Added `requireAdminSession` guard; returns 401 for unauthenticated callers |

---

## Exact Old Flow

```
checkAdminByPhone(phone)
  → if (!phone || !APPS_SCRIPT_URL) return { ok: false }
  → fetch(APPS_SCRIPT_URL, { action: "admin_verify", phone })
  → parse response, return { ok: true, admin } or { ok: false }
```

`requireAdminSession(request)` called `checkAdminByPhone` directly.  
`/api/admin/stats` had **no auth check** — any caller could hit it.

---

## Exact New Flow

```
checkAdminByPhone(phone)
  → if (!phone) return { ok: false }
  → verifyAdminByPhone(phone)           ← lib/admin/adminVerifier.ts
      → verifyAdminViaGAS(phone)
          → if (!APPS_SCRIPT_URL) return { ok: false }
          → fetch(APPS_SCRIPT_URL, { action: "admin_verify", phone })
          → parse response, return { ok: true, admin } or { ok: false }
```

`requireAdminSession(request)` is unchanged — still calls `checkAdminByPhone`.  
`/api/admin/stats` now runs `requireAdminSession` before proxying — returns 401 if unauthorized.

**Runtime behavior is identical to before for all authorized callers.**

---

## What Still Depends on GAS After This Slice

| Dependency | Where | Notes |
|---|---|---|
| `admin_verify` action | `lib/admin/adminVerifier.ts → verifyAdminViaGAS()` | Still called on every protected admin API request |
| All `admin_*` data actions | `app/api/kk/route.ts` proxy | Unchanged — not part of this slice |
| `/api/admin-verify` login endpoint | `app/api/admin-verify/route.ts` | Still proxies to `/api/kk` → GAS for the login flow |

---

## What No Longer Depends Directly on GAS

| What Changed | Where |
|---|---|
| `lib/adminAuth.ts` has no direct GAS fetch call | Delegate is now `verifyAdminByPhone()` |
| GAS URL and fetch logic are contained in one place | `lib/admin/adminVerifier.ts → verifyAdminViaGAS()` |

The auth chokepoint (`checkAdminByPhone` / `requireAdminSession`) no longer contains GAS-specific code. GAS is now an implementation detail inside `adminVerifier.ts`, not spread across `adminAuth.ts`.

---

## Remaining Risk

| Risk | Severity | Notes |
|---|---|---|
| `admin_verify` still calls GAS on every protected request | Medium | High latency; GAS downtime = admin lockout. Resolved in Slice 2. |
| `/api/admin-verify` login flow still routes through `/api/kk` → GAS | Medium | Login works only while GAS is up. Resolved in Slice 2. |
| All admin data reads/writes still on GAS | High | Core data layer unchanged — intentional, later slices. |
| `admin_get_dashboard` is now properly guarded on `/api/admin/stats` | **Fixed** | Previously open to unauthenticated callers. |

---

## Recommended Next Slice (Slice 2)

**Migrate `admin_verify` to Supabase.**

Steps:
1. Create `admins` table in Supabase:  
   `admins(phone text PK, name text, role text, permissions jsonb, active bool)`
2. Seed it from the GAS Admins sheet (one-time export).
3. Implement `verifyAdminViaBackend(phone)` in `lib/admin/adminVerifier.ts` (stub is already there).
4. Swap `verifyAdminByPhone()` to call `verifyAdminViaBackend()` instead of `verifyAdminViaGAS()`.
5. Update `/api/admin-verify/route.ts` to call `verifyAdminByPhone()` directly instead of proxying through `/api/kk`.

**Impact of Slice 2:** GAS is no longer in the auth path. Every protected admin API call loses the GAS round-trip on auth. Admin login and all data actions remain compatible — only the identity check moves.
