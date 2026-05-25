-- Phase 3.1 of "Scheduled provider plan changes" — activation foundation.
--
-- This migration prepares the schema for the Phase 3.2 activation worker
-- WITHOUT introducing the worker itself. After this migration, the
-- scheduled-paid-lower webhook (already shipped in Phase 2) will start
-- denormalizing each region's display name into provider_scheduled_areas
-- so the future activation transaction is a pure copy — no joins under a
-- row lock.
--
-- What this migration does:
--   1. Adds provider_scheduled_areas.area (text) so activation can
--      copy a complete row into provider_areas without a join. Existing
--      rows (none expected in prod — Phase 2 ran with the flag off — but
--      defensive) are backfilled from service_regions.region_name where
--      a match exists; rows that can't be backfilled stay NULL and the
--      CHECK constraint is added only after the backfill so the migration
--      cannot fail mid-way on partial data.
--   2. Adds a partial unique index on payment_orders to prevent two
--      scheduled_paid_lower orders being 'created' simultaneously for the
--      same provider. Releases the slot when the webhook flips status to
--      'paid' or 'failed' (CHECK on plan_change_mode='scheduled_paid_lower'
--      AND status='created').
--   3. Creates scheduled_plan_activations (audit log) so every activation
--      attempt — success, skip, or fail — produces a durable row. The
--      Phase 3.2 cron route writes to this table after each call to
--      public.activate_scheduled_plan(); the admin "stuck activations"
--      surface (not in this phase) reads outcome IN ('failed','skipped').
--
-- Backward compatibility:
--   - provider_scheduled_areas.area is added nullable, backfilled, then
--     constrained. Migration is safe on an empty table (the most likely
--     prod state given Phase 2's flag was off).
--   - payment_orders index is partial — touches only rows that satisfy
--     the partial WHERE; legacy rows (mode IS NULL) are entirely outside
--     the index.
--   - scheduled_plan_activations is a brand-new table; nothing existing
--     references it. The Phase 3.2 cron is the first writer.
--
-- Idempotency: every ALTER / CREATE uses IF NOT EXISTS / DO-block guards
-- so the migration can be re-applied without errors after a partial run.

-- ───────────────────────────────────────────────────────────────────
-- 1. provider_scheduled_areas.area — denormalized region display name
-- ───────────────────────────────────────────────────────────────────
--
-- Why denormalize: activation must replace provider_areas atomically
-- under a row lock on provider_plans. A join from provider_scheduled_areas
-- to service_regions inside that transaction would either need an
-- additional lock or risk reading a row that has since been deactivated.
-- Storing the display name at order-capture time gives activation an
-- immutable snapshot of "what the provider agreed to schedule" and
-- keeps the activation function a pure copy.

alter table public.provider_scheduled_areas
  add column if not exists area text;

-- Backfill any existing rows. Phase 2 ran with KK_SCHEDULED_PLANS_ENABLED=false
-- in prod, so the production table is expected to be empty here. Staging
-- may have test rows; backfill them from service_regions.region_name when
-- a matching active region exists. Rows without a match remain NULL and
-- will fail the CHECK below — that's a deliberate forcing function for
-- staging cleanup before this migration completes.
update public.provider_scheduled_areas psa
   set area = sr.region_name
  from public.service_regions sr
 where psa.region_code = sr.region_code
   and psa.area is null;

-- CHECK: every row must carry a non-empty area name. Added after the
-- backfill so the migration is safe even if test rows existed.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'chk_provider_scheduled_areas_area_not_empty'
      and conrelid = 'public.provider_scheduled_areas'::regclass
  ) then
    alter table public.provider_scheduled_areas
      add constraint chk_provider_scheduled_areas_area_not_empty
      check (area is not null and char_length(area) >= 1);
  end if;
end $$;

comment on column public.provider_scheduled_areas.area is
  'Phase 3.1: denormalized region display name. Snapshotted at order-capture time from service_regions.region_name. Activation copies this verbatim into provider_areas.area — no join required at activation time.';

