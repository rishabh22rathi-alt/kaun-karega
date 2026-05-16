-- push_logs: durable audit trail for every native-push delivery attempt.
-- WhatsApp sends already go through notification_logs (template-shaped). FCM
-- attempts need their own shape: per-token results, fcm error codes, and a
-- tail-only token reference (never the full token — it's a credential).

create table if not exists public.push_logs (
  id                    uuid primary key default gen_random_uuid(),
  created_at            timestamptz not null default now(),
  event_type            text not null check (event_type in ('job_matched', 'chat_message', 'test')),
  task_id               text null,
  thread_id             text null,
  recipient_phone       text null,
  recipient_provider_id text null,
  fcm_token_tail        text null,
  status                text not null check (status in ('sent', 'failed', 'invalid_token', 'skipped')),
  fcm_message_id        text null,
  error_code            text null,
  error_message         text null,
  payload_json          jsonb null
);

-- Most reads are "recent events, newest first" for the admin dashboard.
create index if not exists idx_push_logs_created_at
  on public.push_logs (created_at desc);

-- Per-provider drill-down on the admin provider page.
create index if not exists idx_push_logs_recipient_provider
  on public.push_logs (recipient_provider_id, created_at desc)
  where recipient_provider_id is not null;

-- Per-phone drill-down for support tickets.
create index if not exists idx_push_logs_recipient_phone
  on public.push_logs (recipient_phone, created_at desc)
  where recipient_phone is not null;

-- Per-task drill-down to correlate with notification_logs (WhatsApp) and
-- provider_notifications (bell).
create index if not exists idx_push_logs_task
  on public.push_logs (task_id, created_at desc)
  where task_id is not null;

-- RLS on, no policies. Only the service-role admin client can read or write.
alter table public.push_logs enable row level security;

comment on table public.push_logs is
  'Audit ledger for FCM delivery attempts. fcm_token_tail = last 8 chars only; the full token is a credential and must never be persisted here.';
