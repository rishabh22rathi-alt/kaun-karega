-- 20260527120400_tasks_add_city_code.sql
--
-- Phase 1.0 — RUNTIME table. Adds city_code to tasks, backfills
-- every historical row to 'JOD', adds the FK to cities. Deliberately
-- LEAVES THE COLUMN NULLABLE.
--
-- ──────────────────────────────────────────────────────────────────────
-- Why NOT NULL is deferred to Phase 1.5
-- ──────────────────────────────────────────────────────────────────────
--   tasks is on the hot insert path. Every insert site in the
--   codebase (e.g. /api/submit-request, /api/kk create_need, and
--   any test fixture writing through it) currently writes WITHOUT
--   city_code. Setting NOT NULL now would 500 every customer
--   request the instant the migration applies.
--
--   The deferred NOT NULL is gated by Phase 1.5 verification: a
--   later reconcile migration adds NOT NULL after Phase 1.2 has
--   patched every insert site to populate city_code and a sample
--   query confirms ≥99% of new rows arrive non-NULL.
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
--   Matching path is untouched. /api/find-provider and
--   /api/process-task-notifications continue to use `ilike` on
--   tasks.area vs provider_areas.area. The new city_code column
--   is captured but not yet consulted at match time.
--
-- ──────────────────────────────────────────────────────────────────────
-- Rollback posture
-- ──────────────────────────────────────────────────────────────────────
--   No DOWN migration. Supersession only.
-- ──────────────────────────────────────────────────────────────────────


ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS city_code TEXT;


-- Backfill: every historical task is from Jodhpur today, by virtue
-- of JOD being the only active city.
UPDATE public.tasks
  SET city_code = 'JOD'
  WHERE city_code IS NULL;


DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'tasks_city_code_fkey'
      AND conrelid = 'public.tasks'::regclass
  ) THEN
    ALTER TABLE public.tasks
      ADD CONSTRAINT tasks_city_code_fkey
      FOREIGN KEY (city_code) REFERENCES public.cities(city_code);
  END IF;
END $$;


-- NOT NULL deliberately NOT set. See preamble for rationale.
