-- Phase 2 invoice issuance — DB behavioural test.
--
-- HOW TO RUN (read-only by design): paste into the Supabase SQL editor of a
-- STAGING project, or run with psql against staging. The whole script runs
-- inside a transaction that ROLLS BACK at the end, so it creates NO
-- permanent rows (no test invoice persists). It does NOT run automatically:
-- it lives under supabase/tests/, which `supabase db push` never applies.
--
-- Requires: Phase 1 (20260608120000) + Phase 2 (20260609120000) applied, the
-- business_profile seed present, and at least one row in public.providers
-- (used read-only as the buyer fixture).
--
-- Covers the DB-backed required scenarios:
--   2. flag on → invoice created
--   3. duplicate call → no duplicate invoice (idempotent 'exists')
--   5. totals equal captured amount (3658 = 3100 + 558, CGST/SGST 279/279)
--   6. payment_ledger + invoice_audit_events (+ invoice_items) rows written
--   + immutability: non-pdf UPDATE and DELETE are blocked; pdf_* UPDATE allowed

begin;

do $$
declare
  v_pid     text;
  v_order   text := 'order_test_inv_phase2';
  v_pay     text := 'pay_test_inv_phase2';
  v_res     jsonb;
  v_res2    jsonb;
  v_inv     public.invoices%rowtype;
  v_items   int;
  v_ledger  int;
  v_audit   int;
  v_count   int;
  v_blocked boolean;
begin
  select provider_id into v_pid from public.providers limit 1;
  if v_pid is null then
    raise notice 'SKIP: no providers row available as buyer fixture';
    return;
  end if;

  -- Fixture: a captured/paid order. 3658 paise = regions_5 GST-inclusive total.
  insert into public.payment_orders
    (order_id, provider_id, plan_code, amount_paise, currency, status, razorpay_payment_id, paid_at)
  values
    (v_order, v_pid, 'regions_5', 3658, 'INR', 'paid', v_pay, now());

  -- ── Scenario 2: invoice created ──────────────────────────────────────
  v_res := public.issue_invoice_for_paid_order(v_order);
  if coalesce(v_res->>'outcome','') <> 'issued' then
    raise exception 'FAIL #2 expected outcome=issued, got %', v_res;
  end if;

  select * into v_inv from public.invoices where payment_order_id = v_order;
  if not found then raise exception 'FAIL #2 no invoice row created'; end if;

  -- ── Scenario 5: totals equal captured amount, correct split ──────────
  if v_inv.total_paise        <> 3658 then raise exception 'FAIL #5 total=%',   v_inv.total_paise; end if;
  if v_inv.taxable_value_paise<> 3100 then raise exception 'FAIL #5 taxable=%', v_inv.taxable_value_paise; end if;
  if v_inv.total_tax_paise    <> 558  then raise exception 'FAIL #5 tax=%',     v_inv.total_tax_paise; end if;
  if v_inv.cgst_paise <> 279 or v_inv.sgst_paise <> 279 or v_inv.igst_paise <> 0 then
    raise exception 'FAIL #5 split cgst=% sgst=% igst=%', v_inv.cgst_paise, v_inv.sgst_paise, v_inv.igst_paise;
  end if;
  if v_inv.supply_type <> 'intra' then raise exception 'FAIL #5 supply_type=%', v_inv.supply_type; end if;
  if v_inv.pdf_status  <> 'pending' then raise exception 'FAIL pdf_status=%',   v_inv.pdf_status; end if;
  if v_inv.invoice_number not like 'KK/FY%/%' then raise exception 'FAIL number format=%', v_inv.invoice_number; end if;
  if v_inv.seller_gstin <> '08BYPHR6399K2ZD' then raise exception 'FAIL seller_gstin=%', v_inv.seller_gstin; end if;
  if coalesce(v_inv.buyer_phone,'') = '' then raise exception 'FAIL buyer_phone empty'; end if;

  -- ── Scenario 6: line item + ledger + audit written ───────────────────
  select count(*) into v_items  from public.invoice_items where invoice_id = v_inv.id;
  select count(*) into v_ledger from public.payment_ledger
    where invoice_id = v_inv.id and entry_type = 'payment' and direction = 'credit';
  select count(*) into v_audit  from public.invoice_audit_events
    where invoice_id = v_inv.id and event_type = 'invoice_issued';
  if v_items  <> 1 then raise exception 'FAIL #6 invoice_items=%', v_items; end if;
  if v_ledger <> 1 then raise exception 'FAIL #6 payment_ledger=%', v_ledger; end if;
  if v_audit  <> 1 then raise exception 'FAIL #6 invoice_audit_events=%', v_audit; end if;

  -- ── Scenario 3: idempotent — second call returns exists, no duplicate ─
  v_res2 := public.issue_invoice_for_paid_order(v_order);
  if coalesce(v_res2->>'outcome','') <> 'exists' then
    raise exception 'FAIL #3 expected outcome=exists, got %', v_res2;
  end if;
  select count(*) into v_count from public.invoices where payment_order_id = v_order;
  if v_count <> 1 then raise exception 'FAIL #3 duplicate invoices=%', v_count; end if;

  -- ── Immutability: non-pdf UPDATE blocked ─────────────────────────────
  v_blocked := false;
  begin
    update public.invoices set total_paise = 1 where id = v_inv.id;
  exception when others then v_blocked := true;
  end;
  if not v_blocked then raise exception 'FAIL immutability: non-pdf UPDATE was not blocked'; end if;

  -- ── Immutability: DELETE blocked ─────────────────────────────────────
  v_blocked := false;
  begin
    delete from public.invoices where id = v_inv.id;
  exception when others then v_blocked := true;
  end;
  if not v_blocked then raise exception 'FAIL immutability: DELETE was not blocked'; end if;

  -- ── Immutability: pdf_* UPDATE allowed (for the future PDF job) ───────
  update public.invoices
     set pdf_status = 'generated', pdf_generated_at = now()
   where id = v_inv.id;

  raise notice 'ALL PHASE-2 INVOICE ISSUANCE TESTS PASSED (provider fixture=%)', v_pid;
end
$$;

rollback;
