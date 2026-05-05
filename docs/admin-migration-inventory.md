# Kaun Karega Admin Migration Inventory

> **Purpose:** Exact inventory of the current Admin flow to enable safe migration from Google Apps Script (GAS) to Supabase + Next.js API.
> **Source of truth:** Live codebase audit — all function names, routes, and payloads are confirmed from code, not assumed.
> **Last audited:** 2026-04-20

---

## 1. Current Admin Entry Points

Most admin data actions go through one proxy: `POST /api/kk` with an `action` field. The admin auth wrappers (`/api/admin-verify`, `/api/admin/stats`) are now native and do not delegate to `/api/kk` for auth.

| File / Route | Method | Purpose | Calls Which Helper | Calls Which Apps Script Action | Read / Write | Used By UI Page | Notes |
|---|---|---|---|---|---|---|---|
| `app/api/admin-verify/route.ts` | POST | Re-verify phone is a known admin | `lib/admin/adminVerifier.ts → verifyAdminByPhone()` | None | Read | `components/AdminLayoutClient.tsx` recovery path | Normalizes phone first; returns legacy `{ ok, data: { admin }, admin }` shape |
| `app/api/admin/stats/route.ts` | GET, POST | Fetch dashboard summary stats | `lib/adminAuth.ts → requireAdminSession()`, `lib/admin/adminDashboardStats.ts → getAdminDashboardStats()` | None for auth | Read | `app/admin/dashboard/` | Auth guard is present; route is no longer open |
| `app/api/kk/route.ts` | GET, POST | Universal proxy for remaining admin data actions plus native intercepts | `lib/adminAuth.ts → requireAdminSession()` | Mixed: many `admin_*` actions still proxy to GAS | Read + Write | All admin pages | Guards `ADMIN_ONLY_ACTIONS` set; auth check is native, downstream data path is mixed |
| `lib/adminAuth.ts → checkAdminByPhone()` | — | Server-side admin identity check | `lib/admin/adminVerifier.ts → verifyAdminByPhone()` | None | Read | Called by `requireAdminSession()` and `/api/verify-otp` | Returns `{ ok: false }` on any error — never throws |
| `lib/adminAuth.ts → requireAdminSession()` | — | Route-level admin guard | `lib/auth.ts → getAuthSession()`, `checkAdminByPhone()` | None | Read | Called inside `/api/kk` and native admin routes | Reads `kk_auth_session` cookie, extracts phone, checks Supabase `admins` table |
| `middleware.ts` | — | Edge-level route guard for `/admin/*` | `lib/auth.ts → getAuthSession()` | None — cookie check only | Read | Every `/admin/*` page load | Requires `kk_auth_session` cookie AND `kk_admin=1` cookie; redirects to `/login?next=<path>` |
| `lib/supabase/admin.ts` | — | Supabase service-role client | Supabase SDK | None | — | Used by admin auth and other native admin helpers | Server-only client for `admins` and related tables |

---

## 2. Apps Script Admin Actions

All actions are dispatched via `POST APPS_SCRIPT_URL` with body `{ action: "<name>", ...payload }`. The GAS entry point is `doPost(e)` in `Backend.js`.

**Spreadsheet ID:** `1xCgM4HnsnYj7XEH6786urLH-V2SmOdmi6koijia_zQo`

### 2a. Authentication & Identity

Admin auth is no longer backed by Apps Script. The `admin_verify` action remains relevant only as historical context for older migrations; the live auth path is Supabase-backed.

| Apps Script Action | Source File | Purpose | Input Params | Output Shape | Used By Route(s) | Risk Notes |
|---|---|---|---|---|---|---|
| `admin_verify` | `Backend.js → getAdminByPhone_()` | Historical admin phone lookup action | `{ phone }` | `{ ok: true, admin: { phone, name, role, permissions[] } }` | No live Admin Auth runtime callers | No longer in the active admin auth path |

### 2b. Dashboard & Read Actions

