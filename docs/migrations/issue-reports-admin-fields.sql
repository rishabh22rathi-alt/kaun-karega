-- Issue Reports — admin-visible fields backfill.
--
-- Live deployments installed before docs/admin-slice-issue-reports.sql
-- was last revised may be missing one or more of the admin-side fields.
-- Symptom: user-facing /api/report-issue submit fails with
--   "Could not find the 'admin_notes' column of 'issue_reports'
--   in the schema cache".
--
-- The application-side fix (lib/admin/adminIssueReports.ts) stops the
-- user-submit insert from referencing admin-only columns, so reports
-- can be filed even on an unmigrated table. This migration brings
-- existing tables up to spec so the admin status-update path
-- (`admin_update_issue_report_status`) can write `admin_notes`,
-- `resolved_at`, and the new `updated_at` audit field.
--
-- Idempotent: every ALTER uses IF NOT EXISTS / IF EXISTS guards so
-- the script is safe to re-run after partial application.
--
-- Recommended sequence:
--   1. Deploy the application fix.
--   2. Run this migration in the Supabase SQL editor.
--   3. Verify by clicking "Mark Resolved" on any open issue in the
--      admin dashboard — it must succeed and the row's resolved_at /
--      updated_at must be populated.

BEGIN;

-- Required by admin status-update flow.
ALTER TABLE issue_reports
  ADD COLUMN IF NOT EXISTS admin_notes TEXT;

ALTER TABLE issue_reports
  ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ;

-- New audit field — bumped on every insert and update.
ALTER TABLE issue_reports
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- Defensive: older deployments may also be missing these columns
-- referenced by the helper.
ALTER TABLE issue_reports
  ADD COLUMN IF NOT EXISTS priority TEXT NOT NULL DEFAULT 'normal';

ALTER TABLE issue_reports
  ADD COLUMN IF NOT EXISTS issue_page TEXT NOT NULL DEFAULT '';

-- Indexes for the admin dashboard's newest-first sort and status filter.
CREATE INDEX IF NOT EXISTS issue_reports_created_at_idx
  ON issue_reports (created_at DESC);
CREATE INDEX IF NOT EXISTS issue_reports_status_idx
  ON issue_reports (status);
CREATE INDEX IF NOT EXISTS issue_reports_reporter_role_idx
  ON issue_reports (reporter_role);

COMMIT;

-- Sanity check (run separately after the migration):
--   SELECT column_name, data_type
--   FROM   information_schema.columns
--   WHERE  table_name = 'issue_reports'
--   ORDER  BY ordinal_position;
--
-- Expected columns:
--   issue_id, created_at, updated_at, reporter_role, reporter_phone,
--   reporter_name, issue_type, issue_page, description, status,
--   priority, admin_notes, resolved_at
