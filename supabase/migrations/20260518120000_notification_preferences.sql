-- Notification preferences — Phase 1 (DB foundation only).
--
-- One row per (actor_type, actor_key, event_type). actor_key conventions:
--   - actor_type='user'     → canonical phone ("91XXXXXXXXXX")
--   - actor_type='provider' → providers.provider_id
--   - actor_type='admin'    → canonical phone ("91XXXXXXXXXX")
--
-- Absence of a row means ENABLED. Only opt-outs are persisted, so this
-- migration ships zero rows and existing devices keep receiving every
-- push exactly as they do today. No back-fill, no behavior change.

create table if not exists public.notification_preferences (
  id              uuid primary key default gen_random_uuid(),
  actor_type      text not null check (actor_type in ('user', 'provider', 'admin')),
  actor_key       text not null,
  event_type      text not null,
  enabled         boolean not null default true,
  updated_at      timestamptz not null default now(),
  updated_by      text null,
  updated_source  text null,
  created_at      timestamptz not null default now(),
  unique (actor_type, actor_key, event_type)
);

-- Hot path: "give me all of this actor's prefs" — fan-out filters and the
-- preferences API both read by (actor_type, actor_key).
create index if not exists idx_notif_prefs_actor
  on public.notification_preferences (actor_type, actor_key);

-- Bulk fan-out helper: "for this event_type, which actors have disabled?"
create index if not exists idx_notif_prefs_event_enabled
  on public.notification_preferences (event_type, enabled);

-- Hard rule: event_type='general' MUST always be enabled. The application
-- layer also enforces this, but a DB trigger is the canonical gate so a
-- direct SQL update or a future code regression cannot disable it.
create or replace function public.enforce_general_always_enabled()
returns trigger language plpgsql as $$
begin
  if new.event_type = 'general' and new.enabled = false then
    raise exception 'general notifications cannot be disabled'
      using errcode = '23514';
  end if;
  return new;
end $$;

drop trigger if exists trg_notif_prefs_general_always_enabled
  on public.notification_preferences;
create trigger trg_notif_prefs_general_always_enabled
  before insert or update on public.notification_preferences
  for each row execute function public.enforce_general_always_enabled();

-- Keep updated_at honest on every UPDATE. Callers may also set it
-- explicitly; this trigger only fires when they don't.
create or replace function public.touch_notification_preferences_updated_at()
returns trigger language plpgsql as $$
begin
  if new.updated_at is null or new.updated_at = old.updated_at then
    new.updated_at := now();
  end if;
  return new;
end $$;

drop trigger if exists trg_notif_prefs_touch_updated_at
  on public.notification_preferences;
create trigger trg_notif_prefs_touch_updated_at
  before update on public.notification_preferences
  for each row execute function public.touch_notification_preferences_updated_at();

alter table public.notification_preferences enable row level security;
-- No policies. Only the service-role admin client (adminSupabase) reads or
-- writes. Same pattern as push_logs / native_push_devices.

comment on table public.notification_preferences is
  'Per-actor notification opt-outs. Absence of a row = enabled. event_type=''general'' is forced enabled by trigger.';

-- ─── push_logs.event_type CHECK widening ──────────────────────────────
--
-- The matched-service push (Phase 4B) writes 'new_service_request'. Phase 1
-- of notification preferences introduces a richer event catalogue used by
-- the preferences UI and future fan-outs. We widen the CHECK to cover the
-- full set up front so future writers don't trip the constraint.
--
-- 'job_matched' is preserved purely for backwards compatibility with any
-- historical rows that may exist from the original push_logs constraint.

alter table public.push_logs
  drop constraint if exists push_logs_event_type_check;

alter table public.push_logs
  add constraint push_logs_event_type_check
  check (event_type in (
    'general',
    'job_match',
    'chat_message',
    'task_update',
    'admin_alert',
    'marketing',
    'new_category',
    'need_post',
    'system',
    'test',
    'new_service_request',
    'job_matched'
  ));
