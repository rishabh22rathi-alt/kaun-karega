-- Admin dashboard unread/new-update indicators.
--
-- Powers /api/admin/unread-summary and /api/admin/mark-tab-read. Each
-- row records when a specific admin last opened a specific accordion
-- tab on /admin/dashboard. The unread-summary endpoint compares the
-- max(created_at|updated_at|last_message_at) on the source table for
-- each tab against this last_read_at and emits hasUnread + count.
--
-- Storage model:
--   one row per (admin_phone, tab_key). admin_phone is the canonical
--   12-digit form already stored in `admins.phone` so the marker is
--   reused across browsers/devices for the same admin identity.
--   tab_key is the application-side string ("reports", "chats",
--   "kaam", "category", "users") — the column is plain text so new
--   tabs can opt in without a schema change.
--
-- Idempotent: re-running the script is safe. Add-only — no existing
-- table or column is altered.

BEGIN;

CREATE TABLE IF NOT EXISTS public.admin_read_markers (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_phone     TEXT NOT NULL,
  tab_key         TEXT NOT NULL,
  -- The admin's "last viewed" wall-clock for this tab. The
  -- unread-summary endpoint treats any source-table row with a
  -- timestamp > last_read_at as "new for this admin".
  last_read_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Audit field bumped on every UPSERT — useful for debugging stale
  -- markers without changing the read-comparison semantics.
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (admin_phone, tab_key)
);

-- Index supports the hot lookup pattern:
--   SELECT tab_key, last_read_at
--   FROM   admin_read_markers
--   WHERE  admin_phone = $1;
CREATE INDEX IF NOT EXISTS admin_read_markers_admin_phone_idx
  ON public.admin_read_markers (admin_phone);

COMMIT;

-- Sanity check (run separately after the migration):
--   SELECT column_name, data_type
--   FROM   information_schema.columns
--   WHERE  table_name = 'admin_read_markers'
--   ORDER  BY ordinal_position;
--
-- Expected columns: id, admin_phone, tab_key, last_read_at, updated_at
