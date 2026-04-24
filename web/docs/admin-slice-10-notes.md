# Admin Migration — Slice 10 Notes

**Date:** 2026-04-19  
**Goal:** Migrate admin provider reads (`getAllProviders`, `getProviderById`) and the profile update mutation (`updateProvider`) off GAS. After this slice, all provider admin CRUD flows are Supabase-native.

---

## Files Changed

| File | Type | Change |
|---|---|---|
| `web/lib/admin/adminProviderReads.ts` | **New** | `getAllProvidersFromSupabase()`, `getProviderByIdFromSupabase()`, `updateProviderInSupabase()` |
| `web/app/api/admin/providers/route.ts` | **New** | `GET /api/admin/providers` — returns all providers |
| `web/app/api/admin/providers/[id]/route.ts` | **New** | `GET /api/admin/providers/:id` — returns single provider |
| `web/app/api/admin/providers/update/route.ts` | **New** | `POST /api/admin/providers/update` — updates name, phone, categories, areas |
| `web/lib/api/providers.ts` | **Updated** | `getAllProviders`, `getProviderById`, `updateProvider` now call new Next.js routes; GAS imports removed |

---

## Actions Migrated

| Function | Old transport | New transport |
|---|---|---|
| `getAllProviders()` | `appsScriptGet("providers/getAll")` → GAS directly | `fetch GET /api/admin/providers` → Supabase |
| `getProviderById(id)` | `appsScriptGet("providers/getById", { id })` → GAS directly | `fetch GET /api/admin/providers/:id` → Supabase |
| `updateProvider({ id, name, phone, categories, areas })` | `appsScriptPost("providers/update")` → GAS directly | `fetch POST /api/admin/providers/update` → Supabase |

---

## Old Flow

```
lib/api/providers.ts getAllProviders()
  → appsScriptGet("providers/getAll", {}, { admin: true })
      → fetch GAS APPS_SCRIPT_URL?path=providers/getAll&x-admin-key=...
      → GAS reads Providers sheet
      → Provider[]

lib/api/providers.ts getProviderById(id)
  → appsScriptGet("providers/getById", { id }, { admin: true })
      → fetch GAS APPS_SCRIPT_URL?path=providers/getById&id=...
      → GAS reads Providers sheet row
      → Provider | null

lib/api/providers.ts updateProvider({ id, name, phone, categories, areas })
  → appsScriptPost("providers/update", { id, name, phone, categories, areas }, { admin: true })
      → POST GAS APPS_SCRIPT_URL?path=providers/update { ...payload, adminKey }
      → GAS updates Providers/Services/Areas sheets
      → { success: boolean }
```

---

## New Flow

```
lib/api/providers.ts getAllProviders()
  → fetch GET /api/admin/providers
      → requireAdminSession()
      → getAllProvidersFromSupabase()
          → adminSupabase.from("providers").select(provider_id, full_name, phone, status)
          → adminSupabase.from("provider_services").select(provider_id, category)
          → adminSupabase.from("provider_areas").select(provider_id, area)
          → in-memory join → ProviderRow[]
      → Response.json(ProviderRow[])

lib/api/providers.ts getProviderById(id)
  → fetch GET /api/admin/providers/:id
      → requireAdminSession()
      → getProviderByIdFromSupabase(id)
          → same 3 parallel queries filtered by provider_id
          → single ProviderRow | null
      → Response.json(ProviderRow) | 404

lib/api/providers.ts updateProvider({ id, ... })
  → fetch POST /api/admin/providers/update { id, name, phone, categories, areas }
      → requireAdminSession()
      → updateProviderInSupabase(input)
          → adminSupabase.from("providers").update({ full_name, phone }).eq("provider_id", id)
          → adminSupabase.from("provider_services").delete().eq("provider_id", id)
          → adminSupabase.from("provider_services").insert(categories rows)
          → adminSupabase.from("provider_areas").delete().eq("provider_id", id)
          → adminSupabase.from("provider_areas").insert(areas rows)
      → { success: true } | { success: false }
```

---

## Tables / Joins Used

