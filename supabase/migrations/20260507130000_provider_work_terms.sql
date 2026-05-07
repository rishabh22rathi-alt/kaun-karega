-- Provider-specific work-term selections.
--
-- Until now, tapping a live (already-approved) work-tag chip on the provider
-- dashboard was session-only — there was no place to record "this provider
-- self-identifies with this alias." This migration adds the minimal mapping
-- table.
--
-- Semantics:
--   provider_id                 — the provider claiming the term
--   alias                       — the user-typed string (case preserved for
--                                 display, dedupe via UNIQUE(provider_id, lower(alias)))
--   canonical_category          — denormalized so reads do not need to join
--                                 category_aliases; matches the provider's
--                                 selected service category
--   created_at                  — when the provider tapped the chip
--
-- This table is for *display / preference* tracking. It does NOT alter
-- search or matching today; resolveCategoryAlias still resolves
-- canonical-by-alias against category_aliases globally. A future ranking
-- enhancement could give providers who tag a matching term a slight
-- relevance boost; that is out of scope for this migration.

CREATE TABLE IF NOT EXISTS public.provider_work_terms (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id         text NOT NULL,
  alias               text NOT NULL,
  canonical_category  text NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now()
);

-- Same-provider duplicates are blocked case-insensitively. We index lower(alias)
-- for the provider scope rather than relying on a UNIQUE expression-index
-- across all rows, because two different providers may legitimately claim
-- the same alias.
CREATE UNIQUE INDEX IF NOT EXISTS uq_provider_work_terms_provider_alias_lower
  ON public.provider_work_terms (provider_id, lower(alias));

CREATE INDEX IF NOT EXISTS idx_provider_work_terms_provider
  ON public.provider_work_terms (provider_id);

CREATE INDEX IF NOT EXISTS idx_provider_work_terms_alias_lower
  ON public.provider_work_terms (lower(alias));

COMMENT ON TABLE public.provider_work_terms IS
  'Per-provider preference: which already-approved aliases the provider has tapped to claim. Feeds the dashboard chip pre-selection. Does not alter search/matching.';
