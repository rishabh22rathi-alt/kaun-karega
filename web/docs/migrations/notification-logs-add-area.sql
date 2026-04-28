-- =============================================================================
-- Add `area` column to public.notification_logs.
--
-- The chat-notification logger (web/lib/notificationLogStore.ts) writes an
-- `area` field on every insert, mirroring the column already present on the
-- `tasks` and `chat_threads` tables. This DB instance was created before
-- that column was added, so inserts fail with:
--   "Could not find the 'area' column of 'notification_logs' in the schema cache"
--
-- Idempotent — safe to re-run.
-- =============================================================================

ALTER TABLE public.notification_logs
  ADD COLUMN IF NOT EXISTS area TEXT;
