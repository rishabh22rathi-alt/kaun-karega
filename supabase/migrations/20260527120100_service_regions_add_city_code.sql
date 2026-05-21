-- 20260527120100_service_regions_add_city_code.sql
--
-- Phase 1.0 — Catalog table. Adds city_code to service_regions,
-- backfills every existing row to 'JOD', adds the FK to cities,
-- and sets NOT NULL immediately because:
--   • service_regions is a small, editor-managed catalog table.
--   • Inserts only happen through admin paths (low concurrency).
--   • The backfill is one UPDATE; race window is microscopic.
--
-- ──────────────────────────────────────────────────────────────────────
-- Safety posture
-- ──────────────────────────────────────────────────────────────────────
--   • ADD COLUMN IF NOT EXISTS — second-run safe.
--   • UPDATE WHERE city_code IS NULL — second-run safe (no rows
--     match on the second run because the first run filled them).
--   • FK add via DO $$ block that checks pg_constraint — second-run
--     safe; the second run finds the constraint and skips ADD.
--   • SET NOT NULL guarded by an EXISTS pre-check that raises a
--     loud exception rather than silently corrupting if any row
--     still has a NULL city_code (impossible barring concurrent
--     inserts during the migration window).
--   • No DROP, no DELETE/TRUNCATE.
--   • FK uses default NO ACTION on update/delete — matches the
--     existing posture of service_region_areas → service_regions.
--
-- ──────────────────────────────────────────────────────────────────────
-- Rollback posture
-- ──────────────────────────────────────────────────────────────────────
--   No DOWN migration. Supersession only.
--
-- ──────────────────────────────────────────────────────────────────────
-- Production effect
-- ──────────────────────────────────────────────────────────────────────
--   First run on prod: adds the column, fills it for every region
--   row (all → 'JOD' because Jodhpur is the only active city
--   today), constrains it.
--   Second run: every statement is a no-op or a guarded no-op.
-- ──────────────────────────────────────────────────────────────────────


ALTER TABLE public.service_regions
  ADD COLUMN IF NOT EXISTS city_code TEXT;


UPDATE public.service_regions
  SET city_code = 'JOD'
  WHERE city_code IS NULL;


DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'service_regions_city_code_fkey'
      AND conrelid = 'public.service_regions'::regclass
  ) THEN
    ALTER TABLE public.service_regions
      ADD CONSTRAINT service_regions_city_code_fkey
      FOREIGN KEY (city_code) REFERENCES public.cities(city_code);
  END IF;
END $$;


DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM public.service_regions WHERE city_code IS NULL
  ) THEN
    RAISE EXCEPTION
      'service_regions has rows with NULL city_code after backfill — '
      'SET NOT NULL aborted. Re-run the UPDATE above and retry.';
  END IF;
  ALTER TABLE public.service_regions
    ALTER COLUMN city_code SET NOT NULL;
END $$;
