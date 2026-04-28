-- =============================================================================
-- Bring public.notification_logs in line with the columns that
-- web/lib/notificationLogStore.ts (appendNotificationLog) writes on every
-- insert. The DB instance currently has only { log_id, area, created_at };
-- the application code expects 14 columns total.
--
-- Idempotent — safe to re-run. Each ALTER uses IF NOT EXISTS.
--
-- Apply once via Supabase SQL editor before running:
--   web/e2e/chat-notification-logs.spec.ts
-- =============================================================================

ALTER TABLE public.notification_logs
  ADD COLUMN IF NOT EXISTS task_id        text,
  ADD COLUMN IF NOT EXISTS display_id     text,
  ADD COLUMN IF NOT EXISTS provider_id    text,
  ADD COLUMN IF NOT EXISTS provider_phone text,
  ADD COLUMN IF NOT EXISTS category       text,
  ADD COLUMN IF NOT EXISTS service_time   text,
  ADD COLUMN IF NOT EXISTS template_name  text,
  ADD COLUMN IF NOT EXISTS status         text,
  ADD COLUMN IF NOT EXISTS status_code    integer,
  ADD COLUMN IF NOT EXISTS message_id     text,
  ADD COLUMN IF NOT EXISTS error_message  text,
  ADD COLUMN IF NOT EXISTS raw_response   text;

-- Helpful indexes for the queries the chat suite + admin notifications
-- panel run. Idempotent — IF NOT EXISTS guards.
CREATE INDEX IF NOT EXISTS notification_logs_task_id_idx
  ON public.notification_logs (task_id);

CREATE INDEX IF NOT EXISTS notification_logs_template_status_idx
  ON public.notification_logs (template_name, status);
