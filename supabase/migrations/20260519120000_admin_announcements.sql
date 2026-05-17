-- Admin announcements — Phase 7A (schema + draft/approval, NO send path).
--
-- This migration ships the durable row store and approval guard. No
-- send queue, no worker — those land in Phase 7B as a separate
-- migration so the send path is independently reviewable and
-- revertable.
--
-- Lifecycle (status column):
--   draft → pending_approval → approved → queued → sending → canceling → sent | canceled | failed
--
-- Phase 7A reaches at most `approved`. Phase 7B+ owns queued→sent.
--
-- approval_required defaults to FALSE — the strategic MVP decision is
-- to ship without two-person approval. Toggling the column to TRUE on
-- a future row activates the trigger guard at the DB layer.

create table public.admin_announcements (
  id uuid primary key default gen_random_uuid(),

  -- Composer fields
  title text not null check (char_length(title) between 1 and 65),
  body text not null check (char_length(body) between 1 and 240),
  deep_link text null check (deep_link is null or char_length(deep_link) <= 256),

  -- Audience
  target_audience text not null check (
    target_audience in ('all', 'users', 'providers', 'admins')
  ),

  -- Lifecycle
  status text not null default 'draft' check (
    status in ('draft', 'pending_approval', 'approved',
               'queued', 'sending', 'canceling',
               'sent', 'canceled', 'failed')
  ),

  -- Approval gate
  approval_required boolean not null default false,
  approved_by_phone text null,
  approved_at timestamptz null,

  -- Send window (populated by Phase 7B worker)
  queued_at timestamptz null,
  sending_started_at timestamptz null,
  sent_at timestamptz null,
  canceled_at timestamptz null,

  -- Authorship + audit
  created_by_phone text not null,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),

  -- Send counts (denormalized rollup; source of truth is push_logs).
  recipient_count int null,
  sent_count int null,
  failed_count int null,
  invalid_token_count int null,
  no_active_device_count int null,
  failure_reason text null
);

-- Hot path 1: list by status, newest first (composer + admin tab).
create index if not exists idx_admin_announcements_status_created
  on public.admin_announcements (status, created_at desc);

-- Hot path 2: worker queue scan (Phase 7B). Partial index keeps it
-- tiny — most rows are draft/sent/canceled and irrelevant to the
-- worker.
create index if not exists idx_admin_announcements_status_queued
  on public.admin_announcements (status, queued_at)
  where status in ('queued', 'sending', 'canceling');

-- Touch updated_at on every UPDATE so the composer's "last edited"
-- display is honest. Callers may set updated_at explicitly; this
-- trigger only fires when they don't.
create or replace function public.touch_admin_announcements_updated_at()
returns trigger language plpgsql as $$
begin
  if new.updated_at is null or new.updated_at = old.updated_at then
    new.updated_at := now();
  end if;
  return new;
end $$;

drop trigger if exists trg_admin_announcements_touch_updated_at
  on public.admin_announcements;
create trigger trg_admin_announcements_touch_updated_at
  before update on public.admin_announcements
  for each row execute function public.touch_admin_announcements_updated_at();

-- Approval guard. Fires only when approval_required = true AND the
-- row is transitioning into status='approved'. Phase 7A defaults
-- approval_required to false, so this trigger is dormant for the
-- MVP rollout but ready for the Phase 7B / 7E flip without a
-- second migration.
create or replace function public.enforce_admin_announcement_approval()
returns trigger language plpgsql as $$
begin
  if new.status = 'approved' and coalesce(new.approval_required, false) = true then
    if new.approved_by_phone is null then
      raise exception 'announcement approval requires approved_by_phone'
        using errcode = '23514';
    end if;
    if new.approved_by_phone = new.created_by_phone then
      raise exception 'announcement cannot be approved by its creator'
        using errcode = '23514';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_admin_announcements_approval
  on public.admin_announcements;
create trigger trg_admin_announcements_approval
  before insert or update on public.admin_announcements
  for each row execute function public.enforce_admin_announcement_approval();

alter table public.admin_announcements enable row level security;
-- No policies — service-role admin client only. Same pattern as
-- push_logs / native_push_devices / notification_preferences.

comment on table public.admin_announcements is
  'Admin-composed platform announcements. Phase 7A: draft/approval only — no send path. Phase 7B+ adds the worker + queueing. event_type at push time will always be "general" (mandatory, opt-out impossible).';
