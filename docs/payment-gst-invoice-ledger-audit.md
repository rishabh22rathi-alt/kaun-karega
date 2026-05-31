# Audit: GST Invoice & Payment Ledger Support

**Scope:** Razorpay payment → provider plan activation → webhook flow, assessed for adding
GST invoice generation and a payment ledger. **No code was changed.**

**Date:** 2026-05-31
**Constraint honoured:** payment logic is left untouched; this is a read-only audit + plan.

---

## 1. Existing payment / order / webhook files

| File | Role |
|------|------|
| [web/app/api/payments/create-order/route.ts](../web/app/api/payments/create-order/route.ts) | Creates a Razorpay order, classifies the plan change, inserts a `payment_orders` row in status `created`. **Does NOT write `provider_plans`.** |
| [web/app/api/payments/webhook/route.ts](../web/app/api/payments/webhook/route.ts) | **Sole source of truth for activation.** Verifies HMAC, audits the event, flips `payment_orders.status='paid'`, upserts `provider_plans`. This is the only place a payment becomes "captured/verified." |
| [web/app/api/payments/verify/route.ts](../web/app/api/payments/verify/route.ts) | Verifies the checkout *redirect* signature only. Records `razorpay_payment_id` but **never grants the plan**. Not authoritative. |
| [web/lib/payments/server.ts](../web/lib/payments/server.ts) | Razorpay credentials, `PLAN_PRICING`, `createRazorpayOrder()`, `verifyWebhookSignature()`, `verifyCheckoutSignature()`. |
| [web/lib/payments/effectivePlan.ts](../web/lib/payments/effectivePlan.ts) | Resolves a `provider_plans` row → effective plan (free / active / expired / scheduled). |
| [web/lib/payments/planRank.ts](../web/lib/payments/planRank.ts) | `classifyPlanChange()` → `immediate_upgrade` / `immediate_renewal` / `scheduled_paid_lower` / `scheduled_free`. |
| [web/lib/payments/planRules.ts](../web/lib/payments/planRules.ts) | Fixed-region vs city-wide plan rules. |
| [web/app/api/admin/payments/recent/route.ts](../web/app/api/admin/payments/recent/route.ts) | Admin read-only support lookup over `payment_orders`. |

**Pricing (the taxable amounts):** `regions_5` = ₹31 (3100 paise), `all_jodhpur` = ₹101 (10100 paise),
30-day prepaid one-shot orders (no subscriptions). Free is implicit (no row).

---

## 2. Existing provider plan activation flow

```
create-order  ──insert payment_orders(status=created)──►  (no plan change)
       │
       ▼  Razorpay Checkout (provider pays)
Razorpay  ──payment.captured──►  webhook/route.ts
                                     │
            ┌────────────────────────┴─────────────────────────┐
            ▼                                                    ▼
  IMMEDIATE upgrade/renewal                          SCHEDULED_PAID_LOWER
  - upsert provider_plans                            - write provider_plans.scheduled_*
    (plan_code, max_regions,                         - write provider_scheduled_areas
     current_period_start/end = now+30d,             - status=paid
     last_payment_id)                                       │
  - status=paid                                             ▼
  - reconcileProviderCoverage()                   activate_scheduled_plan() RPC
                                                  (cron / admin-triggered, at period end)
```

Key invariant already enforced: **only the webhook writes `provider_plans`.** create-order and
verify are read-only with respect to plan state. This is the correct seam to hook invoice creation onto.

Activation support files: [web/lib/provider-plans/activateScheduledPlans.ts](../web/lib/provider-plans/activateScheduledPlans.ts),
[web/app/api/admin/provider-plans/activate-scheduled/route.ts](../web/app/api/admin/provider-plans/activate-scheduled/route.ts),
[web/app/api/cron/activate-scheduled-plans/route.ts](../web/app/api/cron/activate-scheduled-plans/route.ts),
RPC `activate_scheduled_plan()` in [supabase/migrations/20260606120100_phase_3_activate_scheduled_plan_function.sql](../supabase/migrations/20260606120100_phase_3_activate_scheduled_plan_function.sql).

---

## 3. Current tables involved

| Table | Migration | Relevant columns for invoicing |
|-------|-----------|--------------------------------|
| `payment_orders` | `20260523120000_payment_minimum.sql` | `order_id` (PK), `provider_id`, `plan_code`, `amount_paise`, `currency`, `status`, `razorpay_payment_id`, `paid_at`, `raw_webhook` |
| `provider_plans` | `20260523120000` (+ phase 1/2) | `provider_id` (PK), `plan_code`, `current_period_start/end`, `last_payment_id` |
| `payment_webhook_events` | `20260523120000` | `event_id` (unique-when-present), `event_type`, `razorpay_payment_id`, `signature_ok`, `raw_body` — the idempotency anchor |
| `providers` | created outside captured migrations | `provider_id` (PK, TEXT), `phone`, name fields — the invoice *buyer* identity |
| `provider_scheduled_areas`, `scheduled_plan_activations` | phase 3 | scheduled-plan plumbing only |

