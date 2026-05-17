-- Stage 1: payment rails schema (no application code reads or writes
-- these tables yet). Three tables introduced:
--
--   provider_plans          — current plan state, one row per provider.
--                             Source of truth for "what plan is this
--                             provider on right now".
--   payment_orders          — Razorpay order ledger. Append on order
--                             creation; status mutates only on webhook.
--   payment_webhook_events  — append-only audit log of every webhook
--                             POST received, regardless of signature
--                             validity. Lets us debug "why didn't this
--                             provider get upgraded" without trusting
--                             payment_orders.raw_webhook alone.
--
-- Service-role only access. No policies are attached — same pattern as
-- push_logs, native_push_devices, notification_preferences, and the
-- admin_announcement family of tables.
--
-- This migration is purely additive. Existing flows are unaffected.
-- Application behavior changes only when later stages wire routes.

-- ───────────────────────────────────────────────────────────────────
-- 1. provider_plans — one row per provider, current state
-- ───────────────────────────────────────────────────────────────────
--
-- Absence of a row is treated as the implicit Free plan by the read
-- helper. Do NOT auto-insert a row on provider registration — the
-- absence check is cheaper than maintaining a default row per
-- provider, and avoids a chicken-and-egg with the providers FK during
-- the partial-failure rollback in /api/kk action=provider_register.
--
-- max_regions is the enforcement primitive. Free=1, ₹31 plan=5,
-- ₹101 plan=99 (covers all of Jodhpur for the foreseeable future).
-- Hardcoding 99 keeps the schema flexible if "Full Jodhpur" grows.
--
-- current_period_end semantics:
--   NULL  → plan never expires (only used for the implicit free path;
--           paid plans always set an explicit expiry)
--   > now → plan is currently active
--   ≤ now → plan has expired; the read helper falls back to free
--
-- last_payment_id is a denormalized convenience pointer to the most
-- recent successful razorpay_payment_id for this provider — saves a
-- join when the dashboard wants to deep-link to the Razorpay receipt.

create table if not exists public.provider_plans (
  provider_id text primary key
    references public.providers(provider_id) on delete cascade,
  plan_code text not null default 'free',
  max_regions integer not null default 1
    check (max_regions >= 1),
  current_period_start timestamptz null,
  current_period_end timestamptz null,
  last_payment_id text null,
  updated_at timestamptz not null default now()
);

-- Expiry-scan index. The matching pipeline and any future "expiring
-- soon" reminder job both scan by current_period_end. Partial index
-- skips the implicit-NULL rows that would never need expiry handling.
create index if not exists idx_provider_plans_current_period_end
  on public.provider_plans (current_period_end)
  where current_period_end is not null;

alter table public.provider_plans enable row level security;
-- No policies — service-role admin client only. Same pattern as
-- push_logs, native_push_devices, notification_preferences.

-- ───────────────────────────────────────────────────────────────────
-- 2. payment_orders — Razorpay order ledger
-- ───────────────────────────────────────────────────────────────────
--
-- Append on order creation (status='created'). The webhook flips
-- status to 'paid' or 'failed'. A single order_id never produces two
-- rows — Razorpay order_id is the PK.
--
-- razorpay_payment_id is the payment-level identifier (one order can
-- in theory produce multiple payment attempts; we only persist the
-- captured one). The partial-unique index below provides webhook
-- idempotency: a duplicate captured-event with the same payment_id
-- is caught at the DB layer.
--
-- ON DELETE RESTRICT on the provider FK because losing the
-- order ledger when a provider is deleted is unacceptable for
-- financial audit. If a provider must be hard-deleted, the orders
-- must be deleted explicitly first.

create table if not exists public.payment_orders (
  order_id text primary key,
  provider_id text not null
    references public.providers(provider_id) on delete restrict,
  plan_code text not null,
  amount_paise integer not null
    check (amount_paise > 0),
  currency text not null default 'INR'
    check (char_length(currency) = 3),
  status text not null default 'created'
    check (status in ('created', 'paid', 'failed')),
  razorpay_payment_id text null,
  razorpay_signature text null,
  created_at timestamptz not null default now(),
  paid_at timestamptz null,
  raw_webhook jsonb null
);

-- Idempotency guard: at most one payment_orders row per captured
-- razorpay_payment_id. Webhook handler can rely on a 23505 conflict
-- to detect duplicate-capture replays without an explicit pre-check.
-- Partial because razorpay_payment_id is null until the first
-- captured webhook arrives.
create unique index if not exists uq_payment_orders_razorpay_payment_id
  on public.payment_orders (razorpay_payment_id)
  where razorpay_payment_id is not null;

-- Provider dashboard reads "my recent orders" filtered by status.
create index if not exists idx_payment_orders_provider_status_created
  on public.payment_orders (provider_id, status, created_at desc);

