-- Phase 2: GST invoice issuance function + invoice immutability.
--
-- Builds on the dormant Phase 1 schema (20260608120000). Adds:
--   issue_invoice_for_paid_order(p_order_id)  — atomic, idempotent issuance
--   invoices_block_mutation() + trigger       — immutability for issued invoices
--
-- Still DORMANT at the application layer: the webhook only calls the
-- issuance RPC when KK_INVOICE_LEDGER_ENABLED=true (default off), and the
-- call is soft-fail so it can never break paid-plan activation. No PDF is
-- generated; pdf_status stays 'pending'. No admin/provider UI.
--
-- Design (matches docs/payment-gst-invoice-ledger-phase-1-schema-plan.md §5–6):
--   * Issuance runs as ONE transaction (the RPC). The invoice number is
--     allocated INSIDE that transaction, so any failure rolls back the
--     counter too → gap-free GST series.
--   * Idempotent: check-first by payment_order_id / razorpay_payment_id and
--     return the existing invoice as success; the unique constraints are the
--     hard backstop for a concurrent race (unique_violation → return exists,
--     and the allocate is rolled back with it → still gap-free).
--   * Invoice total ALWAYS equals payment_orders.amount_paise (the captured
--     amount). taxable = round(total/1.18); tax = total - taxable, so the
--     chk_invoices_totals constraint holds by construction.
--   * GST split by buyer state: '08' (Rajasthan) → CGST 9% + SGST 9% (intra);
--     any other → IGST 18% (inter). Buyer state defaults to '08' today (no
--     reliable per-provider state is stored yet).

