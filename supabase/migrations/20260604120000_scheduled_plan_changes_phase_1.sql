-- Phase 1 of "Scheduled provider plan changes".
--
-- Purely additive schema preparation. No application code is wired to
-- read or write these new fields in this commit beyond a read-only
-- exposure (effectivePlan + /api/provider/plan + dashboard-profile).
-- Phase 2 will wire the create-order/webhook branches and the
-- schedule-free endpoint. Phase 3 will add the activation cron and
-- the push notification.
--
-- What this migration does:
--   1. Extends provider_plans with nullable scheduled_* columns so the
--      Phase 3 activation worker can find queued changes.
--   2. Adds provider_areas.created_at so the Phase 3 worker can pick
--      the oldest registered region when a Free plan is queued.
--   3. Widens push_logs.event_type to include 'plan_activated'.
--
-- Backward compatibility:
--   - All new provider_plans columns are nullable. No existing row is
--     mutated and the consistency CHECK is satisfied by NULL groups.
--   - scheduled_payment_order_id is intentionally NULL for the
--     scheduled-Free case (no payment row to FK to).
--   - provider_areas.created_at defaults to now() so the migration
--     fills existing rows with a single timestamp. The Phase 3
--     "oldest region" picker must tolerate ties via a deterministic
--     tiebreaker (e.g. region_code asc).
--   - push_logs.event_type CHECK is widened, never narrowed.
--
-- Idempotency: every ALTER uses IF NOT EXISTS / DO-block guards so the
-- migration can be re-applied without errors after a partial run.

-- ───────────────────────────────────────────────────────────────────
-- 1. provider_plans — queued plan-change fields
-- ───────────────────────────────────────────────────────────────────

alter table public.provider_plans
  add column if not exists scheduled_plan_code text null;

alter table public.provider_plans
  add column if not exists scheduled_max_regions integer null;

alter table public.provider_plans
  add column if not exists scheduled_activates_at timestamptz null;

alter table public.provider_plans
  add column if not exists scheduled_payment_order_id text null;

alter table public.provider_plans
  add column if not exists scheduled_at timestamptz null;

-- Region-count sanity, matching the existing CHECK on max_regions.
-- Added as a named constraint so the DO-block can skip it on re-run.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'chk_provider_plans_scheduled_max_regions'
      and conrelid = 'public.provider_plans'::regclass
  ) then
    alter table public.provider_plans
      add constraint chk_provider_plans_scheduled_max_regions
      check (scheduled_max_regions is null or scheduled_max_regions >= 1);
  end if;
end $$;

-- FK to payment_orders. ON DELETE RESTRICT preserves the audit chain
-- if a payment row is ever hard-deleted while a scheduled change still
-- points at it. NULL is valid (scheduled-Free has no payment).
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'fk_provider_plans_scheduled_payment_order'
      and conrelid = 'public.provider_plans'::regclass
  ) then
    alter table public.provider_plans
      add constraint fk_provider_plans_scheduled_payment_order
      foreign key (scheduled_payment_order_id)
      references public.payment_orders(order_id)
      on delete restrict;
  end if;
end $$;

-- Consistency: either every scheduled_* "core" field is NULL, or all
-- four are set. scheduled_payment_order_id is intentionally exempt so
-- the Free-downgrade case (no payment) is representable.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'chk_provider_plans_scheduled_consistency'
      and conrelid = 'public.provider_plans'::regclass
  ) then
    alter table public.provider_plans
      add constraint chk_provider_plans_scheduled_consistency
      check (
        (
          scheduled_plan_code is null
          and scheduled_max_regions is null
          and scheduled_activates_at is null
          and scheduled_at is null
        )
        or (
          scheduled_plan_code is not null
          and scheduled_max_regions is not null
          and scheduled_activates_at is not null
          and scheduled_at is not null
        )
      );
  end if;
end $$;

-- Activation-scan index. Mirrors idx_provider_plans_current_period_end:
-- partial on the discriminator column so the implicit-NULL majority of
-- rows do not bloat the index.
create index if not exists idx_provider_plans_scheduled_activates_at
  on public.provider_plans (scheduled_activates_at)
  where scheduled_plan_code is not null;

comment on column public.provider_plans.scheduled_plan_code is
  'Phase 1: nullable target plan code for a queued plan change. Read-only in Phase 1; written by Phase 2 (create-order / webhook / schedule-free) and consumed by Phase 3 (activation worker).';

comment on column public.provider_plans.scheduled_max_regions is
  'Phase 1: nullable region cap to apply when the scheduled change activates. Mirrors max_regions semantics.';

comment on column public.provider_plans.scheduled_activates_at is
  'Phase 1: nullable activation timestamp for the queued change. Set to current_period_end at queue time so the Phase 3 worker can scan by this column.';

comment on column public.provider_plans.scheduled_payment_order_id is
  'Phase 1: nullable FK to the payment_orders row that pre-paid for a queued paid-lower plan. NULL for scheduled Free (no payment).';

comment on column public.provider_plans.scheduled_at is
  'Phase 1: nullable wall-clock time the scheduled change was queued. Audit only.';

-- ───────────────────────────────────────────────────────────────────
-- 2. provider_areas.created_at — needed for "oldest region" picker
-- ───────────────────────────────────────────────────────────────────
--
-- The Free-plan auto-pick rule (Phase 3) needs to identify the
-- provider's first registered region. Adding this column now lets new
-- inserts capture the real insertion time. Existing rows all get the
-- migration-time default so the picker must break ties with a
-- deterministic secondary key (region_code asc is sufficient).

alter table public.provider_areas
  add column if not exists created_at timestamptz not null default now();

comment on column public.provider_areas.created_at is
  'Row creation timestamp. Existing rows backfilled to the migration time (Phase 1); new inserts get real insertion time. Used by the Phase 3 Free-plan activation worker to pick the oldest region; ties broken by region_code.';

-- ───────────────────────────────────────────────────────────────────
-- 3. push_logs.event_type — add 'plan_activated'
-- ───────────────────────────────────────────────────────────────────
--
-- Phase 3 sends a provider push when a scheduled plan activates. The
-- existing CHECK is widened (never narrowed) so the new event_type
-- inserts pass and all historical rows remain valid.

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
    'job_matched',
    'plan_activated'
  ));
