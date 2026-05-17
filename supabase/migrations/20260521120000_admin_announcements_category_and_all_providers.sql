-- Phase 7C Step 1: schema-only prep for provider-category + all-providers
-- announcements. No code path actually sends to these audiences yet —
-- the store's QUEUE_ALLOWED_AUDIENCES set and the worker's audience
-- hard-block both still admit only 'admins' in this migration's
-- companion code change.
--
-- Behavior reachable AFTER this migration:
--   • Admins can save drafts with target_audience IN ('provider_category',
--     'providers_all').
--   • Recipient preview returns audience-appropriate counts.
--   • Queue Send still rejects both new audiences with
--     AUDIENCE_NOT_ALLOWED (gated in lib/announcements/store.ts).
--   • Worker still rejects both with audience_not_allowed_phase_7c
--     (gated in lib/announcements/worker.ts).
--
-- To unlock provider_category sending (Phase 7C Step 6/7), the
-- following must change in lockstep:
--   1. Add 'provider_category' to QUEUE_ALLOWED_AUDIENCES in store.ts
--   2. Extend the worker's audience hard-block to allow it
--   3. Add a UI feature flag in AnnouncementsList if desired
--
-- providers_all unlocks separately and requires the same three-place
-- change plus the ANNOUNCEMENT_PROVIDERS_ALL_ENABLED env gate.

-- 1) Widen target_audience CHECK to include both new buckets.
alter table public.admin_announcements
  drop constraint if exists admin_announcements_target_audience_check;
alter table public.admin_announcements
  add constraint admin_announcements_target_audience_check
  check (target_audience in (
    'all',
    'users',
    'providers',
    'admins',
    'provider_category',
    'providers_all'
  ));

-- 2) Add target_category column. Stores the canonical
--    categories.name string (NOT an id, NOT a slug — codebase has no
--    surrogate category id used as a join key anywhere). NULL for
--    every audience except 'provider_category'.
alter table public.admin_announcements
  add column if not exists target_category text null
    check (
      target_category is null
      or char_length(target_category) between 1 and 120
    );

-- 3) Cross-column consistency CHECK. Enforces the discriminator
--    contract at the DB layer so a buggy code path or direct SQL
--    INSERT cannot create an inconsistent row:
--      target_audience='provider_category' ⇒ target_category IS NOT NULL
--      otherwise                            ⇒ target_category IS NULL
alter table public.admin_announcements
  add constraint admin_announcements_target_category_consistency
  check (
    (target_audience = 'provider_category' and target_category is not null)
    or
    (target_audience <> 'provider_category' and target_category is null)
  );

-- 4) Helpful index for future analytics drill-down by category.
--    Partial so the index stays small — most rows will be NULL.
create index if not exists idx_admin_announcements_target_category
  on public.admin_announcements (target_category)
  where target_category is not null;

comment on column public.admin_announcements.target_category is
  'Canonical categories.name string when target_audience=''provider_category''. NULL for every other audience (enforced by admin_announcements_target_category_consistency CHECK). Phase 7C.';
