# Phase 1 Schema Plan — GST Invoice + Payment Ledger

**Status:** PLAN ONLY. No code changed, no migration created, webhook untouched, no PDF generation,
not activated in production. Everything below is behind the proposed flag `KK_INVOICE_LEDGER_ENABLED`.

**Date:** 2026-06-01 (R1 resolved 2026-06-01)
**Supersedes:** the §6 sketch in [payment-gst-invoice-ledger-audit.md](payment-gst-invoice-ledger-audit.md)
(that was a first pass; the table set here is the authoritative Phase 1 design).

---

## ✅ FINAL PRICING DECISION (R1 resolved)

**Pricing is GST-exclusive. Razorpay must collect base plan amount + 18% GST.** The captured Razorpay
amount IS the invoice total. This was the one blocker; it is now settled. Chosen path = option (b) from
the earlier draft: **raise the charged amount to base + GST** (a payment-logic change, to be done in the
implementation phase — NOT in this doc).

| Plan | Base (taxable) | GST 18% | **Total payable = captured = invoice total** |
|------|---------------|---------|----------------------------------------------|
| `regions_5` (₹31) | ₹31.00 — **3100 paise** | ₹5.58 — **558 paise** | **₹36.58 — 3658 paise** |
| `all_jodhpur` (₹101) | ₹101.00 — **10100 paise** | ₹18.18 — **1818 paise** | **₹119.18 — 11918 paise** |

Intra-state split (Rajasthan, the only case today): CGST 9% + SGST 9%.

| Plan | taxable | CGST (9%) | SGST (9%) | total |
|------|---------|-----------|-----------|-------|
| `regions_5` | 3100 | 279 | 279 | 3658 |
| `all_jodhpur` | 10100 | 909 | 909 | 11918 |

**Both prices divide to whole paise** (3100×18% = 558 exactly; 558/2 = 279 exactly; 10100×18% = 1818;
1818/2 = 909) — so for the current price list there is **no rounding loss** and the §11 R2 rounding risk
does not bite. A rounding rule is still required before any new price is added (see R2).

