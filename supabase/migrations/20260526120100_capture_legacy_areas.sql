-- 20260526120100_capture_legacy_areas.sql
--
-- Phase 0.4 capture migration. Promotes the legacy area catalog
-- (areas, area_aliases) from docs/admin-slice-areas.sql into a real
-- Supabase migration so fresh environments can reproduce prod.
--
-- These two tables remain LOAD-BEARING for runtime matching today:
-- web/lib/admin/adminAreaMappings.ts:144-251 runs a 5-minute TTL
-- canonicalization job that reads areas + area_aliases and rewrites
-- provider_areas accordingly. They cannot be retired until that job
-- is rewritten against the service_region_* tree (deferred to a
-- later phase).
--
-- ──────────────────────────────────────────────────────────────────────
-- Source of schema
-- ──────────────────────────────────────────────────────────────────────
--   docs/admin-slice-areas.sql (lines 5-24)
--   Promoted verbatim with schema-qualified names (public.) and
--   IF NOT EXISTS guards added to every CREATE statement.
--
-- ──────────────────────────────────────────────────────────────────────
-- Safety posture
-- ──────────────────────────────────────────────────────────────────────
--   • Every statement is idempotent (CREATE … IF NOT EXISTS).
--   • No ALTER, DROP, INSERT, UPDATE, DELETE, TRUNCATE.
--   • No RLS changes, no policies, no GRANT / REVOKE.
--   • No triggers, no functions, no extensions.
--   • No cross-file foreign keys.
--   • Production: every statement is a NO-OP — both tables already
--     exist in prod (operators ran the docs/admin-slice-areas.sql
--     script in the Supabase dashboard during the original area
--     intelligence rollout).
--   • Fresh environments: gain a reproducible baseline.
--
-- ──────────────────────────────────────────────────────────────────────
-- Known unknowns (deliberately not declared here)
-- ──────────────────────────────────────────────────────────────────────
--   • Any indexes or constraints added in prod after the original
--     docs/admin-slice-areas.sql was run are not captured here. A
--     follow-up reconcile migration will close drift after a prod
--     dump.
--   • area_aliases.canonical_area is intentionally not declared as
--     a FK to areas.area_name. Matches the source doc and avoids
--     ON DELETE side effects when the legacy tables are eventually
--     retired.
--
-- ──────────────────────────────────────────────────────────────────────
-- Rollback posture
-- ──────────────────────────────────────────────────────────────────────
--   No DOWN migration. These tables already exist in prod; this
--   migration never wrote to prod. Supersession via a later
--   reconcile migration is the only correction path.
--
-- ──────────────────────────────────────────────────────────────────────
-- Production no-op guarantee
-- ──────────────────────────────────────────────────────────────────────
--   Both tables already exist in production. IF NOT EXISTS makes
--   every CREATE a no-op; no row, index, constraint, or policy is
--   touched.
-- ──────────────────────────────────────────────────────────────────────


-- ──────────────────────────────────────────────────────────────────────
-- areas
--
-- Legacy canonical area catalog. Still read by the 5-minute
-- provider_areas canonicalization job. The newer service_region_areas
-- table coexists with this one; bridging them is deferred to a
-- future phase.
-- ──────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.areas (
  id         BIGSERIAL   PRIMARY KEY,
  area_name  TEXT        NOT NULL UNIQUE,
  active     BOOLEAN     NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);


-- ──────────────────────────────────────────────────────────────────────
-- area_aliases
--
-- Legacy alias → canonical mapping. canonical_area is plain TEXT
-- (no FK to areas.area_name) — runtime resolves it case-insensitively.
-- ──────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.area_aliases (
  id             BIGSERIAL   PRIMARY KEY,
  alias_name     TEXT        NOT NULL UNIQUE,
  canonical_area TEXT        NOT NULL,
  active         BOOLEAN     NOT NULL DEFAULT true,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);


CREATE INDEX IF NOT EXISTS area_aliases_canonical_area_idx ON public.area_aliases (canonical_area);
CREATE INDEX IF NOT EXISTS area_aliases_active_idx         ON public.area_aliases (active);
CREATE INDEX IF NOT EXISTS areas_active_idx                ON public.areas (active);
