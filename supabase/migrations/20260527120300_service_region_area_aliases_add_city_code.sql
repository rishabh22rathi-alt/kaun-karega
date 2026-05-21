-- 20260527120300_service_region_area_aliases_add_city_code.sql
--
-- Phase 1.0 — Catalog table. Adds city_code to
-- service_region_area_aliases, backfills via JOIN through
-- service_regions, adds the FK to cities, and sets NOT NULL
-- immediately.
--
-- Aliases denormalize region_code; backfilling via the region join
-- gives the correct city_code for each alias's parent region.
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
-- 20260527120100_service_regions_add_city_code.sql ran first.
--
-- ──────────────────────────────────────────────────────────────────────
-- Rollback posture
-- ──────────────────────────────────────────────────────────────────────
--   No DOWN migration. Supersession only.
-- ──────────────────────────────────────────────────────────────────────


ALTER TABLE public.service_region_area_aliases
  ADD COLUMN IF NOT EXISTS city_code TEXT;


UPDATE public.service_region_area_aliases srala
  SET city_code = sr.city_code
  FROM public.service_regions sr
  WHERE srala.region_code = sr.region_code
    AND srala.city_code IS NULL;


DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'service_region_area_aliases_city_code_fkey'
      AND conrelid = 'public.service_region_area_aliases'::regclass
  ) THEN
    ALTER TABLE public.service_region_area_aliases
      ADD CONSTRAINT service_region_area_aliases_city_code_fkey
      FOREIGN KEY (city_code) REFERENCES public.cities(city_code);
  END IF;
END $$;


DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM public.service_region_area_aliases WHERE city_code IS NULL
  ) THEN
    RAISE EXCEPTION
      'service_region_area_aliases has rows with NULL city_code after backfill — '
      'SET NOT NULL aborted. Confirm parent service_regions migration ran.';
  END IF;
  ALTER TABLE public.service_region_area_aliases
    ALTER COLUMN city_code SET NOT NULL;
END $$;
