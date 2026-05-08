-- Issue Reports — canonical MVP schema.
--
-- The live Supabase `issue_reports` table currently has TWO columns
-- (verified via probe insert on 2026-05-09):
--   - id          UUID  (PRIMARY KEY, default gen_random_uuid())
--   - created_at  TIMESTAMPTZ (default now())
--
-- Every other column the application's helper expects is missing —
-- which is why every report-issue submit failed with cascading
-- "Could not find the 'X' column of 'issue_reports'" errors. This
-- migration adds the canonical MVP columns the helper writes plus
-- the admin-side fields the dashboard's status-update flow writes.
--
-- Idempotent — every ADD COLUMN uses IF NOT EXISTS, every CREATE
-- INDEX uses IF NOT EXISTS. Safe to re-run.
--
-- Rollout: deploy the application code first (which writes only the
-- canonical column names), then run this migration in the Supabase
-- SQL editor.

BEGIN;

-- ─── User-submit columns (helper writes on insert) ───────────────────
ALTER TABLE issue_reports ADD COLUMN IF NOT EXISTS reporter_phone TEXT NOT NULL DEFAULT '';
ALTER TABLE issue_reports ADD COLUMN IF NOT EXISTS reporter_type  TEXT NOT NULL DEFAULT 'user';
ALTER TABLE issue_reports ADD COLUMN IF NOT EXISTS reporter_name  TEXT;
ALTER TABLE issue_reports ADD COLUMN IF NOT EXISTS issue_type     TEXT NOT NULL DEFAULT '';
ALTER TABLE issue_reports ADD COLUMN IF NOT EXISTS issue_page     TEXT;
ALTER TABLE issue_reports ADD COLUMN IF NOT EXISTS title          TEXT;
ALTER TABLE issue_reports ADD COLUMN IF NOT EXISTS message        TEXT NOT NULL DEFAULT '';
ALTER TABLE issue_reports ADD COLUMN IF NOT EXISTS status         TEXT NOT NULL DEFAULT 'open';
ALTER TABLE issue_reports ADD COLUMN IF NOT EXISTS updated_at     TIMESTAMPTZ NOT NULL DEFAULT now();

-- ─── Admin-side columns (status-update flow writes) ──────────────────
ALTER TABLE issue_reports ADD COLUMN IF NOT EXISTS admin_notes    TEXT;
ALTER TABLE issue_reports ADD COLUMN IF NOT EXISTS resolved_at    TIMESTAMPTZ;

-- ─── Indexes for the admin dashboard ────────────────────────────────
CREATE INDEX IF NOT EXISTS issue_reports_created_at_idx     ON issue_reports (created_at DESC);
CREATE INDEX IF NOT EXISTS issue_reports_status_idx         ON issue_reports (status);
CREATE INDEX IF NOT EXISTS issue_reports_reporter_type_idx  ON issue_reports (reporter_type);

COMMIT;

-- Sanity check (run separately):
--   SELECT column_name, data_type, is_nullable, column_default
--   FROM   information_schema.columns
--   WHERE  table_name = 'issue_reports'
--   ORDER  BY ordinal_position;
--
-- Expected 13 rows:
--   id, created_at, reporter_phone, reporter_type, reporter_name,
--   issue_type, issue_page, title, message, status, updated_at,
--   admin_notes, resolved_at
