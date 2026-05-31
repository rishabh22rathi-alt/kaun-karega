-- Phase 1: GST invoice + payment ledger schema.
--
-- Source of truth for this migration: docs/payment-gst-invoice-ledger-
-- phase-1-schema-plan.md. Purely ADDITIVE and fully DORMANT — no
-- application code reads or writes any of these objects yet, the webhook
-- is untouched, no invoices are issued, and no PDFs are generated. The
-- whole feature is gated behind the application flag
-- KK_INVOICE_LEDGER_ENABLED, which Phase 2 will introduce.
--
-- What this migration creates:
--   providers.gstin            — optional buyer GSTIN (NULL = Unregistered)
--   business_profile           — supplier (seller) header, singleton row
--   invoice_number_counters    — per-financial-year sequential counter
--   invoices                   — immutable GST document header
--   invoice_items              — invoice line items
--   payment_ledger             — append-only money-movement ledger
--   invoice_audit_events       — append-only invoice lifecycle audit
--   kk_financial_year()        — Indian FY ('FY2026-27') for a timestamp
--   allocate_invoice_number()  — atomic, gap-free per-FY allocation
--   format_invoice_number()    — 'KK/FY2026-27/000001' formatter
--   storage bucket 'invoices'  — private PDF store (guarded; see §8)
--
-- Pricing context (GST-exclusive): plan base is the taxable value, 18%
-- GST on top. SAC 998399. Rajasthan supplier (state code 08) → intra-
-- state buyers get CGST 9% + SGST 9%; out-of-state get IGST 18%. Today
-- the platform is Jodhpur-only, so every invoice is intra-state.
--
-- Money is stored in paise (integer). Rates in basis points (1800 = 18%).
-- All tables are service-role only (RLS enabled, no policies) — the same
-- pattern as provider_plans / payment_orders / payment_webhook_events.
-- Invoices are immutable after issue and are NEVER deleted; corrections
-- use credit notes (a FUTURE phase, not implemented here). ON DELETE
-- RESTRICT on every financial FK enforces "never lose the ledger".

-- ───────────────────────────────────────────────────────────────────
-- 0. providers.gstin — optional buyer GSTIN, captured before payment
-- ───────────────────────────────────────────────────────────────────
--
-- Nullable: most providers are unregistered individuals. When NULL the
-- invoice renders the buyer GSTIN as "Unregistered". business_name
-- (already present, currently unused) becomes the registered "Bill To"
-- name going forward, falling back to full_name; that population is an
-- app concern, not this migration.

alter table public.providers
  add column if not exists gstin text;

-- ───────────────────────────────────────────────────────────────────
-- 1. business_profile — supplier (seller) header, singleton
-- ───────────────────────────────────────────────────────────────────
--
-- Singleton enforced via `id boolean primary key check (id = true)`:
-- only one row can ever exist (id = true). Holds the GSTIN / address /
-- SAC / default GST rate so each invoice can snapshot the seller fields
-- at issue time rather than hard-coding them in app code.

create table if not exists public.business_profile (
  id boolean primary key default true,
  constraint chk_business_profile_singleton check (id = true),
  trade_name text not null,
  legal_name text not null,
  entity_description text not null,
  gstin text not null,
  address_line1 text not null,
  address_line2 text null,
  city text not null,
  state text not null,
  state_code text not null,
  pincode text not null,
  default_sac_code text not null default '998399',
  default_gst_bps integer not null default 1800,
  invoice_prefix text not null default 'KK',
  updated_at timestamptz not null default now()
);

alter table public.business_profile enable row level security;
-- No policies — service-role only.

-- Seed the supplier profile (idempotent). KAUN KAREGA, Rajasthan (08).
insert into public.business_profile (
  id, trade_name, legal_name, entity_description, gstin,
  address_line1, address_line2, city, state, state_code, pincode,
  default_sac_code, default_gst_bps, invoice_prefix
) values (
  true,
  'KAUN KAREGA',
  'Rishabh Rathi',
  'A Proprietorship Concern of Rishabh Rathi',
  '08BYPHR6399K2ZD',
  '116, Gopi Kishan Vihar, Guru Ka Talab',
  'Pratap Nagar',
  'Jodhpur',
  'Rajasthan',
  '08',
  '342003',
  '998399',
  1800,
  'KK'
)
on conflict (id) do nothing;

