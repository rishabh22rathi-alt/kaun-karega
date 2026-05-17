-- Provider approval reconciliation: schema reconciliation + one-shot backfill.
--
-- Background
-- ----------
-- The previous code-only fix (web/lib/admin/adminProviderApprovalReconcile.ts)
-- relies on `pending_category_requests.provider_id` to find each provider's
-- open queue items. That column was missing from the live schema — runtime
-- code (adminProviderReview.ts, adminCategoryMutations.ts, the new
-- reconcile helper) had been quietly failing or returning empty against it.
--
-- This migration brings the live schema up to what the runtime expects:
--   Step 1: Add `provider_id` text column (idempotent).
--   Step 2: Backfill it from providers.phone via last-10-digit normalization
--           (handles 10-digit and 91-prefixed forms identically).
--   Step 3: Index for the per-provider queue lookups.
--   Step 4: One-shot backfill of providers.status = 'active' for providers
--           who no longer have any open queue items across all three queues.
--
-- Idempotent end-to-end. Safe to re-run.
--
-- providers.verified is deliberately NOT touched. Lifecycle of `verified`
-- is owned by registration + the duplicate-name helpers in
-- adminProviderMutations.ts. The reconcile contract is "status only".
--
-- Duplicate-name lifecycle exclusion: providers with
-- duplicate_name_review_status='pending' are skipped — the duplicate-name
-- approve/reject helpers own their status transitions and we must not
-- race them.

-- ───────────────────────────────────────────────────────────────────
-- 1. Add provider_id column to pending_category_requests
-- ───────────────────────────────────────────────────────────────────
--
-- text to match providers.provider_id and the existing
-- category_aliases.submitted_by_provider_id / area_review_queue.source_ref
-- conventions. No FK constraint — keeping it lax mirrors how
-- submitted_by_provider_id and source_ref are stored, and avoids
-- ON DELETE CASCADE side effects when a provider row is hard-deleted
-- in admin tooling.

alter table public.pending_category_requests
  add column if not exists provider_id text;

-- ───────────────────────────────────────────────────────────────────
-- 2. Backfill provider_id from providers.phone via last-10-digit match
-- ───────────────────────────────────────────────────────────────────
--
-- providers.phone is historically stored as either 10-digit
-- ("9876543210") or 91-prefixed ("919876543210"). user_phone on the
-- request table can also be either form. Normalize both sides to the
-- last 10 digits (strip non-digits with regexp_replace, then take the
-- right-most 10) so equivalent phones in either form collapse to the
-- same key.
--
-- DISTINCT ON (last10) defends against the (rare) case where two
-- providers rows share the same last-10-digit phone — newest provider
-- wins (ORDER BY created_at DESC). providers.phone has a unique
-- constraint so collisions only occur if one row was stored as 10-digit
-- and another as 91-prefixed for the same person.
--
-- The WHERE clause restricts to rows where:
--   * pcr.provider_id is still NULL (idempotent — don't overwrite
--     anything an admin or future code path has explicitly set).
--   * The user_phone normalizes to a valid 10-digit identity.
--   * The provider's phone also normalizes to a valid 10-digit
--     identity. Length-guard prevents two empty strings from
--     matching each other.

update public.pending_category_requests pcr
set provider_id = matched.provider_id
from (
  select distinct on (last10)
    right(regexp_replace(coalesce(p.phone, ''), '\D', '', 'g'), 10) as last10,
    p.provider_id
  from public.providers p
  where length(regexp_replace(coalesce(p.phone, ''), '\D', '', 'g')) >= 10
  order by last10, p.created_at desc
) matched
where pcr.provider_id is null
  and length(regexp_replace(coalesce(pcr.user_phone, ''), '\D', '', 'g')) >= 10
  and right(regexp_replace(coalesce(pcr.user_phone, ''), '\D', '', 'g'), 10) = matched.last10;

-- ───────────────────────────────────────────────────────────────────
-- 3. Partial index on provider_id
-- ───────────────────────────────────────────────────────────────────
--
-- Used by:
--   * adminProviderApprovalReconcile.ts head-only count query
--   * adminProviderReview.buildProvidersUnderReview list query
--   * adminCategoryMutations.fetchRequestRow lookup variants
--
-- Partial because rows pre-dating this migration that the backfill
-- couldn't match (e.g. user_phone shape we don't recognize) stay NULL
-- and shouldn't bloat the index.

create index if not exists idx_pending_category_requests_provider_id
  on public.pending_category_requests (provider_id)
  where provider_id is not null;

-- ───────────────────────────────────────────────────────────────────
-- 4. Reconcile providers stuck in status='pending' with no open items
-- ───────────────────────────────────────────────────────────────────
--
-- Idempotent: the WHERE clause's `status='pending'` predicate makes
-- re-runs no-ops for already-flipped rows. The three NOT EXISTS
-- predicates mirror the runtime reconcile rules in
-- web/lib/admin/adminProviderApprovalReconcile.ts so SQL and code agree.

update public.providers p
set status = 'active'
where p.status = 'pending'
  and (
    p.duplicate_name_review_status is null
    or lower(p.duplicate_name_review_status) <> 'pending'
  )
  and not exists (
    select 1
    from public.pending_category_requests pcr
    where pcr.provider_id = p.provider_id
      and pcr.status = 'pending'
  )
  and not exists (
    select 1
    from public.category_aliases ca
    where ca.submitted_by_provider_id = p.provider_id
      and ca.active = false
  )
  and not exists (
    select 1
    from public.area_review_queue arq
    where arq.source_ref = p.provider_id
      and arq.status = 'pending'
      and arq.source_type in ('provider_register', 'provider_update')
  );