-- ───────────────────────────────────────────────────────────────────
-- 1. issue_invoice_for_paid_order — atomic, idempotent issuance
-- ───────────────────────────────────────────────────────────────────
create or replace function public.issue_invoice_for_paid_order(p_order_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order     public.payment_orders%rowtype;
  v_existing  public.invoices%rowtype;
  v_biz       public.business_profile%rowtype;
  v_plan      public.provider_plans%rowtype;
  v_provider  record;
  v_now       timestamptz := now();
  v_fy        text;
  v_seq       bigint;
  v_number    text;
  v_total     integer;
  v_taxable   integer;
  v_tax       integer;
  v_cgst      integer := 0;
  v_sgst      integer := 0;
  v_igst      integer := 0;
  v_cgst_bps  integer := 0;
  v_sgst_bps  integer := 0;
  v_igst_bps  integer := 0;
  v_supply    text;
  v_buyer_state text := '08';   -- default Rajasthan; no reliable provider state yet
  v_buyer_name  text;
  v_buyer_gstin text;
  v_period_start timestamptz;
  v_period_end   timestamptz;
  v_place     text;
  v_desc      text;
  v_seller_address text;
  v_invoice_id bigint;
begin
  -- 1. Order must exist and be paid (issuance happens ONLY after the
  --    webhook flips status='paid').
  select * into v_order from public.payment_orders where order_id = p_order_id;
  if not found then
    return jsonb_build_object('ok', false, 'outcome', 'skipped', 'error_code', 'ORDER_NOT_FOUND');
  end if;
  if v_order.status <> 'paid' then
    return jsonb_build_object('ok', false, 'outcome', 'skipped', 'error_code', 'ORDER_NOT_PAID');
  end if;

  -- 2. Idempotency check-first. If an invoice already exists for this
  --    order or payment, return it as success WITHOUT allocating a number.
  select * into v_existing
    from public.invoices
   where payment_order_id = p_order_id
      or (v_order.razorpay_payment_id is not null
          and razorpay_payment_id = v_order.razorpay_payment_id)
   limit 1;
  if found then
    return jsonb_build_object('ok', true, 'outcome', 'exists',
      'invoice_id', v_existing.id, 'invoice_number', v_existing.invoice_number);
  end if;

  -- 3. Seller snapshot from the singleton business_profile.
  select * into v_biz from public.business_profile where id = true;
  if not found then
    return jsonb_build_object('ok', false, 'outcome', 'failed', 'error_code', 'NO_BUSINESS_PROFILE');
  end if;

  -- 4. Buyer snapshot.
  --    buyer_name = COALESCE(business_name, full_name, phone)
  select coalesce(nullif(btrim(business_name), ''),
                  nullif(btrim(full_name), ''),
                  phone)            as buyer_name,
         phone                      as phone,
         nullif(btrim(gstin), '')   as gstin
    into v_provider
    from public.providers
   where provider_id = v_order.provider_id;
  if not found then
    return jsonb_build_object('ok', false, 'outcome', 'failed', 'error_code', 'PROVIDER_NOT_FOUND');
  end if;
  v_buyer_name  := v_provider.buyer_name;
  v_buyer_gstin := v_provider.gstin;   -- NULL → renders 'Unregistered' in the UI

  -- 5. Service period. Scheduled orders carry their future activation
  --    moment; immediate orders use the just-set active plan period.
  select * into v_plan from public.provider_plans where provider_id = v_order.provider_id;
  if v_order.scheduled_activates_at is not null then
    v_period_start := v_order.scheduled_activates_at;
    v_period_end   := v_order.scheduled_activates_at + interval '30 days';
  else
    v_period_start := coalesce(v_plan.current_period_start, v_now);
    v_period_end   := coalesce(v_plan.current_period_end, v_now + interval '30 days');
  end if;

  -- 6. Money. Total = captured amount (GST-inclusive). Derive taxable/tax
  --    so total = taxable + tax exactly (constraint-safe for any value).
  v_total   := v_order.amount_paise;
  v_taxable := round(v_total / 1.18);
  v_tax     := v_total - v_taxable;

  if v_buyer_state = v_biz.state_code then
    -- intra-state: CGST + SGST. SGST floors; CGST absorbs the odd paise
    -- so cgst + sgst = tax exactly.
    v_supply   := 'intra';
    v_sgst     := v_tax / 2;
    v_cgst     := v_tax - v_sgst;
    v_cgst_bps := 900;
    v_sgst_bps := 900;
    v_igst_bps := 0;
    v_place    := v_buyer_state || '-' || v_biz.state;
  else
    -- inter-state: IGST only.
    v_supply   := 'inter';
    v_igst     := v_tax;
    v_igst_bps := 1800;
    v_place    := v_buyer_state;
  end if;

  v_desc := case v_order.plan_code
    when 'regions_5'   then 'Kaun Karega Provider Listing Plan - 5 Regions'
    when 'all_jodhpur' then 'Kaun Karega Provider Listing Plan - Full Jodhpur'
    else 'Kaun Karega Provider Listing Plan'
  end;

  v_seller_address := concat_ws(', ',
    nullif(btrim(v_biz.address_line1), ''),
    nullif(btrim(v_biz.address_line2), ''),
    nullif(btrim(v_biz.city), ''),
    v_biz.state || ' - ' || v_biz.pincode);

  -- 7. Allocate the number and insert the invoice in ONE guarded block.
  --    On a concurrent-race unique_violation, the allocate + insert roll
  --    back together (gap-free) and we return the winner's invoice.
  begin
    v_fy     := public.kk_financial_year(v_now);
    v_seq    := public.allocate_invoice_number(v_fy);
    v_number := public.format_invoice_number(v_fy, v_seq, v_biz.invoice_prefix);

    insert into public.invoices (
      invoice_number, financial_year, seq,
      payment_order_id, razorpay_payment_id, provider_id, plan_code,
      issued_at, invoice_date, service_period_start, service_period_end,
      seller_gstin, seller_legal_name, seller_trade_name, seller_address, seller_state_code,
      buyer_name, buyer_phone, buyer_gstin, buyer_state_code, place_of_supply,
      supply_type, currency,
      taxable_value_paise, cgst_bps, sgst_bps, igst_bps,
      cgst_paise, sgst_paise, igst_paise, total_tax_paise, total_paise,
      pdf_status
    ) values (
      v_number, v_fy, v_seq,
      v_order.order_id, v_order.razorpay_payment_id, v_order.provider_id, v_order.plan_code,
      v_now, (v_now at time zone 'Asia/Kolkata')::date, v_period_start, v_period_end,
      v_biz.gstin, v_biz.legal_name, v_biz.trade_name, v_seller_address, v_biz.state_code,
      v_buyer_name, v_provider.phone, v_buyer_gstin, v_buyer_state, v_place,
      v_supply, coalesce(v_order.currency, 'INR'),
      v_taxable, v_cgst_bps, v_sgst_bps, v_igst_bps,
      v_cgst, v_sgst, v_igst, v_tax, v_total,
      'pending'
    )
    returning id into v_invoice_id;
  exception when unique_violation then
    select * into v_existing
      from public.invoices
     where payment_order_id = p_order_id
        or (v_order.razorpay_payment_id is not null
            and razorpay_payment_id = v_order.razorpay_payment_id)
     limit 1;
    return jsonb_build_object('ok', true, 'outcome', 'exists',
      'invoice_id', v_existing.id, 'invoice_number', v_existing.invoice_number);
  end;

  -- 8. Single line item for the plan.
  insert into public.invoice_items (
    invoice_id, line_no, description, sac_code, quantity,
    unit_price_paise, taxable_value_paise, gst_bps,
    cgst_paise, sgst_paise, igst_paise, line_total_paise
  ) values (
    v_invoice_id, 1, v_desc, v_biz.default_sac_code, 1,
    v_taxable, v_taxable, 1800,
    v_cgst, v_sgst, v_igst, v_total
  );

  -- 9. Payment-ledger credit (one per captured order; unique on
  --    (payment_order_id, entry_type)).
  insert into public.payment_ledger (
    entry_type, direction, provider_id, payment_order_id, razorpay_payment_id,
    invoice_id, amount_paise, taxable_paise, tax_paise, currency, description, occurred_at
  ) values (
    'payment', 'credit', v_order.provider_id, v_order.order_id, v_order.razorpay_payment_id,
    v_invoice_id, v_total, v_taxable, v_tax, coalesce(v_order.currency, 'INR'),
    'Invoice ' || v_number || ' for order ' || v_order.order_id,
    coalesce(v_order.paid_at, v_now)
  );

  -- 10. Audit trail.
  insert into public.invoice_audit_events (
    invoice_id, payment_order_id, event_type, actor, detail
  ) values (
    v_invoice_id, v_order.order_id, 'invoice_issued', 'system',
    jsonb_build_object(
      'invoice_number', v_number, 'financial_year', v_fy, 'seq', v_seq,
      'total_paise', v_total, 'taxable_value_paise', v_taxable,
      'total_tax_paise', v_tax, 'supply_type', v_supply
    )
  );

  return jsonb_build_object('ok', true, 'outcome', 'issued',
    'invoice_id', v_invoice_id, 'invoice_number', v_number, 'total_paise', v_total);
end;
$$;

-- service-role is the only direct caller (webhook RPC). Lock everyone else out.
revoke all on function public.issue_invoice_for_paid_order(text)
  from public, anon, authenticated;
grant execute on function public.issue_invoice_for_paid_order(text)
  to service_role;

-- ───────────────────────────────────────────────────────────────────
-- 2. Invoice immutability — issued invoices are append-only
-- ───────────────────────────────────────────────────────────────────
--
-- Issued invoices must never be edited or deleted (corrections use credit
-- notes in a future phase). The trigger blocks DELETE outright and blocks
-- any UPDATE that changes a non-pdf column — only the pdf_* lifecycle
-- columns (written later by the separate PDF job) may change. Using
-- to_jsonb(row) minus the pdf keys makes this future-proof: any column
-- added later is protected automatically.
create or replace function public.invoices_block_mutation()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'invoices are immutable and cannot be deleted (id=%)', old.id
      using errcode = 'check_violation';
  end if;

  if (to_jsonb(new)
        - 'pdf_status' - 'pdf_storage_path' - 'pdf_generated_at'
        - 'pdf_attempts' - 'pdf_last_error')
     is distinct from
     (to_jsonb(old)
        - 'pdf_status' - 'pdf_storage_path' - 'pdf_generated_at'
        - 'pdf_attempts' - 'pdf_last_error')
  then
    raise exception 'invoice % is immutable; only pdf_* columns may be updated', old.id
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_invoices_immutable on public.invoices;
create trigger trg_invoices_immutable
  before update or delete on public.invoices
  for each row execute function public.invoices_block_mutation();
