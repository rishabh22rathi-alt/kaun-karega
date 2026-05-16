create table if not exists public.native_push_devices (
  id uuid primary key default gen_random_uuid(),
  fcm_token text not null unique,
  phone text not null,
  actor_type text not null check (actor_type in ('user', 'provider', 'admin')),
  provider_id text null,
  platform text not null default 'android',
  app_version text null,
  device_model text null,
  android_sdk integer null,
  active boolean not null default true,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revoked_at timestamptz null
);

create index if not exists idx_native_push_devices_phone_active
  on public.native_push_devices (phone, active);

create index if not exists idx_native_push_devices_provider_active
  on public.native_push_devices (provider_id, active)
  where provider_id is not null;

create index if not exists idx_native_push_devices_actor_active
  on public.native_push_devices (actor_type, active);

alter table public.native_push_devices enable row level security;
