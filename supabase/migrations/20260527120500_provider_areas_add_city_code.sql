-- 20260527120500_provider_areas_add_city_code.sql
--
-- Phase 1.0 — RUNTIME table. Adds city_code to provider_areas,
-- backfills every existing row to 'JOD', adds the FK to cities.
-- Deliberately LEAVES THE COLUMN NULLABLE.
--
-- ──────────────────────────────────────────────────────────────────────
-- Why NOT NULL is deferred to Phase 1.5
-- ──────────────────────────────────────────────────────────────────────
--   provider_areas is rewritten on every provider register / update
--   and by the 5-minute canonicalization job
--   (web/lib/admin/adminAreaMappings.ts:144-251). The canonicalization
--   job currently does delete-then-insert of (provider_id, area)
--   rows — it does NOT write city_code. Setting NOT NULL now would
--   break the next canonicalization run.
--
--   The deferred NOT NULL is gated by:
--     1. Phase 1.2 patches the canonicalization job to preserve
--        city_code on the rewrite path.
--     2. Phase 1.2 patches every other insert site to write
--        city_code.
--     3. Phase 1.5 reconcile migration adds NOT NULL after a sample
--        query confirms ≥99% of new rows arrive non-NULL.
--
-- ──────────────────────────────────────────────────────────────────────
-- Safety posture
-- ──────────────────────────────────────────────────────────────────────
--   • ADD COLUMN IF NOT EXISTS — second-run safe.
--   • UPDATE WHERE city_code IS NULL — second-run safe.
--   • FK add via DO $$ block — second-run safe.
--   • NO SET NOT NULL.
--   • No DROP, no DELETE/TRUNCATE.
--   • FK uses default NO ACTION on update/delete.
--
-- ──────────────────────────────────────────────────────────────────────
-- Runtime compatibility
-- ──────────────────────────────────────────────────────────────────────
--   Matching path is untouched. Until Phase 1.3 introduces the
--   soft-filter, provider_areas.city_code is captured but ignored
--   at match time. The 5-minute canonicalization job continues to
--   work with rows whose city_code may be NULL or 'JOD'.
--
-- ──────────────────────────────────────────────────────────────────────
-- Rollback posture
-- ──────────────────────────────────────────────────────────────────────
--   No DOWN migration. Supersession only.
-- ──────────────────────────────────────────────────────────────────────


ALTER TABLE public.provider_areas
  ADD COLUMN IF NOT EXISTS city_code TEXT;


-- Backfill: every existing provider coverage row is in Jodhpur
-- today by virtue of JOD being the only active city.
UPDATE public.provider_areas
  SET city_code = 'JOD'
  WHERE city_code IS NULL;


DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'provider_areas_city_code_fkey'
      AND conrelid = 'public.provider_areas'::regclass
  ) THEN
    ALTER TABLE public.provider_areas
      ADD CONSTRAINT provider_areas_city_code_fkey
      FOREIGN KEY (city_code) REFERENCES public.cities(city_code);
  END IF;
END $$;


-- NOT NULL deliberately NOT set. See preamble for rationale.