| Apps Script Action | Source File | Purpose | Input Params | Output Shape | Used By Route(s) | Risk Notes |
|---|---|---|---|---|---|---|
| `admin_get_dashboard` | `Backend.js → getAdminDashboardStats_()` | Summary counts for dashboard cards | none | `{ ok, data: { providers, tasks, categories, ... } }` | `/api/admin/stats`, `/api/kk` | Open — no auth check on `/api/admin/stats` |
| `admin_get_providers` | `Backend.js → getAdminProviders_()` | All providers with status | none | Array of provider records | `/api/kk` | — |
| `admin_get_provider` | `Backend.js → getAdminProviderById_()` | Single provider detail | `{ providerId }` or `{ phone }` | Single provider record | `/api/kk` | — |
| `admin_get_category_requests` | `Backend.js → getAdminCategoryApplications_()` | Pending category approval queue | none | Array of pending requests | `/api/kk` | — |
| `admin_get_categories` | `Backend.js → getAdminCategories_()` | All categories with active status | none | Array of category records | `/api/kk` | — |
| `admin_get_area_mappings` / `get_admin_area_mappings` | `Backend.js → getAdminAreaMappingsResponse_()` | Canonical areas + all aliases | none | `{ canonicalAreas[], aliases[] }` | `/api/kk` | Two action aliases for same function |
| `admin_get_unmapped_areas` | `Backend.js → getAdminUnmappedAreasResponse_()` | Areas submitted by users that have no canonical match | none | Array of review records | `/api/kk` | — |
| `admin_get_requests` | `Backend.js → getAdminRequests_()` | All user task requests with filters | filter fields | Array of task records | `/api/kk` | Also used by provider chat page — **not** admin-only in the `ADMIN_ONLY_ACTIONS` set for that reason |
| `admin_get_notification_logs` / `admin_notification_logs` | `Backend.js → getRecentNotificationLogs_()` | Recent WhatsApp notification log | `{ limit }` | Array of log records | `/api/kk` | Two action aliases |
| `admin_get_notification_summary` / `admin_notification_summary` | `Backend.js → getNotificationSummaryByTask_()` | Notification history for a task | `{ taskId }` | Summary object | `/api/kk` | Two action aliases |
| `admin_get_team_members` | `Backend.js → getAdminTeamMembers_()` | Internal team list | none | Array of team member records | `/api/kk` | — |
| `admin_get_issue_reports` | `Backend.js → getIssueReports_()` | User-submitted issue reports | filter fields | Array of reports | `/api/kk` | — |
| `admin_list_chat_threads` | `Backend.js → adminListChatThreads_()` | Admin chat inbox | filter data | Array of thread records | `/api/kk` | — |
| `admin_get_chat_thread` | `Backend.js → adminGetChatThread_()` | Single chat thread + messages | `{ threadId }` | Thread + messages | `/api/kk` | — |
| `admin_get_needs` | `Backend.js` | List all "needs" (Unconfirmed — function name not verified) | filter data | Array of need records | `/api/kk` | Function name in GAS **Unconfirmed** |

### 2c. Provider Write Actions

| Apps Script Action | Source File | Purpose | Input Params | Output Shape | Used By Route(s) | Risk Notes |
|---|---|---|---|---|---|---|
| `admin_verify_provider` / `set_provider_verified` | `Backend.js → setProviderVerified_()` | Mark provider as verified | `{ providerId, phone }` | `{ ok }` | `/api/kk` | Two action aliases for same function |
| `admin_update_provider` | `Backend.js → updateAdminProvider_()` | Edit provider details | provider fields | `{ ok }` | `/api/kk` | — |
| `admin_set_provider_blocked` | `Backend.js → setAdminProviderBlocked_()` | Block / unblock provider | `{ providerId, blocked }` | `{ ok }` | `/api/kk` | — |
| `admin_remind_providers` / `remind_providers` | `Backend.js → remindProviders_()` | Send WhatsApp reminders to matched providers | task/provider data | `{ ok }` | `/api/kk` | Triggers WhatsApp via `Whatsapp.gs` |
| `admin_assign_provider` / `assign_provider` | `Backend.js → assignProvider_()` | Manually assign provider to task | `{ taskId, providerId }` | `{ ok }` | `/api/kk` | — |

### 2d. Category Write Actions

