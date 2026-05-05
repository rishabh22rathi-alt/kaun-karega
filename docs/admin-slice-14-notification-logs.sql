create table if not exists public.notification_logs (
  log_id text primary key,
  created_at timestamptz not null default now(),
  task_id text not null,
  display_id text null,
  provider_id text not null,
  provider_phone text not null default '',
  category text null,
  area text null,
  service_time text null,
  template_name text null,
  status text not null,
  status_code integer null,
  message_id text not null default '',
  error_message text not null default '',
  raw_response text null
);

create index if not exists idx_notification_logs_created_at
  on public.notification_logs (created_at desc);

create index if not exists idx_notification_logs_task_created_at
  on public.notification_logs (task_id, created_at desc);
