-- 20260527120200_service_region_areas_add_city_code.sql
--
-- Phase 1.0 — Catalog table. Adds city_code to service_region_areas,
-- backfills via JOIN through service_regions (which was backfilled by
-- the immediately-preceding migration), adds the FK to cities, and
-- sets NOT NULL immediately.
--
-- The backfill uses a JOIN rather than a literal 'JOD' so the
-- statement remains semantically correct in any future world where
-- multiple cities exist. Today every join row resolves to 'JOD'
-- because every parent service_regions row was backfilled to 'JOD'.
--
-- ──────────────────────────────────────────────────────────────────────
-- Safety posture
-- ──────────────────────────────────────────────────────────────────────
--   • ADD COLUMN IF NOT EXISTS — second-run safe.
--   • UPDATE WHERE city_code IS NULL — second-run safe.
--   • FK add via DO $$ block — second-run safe.
--   • SET NOT NULL guarded by pre-check — loud failure if any row
--     remains NULL.
--   • No DROP, no DELETE/TRUNCATE.
--   • FK uses default NO ACTION.
--
-- Dependency: this migration assumes
-- 20260527120100_service_regions_add_city_code.sql ran first and
-- left service_regions.city_code populated. If applied out of
-- order, the backfill JOIN finds no rows to update and the SET
-- NOT NULL guard raises a clear error.
--
-- ──────────────────────────────────────────────────────────────────────
-- Rollback posture
-- ──────────────────────────────────────────────────────────────────────
--   No DOWN migration. Supersession only.
-- ──────────────────────────────────────────────────────────────────────


ALTER TABLE public.service_region_areas
  ADD COLUMN IF NOT EXISTS city_code TEXT;


-- Backfill via JOIN through the parent region. Semantically
-- correct under any future city distribution.
UPDATE public.service_region_areas sra
  SET city_code = sr.city_code
  FROM public.service_regions sr
  WHERE sra.region_code = sr.region_code
    AND sra.city_code IS NULL;


DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'service_region_areas_city_code_fkey'
      AND conrelid = 'public.service_region_areas'::regclass
  ) THEN
    ALTER TABLE public.service_region_areas
      ADD CONSTRAINT service_region_areas_city_code_fkey
      FOREIGN KEY (city_code) REFERENCES public.cities(city_code);
  END IF;
END $$;


DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM public.service_region_areas WHERE city_code IS NULL
  ) THEN
    RAISE EXCEPTION
      'service_region_areas has rows with NULL city_code after backfill — '
      'SET NOT NULL aborted. Confirm parent service_regions migration ran.';
  END IF;
  ALTER TABLE public.service_region_areas
    ALTER COLUMN city_code SET NOT NULL;
END $$;