| Apps Script Action | Source File | Purpose | Input Params | Output Shape | Used By Route(s) | Risk Notes |
|---|---|---|---|---|---|---|
| `admin_approve_category` / `approve_category_request` | `Backend.js → approveCategoryRequest_()` | Approve pending category request | category data | `{ ok }` | `/api/kk` | Two action aliases |
| `admin_reject_category` / `reject_category_request` | `Backend.js → rejectCategoryRequest_()` | Reject pending category request | category data | `{ ok }` | `/api/kk` | Two action aliases |
| `admin_close_category_request` | `Backend.js → updateCategoryRequestAdminAction_(data, "closed")` | Close a category request | request data | `{ ok }` | `/api/kk` | Calls shared `updateCategoryRequestAdminAction_` |
| `admin_archive_category_request` | `Backend.js → updateCategoryRequestAdminAction_(data, "archived")` | Archive a category request | request data | `{ ok }` | `/api/kk` | — |
| `admin_delete_category_request_soft` | `Backend.js → updateCategoryRequestAdminAction_(data, "deleted_by_admin")` | Soft-delete a category request | request data | `{ ok }` | `/api/kk` | — |
| `admin_add_category` / `add_category` | `Backend.js → addCategory_()` | Create new category | `{ categoryName, active }` | `{ ok }` | `/api/kk` | Two action aliases |
| `admin_edit_category` / `edit_category` | `Backend.js → editCategory_()` | Update category name/status | `{ categoryName, active }` | `{ ok }` | `/api/kk` | Two action aliases |
| `admin_toggle_category` / `toggle_category` | `Backend.js → toggleCategory_()` | Enable/disable category | `{ categoryName }` | `{ ok }` | `/api/kk` | Two action aliases |

### 2e. Area Write Actions

| Apps Script Action | Source File | Purpose | Input Params | Output Shape | Used By Route(s) | Risk Notes |
|---|---|---|---|---|---|---|
| `admin_add_area` / `add_area` | `Backend.js → addArea_()` | Create new area | `{ areaName, active }` | `{ ok }` | `/api/kk` | Two action aliases |
| `admin_edit_area` / `edit_area` | `Backend.js → editArea_()` | Update area details | `{ areaName, active }` | `{ ok }` | `/api/kk` | Two action aliases |
| `admin_add_area_alias` / `add_area_alias` | `Backend.js → addAreaAlias_()` | Create alias for canonical area | `{ canonicalArea, aliasName }` | `{ ok }` | `/api/kk` | Two action aliases |
| `admin_update_area_alias` | `Backend.js → updateAreaAlias_()` | Update alias name/mapping | `{ aliasId, aliasName, canonicalArea }` | `{ ok }` | `/api/kk` | — |
| `admin_toggle_area_alias` | `Backend.js → toggleAreaAlias_()` | Enable/disable an alias | `{ aliasId }` | `{ ok }` | `/api/kk` | — |
| `admin_merge_area_into_canonical` / `merge_area_into_canonical` | `Backend.js → mergeAreaIntoCanonical_()` | Merge duplicate area into canonical | merge data | `{ ok }` | `/api/kk` | Two action aliases; destructive — high care needed |
| `admin_map_unmapped_area` | `Backend.js → mapUnmappedAreaReview_()` | Assign unmapped user area to canonical | `{ reviewId, canonicalArea }` | `{ ok }` | `/api/kk` | — |
| `admin_create_area_from_unmapped` | `Backend.js → createAreaFromReview_()` | Create new canonical area from unmapped review | `{ reviewId, newAreaName }` | `{ ok }` | `/api/kk` | — |
| `admin_resolve_unmapped_area` | `Backend.js → resolveUnmappedAreaReview_()` | Mark unmapped area review as resolved | `{ reviewId, action }` | `{ ok }` | `/api/kk` | — |

### 2f. Task / Request Write Actions

| Apps Script Action | Source File | Purpose | Input Params | Output Shape | Used By Route(s) | Risk Notes |
|---|---|---|---|---|---|---|
| `admin_close_request` / `close_request` | `Backend.js → closeRequest_()` | Close a task/request | task data | `{ ok }` | `/api/kk` | Two action aliases |

### 2g. Needs Write Actions

| Apps Script Action | Source File | Purpose | Input Params | Output Shape | Used By Route(s) | Risk Notes |
|---|---|---|---|---|---|---|
| `admin_close_need` | `Backend.js` | Mark need as closed | `{ needId }` | `{ ok }` | `/api/kk` | GAS function name **Unconfirmed** |
| `admin_hide_need` | `Backend.js` | Hide need from public view | `{ needId }` | `{ ok }` | `/api/kk` | GAS function name **Unconfirmed** |
| `admin_unhide_need` | `Backend.js` | Restore need visibility | `{ needId }` | `{ ok }` | `/api/kk` | GAS function name **Unconfirmed** |
| `admin_set_need_rank` | `Backend.js` | Reorder need ranking | `{ needId, rank }` | `{ ok }` | `/api/kk` | GAS function name **Unconfirmed** |

### 2h. Chat & Issues Write Actions

