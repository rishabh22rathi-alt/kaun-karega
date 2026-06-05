-- Admin dashboard unread / "new since last open" read markers.
--
-- Powers /api/admin/unread-summary and /api/admin/mark-tab-read. Each row
-- records when a specific admin last opened a specific accordion tab on
-- /admin/dashboard. unread-summary compares the source-table timestamps
-- (created_at | updated_at | last_message_at) for each tab against this
-- last_read_at and emits hasUnread + count.
--
-- Root cause this fixes: the table previously lived only in
-- docs/migrations/admin-read-markers.sql and was never applied to the
-- live database, so markAdminTabRead() soft-failed (nothing persisted)
-- and unread-summary fell back to the 1970 baseline — counting every row
-- forever and making badges look "stuck". Promoting it into the canonical
-- supabase/migrations path makes last_read_at persist so badges clear and
-- stay cleared after the 45s poll.
--
-- Storage model: one row per (admin_phone, tab_key). admin_phone is the
-- canonical phone already stored in admins.phone (reused across devices).
-- tab_key is the application string ("reports", "chats", "kaam",
-- "category", "users") — plain text so new tabs need no schema change.
--
-- Columns + the UNIQUE (admin_phone, tab_key) constraint match exactly
-- what web/lib/admin/adminReadMarkers.ts reads/upserts:
--   loadMarkersForAdmin  → select tab_key, last_read_at where admin_phone
--   markAdminTabRead     → upsert(admin_phone, tab_key, last_read_at,
--                          updated_at) onConflict "admin_phone,tab_key".
--
-- Idempotent / add-only: re-running is safe; no existing table or column
-- is altered.

BEGIN;

CREATE TABLE IF NOT EXISTS public.admin_read_markers (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_phone     TEXT NOT NULL,
  tab_key         TEXT NOT NULL,
  -- The admin's "last viewed" wall-clock for this tab. unread-summary
  -- treats any source-table row with a timestamp > last_read_at as "new".
  last_read_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Audit field bumped on every UPSERT; does not change read semantics.
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Conflict target for markAdminTabRead()'s upsert.
  UNIQUE (admin_phone, tab_key)
);

-- Hot lookup: SELECT tab_key, last_read_at WHERE admin_phone = $1.
CREATE INDEX IF NOT EXISTS admin_read_markers_admin_phone_idx
  ON public.admin_read_markers (admin_phone);

COMMIT;
