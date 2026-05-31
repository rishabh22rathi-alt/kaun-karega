-- All Jodhpur search — Phase 1: tasks.scope.
--
-- Marks whether a task is a normal region-scoped request or a virtual
-- "All Jodhpur" city-wide request. This is the ONLY non-hacky way to
-- express a city-wide request without inventing a fake service_regions
-- row and without overloading region_code = NULL (which already means
-- "unresolved → zero matches" under strict region matching).
--
-- Semantics:
--   'region'      → existing behaviour. region_code carries the resolved
--                   JOD region (or NULL when unresolved). Strict region
--                   matching unchanged.
--   'all_jodhpur' → city-wide request. submit-request (a LATER phase)
--                   will set area='All Jodhpur', city_code='JOD',
--                   region_code=NULL, scope='all_jodhpur', and matching
--                   (a LATER phase) will match only active all_jodhpur
--                   providers. NOT wired in this migration.
--
-- Safety:
--   • NOT NULL DEFAULT 'region' — adding a column with a CONSTANT default
--     is metadata-only in PostgreSQL 11+, so this does not rewrite the
--     tasks table. Every existing row reads 'region' (no backfill needed,
--     no behaviour change).
--   • CHECK guarded by a pg_constraint lookup → second-run safe.
--   • ADD COLUMN IF NOT EXISTS → second-run safe.
--   • No UPDATE / DELETE / TRUNCATE / DROP.
--
-- Runtime compatibility: no reader or writer is gated on this column yet.
-- submit-request continues to INSERT without `scope` (default applies);
-- find-provider / process-task-notifications ignore it until a later phase.

ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS scope text NOT NULL DEFAULT 'region';

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'tasks_scope_check'
       AND conrelid = 'public.tasks'::regclass
  ) THEN
    ALTER TABLE public.tasks
      ADD CONSTRAINT tasks_scope_check
      CHECK (scope IN ('region', 'all_jodhpur'));
  END IF;
END $$;

COMMENT ON COLUMN public.tasks.scope IS
  'Request coverage scope. ''region'' (default) = normal region-scoped request; ''all_jodhpur'' = virtual city-wide request (region_code NULL, matched only against active all_jodhpur providers). Set by submit-request and read by matching in a later phase.';