| Apps Script Action | Source File | Purpose | Input Params | Output Shape | Used By Route(s) | Risk Notes |
|---|---|---|---|---|---|---|
| `admin_update_chat_thread_status` | `Backend.js → adminUpdateChatThreadStatus_()` | Close or archive a chat thread | `{ threadId, status }` | `{ ok }` | `/api/kk` | — |
| `admin_update_issue_report_status` | `Backend.js → updateIssueReportStatus_()` | Update report status (open/resolved/etc) | `{ reportId, status }` | `{ ok }` | `/api/kk` | — |

### 2i. Team Write Actions

| Apps Script Action | Source File | Purpose | Input Params | Output Shape | Used By Route(s) | Risk Notes |
|---|---|---|---|---|---|---|
| `admin_add_team_member` | `Backend.js → addAdminTeamMember_()` | Add internal team member | member data | `{ ok }` | `/api/kk` | — |
| `admin_update_team_member` | `Backend.js → updateAdminTeamMember_()` | Edit team member | member data | `{ ok }` | `/api/kk` | — |
| `admin_delete_team_member` | `Backend.js → deleteAdminTeamMember_()` | Remove team member | member data | `{ ok }` | `/api/kk` | — |

---

## 3. Admin Authentication Flow

### Current End-to-End Flow