-- ───────────────────────────────────────────────────────────────────
-- 2. payment_orders — one scheduled_paid_lower per provider in flight
-- ───────────────────────────────────────────────────────────────────
--
-- A second scheduled-paid-lower order for the same provider while one
-- is still 'created' would create ambiguity about which order's region
-- selection applies after webhook capture. Block it at the DB layer in
-- addition to the route-level 409 check. The partial WHERE keeps the
-- index small (only ever has at most one row per provider; releases
-- when status moves to 'paid' or 'failed').

create unique index if not exists uq_payment_orders_one_scheduled_per_provider
  on public.payment_orders (provider_id)
  where plan_change_mode = 'scheduled_paid_lower' and status = 'created';

comment on index public.uq_payment_orders_one_scheduled_per_provider is
  'Phase 3.1: at most one scheduled_paid_lower order in ''created'' state per provider. Released when webhook flips status to ''paid''/''failed''. Prevents the race where a provider double-taps and two Razorpay orders both land.';

-- ───────────────────────────────────────────────────────────────────
-- 3. scheduled_plan_activations — per-attempt audit log
-- ───────────────────────────────────────────────────────────────────
--
-- One row per call to public.activate_scheduled_plan() — success, skip,
-- or fail. Drives the future admin "stuck activations" surface and the
-- per-provider activation history shown in support tooling. The cron
-- route (Phase 3.2) writes one row after each RPC call.
--
-- outcome semantics:
--   success — the function returned ok=true and the active plan flipped
--   skipped — function returned NOT_DUE_OR_LOCKED (no row matched OR
--             another worker held the row lock); benign
--   failed  — function returned ok=false with an error_code; the row
--             is still due and will be retried on the next tick
--
-- push_status is NULL until the cron sends the plan_activated push.
-- Allowed values mirror the existing push_logs.status enum plus a new
-- 'no_tokens' (provider has no active native_push_devices rows).

create table if not exists public.scheduled_plan_activations (
  id bigserial primary key,
  provider_id text not null
    references public.providers(provider_id) on delete cascade,
  attempted_at timestamptz not null default now(),
  activated_plan_code text null,
  outcome text not null check (outcome in ('success','skipped','failed')),
  scheduled_payment_order_id text null,
  region_count integer null,
  error_code text null,
  error_message text null,
  push_status text null check (
    push_status is null
    or push_status in ('sent','failed','invalid_token','skipped','no_tokens')
  )
);

create index if not exists idx_scheduled_plan_activations_provider_attempted
  on public.scheduled_plan_activations (provider_id, attempted_at desc);

-- Partial index over non-success rows for fast "stuck activations" reads.
-- Most rows will be 'success'; keeping the index narrow keeps scans cheap.
create index if not exists idx_scheduled_plan_activations_outcome_non_success
  on public.scheduled_plan_activations (outcome, attempted_at desc)
  where outcome <> 'success';

alter table public.scheduled_plan_activations enable row level security;
-- No policies — service-role admin client only. Same posture as
-- payment_orders, payment_webhook_events, provider_plans.

comment on table public.scheduled_plan_activations is
  'Phase 3.1: per-attempt audit log for public.activate_scheduled_plan() calls. The Phase 3.2 cron writes one row per attempt regardless of outcome. Failed/skipped rows feed the admin reconciliation surface; success rows are the activation history.';

comment on column public.scheduled_plan_activations.outcome is
  'One of: success (plan flipped), skipped (row not due or locked by another worker), failed (RPC returned ok=false). Non-success rows are retried on subsequent cron ticks until they succeed or are reconciled by admin.';

comment on column public.scheduled_plan_activations.push_status is
  'Outcome of the plan_activated push attempt that follows a successful activation. NULL on outcome=skipped/failed. Mirrors push_logs.status plus ''no_tokens'' for the case where the provider has no active FCM devices.';