-- Admin / debugging reads ordered by recency.
create index if not exists idx_payment_orders_created_at
  on public.payment_orders (created_at desc);

alter table public.payment_orders enable row level security;
-- No policies — service-role admin client only.

-- ───────────────────────────────────────────────────────────────────
-- 3. payment_webhook_events — append-only webhook audit log
-- ───────────────────────────────────────────────────────────────────
--
-- Every webhook POST received is logged here regardless of signature
-- validity (signature_ok captures the result of HMAC verification).
-- Reasons to keep failed-signature attempts:
--   1. Detect a leaked webhook secret or replay attempts.
--   2. Diagnose a misconfigured Razorpay dashboard webhook (wrong
--      URL, missing secret, etc.) without losing the body.
--
-- event_id is Razorpay's per-event identifier. Unique-when-present
-- ensures Razorpay's at-least-once retry policy (up to 24h of
-- retries on non-200) never double-inserts the same event.
--
-- raw_body stores the parsed JSON for audit. The raw bytes are NOT
-- retained — signature verification at the route handler hashes the
-- exact bytes received before this row is written, so the parsed
-- shape is sufficient for downstream diagnostics.

create table if not exists public.payment_webhook_events (
  id bigserial primary key,
  event_id text null,
  event_type text not null,
  order_id text null,
  razorpay_payment_id text null,
  signature_ok boolean not null,
  raw_body jsonb not null,
  created_at timestamptz not null default now()
);

-- Idempotency for Razorpay's retry policy. Partial because Razorpay
-- may legitimately deliver events without an `id` field in some
-- shapes (test-mode events historically); those skip the dedup.
create unique index if not exists uq_payment_webhook_events_event_id
  on public.payment_webhook_events (event_id)
  where event_id is not null;

-- Diagnostic read pattern: recent events ordered by time.
create index if not exists idx_payment_webhook_events_created_at
  on public.payment_webhook_events (created_at desc);

-- "Did we receive a webhook for this order?" — used during webhook-
-- delay reconciliation.
create index if not exists idx_payment_webhook_events_order_id
  on public.payment_webhook_events (order_id)
  where order_id is not null;

alter table public.payment_webhook_events enable row level security;
-- No policies — service-role admin client only.

-- ───────────────────────────────────────────────────────────────────
-- 4. Doc comments
-- ───────────────────────────────────────────────────────────────────

comment on table public.provider_plans is
  'Stage 1 payment schema: current plan state per provider. Absence of a row is the implicit Free plan (max_regions=1). Paid plans are written by the Razorpay webhook handler. Read by the effectivePlan() helper for both UI display and enforcement.';

comment on column public.provider_plans.plan_code is
  'Free-text plan identifier. Known values today: ''free'', ''regions_5'' (₹31), ''all_jodhpur'' (₹101). Free-text not enum so adding plans does not require a migration.';

comment on column public.provider_plans.max_regions is
  'Enforcement primitive. Edit/registration paths reject saves that exceed this. Matching reads the first max_regions provider_areas rows (by deterministic order) and only emits leads for areas inside that window.';

comment on column public.provider_plans.current_period_end is
  'Plan expiry. NULL = never expires (used for implicit free state only; paid plans always set this). When ≤ now(), the effective plan reverts to free without mutating this row — preserves the audit trail of "what they paid for last".';

comment on column public.provider_plans.last_payment_id is
  'Denormalized pointer to the most recent successful razorpay_payment_id. Saves a join when the dashboard wants a "view receipt" link.';

comment on table public.payment_orders is
  'Razorpay order ledger. Append on order creation (status=created). Status mutates only by the webhook handler. razorpay_payment_id is unique-when-present to make duplicate-capture replays a 23505 at the DB layer.';

comment on column public.payment_orders.amount_paise is
  'Amount in paise (₹1 = 100 paise). Server-derived from a hardcoded plan_code → amount map — never accepted from client input.';

comment on column public.payment_orders.status is
  'Lifecycle: created → paid (on payment.captured) or created → failed (on payment.failed). Terminal in both ''paid'' and ''failed''. The verify-redirect endpoint never advances this — only the webhook does.';

comment on column public.payment_orders.raw_webhook is
  'Last successful webhook payload that touched this order. Diagnostic only; the canonical audit lives in payment_webhook_events.';

comment on table public.payment_webhook_events is
  'Append-only webhook audit log. Every POST is recorded regardless of signature_ok so misconfigured-secret diagnostics and replay-attempt detection both have data. event_id unique-when-present provides Razorpay-retry idempotency.';

comment on column public.payment_webhook_events.signature_ok is
  'Result of HMAC-SHA256 verification against RAZORPAY_WEBHOOK_SECRET. Rows with signature_ok=false MUST NOT influence any plan state — they exist only for diagnostics and abuse detection.';