```
1. User visits /admin/* (any admin page)
        ↓
2. middleware.ts fires (edge)
   - Reads kk_auth_session cookie → lib/auth.ts getAuthSession()
   - Reads kk_admin cookie
   - If either is missing → redirect to /login?next=<path>
        ↓
3. /admin/login/page.tsx
   - Redirects to /login?next=/admin/dashboard  (reuses main OTP login)
        ↓
4. User completes OTP login (Supabase — already migrated)
   - `POST /api/verify-otp`
   - Verifies OTP in Supabase
   - Calls `checkAdminByPhone(phone)`
        ↓
5. `checkAdminByPhone(phone)`
   - Delegates to `verifyAdminByPhone(phone)`
   - Queries Supabase `admins` table via service-role client
        ↓
6. `/api/verify-otp` response
   - Sets `kk_auth_session`
   - Sets `kk_admin=1` only when `isAdmin === true`
   - Returns `{ isAdmin, adminName, adminRole, permissions }`
        ↓
7. `app/verify/page.tsx`
   - Writes `kk_admin_session` to localStorage when `isAdmin === true`
   - Redirects to the requested admin page
        ↓
8. Future `/admin/*` page loads
   - `middleware.ts` checks `kk_auth_session` + `kk_admin=1`
   - Allows request through when both are present
        ↓
9. `components/AdminLayoutClient.tsx` recovery path
   - If `kk_admin_session` is missing, reads `kk_auth_session`
   - Calls `POST /api/admin-verify { phone }`
   - `/api/admin-verify` calls `verifyAdminByPhone()` directly
   - Rehydrates `kk_admin_session` on success
        ↓
10. API calls from admin pages go to native routes or `POST /api/kk`
    - For ADMIN_ONLY_ACTIONS: requireAdminSession() is called
    - requireAdminSession() reads kk_auth_session cookie → extracts phone
    - Calls checkAdminByPhone(phone) → Supabase `admins` lookup
    - Only if ok=true does the request proceed to the underlying handler
```

### Session Storage

| Storage | Key | Value | Set By | Read By |
|---|---|---|---|---|
| Cookie | `kk_auth_session` | `{ phone, verified: true, createdAt }` | Supabase OTP login | `middleware.ts`, `requireAdminSession()` |
| Cookie | `kk_admin` | `"1"` | `/api/verify-otp` response when admin lookup succeeds | `middleware.ts` |
| localStorage | `kk_admin_session` | `{ isAdmin: true, name, role, permissions[] }` | `app/verify/page.tsx` or `components/AdminLayoutClient.tsx` recovery path | `app/admin/layout.tsx AdminLayoutClient` |

### Dependency on Supabase

- **`admins` table** — source of truth for admin identity and permissions.
- **OTP tables / RPC** — used by the main OTP flow, already Supabase-backed.

### Current Admin Auth Dependency Status

Admin Auth is now GAS-free:

- `/api/verify-otp` checks admin status through `checkAdminByPhone()` → Supabase
- `/api/admin-verify` re-verifies through `verifyAdminByPhone()` → Supabase
- `requireAdminSession()` checks admin status through `checkAdminByPhone()` → Supabase
- `middleware.ts` remains cookie-only and does not call GAS

---

## 4. Admin Dashboard Data Flow

| Dashboard Section | UI Component / Page | Route Called | Apps Script Action | Sheets Touched | Notes |
|---|---|---|---|---|---|
| Summary cards (provider count, task count, etc.) | `app/admin/dashboard/page.tsx` | `POST /api/kk` | `admin_get_dashboard` | Multiple (Providers, Tasks, Categories, Areas) | Also accessible via `GET /api/admin/stats` — no auth there |
| Pending category requests | `app/admin/dashboard/page.tsx` | `POST /api/kk` | `admin_get_category_requests` | PendingCategories | — |
| Providers table | `app/admin/dashboard/page.tsx`, `app/admin/providers/[id]/page.tsx` | `POST /api/kk` | `admin_get_providers`, `admin_get_provider` | Providers | — |
| Notification health / logs | `app/admin/logs/page.tsx`, `app/admin/dashboard/page.tsx` | `POST /api/kk` | `admin_get_notification_logs` (`limit` param), `admin_get_notification_summary` (`taskId` param) | Notification log sheet (name **Unconfirmed**) | Two separate actions for list vs. per-task |
| Category management | `app/admin/dashboard/page.tsx` | `POST /api/kk` | `admin_get_categories` | Categories | — |
| Area management | `app/admin/dashboard/page.tsx` | `POST /api/kk` | `admin_get_area_mappings`, `admin_get_unmapped_areas` | Areas, AreaAliases (sheet names **Unconfirmed**) | — |
| Admin chat inbox | `app/admin/chats/page.tsx` | `POST /api/kk` | `admin_list_chat_threads` | Chat sheet (**Unconfirmed**) | — |
| Single chat thread | `app/admin/chats/[threadId]/page.tsx` | `POST /api/kk` | `admin_get_chat_thread` | Chat sheet (**Unconfirmed**) | — |
| Issue reports | `app/admin/reviews/page.tsx` | `POST /api/kk` | `admin_get_issue_reports` | IssueReports sheet (**Unconfirmed**) | — |
| Task / requests table | `app/admin/tasks/page.tsx` | `POST /api/kk` | `admin_get_requests` | Tasks / UserRequests | Also used by non-admin provider chat page |
| Needs management | `app/admin/needs/page.tsx` | `POST /api/kk` | `admin_get_needs` | Needs sheet (**Unconfirmed**) | — |
| Team management | `app/admin/team/page.tsx` | `POST /api/kk` | `admin_get_team_members` | TeamMembers sheet (**Unconfirmed**) | — |
| Analytics | `app/admin/analytics/page.tsx` | `POST /api/kk` | **Unconfirmed** — file not fully read | **Unconfirmed** | Needs separate audit |

---

## 5. Admin Mutations

| User Action in Admin | Frontend Trigger File | API Route | Apps Script Action | Sheet / Record Updated | Expected UI Refresh Behavior | Migration Complexity |
|---|---|---|---|---|---|---|
| Verify / approve provider | `app/admin/dashboard/page.tsx` | `POST /api/kk` | `set_provider_verified` (payload: `{ providerId, phone }`) | Providers sheet — Verified column | Provider row updates in UI | Low |
| Block / unblock provider | `app/admin/providers/[id]/` | `POST /api/kk` | `admin_set_provider_blocked` | Providers sheet | Provider status badge updates | Low |
| Edit provider details | `app/admin/providers/[id]/edit/` | `POST /api/kk` | `admin_update_provider` | Providers sheet | Redirect back to provider view | Medium |
| Add new category | `app/admin/dashboard/page.tsx` | `POST /api/kk` | `add_category` (payload: `{ categoryName, active }`) | Categories sheet | Category list refreshes | Low |
| Edit category | `app/admin/dashboard/page.tsx` | `POST /api/kk` | `edit_category` (payload: `{ categoryName, active }`) | Categories sheet | Category row updates | Low |
| Toggle category active | `app/admin/dashboard/page.tsx` | `POST /api/kk` | `toggle_category` (payload: `{ categoryName }`) | Categories sheet | Category active state toggles | Low |
| Approve category request | `app/admin/dashboard/page.tsx` | `POST /api/kk` | `approve_category_request` | PendingCategories + Categories | Request removed from queue | Low |
| Reject category request | `app/admin/dashboard/page.tsx` | `POST /api/kk` | `reject_category_request` | PendingCategories | Request removed from queue | Low |
| Close category request | `app/admin/dashboard/page.tsx` | `POST /api/kk` | `admin_close_category_request` | PendingCategories (status → closed) | Request removed from queue | Low |
| Archive category request | `app/admin/dashboard/page.tsx` | `POST /api/kk` | `admin_archive_category_request` | PendingCategories (status → archived) | Request removed from queue | Low |
| Add area | `app/admin/dashboard/page.tsx` | `POST /api/kk` | `add_area` (payload: `{ areaName, active }`) | Areas sheet | Area list refreshes | Low |
| Edit area | `app/admin/dashboard/page.tsx` | `POST /api/kk` | `edit_area` | Areas sheet | Area row updates | Low |
| Add area alias | `app/admin/dashboard/page.tsx` | `POST /api/kk` | `admin_add_area_alias` (payload: `{ canonicalArea, aliasName }`) | AreaAliases sheet | Alias appears in list | Low |
| Update area alias | `app/admin/dashboard/page.tsx` | `POST /api/kk` | `admin_update_area_alias` (payload: `{ aliasId, aliasName, canonicalArea }`) | AreaAliases sheet | Alias row updates | Low |
| Toggle area alias | `app/admin/dashboard/page.tsx` | `POST /api/kk` | `admin_toggle_area_alias` (payload: `{ aliasId }`) | AreaAliases sheet | Alias active state toggles | Low |
| Map unmapped area to canonical | `app/admin/dashboard/page.tsx` | `POST /api/kk` | `admin_map_unmapped_area` (payload: `{ reviewId, canonicalArea }`) | UnmappedAreaReviews + AreaAliases | Review resolved from queue | Medium |
| Create new area from unmapped | `app/admin/dashboard/page.tsx` | `POST /api/kk` | `admin_create_area_from_unmapped` (payload: `{ reviewId, newAreaName }`) | Areas + UnmappedAreaReviews | New area created, review resolved | Medium |
| Merge area into canonical | `app/admin/dashboard/page.tsx` | `POST /api/kk` | `admin_merge_area_into_canonical` | Areas + AreaAliases + ProviderAreas | Areas consolidated | **High** — destructive, updates multiple sheets |
| Remind providers | `app/admin/dashboard/page.tsx` | `POST /api/kk` | `admin_remind_providers` | Notification log + WhatsApp trigger | Confirmation toast | **High** — triggers outbound WhatsApp via `Whatsapp.gs` |
| Assign provider to task | `app/admin/dashboard/page.tsx` | `POST /api/kk` | `admin_assign_provider` (payload: `{ taskId, providerId }`) | Tasks + ProviderTaskMatches | Match record created | Medium |
| Close task/request | `app/admin/tasks/page.tsx` | `POST /api/kk` | `admin_close_request` | Tasks sheet | Request marked closed | Low |
| Close chat thread | `app/admin/chats/[threadId]/` | `POST /api/kk` | `admin_update_chat_thread_status` (payload: `{ threadId, status: "closed" }`) | Chat sheet | Thread marked closed | Medium |
| Update issue report status | `app/admin/reviews/page.tsx` | `POST /api/kk` | `admin_update_issue_report_status` (payload: `{ reportId, status }`) | IssueReports sheet | Report status updates | Low |
| Add team member | `app/admin/team/page.tsx` | `POST /api/kk` | `admin_add_team_member` | TeamMembers sheet | Member appears in table | Low |
| Update team member | `app/admin/team/page.tsx` | `POST /api/kk` | `admin_update_team_member` | TeamMembers sheet | Member row updates | Low |
| Delete team member | `app/admin/team/page.tsx` | `POST /api/kk` | `admin_delete_team_member` | TeamMembers sheet | Member removed from table | Low |
| Hide / unhide need | `app/admin/needs/page.tsx` | `POST /api/kk` | `admin_hide_need` / `admin_unhide_need` | Needs sheet | Need visibility toggles | Low |
| Close need | `app/admin/needs/page.tsx` | `POST /api/kk` | `admin_close_need` | Needs sheet | Need marked closed | Low |
| Set need rank | `app/admin/needs/page.tsx` | `POST /api/kk` | `admin_set_need_rank` | Needs sheet | Needs reorder | Low |

---

## 6. Proposed New Backend Contract (Draft Only)

These are proposed replacements — no code changes made. All use Supabase as the backend.

### 6a. Authentication

| Current Route | Current Apps Script Action | Proposed New Route | HTTP Method | Notes |
|---|---|---|---|---|
| `/api/admin-verify` | None in live code | Current route is already native | POST | Calls `verifyAdminByPhone()` directly and preserves legacy response shape |
| `lib/adminAuth.ts → checkAdminByPhone()` | None in live code | Current helper is already native | — | Delegates to `verifyAdminByPhone()` which queries Supabase `admins` |
| `middleware.ts` cookie check | None (cookie only) | No auth backend change needed | — | Middleware already only checks cookies; `kk_admin=1` is set by `/api/verify-otp` |

### 6b. Dashboard & Stats

| Current Route | Current Apps Script Action | Proposed New Route | HTTP Method | Notes |
|---|---|---|---|---|
| `/api/admin/stats` | `admin_get_dashboard` | `/api/v2/admin/dashboard` | GET | Supabase aggregate queries; add auth guard (currently missing) |
| `/api/kk` + `admin_get_providers` | `admin_get_providers` | `/api/v2/admin/providers` | GET | Query `providers` table with filters |
| `/api/kk` + `admin_get_provider` | `admin_get_provider` | `/api/v2/admin/providers/[id]` | GET | Query `providers` by ID or phone |
| `/api/kk` + `admin_get_category_requests` | `admin_get_category_requests` | `/api/v2/admin/categories/requests` | GET | Query `pending_categories` table |
| `/api/kk` + `admin_get_categories` | `admin_get_categories` | `/api/v2/admin/categories` | GET | Query `categories` table |
| `/api/kk` + `admin_get_area_mappings` | `admin_get_area_mappings` | `/api/v2/admin/areas` | GET | Query `areas` + `area_aliases` tables |
| `/api/kk` + `admin_get_unmapped_areas` | `admin_get_unmapped_areas` | `/api/v2/admin/areas/unmapped` | GET | Query `unmapped_area_reviews` table |
| `/api/kk` + `admin_get_requests` | `admin_get_requests` | `/api/v2/admin/tasks` | GET | Query `tasks` / `user_requests` table |
| `/api/kk` + `admin_get_notification_logs` | `admin_get_notification_logs` | `/api/v2/admin/notifications/logs` | GET | Query notification log table |
| `/api/kk` + `admin_get_notification_summary` | `admin_get_notification_summary` | `/api/v2/admin/notifications/summary` | GET | Query by taskId |
| `/api/kk` + `admin_get_team_members` | `admin_get_team_members` | `/api/v2/admin/team` | GET | Query `team_members` table |
| `/api/kk` + `admin_get_issue_reports` | `admin_get_issue_reports` | `/api/v2/admin/issues` | GET | Query `issue_reports` table |
| `/api/kk` + `admin_list_chat_threads` | `admin_list_chat_threads` | `/api/v2/admin/chats` | GET | Query chat threads table |
| `/api/kk` + `admin_get_chat_thread` | `admin_get_chat_thread` | `/api/v2/admin/chats/[threadId]` | GET | Query chat + messages |
| `/api/kk` + `admin_get_needs` | `admin_get_needs` | `/api/v2/admin/needs` | GET | Query `needs` table |

### 6c. Provider Mutations

| Current Route | Current Apps Script Action | Proposed New Route | HTTP Method | Notes |
|---|---|---|---|---|
| `/api/kk` + `set_provider_verified` | `setProviderVerified_()` | `/api/v2/admin/providers/[id]/verify` | PATCH | `UPDATE providers SET verified=true` |
| `/api/kk` + `admin_update_provider` | `updateAdminProvider_()` | `/api/v2/admin/providers/[id]` | PATCH | `UPDATE providers SET ...` |
| `/api/kk` + `admin_set_provider_blocked` | `setAdminProviderBlocked_()` | `/api/v2/admin/providers/[id]/block` | PATCH | `UPDATE providers SET blocked=...` |
| `/api/kk` + `admin_remind_providers` | `remindProviders_()` → triggers WhatsApp | `/api/v2/admin/providers/remind` | POST | Integrate WhatsApp service directly |
| `/api/kk` + `admin_assign_provider` | `assignProvider_()` | `/api/v2/admin/tasks/[id]/assign` | POST | Insert into `provider_task_matches` |

### 6d. Category Mutations

| Current Route | Current Apps Script Action | Proposed New Route | HTTP Method | Notes |
|---|---|---|---|---|
| `/api/kk` + `add_category` | `addCategory_()` | `/api/v2/admin/categories` | POST | `INSERT INTO categories` |
| `/api/kk` + `edit_category` | `editCategory_()` | `/api/v2/admin/categories/[id]` | PATCH | `UPDATE categories` |
| `/api/kk` + `toggle_category` | `toggleCategory_()` | `/api/v2/admin/categories/[id]/toggle` | PATCH | `UPDATE categories SET active=...` |
| `/api/kk` + `approve_category_request` | `approveCategoryRequest_()` | `/api/v2/admin/categories/requests/[id]/approve` | POST | Update request + create category |
| `/api/kk` + `reject_category_request` | `rejectCategoryRequest_()` | `/api/v2/admin/categories/requests/[id]/reject` | POST | Update request status |
| `/api/kk` + `admin_close_category_request` | `updateCategoryRequestAdminAction_(data, "closed")` | `/api/v2/admin/categories/requests/[id]/close` | POST | Update request status |

### 6e. Area Mutations

| Current Route | Current Apps Script Action | Proposed New Route | HTTP Method | Notes |
|---|---|---|---|---|
| `/api/kk` + `add_area` | `addArea_()` | `/api/v2/admin/areas` | POST | `INSERT INTO areas` |
| `/api/kk` + `edit_area` | `editArea_()` | `/api/v2/admin/areas/[id]` | PATCH | `UPDATE areas` |
| `/api/kk` + `admin_add_area_alias` | `addAreaAlias_()` | `/api/v2/admin/areas/[id]/aliases` | POST | `INSERT INTO area_aliases` |
| `/api/kk` + `admin_update_area_alias` | `updateAreaAlias_()` | `/api/v2/admin/areas/aliases/[aliasId]` | PATCH | `UPDATE area_aliases` |
| `/api/kk` + `admin_toggle_area_alias` | `toggleAreaAlias_()` | `/api/v2/admin/areas/aliases/[aliasId]/toggle` | PATCH | `UPDATE area_aliases SET active=...` |
| `/api/kk` + `admin_merge_area_into_canonical` | `mergeAreaIntoCanonical_()` | `/api/v2/admin/areas/merge` | POST | Multi-table update — wrap in transaction |
| `/api/kk` + `admin_map_unmapped_area` | `mapUnmappedAreaReview_()` | `/api/v2/admin/areas/unmapped/[reviewId]/map` | POST | Update review + create alias |
| `/api/kk` + `admin_create_area_from_unmapped` | `createAreaFromReview_()` | `/api/v2/admin/areas/unmapped/[reviewId]/create` | POST | Insert area + resolve review |

### 6f. Other Mutations

| Current Route | Current Apps Script Action | Proposed New Route | HTTP Method | Notes |
|---|---|---|---|---|
| `/api/kk` + `admin_close_request` | `closeRequest_()` | `/api/v2/admin/tasks/[id]/close` | POST | `UPDATE tasks SET status="closed"` |
| `/api/kk` + `admin_update_chat_thread_status` | `adminUpdateChatThreadStatus_()` | `/api/v2/admin/chats/[threadId]/status` | PATCH | `UPDATE chat_threads SET status=...` |
| `/api/kk` + `admin_update_issue_report_status` | `updateIssueReportStatus_()` | `/api/v2/admin/issues/[reportId]/status` | PATCH | `UPDATE issue_reports SET status=...` |
| `/api/kk` + `admin_add_team_member` | `addAdminTeamMember_()` | `/api/v2/admin/team` | POST | `INSERT INTO team_members` |
| `/api/kk` + `admin_update_team_member` | `updateAdminTeamMember_()` | `/api/v2/admin/team/[id]` | PATCH | `UPDATE team_members` |
| `/api/kk` + `admin_delete_team_member` | `deleteAdminTeamMember_()` | `/api/v2/admin/team/[id]` | DELETE | `DELETE FROM team_members` |

---

## 7. Recommended First Admin Slice

### Recommended: Admin Authentication (`admin_verify`)

**Completed — Admin Auth is already migrated.**

**Current state:**  
Admin identity verification no longer depends on GAS. The live path is:

1. `/api/verify-otp` → `checkAdminByPhone()` → Supabase `admins`
2. `/api/admin-verify` → `verifyAdminByPhone()` → Supabase `admins`
3. `requireAdminSession()` → `checkAdminByPhone()` → Supabase `admins`

**What remains outside this completed slice:**
- Admin data reads and writes still have mixed native/GAS coverage in `/api/kk`
- Admin Auth itself is no longer a blocker for the remaining migrations

**Historical note:**  
Older slice notes in this repo describe the pre-migration and transitional states. The live runtime no longer matches those earlier snapshots.

---

*End of inventory. Total confirmed GAS admin actions: 50+. Files audited: 12+.*
