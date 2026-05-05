# Migration Plan — Kaun Karega
## Apps Script → Supabase/Next.js API

---

## Overview

This document tracks every API route and Apps Script dependency that must be migrated from Google Apps Script to Supabase + Next.js API routes.

---

## Recommended Migration Order

1. **Admin** — lowest risk, internal-only usage
2. **Categories** — read-only, simple structure
3. **Areas** — read-only, simple structure
4. **Tasks (create/write)** — write operations, depends on Categories + Areas
5. **Matching** — depends on Tasks + Providers
6. **Notifications** — depends on Matching
7. **Chat** — highest complexity, real-time requirements

---

## MODULE A — Categories

| File / Route | Current Dependency (Apps Script) | Action | Status | Migration Phase |
|---|---|---|---|---|
| `/api/categories` | `getCategories` | read | Pending | Phase 2 (Core Read) |
| `/api/categories/[id]` | `getCategoryById` | read | Pending | Phase 2 (Core Read) |
| `/api/admin/approve-category` | `approveCategory` | write | Pending | Phase 1 (Admin) |

---

## MODULE B — Areas

| File / Route | Current Dependency (Apps Script) | Action | Status | Migration Phase |
|---|---|---|---|---|
| `/api/areas` | `getAreas` | read | Pending | Phase 2 (Core Read) |
| `/api/areas/[id]` | `getAreaById` | read | Pending | Phase 2 (Core Read) |
| `/api/areas/by-category` | `getAreasByCategory` | read | Pending | Phase 2 (Core Read) |

---

## MODULE C — Tasks

| File / Route | Current Dependency (Apps Script) | Action | Status | Migration Phase |
|---|---|---|---|---|
| `/api/tasks` | `getTasks` | read | Pending | Phase 2 (Core Read) |
| `/api/tasks/create` | `createTask` | write | Pending | Phase 3 (Task Write) |
| `/api/tasks/[id]` | `getTaskById` | read | Pending | Phase 2 (Core Read) |
| `/api/tasks/[id]/update` | `updateTask` | write | Pending | Phase 3 (Task Write) |
| `/api/tasks/[id]/delete` | `deleteTask` | write | Pending | Phase 3 (Task Write) |

---

## MODULE D — Admin

| File / Route | Current Dependency (Apps Script) | Action | Status | Migration Phase |
|---|---|---|---|---|
| `/api/admin-verify` | None for Admin Auth | read | Completed | Phase 1 (Admin) |
| `/api/admin/stats` | None for Admin Auth | read | Completed | Phase 1 (Admin) |
| `/api/admin/providers` | `admin_getProviders` | read | Pending | Phase 1 (Admin) |
| `/api/admin/approve-provider` | `admin_approveProvider` | write | Pending | Phase 1 (Admin) |
| `/api/admin/reject-provider` | `admin_rejectProvider` | write | Pending | Phase 1 (Admin) |
| `/api/admin/approve-category` | `admin_approveCategory` | write | Pending | Phase 1 (Admin) |
| `/api/admin/*` | Mixed: some routes native, many `admin_*` actions still GAS-backed | read/write | In Progress | Phase 1 (Admin) |

---

## MODULE E — Matching

| File / Route | Current Dependency (Apps Script) | Action | Status | Migration Phase |
|---|---|---|---|---|
| `/api/match` | `matchProviders` | read | Pending | Phase 4 (Matching) |
| `/api/match/confirm` | `confirmMatch` | write | Pending | Phase 4 (Matching) |
| `/api/match/reject` | `rejectMatch` | write | Pending | Phase 4 (Matching) |

---

## MODULE F — Notifications

| File / Route | Current Dependency (Apps Script) | Action | Status | Migration Phase |
|---|---|---|---|---|
| `/api/notify` | `sendNotification` | write | Pending | Phase 5 (Notifications) |
| `/api/notify/whatsapp` | `sendWhatsAppMessage` | write | Pending | Phase 5 (Notifications) |
| `/api/notifications/[userId]` | `getUserNotifications` | read | Pending | Phase 5 (Notifications) |

---

## MODULE G — Chat

| File / Route | Current Dependency (Apps Script) | Action | Status | Migration Phase |
|---|---|---|---|---|
| `/api/chat/messages` | `getChatMessages` | read | Pending | Phase 6 (Chat) |
| `/api/chat/send` | `sendChatMessage` | write | Pending | Phase 6 (Chat) |
| `/api/chat/[roomId]` | `getChatRoom` | read | Pending | Phase 6 (Chat) |

---

## Admin Migration Scope

The Admin module is the first target for migration due to its internal-only usage and low risk profile.

### Included in Admin Migration

| Feature | Current Implementation | Target |
|---|---|---|
| OTP Login (admin) | Supabase OTP + native admin lookup | Completed |
| Admin Verification | Supabase `admins` lookup via `/api/admin-verify` and `checkAdminByPhone()` | Completed |
| Dashboard Stats auth gate | `requireAdminSession()` + native admin lookup | Completed |
| Provider Approval | Apps Script `admin_approveProvider` | `/api/admin/approve-provider` → Supabase update |
| Category Approval | Apps Script `admin_approveCategory` | `/api/admin/approve-category` → Supabase update |

### Admin Migration Notes

- Admin Auth is already GAS-free
- `/api/verify-otp`, `/api/admin-verify`, and `requireAdminSession()` all use the native Supabase-backed admin lookup
- Remaining admin work is now data-flow migration, not auth migration
- Admin routes remain protected by cookie middleware plus server-side `requireAdminSession()` checks

---

## Migration Status Summary

| Module | Phase | Status |
|---|---|---|
| Admin | Phase 1 | In Progress (Auth complete, data migration ongoing) |
| Categories | Phase 2 | Pending |
| Areas | Phase 2 | Pending |
| Tasks | Phase 3 | Pending |
| Matching | Phase 4 | Pending |
| Notifications | Phase 5 | Pending |
| Chat | Phase 6 | Pending |

---

## Completed Migrations (Reference)

- OTP system fully migrated to Supabase
- WhatsApp OTP integrated with Supabase
- Old OTP APIs replaced (`send-otp`, `verify-otp`)
- Dead OTP Apps Script code removed
- Build stable

---

*Last updated: 2026-04-19*
