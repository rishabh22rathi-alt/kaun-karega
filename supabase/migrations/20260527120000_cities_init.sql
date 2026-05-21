-- 20260527120000_cities_init.sql
--
-- Phase 1.0 — Foundation. Creates the cities table and seeds JOD.
-- This is the parent table for every city_code column added by the
-- six follow-up migrations in this batch.
--
-- ──────────────────────────────────────────────────────────────────────
-- Locked decisions (Phase 1 plan)
-- ──────────────────────────────────────────────────────────────────────
--   • city_code format: 3 ASCII upper letters ([A-Z]{3}). Enforced by
--     CHECK constraint. Matches the planned region format JOD-01.
--   • Seed: exactly one row — ('JOD', 'Jodhpur', 'Rajasthan', 'IN',
--     active=true, is_default=true).
--   • Exactly one row may have is_default=true. Enforced by a partial
--     unique index.
--   • active vs is_default: active gates inclusion in /api/cities;
--     is_default selects the homepage's implicit city when no
--     selection exists. JOD is both today.
--   • No ON UPDATE / ON DELETE cascade on any FK pointing at this
--     table — keeps NO ACTION posture to match existing
--     service_regions FK chain.
--
-- ──────────────────────────────────────────────────────────────────────
-- Safety posture
-- ──────────────────────────────────────────────────────────────────────
--   • CREATE TABLE IF NOT EXISTS — second-run safe.
--   • CREATE UNIQUE INDEX IF NOT EXISTS — second-run safe.
--   • INSERT ... ON CONFLICT (city_code) DO NOTHING — second-run safe;
--     never overwrites an existing JOD row even if columns drift.
--   • No ALTER, no DROP, no UPDATE/DELETE/TRUNCATE on prior tables.
--
-- ──────────────────────────────────────────────────────────────────────
-- Rollback posture
-- ──────────────────────────────────────────────────────────────────────
--   No DOWN migration. Supersession is the only correction path.
--   A DROP of the cities table would cascade-break every city_code
--   FK added in the following six migrations.
--
-- ──────────────────────────────────────────────────────────────────────
-- Production effect
-- ──────────────────────────────────────────────────────────────────────
--   First run on prod: creates cities, indexes, and one seed row.
--   Second run on prod: every statement is a no-op (IF NOT EXISTS /
--   ON CONFLICT DO NOTHING). No existing prod data is read or
--   modified outside the cities table itself.
-- ──────────────────────────────────────────────────────────────────────


CREATE TABLE IF NOT EXISTS public.cities (
  city_code   TEXT        PRIMARY KEY,
  city_name   TEXT        NOT NULL,
  state       TEXT        NOT NULL,
  country     TEXT        NOT NULL DEFAULT 'IN',
  active      BOOLEAN     NOT NULL DEFAULT false,
  is_default  BOOLEAN     NOT NULL DEFAULT false,
  notes       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT cities_city_code_format CHECK (city_code ~ '^[A-Z]{3}$')
);


-- Partial unique index: at most one row with is_default = true.
-- Because the indexed column is is_default and the WHERE clause
-- restricts to is_default = true, the index can contain at most
-- one entry — Postgres rejects a second is_default=true insert
-- with a unique violation.
CREATE UNIQUE INDEX IF NOT EXISTS cities_one_default_idx
  ON public.cities (is_default) WHERE is_default = true;


-- Seed JOD. ON CONFLICT DO NOTHING makes this idempotent and
-- safe to re-run; it will never overwrite a manually-edited row.
INSERT INTO public.cities
  (city_code, city_name, state,       country, active, is_default)
VALUES
  ('JOD',     'Jodhpur',  'Rajasthan','IN',    true,   true)
ON CONFLICT (city_code) DO NOTHING;
