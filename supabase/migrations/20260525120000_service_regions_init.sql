-- 20260525120000_service_regions_init.sql
--
-- Phase A1 — capture the existing service_regions / service_region_areas /
-- service_region_area_aliases tables in source control.
--
-- Background: these three tables were created out-of-band (Supabase
-- dashboard) during the original Area Intelligence rollout and have been
-- in production use for weeks. The repo had no CREATE TABLE for any of
-- them — only the application code references them.
--
-- Safety posture (Docker Desktop is unavailable, so a full pg_dump of
-- the live schema is not possible at this time):
--   • Every statement is idempotent. Postgres skips a CREATE TABLE IF
--     NOT EXISTS entirely when the table already exists, so production
--     experiences a NO-OP on every column, constraint, and default in
--     these definitions.
--   • No DROP, no ALTER, no RENAME, no INSERT/UPDATE/DELETE.
--   • Column types, primary keys, foreign keys, and uniqueness rules
--     are reconstructed from the runtime code that reads and writes
--     these tables (web/app/api/admin/area-intelligence/route.ts,
--     web/app/api/admin/areas/route.ts, web/app/api/area-intelligence/*).
--     They may differ in non-functional ways from the live schema
--     (e.g. id column type, presence of created_at/updated_at). That
--     is acceptable because this migration only takes effect on FRESH
--     environments where the tables do not yet exist.
--   • A future migration can dump the real prod schema once Docker is
--     available and reconcile any drift via ALTER TABLE on prod and
--     a documented baseline rewrite here. See PR notes for follow-up.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ──────────────────────────────────────────────────────────────────────
-- service_regions
--
-- Top-level region catalogue. region_code is the stable, human-readable
-- identifier (e.g. "R-01", "R-NORTH") that both child tables reference.
-- The application treats region_code as IMMUTABLE — patchRegion in
-- /api/admin/area-intelligence intentionally strips any region_code
-- field from PATCH bodies. Only region_name, active, and notes are
-- mutable through the editor.
-- ──────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.service_regions (
  region_code   TEXT        PRIMARY KEY,
  region_name   TEXT        NOT NULL,
  active        BOOLEAN     NOT NULL DEFAULT true,
  notes         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ──────────────────────────────────────────────────────────────────────
-- service_region_areas
--
-- Canonical service areas within each region. area_code is the stable
-- identifier the admin editor uses in PATCH bodies; canonical_area is
-- the display string surfaced to providers and customers.
--
-- The (canonical_area, region_code) pair is the semantic uniqueness
-- rule the runtime enforces:
--   • postArea (admin/area-intelligence) rejects duplicates with
--     DUPLICATE_AREA_IN_REGION via a case-insensitive ILIKE check.
--   • moveArea rejects same-name collisions when re-parenting an area.
--
-- The UNIQUE constraint below is case-SENSITIVE. The runtime check is
-- case-insensitive, so seeded data inserted directly via SQL could in
-- principle create rows that runtime would have refused (e.g. two
-- entries differing only in case). That gap is acceptable for Phase A
-- because no SQL seeding is part of this migration and the editor is
-- the only writer in normal operation.
-- ──────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.service_region_areas (
  area_code      TEXT        PRIMARY KEY,
  canonical_area TEXT        NOT NULL,
  region_code    TEXT        NOT NULL
                             REFERENCES public.service_regions(region_code),
  active         BOOLEAN     NOT NULL DEFAULT true,
  notes          TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_service_region_areas_canonical_region
    UNIQUE (canonical_area, region_code)
);

-- ──────────────────────────────────────────────────────────────────────
-- service_region_area_aliases
--
-- Alternate spellings / local names / colloquial variants that resolve
-- to a (canonical_area, region_code) pair. alias_code is the stable
-- identifier the admin editor uses in PATCH bodies; alias is the
-- display text the resolver matches against.
--
-- Columns reflected from runtime use:
--   • id            — selected explicitly by /api/admin/areas (line 113).
--                     Declared UUID with gen_random_uuid() default.
--   • alias_code    — unique; .eq("alias_code", ...) lookups.
--   • alias         — display text, per-region uniqueness enforced.
--   • canonical_area, region_code — together identify the parent area.
--   • active, notes — same shape as service_region_areas.
--
-- Per-region alias uniqueness is enforced in code by aliasExistsInRegion
-- (case-insensitive ILIKE). The UNIQUE constraint below provides the
-- structural counterpart on case-sensitive equality.
-- ──────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.service_region_area_aliases (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  alias_code     TEXT        NOT NULL UNIQUE,
  alias          TEXT        NOT NULL,
  canonical_area TEXT        NOT NULL,
  region_code    TEXT        NOT NULL
                             REFERENCES public.service_regions(region_code),
  active         BOOLEAN     NOT NULL DEFAULT true,
  notes          TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_service_region_area_aliases_alias_region
    UNIQUE (alias, region_code)
);
