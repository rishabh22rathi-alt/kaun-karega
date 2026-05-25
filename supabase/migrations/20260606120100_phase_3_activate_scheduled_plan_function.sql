-- Phase 3.1 of "Scheduled provider plan changes" — activation function.
--
-- This is the ONLY place Phase 3 mutates active plan state during
-- activation. The function runs in a single Postgres transaction (each
-- RPC call is a tx); the FOR UPDATE SKIP LOCKED clause makes it safe
-- against overlapping cron ticks. The function returns a typed jsonb
-- result so the Phase 3.2 cron route can branch on outcome without a
-- second roundtrip.
--
-- What the function does NOT do (deliberately):
--   - Send the plan_activated push notification (cron route does that
--     after a successful return; push failure must not roll back).
--   - Invalidate admin_cached_snapshots (cron route does that after).
--   - Touch payment_orders.status (the payment is already 'paid' by
--     the time activation runs; status is the webhook's contract).
--   - Reach the cron itself — this function exists in Phase 3.1 so the
--     activation transaction can be unit-tested via direct rpc() calls
--     before Phase 3.2 wires the scheduler.
--
-- security definer + search_path = public so the function runs with the
-- privileges it was created with (avoids the "service-role caller
-- inherits no privileges" edge case in Supabase RPC). Public EXECUTE is
-- revoked at the bottom — only service-role / admin can call.

create or replace function public.activate_scheduled_plan(p_provider_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.provider_plans%rowtype;
  v_now timestamptz := now();
  v_period_start timestamptz;
  v_period_end timestamptz;
  v_last_payment_id text;
  v_region_count int := 0;
  v_oldest_row public.provider_areas%rowtype;
  v_is_free boolean;
begin
  -- Step 1. Lock the candidate row. SKIP LOCKED makes overlapping cron
  -- ticks safe: the second tick simply gets NOT_DUE_OR_LOCKED and moves
  -- on. The WHERE clause also filters out already-activated rows (any
  -- row where scheduled_plan_code IS NULL is excluded) so re-running on
  -- a freshly-activated provider is a no-op.
  select * into v_row
    from public.provider_plans
   where provider_id = p_provider_id
     and scheduled_plan_code is not null
     and scheduled_activates_at <= v_now
     for update skip locked;

  if not found then
    return jsonb_build_object(
      'ok', false,
      'outcome', 'skipped',
      'error_code', 'NOT_DUE_OR_LOCKED'
    );
  end if;

  v_is_free := (v_row.scheduled_plan_code = 'free');

  if v_is_free then
    -- ─── Free activation ─────────────────────────────────────────────
    -- Business rule: when a paid plan expires into a scheduled Free,
    -- keep the provider's *oldest* registered region as their single
    -- Free-plan region. Free is max_regions=1, period_end=NULL.
    --
    -- "Oldest" is (created_at asc, region_code asc). The region_code
    -- tiebreaker matters because Phase 1's ADD COLUMN created_at filled
    -- every existing row with the same migration-time timestamp; in
    -- that case the tiebreaker is what makes the selection deterministic.

    select * into v_oldest_row
      from public.provider_areas
     where provider_id = p_provider_id
     order by created_at asc, region_code asc nulls last
     limit 1;

    if found then
      -- Delete all other rows. The remaining row is the active Free set.
      -- Match by (area, region_code) which together identify the row;
      -- region_code may be NULL on legacy rows so coalesce to '' for
      -- the comparison.
      delete from public.provider_areas
       where provider_id = p_provider_id
         and not (
           area = v_oldest_row.area
           and coalesce(region_code, '') = coalesce(v_oldest_row.region_code, '')
         );
      v_region_count := 1;
    else
      -- Provider has zero provider_areas rows. Free activation still
      -- succeeds with region_count=0; the provider must pick a region
      -- via the register/edit flow before matching will emit leads
      -- for them. This is an acceptable end state — Free providers
      -- without a region see no leads, which mirrors a brand-new
      -- provider who hasn't completed registration yet.
      v_region_count := 0;
    end if;

    v_period_start := v_now;
    v_period_end := null;
    v_last_payment_id := null;
  else
    -- ─── Paid scheduled activation ───────────────────────────────────
    -- Replace provider_areas with the snapshotted future-region set.
    -- The future set lives in provider_scheduled_areas (written by the
    -- Phase 2 webhook on payment.captured). Each row carries area,
    -- region_code, and city_code — Phase 3.1 added 'area' for exactly
    -- this copy. Period: 30d starting at the scheduled_activates_at
    -- moment (NOT now) — the provider paid for 30d from expiry, and a
    -- late-running cron does not extend or shrink that window.

    select coalesce(count(*), 0) into v_region_count
      from public.provider_scheduled_areas
     where provider_id = p_provider_id;

    if v_region_count = 0 then
      -- The webhook should have written rows. If they're missing here,
      -- something is wrong (deleted? never written? rollback?). Refuse
      -- to advance; the activation_attempts audit will surface this
      -- to admin. The row stays in scheduled state for manual fix.
      return jsonb_build_object(
        'ok', false,
        'outcome', 'failed',
        'error_code', 'NO_SCHEDULED_AREAS',
        'scheduled_payment_order_id', v_row.scheduled_payment_order_id
      );
    end if;

    -- Replace active regions atomically. Inside the transaction held
    -- by FOR UPDATE on provider_plans, the next matching query (which
    -- doesn't take that row lock) will see either the old set or the
    -- new set — never a partial replacement.
    delete from public.provider_areas
     where provider_id = p_provider_id;

    insert into public.provider_areas (
      provider_id, area, city_code, region_code, created_at
    )
    select psa.provider_id, psa.area, psa.city_code, psa.region_code, v_now
      from public.provider_scheduled_areas psa
     where psa.provider_id = p_provider_id;

    -- Clear the pending set — its contents are now the active set.
    delete from public.provider_scheduled_areas
     where provider_id = p_provider_id;

    -- Pull the razorpay_payment_id so provider_plans.last_payment_id
    -- points at the payment that funded this period. The lookup is a
    -- single primary-key read; if for any reason the order is gone
    -- (cascade delete is RESTRICT on payment_orders so this shouldn't
    -- happen), leave v_last_payment_id NULL and the UPDATE below uses
    -- the existing last_payment_id.
    if v_row.scheduled_payment_order_id is not null then
      select razorpay_payment_id into v_last_payment_id
        from public.payment_orders
       where order_id = v_row.scheduled_payment_order_id
       limit 1;
    end if;

    v_period_start := v_row.scheduled_activates_at;
    v_period_end := v_row.scheduled_activates_at + interval '30 days';
  end if;

  -- Step 3. Promote scheduled_* → active fields and clear the queue.
  -- last_payment_id semantics:
  --   free: explicit NULL (no payment underpins free)
  --   paid: prefer the new razorpay_payment_id; fall back to the
  --         existing value if the lookup above produced nothing.
  update public.provider_plans
     set plan_code = v_row.scheduled_plan_code,
         max_regions = v_row.scheduled_max_regions,
         current_period_start = v_period_start,
         current_period_end = v_period_end,
         last_payment_id = case
           when v_is_free then null
           else coalesce(v_last_payment_id, last_payment_id)
         end,
         scheduled_plan_code = null,
         scheduled_max_regions = null,
         scheduled_activates_at = null,
         scheduled_payment_order_id = null,
         scheduled_at = null,
         updated_at = v_now
   where provider_id = p_provider_id;

  return jsonb_build_object(
    'ok', true,
    'outcome', 'success',
    'activated_plan_code', v_row.scheduled_plan_code,
    'region_count', v_region_count,
    'scheduled_payment_order_id', v_row.scheduled_payment_order_id,
    'period_start', v_period_start,
    'period_end', v_period_end
  );
end;
$$;

-- Lock down execution to service-role / admin callers. The Phase 3.2
-- cron route calls this via adminSupabase.rpc(), which runs under the
-- service_role JWT and inherits SECURITY DEFINER privileges.
revoke all on function public.activate_scheduled_plan(text) from public;
revoke all on function public.activate_scheduled_plan(text) from anon, authenticated;

comment on function public.activate_scheduled_plan(text) is
  'Phase 3.1: per-provider scheduled-plan activation transaction. Returns jsonb with outcome IN (''success'',''skipped'',''failed''). Idempotent; safe against overlapping callers via FOR UPDATE SKIP LOCKED. Does NOT send push, invalidate cache, or touch payment_orders.status — those are the cron route''s responsibilities.';
