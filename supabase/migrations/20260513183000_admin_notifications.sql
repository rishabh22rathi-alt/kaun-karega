create table if not exists public.admin_notifications (
  id uuid primary key default gen_random_uuid(),
  type text not null,
  title text not null,
  message text not null,
  severity text not null default 'info',
  source text,
  related_id text,
  action_url text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_admin_notifications_created_at
on public.admin_notifications(created_at desc);

create index if not exists idx_admin_notifications_read_at
on public.admin_notifications(read_at);

create index if not exists idx_admin_notifications_severity
on public.admin_notifications(severity);

create index if not exists idx_admin_notifications_type
on public.admin_notifications(type);

create index if not exists idx_admin_notifications_related_id
on public.admin_notifications(related_id);

alter table public.admin_notifications enable row level security;