**Idempotency anchors that already exist (reuse these):**
- `uq_payment_orders_razorpay_payment_id` — unique-when-present on `razorpay_payment_id`.
- `uq_payment_webhook_events_event_id` — unique-when-present on `event_id` (catches Razorpay retries).
- `provider_plans` PK = `provider_id` makes plan upsert idempotent.

**No GST / invoice / tax / sequence / business-name infrastructure exists today.** Confirmed by
grep: every `gst|invoice|tax|hsn|sac` hit is coincidental (unrelated words). No `CREATE SEQUENCE`,
no invoice table, no GSTIN field anywhere.

---

## 4. Where invoice generation should happen

**Hook point: the `payment.captured` branch in [webhook/route.ts](../web/app/api/payments/webhook/route.ts), AFTER `payment_orders.status` is set to `paid`.**

Concretely, two correct insertion points (both *after* the existing paid-update succeeds, before the
`return`):
- Immediate path — after [line 630](../web/app/api/payments/webhook/route.ts#L630) (`status='paid'` update).
- Scheduled path — after [line 567](../web/app/api/payments/webhook/route.ts#L567) (`status='paid'` update).

Rationale:
- This is the only place a payment is **verified + captured** (signature-checked, amount-matched,
  order resolved). The invoice must generate *only* here, satisfying "only after verified
  successful/captured payment."
- `verify/route.ts` must NOT generate invoices — the redirect signature does not guarantee capture
  and can be replayed/abandoned.

**Critical separation (per your rule "keep PDF separate from ledger"):**

1. **Ledger write (synchronous, in the webhook transaction path):** allocate the invoice number +
   insert the `invoices` row. Must be idempotent and must never 500 a captured payment more than the
   existing retry contract allows.
2. **PDF render (asynchronous, out-of-band):** a separate job/route reads the committed `invoices`
   row and produces the PDF, then writes back `pdf_url` / `pdf_generated_at`. A PDF failure must
   **never** roll back or block plan activation.

> Note on amount semantics: today `amount_paise` is the **gross** charged amount (₹31 / ₹101).
> For GST you must decide whether this is tax-inclusive or tax-exclusive (see §10, Phase 0) and store
> `taxable_value`, `cgst`, `sgst`, `igst`, `total` as derived snapshots on the invoice — never recompute
> at PDF time.

---

## 5. Idempotency risks

The webhook is **at-least-once**; Razorpay retries up to 24h on any 5xx. Naive invoice creation would
double-issue. Specific risks:

| # | Risk | Mitigation |
|---|------|-----------|
| R1 | Webhook retry re-runs the captured branch → second invoice. | Today the retry is caught earlier by `payment_webhook_events.event_id` unique index ([line 169](../web/app/api/payments/webhook/route.ts#L169)) → returns 200 deduped *before reaching invoice code*. **But** a different `event_id` for the same payment (Razorpay can emit `order.paid` + `payment.captured`) would slip past. **Add a hard unique constraint** `invoices.payment_order_id UNIQUE` (and/or `razorpay_payment_id UNIQUE`) and treat `23505` as success. |
| R2 | `status` already `paid` short-circuit ([line 266](../web/app/api/payments/webhook/route.ts#L266)) returns before invoice code → an invoice could be **missed** if invoicing is added but the order was paid on a prior attempt that failed *after* the status flip. | Make invoice creation **independent** of the `status==paid` guard: a reconcile/backfill path keyed on "paid orders without an invoice." |
| R3 | Invoice-number allocation race: two concurrent captures grab the same sequential number. | Allocate the number via a **DB-side atomic sequence per financial year** (Postgres function with `FOR UPDATE` on a counter row, or a per-FY sequence), never in app code. |
| R4 | Partial write: invoice row inserted, then webhook 500s before responding → retry re-inserts. | Idempotent upsert on `payment_order_id`; the unique constraint makes the retry a no-op. |
| R5 | PDF job runs twice. | PDF step is idempotent on `invoice_id`; overwrite same object key; `pdf_generated_at` guard. |
| R6 | Amount mismatch / scheduled-region-deactivated branches return before `status='paid'`. | Those orders are deliberately *not* paid yet → **no invoice should be created** for them. Correct by construction if invoice creation sits after the paid-update. |

---

## 6. Required Supabase tables

Two new tables + one numbering mechanism. **Additive only — no changes to existing tables' write paths.**

### 6a. `invoice_number_counters` (sequential-by-financial-year)
```sql
CREATE TABLE public.invoice_number_counters (
  financial_year  TEXT PRIMARY KEY,          -- e.g. '2026-27' (Apr 1 – Mar 31, IST)
  last_seq        BIGINT NOT NULL DEFAULT 0,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
```
Allocation via a `SECURITY DEFINER` function that does
`INSERT ... ON CONFLICT (financial_year) DO UPDATE SET last_seq = last_seq + 1 RETURNING last_seq`
— atomic, gap-free per FY, race-safe (satisfies "sequential by financial year").

### 6b. `invoices` (the ledger — no PDF concerns here)
```sql
CREATE TABLE public.invoices (
  id                  BIGSERIAL PRIMARY KEY,
  invoice_number      TEXT NOT NULL UNIQUE,        -- e.g. 'KK/2026-27/000123'
  financial_year      TEXT NOT NULL,
  seq                 BIGINT NOT NULL,
  payment_order_id    TEXT NOT NULL UNIQUE         -- ◄ idempotency anchor (R1/R4)
                        REFERENCES public.payment_orders(order_id) ON DELETE RESTRICT,
  razorpay_payment_id TEXT UNIQUE,                 -- ◄ second idempotency anchor; links Razorpay↔invoice
  provider_id         TEXT NOT NULL REFERENCES public.providers(provider_id) ON DELETE RESTRICT,
  plan_code           TEXT NOT NULL,
  -- monetary snapshot (paise), frozen at issue time
  currency            TEXT NOT NULL DEFAULT 'INR',
  gross_paise         INTEGER NOT NULL,            -- = payment_orders.amount_paise
  taxable_value_paise INTEGER NOT NULL,
  cgst_paise          INTEGER NOT NULL DEFAULT 0,
  sgst_paise          INTEGER NOT NULL DEFAULT 0,
  igst_paise          INTEGER NOT NULL DEFAULT 0,
  total_paise         INTEGER NOT NULL,
  gst_rate_bps        INTEGER NOT NULL,            -- e.g. 1800 = 18%
  -- seller (platform) + buyer (provider) snapshots, frozen at issue
  seller_gstin        TEXT,
  seller_legal_name   TEXT,
  place_of_supply     TEXT,                        -- state code
  buyer_name          TEXT,
  buyer_phone         TEXT,
  buyer_gstin         TEXT,                        -- usually NULL (B2C unregistered)
  hsn_sac             TEXT,                        -- SAC for the service
  issued_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- PDF lifecycle (written by the SEPARATE async job; nullable at insert)
  pdf_url             TEXT,
  pdf_generated_at    TIMESTAMPTZ,
  pdf_status          TEXT NOT NULL DEFAULT 'pending'
                        CHECK (pdf_status IN ('pending','generated','failed'))
);
CREATE INDEX idx_invoices_provider ON public.invoices(provider_id, issued_at DESC);
CREATE INDEX idx_invoices_pdf_pending ON public.invoices(pdf_status) WHERE pdf_status <> 'generated';
-- RLS enabled, service-role only, matching the other payment tables.
```

Design notes:
- `payment_order_id UNIQUE` + `razorpay_payment_id UNIQUE` are the **hard** idempotency guarantees
  (R1/R4) and the explicit **Razorpay↔invoice link** you required.
- All monetary + party fields are **frozen snapshots** — the PDF must render from these, not re-derive,
  so a later price change never alters an issued invoice.
- PDF fields are nullable and updated out-of-band → ledger and PDF are decoupled.

(Optional later: a `payment_ledger` table for double-entry-style movements if you want a true ledger
beyond invoices. Not required for GST invoices; flagged for §10 Phase 4.)

---

## 7. Required admin UI changes

Builds on the existing admin payment surface ([web/app/api/admin/payments/recent/route.ts](../web/app/api/admin/payments/recent/route.ts) → Payment Support accordion on `/admin/dashboard`).

1. **Invoices list / search** — new read-only admin route + tab: search by `invoice_number`,
   `provider_id`, `razorpay_payment_id`, phone; show issue date, FY, amounts, GST split, PDF status.
2. **Per-order invoice link** — in the existing recent-payments view, surface the linked invoice
   number + a "Download PDF" / "Regenerate PDF" action (regenerate = re-run the async PDF job only;
   never re-allocate a number).
3. **Backfill / reconcile control** — "paid orders missing an invoice" list with a one-click issue
   action (covers R2 and historical paid orders).
4. **Counter visibility** — read-only display of `invoice_number_counters` per FY for audit.
5. **No edit of issued invoices** — admin can regenerate PDF and (rarely) issue a credit note in a
   later phase, but the `invoices` monetary/number fields are immutable in the UI.

---

## 8. Required provider UI changes

Builds on [web/components/provider/ProviderPlanCard.tsx](../web/components/provider/ProviderPlanCard.tsx) and `/api/provider/plan`.

1. **"Billing / Invoices" section** on the provider dashboard: list of the provider's invoices
   (date, plan, amount, GST total, Download PDF).
2. **New read-only endpoint** `GET /api/provider/invoices` returning only the caller's own invoices
   (RLS/service-role-filtered by resolved `provider_id`, mirroring existing provider endpoints).
3. **Download link** points at `pdf_url`; if `pdf_status='pending'`, show "Invoice is being generated"
   rather than a broken link.
4. **Optional GSTIN capture** at registration/profile (for the rare GST-registered provider) so
   `buyer_gstin` / `place_of_supply` can be populated — default B2C unregistered if absent.

---

## 9. Required tests

**Idempotency (highest priority):**
- Same `payment.captured` delivered twice → exactly **one** invoice (event_id dedup + `payment_order_id` unique).
- Two *different* event types for the same payment (`order.paid` then `payment.captured`) → one invoice (R1).
- Concurrent captures of two different orders → two **distinct, gap-free** sequential numbers (R3).
- Webhook 500 after invoice insert, then retry → no duplicate (R4).

**Correctness:**
- Invoice created only after `status='paid'` (amount-mismatch / bad-signature / scheduled-region-deactivated branches → **no** invoice).
- Invoice number format `KK/<FY>/<zero-padded seq>`; FY boundary crossing 31-Mar→1-Apr IST resets seq to 1 in the new FY.
- Monetary snapshot: `gross = taxable + cgst + sgst + igst`; intra-state → CGST+SGST, inter-state → IGST.
- `razorpay_payment_id` and `payment_order_id` on the invoice match the order/webhook payload (link integrity).

**Separation:**
- Ledger row exists and is queryable even when PDF job hasn't run (`pdf_status='pending'`).
- PDF job failure does not roll back the invoice or the plan activation.
- PDF regenerate produces same content, does not change `invoice_number`.

**Access control:**
- Provider invoices endpoint returns only the caller's invoices (cross-provider access test, mirroring
  [web/e2e/security/provider-cross-access.spec.ts](../web/e2e/security/provider-cross-access.spec.ts)).

**Backfill:** reconcile path issues invoices for pre-existing paid orders without duplicating any.

---

## 10. Safe phased implementation plan

Each phase is independently shippable, additive, and behind a flag where it touches the webhook.
**Payment logic itself is never modified — only an additive, soft-failing hook is added.**

**Phase 0 — Decide GST treatment (no code).**
Confirm: Is ₹31/₹101 tax-inclusive or exclusive? Platform GSTIN, legal name, SAC code, place of supply.
This determines the arithmetic frozen into every invoice. Block all later phases on this.

**Phase 1 — Schema only (zero behaviour change).**
Add `invoice_number_counters`, `invoices`, the allocation function, RLS, indexes. No app reads/writes
yet. Mirrors how `20260604120000_..._phase_1.sql` introduced scheduled columns dormant.

**Phase 2 — Ledger write behind a flag (`KK_INVOICING_ENABLED`, default off).**
Add an idempotent `createInvoiceForPaidOrder(orderId)` helper. Call it from the webhook's two
post-`status='paid'` points, wrapped **soft-fail** (like `safeInvalidatePaymentCaches` /
`reconcileProviderCoverage` already are) so an invoice failure never 5xxs a captured payment beyond the
existing retry contract. Unique constraints make retries no-ops. PDF not built yet (`pdf_status='pending'`).

**Phase 3 — PDF generation, fully decoupled.**
Separate async route/job consuming `pdf_status='pending'` rows → render → upload → write
`pdf_url`/`pdf_status='generated'`. Idempotent on `invoice_id`. No coupling to the webhook.

**Phase 4 — Admin + provider UI.**
Admin invoices list/search/backfill/regenerate; provider billing section + `GET /api/provider/invoices`.

**Phase 5 — Backfill & enable.**
Run reconcile to issue invoices for existing paid orders; flip `KK_INVOICING_ENABLED=true`; monitor
`payment_webhook_events` + the "paid orders missing invoice" admin list for drift.

**(Optional) Phase 6 — true payment ledger / credit notes** if double-entry accounting or refunds are
needed later.

---

### One-line bottom line
The architecture is already invoice-friendly: the webhook is the single, signature-verified,
amount-checked capture point, and idempotency anchors (`event_id`, `razorpay_payment_id`) already
exist. Add two additive tables + an atomic per-FY number allocator, hook an **idempotent, soft-fail
ledger write** into the two post-`status='paid'` points in the webhook, and render PDFs in a
completely separate async job. No payment logic needs to change.