**Invariant going forward:** `invoices.total_paise = payment_orders.amount_paise = Razorpay captured
amount`, and `taxable_value_paise = base`, `total_tax_paise = total − base`. The existing webhook
amount-match check ([webhook L277](../web/app/api/payments/webhook/route.ts#L277)) compares the captured
amount against `payment_orders.amount_paise`, so **`amount_paise` must store the GST-inclusive total**
once the charge changes (see §14).

**Payment UI must show the breakdown** — base price, GST (18%), and total payable — before the provider
pays. (§14 lists the exact files.)

---

## 1. Existing payment-related schema (inspected)

All confirmed from `supabase/migrations/` and the route code.

### `payment_orders` — `20260523120000_payment_minimum.sql` (+ phase 2/3 columns)
PK `order_id` (TEXT, = Razorpay order id). Relevant columns for invoicing:
`provider_id` (FK→providers, RESTRICT), `plan_code`, `amount_paise` (CHECK > 0), `currency` (default INR),
`status` (`created|paid|failed`), `razorpay_payment_id` (**partial-unique when present** —
`uq_payment_orders_razorpay_payment_id`), `paid_at`, `raw_webhook` (jsonb), `current_period_end_at_order`,
`scheduled_region_codes`, `agreed_terms_at`.
→ This is the row the webhook flips to `paid`; it is the natural parent of an invoice.

### `payment_webhook_events` — same migration
PK `id` BIGSERIAL. `event_id` (**partial-unique** `uq_payment_webhook_events_event_id` — the first-line
Razorpay-retry guard), `event_type`, `order_id`, `razorpay_payment_id`, `signature_ok`, `raw_body` (jsonb).

### `provider_plans` — same migration (+ phase 1/2 scheduled columns)
PK `provider_id`. `plan_code`, `max_regions`, **`current_period_start`**, **`current_period_end`**
(→ the **service period** to print on the invoice), `last_payment_id`, scheduled_* columns.

### Other payment/plan tables (no invoice fields)
`provider_scheduled_areas`, `scheduled_plan_activations`, RPC `activate_scheduled_plan()`. Not involved
in invoicing except that the immediate-capture path is where the invoice hook will eventually live.

### Activation source-of-truth
Only [web/app/api/payments/webhook/route.ts](../web/app/api/payments/webhook/route.ts) writes plan state
and flips `status='paid'`. **It will be the only place invoice issuance is triggered (Phase 2, not now).**

### Pricing (`web/lib/payments/server.ts`)
`PLAN_PRICING` today = **base** amounts: `regions_5` → 3100 paise, `all_jodhpur` → 10100 paise; 30-day
validity; auto-capture (`payment_capture:1`).
→ **Per the R1 decision, the charged/captured amount must become base + 18% GST (3658 / 11918 paise).**
`payment_orders.amount_paise` must then store that GST-inclusive total so the webhook amount-match still
passes and the invoice total reconciles. The base stays the taxable value. Implementation in §14.

---

## 2. Provider fields available for the buyer ("Bill To") snapshot

Confirmed by reading the registration insert ([web/app/api/kk/route.ts](../web/app/api/kk/route.ts) ~L1881)
and read sites ([web/lib/admin/adminProviderReads.ts](../web/lib/admin/adminProviderReads.ts)).

| Need on invoice | Provider field today | Status |
|---|---|---|
| Business name | `full_name` | ✅ populated at registration (customer-facing name) |
| "Registered business name" | `business_name` | ⚠️ **column exists but is always NULL** (inserted as null, never written) |
| Mobile number | `phone` | ✅ 10-digit (or `91`+10 in some rows) |
| Buyer GSTIN | — | ❌ **does not exist anywhere** |
| Buyer state / city | — on `providers` | ❌ no state/city column; city is in `provider_areas.city_code` → `cities` |

**Consequences for Phase 1:**
- `buyer_name` snapshot = `COALESCE(NULLIF(business_name,''), full_name)`.
- A **buyer GSTIN must be captured before payment** → no field exists, so Phase 1 must add one
  (proposed below: columns on `providers`, the smallest change; alternative `provider_billing_details`
  table noted).
- **Buyer state for place-of-supply is not reliably stored.** The platform is currently Jodhpur-only
  (Rajasthan, state code `08`), so every invoice is **intra-state (CGST+SGST)** today; the IGST path is
  designed but currently unreachable. See Risk R3.

---

## 3–4. Proposed tables (columns, constraints, indexes, FKs)

> Conventions: money in **paise** (integer, never float); rates in **basis points** (`1800` = 18%);
> all tables **RLS-enabled, service-role-only** (matching existing payment tables); append-only tables
> never updated/deleted.

### 3.1 `business_profile` — supplier (seller) header, singleton
```sql
CREATE TABLE public.business_profile (
  id                 BOOLEAN PRIMARY KEY DEFAULT true,        -- singleton: only one row (id = true)
  CONSTRAINT chk_business_profile_singleton CHECK (id = true),
  trade_name         TEXT NOT NULL,                           -- 'KAUN KAREGA'
  legal_name         TEXT NOT NULL,                           -- 'Rishabh Rathi'
  entity_description TEXT NOT NULL,                           -- 'A Proprietorship Concern of Rishabh Rathi'
  gstin              TEXT NOT NULL,                           -- '08BYPHR6399K2ZD'
  address_line1      TEXT NOT NULL,                           -- '116, Gopi Kishan Vihar, Guru Ka Talab'
  address_line2      TEXT,                                    -- 'Pratap Nagar'
  city               TEXT NOT NULL,                           -- 'Jodhpur'
  state              TEXT NOT NULL,                           -- 'Rajasthan'
  state_code         TEXT NOT NULL,                           -- '08'
  pincode            TEXT NOT NULL,                           -- '342003'
  default_sac_code   TEXT NOT NULL DEFAULT '998399',
  default_gst_bps    INTEGER NOT NULL DEFAULT 1800,           -- 18%
  invoice_prefix     TEXT NOT NULL DEFAULT 'KK',
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
```
Rationale: a table (not hard-coded constants) so the GSTIN/address/SAC are a single source of truth,
snapshotted onto each invoice at issue time. Singleton via `id BOOLEAN PK CHECK(id=true)`.

### 3.2 `invoice_number_counters` — sequential-by-financial-year
```sql
CREATE TABLE public.invoice_number_counters (
  financial_year TEXT PRIMARY KEY,            -- 'FY2026-27'
  last_seq       BIGINT NOT NULL DEFAULT 0 CHECK (last_seq >= 0),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
```
One counter row per Indian FY (Apr 1 – Mar 31 IST). Atomic increment via the allocator (§6). The number
is allocated **inside the issuance transaction** so a rolled-back invoice also rolls back the counter →
**no gaps** (GST series must be consecutive).

### 3.3 `invoices` — GST document header (the immutable record)
```sql
CREATE TABLE public.invoices (
  id                    BIGSERIAL PRIMARY KEY,
  invoice_number        TEXT NOT NULL UNIQUE,                 -- 'KK/FY2026-27/000001'
  financial_year        TEXT NOT NULL,
  seq                   BIGINT NOT NULL,
  CONSTRAINT uq_invoices_fy_seq UNIQUE (financial_year, seq),

  -- ── idempotency anchors (see §5) ──
  payment_order_id      TEXT NOT NULL UNIQUE
                          REFERENCES public.payment_orders(order_id) ON DELETE RESTRICT,
  razorpay_payment_id   TEXT UNIQUE,                          -- links Razorpay payment ↔ invoice

  provider_id           TEXT NOT NULL
                          REFERENCES public.providers(provider_id) ON DELETE RESTRICT,
  plan_code             TEXT NOT NULL,

  -- ── document dates / service period ──
  issued_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  invoice_date          DATE NOT NULL,
  service_period_start  TIMESTAMPTZ NOT NULL,                 -- provider_plans.current_period_start
  service_period_end    TIMESTAMPTZ NOT NULL,                 -- provider_plans.current_period_end

  -- ── seller snapshot (frozen at issue) ──
  seller_gstin          TEXT NOT NULL,
  seller_legal_name     TEXT NOT NULL,
  seller_trade_name     TEXT NOT NULL,
  seller_address        TEXT NOT NULL,
  seller_state_code     TEXT NOT NULL,                        -- '08'

  -- ── buyer snapshot (frozen at issue) ──
  buyer_name            TEXT NOT NULL,                        -- COALESCE(business_name, full_name)
  buyer_phone           TEXT NOT NULL,
  buyer_gstin           TEXT,                                 -- NULL → render 'Unregistered'
  buyer_state_code      TEXT NOT NULL,                        -- default '08' (Rajasthan) today
  place_of_supply       TEXT NOT NULL,                        -- e.g. '08-Rajasthan'

  -- ── tax classification ──
  supply_type           TEXT NOT NULL CHECK (supply_type IN ('intra','inter')),

  -- ── money (paise) — header totals = sum of invoice_items ──
  currency              TEXT NOT NULL DEFAULT 'INR' CHECK (char_length(currency)=3),
  taxable_value_paise   INTEGER NOT NULL CHECK (taxable_value_paise >= 0),
  cgst_bps              INTEGER NOT NULL DEFAULT 0,
  sgst_bps              INTEGER NOT NULL DEFAULT 0,
  igst_bps              INTEGER NOT NULL DEFAULT 0,
  cgst_paise            INTEGER NOT NULL DEFAULT 0 CHECK (cgst_paise >= 0),
  sgst_paise            INTEGER NOT NULL DEFAULT 0 CHECK (sgst_paise >= 0),
  igst_paise            INTEGER NOT NULL DEFAULT 0 CHECK (igst_paise >= 0),
  total_tax_paise       INTEGER NOT NULL CHECK (total_tax_paise >= 0),
  total_paise           INTEGER NOT NULL CHECK (total_paise > 0),
  -- arithmetic integrity (independent of the inclusive/exclusive question — see Risk R1)
  CONSTRAINT chk_invoices_totals
    CHECK (total_paise = taxable_value_paise + total_tax_paise
       AND total_tax_paise = cgst_paise + sgst_paise + igst_paise),
  -- intra ⇒ CGST+SGST only, IGST=0 ; inter ⇒ IGST only, CGST=SGST=0
  CONSTRAINT chk_invoices_supply_split CHECK (
    (supply_type='intra' AND igst_paise=0 AND igst_bps=0)
    OR (supply_type='inter' AND cgst_paise=0 AND sgst_paise=0 AND cgst_bps=0 AND sgst_bps=0)
  ),

  -- ── PDF lifecycle (filled by the SEPARATE async job; NULL at insert) ──
  pdf_status            TEXT NOT NULL DEFAULT 'pending'
                          CHECK (pdf_status IN ('pending','generating','generated','failed')),
  pdf_storage_path      TEXT,                                 -- 'FY2026-27/KK-FY2026-27-000001.pdf'
  pdf_generated_at      TIMESTAMPTZ,
  pdf_attempts          INTEGER NOT NULL DEFAULT 0,
  pdf_last_error        TEXT,

  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_invoices_provider_issued   ON public.invoices (provider_id, issued_at DESC);
CREATE INDEX idx_invoices_issued_at         ON public.invoices (issued_at DESC);          -- monthly export
CREATE INDEX idx_invoices_fy                ON public.invoices (financial_year);
CREATE INDEX idx_invoices_pdf_unfinished    ON public.invoices (pdf_status)
                                              WHERE pdf_status <> 'generated';            -- retry queue
```
Notes:
- **Monetary + party fields are frozen snapshots.** The PDF renders from these; a later price/profile
  change never mutates an issued invoice.
- **No DELETE ever** — `ON DELETE RESTRICT` on both FKs and an explicit operational rule. Corrections →
  credit notes (§3.7), never deletion.

### 3.4 `invoice_items` — line items (1 row per plan line; child of invoices)
```sql
CREATE TABLE public.invoice_items (
  id                  BIGSERIAL PRIMARY KEY,
  invoice_id          BIGINT NOT NULL REFERENCES public.invoices(id) ON DELETE RESTRICT,
  line_no             INTEGER NOT NULL CHECK (line_no >= 1),
  description         TEXT NOT NULL,            -- 'Kaun Karega Provider Listing Plan - 5 Regions'
  sac_code            TEXT NOT NULL DEFAULT '998399',
  quantity            INTEGER NOT NULL DEFAULT 1 CHECK (quantity >= 1),
  unit_price_paise    INTEGER NOT NULL CHECK (unit_price_paise >= 0),
  taxable_value_paise INTEGER NOT NULL CHECK (taxable_value_paise >= 0),
  gst_bps             INTEGER NOT NULL DEFAULT 1800,
  cgst_paise          INTEGER NOT NULL DEFAULT 0,
  sgst_paise          INTEGER NOT NULL DEFAULT 0,
  igst_paise          INTEGER NOT NULL DEFAULT 0,
  line_total_paise    INTEGER NOT NULL CHECK (line_total_paise > 0),
  CONSTRAINT uq_invoice_items_line UNIQUE (invoice_id, line_no),
  CONSTRAINT chk_invoice_items_total
    CHECK (line_total_paise = taxable_value_paise + cgst_paise + sgst_paise + igst_paise)
);
CREATE INDEX idx_invoice_items_invoice ON public.invoice_items (invoice_id);
```
Plan → description map (rendered by issuance code, stored here):
`regions_5` → "Kaun Karega Provider Listing Plan - 5 Regions";
`all_jodhpur` → "Kaun Karega Provider Listing Plan - Full Jodhpur".

### 3.5 `payment_ledger` — money-movement ledger (append-only)
Separate from `invoices`: the ledger records **cash movements** (one credit per captured payment; future
debits for refunds/credit-notes), the invoice is the **tax document**. They are linked.
```sql
CREATE TABLE public.payment_ledger (
  id                  BIGSERIAL PRIMARY KEY,
  entry_type          TEXT NOT NULL CHECK (entry_type IN ('payment','refund','credit_note','adjustment')),
  direction           TEXT NOT NULL CHECK (direction IN ('credit','debit')),
  provider_id         TEXT NOT NULL REFERENCES public.providers(provider_id) ON DELETE RESTRICT,
  payment_order_id    TEXT REFERENCES public.payment_orders(order_id) ON DELETE RESTRICT,
  razorpay_payment_id TEXT,
  invoice_id          BIGINT REFERENCES public.invoices(id) ON DELETE RESTRICT,
  amount_paise        INTEGER NOT NULL CHECK (amount_paise > 0),
  taxable_paise       INTEGER NOT NULL DEFAULT 0,
  tax_paise           INTEGER NOT NULL DEFAULT 0,
  currency            TEXT NOT NULL DEFAULT 'INR',
  description         TEXT,
  occurred_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- one ledger 'payment' row per captured order (idempotency, see §5)
  CONSTRAINT uq_payment_ledger_payment_order
    UNIQUE (payment_order_id, entry_type)
);
CREATE INDEX idx_payment_ledger_provider   ON public.payment_ledger (provider_id, occurred_at DESC);
CREATE INDEX idx_payment_ledger_invoice    ON public.payment_ledger (invoice_id);
CREATE INDEX idx_payment_ledger_occurred   ON public.payment_ledger (occurred_at DESC);
```

### 3.6 `invoice_audit_events` — lifecycle audit trail (append-only)
```sql
CREATE TABLE public.invoice_audit_events (
  id               BIGSERIAL PRIMARY KEY,
  invoice_id       BIGINT REFERENCES public.invoices(id) ON DELETE RESTRICT,  -- NULL for pre-issue events
  payment_order_id TEXT,
  event_type       TEXT NOT NULL,     -- 'number_allocated' | 'invoice_issued' | 'duplicate_ignored'
                                      -- | 'pdf_render_started' | 'pdf_render_succeeded'
                                      -- | 'pdf_render_failed' | 'pdf_regenerated' | 'credit_note_issued'
  actor            TEXT NOT NULL DEFAULT 'system' CHECK (actor IN ('system','webhook','admin')),
  actor_id         TEXT,
  detail           JSONB,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_invoice_audit_invoice ON public.invoice_audit_events (invoice_id, created_at DESC);
CREATE INDEX idx_invoice_audit_type    ON public.invoice_audit_events (event_type, created_at DESC);
```

### 3.7 `credit_notes` — FUTURE design only (DO NOT create now)
Not needed for Phase 1 (payments are non-refundable; corrections are rare). Sketch so the number-series
and linkage are pre-thought:
```sql
-- FUTURE — do not implement in Phase 1
-- credit_notes(
--   id, credit_note_number TEXT UNIQUE,        -- 'KK/FY2026-27/CN-000001' (own counter series)
--   original_invoice_id BIGINT REFERENCES invoices(id) ON DELETE RESTRICT,
--   reason TEXT NOT NULL,
--   taxable_value_paise, cgst_paise, sgst_paise, igst_paise, total_paise,  -- positive magnitudes
--   issued_at, invoice_date,
--   pdf_status, pdf_storage_path, pdf_generated_at,
--   created_at )
-- + credit_note_number_counters (separate FY series), + payment_ledger debit rows on issue.
```

### 3.8 Buyer-GSTIN capture (no table exists today — smallest change)
Provider GSTIN is optional and must be captured **before payment**. Recommended Phase 1 addition:
```sql
ALTER TABLE public.providers ADD COLUMN IF NOT EXISTS gstin TEXT;            -- optional, NULL = Unregistered
-- business_name already exists (currently NULL); begin populating it as the registered business name.
```
Alternative (if you prefer not to touch `providers`): a `provider_billing_details(provider_id PK,
business_name, gstin, updated_at)` table. Recommendation: **columns on `providers`** — fewer joins, the
data is 1:1 with the provider, and `business_name` already exists. Either way the invoice **snapshots**
the value at issue, so later edits don't change issued invoices.

---

## 5. Idempotency design (duplicate webhook must NOT double-issue)

Three layers, outermost first:

1. **Existing event dedup** — `payment_webhook_events.event_id` unique already returns 200 before any
   invoice code runs for a re-delivered event ([webhook L169](../web/app/api/payments/webhook/route.ts#L169)).
2. **Hard invoice uniqueness** — `invoices.payment_order_id UNIQUE` **and** `invoices.razorpay_payment_id
   UNIQUE`. Even a *different* event_id for the same payment (`order.paid` + `payment.captured`) cannot
   create a second invoice. Issuance treats Postgres `23505` as "already issued → success."
3. **Ledger uniqueness** — `payment_ledger (payment_order_id, entry_type)` unique ⇒ one `payment` credit
   per order.

**Gap-free guarantee:** the number is allocated **inside the same transaction** as the invoice insert
(§6). If the insert hits a unique conflict (duplicate webhook) the whole transaction rolls back —
**including** the counter increment — so no sequence number is burned. The issuance function also does a
**check-first** (`SELECT invoice WHERE payment_order_id = ?`) and returns the existing row without
allocating, so the common retry path never even touches the counter.

---

## 6. Atomic invoice-number allocator (function design)

Two functions. Both are DB-side so concurrency is handled by Postgres row locks, not app code.

```sql
-- (a) Indian financial year for a timestamp, IST. 'FY2026-27'
CREATE OR REPLACE FUNCTION public.kk_financial_year(p_ts timestamptz)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT 'FY' || y || '-' || lpad(((y + 1) % 100)::text, 2, '0')
  FROM (SELECT CASE
           WHEN extract(month FROM (p_ts AT TIME ZONE 'Asia/Kolkata')) >= 4
             THEN extract(year FROM (p_ts AT TIME ZONE 'Asia/Kolkata'))::int
             ELSE extract(year FROM (p_ts AT TIME ZONE 'Asia/Kolkata'))::int - 1
        END AS y) s;
$$;

-- (b) Atomic per-FY allocation. INSERT...ON CONFLICT DO UPDATE is a single
--     atomic statement; concurrent callers serialize on the FY row.
CREATE OR REPLACE FUNCTION public.allocate_invoice_number(p_financial_year text)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_seq bigint;
BEGIN
  INSERT INTO invoice_number_counters (financial_year, last_seq)
  VALUES (p_financial_year, 1)
  ON CONFLICT (financial_year)
  DO UPDATE SET last_seq = invoice_number_counters.last_seq + 1, updated_at = now()
  RETURNING last_seq INTO v_seq;
  RETURN v_seq;            -- formatted number: 'KK/'||p_financial_year||'/'||lpad(v_seq::text,6,'0')
END;
$$;
REVOKE ALL ON FUNCTION public.allocate_invoice_number(text) FROM public, anon, authenticated;
```

**Phase 2 issuance wrapper (design, NOT now):** one `SECURITY DEFINER` function
`issue_invoice_for_paid_order(p_order_id)` that, in ONE transaction: (1) returns the existing invoice if
`payment_order_id` already invoiced; else (2) reads order + plan + provider + business_profile, (3) calls
`allocate_invoice_number(kk_financial_year(now()))`, (4) inserts `invoices` + `invoice_items` +
`payment_ledger` credit + audit row. Same-transaction allocation ⇒ gap-free; the webhook calls this
**soft-fail** so an invoice error never 5xxs a captured payment.

---

## 7. RLS / security notes

- All six new tables: **`ENABLE ROW LEVEL SECURITY` with no policies** → service-role only, identical to
  `payment_orders`/`provider_plans`. Provider and admin access goes exclusively through server API routes
  that authenticate and filter by the resolved `provider_id` (mirroring existing endpoints).
- `allocate_invoice_number` / issuance function: `SECURITY DEFINER`, `REVOKE` from `public/anon/authenticated`.
- `business_profile` holds the GSTIN/address — service-role read only; never exposed to client bundles.
- Invoices are **immutable after issue**: enforce by convention + a future `BEFORE UPDATE` trigger that
  rejects changes to monetary/number/party columns (allow only `pdf_*` transitions). Flagged for Phase 2.
- New `providers.gstin` is readable by the provider's own profile route only (already service-role gated).

---

## 8. Supabase Storage bucket recommendation

- **Private bucket** `invoices` (NOT public). PDFs contain GSTIN + personal data.
- Path convention: `FY2026-27/KK-FY2026-27-000001.pdf` (matches `invoices.pdf_storage_path`).
- Access: server routes mint **short-lived signed URLs** (e.g. 60 s) for provider/admin downloads; the
  bucket has no public policy and no anon access.
- Writes only via service-role (the PDF job). Overwrite-on-regenerate uses the same object key so the
  download link is stable; `pdf_attempts`/`pdf_last_error` track retries.
- Retention: never auto-delete (legal record). Lifecycle rules off.

---

## 9. Monthly CSV export — query design

```sql
-- params: :month_start (e.g. '2026-04-01'), :month_end ('2026-05-01'), IST boundaries
SELECT
  i.invoice_number,
  to_char(i.invoice_date,'DD-MM-YYYY')                    AS invoice_date,
  i.financial_year,
  i.buyer_name, i.buyer_phone,
  COALESCE(i.buyer_gstin,'Unregistered')                  AS buyer_gstin,
  i.place_of_supply, i.supply_type,
  it.description, it.sac_code,
  round(i.taxable_value_paise/100.0, 2)                   AS taxable_value,
  round(i.cgst_paise/100.0, 2)                            AS cgst,
  round(i.sgst_paise/100.0, 2)                            AS sgst,
  round(i.igst_paise/100.0, 2)                            AS igst,
  round(i.total_paise/100.0, 2)                           AS total,
  i.razorpay_payment_id,
  to_char(i.service_period_start,'DD-MM-YYYY') || ' to ' ||
  to_char(i.service_period_end,'DD-MM-YYYY')              AS service_period
FROM public.invoices i
JOIN public.invoice_items it ON it.invoice_id = i.id
WHERE i.issued_at >= :month_start AND i.issued_at < :month_end
ORDER BY i.seq;          -- consecutive numbering within the export
```
Served by an admin-only route → streamed as CSV. (Indexes `idx_invoices_issued_at` supports the range.)

---

## 10. Provider invoice-history — query design

```sql
SELECT
  i.invoice_number,
  to_char(i.invoice_date,'DD-MM-YYYY')   AS invoice_date,
  i.plan_code,
  round(i.total_paise/100.0, 2)          AS total,
  i.pdf_status,
  to_char(i.service_period_start,'DD-MM-YYYY') || ' to ' ||
  to_char(i.service_period_end,'DD-MM-YYYY') AS service_period
FROM public.invoices i
WHERE i.provider_id = :provider_id
ORDER BY i.issued_at DESC;
```
Provider dashboard route resolves `:provider_id` from the session (never from client input), returns this
list, and mints a signed Storage URL per row when `pdf_status='generated'` (else shows "generating").
Uses `idx_invoices_provider_issued`.

---

## 11. Exact open risks before implementation

| # | Risk | Why it matters | Recommended resolution |
|---|------|----------------|------------------------|
| **R1** | ~~GST-exclusive pricing vs. fixed Razorpay capture.~~ | — | **✅ RESOLVED (2026-06-01).** Decision = option (b): Razorpay collects **base + 18% GST** (3658 / 11918 paise); the captured amount IS the invoice total; `taxable = base`. Requires the payment-logic change in §14. See the decision block at the top. |
| **R2** | **Rounding on FUTURE prices.** GST 18% on a base that isn't a multiple of ₹0.50 → fractional paise, and the CGST/SGST halving can leave a 1-paise residue. | Must satisfy `total = taxable + cgst + sgst` exactly (CHECK constraint). | **Not triggered by the current price list** (3100 & 10100 both give whole-paise GST and an even split). Still, fix the rule before adding any new plan: `gst = round(base × 0.18)`, `total = base + gst`; `sgst = floor(gst/2)`, `cgst = gst − sgst`. Encode in the issuance + order-amount code, not the PDF. |
| **R3** | **Buyer state unknown → place of supply / IGST.** No state on `providers`; city via `provider_areas`→`cities`. | Wrong CGST+SGST vs IGST split is a compliance error. | Today platform is Jodhpur-only ⇒ default `buyer_state_code='08'`, `supply_type='intra'`. Snapshot it on the invoice. Revisit when multi-state providers exist; until then the IGST path is unreachable-by-design. |
| **R4** | **Buyer GSTIN not captured before payment.** No field exists; "before payment" implies create-order/registration must collect it. | Determines B2B vs B2C invoice and ITC eligibility for the buyer. | Phase 1 adds `providers.gstin`; a UI capture step is a later phase. Default NULL → "Unregistered". |
| **R5** | **`business_name` is empty.** "Bill To" wants registered business name but the column is always NULL. | Invoices would show the personal `full_name`. | Snapshot `COALESCE(business_name, full_name)` now; backfill/collect `business_name` in a later UI phase. |
| **R6** | **Sequence gaps if allocation is done outside the issuance transaction.** | GST series should be consecutive. | Allocate **inside** the issuance transaction + check-existing-first (§5, §6). Do not pre-allocate. |
| **R7** | **Legacy paid orders / activation timing.** Immediate captures have a service period from `provider_plans`; `scheduled_paid_lower` activates later — when is its invoice dated/serviced? | Wrong service period on scheduled-plan invoices. | Phase-2 decision: invoice at capture with the *scheduled* future period, or at activation. Out of scope for schema; the columns support both. |
| **R8** | **Webhook is soft-fail.** Invoice issuance must never 5xx a captured payment. | A hard failure would trigger Razorpay retries / double work. | Phase 2 wraps issuance soft-fail (like `safeInvalidatePaymentCaches`) + an admin "paid orders missing invoice" backfill. |

---

## 12. Proposed SQL draft (consolidated — for review, NOT to be applied yet)

> This is the **draft** the eventual single Phase-1 migration would contain. It is presented here for
> review only. No migration file has been created.

```sql
-- ════════════ Phase 1: GST invoice + payment ledger schema (DRAFT — DO NOT APPLY) ════════════
-- Gated by application flag KK_INVOICE_LEDGER_ENABLED; tables are dormant until Phase 2 wires them.

-- 1. providers buyer fields
ALTER TABLE public.providers ADD COLUMN IF NOT EXISTS gstin TEXT;

-- 2. business_profile (seller, singleton)   [DDL as in §3.1]
-- 3. invoice_number_counters                [DDL as in §3.2]
-- 4. invoices                               [DDL as in §3.3]
-- 5. invoice_items                          [DDL as in §3.4]
-- 6. payment_ledger                         [DDL as in §3.5]
-- 7. invoice_audit_events                   [DDL as in §3.6]

-- 8. functions: kk_financial_year(), allocate_invoice_number()   [DDL as in §6]

-- 9. RLS
ALTER TABLE public.business_profile        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoice_number_counters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoices                ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoice_items           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_ledger          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoice_audit_events    ENABLE ROW LEVEL SECURITY;
-- (no policies → service-role only)

-- 10. seed seller profile
INSERT INTO public.business_profile
  (id, trade_name, legal_name, entity_description, gstin,
   address_line1, address_line2, city, state, state_code, pincode)
VALUES
  (true, 'KAUN KAREGA', 'Rishabh Rathi', 'A Proprietorship Concern of Rishabh Rathi',
   '08BYPHR6399K2ZD',
   '116, Gopi Kishan Vihar, Guru Ka Talab', 'Pratap Nagar', 'Jodhpur', 'Rajasthan', '08', '342003')
ON CONFLICT (id) DO NOTHING;
```
(The full `[DDL as in §X]` blocks are written out in sections 3 and 6 above — inline them verbatim when
the migration is actually authored.)

---

## 13. Recommended next implementation phase

**Phase 2 — "ledger write behind the flag" (no PDF, no production activation):**
1. **Apply the §14 payment-charge change** (Razorpay charges base + 18% GST; `amount_paise` = total) and
   its tests — this is the prerequisite that makes invoice total = captured amount. R1 is decided; R2
   rounding does not bite the current prices.
2. Author the single Phase-1 migration above (after the §12 draft is approved); apply to a dev/staging DB.
3. Implement the `issue_invoice_for_paid_order()` issuance function (check-first → allocate-in-txn →
   insert invoice + items + ledger + audit), idempotent on `payment_order_id`.
4. Call it **soft-fail** from the two post-`status='paid'` points in the webhook, gated by
   `KK_INVOICE_LEDGER_ENABLED` (default **off**). `pdf_status` stays `pending`.
5. Tests (idempotency, FY rollover, intra-state arithmetic, no-invoice-on-failed-branches).

**Phase 3** — PDF render job (separate) → Supabase Storage → admin retry/regenerate.
**Phase 4** — admin invoices list + monthly CSV export; provider dashboard invoice history.
**Phase 5** — backfill paid orders, flip the flag on, monitor.
**Later (only if needed)** — `credit_notes` (§3.7).

### Bottom line
The existing rails already give clean idempotency anchors (`event_id`, `razorpay_payment_id`,
`payment_order_id`) and a single capture seam (the webhook). Phase 1 is **purely additive**: six dormant
tables + two functions + one optional `providers.gstin` column, all flag-gated and service-role-only.
**R1 is now resolved** (Razorpay charges base + 18% GST; captured amount = invoice total), so the path is
unblocked — the remaining payment-charge change is scoped in §14.

---

## 14. Implementation notes for the base + 18% GST charge (R1 decision)

> Scope reminder: **NO code is changed in this doc.** This section tells the implementation phase exactly
> where to change things and what to assert. Order of operations: ship §14.1 (charge + UI + tests) first,
> *then* the schema migration (§12) and issuance (Phase 2), because invoice total = captured amount only
> holds once the charge includes GST.

### 14.1 Where the Razorpay order amount is calculated today

| Location | Current behaviour |
|---|---|
| [web/lib/payments/server.ts](../web/lib/payments/server.ts#L94) — `PLAN_PRICING` | `regions_5 → {amountPaise:3100}`, `all_jodhpur → {amountPaise:10100}`. These are **base** amounts. |
| [web/lib/payments/server.ts](../web/lib/payments/server.ts#L105) — `getPlanAmountPaise(planCode)` | Returns the base paise straight from `PLAN_PRICING`. |
| [web/app/api/payments/create-order/route.ts:360](../web/app/api/payments/create-order/route.ts#L360) | `const amountPaise = getPlanAmountPaise(planCode);` → passed to `createRazorpayOrder({ amountPaise })` (the amount Razorpay charges) **and** inserted into `payment_orders.amount_paise` ([L388–393](../web/app/api/payments/create-order/route.ts#L388)). |
| [web/lib/payments/server.ts](../web/lib/payments/server.ts#L164) — `createRazorpayOrder` | Sends `amount` to `https://api.razorpay.com/v1/orders` verbatim. No GST math. |
| [web/app/api/payments/webhook/route.ts:277](../web/app/api/payments/webhook/route.ts#L277) | Amount-match defense: `capturedAmount !== orderRow.amount_paise` → rejects. **This is why `amount_paise` must become the GST-inclusive total** — otherwise every captured payment would fail this check once Razorpay charges base+GST. |

**Net:** today exactly one number (the base) flows to both Razorpay and `payment_orders.amount_paise`.
After the change, the **total (base+GST)** must flow to both, while the **base** is retained as the
taxable value for the invoice.

### 14.2 Files that need to change later (implementation phase — not now)

**Server / pricing math**
1. [web/lib/payments/server.ts](../web/lib/payments/server.ts) — add a GST helper, e.g.
   `computePlanCharge(planCode): { basePaise, gstBps:1800, gstPaise, totalPaise }` with
   `gstPaise = round(basePaise × 0.18)`, `totalPaise = basePaise + gstPaise`. Keep `PLAN_PRICING` as the
   base source of truth. (Decide whether `getPlanAmountPaise` now returns total or is replaced by the new
   helper — prefer a new explicit helper to avoid silently changing existing callers.)
2. [web/app/api/payments/create-order/route.ts](../web/app/api/payments/create-order/route.ts) — charge
   the **total**: `createRazorpayOrder({ amountPaise: totalPaise })`; store `amount_paise = totalPaise`.
   Recommended: also persist the breakdown for the invoice (add additive columns
   `payment_orders.base_paise`, `gst_paise` — or rely on `taxable = total/1.18`, which is exact for the
   current list). Storing is safer than deriving.

**Payment UI (must show base + GST + total before payment)**
3. [web/components/provider/ProviderPlanCard.tsx](../web/components/provider/ProviderPlanCard.tsx) — the
   upgrade card that fetches `/api/payments/create-order` ([~L400](../web/components/provider/ProviderPlanCard.tsx#L400))
   and opens Razorpay ([~L586](../web/components/provider/ProviderPlanCard.tsx#L586)). Its price copy
   (the "business-friendly copy" block ~L75) must render the **base price, GST @18%, and total payable**.
4. [web/components/provider/PaymentTermsModal.tsx](../web/components/provider/PaymentTermsModal.tsx) — the
   pre-payment consent modal; show the same base/GST/total breakdown line here too.
5. [web/app/provider/register/page.tsx](../web/app/provider/register/page.tsx) — plan selection at
   registration; surface the GST-inclusive total wherever a plan price is shown.
6. [web/components/provider/ScheduledRegionPicker.tsx](../web/components/provider/ScheduledRegionPicker.tsx)
   — scheduled-downgrade flow that also leads to a paid order; keep its price display consistent.

**Source of the breakdown for the UI:** echo `base/gst/total` (and `gstBps`) in the `/api/payments/
create-order` response and/or expose a tiny read so the client never hard-codes amounts (keeps the
server as the single source of truth, consistent with the existing threat model).

### 14.3 Tests required (charge correctness)

**Unit — `computePlanCharge` / order amount (highest priority):**
- `regions_5` → `basePaise=3100`, `gstPaise=558`, **`totalPaise=3658`**.
- `all_jodhpur` → `basePaise=10100`, `gstPaise=1818`, **`totalPaise=11918`**.
- Intra-state split: `regions_5` → cgst=279, sgst=279 (sum=558); `all_jodhpur` → cgst=909, sgst=909
  (sum=1818). `cgst+sgst === gstPaise` and `taxable+gst === total` for both.

**Integration — create-order:**
- POST create-order for `regions_5` → the amount sent to `createRazorpayOrder` is **3658** and the
  inserted `payment_orders.amount_paise` is **3658** (not 3100).
- POST create-order for `all_jodhpur` → Razorpay amount and `amount_paise` are **11918** (not 10100).
- Mock the Razorpay REST call; assert the request body `amount` equals the total.

**Webhook compatibility (regression guard):**
- A `payment.captured` with `amount=3658` against an order whose `amount_paise=3658` **passes** the
  amount-match check ([webhook L277](../web/app/api/payments/webhook/route.ts#L277)) and activates the plan.
- A `payment.captured` with `amount=3100` against a `3658` order is **rejected** as `amountMismatch`
  (proves the defense still works and old base-only amounts can't sneak through).

**UI:**
- ProviderPlanCard / PaymentTermsModal render three lines — base ₹31.00, GST (18%) ₹5.58, total ₹36.58
  for `regions_5` (and ₹101.00 / ₹18.18 / ₹119.18 for `all_jodhpur`) before the Razorpay modal opens.
  Extend the existing flow spec [web/e2e/payments/provider-plan-card-flow.spec.ts](../web/e2e/payments/provider-plan-card-flow.spec.ts).

**Invoice reconciliation (Phase 2, once issuance exists):**
- For a captured `regions_5` order, the issued invoice has `taxable=3100, cgst=279, sgst=279,
  total=3658` and `total_paise === payment_orders.amount_paise === captured amount`.
