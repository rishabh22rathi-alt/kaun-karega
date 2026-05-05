# Admin Migration — Slice 4 Notes

**Date:** 2026-04-19  
**Goal:** Replace GAS `admin_get_dashboard` proxy in `/api/admin/stats` with a backend-native stats provider. Preserve exact response contract for the admin dashboard UI.

---

## Files Changed

| File | Type | Change |
|---|---|---|
| `web/lib/admin/adminDashboardStats.ts` | **New** | Backend-native stats helper: queries Supabase for providers + categories; GAS fallback only for categoryApplications |
| `web/app/api/admin/stats/route.ts` | **Updated** | Replaced `/api/kk` GAS proxy with `getAdminDashboardStats()` call |

---

## Old Flow

```
GET /api/admin/stats
  → requireAdminSession() [auth guard — added Slice 1]
  → fetch POST /api/kk { action: "admin_get_dashboard" }
      → /api/kk forwards to GAS APPS_SCRIPT_URL
      → GAS getAdminDashboardStats_()
          reads: Providers sheet, PendingCategories sheet, Categories sheet
          returns: { ok, stats, providers, categoryApplications, categories }
      → /api/kk normalizeAdminPayload() wraps response
  → return response to dashboard
```

GAS was responsible for all data: provider counts, provider list, category application queue, category list.

---

## New Flow

```
GET /api/admin/stats
  → requireAdminSession() [auth guard unchanged]
  → getAdminDashboardStats()  ← lib/admin/adminDashboardStats.ts
      → [parallel]
          getProvidersFromSupabase()
            → adminSupabase.from("providers").select(provider_id, full_name, phone, verified, status)
            → adminSupabase.from("provider_services").select(provider_id, category)
            → adminSupabase.from("provider_areas").select(provider_id, area)
            → in-memory join → AdminProvider[]
          getCategoriesFromSupabase()
            → adminSupabase.from("categories").select(name, active)
            → map to ManagedCategory[]
          getCategoryApplicationsFromGAS()   ← [fallback]
            → POST APPS_SCRIPT_URL { action: "admin_get_category_requests" }
            → returns CategoryApplication[]
      → compute DashboardStats from combined data
      → return { ok, stats, providers, categoryApplications, categories }
  → return Response.json(result)
```

GAS is now only called for `categoryApplications`. All other stats are Supabase-native.

---

## Exact Response Contract Preserved

```typescript
// AdminDashboardResponse — unchanged, same shape dashboard page expects
{
  ok: true,
  stats: {
    totalProviders: number,         // COUNT(providers)
    verifiedProviders: number,      // COUNT(providers WHERE verified = 'yes')
    pendingAdminApprovals: number,  // COUNT(providers WHERE status = 'pending')
    pendingCategoryRequests: number // COUNT(categoryApplications WHERE status = 'pending')
  },
  providers: AdminProvider[],         // from Supabase — backend-native
  categoryApplications: CategoryApplication[], // from GAS — pending Slice 5
  categories: ManagedCategory[]       // from Supabase — backend-native
}
```

The `areas` field (present in `AdminDashboardResponse` type) was not returned by the old GAS endpoint either — confirmed by the dashboard's `fetchDashboard` which reads areas separately via `admin_get_area_mappings`.

---

## Data Sources

| Field | Source | Table(s) / Action |
|---|---|---|
| `stats.totalProviders` | **Supabase** | `providers` COUNT |
| `stats.verifiedProviders` | **Supabase** | `providers` WHERE `verified = 'yes'` |
| `stats.pendingAdminApprovals` | **Supabase** | `providers` WHERE `status = 'pending'` |
| `stats.pendingCategoryRequests` | GAS (derived) | `admin_get_category_requests` filtered by `status = 'pending'` |
| `providers[]` | **Supabase** | `providers` + `provider_services` + `provider_areas` |
| `categories[]` | **Supabase** | `categories` (`name`, `active`) |
| `categoryApplications[]` | **GAS fallback** | `admin_get_category_requests` action |

---

## Column Mapping Notes

### providers table
| Supabase column | AdminProvider field | Notes |
|---|---|---|
| `provider_id` | `ProviderID` | string |
| `full_name` | `ProviderName` | string |
| `phone` | `Phone` | stored as 10-digit (no country code) |
| `verified` | `Verified` | string "yes"/"no" — stored as-is |
| `status` | `PendingApproval` | `"pending"` → `"yes"`, anything else → `"no"` |
| provider_services.category (joined) | `Category` | comma-separated, joined in memory |
| provider_areas.area (joined) | `Areas` | comma-separated, joined in memory |

### categories table
| Supabase column | ManagedCategory field | Notes |
|---|---|---|
| `name` | `CategoryName` | string |
| `active` | `Active` | boolean or string → normalized to `"yes"`/`"no"` |

---

## Which Dashboard Sections Are Now Backend-Native

| Dashboard Section | Status |
|---|---|
| Summary cards (totalProviders, verifiedProviders, pendingAdminApprovals) | **Backend-native** |
| Providers table | **Backend-native** |
| Categories management list | **Backend-native** |
| Pending category requests count | GAS (derived from categoryApplications) |
| Pending category requests list | **GAS fallback** — Slice 5 |

---

## Remaining GAS Dependency in This Route

**Only `admin_get_category_requests`** — called directly in `getCategoryApplicationsFromGAS()`, bypassing `/api/kk`. This is the only remaining GAS call in the stats path.

Marked with `TODO(admin-slice-5-remove-stats-fallback)` in the helper. The comment includes the required Supabase table schema (`pending_category_requests`) needed to remove it.

---

## What the `/api/kk` GAS Proxy No Longer Handles

`/api/admin/stats` no longer calls `/api/kk` at all. The double-hop
`stats route → /api/kk → GAS` is gone. GAS is called directly and only for the narrow `categoryApplications` fallback.

---

## Recommended Next Slice (Slice 5)

**Create `pending_category_requests` table in Supabase and remove the GAS categoryApplications fallback.**

Steps:
1. Create the table (schema in `TODO(admin-slice-5)` comment in `adminDashboardStats.ts`).
2. Seed from the GAS PendingCategories sheet.
3. Implement a `getCategoryApplicationsFromSupabase()` function in the helper.
4. Swap `getCategoryApplicationsFromGAS()` for it in `getAdminDashboardStats()`.
5. Remove `getCategoryApplicationsFromGAS()`.
6. Delete the `TODO(admin-slice-5-remove-stats-fallback)` comment.

After Slice 5: `/api/admin/stats` has **zero GAS dependency**. The `/api/kk` GAS proxy is no longer involved in the stats path at all.
