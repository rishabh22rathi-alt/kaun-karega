-- Task closure tracking columns (canonical promotion).
--
-- Captures when a task was closed, who closed it (user / admin / system),
-- and the reason. Backs closeTask() / autoCloseExpiredTasks() in
-- web/lib/admin/adminTaskMutations.ts, the admin task-monitor closure light,
-- and the "completed today" metric in adminTaskReads.
--
-- Background: these columns previously lived only in
-- web/docs/migrations/add-task-closure-tracking.sql and were never in the
-- canonical supabase/migrations path. They already exist in production (the
-- close flow is live), so this is an ADD-ONLY, idempotent promotion so fresh
-- environments (staging / new clones) get the columns through the normal
-- migration flow. `ADD COLUMN IF NOT EXISTS` is a no-op where they exist —
-- it does not alter production data.

alter table public.tasks
  add column if not exists closed_at   timestamptz,
  add column if not exists closed_by   text,
  add column if not exists close_reason text;
