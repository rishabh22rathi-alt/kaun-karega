create table if not exists public.needs (
  need_id text primary key,
  user_phone text not null,
  display_name text not null default '',
  is_anonymous boolean not null default false,
  category text not null default '',
  area text not null default '',
  title text not null default '',
  description text not null default '',
  status text not null default 'open',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  valid_days integer not null default 7,
  expires_at timestamptz null,
  completed_at timestamptz null,
  closed_at timestamptz null,
  closed_by text not null default '',
  is_hidden boolean not null default false,
  constraint needs_status_check check (status in ('open', 'completed', 'closed'))
);

create index if not exists idx_needs_user_phone_created_at
  on public.needs (user_phone, created_at desc);
