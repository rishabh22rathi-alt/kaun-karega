# Admin Migration — Slice 9 Notes

**Date:** 2026-04-19  
**Goal:** Migrate the three direct category management actions (`add_category`, `edit_category`, `toggle_category`) off GAS. After this slice, every category-related admin action is Supabase-native.

---

## Files Changed

| File | Type | Change |
|---|---|---|
| `web/lib/admin/adminCategoryMutations.ts` | **Extended** | Added `addCategory()`, `editCategory()`, `toggleCategory()` |
| `web/app/api/kk/route.ts` | **Updated** | Intercepts `add_category`, `edit_category`, `toggle_category` before GAS proxy |

---

## Actions Migrated

| Action | Handler function |
|---|---|
| `add_category` | `addCategory(categoryName)` |
| `edit_category` | `editCategory(oldName, newName)` |
| `toggle_category` | `toggleCategory(categoryName, active)` |

---

## Old Flow

```
POST /api/kk { action: "add_category", categoryName }
  → GAS APPS_SCRIPT_URL
  → GAS inserts into Categories sheet
  → { ok: true/false }

POST /api/kk { action: "edit_category", oldName, newName }
  → GAS APPS_SCRIPT_URL
  → GAS renames category in Categories sheet
  → { ok: true/false }

POST /api/kk { action: "toggle_category", categoryName, active: "yes"|"no" }
  → GAS APPS_SCRIPT_URL
  → GAS updates active flag in Categories sheet
  → { ok: true/false }
```

---

## New Flow

```
POST /api/kk { action: "add_category", categoryName }
  → intercepted in /api/kk POST handler
  → addCategory(categoryName)
      → adminSupabase.from("categories").upsert({ name, active: true }, { onConflict: "name", ignoreDuplicates: true })
  → { ok: true } | { ok: false, error }

POST /api/kk { action: "edit_category", oldName, newName }
  → intercepted in /api/kk POST handler
  → editCategory(oldName, newName)
      → adminSupabase.from("categories").update({ name: newName }).eq("name", oldName)
  → { ok: true } | { ok: false, error }

POST /api/kk { action: "toggle_category", categoryName, active }
  → intercepted in /api/kk POST handler
  → toggleCategory(categoryName, active)
      → adminSupabase.from("categories").update({ active: active === "yes" }).eq("name", categoryName)
  → { ok: true } | { ok: false, error }
```

The GAS proxy is never reached for these 3 actions.

---

## Tables / Columns Updated

### `categories`

| Action | Columns written |
|---|---|
| `add_category` | `name` (new), `active = true` — upsert, ignores duplicate names |
| `edit_category` | `name` — updated WHERE `name = oldName` |
| `toggle_category` | `active` (boolean) — updated WHERE `name = categoryName` |

`active` is stored as boolean (`true`/`false`). `adminDashboardStats.ts` already handles both boolean and string "yes"/"no" when reading — no reader changes required.

---

## Payload Shapes (Preserved Exactly)

```typescript
// add_category
{ action: "add_category", categoryName: string }

// edit_category
{ action: "edit_category", oldName: string, newName: string }

// toggle_category
{ action: "toggle_category", categoryName: string, active: "yes" | "no" }
```

---

## Response Contract Preserved

`{ ok: boolean, error?: string }` — unchanged for all three actions.

**UI refresh behavior:** all three handlers use optimistic local state updates (no `fetchDashboard()` call). The Supabase write is the source of truth; on the next dashboard load, the categories list reflects the current DB state.

---

## Duplicate Category Prevention

`addCategory` uses the same upsert pattern as `approveCategoryRequest` (Slice 8):
```typescript
.upsert({ name: categoryName, active: true }, { onConflict: "name", ignoreDuplicates: true })
```
If the admin adds a category that already exists, the existing row is unchanged and `{ ok: true }` is returned — consistent with the previous GAS behavior.

---

## Auth Guard

`add_category`, `edit_category`, and `toggle_category` are all in `ADMIN_ONLY_ACTIONS` in `/api/kk/route.ts`. The existing `requireAdminSession()` check fires before the body is parsed — no auth changes required.

---

## Category Admin Actions: Fully GAS-Free After Slice 9

| Action | GAS? |
|---|---|
| `add_category` | **No — Supabase** |
| `edit_category` | **No — Supabase** |
| `toggle_category` | **No — Supabase** |
| `approve_category_request` | **No — Supabase** (Slice 8) |
| `reject_category_request` | **No — Supabase** (Slice 8) |
| `admin_close_category_request` | **No — Supabase** (Slice 8) |
| `admin_archive_category_request` | **No — Supabase** (Slice 8) |
| `admin_delete_category_request_soft` | **No — Supabase** (Slice 8) |
| Category reads (stats, list) | **No — Supabase** (Slices 4–5) |

**The entire categories section of the admin dashboard is now GAS-free.**

---

## What Still Depends on GAS After Slice 9

| Feature | GAS dependency |
|---|---|
| Admin auth | No |
| Dashboard stats | No |
| Provider verify/approve/reject | No |
| Provider block/unblock | No |
| All category actions | **No — fully Supabase** |
| Provider reads (`getProviderById`, `getAllProviders`) | Yes — `lib/api/providers.ts` → GAS |
| Area / alias management | Yes — `/api/kk` → GAS |
| Task assignment, closure | Yes — `/api/kk` → GAS |
| Chat thread management | Yes — `/api/kk` → GAS |
| Notification logs | Yes — `/api/kk` → GAS |
| Issue reports | Yes — `/api/kk` → GAS |
| Team management | Yes — `/api/kk` → GAS |

---

## Recommended Next Slice (Slice 10)

**Migrate provider reads** (`getProviderById`, `getAllProviders`, `updateProvider`) from `lib/api/providers.ts` off GAS.

Why next:
- `providers`, `provider_services`, `provider_areas` tables are already in Supabase and queried for the admin dashboard stats.
- `getProviderById` feeds the provider profile page — the only remaining GAS read in the admin provider flow.
- After Slice 7 (mutations) + Slice 10 (reads), the entire provider section of the admin dashboard is GAS-free.
- The in-memory join pattern from `adminDashboardStats.ts` can be reused directly.
