-- All Jodhpur search — Phase 1: provider_task_matches.match_scope.
--
-- Records the COVERAGE ORIGIN of each (task, provider) match row. This is
-- a third, independent dimension alongside the existing ones:
--   match_status → lifecycle (matched / notified / responded / ...)
--   matchTier    → match quality (category / work_tag / category_fallback)
--                  [computed at runtime; not persisted]
--   match_scope  → coverage origin (region / all_jodhpur)   ← THIS COLUMN
--
-- Intended semantics (writes added in a LATER phase, NOT here):
--   'region'      → matched via the selected region (local-region provider).
--   'all_jodhpur' → matched because the provider is on an active all_jodhpur
--                   plan (city-wide provider). For an all_jodhpur-scoped
--                   task, every match row is 'all_jodhpur'.
--   NULL          → legacy rows written before this column existed; UI
--                   coalesces NULL → 'region'.
--
-- Safety:
--   • Nullable, no DEFAULT — NULL means "unlabelled / legacy".
--   • No backfill (per spec) — historical rows stay NULL.
--   • CHECK allows NULL OR the two enum values; guarded by pg_constraint
--     lookup → second-run safe.
--   • ADD COLUMN IF NOT EXISTS → second-run safe.
--   • No UPDATE / DELETE / TRUNCATE / DROP.
--
-- Runtime compatibility: nothing reads or writes this column yet. The
-- matching routes' provider_task_matches upserts are unchanged until a
-- later phase adds match_scope to the written rows.

ALTER TABLE public.provider_task_matches
  ADD COLUMN IF NOT EXISTS match_scope text;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'provider_task_matches_match_scope_check'
       AND conrelid = 'public.provider_task_matches'::regclass
  ) THEN
    ALTER TABLE public.provider_task_matches
      ADD CONSTRAINT provider_task_matches_match_scope_check
      CHECK (match_scope IS NULL OR match_scope IN ('region', 'all_jodhpur'));
  END IF;
END $$;

COMMENT ON COLUMN public.provider_task_matches.match_scope IS
  'Coverage origin of the match: ''region'' (matched via selected region / local provider) or ''all_jodhpur'' (matched as an active city-wide provider). NULL = legacy/unlabelled (UI treats as region). Independent of match_status (lifecycle) and the runtime matchTier (quality). Written by matching in a later phase.';
