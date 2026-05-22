-- Provider change log for monthly-change-limit enforcement.
--
-- Two change kinds today: region_change (selectedRegionCodes mutated)
-- and category_change (provider_services set mutated). Both share the
-- same monthly cap (3 changes per calendar month per provider per kind).
--
-- Append-only: existing rows are never updated. Reset of the monthly
-- count is implicit via the WHERE clause on changed_at >= start-of-
-- month at the count site — no scheduled job, no truncation.
--
-- Safety posture:
--   • CREATE TABLE IF NOT EXISTS — second-run safe.
--   • CREATE INDEX IF NOT EXISTS — second-run safe.
--   • No ALTER on existing tables, no DROP, no DELETE/TRUNCATE.
--   • RLS enabled, no policies — service-role only (same posture as
--     provider_plans, payment_orders, payment_webhook_events).
--
-- Rollback posture: no DOWN migration. Supersession only.
--
-- Production effect:
--   First run: creates table + indexes. No existing rows touched.
--   Second run: every statement is a no-op (IF NOT EXISTS).
--   Enforcement is wired in the same release that ships this migration;
--   absence of the table during a partial deploy fails OPEN at the
--   enforcement call site (count query returns an error → enforcement
--   skips the limit check this request).

create table if not exists public.provider_change_log (
  id            bigserial primary key,
  provider_id   text        not null
    references public.providers(provider_id) on delete cascade,
  change_type   text        not null
    check (change_type in ('region_change', 'category_change')),
  -- old_value / new_value are stored as JSONB so future kinds (price
  -- plan change, name change, etc.) don't need a column add. Today's
  -- region_change stores a sorted string[] of region_code values;
  -- category_change stores a sorted string[] of canonical category
  -- names.
  old_value     jsonb       null,
  new_value     jsonb       null,
  -- 'self' = provider edited via /provider/register?edit
  -- 'admin' = admin edited via /api/admin/providers/update
  -- 'system' = automated reconcile (e.g. canonicalization job)
  changed_by    text        not null default 'self'
    check (changed_by in ('self', 'admin', 'system')),
  changed_at    timestamptz not null default now()
);

-- Monthly-count read pattern: (provider_id, change_type, changed_at >= month_start).
-- DESC index serves both the count and any future "recent changes" view.
create index if not exists idx_provider_change_log_provider_type_at
  on public.provider_change_log (provider_id, change_type, changed_at desc);

-- Admin "show me all changes in the last N days" pattern.
create index if not exists idx_provider_change_log_changed_at
  on public.provider_change_log (changed_at desc);

alter table public.provider_change_log enable row level security;
-- No policies attached — service-role admin client only.

comment on table public.provider_change_log is
  'Append-only log of provider self-edits and admin edits to coverage/category. Drives the 3-changes-per-calendar-month limit. Each row represents one save that actually mutated the relevant field; no-op saves are NOT logged.';

comment on column public.provider_change_log.change_type is
  'region_change = selectedRegionCodes set mutated. category_change = provider_services set mutated. Limit-counting WHERE clause uses (provider_id, change_type, date_trunc(''month'', changed_at) = date_trunc(''month'', now())).';

comment on column public.provider_change_log.old_value is
  'JSONB snapshot of the previous value. region_change: sorted string[] of region_code values. category_change: sorted string[] of canonical category names. NULL only on first-time row (no prior state).';

comment on column public.provider_change_log.new_value is
  'JSONB snapshot of the new value after the save. Same shape as old_value.';

comment on column public.provider_change_log.changed_by is
  'self | admin | system. Future enforcement may exempt admin/system edits from the monthly count; today the limit is enforced regardless of source.';
