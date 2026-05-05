-- Issue Reports table
-- Run this in the Supabase SQL editor before deploying the native issue reports migration.

CREATE TABLE IF NOT EXISTS issue_reports (
  issue_id      TEXT PRIMARY KEY,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  reporter_role TEXT NOT NULL DEFAULT 'user',
  reporter_phone TEXT NOT NULL DEFAULT '',
  reporter_name  TEXT,
  issue_type     TEXT NOT NULL DEFAULT '',
  issue_page     TEXT NOT NULL DEFAULT '',
  description    TEXT NOT NULL DEFAULT '',
  status         TEXT NOT NULL DEFAULT 'open',
  priority       TEXT NOT NULL DEFAULT 'normal',
  admin_notes    TEXT,
  resolved_at    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS issue_reports_created_at_idx ON issue_reports (created_at DESC);
CREATE INDEX IF NOT EXISTS issue_reports_status_idx ON issue_reports (status);