| Table | Columns read | Usage |
|---|---|---|
| `providers` | `provider_id`, `full_name`, `phone`, `status` | Base provider row |
| `provider_services` | `provider_id`, `category` | Categories array (in-memory join) |
| `provider_areas` | `provider_id`, `area` | Areas array (in-memory join) |

For `updateProvider`, `provider_services` and `provider_areas` are deleted + re-inserted (replace-all pattern).

---

## Response Contracts Preserved

### getAllProviders → `Provider[]`
```typescript
type Provider = {
  id: string;           // providers.provider_id
  name: string;         // providers.full_name
  phone: string;        // providers.phone
  categories: string[]; // from provider_services (joined)
  areas: string[];      // from provider_areas (joined)
  status: string;       // providers.status — normalized to PascalCase
  totalTasks: number;   // 0 — placeholder (see note below)
  totalResponses: number; // 0 — placeholder (see note below)
}
```

### getProviderById → `Provider | null`
Same shape as above. Returns `null` on 404 or error — unchanged from previous behavior.

### updateProvider → `{ success: boolean }`
Unchanged.

---

## Status Normalization

The Supabase `providers.status` column has mixed-case values from various migration slices:

| DB value | Normalized to |
|---|---|
| `"pending"` | `"Pending"` |
| `"active"` | `"Active"` |
| `"Blocked"` | `"Blocked"` (unchanged) |
| `"Active"` | `"Active"` (unchanged) |
| `"rejected"` | `"rejected"` (pass-through) |

The frontend's status filter (`"Active"`, `"Pending"`, `"Blocked"`) will work correctly after normalization.

---

## totalTasks / totalResponses — Placeholder Note

GAS derived `totalTasks` and `totalResponses` from the Tasks sheet. These fields are not in the Supabase `providers` table and the task data is not yet fully migrated to Supabase.

Both fields are returned as `0` from the new routes. The UI renders `provider.totalTasks ?? 0` so this is display-only regression — no crashes or errors. A future slice migrating task reads will populate these correctly.

---

## Auth Guard

All three new routes call `requireAdminSession()` — consistent with other admin API routes. Additionally, all admin pages are behind `middleware.ts` (requires `kk_auth_session` + `kk_admin=1`).

---

## updateProvider — Included in This Slice

`updateProvider` was included because:
- Input/output contract is clearly defined (`{ id, name, phone, categories[], areas[] }` → `{ success: boolean }`)
- No side effects outside the three provider tables
- Uses the same delete+re-insert pattern already in `provider_register`
- The edit page (`app/admin/providers/[id]/edit/page.tsx`) calls it immediately after `getProviderById` — migrating one without the other would leave the page in a half-migrated state

---

## Provider Admin Actions: Fully GAS-Free After Slice 10

| Feature | GAS? |
|---|---|
| Provider reads (list, by ID) | **No — Supabase** |
| Provider update (name, phone, categories, areas) | **No — Supabase** |
| Provider verify/approve/reject | **No — Supabase** (Slice 7) |
| Provider block/unblock | **No — Supabase** (Slice 7) |

**The entire provider section of the admin panel is now GAS-free.**

---

## What Still Depends on GAS After Slice 10

| Feature | GAS dependency |
|---|---|
| Admin auth, stats, all categories | **No** |
| Provider admin (reads + mutations) | **No** |
| Area / alias management | Yes — `/api/kk` → GAS |
| Task assignment, closure | Yes — `/api/kk` → GAS |
| Chat thread management | Yes — `/api/kk` → GAS |
| Notification logs | Yes — `/api/kk` → GAS |
| Issue reports | Yes — `/api/kk` → GAS |
| Team management | Yes — `/api/kk` → GAS |

---

## Recommended Next Slice (Slice 11)

**Migrate area / alias management** (`add_area`, `edit_area`, `add_area_alias`, `merge_area_into_canonical`, etc.).

The area/alias data is currently GAS-only. Before migrating these mutations, a Supabase table for areas (and area aliases) would need to be created and seeded. This is the highest-value remaining admin migration since area management is frequently used in the dashboard.

Alternatively, if admin area data is lower priority: **migrate task assignment and closure** (`assign_provider`, `close_request`) since the `tasks` table already exists in Supabase — no schema creation needed.