-- ───────────────────────────────────────────────────────────────────
-- 2. invoice_number_counters — sequential-by-financial-year
-- ───────────────────────────────────────────────────────────────────
--
-- One row per Indian FY ('FY2026-27'). Incremented atomically by
-- allocate_invoice_number() below. The number is allocated INSIDE the
-- (future) issuance transaction so a rolled-back invoice also rolls
-- back the counter — guaranteeing a gap-free GST series.

create table if not exists public.invoice_number_counters (
  financial_year text primary key,
  last_seq bigint not null default 0
    check (last_seq >= 0),
  updated_at timestamptz not null default now()
);

alter table public.invoice_number_counters enable row level security;
-- No policies — service-role only.

-- ───────────────────────────────────────────────────────────────────
-- 3. invoices — GST document header (immutable record)
-- ───────────────────────────────────────────────────────────────────
--
-- payment_order_id and razorpay_payment_id are UNIQUE: the hard
-- idempotency anchors. Even a duplicate webhook (different event_id,
-- same payment) cannot create a second invoice — issuance treats a
-- 23505 as "already issued → success". Monetary + party fields are
-- frozen snapshots: the PDF renders from these, so a later price or
-- profile change never alters an issued invoice.
--
-- supply_type drives the tax split:
--   'intra' → CGST + SGST   (igst = 0)
--   'inter' → IGST          (cgst = sgst = 0)
--
-- PDF fields are NULL at insert and written out-of-band by the SEPARATE
-- (future) PDF job — ledger creation and PDF generation are decoupled.

create table if not exists public.invoices (
  id bigserial primary key,
  invoice_number text not null unique,
  financial_year text not null,
  seq bigint not null,
  constraint uq_invoices_fy_seq unique (financial_year, seq),

  -- idempotency anchors + Razorpay ↔ invoice link
  payment_order_id text not null unique
    references public.payment_orders(order_id) on delete restrict,
  razorpay_payment_id text unique,

  provider_id text not null
    references public.providers(provider_id) on delete restrict,
  plan_code text not null,

  -- document dates / service period (snapshot of provider_plans)
  issued_at timestamptz not null default now(),
  invoice_date date not null,
  service_period_start timestamptz not null,
  service_period_end timestamptz not null,

  -- seller snapshot (frozen at issue)
  seller_gstin text not null,
  seller_legal_name text not null,
  seller_trade_name text not null,
  seller_address text not null,
  seller_state_code text not null,

  -- buyer snapshot (frozen at issue)
  buyer_name text not null,
  buyer_phone text not null,
  buyer_gstin text null,
  buyer_state_code text not null,
  place_of_supply text not null,

  -- tax classification
  supply_type text not null
    check (supply_type in ('intra', 'inter')),

  -- money (paise); header totals = sum of invoice_items
  currency text not null default 'INR'
    check (char_length(currency) = 3),
  taxable_value_paise integer not null
    check (taxable_value_paise >= 0),
  cgst_bps integer not null default 0,
  sgst_bps integer not null default 0,
  igst_bps integer not null default 0,
  cgst_paise integer not null default 0
    check (cgst_paise >= 0),
  sgst_paise integer not null default 0
    check (sgst_paise >= 0),
  igst_paise integer not null default 0
    check (igst_paise >= 0),
  total_tax_paise integer not null
    check (total_tax_paise >= 0),
  total_paise integer not null
    check (total_paise > 0),

  -- arithmetic integrity (holds regardless of inclusive/exclusive math)
  constraint chk_invoices_totals check (
    total_paise = taxable_value_paise + total_tax_paise
    and total_tax_paise = cgst_paise + sgst_paise + igst_paise
  ),
  -- intra ⇒ CGST+SGST only ; inter ⇒ IGST only
  constraint chk_invoices_supply_split check (
    (supply_type = 'intra' and igst_paise = 0 and igst_bps = 0)
    or (supply_type = 'inter' and cgst_paise = 0 and sgst_paise = 0
        and cgst_bps = 0 and sgst_bps = 0)
  ),

  -- PDF lifecycle (written by the SEPARATE async job; NULL at insert)
  pdf_status text not null default 'pending'
    check (pdf_status in ('pending', 'generating', 'generated', 'failed')),
  pdf_storage_path text null,
  pdf_generated_at timestamptz null,
  pdf_attempts integer not null default 0
    check (pdf_attempts >= 0),
  pdf_last_error text null,

  created_at timestamptz not null default now()
);

