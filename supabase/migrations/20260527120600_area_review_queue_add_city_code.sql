-- 20260527120600_area_review_queue_add_city_code.sql
--
-- Phase 1.0 — RUNTIME table. Adds city_code to area_review_queue,
-- backfills every existing row to 'JOD', adds the FK to cities.
-- Deliberately LEAVES THE COLUMN NULLABLE.
--
-- ──────────────────────────────────────────────────────────────────────
-- Why NOT NULL is deferred to Phase 1.5
-- ──────────────────────────────────────────────────────────────────────
--   area_review_queue is written by the unmapped-area pipeline
--   (web/lib/admin/adminUnmappedAreas.ts:108-114) when a customer
--   or provider submits an area that does not exist in the
--   catalog. That code path currently does NOT write city_code.
--
--   The deferred NOT NULL is gated by Phase 1.2 patching that
--   writer, followed by a Phase 1.5 reconcile migration.
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
--   Admin pending-areas surface continues to read every row
--   regardless of city_code. The new column is captured but not
--   yet used as a filter until Phase 1.1 adds the optional ?city=
--   param.
--
-- ──────────────────────────────────────────────────────────────────────
-- Rollback posture
-- ──────────────────────────────────────────────────────────────────────
--   No DOWN migration. Supersession only.
-- ──────────────────────────────────────────────────────────────────────


ALTER TABLE public.area_review_queue
  ADD COLUMN IF NOT EXISTS city_code TEXT;


-- Backfill: every historical pending area request is from Jodhpur.
UPDATE public.area_review_queue
  SET city_code = 'JOD'
  WHERE city_code IS NULL;


DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'area_review_queue_city_code_fkey'
      AND conrelid = 'public.area_review_queue'::regclass
  ) THEN
    ALTER TABLE public.area_review_queue
      ADD CONSTRAINT area_review_queue_city_code_fkey
      FOREIGN KEY (city_code) REFERENCES public.cities(city_code);
  END IF;
END $$;


-- NOT NULL deliberately NOT set. See preamble for rationale.
