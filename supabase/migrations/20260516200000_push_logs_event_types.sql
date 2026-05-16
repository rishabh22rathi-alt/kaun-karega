-- Phase 4B: widen push_logs.event_type CHECK to include 'new_service_request'.
--
-- The provider-facing matched-job push (process-task-notifications fan-out)
-- emits event_type='new_service_request' so it aligns 1:1 with the future
-- "new_service_requests" notification-preference toggle. The previous
-- 'job_matched' value is preserved so any historical rows or in-flight
-- callers remain valid.

alter table public.push_logs
  drop constraint if exists push_logs_event_type_check;

alter table public.push_logs
  add constraint push_logs_event_type_check
  check (event_type in ('new_service_request', 'job_matched', 'chat_message', 'test'));
