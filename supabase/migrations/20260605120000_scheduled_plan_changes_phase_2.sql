-- Phase 2 of "Scheduled provider plan changes".
--
-- Adds the per-order classification columns (so the webhook can branch
-- on what the order represented at create-time, not at webhook-time)
-- and the provider_scheduled_areas table (where the webhook persists
-- the chosen future regions after a successful capture for the
-- scheduled-paid-lower case).
--
-- Phase 2 still does NOT activate scheduled plans. The new provider_plans
-- scheduled_* columns from Phase 1 are now WRITTEN by the webhook for
-- scheduled_paid_lower orders, but the activation worker that switches
-- a scheduled plan into the active slot lands in Phase 3.
--
-- Backward compatibility:
--   - Every new payment_orders column is nullable. Existing rows
--     (status=created or paid, pre-Phase-2) keep their values; the new
--     plan_change_mode CHECK admits NULL so the legacy rows stay valid.
--   - provider_scheduled_areas is a brand-new table. No existing data
--     to migrate.
--
-- Idempotency: ALTER TABLE statements use IF NOT EXISTS for columns;
-- named CHECK/FK constraints use DO-block guards that read pg_constraint.

-- ───────────────────────────────────────────────────────────────────
-- 1. payment_orders — plan-change classification + terms acknowledgement
-- ───────────────────────────────────────────────────────────────────
--
-- plan_change_mode records what the order represented at create-time.
-- The webhook branches on this column rather than re-computing the
-- classification at webhook-time, because:
--   • Between create-order and webhook, the provider's current_period_
--     end may pass — re-classifying at webhook-time would silently
--     change a "schedule lower" into an "immediate upgrade".
--   • The order is the contract: the provider expected what they
--     selected; the webhook honours it.
--
-- current_plan_code_at_order / current_period_end_at_order capture the
-- provider's state at order time for diagnostics and dispute handling.
-- These are NEVER read for activation decisions in Phase 2; they're
-- audit fields.
--
-- scheduled_activates_at is denormalized from current_period_end_at_order
-- for the scheduled_paid_lower case so the Phase 3 worker can scan one
-- table to find activations due.
--
-- agreed_terms_at is set on every paid order at create-time. Free-plan
-- schedules (Phase 3) do not flow through this table.

alter table public.payment_orders
  add column if not exists plan_change_mode text null;

alter table public.payment_orders
  add column if not exists current_plan_code_at_order text null;

alter table public.payment_orders
  add column if not exists current_period_end_at_order timestamptz null;

alter table public.payment_orders
  add column if not exists scheduled_activates_at timestamptz null;

alter table public.payment_orders
  add column if not exists agreed_terms_at timestamptz null;

-- text[] carries the provider's selected future-region codes for the
-- scheduled_paid_lower case from create-order through to the webhook.
-- NULL for every non-scheduled order. The webhook reads this column,
-- validates it (count + dedup), and writes provider_scheduled_areas
-- rows on payment.captured.
alter table public.payment_orders
  add column if not exists scheduled_region_codes text[] null;

-- Bounded set of valid mode values. NULL admitted so existing rows
-- created before this migration remain valid; new orders MUST set
-- a non-null mode (enforced in the route handler).
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'chk_payment_orders_plan_change_mode'
      and conrelid = 'public.payment_orders'::regclass
  ) then
    alter table public.payment_orders
      add constraint chk_payment_orders_plan_change_mode
      check (
        plan_change_mode is null
        or plan_change_mode in (
          'immediate_upgrade',
          'immediate_renewal',
          'scheduled_paid_lower'
        )
      );
  end if;
end $$;

-- Consistency: when plan_change_mode is 'scheduled_paid_lower' the
-- order must carry the scheduling context. immediate_* modes don't
-- require these fields; pre-Phase-2 NULL modes are entirely exempt.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'chk_payment_orders_scheduled_lower_context'
      and conrelid = 'public.payment_orders'::regclass
  ) then
    alter table public.payment_orders
      add constraint chk_payment_orders_scheduled_lower_context
      check (
        plan_change_mode is distinct from 'scheduled_paid_lower'
        or (
          scheduled_activates_at is not null
          and scheduled_region_codes is not null
          and array_length(scheduled_region_codes, 1) >= 1
          and current_plan_code_at_order is not null
        )
      );
  end if;
end $$;

-- Webhook lookup index: "find me orders where mode is set and we may
-- need to write scheduled_* state". Partial on the discriminator so
-- the legacy (mode IS NULL) rows don't bloat the index.
create index if not exists idx_payment_orders_plan_change_mode
  on public.payment_orders (plan_change_mode)
  where plan_change_mode is not null;

comment on column public.payment_orders.plan_change_mode is
  'Phase 2: classification of the requested plan change at order-creation time. One of immediate_upgrade / immediate_renewal / scheduled_paid_lower. NULL on legacy rows created before Phase 2. The webhook branches on this column.';

comment on column public.payment_orders.current_plan_code_at_order is
  'Phase 2: the provider''s effective plan_code at order time. Audit only — not read by the webhook for activation decisions.';

comment on column public.payment_orders.current_period_end_at_order is
  'Phase 2: the provider''s current_period_end at order time. Drives scheduled_activates_at for scheduled_paid_lower orders.';

comment on column public.payment_orders.scheduled_activates_at is
  'Phase 2: for scheduled_paid_lower orders, when the queued plan should activate. Mirrors current_period_end_at_order at order time so the Phase 3 worker can scan one table.';

comment on column public.payment_orders.agreed_terms_at is
  'Phase 2: wall-clock time the provider confirmed the non-refundable payment terms popup on the client. NULL on legacy rows; required by the route handler for every new paid order.';

comment on column public.payment_orders.scheduled_region_codes is
  'Phase 2: for scheduled_paid_lower orders, the provider''s selected future region_codes. The webhook persists these into provider_scheduled_areas on payment.captured. NULL for non-scheduled orders.';

-- ───────────────────────────────────────────────────────────────────
-- 2. provider_scheduled_areas — pending future region selection
-- ───────────────────────────────────────────────────────────────────
--
-- One row per (provider, region) pair representing a scheduled-lower
-- plan's future region set. Populated by the Razorpay webhook AFTER
-- payment.captured for a scheduled_paid_lower order. Cleared by the
-- Phase 3 activation worker when the queued plan takes effect.
--
-- The provider keeps editing their current provider_areas for the
-- active plan; this table is intentionally separate so the active
-- and pending sets don't collide. Region codes here are NOT validated
-- by an FK to service_regions because service_region rows can in
-- principle be deactivated by admins between scheduling and
-- activation; the Phase 3 worker re-validates on activation and falls
-- back gracefully. The (region_code, city_code) shape mirrors
-- provider_areas to keep the activation copy trivial.

create table if not exists public.provider_scheduled_areas (
  provider_id text not null
    references public.providers(provider_id) on delete cascade,
  region_code text not null,
  city_code text not null,
  created_at timestamptz not null default now(),
  primary key (provider_id, region_code)
);

create index if not exists idx_provider_scheduled_areas_provider
  on public.provider_scheduled_areas (provider_id);

alter table public.provider_scheduled_areas enable row level security;
-- No policies — service-role admin client only. Same posture as
-- provider_plans / payment_orders / push_logs.

comment on table public.provider_scheduled_areas is
  'Phase 2: pending future region selection for a scheduled_paid_lower plan. Written by the Razorpay webhook on payment.captured; consumed by the Phase 3 activation worker which copies these rows into provider_areas and clears them. Lives separately from provider_areas so the active and pending sets never collide.';