-- Provider dashboard "my invoices" reads, newest first.
create index if not exists idx_invoices_provider_issued
  on public.invoices (provider_id, issued_at desc);
-- Monthly CSV export range scan.
create index if not exists idx_invoices_issued_at
  on public.invoices (issued_at desc);
-- FY filtering / reconciliation.
create index if not exists idx_invoices_fy
  on public.invoices (financial_year);
-- PDF retry queue: rows not yet generated.
create index if not exists idx_invoices_pdf_unfinished
  on public.invoices (pdf_status)
  where pdf_status <> 'generated';

alter table public.invoices enable row level security;
-- No policies — service-role only.

-- ───────────────────────────────────────────────────────────────────
-- 4. invoice_items — invoice line items
-- ───────────────────────────────────────────────────────────────────
--
-- One row per plan line today (e.g. "Kaun Karega Provider Listing Plan
-- - 5 Regions"). Child of invoices; ON DELETE RESTRICT mirrors the
-- never-delete rule. line_total = taxable + cgst + sgst + igst.

create table if not exists public.invoice_items (
  id bigserial primary key,
  invoice_id bigint not null
    references public.invoices(id) on delete restrict,
  line_no integer not null
    check (line_no >= 1),
  description text not null,
  sac_code text not null default '998399',
  quantity integer not null default 1
    check (quantity >= 1),
  unit_price_paise integer not null
    check (unit_price_paise >= 0),
  taxable_value_paise integer not null
    check (taxable_value_paise >= 0),
  gst_bps integer not null default 1800,
  cgst_paise integer not null default 0
    check (cgst_paise >= 0),
  sgst_paise integer not null default 0
    check (sgst_paise >= 0),
  igst_paise integer not null default 0
    check (igst_paise >= 0),
  line_total_paise integer not null
    check (line_total_paise > 0),
  constraint uq_invoice_items_line unique (invoice_id, line_no),
  constraint chk_invoice_items_total check (
    line_total_paise = taxable_value_paise + cgst_paise + sgst_paise + igst_paise
  )
);

create index if not exists idx_invoice_items_invoice
  on public.invoice_items (invoice_id);

alter table public.invoice_items enable row level security;
-- No policies — service-role only.

-- ───────────────────────────────────────────────────────────────────
-- 5. payment_ledger — append-only money-movement ledger
-- ───────────────────────────────────────────────────────────────────
--
-- Separate from invoices: the ledger records cash MOVEMENTS (one credit
-- per captured payment; future debits for refunds / credit notes), the
-- invoice is the tax DOCUMENT. The (payment_order_id, entry_type) unique
-- guarantees one 'payment' credit per captured order (idempotency).

create table if not exists public.payment_ledger (
  id bigserial primary key,
  entry_type text not null
    check (entry_type in ('payment', 'refund', 'credit_note', 'adjustment')),
  direction text not null
    check (direction in ('credit', 'debit')),
  provider_id text not null
    references public.providers(provider_id) on delete restrict,
  payment_order_id text null
    references public.payment_orders(order_id) on delete restrict,
  razorpay_payment_id text null,
  invoice_id bigint null
    references public.invoices(id) on delete restrict,
  amount_paise integer not null
    check (amount_paise > 0),
  taxable_paise integer not null default 0
    check (taxable_paise >= 0),
  tax_paise integer not null default 0
    check (tax_paise >= 0),
  currency text not null default 'INR'
    check (char_length(currency) = 3),
  description text null,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint uq_payment_ledger_payment_order
    unique (payment_order_id, entry_type)
);

create index if not exists idx_payment_ledger_provider
  on public.payment_ledger (provider_id, occurred_at desc);
create index if not exists idx_payment_ledger_invoice
  on public.payment_ledger (invoice_id);
create index if not exists idx_payment_ledger_occurred
  on public.payment_ledger (occurred_at desc);

alter table public.payment_ledger enable row level security;
-- No policies — service-role only.

-- ───────────────────────────────────────────────────────────────────
-- 6. invoice_audit_events — append-only invoice lifecycle audit
-- ───────────────────────────────────────────────────────────────────
--
-- Records number allocation, issuance, PDF render attempts, regenerate,
-- credit-note issuance, and duplicate-webhook ignores. invoice_id is
-- nullable because some events (e.g. a pre-issue allocation log) precede
-- the invoice row.

create table if not exists public.invoice_audit_events (
  id bigserial primary key,
  invoice_id bigint null
    references public.invoices(id) on delete restrict,
  payment_order_id text null,
  event_type text not null,
  actor text not null default 'system'
    check (actor in ('system', 'webhook', 'admin')),
  actor_id text null,
  detail jsonb null,
  created_at timestamptz not null default now()
);

create index if not exists idx_invoice_audit_invoice
  on public.invoice_audit_events (invoice_id, created_at desc);
create index if not exists idx_invoice_audit_type
  on public.invoice_audit_events (event_type, created_at desc);

alter table public.invoice_audit_events enable row level security;
-- No policies — service-role only.

-- ───────────────────────────────────────────────────────────────────
-- 7. Numbering functions
-- ───────────────────────────────────────────────────────────────────

-- Indian financial year (Apr 1 – Mar 31, IST) for a timestamp.
-- 'FY2026-27'. STABLE (not IMMUTABLE) because AT TIME ZONE on a
-- timestamptz is stable; it is only ever called at issue time, never in
-- an index or generated column, so STABLE is correct and sufficient.
create or replace function public.kk_financial_year(p_ts timestamptz)
returns text
language sql
stable
as $$
  select 'FY' || y || '-' || lpad(((y + 1) % 100)::text, 2, '0')
  from (
    select case
             when extract(month from (p_ts at time zone 'Asia/Kolkata')) >= 4
               then extract(year from (p_ts at time zone 'Asia/Kolkata'))::int
               else extract(year from (p_ts at time zone 'Asia/Kolkata'))::int - 1
           end as y
  ) s;
$$;

-- Atomic per-FY allocation. INSERT ... ON CONFLICT DO UPDATE is a single
-- atomic statement; concurrent callers serialize on the FY counter row.
-- Returns the new sequence value. MUST be called inside the issuance
-- transaction so a rolled-back invoice rolls back the counter (gap-free).
-- security definer + revoked EXECUTE → service-role / admin only.
create or replace function public.allocate_invoice_number(p_financial_year text)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_seq bigint;
begin
  insert into public.invoice_number_counters (financial_year, last_seq)
  values (p_financial_year, 1)
  on conflict (financial_year)
  do update set last_seq = public.invoice_number_counters.last_seq + 1,
                updated_at = now()
  returning last_seq into v_seq;
  return v_seq;
end;
$$;

-- Formats 'KK/FY2026-27/000001' from an FY + sequence. IMMUTABLE: pure
-- string formatting. Kept here so Phase 2 issuance and any manual SQL
-- produce byte-identical invoice numbers.
create or replace function public.format_invoice_number(
  p_financial_year text,
  p_seq bigint,
  p_prefix text default 'KK'
)
returns text
language sql
immutable
as $$
  select p_prefix || '/' || p_financial_year || '/' || lpad(p_seq::text, 6, '0');
$$;

-- Lock down the privileged allocator. format/kk_financial_year are pure
-- and safe to leave callable, but the allocator MUTATES the counter.
revoke all on function public.allocate_invoice_number(text)
  from public, anon, authenticated;

-- ───────────────────────────────────────────────────────────────────
-- 8. Storage bucket for invoice PDFs (private)
-- ───────────────────────────────────────────────────────────────────
--
-- Private bucket 'invoices' — PDFs contain GSTIN + personal data, so no
-- public access. Writes happen only via service-role (the future PDF
-- job); provider/admin downloads use short-lived signed URLs minted by
-- the server. Path convention: 'FY2026-27/KK-FY2026-27-000001.pdf'.
--
-- Guarded so this migration also applies cleanly on environments where
-- the storage schema is not present (e.g. a bare Postgres used for
-- schema-only checks). No-op if storage.buckets is missing.
do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'storage' and table_name = 'buckets'
  ) then
    insert into storage.buckets (id, name, public)
    values ('invoices', 'invoices', false)
    on conflict (id) do nothing;
  end if;
end
$$;
