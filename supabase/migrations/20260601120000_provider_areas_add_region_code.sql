-- Phase 1 — Provider Region Allocation: schema foundation.
--
-- Adds a nullable region_code column to provider_areas so a provider's
-- coverage row can be linked directly to a JOD service region instead
-- of being derived on every read by joining provider_areas.area against
-- service_region_areas.canonical_area.
--
-- ──────────────────────────────────────────────────────────────────────
-- Scope of THIS migration
-- ──────────────────────────────────────────────────────────────────────
--   • Add column public.provider_areas.region_code TEXT NULL
--   • Add FK provider_areas_region_code_fkey -> service_regions(region_code)
--   • Add partial index provider_areas_region_code_idx
--       ON public.provider_areas(region_code) WHERE region_code IS NOT NULL
--
-- Deliberately NOT in this migration (later phases):
--   • Backfill of existing rows (one-shot allocator script)
--   • Resolver helper in web/lib/admin/adminAreaMappings.ts
--   • Writes to region_code from /api/provider/update, /api/kk, or the
--     5-minute canonicalization job
--   • Matching path change (find-provider stays text-based)
--   • Dashboard/profile read path change
--   • Unique constraint on (provider_id, area, region_code)
--   • NOT NULL on region_code
--
-- ──────────────────────────────────────────────────────────────────────
-- Why nullable
-- ──────────────────────────────────────────────────────────────────────
--   Mirrors the Phase 1.0 city_code add (20260527120500): every existing
--   write site continues to insert (provider_id, area, city_code) only,
--   without yet writing region_code. NULL is the "resolution pending"
--   state. The next phase patches the write sites to call the resolver
--   inline; the phase after that runs the bulk allocator on the residual
--   NULL rows. Setting NOT NULL today would break every active
--   provider_areas insert path on first deploy.
--
-- ──────────────────────────────────────────────────────────────────────
-- Why partial index
-- ──────────────────────────────────────────────────────────────────────
--   region_code-driven matching only ever cares about non-NULL rows.
--   A partial index avoids indexing the entire residual NULL set during
--   the rollout window (could be the majority of rows for days) while
--   still serving the post-backfill matching workload at full speed.
--
-- ──────────────────────────────────────────────────────────────────────
-- Safety posture
-- ──────────────────────────────────────────────────────────────────────
--   • ADD COLUMN IF NOT EXISTS — second-run safe.
--   • FK guarded by DO $$ … pg_constraint lookup — second-run safe.
--   • CREATE INDEX IF NOT EXISTS — second-run safe.
--   • No NOT NULL.
--   • No UPDATE / DELETE / TRUNCATE / DROP.
--   • No backfill — region_code stays NULL for all existing rows.
--   • FK uses default NO ACTION on update/delete: if an admin ever
--     hard-deletes a service_regions row that is still referenced, the
--     DELETE will fail loudly rather than silently NULL-ing provider
--     rows. The existing cleanup-legacy-regions endpoint already
--     enforces an orphan-risk check, so this is consistent with the
--     rest of the catalog.
--
-- ──────────────────────────────────────────────────────────────────────
-- Runtime compatibility
-- ──────────────────────────────────────────────────────────────────────
--   Matching (web/app/api/find-provider/route.ts) joins on
--   provider_areas.area text and never reads region_code. The 5-minute
--   canonicalization job (web/lib/admin/adminAreaMappings.ts) does
--   delete-then-insert preserving city_code and is oblivious to the new
--   column — fresh inserts default region_code to NULL, which is
--   exactly the pre-migration behaviour from the readers' perspective.
--   Provider registration and dashboard flows are untouched.
--
-- ──────────────────────────────────────────────────────────────────────
-- Rollback posture
-- ──────────────────────────────────────────────────────────────────────
--   No DOWN migration. Supersession only. If the rollout is aborted, the
--   column can be left in place — every reader tolerates NULL, every
--   writer continues to omit it, and no application code is gated on
--   the column's existence.


ALTER TABLE public.provider_areas
  ADD COLUMN IF NOT EXISTS region_code TEXT;


DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'provider_areas_region_code_fkey'
       AND conrelid = 'public.provider_areas'::regclass
  ) THEN
    ALTER TABLE public.provider_areas
      ADD CONSTRAINT provider_areas_region_code_fkey
      FOREIGN KEY (region_code) REFERENCES public.service_regions(region_code);
  END IF;
END $$;


CREATE INDEX IF NOT EXISTS provider_areas_region_code_idx
  ON public.provider_areas (region_code)
  WHERE region_code IS NOT NULL;


-- NOT NULL deliberately NOT set. Backfill is a separate one-shot
-- script in a later phase; matching is unaffected; readers tolerate
-- NULL by falling back to the existing derive-on-read path.
