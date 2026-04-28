-- Add task closure tracking columns.
--
-- Purpose:
--   Capture when a task was closed, who closed it (user / admin / system),
--   and the reason. Backs the admin task monitor closure light, the
--   "completed today" metric in adminTaskReads, and any future user-facing
--   "withdraw request" flow or auto-expiry job.
--
-- Idempotent: safe to re-run.
--
-- Apply via Supabase SQL editor (or psql with service-role connection)
-- BEFORE deploying the application code that reads these columns.

alter table public.tasks
  add column if not exists closed_at timestamptz,
  add column if not exists closed_by text,
  add column if not exists close_reason text;

-- Optional: a CHECK constraint to enforce the writer contract. Commented
-- out so existing rows with NULL closed_by are unaffected. Enable once
-- backfill (if any) is complete.
--
-- alter table public.tasks
--   add constraint tasks_closed_by_chk
--   check (closed_by is null or closed_by in ('user', 'admin', 'system'));
